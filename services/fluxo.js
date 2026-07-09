/* ==========================================================================
   RNA One — Fluxo do Auditor (máquina de estados)
   Regra de negócio:
     1) Plantão é a etapa inicial obrigatória.
     2) Com o plantão ativo, Rotina, Checklist e Auditoria ficam liberadas
        simultaneamente — o auditor executa em qualquer ordem (sem bloqueio
        sequencial entre elas).
     3) Finalizar o plantão exige Rotina + Checklist concluídos.
        A Auditoria fica liberada, mas não bloqueia o fechamento.
   O gating é derivado dos registros de execução.
   ========================================================================== */
import { db } from './db.js';

export const ETAPAS = ['plantao','rotina','checklist','auditoria'];

function hoje() { return new Date().toISOString().slice(0,10); }

/** Plantão aberto do usuário (hoje). */
export async function plantaoAtivo(userId) {
  const ps = await db.list('plantoes');
  return ps.find(p => p.usuario === userId && p.status === 'Aberto') || null;
}

/** Rotinas obrigatórias do dia = catálogo ativo (Diário bloqueia; demais acompanham). */
export async function rotinasDoDia() {
  const cat = await db.list('cat_rotinas');
  return cat.filter(r => r.ativo);
}

export async function rotinaProgress(plantaoId) {
  const [cat, ex] = await Promise.all([rotinasDoDia(), db.list('rotina_exec')]);
  const execs = ex.filter(e => e.plantao_id === plantaoId);
  const byId = Object.fromEntries(execs.map(e => [e.rotina_id, e]));
  const obrig = cat.filter(r => r.frequencia === 'Diário');
  const feito = (e) => e && (e.status === 'Concluído' || e.status === 'Não aplicável');
  const concluidas = obrig.filter(r => feito(byId[r.id])).length;
  return {
    total: obrig.length,
    concluidas,
    pendentes: obrig.length - concluidas,
    pct: obrig.length ? Math.round(concluidas / obrig.length * 100) : 100,
    completo: obrig.length > 0 && concluidas === obrig.length,
    execs: byId
  };
}

/** Itens de checklist exigidos = categoria escolhida + Atividades Auditor. */
export async function checklistItens(categoria) {
  const cat = await db.list('cat_checklist');
  return cat.filter(i => i.ativo && (i.categoria === categoria || i.categoria === 'Atividades Auditor'));
}

export async function checklistProgress(plantaoId, categoria) {
  if (!categoria) return { total:0, respondidos:0, pendentes:0, pct:0, completo:false, nok:0, execs:{} };
  const [itens, ex] = await Promise.all([checklistItens(categoria), db.list('checklist_exec')]);
  const execs = ex.filter(e => e.plantao_id === plantaoId);
  const byId = Object.fromEntries(execs.map(e => [e.item_id, e]));
  const respondidos = itens.filter(i => byId[i.id] && byId[i.id].status && byId[i.id].status !== 'Pendente').length;
  const nok = itens.filter(i => byId[i.id]?.status === 'NOK').length;
  return {
    total: itens.length,
    respondidos,
    pendentes: itens.length - respondidos,
    nok,
    pct: itens.length ? Math.round(respondidos / itens.length * 100) : 0,
    completo: itens.length > 0 && respondidos === itens.length,
    execs: byId
  };
}

/** Estado consolidado do fluxo para o usuário. */
export async function estado(userId) {
  const plantao = await plantaoAtivo(userId);
  if (!plantao) return { plantao:null, etapa:'plantao', rotinaOk:false, checklistOk:false, auditoriaLiberada:false, podeFinalizar:false };
  const rot = await rotinaProgress(plantao.id);
  const chk = await checklistProgress(plantao.id, plantao.categoria_checklist);
  // Rotina e Checklist são independentes entre si — cada uma conclui sozinha.
  const rotinaOk = rot.completo;
  const checklistOk = chk.completo;
  // Com o plantão ativo todas as atividades ficam liberadas (qualquer ordem).
  const auditoriaLiberada = true;
  // Fechamento do plantão exige rotina + checklist (auditoria não bloqueia).
  const podeFinalizar = rotinaOk && checklistOk;
  return { plantao, rot, chk, etapa:'atividades', rotinaOk, checklistOk, auditoriaLiberada, podeFinalizar };
}

/** Cálculo de tempo de auditoria + verificação de atraso. */
export function calcAuditoria(inicioISO, fimISO, tempoMedioMin) {
  const ini = new Date(inicioISO), fim = new Date(fimISO);
  const min = Math.max(0, Math.round((fim - ini) / 60000));
  const excedeuMedia = tempoMedioMin && min > tempoMedioMin;
  const excedeu1h = min > 60;
  return { tempo_total: min, excedeu: Boolean(excedeuMedia || excedeu1h), tempoMedio: tempoMedioMin };
}

export function nowISO() { return new Date().toISOString(); }
export function hhmm(d = new Date()) { return new Date(d).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}); }
export { hoje };
