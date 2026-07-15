/* ==========================================================================
   RNA One — Biblioteca Técnica (regra de domínio)
   Busca instantânea, filtros, tolerância, favoritos, recentes, versionamento
   e agregações do dashboard. Toda a persistência passa pela camada db.js
   (funciona em modo demo ou Supabase sem alteração).
   ========================================================================== */
import { db } from './db.js';

/* Campos da peça indexados pela busca “estilo Google”.
   (Reestruturação: material/norma/especificacao/observacoes/quadrante saíram da
   peça — quadrante agora é por especificação.) */
const CAMPOS_BUSCA = ['codigo','nome','cliente','familia','planta','numero_ad'];

/* Remove acentos e baixa a caixa para busca tolerante. */
export function normaliza(txt) {
  return String(txt ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
}

/* ------------------------------------------------------------- consultas --- */
/** Todas as peças; por padrão oculta arquivadas (ativo=false). */
export async function listarPecas({ incluirArquivadas = false } = {}) {
  const pecas = await db.list('bib_pecas');
  const ativas = incluirArquivadas ? pecas : pecas.filter(p => p.ativo !== false);
  return ativas.sort((a, b) => normaliza(a.codigo).localeCompare(normaliza(b.codigo)));
}

/** Busca textual + filtros. `q` casa em qualquer CAMPOS_BUSCA. */
export async function buscar(q = '', filtros = {}, opts = {}) {
  const termo = normaliza(q);
  let pecas = await listarPecas(opts);
  if (termo) {
    pecas = pecas.filter(p => CAMPOS_BUSCA.some(c => normaliza(p[c]).includes(termo)));
  }
  for (const [campo, valor] of Object.entries(filtros)) {
    if (!valor) continue;
    pecas = pecas.filter(p => p[campo] === valor);
  }
  return pecas;
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
const CAMPOS_HIST = ['codigo','nome','cliente','familia','status','planta','revisao_desenho','data_revisao_desenho','numero_ad'];

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
  const mudancas = diffPeca(antes, patch);
  const novaRev = (antes.revisao || 1) + 1;

  // snapshot da versão ANTERIOR (permite “restaurar”)
  await db.insert('bib_versoes', {
    peca_id: pecaId, revisao: antes.revisao || 1, snapshot: antes,
    usuario: usuario?.nome || 'Sistema', quando: nowISO(),
    resumo: mudancas.length ? `${mudancas.length} campo(s) alterado(s)` : 'Revisão salva'
  });

  // revisao (compat) e revisao_cadastro (novo nome explícito) caminham juntas.
  const atualizado = await db.update('bib_pecas', pecaId, {
    ...patch, revisao: novaRev, revisao_cadastro: novaRev, updated_at: hoje()
  });

  for (const m of mudancas) {
    await db.insert('bib_historico', {
      peca_id: pecaId, usuario: usuario?.nome || 'Sistema', quando: nowISO(),
      acao: 'Editou', campo: m.campo, antes: m.antes, depois: m.depois, revisao: novaRev
    });
  }
  if (!mudancas.length) {
    await db.insert('bib_historico', {
      peca_id: pecaId, usuario: usuario?.nome || 'Sistema', quando: nowISO(),
      acao: 'Revisão', campo: '—', antes: '—', depois: `Rev ${String(novaRev).padStart(2,'0')}`, revisao: novaRev
    });
  }
  return atualizado;
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
