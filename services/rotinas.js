/* ==========================================================================
   RNA One — Motor de Rotinas Inteligentes (Gestão Operacional · Minhas Rotinas)
   ---------------------------------------------------------------------------
   Responsabilidades (regra de negócio pura + acesso via db.js):
     • catálogos de tipo de resposta, tipo de validação e frequência por item
     • avaliação automática Conforme / Não Conforme (única fonte da verdade)
     • frequência POR ITEM (o item pode não vencer no dia da rotina)
     • regra condicional (ex.: Scania × Demais clientes)
     • snapshot da configuração no momento da execução (§versionamento)
   Nenhum modelo fica fixo aqui: tudo vem das tabelas op_* (demo ou Supabase).
   O auditor nunca escolhe o resultado — ele é derivado das funções abaixo.
   ========================================================================== */
import { db } from './db.js';
import { fmtMedida } from './formato.js';

/* ============================================================ TIPOS DE RESPOSTA
   `numerico` = participa de validação por faixa. `texto_livre` = informativo. */
export const TIPOS_RESPOSTA = [
  { slug: 'inteiro',      nome: 'Número inteiro',        numerico: true },
  { slug: 'decimal',      nome: 'Número decimal',        numerico: true },
  { slug: 'texto',        nome: 'Texto curto' },
  { slug: 'texto_longo',  nome: 'Texto longo' },
  { slug: 'data',         nome: 'Data' },
  { slug: 'hora',         nome: 'Hora' },
  { slug: 'sim_nao',      nome: 'Sim / Não',             opcoes: ['Sim', 'Não'] },
  { slug: 'conforme_nc',  nome: 'Conforme / Não Conforme', opcoes: ['Conforme', 'Não Conforme'] },
  { slug: 'lista',        nome: 'Lista de seleção',      listavel: true },
  { slug: 'codigo',       nome: 'Código / identificação' },
  { slug: 'foto',         nome: 'Foto' },
  { slug: 'anexo',        nome: 'Anexo' },
  { slug: 'assinatura',   nome: 'Assinatura' }
];
export const TIPOS_RESPOSTA_MAP = Object.fromEntries(TIPOS_RESPOSTA.map(t => [t.slug, t]));
export const ehNumerico = slug => !!TIPOS_RESPOSTA_MAP[slug]?.numerico;

/* ============================================================ TIPOS DE VALIDAÇÃO
   `campos` = o que o admin precisa preencher (usado pela validação do cadastro). */
export const TIPOS_VALIDACAO = [
  { slug: 'intervalo',     nome: 'Intervalo (mín. e máx.)', campos: ['limite_min', 'limite_max'], numerico: true },
  { slug: 'minimo',        nome: 'Apenas mínimo',           campos: ['limite_min'],              numerico: true },
  { slug: 'maximo',        nome: 'Apenas máximo',           campos: ['limite_max'],              numerico: true },
  { slug: 'exato',         nome: 'Valor exato',             campos: ['valor_esperado'] },
  { slug: 'texto',         nome: 'Texto informativo',       campos: [], informativo: true },
  { slug: 'conforme_nc',   nome: 'Conforme / Não Conforme (manual)', campos: [] },
  { slug: 'sem_validacao', nome: 'Sem validação',           campos: [], informativo: true }
];
export const TIPOS_VALIDACAO_MAP = Object.fromEntries(TIPOS_VALIDACAO.map(t => [t.slug, t]));

/* ================================================================ FREQUÊNCIAS
   Frequência POR ITEM — não herda automaticamente a da rotina (§18). */
export const FREQUENCIAS_ITEM = [
  { slug: 'diario',          nome: 'Diário' },
  { slug: 'semanal',         nome: 'Semanal' },
  { slug: 'uma_vez_semana',  nome: 'Uma vez por semana' },
  { slug: 'mensal',          nome: 'Mensal' },
  { slug: 'por_turno',       nome: 'Por turno' },
  { slug: 'por_lote',        nome: 'Por lote' },
  { slug: 'por_op',          nome: 'Por OP' },
  { slug: 'sob_demanda',     nome: 'Sob demanda' },
  { slug: 'personalizada',   nome: 'Personalizada' }
];
export const FREQUENCIAS_ITEM_MAP = Object.fromEntries(FREQUENCIAS_ITEM.map(f => [f.slug, f]));

