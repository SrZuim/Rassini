/* ==========================================================================
   RNA One — Biblioteca Técnica (regra de domínio)
   Busca instantânea, filtros, tolerância, favoritos, recentes, versionamento
   e agregações do dashboard. Toda a persistência passa pela camada db.js
   (funciona em modo demo ou Supabase sem alteração).
   ========================================================================== */
import { db } from './db.js';
import { pecaAtendeTipo, tiposDaPeca, semTiposConfigurados, normalizarSlug,
         validarTiposInspecao as validarTiposInspecaoInterno,
         normalizarParaGravar as normalizarParaGravarInterno } from './tipos-inspecao.js';

/* Reexporta os helpers de tipo de inspeção: as páginas da Biblioteca já importam
   este módulo, e reexportar evita que cada tela vá buscar a lista noutro lugar
   (§12 — fonte única). A definição canônica vive em tipos-inspecao.js. */
export { tiposDaPeca, semTiposConfigurados, pecaAtendeTipo, normalizarParaGravar,
         validarTiposInspecao, MSG_TIPOS_OBRIGATORIO, SEM_TIPOS_LABEL,
         listarTipos, mapaTipos, curtoDoSlug, nomeDoSlug } from './tipos-inspecao.js';

/* Campos da peça indexados pela busca “estilo Google”.
   (Reestruturação: material/norma/especificacao/observacoes/quadrante saíram da
   peça — quadrante agora é por especificação.) */
const CAMPOS_BUSCA = ['codigo','nome','cliente','familia','planta','numero_ad'];

