/* ==========================================================================
   RNA One — AMOSTRAS COLABORATIVAS DA INSPEÇÃO DIMENSIONAL (§M04)

   Antes: o relatório pertencia ao auditor que o criou e só ele media. Uma peça
   com 5 amostras (P1..P5) era medida por uma pessoa só, do começo ao fim.

   Agora: o relatório EM ANDAMENTO é compartilhado. João mede P1, Maria mede P2,
   Carlos mede P3 — no mesmo relatório, ao mesmo tempo. Cada AMOSTRA é a unidade
   de trabalho: tem dono, início, fim, tempo gasto, observação e resultado
   próprios, e é registrada em `insp_amostras`.

   ------------------------------------------------------------------- BLOQUEIO
   Quando um auditor assume uma amostra, ela fica travada para os demais: eles
   veem os valores, mas não editam. As outras amostras seguem livres.

   O bloqueio EXPIRA sozinho (decisão do usuário): o navegador que está com a
   amostra manda um "sinal de vida" (heartbeat) a cada BATIDA_SEG; passados
   LOCK_TTL_SEG sem sinal, a trava é considerada abandonada e outro auditor pode
   assumir. Sem isso, fechar o navegador ou perder a rede deixaria a amostra
   travada para sempre, exigindo um admin para destravar.

   ------------------------------------------------- CONCORRÊNCIA (limitação real)
   Não há compare-and-swap em db.js (a API é list/get/insert/update/remove). A
   tomada de posse é OTIMISTA: grava e RELÊ para confirmar que o dono é mesmo
   quem pediu. Numa disputa simultânea pelo mesmo milissegundo, o segundo a
   gravar vence e o primeiro recebe `ok:false` na releitura — nenhum dos dois
   fica achando que tem a trava. Para exclusão mútua forte seria preciso um
   UPDATE condicional no servidor (ver nota em fix_amostras_colaborativas.sql).

   Persistência 100% via db.js (demo ou Supabase, sem alteração).
   ========================================================================== */
import { db } from './db.js';

/* Uma trava vale por LOCK_TTL_SEG sem sinal de vida. BATIDA_SEG é bem menor que
   o TTL para tolerar uma batida perdida sem derrubar a trava de quem está ativo. */
export const LOCK_TTL_SEG = 180;   // 3 min sem sinal → trava expirada
export const BATIDA_SEG   = 45;    // sinal de vida a cada 45 s

export const AMOSTRA_STATUS = {
  pendente:     { label: 'Pendente',     badge: 'badge-na',   icone: 'bi-circle' },
  em_andamento: { label: 'Em medição',   badge: 'badge-warn', icone: 'bi-pencil-square' },
  concluida:    { label: 'Concluída',    badge: 'badge-ok',   icone: 'bi-check-circle-fill' }
};

const nowISO = () => new Date().toISOString();
const segundosDesde = iso => {
  const t = new Date(iso || 0).getTime();
  return Number.isNaN(t) ? Infinity : Math.max(0, Math.round((Date.now() - t) / 1000));
};

/** A trava está viva? (existe dono E o sinal de vida é recente) */
export function travaAtiva(a) {
  if (!a?.bloqueado_por) return false;
  return segundosDesde(a.batida_iso || a.bloqueado_iso) < LOCK_TTL_SEG;
}
/** Trava abandonada: tem dono, mas sem sinal de vida há mais que o TTL. */
export function travaExpirada(a) {
  return !!a?.bloqueado_por && !travaAtiva(a);
}
/** Este usuário pode editar esta amostra? */
export function podeEditar(a, userId) {
  if (!a) return false;
  if (a.status === 'concluida') return false;          // concluída não se reabre pela tela de medição
  if (!travaAtiva(a)) return false;                     // ninguém segurando → precisa assumir antes
  return a.bloqueado_por === userId;
}

/* ------------------------------------------------------------- LEITURA ----- */
/** Garante uma linha por amostra (1..quantidade). Idempotente. */
export async function garantirAmostras(relatorioId, quantidade) {
  const existentes = await db.list('insp_amostras', { filter: { relatorio_id: relatorioId } });
  const porNumero = new Map(existentes.map(a => [Number(a.amostra), a]));
  const criadas = [];
  for (let n = 1; n <= (quantidade || 0); n++) {
    if (porNumero.has(n)) continue;
    criadas.push(await db.insert('insp_amostras', {
      relatorio_id: relatorioId, amostra: n, status: 'pendente',
      auditor_id: null, auditor_nome: '', inicio_iso: null, fim_iso: null, duracao_seg: null,
      observacao: '', resultado: 'pendente',
      bloqueado_por: null, bloqueado_nome: '', bloqueado_iso: null, batida_iso: null
    }));
  }
  return [...existentes, ...criadas].sort((a, b) => a.amostra - b.amostra);
}