/* Resultados possíveis de um item (§16). */
export const RESULTADOS = {
  conforme:      { label: 'Conforme',                badge: 'badge-ok',   icon: 'bi-check-circle-fill' },
  nao_conforme:  { label: 'Não Conforme',            badge: 'badge-crit', icon: 'bi-x-circle-fill' },
  pendente:      { label: 'Aguardando preenchimento', badge: 'badge-pend', icon: 'bi-hourglass-split' },
  nao_aplicavel: { label: 'Não aplicável',           badge: 'badge-na',   icon: 'bi-slash-circle' },
  sem_validacao: { label: 'Sem validação',           badge: 'badge-info', icon: 'bi-info-circle' }
};

/* Status da execução (§21). */
export const STATUS_EXEC = {
  pendente:       { label: 'Não iniciada',                  badge: 'badge-na' },
  em_andamento:   { label: 'Em andamento',                  badge: 'badge-info' },
  rascunho:       { label: 'Salva como rascunho',           badge: 'badge-warn' },
  aguardando:     { label: 'Aguardando correção',           badge: 'badge-pend' },
  concluida:      { label: 'Finalizada',                    badge: 'badge-ok' },
  concluida_nc:   { label: 'Finalizada com não conformidade', badge: 'badge-crit' },
  nao_aplicavel:  { label: 'Não aplicável',                 badge: 'badge-na' },
  cancelada:      { label: 'Cancelada',                     badge: 'badge-na' }
};

/* ==================================================================== NÚMEROS
   Aceita vírgula e ponto; NUNCA compara número como texto (§26). */
export function num(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return Number.isNaN(v) ? null : v;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  if (!/^-?\d*\.?\d+$/.test(s)) return null;
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}
/** Exibe número no padrão pt-BR 00,00 (§M07 — delega à fonte única). */
export function fmtNum(v) {
  return fmtMedida(v);
}

/* ========================================================= ESPECIFICAÇÃO (texto)
   Texto exibido ao auditor. Usa o especificacao_texto do cadastro quando houver;
   senão deriva da regra + limites, para nunca mostrar campo vazio. */
export function especificacaoTexto(item) {
  if (item?.especificacao_texto) return item.especificacao_texto;
  const u = item?.unidade_simbolo || item?.unidade || '';
  const un = u ? ` ${u}` : '';
  const min = fmtNum(item?.limite_min), max = fmtNum(item?.limite_max);
  switch (item?.tipo_validacao) {
    case 'intervalo': return `${min} a ${max}${un}`;
    case 'minimo':    return `Mínimo ${min}${un}`;
    case 'maximo':    return `Máximo ${max}${un}`;
    case 'exato':     return `Igual a ${item.valor_esperado ?? '—'}${un}`;
    case 'conforme_nc': return 'Conforme / Não Conforme';
    default: return item?.unidade || '—';
  }
}

/* ============================================================ AVALIAÇÃO (§15-16)
   ÚNICA fonte do resultado. Retorna:
   'conforme' | 'nao_conforme' | 'pendente' | 'sem_validacao'
   O chamador aplica 'nao_aplicavel' quando o item não vence hoje / não se aplica. */