/* Remove acentos e baixa a caixa para busca tolerante. */
export function normaliza(txt) {
  return String(txt ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/* ------------------------------------------- gravação tolerante a migration --
   `bib_pecas.tipos_inspecao` só existe após database/fix_tipos_inspecao_peca.sql.
   Enquanto a migration não roda, gravar a peça NÃO pode falhar: tenta completo,
   detecta coluna ausente, avisa uma vez e regrava sem o campo (mesmo padrão de
   inspecao.js/biblioteca.js). O vínculo passa a valer assim que o SQL rodar. */
let _semColunaTipos = false;
function ehErroDeColuna(e) {
  return ['PGRST204', 'PGRST205', '42703', '42P01'].includes(String(e?.code || ''))
    || /could not find the .*column|column .* does not exist|schema cache/i.test(`${e?.message || ''} ${e?.details || ''}`);
}
function avisarColunaAusente(e) {
  _semColunaTipos = true;
  console.warn('[BIB] bib_pecas não tem a coluna "tipos_inspecao" — peça gravada SEM o vínculo. ' +
    'Rode database/fix_tipos_inspecao_peca.sql no Supabase. Detalhe:', e?.message || e);
}
const semTipos = row => { const r = { ...row }; delete r.tipos_inspecao; return r; };

/** Mensagem única para o usuário quando a migration do vínculo está pendente.
    A gravação degradada NÃO pode ser anunciada como sucesso (§4.8): a peça é
    salva, mas o tipo de inspeção não — e sem ele a peça não aparece em nenhum
    relatório dimensional. Quem chama precisa dizer isso na tela. */
export const MSG_MIGRACAO_TIPOS =
  'Os tipos de inspeção NÃO foram gravados: o banco ainda não tem a coluna "tipos_inspecao". ' +
  'Rode database/fix_tipos_inspecao_peca.sql no Supabase — até lá a peça não aparecerá nos relatórios dimensionais.';

/** true quando já se sabe que o banco está atrás da migration do vínculo. */
export function migracaoTiposPendente() { return _semColunaTipos; }

/** Preflight barato (1 requisição, cacheado): a coluna do vínculo existe?
    Chamado pelas telas que dependem do vínculo para avisar ANTES de o usuário
    perder trabalho, em vez de descobrir só no erro do salvamento. Em modo demo
    (localStorage) a coluna sempre "existe". */
let _preflight = null;
export function checarColunaTipos() {
  if (_semColunaTipos) return Promise.resolve(false);
  if (!_preflight) {
    _preflight = (async () => {
      try {
        const { SUPABASE } = await import('./config.js');
        if (!SUPABASE.enabled) return true;
        const { getSupabase } = await import('./supabaseClient.js');
        const sb = await getSupabase();
        const { error } = await sb.from('bib_pecas').select('tipos_inspecao').limit(1);
        if (error && ehErroDeColuna(error)) { avisarColunaAusente(error); return false; }
        return true;                       // inclui erro de RLS/rede: não é falta de coluna
      } catch { return true; }             // na dúvida não alarma; o save reporta o erro real
    })();
  }
  return _preflight;
}

/** Cria a peça garantindo a validação do vínculo (§3, camada de serviço).
    Quando a coluna não existe, a peça é gravada mesmo assim (não se perde o
    cadastro), mas o retorno vem marcado com `tipos_nao_gravados` para a tela
    reportar o que realmente aconteceu. */
export async function inserirPeca(row) {
  const erro = validarTiposInspecaoInterno(row?.tipos_inspecao);
  if (erro) throw new Error(erro);
  const payload = { ...row, tipos_inspecao: normalizarParaGravarInterno(row.tipos_inspecao) };
  const degradado = async e => {
    if (e) avisarColunaAusente(e);
    const p = await db.insert('bib_pecas', semTipos(payload));
    return { ...p, tipos_nao_gravados: true };
  };
  if (_semColunaTipos) return degradado(null);
  try { return await db.insert('bib_pecas', payload); }
  catch (e) { if (!ehErroDeColuna(e)) throw e; return degradado(e); }
}

/* ------------------------------------------------------------- consultas --- */
/** Todas as peças; por padrão oculta arquivadas (ativo=false). */
export async function listarPecas({ incluirArquivadas = false } = {}) {
  const pecas = await db.list('bib_pecas');
  const ativas = incluirArquivadas ? pecas : pecas.filter(p => p.ativo !== false);
  return ativas.sort((a, b) => normaliza(a.codigo).localeCompare(normaliza(b.codigo)));
}

/** Busca textual + filtros. `q` casa em qualquer CAMPOS_BUSCA.
    Filtros combinam entre si (§10): cliente + tipo_inspecao + status devolve só
    quem atende aos três. `tipo_inspecao` é tratado à parte porque a peça guarda
    um ARRAY de slugs — a comparação `p[campo] === valor` não se aplica.
    Valor especial `__sem_tipo__` lista os registros legados ainda não
    configurados (§5), para o administrador regularizá-los. */
export const FILTRO_SEM_TIPO = '__sem_tipo__';
export async function buscar(q = '', filtros = {}, opts = {}) {
  const termo = normaliza(q);
  let pecas = await listarPecas(opts);
  if (termo) {
    pecas = pecas.filter(p => CAMPOS_BUSCA.some(c => normaliza(p[c]).includes(termo)));
  }
  for (const [campo, valor] of Object.entries(filtros)) {
    if (!valor) continue;
    if (campo === 'tipo_inspecao') {
      pecas = valor === FILTRO_SEM_TIPO
        ? pecas.filter(semTiposConfigurados)
        : pecas.filter(p => pecaAtendeTipo(p, valor));
      continue;
    }
    pecas = pecas.filter(p => p[campo] === valor);
  }
  return pecas;
}

/* =========================================== COMPATIBILIDADE DOS CADASTROS ===
   Peças cadastradas antes do vínculo existir ficam com `tipos_inspecao` vazio e
   NÃO aparecem em auditoria alguma (fail-closed, §5). O caminho de regularização
   é assistido — nunca automático: atribuir tipo a peça sem informação confiável
   recria exatamente o risco de seleção errada que o vínculo elimina. */

/** Quantas peças ainda não têm vínculo configurado (contador administrativo §8). */
export async function contarSemTipos({ incluirArquivadas = false } = {}) {
  return (await listarPecas({ incluirArquivadas })).filter(semTiposConfigurados).length;
}

/** Aplica o MESMO conjunto de tipos a um lote de peças já filtrado pelo
    administrador (por cliente/família/planta). Passa por `salvarRevisao`, então
    cada peça ganha snapshot da versão anterior e linha de histórico — a migração
    fica rastreável e reversível pela tela de versões, peça a peça.
    Só grava o vínculo: nenhum outro campo do cadastro é tocado.
    Devolve `{ ok, falhas: [{ peca, erro }] }` — sucesso parcial é reportado, não
    engolido. */
export async function configurarTiposEmLote(pecas, tipos, usuario) {
  const erro = validarTiposInspecaoInterno(tipos);
  if (erro) throw new Error(erro);
  const alvo = normalizarParaGravarInterno(tipos);
  const falhas = [];
  let ok = 0;
  // Em blocos: paralelismo suficiente para não demorar, sem inundar o PostgREST.
  const LOTE = 5;
  for (let i = 0; i < pecas.length; i += LOTE) {
    const bloco = pecas.slice(i, i + LOTE);
    const res = await Promise.allSettled(
      bloco.map(p => salvarRevisao(p.id, { tipos_inspecao: alvo }, usuario))
    );
    res.forEach((r, j) => {
      if (r.status === 'fulfilled' && !r.value?.tipos_nao_gravados) ok++;
      else falhas.push({ peca: bloco[j], erro: r.reason || new Error(MSG_MIGRACAO_TIPOS) });
    });
  }
  return { ok, falhas };
}

/** Sugestões (autocomplete) enquanto digita — no máx. `limite`. */
export async function sugestoes(q = '', limite = 8) {
  const termo = normaliza(q);
  if (!termo) return [];
  const pecas = await listarPecas();
  const scored = [];
  for (const p of pecas) {
    const codigo = normaliza(p.codigo), nome = normaliza(p.nome);
    let score = -1;
    if (codigo.startsWith(termo)) score = 0;
    else if (nome.startsWith(termo)) score = 1;
    else if (codigo.includes(termo) || nome.includes(termo)) score = 2;
    else if (CAMPOS_BUSCA.some(c => normaliza(p[c]).includes(termo))) score = 3;
    if (score >= 0) scored.push({ p, score });
  }
  scored.sort((a, b) => a.score - b.score || normaliza(a.p.codigo).localeCompare(normaliza(b.p.codigo)));
  return scored.slice(0, limite).map(s => s.p);
}

/* Campos indexados na busca da Auditoria (Minhas Auditorias → selecionar peça).
   Além dos CAMPOS_BUSCA, o auditor pesquisa pela revisão do desenho e pela AD. */
const CAMPOS_BUSCA_INSPECAO = ['codigo', 'nome', 'cliente', 'familia', 'planta', 'numero_ad', 'revisao_desenho'];

/** Busca de peças para a inspeção dimensional (§5).
    Só retorna peças ATIVAS e com cadastro utilizável — arquivadas/obsoletas não
    podem ser auditadas. Casa Part Number, nome, cliente, família, planta,
    número da AD e revisão do desenho (aceita "21" e "Rev. 21").
    Ordena por relevância: PN exato → PN → nome → demais campos. */
export async function buscarParaInspecao(q = '', limite = 8, { tipo = null } = {}) {
  const termo = normaliza(q);
  if (!termo) return [];
  /* §11 — o recorte por tipo é aplicado AQUI, no serviço, e não apenas na tela:
     uma peça incompatível nunca chega ao front. Sem `tipo` informado nada é
     listado (fail-closed): é melhor não sugerir nada do que sugerir peça errada. */
  const alvo = normalizarSlug(tipo);
  if (!alvo) return [];
  const pecas = (await listarPecas())
    .filter(p => !['Arquivado', 'Obsoleto'].includes(p.status))
    .filter(p => pecaAtendeTipo(p, alvo));
  const rev = termo.replace(/^rev\.?\s*/, '');
  const revNum = /^\d+$/.test(rev) ? String(parseInt(rev, 10)) : null;
  const scored = [];
  for (const p of pecas) {
    const codigo = normaliza(p.codigo), nome = normaliza(p.nome);
    let score = -1;
    if (codigo === termo) score = 0;
    else if (codigo.startsWith(termo)) score = 1;
    else if (nome.startsWith(termo)) score = 2;
    else if (codigo.includes(termo) || nome.includes(termo)) score = 3;
    else if (normaliza(p.numero_ad).includes(termo)) score = 4;
    else if (normaliza(p.cliente).includes(termo)) score = 5;
    else if (CAMPOS_BUSCA_INSPECAO.some(c => normaliza(p[c]).includes(termo))) score = 6;
    else if (revNum && String(p.revisao_desenho ?? '') === revNum) score = 7;
    if (score >= 0) scored.push({ p, score });
  }
  scored.sort((a, b) => a.score - b.score || normaliza(a.p.codigo).localeCompare(normaliza(b.p.codigo)));
  return scored.slice(0, limite).map(s => s.p);
}

/** Quantas peças AUDITÁVEIS existem para um tipo de inspeção. Base do estado
    "Nenhuma peça cadastrada para este tipo de inspeção" (§8) — consultado antes
    de habilitar o campo de busca, sem depender de o auditor digitar algo. */
export async function contarPecasDoTipo(tipo) {
  const alvo = normalizarSlug(tipo);
  if (!alvo) return 0;
  return (await listarPecas())
    .filter(p => !['Arquivado', 'Obsoleto'].includes(p.status))
    .filter(p => pecaAtendeTipo(p, alvo)).length;
}

/** Ficha completa (peça + métricas + pontos + documentos + histórico + versões). */
export async function ficha(pecaId) {
  const peca = await db.get('bib_pecas', pecaId);
  if (!peca) return null;
  const [metricas, pontos, documentos, historico, versoes] = await Promise.all([
    db.list('bib_metricas',        { filter: { peca_id: pecaId } }),
    db.list('bib_pontos_inspecao', { filter: { peca_id: pecaId } }),
    db.list('bib_documentos',      { filter: { peca_id: pecaId } }),
    db.list('bib_historico',       { filter: { peca_id: pecaId } }),
    db.list('bib_versoes',         { filter: { peca_id: pecaId } })
  ]);
  const ord = (a, b) => (a.ordem || 0) - (b.ordem || 0);
  return {
    peca,
    metricas: metricas.sort(ord),
    pontos: pontos.sort(ord),
    documentos,
    historico: historico.sort((a, b) => String(b.quando).localeCompare(String(a.quando))),
    versoes: versoes.sort((a, b) => (b.revisao || 0) - (a.revisao || 0))
  };
}

/** Peça pelo ID oficial da Biblioteca — leitura leve (sem métricas/documentos).
    Usado pela Auditoria para reexibir a peça vinculada ao reabrir o relatório. */
export async function porId(pecaId) {
  if (!pecaId) return null;
  return db.get('bib_pecas', pecaId);
}

export async function porCodigo(codigo) {
  const alvo = normaliza(codigo);
  const pecas = await db.list('bib_pecas');
  return pecas.find(p => normaliza(p.codigo) === alvo) || null;
}

/* ------------------------------------------ tipos de especificação / cálculo
   Motor único do "cadastro inteligente": a partir do tipo e dos campos digitados,
   calcula tol_min/tol_max (fonte usada por Auditoria, Relatório, indicadores).
   Compartilhado por editor (preview em tempo real) e salvamento. */
export const SPEC_TIPOS = ['MAX_MIN','ATRIBUTO','UNID_MAX','UNID_MIN','REFERENCIA','TOLERANCIA'];
export function ehInformativo(tipo) { return tipo === 'REFERENCIA'; }
export function ehAtributo(tipo)    { return tipo === 'ATRIBUTO'; }
function round(n) { return Math.round(n * 1e6) / 1e6; }

/** Calcula { tol_min, tol_max } a partir do tipo e dos campos do editor.
    `simetrica` (bool) indica uso do ± (tol_simetrica) no modo TOLERANCIA. */
export function calcularLimites(spec = {}) {
  const tipo = spec.tipo_especificacao || 'TOLERANCIA';
  const nom = num(spec.nominal);
  const c = v => (v === '' || v == null ? null : num(v));
  switch (tipo) {
    case 'MAX_MIN':    return { tol_min: c(spec.tol_min), tol_max: c(spec.tol_max) };
    case 'UNID_MAX':   return { tol_min: null,            tol_max: c(spec.tol_max) };
    case 'UNID_MIN':   return { tol_min: c(spec.tol_min), tol_max: null };
    case 'ATRIBUTO':
    case 'REFERENCIA': return { tol_min: null, tol_max: null };
    case 'TOLERANCIA':
    default: {
      if (spec.simetrica) {
        const p = c(spec.tol_simetrica);
        if (nom == null || p == null) return { tol_min: null, tol_max: null };
        const a = Math.abs(p);
        return { tol_min: round(nom - a), tol_max: round(nom + a) };
      }
      const sup = c(spec.superior), inf = c(spec.inferior);
      return {
        tol_min: (nom != null && inf != null) ? round(nom + inf) : null,
        tol_max: (nom != null && sup != null) ? round(nom + sup) : null
      };
    }
  }
}

/* ---------------------------------------------------------- tolerância ----- */
/** true se o valor nominal está fora da faixa de tolerância (ou faixa inválida).
    Só se aplica a especificações dimensionais com nominal (TOLERANCIA/…). */
export function foraDePadrao(m) {
  if (ehInformativo(m.tipo_especificacao) || ehAtributo(m.tipo_especificacao)) return false;
  const nom = num(m.nominal), min = num(m.tol_min), max = num(m.tol_max);
  if (nom == null) return false;
  if (min != null && max != null && min > max) return true;           // faixa invertida
  if (min != null && nom < min) return true;
  if (max != null && nom > max) return true;
  return false;
}
function num(v) {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

/* ----------------------------------------------------------- favoritos ----- */
export async function favoritosDe(userId) {
  const favs = await db.list('bib_favoritos', { filter: { usuario: userId } });
  return favs.map(f => f.peca_id);
}
export async function ehFavorito(userId, pecaId) {
  return (await favoritosDe(userId)).includes(pecaId);
}
export async function alternarFavorito(userId, pecaId) {
  const favs = await db.list('bib_favoritos', { filter: { usuario: userId } });
  const existente = favs.find(f => f.peca_id === pecaId);
  if (existente) { await db.remove('bib_favoritos', existente.id); return false; }
  await db.insert('bib_favoritos', { usuario: userId, peca_id: pecaId, quando: nowISO() });
  return true;
}

/* ------------------------------------------------------------- recentes ---- */
/* Recentes ficam por usuário no localStorage (rápido, por dispositivo). */
const RECENTES_MAX = 12;
function recentesKey(userId) { return `rna_bib_recentes_${userId || 'anon'}`; }
export function recentesIds(userId) {
  try { return JSON.parse(localStorage.getItem(recentesKey(userId)) || '[]'); } catch { return []; }
}
export function registrarRecente(userId, pecaId) {
  const ids = recentesIds(userId).filter(id => id !== pecaId);
  ids.unshift(pecaId);
  localStorage.setItem(recentesKey(userId), JSON.stringify(ids.slice(0, RECENTES_MAX)));
}

/* --------------------------------------------------------- versionamento --- */
/* Campos da peça acompanhados no diff do histórico (apenas informações da peça). */
const CAMPOS_HIST = ['codigo','nome','cliente','familia','status','planta','revisao_desenho','data_revisao_desenho','numero_ad','tipos_inspecao'];

/** Diferença campo-a-campo entre a peça antes e depois (para o histórico). */
export function diffPeca(antes, depois) {
  const mudancas = [];
  for (const campo of CAMPOS_HIST) {
    const a = antes?.[campo] ?? '', b = depois?.[campo] ?? '';
    if (String(a) !== String(b)) mudancas.push({ campo, antes: a === '' ? '—' : a, depois: b === '' ? '—' : b });
  }
  return mudancas;
}

/**
 * Salva edição de uma peça criando nova revisão:
 *  - grava snapshot da versão anterior em bib_versoes
 *  - registra cada campo alterado em bib_historico (append-only)
 *  - incrementa a revisão e atualiza a peça
 * Retorna a peça atualizada.
 */
export async function salvarRevisao(pecaId, patch, usuario) {
  const antes = await db.get('bib_pecas', pecaId);
  if (!antes) throw new Error('Peça não encontrada');
  // §3 — a obrigatoriedade também é garantida na camada de serviço, não só no
  // formulário: nenhum caminho de gravação deixa a peça sem vínculo.
  if ('tipos_inspecao' in patch) {
    const erro = validarTiposInspecaoInterno(patch.tipos_inspecao);
    if (erro) throw new Error(erro);
    patch = { ...patch, tipos_inspecao: normalizarParaGravarInterno(patch.tipos_inspecao) };
  }
  const mudancas = diffPeca(antes, patch);
  const novaRev = (antes.revisao || 1) + 1;

  // revisao (compat) e revisao_cadastro (novo nome explícito) caminham juntas.
  const payload = { ...patch, revisao: novaRev, revisao_cadastro: novaRev, updated_at: hoje() };
  let degradado = false;
  const gravar = async () => {
    if (_semColunaTipos) { degradado = true; return db.update('bib_pecas', pecaId, semTipos(payload)); }
    try { return await db.update('bib_pecas', pecaId, payload); }
    catch (e) {
      if (!ehErroDeColuna(e)) throw e;
      avisarColunaAusente(e); degradado = true;
      return db.update('bib_pecas', pecaId, semTipos(payload));
    }
  };

  /* O snapshot da versão anterior e a trilha do histórico não dependem do
     resultado do UPDATE (usam `antes`/`mudancas`, já em memória). Rodavam em
     série, somando um round-trip por campo alterado ao tempo de salvamento —
     agora vão junto com a gravação. A peça só é dada como salva se o UPDATE
     concluir: `Promise.all` rejeita com o primeiro erro. */
  const trilha = [
    // snapshot da versão ANTERIOR (permite “restaurar”)
    db.insert('bib_versoes', {
      peca_id: pecaId, revisao: antes.revisao || 1, snapshot: antes,
      usuario: usuario?.nome || 'Sistema', quando: nowISO(),
      resumo: mudancas.length ? `${mudancas.length} campo(s) alterado(s)` : 'Revisão salva'
    }),
    ...mudancas.map(m => db.insert('bib_historico', {
      peca_id: pecaId, usuario: usuario?.nome || 'Sistema', quando: nowISO(),
      acao: 'Editou', campo: m.campo, antes: m.antes, depois: m.depois, revisao: novaRev
    }))
  ];
  if (!mudancas.length) {
    trilha.push(db.insert('bib_historico', {
      peca_id: pecaId, usuario: usuario?.nome || 'Sistema', quando: nowISO(),
      acao: 'Revisão', campo: '—', antes: '—', depois: `Rev ${String(novaRev).padStart(2,'0')}`, revisao: novaRev
    }));
  }
  const [atualizado] = await Promise.all([gravar(), ...trilha]);
  return degradado ? { ...atualizado, tipos_nao_gravados: true } : atualizado;
}

/** Registra a criação de uma peça no histórico. */
export async function registrarCriacao(pecaId, usuario) {
  await db.insert('bib_historico', {
    peca_id: pecaId, usuario: usuario?.nome || 'Sistema', quando: nowISO(),
    acao: 'Criou', campo: '—', antes: '—', depois: 'Cadastro inicial', revisao: 1
  });
}

/** Restaura uma peça a partir do snapshot de uma versão anterior. */
export async function restaurarVersao(pecaId, versaoId, usuario) {
  const versao = await db.get('bib_versoes', versaoId);
  if (!versao?.snapshot) throw new Error('Versão inválida');
  const snap = { ...versao.snapshot };
  delete snap.id;                                   // não sobrescreve o id atual
  return salvarRevisao(pecaId, { ...snap, status: snap.status || 'Ativo' }, usuario);
}

/* ------------------------------------------------------ duplicar/arquivar -- */
export async function duplicar(pecaId, usuario) {
  const f = await ficha(pecaId);
  if (!f) throw new Error('Peça não encontrada');
  const { id, ...base } = f.peca;
  const nova = await db.insert('bib_pecas', {
    ...base,
    codigo: `${base.codigo}-COPIA`,
    nome: `${base.nome} (cópia)`,
    status: 'Em revisão', revisao: 1, ativo: true,
    created_at: hoje(), updated_at: hoje(), created_by: usuario?.id || null
  });
  for (const m of f.metricas) { const { id:_i, peca_id:_p, ...r } = m; await db.insert('bib_metricas', { ...r, peca_id: nova.id }); }
  for (const p of f.pontos)   { const { id:_i, peca_id:_p, ...r } = p; await db.insert('bib_pontos_inspecao', { ...r, peca_id: nova.id }); }
  await registrarCriacao(nova.id, usuario);
  return nova;
}

export async function arquivar(pecaId, usuario) {
  const p = await db.update('bib_pecas', pecaId, { status: 'Arquivado', ativo: false, updated_at: hoje() });
  await db.insert('bib_historico', { peca_id: pecaId, usuario: usuario?.nome || 'Sistema', quando: nowISO(), acao: 'Arquivou', campo: 'status', antes: '—', depois: 'Arquivado', revisao: p?.revisao || 1 });
  return p;
}
export async function restaurar(pecaId, usuario) {
  const p = await db.update('bib_pecas', pecaId, { status: 'Ativo', ativo: true, updated_at: hoje() });
  await db.insert('bib_historico', { peca_id: pecaId, usuario: usuario?.nome || 'Sistema', quando: nowISO(), acao: 'Restaurou', campo: 'status', antes: 'Arquivado', depois: 'Ativo', revisao: p?.revisao || 1 });
  return p;
}

/* ------------------------------------------------------------ dashboard ---- */
export async function indicadores() {
  const [pecas, metricas, pontos, documentos, versoes, historico] = await Promise.all([
    db.list('bib_pecas'), db.list('bib_metricas'), db.list('bib_pontos_inspecao'),
    db.list('bib_documentos'), db.list('bib_versoes'), db.list('bib_historico')
  ]);
  const ativas = pecas.filter(p => p.ativo !== false);
  const revisoesTotais = pecas.reduce((s, p) => s + (p.revisao || 1), 0);
  return {
    totalPecas: ativas.length,
    clientes: new Set(ativas.map(p => p.cliente).filter(Boolean)).size,
    familias: new Set(ativas.map(p => p.familia).filter(Boolean)).size,
    documentos: documentos.length,
    metricas: metricas.length,
    pontos: pontos.length,
    revisoes: revisoesTotais,
    porCliente: contar(ativas, 'cliente'),
    porPlanta:  contar(ativas, 'planta'),
    porFamilia: contar(ativas, 'familia'),
    porStatus:  contar(pecas, 'status'),
    ultimosCadastros: [...pecas].sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,6),
    ultimasAlteracoes: [...historico].sort((a,b)=>String(b.quando).localeCompare(String(a.quando))).slice(0,8)
  };
}
function contar(rows, campo) {
  const m = {};
  rows.forEach(r => { const k = r[campo] || '—'; m[k] = (m[k] || 0) + 1; });
  return m;
}

/* --------------------------------------------------------------- QR / URL -- */
/** URL absoluta da ficha por código — destino do QR e do gancho da Auditoria. */
export function urlDaFicha(codigo) {
  const base = location.href.split('?')[0].replace(/[^/]*$/, '');
  return `${base}biblioteca.html?codigo=${encodeURIComponent(codigo)}`;
}
export function qrPayload(peca) { return urlDaFicha(peca?.codigo || ''); }

/* -------------------------------------------------- catálogos de especificação
   Característica / Equipamento de Medição / Quem Mede — com mapas id→nome. */
export async function catalogosEspec() {
  const [car, eq, qm] = await Promise.all([
    db.list('caracteristicas_ml').catch(() => []),
    db.list('equipamentos_medicao').catch(() => []),
    db.list('quem_mede').catch(() => [])
  ]);
  const ativos = arr => arr.filter(x => x.ativo !== false).sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  const map = arr => Object.fromEntries(arr.map(x => [x.id, x.nome]));
  return { car: ativos(car), eq: ativos(eq), qm: ativos(qm), carMap: map(car), eqMap: map(eq), qmMap: map(qm) };
}

/* ---------------------------------------------------------------- utils ---- */
export function nowISO() { return new Date().toISOString(); }
export function hoje() { return new Date().toISOString().slice(0, 10); }
