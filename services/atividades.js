/* ==========================================================================
   RNA One — Motor de Atividades Operacionais (Gestão Operacional)
   Nenhuma rotina/checklist fixa no código: o motor apenas interpreta os
   registros configuráveis das tabelas op_* (tipos, atividades, itens,
   atribuições, agenda) e monta a lista do auditor ao iniciar o plantão.
   Toda persistência passa por db.js (demo ou Supabase, sem alteração).
   ========================================================================== */
import { db } from './db.js';

/* Prioridade da atribuição (hierarquia). Extensível: novos alvos entram aqui
   sem alterar o resolvedor. Ex.: setor:70, linha:80, maquina:90, equipe:40. */
export const ALVO_PRIORIDADE = { usuario: 100, cargo: 50, planta_turno: 10 };

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function nowISO() { return new Date().toISOString(); }
export function hoje() { return new Date().toISOString().slice(0, 10); }
function groupBy(arr, k) { const m = {}; arr.forEach(x => (m[x[k]] = m[x[k]] || []).push(x)); return m; }
export function numOrNull(v) { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; }

/* -------------------------------------------------------------- catálogos -- */
export async function tipos() { return (await db.list('op_tipos_atividade')).filter(t => t.ativo !== false); }
export async function categorias(tipoSlug) {
  const c = await db.list('op_categorias');
  return c.filter(x => x.ativo !== false && (!tipoSlug || x.tipo_slug === tipoSlug));
}

/* ----------------------------------------------------------- plantão base -- */
export async function plantaoAtivo(userId) {
  const ps = await db.list('plantoes');
  return ps.find(p => p.usuario === userId && p.status === 'Aberto') || null;
}

/* --------------------------------------------------------- atribuição ------ */
/** Uma atribuição casa com o usuário/plantão? (isolado e extensível por alvo). */
export function matchAtribuicao(a, user, plantao) {
  switch (a.alvo_tipo) {
    case 'usuario':      return a.alvo_valor === user.id;
    case 'cargo':        return a.alvo_valor === user.role;                 // "Cargo" = role nesta fase
    case 'planta_turno': return (!a.planta || a.planta === plantao?.planta) && (!a.turno || a.turno === plantao?.turno);
    // Futuros: setor, linha, maquina, processo, equipe — só adicionar cases aqui.
    default: return false;
  }
}

/** Uma atividade "vence hoje" segundo sua agenda de recorrência. */
export function venceHoje(agenda, dataISO, turno) {
  if (!agenda) return true;                                                 // sem agenda → sempre disponível
  const d = new Date((dataISO || hoje()) + 'T12:00:00');
  const wd = DIAS[d.getDay()];
  switch (agenda.tipo) {
    case 'diaria':        return true;
    case 'por_turno':     return true;
    case 'a_cada_x_horas':return true;
    case 'dia_semana':
    case 'semanal':       return !agenda.dias?.length || agenda.dias.includes(wd);
    case 'mensal':        return !agenda.ref || String(agenda.ref) === String(d.getDate());
    case 'sob_demanda':   return false;                                     // só manual, não auto
    default:              return true;
  }
}

/** Atividades publicadas de um tipo, atribuídas a este usuário e vencidas hoje. */
export async function resolverAtribuidas(user, plantao, tipoSlug = 'rotina') {
  const [ativs, atrs, ags] = await Promise.all([
    db.list('op_atividades'), db.list('op_atribuicoes'), db.list('op_agenda')
  ]);
  const atrBy = groupBy(atrs, 'atividade_id');
  const agBy = groupBy(ags, 'atividade_id');
  const out = [];
  for (const a of ativs) {
    if (a.tipo_slug !== tipoSlug || a.status !== 'publicada' || a.is_template) continue;
    let prio = -1;
    for (const atr of (atrBy[a.id] || [])) {
      if (matchAtribuicao(atr, user, plantao)) prio = Math.max(prio, ALVO_PRIORIDADE[atr.alvo_tipo] || 1);
    }
    if (prio < 0) continue;                                                 // não atribuída a este usuário
    if (!venceHoje((agBy[a.id] || [])[0], plantao?.data, plantao?.turno)) continue;
    out.push({ ...a, _prioridade: prio });
  }
  out.sort((x, y) => y._prioridade - x._prioridade || String(x.codigo || '').localeCompare(String(y.codigo || '')));
  return out;
}

/** Monta as execuções do plantão (idempotente): cria as que ainda faltam. */
export async function montarPlantao(user, plantao, tipoSlug = 'rotina') {
  const atribuidas = await resolverAtribuidas(user, plantao, tipoSlug);
  const execs = (await db.list('op_execucao', { filter: { plantao_id: plantao.id } })).filter(e => e.usuario === user.id);
  const jaTem = new Set(execs.map(e => e.atividade_id));
  for (const a of atribuidas) {
    if (jaTem.has(a.id)) continue;
    await db.insert('op_execucao', {
      plantao_id: plantao.id, atividade_id: a.id, tipo_slug: a.tipo_slug, usuario: user.id,
      status: 'pendente', obrigatoria: !!a.obrigatoria, iniciado_iso: null, concluido_iso: null, obs: ''
    });
  }
  return atribuidas.length;
}