export function avaliarItem(item, valor) {
  const tipo = item?.tipo_validacao || 'sem_validacao';
  const vazio = valor == null || String(valor).trim() === '';

  // Informativos nunca reprovam (Produto, Lâmina, Lote, OP, código Pipefy...)
  if (tipo === 'texto' || tipo === 'sem_validacao') {
    if (vazio && item?.obrigatorio) return 'pendente';
    return 'sem_validacao';
  }
  if (vazio) return 'pendente';

  if (tipo === 'conforme_nc') {
    const s = String(valor).trim().toLowerCase();
    if (['conforme', 'ok', 'sim'].includes(s)) return 'conforme';
    if (['não conforme', 'nao conforme', 'nok', 'não', 'nao'].includes(s)) return 'nao_conforme';
    return 'pendente';
  }
  if (tipo === 'exato') {
    const esp = String(item.valor_esperado ?? '').trim();
    const a = num(valor), b = num(esp);
    // compara numericamente quando ambos são números (evita "10" ≠ "10,0")
    if (a != null && b != null) return a === b ? 'conforme' : 'nao_conforme';
    return String(valor).trim().toLowerCase() === esp.toLowerCase() ? 'conforme' : 'nao_conforme';
  }

  const v = num(valor);
  if (v == null) return 'pendente';                       // texto em campo numérico
  const min = num(item.limite_min), max = num(item.limite_max);
  switch (tipo) {
    case 'intervalo':
      if (min == null || max == null) return 'sem_validacao';   // cadastro incompleto
      return v >= min && v <= max ? 'conforme' : 'nao_conforme';
    case 'minimo':
      if (min == null) return 'sem_validacao';
      return v >= min ? 'conforme' : 'nao_conforme';
    case 'maximo':
      if (max == null) return 'sem_validacao';
      return v <= max ? 'conforme' : 'nao_conforme';
    default:
      return 'sem_validacao';
  }
}

/* ===================================================== FREQUÊNCIA POR ITEM (§18)
   O item vence na data? `ctx` = { data:'YYYY-MM-DD', primeiroDaSemana, ... }.
   Regra prática de chão de fábrica: itens semanais vencem na segunda-feira;
   mensais no dia 1. Itens por lote/OP/turno vencem em toda execução. */
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export function itemVenceHoje(item, dataISO) {
  const freq = item?.frequencia_item || 'diario';
  const d = new Date((dataISO || hoje()) + 'T12:00:00');
  switch (freq) {
    case 'diario':
    case 'por_turno':
    case 'por_lote':
    case 'por_op':
    case 'personalizada': return true;
    case 'semanal':
    case 'uma_vez_semana': return DIAS[d.getDay()] === 'Seg';
    case 'mensal':         return d.getDate() === 1;
    case 'sob_demanda':    return false;
    default:               return true;
  }
}

/* ===================================================== REGRA CONDICIONAL (§19)
   regra_condicional = { campo:'tipo_cliente', igual:'scania' } → o item só
   aparece quando o contexto casa. Sem regra = sempre visível.
   Estrutura genérica: novos campos condicionais entram sem alterar o motor. */
export function itemVisivel(item, contexto = {}) {
  const r = item?.regra_condicional;
  if (!r || !r.campo) return true;
  const atual = String(contexto[r.campo] ?? '').trim().toLowerCase();
  if (!atual) return false;                                // contexto ainda não informado
  if (r.igual != null)    return atual === String(r.igual).toLowerCase();
  if (r.diferente != null) return atual !== String(r.diferente).toLowerCase();
  if (Array.isArray(r.em)) return r.em.map(x => String(x).toLowerCase()).includes(atual);
  return true;
}

/** Item entra na execução de hoje? (visível pelo contexto E vencido na data) */
export function itemAplicavel(item, contexto = {}, dataISO) {
  if (item?.ativo === false) return false;
  return itemVisivel(item, contexto) && itemVenceHoje(item, dataISO);
}

/* ======================================================= SNAPSHOT (§23)
   Congela a configuração no momento da execução: alterar o modelo depois NÃO
   muda o histórico. Gravado em op_execucao_itens.*_snapshot. */
export function snapshotItem(item) {
  return {
    nome_snapshot:          item.nome || '',
    unidade_snapshot:       item.unidade_simbolo || item.unidade || '',
    especificacao_snapshot: especificacaoTexto(item),
    minimo_snapshot:        item.limite_min ?? null,
    maximo_snapshot:        item.limite_max ?? null,
    validacao_snapshot:     item.tipo_validacao || 'sem_validacao',
    frequencia_snapshot:    item.frequencia_item || 'diario'
  };
}