/** Estado das amostras já enriquecido para a UI. */
export async function estadoAmostras(relatorioId, quantidade) {
  const linhas = await garantirAmostras(relatorioId, quantidade);
  return linhas
    .filter(a => a.amostra <= (quantidade || 0))
    .map(a => ({
      ...a,
      _travaAtiva: travaAtiva(a),
      _travaExpirada: travaExpirada(a),
      _segSemSinal: a.bloqueado_por ? segundosDesde(a.batida_iso || a.bloqueado_iso) : null
    }));
}

export async function amostraDe(relatorioId, amostra) {
  const linhas = await db.list('insp_amostras', { filter: { relatorio_id: relatorioId } });
  return linhas.find(a => Number(a.amostra) === Number(amostra)) || null;
}

/* ------------------------------------------------------------- POSSE ------- */
/** Assume a amostra. Devolve { ok, amostra } ou { ok:false, motivo, por }.
    Toma posse quando está livre, quando a trava expirou ou quando já é sua. */
export async function assumirAmostra(relatorioId, amostra, user) {
  const atual = await amostraDe(relatorioId, amostra)
    || (await garantirAmostras(relatorioId, amostra)).find(a => Number(a.amostra) === Number(amostra));
  if (!atual) return { ok: false, motivo: 'inexistente' };
  if (atual.status === 'concluida') return { ok: false, motivo: 'concluida' };

  if (travaAtiva(atual) && atual.bloqueado_por !== user.id) {
    return { ok: false, motivo: 'bloqueada', por: atual.bloqueado_nome || 'outro auditor' };
  }

  const agora = nowISO();
  const patch = {
    bloqueado_por: user.id, bloqueado_nome: user.nome || '', bloqueado_iso: agora, batida_iso: agora,
    status: atual.status === 'concluida' ? atual.status : 'em_andamento',
    // o primeiro a assumir vira o auditor responsável e marca o início da medição
    auditor_id: atual.auditor_id || user.id,
    auditor_nome: atual.auditor_nome || user.nome || '',
    inicio_iso: atual.inicio_iso || agora
  };
  await db.update('insp_amostras', atual.id, patch);

  // Confirmação otimista: relê e só declara sucesso se o dono for mesmo este usuário.
  const confirmado = await amostraDe(relatorioId, amostra);
  if (confirmado?.bloqueado_por !== user.id) {
    return { ok: false, motivo: 'bloqueada', por: confirmado?.bloqueado_nome || 'outro auditor' };
  }
  return { ok: true, amostra: confirmado };
}

/** Sinal de vida. Só renova se a trava ainda for deste usuário. */
export async function baterCoracao(relatorioId, amostra, user) {
  const a = await amostraDe(relatorioId, amostra);
  if (!a || a.bloqueado_por !== user.id) return false;
  await db.update('insp_amostras', a.id, { batida_iso: nowISO() });
  return true;
}

/** Libera a amostra (sai da edição sem concluir). Acumula o tempo trabalhado. */
export async function liberarAmostra(relatorioId, amostra, user, { forcar = false } = {}) {
  const a = await amostraDe(relatorioId, amostra);
  if (!a) return false;
  if (!forcar && a.bloqueado_por !== user.id) return false;
  await db.update('insp_amostras', a.id, {
    bloqueado_por: null, bloqueado_nome: '', bloqueado_iso: null, batida_iso: null,
    duracao_seg: acumularTempo(a)
  });
  return true;
}

/* Tempo gasto = acumulado + o trecho desta sessão de edição. Somar (em vez de
   sobrescrever) preserva o total quando a amostra é assumida mais de uma vez —
   inclusive por auditores diferentes. */
function acumularTempo(a) {
  const acumulado = Number(a.duracao_seg) || 0;
  if (!a.bloqueado_iso) return acumulado;
  const trecho = Math.max(0, Math.round((Date.now() - new Date(a.bloqueado_iso).getTime()) / 1000));
  return acumulado + trecho;
}