/* --------------------------------------------------------- execução -------- */
export async function execucoesDo(plantaoId, user, tipoSlug) {
  const [execs, ativs] = await Promise.all([
    db.list('op_execucao', { filter: { plantao_id: plantaoId } }), db.list('op_atividades')
  ]);
  const byId = Object.fromEntries(ativs.map(a => [a.id, a]));
  let list = execs.filter(e => e.usuario === user.id);
  if (tipoSlug) list = list.filter(e => e.tipo_slug === tipoSlug);
  return list.map(e => ({ ...e, atividade: byId[e.atividade_id] || null }))
    .sort((a, b) => String(a.atividade?.codigo || '').localeCompare(String(b.atividade?.codigo || '')));
}

export function resumo(execs) {
  const total = execs.length;
  const feito = e => e.status === 'concluida' || e.status === 'nao_aplicavel';
  const concluidas = execs.filter(feito).length;
  const obrigPend = execs.filter(e => e.obrigatoria && !feito(e)).length;
  return { total, concluidas, pendentes: total - concluidas, pct: total ? Math.round(concluidas / total * 100) : 100, obrigPend };
}

/** Pode finalizar o plantão? Bloqueia se houver obrigatória pendente (qualquer tipo). */
export async function podeFinalizar(plantaoId, user) {
  const execs = await execucoesDo(plantaoId, user);
  const pend = { rotina: 0, checklist: 0, auditoria: 0, outros: 0 };
  const feito = e => e.status === 'concluida' || e.status === 'nao_aplicavel';
  execs.forEach(e => {
    if (e.obrigatoria && !feito(e)) {
      const k = ['rotina', 'checklist', 'auditoria'].includes(e.tipo_slug) ? e.tipo_slug : 'outros';
      pend[k]++;
    }
  });
  const totalPend = pend.rotina + pend.checklist + pend.auditoria + pend.outros;
  return { ok: totalPend === 0, pend, totalPend };
}

/* itens da atividade e resultados por item */
export async function itens(atividadeId) {
  return (await db.list('op_atividade_itens', { filter: { atividade_id: atividadeId } })).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
}
export async function execItens(execId) {
  return db.list('op_execucao_itens', { filter: { execucao_id: execId } });
}
export async function salvarItem(execId, itemId, dados) {
  const ex = (await db.list('op_execucao_itens', { filter: { execucao_id: execId } })).find(x => x.item_id === itemId);
  const payload = { execucao_id: execId, item_id: itemId, ...dados };
  return ex ? db.update('op_execucao_itens', ex.id, payload) : db.insert('op_execucao_itens', payload);
}
export async function iniciarExec(execId) { return db.update('op_execucao', execId, { status: 'em_andamento', iniciado_iso: nowISO() }); }
export async function concluirExec(execId, obs = '') { return db.update('op_execucao', execId, { status: 'concluida', concluido_iso: nowISO(), obs }); }
export async function marcarNA(execId) { return db.update('op_execucao', execId, { status: 'nao_aplicavel', concluido_iso: nowISO() }); }
export async function reabrirExec(execId) { return db.update('op_execucao', execId, { status: 'em_andamento', concluido_iso: null }); }

/** Valor numérico fora do limite mín/máx do item. */
export function foraDoLimite(item, valor) {
  if (!item.valor_numerico) return false;
  const n = numOrNull(valor); if (n == null) return false;
  if (item.limite_min != null && n < item.limite_min) return true;
  if (item.limite_max != null && n > item.limite_max) return true;
  return false;
}

/** Resposta de um item de checklist está conforme? (limite numérico ou resposta esperada). */
export function avaliarResposta(item, valor) {
  if (item.valor_numerico) return !foraDoLimite(item, valor);
  const esp = String(item.resposta_esperada || '').trim();
  if (esp) return String(valor ?? '').trim().toLowerCase() === esp.toLowerCase();
  return true;
}

/* ---------------------------------------------------------- pendências ----- */
export async function abrirPendencia({ atividade_id, execucao_id, plantao_id, descricao, aberta_por }) {
  return db.insert('op_pendencias', { atividade_id, execucao_id, plantao_id, descricao, status: 'aberta', aberta_por, responsavel: null, quando: nowISO() });
}
export async function pendenciasDe(user) {
  return (await db.list('op_pendencias')).filter(p => p.aberta_por === user.id)
    .sort((a, b) => String(b.quando).localeCompare(String(a.quando)));
}
export async function resolverPendencia(id) { return db.update('op_pendencias', id, { status: 'resolvida' }); }