/** Reconstrói um "item" a partir do snapshot gravado — usado para reavaliar/exibir
    execuções antigas com as regras vigentes NAQUELE momento. */
export function itemDoSnapshot(row) {
  return {
    nome: row.nome_snapshot, unidade: row.unidade_snapshot,
    especificacao_texto: row.especificacao_snapshot,
    limite_min: row.minimo_snapshot, limite_max: row.maximo_snapshot,
    tipo_validacao: row.validacao_snapshot, frequencia_item: row.frequencia_snapshot
  };
}

/* ================================================== VALIDAÇÃO DO CADASTRO (§26)
   Impede modelo/item inconsistente ANTES de salvar. Retorna array de erros. */
export function validarItemCadastro(item) {
  const erros = [];
  if (!String(item?.nome || '').trim()) erros.push('Informe o nome do item.');
  const tv = item?.tipo_validacao || 'sem_validacao';
  const min = num(item?.limite_min), max = num(item?.limite_max);
  if (tv === 'intervalo') {
    if (min == null) erros.push(`“${item.nome}”: informe o valor mínimo.`);
    if (max == null) erros.push(`“${item.nome}”: informe o valor máximo.`);
  }
  if (tv === 'minimo' && min == null) erros.push(`“${item.nome}”: validação por mínimo exige o valor mínimo.`);
  if (tv === 'maximo' && max == null) erros.push(`“${item.nome}”: validação por máximo exige o valor máximo.`);
  if (tv === 'exato' && !String(item?.valor_esperado ?? '').trim()) erros.push(`“${item.nome}”: informe o valor esperado.`);
  if (min != null && max != null && min > max) erros.push(`“${item.nome}”: o mínimo (${fmtNum(min)}) não pode ser maior que o máximo (${fmtNum(max)}).`);
  if (TIPOS_VALIDACAO_MAP[tv]?.numerico && !ehNumerico(item?.tipo_resposta)) {
    erros.push(`“${item.nome}”: validação numérica exige tipo de resposta numérico.`);
  }
  if (item?.tipo_resposta === 'lista' && !(item?.opcoes || []).length) {
    erros.push(`“${item.nome}”: informe as opções da lista.`);
  }
  return erros;
}

export function validarModeloCadastro(modelo, itens) {
  const erros = [];
  if (!String(modelo?.nome || '').trim()) erros.push('Informe o nome do modelo.');
  if (!String(modelo?.codigo || '').trim()) erros.push('Informe o código do modelo.');
  if (!itens?.length) erros.push('Adicione ao menos um item.');
  itens?.forEach(it => erros.push(...validarItemCadastro(it)));
  return erros;
}

/* ==================================================================== DADOS
   Modelos = op_atividades (tipo rotina) marcados como is_template.
   Rotinas = op_atividades normais que referenciam o modelo (modelo_id). */
export const ehModelo = a => !!a?.is_template && a?.tipo_slug === 'rotina';

export async function listarModelos({ incluirInativos = false } = {}) {
  const rows = (await db.list('op_atividades')).filter(ehModelo);
  const out = incluirInativos ? rows : rows.filter(m => m.status !== 'arquivada');
  return out.sort((a, b) => String(a.codigo || a.nome).localeCompare(String(b.codigo || b.nome)));
}

export async function modelo(id) {
  const m = await db.get('op_atividades', id);
  return ehModelo(m) ? m : null;
}
export async function modeloPorCodigo(codigo) {
  const alvo = String(codigo || '').trim().toUpperCase();
  return (await db.list('op_atividades')).find(a => ehModelo(a) && String(a.codigo || '').toUpperCase() === alvo) || null;
}

/** Itens ATIVOS de um modelo/rotina, na ordem de exibição. */
export async function itensDoModelo(atividadeId) {
  const rows = await db.list('op_atividade_itens', { filter: { atividade_id: atividadeId } });
  return rows.filter(i => i.ativo !== false).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
}