/** Conclui a amostra: grava fim, tempo, observação e resultado; solta a trava. */
export async function concluirAmostra(relatorioId, amostra, user, { observacao = '', resultado = null } = {}) {
  const a = await amostraDe(relatorioId, amostra);
  if (!a) return { ok: false, motivo: 'inexistente' };
  if (travaAtiva(a) && a.bloqueado_por !== user.id) {
    return { ok: false, motivo: 'bloqueada', por: a.bloqueado_nome || 'outro auditor' };
  }
  const fim = nowISO();
  await db.update('insp_amostras', a.id, {
    status: 'concluida', fim_iso: fim, duracao_seg: acumularTempo(a),
    observacao: observacao ?? a.observacao ?? '',
    resultado: resultado || a.resultado || 'pendente',
    // registra quem concluiu, caso tenha sido outro auditor
    auditor_id: a.auditor_id || user.id, auditor_nome: a.auditor_nome || user.nome || '',
    concluido_por: user.id, concluido_por_nome: user.nome || '',
    bloqueado_por: null, bloqueado_nome: '', bloqueado_iso: null, batida_iso: null
  });
  return { ok: true };
}

/** Reabre uma amostra concluída (correção). Mantém o tempo já acumulado. */
export async function reabrirAmostra(relatorioId, amostra, user) {
  const a = await amostraDe(relatorioId, amostra);
  if (!a) return { ok: false, motivo: 'inexistente' };
  await db.update('insp_amostras', a.id, { status: 'em_andamento', fim_iso: null });
  return { ok: true };
}

/** Libera TODAS as travas expiradas do relatório (higiene ao abrir a tela). */
export async function liberarExpiradas(relatorioId) {
  const linhas = await db.list('insp_amostras', { filter: { relatorio_id: relatorioId } });
  let n = 0;
  for (const a of linhas) {
    if (!travaExpirada(a)) continue;
    await db.update('insp_amostras', a.id, {
      bloqueado_por: null, bloqueado_nome: '', bloqueado_iso: null, batida_iso: null,
      duracao_seg: acumularTempo(a)
    });
    n++;
  }
  return n;
}

/* --------------------------------------------------- RESULTADO DA AMOSTRA -- */
/** Resultado calculado de uma amostra: reprovado se qualquer medição dela
    reprovou; aprovado se todas as avaliáveis passaram; senão pendente.
    Medições de REFERÊNCIA ('registrado') não aprovam nem reprovam. */
export function resultadoDaAmostra(medicoesDaAmostra) {
  const rs = medicoesDaAmostra.map(m => m.resultado);
  if (!rs.length) return 'pendente';
  if (rs.some(r => r === 'reprovado')) return 'reprovado';
  const avaliaveis = rs.filter(r => r !== 'registrado');
  if (!avaliaveis.length) return 'registrado';
  return avaliaveis.every(r => r === 'aprovado') ? 'aprovado' : 'pendente';
}

/** Recalcula e grava o resultado de cada amostra a partir das medições. */
export async function recalcularResultados(relatorioId, quantidade) {
  const meds = await db.list('insp_medicoes', { filter: { relatorio_id: relatorioId } });
  const linhas = await garantirAmostras(relatorioId, quantidade);
  for (const a of linhas) {
    const doNumero = meds.filter(m => Number(m.amostra) === Number(a.amostra));
    const res = resultadoDaAmostra(doNumero);
    if (res !== a.resultado) await db.update('insp_amostras', a.id, { resultado: res });
  }
}

/* ------------------------------------------------------- QUEM ESTÁ ONLINE -- */
/** Auditores com trava ativa neste relatório — alimenta o aviso "quem está aqui". */
export async function colaboradoresAtivos(relatorioId) {
  const linhas = await db.list('insp_amostras', { filter: { relatorio_id: relatorioId } });
  const porUser = new Map();
  for (const a of linhas) {
    if (!travaAtiva(a)) continue;
    if (!porUser.has(a.bloqueado_por)) porUser.set(a.bloqueado_por, { id: a.bloqueado_por, nome: a.bloqueado_nome, amostras: [] });
    porUser.get(a.bloqueado_por).amostras.push(a.amostra);
  }
  return [...porUser.values()];
}

/** Participantes do relatório (assumiram ou concluíram alguma amostra). */
export async function participantes(relatorioId) {
  const linhas = await db.list('insp_amostras', { filter: { relatorio_id: relatorioId } });
  const m = new Map();
  for (const a of linhas) {
    if (a.auditor_id && !m.has(a.auditor_id)) m.set(a.auditor_id, { id: a.auditor_id, nome: a.auditor_nome, amostras: [] });
    if (a.auditor_id) m.get(a.auditor_id).amostras.push(a.amostra);
  }
  return [...m.values()];
}