/** Busca pesquisável de modelos (§3) — por nome, código ou categoria. */
export async function buscarModelos(q = '') {
  const termo = String(q || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
  const mods = await listarModelos();
  if (!termo) return mods;
  const norm = s => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  return mods.filter(m => [m.nome, m.codigo, m.categoria, m.descricao].some(c => norm(c).includes(termo)));
}

/* ============================================ INSTALAR MODELOS PADRÃO (§29)
   Idempotente: confere pelo CÓDIGO antes de inserir. Nunca duplica e nunca
   sobrescreve um modelo que o administrador já ajustou. Retorna os códigos
   criados agora ([] = nada a fazer). Exige perfil com escrita em gestao_op. */
export async function garantirModelosPadrao(user) {
  const { MODELOS_PADRAO } = await import('./rotinas-modelos.js');
  const existentes = new Set(
    (await db.list('op_atividades')).filter(ehModelo).map(m => String(m.codigo || '').toUpperCase())
  );
  const criados = [];
  for (const m of MODELOS_PADRAO) {
    if (existentes.has(m.codigo.toUpperCase())) continue;      // já instalado
    const ativ = await db.insert('op_atividades', {
      tipo_slug: 'rotina', is_template: true, codigo: m.codigo, nome: m.nome,
      descricao: m.descricao, categoria: m.categoria, frequencia: m.frequencia, horario: m.horario || '',
      planta: '', setor: '', turno: '', responsavel: 'todos',
      exec_observacao: 'opcional', exec_foto: 'opcional', permite_na: true,
      obrigatoria: true, status: 'publicada', versao: 1, anexos: [],
      created_by: user?.id || 'sistema', created_at: hoje(), updated_at: hoje()
    });
    let ordem = 1;
    for (const it of m.itens) {
      await db.insert('op_atividade_itens', { atividade_id: ativ.id, ordem: ordem++, ...it });
    }
    criados.push(m.codigo);
  }
  return criados;
}

/* ============================================ VERSIONAMENTO DO MODELO (§23)
   Alterar um modelo já executado não pode reescrever o histórico. As execuções
   guardam snapshot + modelo_versao; aqui apenas incrementamos a versão quando o
   admin publica uma alteração estrutural. */
export async function novaVersaoModelo(modeloId, user) {
  const m = await modelo(modeloId);
  if (!m) throw new Error('Modelo não encontrado.');
  return db.update('op_atividades', modeloId, {
    versao: (m.versao || 1) + 1, updated_at: hoje(), updated_by: user?.id || null
  });
}

/** Duplica um modelo com todos os itens (§22). */
export async function duplicarModelo(modeloId, user) {
  const m = await modelo(modeloId);
  if (!m) throw new Error('Modelo não encontrado.');
  const { id: _drop, ...base } = m;
  const codigo = await codigoLivre(`${m.codigo || 'MOD'}_COPIA`);
  const novo = await db.insert('op_atividades', {
    ...base, codigo, nome: `${m.nome} (cópia)`, status: 'rascunho', versao: 1,
    created_by: user?.id || null, created_at: hoje(), updated_at: hoje()
  });
  for (const it of await itensDoModelo(modeloId)) {
    const { id: _i, atividade_id: _a, ...resto } = it;
    await db.insert('op_atividade_itens', { ...resto, atividade_id: novo.id });
  }
  return novo;
}

/** Garante código único entre os modelos (§29 — códigos únicos). */
export async function codigoLivre(base) {
  const usados = new Set((await db.list('op_atividades')).filter(ehModelo).map(m => String(m.codigo || '').toUpperCase()));
  let c = String(base || 'MOD').toUpperCase();
  if (!usados.has(c)) return c;
  let i = 2;
  while (usados.has(`${c}_${i}`)) i++;
  return `${c}_${i}`;
}

/* ================================================ ITENS EFETIVOS DA ROTINA
   A rotina REFERENCIA o modelo (modelo_id) — os itens vêm sempre do modelo
   publicado; o histórico fica protegido pelo snapshot gravado na execução.
   Rotina sem modelo = legada (ação única / itens próprios), continua válida. */
export async function itensDaRotina(atividade) {
  if (!atividade) return [];
  if (atividade.modelo_id) return itensDoModelo(atividade.modelo_id);
  return itensDoModelo(atividade.id);
}

/* ================================================= EXECUÇÃO (Minhas Rotinas)
   O resultado de cada item é SEMPRE derivado por avaliarItem() — o auditor
   nunca escolhe "conforme". Cada gravação carrega o snapshot da configuração. */
export async function resultadosDe(execId) {
  return db.list('op_execucao_itens', { filter: { execucao_id: execId } });
}

/** Grava/atualiza o resultado de UM item (idempotente: 1 linha por item). */
export async function salvarResultado(execId, item, { valor, obs, foto }, user) {
  const existentes = await db.list('op_execucao_itens', { filter: { execucao_id: execId } });
  const ex = existentes.find(r => r.item_id === item.id);
  const numerico = ehNumerico(item.tipo_resposta);
  const resultado = avaliarItem(item, valor);
  const payload = {
    execucao_id: execId, item_id: item.id, ordem: item.ordem ?? 0,
    ...snapshotItem(item),
    valor:       numerico ? String(valor ?? '') : '',
    valor_texto: numerico ? '' : String(valor ?? ''),
    resultado,
    ok: resultado === 'conforme' || resultado === 'sem_validacao',
    status: resultado === 'nao_conforme' ? 'fora' : 'ok',    // compat com o legado
    obs: obs ?? '', foto: foto ?? null,
    concluido_em: nowISO(), concluido_por: user?.id || null
  };
  return ex ? db.update('op_execucao_itens', ex.id, payload) : db.insert('op_execucao_itens', payload);
}

/** Valor informado de um item (numérico ou texto), a partir da linha salva. */
export const valorDe = row => (row?.valor_texto ? row.valor_texto : (row?.valor ?? ''));

/* Regras de bloqueio da finalização (§17, §26). `valores` = { itemId: {valor,obs,temFoto} } */
export function validarFinalizacao(itensAplicaveis, valores = {}) {
  const faltas = [];
  for (const it of itensAplicaveis) {
    const d = valores[it.id] || {};
    const vazio = String(d.valor ?? '').trim() === '';
    if (it.obrigatorio && vazio) { faltas.push(`Informe “${it.nome}”.`); continue; }
    const res = avaliarItem(it, d.valor);
    if (res === 'nao_conforme') {
      // NC exige observação; foto só quando o cadastro exigir (§17)
      if (String(d.obs ?? '').trim() === '') faltas.push(`“${it.nome}” está Não Conforme: a observação é obrigatória.`);
      if (it.exige_foto_nc && !d.temFoto) faltas.push(`“${it.nome}” está Não Conforme: anexe a evidência (foto).`);
    }
  }
  return { ok: faltas.length === 0, faltas };
}

/* ============================================================ RESUMO (§20 bloco 3) */
export function resumoItens(avaliacoes) {
  const total = avaliacoes.length;
  const conta = k => avaliacoes.filter(a => a === k).length;
  const conformes = conta('conforme');
  const naoConformes = conta('nao_conforme');
  const na = conta('nao_aplicavel');
  const semVal = conta('sem_validacao');
  const pendentes = conta('pendente');
  const preenchidos = total - pendentes - na;
  const base = total - na;
  return {
    total, preenchidos, conformes, naoConformes, naoAplicaveis: na, semValidacao: semVal, pendentes,
    pct: base ? Math.round((preenchidos / base) * 100) : 100
  };
}

/* Status final da execução a partir dos resultados (§21). */
export function statusFinal(avaliacoes) {
  return avaliacoes.some(a => a === 'nao_conforme') ? 'concluida_nc' : 'concluida';
}

export function nowISO() { return new Date().toISOString(); }
export function hoje() { return new Date().toISOString().slice(0, 10); }
