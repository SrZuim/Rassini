/* ==========================================================================
   RNA One — Monitoramento Operacional dos Auditores (§40-71)
   Agregações derivadas do stream de eventos (insp_eventos) e dos relatórios.
   EXCLUSIVO da administração — todas as leituras são gated no front (RBAC
   admin_monitor) e no banco (RLS admin em insp_eventos). Não altera nada da
   inspeção: apenas acompanha, calcula tempos e sinaliza para análise humana.
   ========================================================================== */
import { db } from './db.js';
import { INSP_EVENTO_LABEL, INSP_ALERT_LIMIARES } from './inspecao-data.js';
import { fmtDuracao, nowISO } from './inspecao.js';
import { formatarHoraBrasil } from './datahora.js';

export { fmtDuracao };

const MIN = 60 * 1000;
function ms(iso) { return iso ? new Date(iso).getTime() : null; }
function segEntre(a, b) { const x = ms(a), y = ms(b); return (x && y) ? Math.max(0, Math.round((y - x) / 1000)) : null; }

/* Eventos "relevantes" (§46): contam como interação produtiva (exclui saves puros). */
const EV_RELEVANTES = new Set(['measurement_created', 'measurement_updated', 'measurement_rejected',
  'characteristic_opened', 'defect_classified', 'attachment_uploaded', 'corrective_action_created',
  'part_selected', 'sample_started', 'sample_completed', 'review_started', 'review_completed']);

/* ------------------------------------------------------- coleta base ------- */
async function base() {
  const [rels, eventos, usuarios, pausas, cars, meds] = await Promise.all([
    db.list('insp_relatorios'), db.list('insp_eventos'), db.list('usuarios'),
    db.list('insp_pausas'), db.list('insp_caracteristicas'), db.list('insp_medicoes')
  ]);
  return { rels, eventos, usuarios, pausas, cars, meds };
}
const hojeStr = () => new Date().toISOString().slice(0, 10);

/* Tempo ATIVO de um relatório (§42): soma de intervalos entre eventos relevantes
   consecutivos, ignorando lacunas maiores que o limiar de inatividade. */
export function tempoAtivoSeg(eventosDoRel, gapMin = INSP_ALERT_LIMIARES.inatividade_min) {
  const evs = eventosDoRel.filter(e => EV_RELEVANTES.has(e.tipo_evento) || e.tipo_evento.startsWith('inspection'))
    .sort((a, b) => String(a.quando).localeCompare(String(b.quando)));
  let ativo = 0;
  for (let i = 1; i < evs.length; i++) {
    const d = segEntre(evs[i - 1].quando, evs[i].quando);
    if (d != null && d <= gapMin * 60) ativo += d;
  }
  return ativo;
}

/* ============================================================ DASHBOARD (§47) */
export async function dashboard() {
  const { rels, eventos, pausas } = await base();
  const hoje = hojeStr();
  const evBy = groupBy(eventos, 'relatorio_id');
  const emAndamento = rels.filter(r => r.status === 'em_andamento' || r.status === 'rascunho');
  const pausadas = new Set(pausas.filter(p => !p.fim_iso).map(p => p.relatorio_id));
  const concluidasHoje = rels.filter(r => String(r.completed_iso).slice(0, 10) === hoje);
  const finalizadas = rels.filter(r => String(r.status).startsWith('finalizada'));
  const durs = finalizadas.map(r => r.duracao_seg).filter(x => x != null);
  const auditoresAtivos = new Set(emAndamento.map(r => r.auditor_id)).size;

  // tempo médio por característica/peça a partir dos finalizados
  let totCar = 0, totAmostras = 0;
  finalizadas.forEach(r => { totAmostras += (r.quantidade || 0); });

  return {
    auditoresAtivos,
    emAndamento: emAndamento.length,
    pausadas: [...pausadas].length,
    semInteracao: emAndamento.filter(r => semInteracao(evBy[r.id] || [])).length,
    concluidasHoje: concluidasHoje.length,
    aprovados: rels.filter(r => r.status === 'finalizada_aprovada').length,
    reprovados: rels.filter(r => r.status === 'finalizada_reprovada').length,
    revisados: rels.filter(r => r.status === 'revisada').length,
    tempoMedioInspecao: media(durs),
    tempoMedioPeca: totAmostras ? media(durs) && Math.round(soma(durs) / Math.max(1, totAmostras)) : 0,
    totalRelatorios: rels.length,
    totalMedicoes: eventos.filter(e => e.tipo_evento === 'measurement_created').length,
    alteracoes: eventos.filter(e => e.tipo_evento === 'measurement_updated').length,
    reprovacoes: eventos.filter(e => e.tipo_evento === 'measurement_rejected').length,
    finalizadas: finalizadas.length
  };
}
function semInteracao(evs, gapMin = INSP_ALERT_LIMIARES.inatividade_min) {
  const rel = evs.filter(e => EV_RELEVANTES.has(e.tipo_evento)).sort((a, b) => String(b.quando).localeCompare(String(a.quando)))[0];
  if (!rel) return false;
  return (Date.now() - ms(rel.quando)) > gapMin * MIN;
}

/* ================================================= ATIVIDADES AO VIVO (§48) */
export async function atividadesAoVivo() {
  const { rels, eventos, pausas } = await base();
  const evBy = groupBy(eventos, 'relatorio_id');
  const pausaAberta = new Set(pausas.filter(p => !p.fim_iso).map(p => p.relatorio_id));
  const ativos = rels.filter(r => r.status === 'em_andamento' || r.status === 'rascunho');
  return ativos.map(r => {
    const evs = (evBy[r.id] || []).sort((a, b) => String(b.quando).localeCompare(String(a.quando)));
    const ultimo = evs[0];
    const sem = semInteracao(evs);
    const situacao = pausaAberta.has(r.id) ? 'Pausado' : sem ? 'Sem interação' : 'Ativo';
    return {
      id: r.id, auditor: r.auditor_nome, tipo: r.tipo_nome, peca: r.peca_codigo || '—',
      // §Erro 06 — horários no fuso America/Sao_Paulo (antes vinham em UTC)
      etapa: etapaLabel(r.etapa), inicio: formatarHoraBrasil(r.started_iso),
      tempoAtivoSeg: tempoAtivoSeg(evs), ultima: formatarHoraBrasil(ultimo?.quando), situacao
    };
  }).sort((a, b) => a.situacao.localeCompare(b.situacao));
}
const ETAPA_LBL = ['Tipo e peça', 'Identificação', 'Amostras', 'Medições', 'Revisão', 'Resultado'];
function etapaLabel(i) { return ETAPA_LBL[i] || '—'; }

/* ===================================================== PERFIL DO AUDITOR (§49) */
export async function perfilAuditor(auditorId) {
  const { rels, eventos, usuarios, cars, meds } = await base();
  const meus = rels.filter(r => r.auditor_id === auditorId);
  // identidade: tabela de usuários OU, se ausente (ex.: login local), o snapshot do relatório
  const ref = meus[0] || {};
  const u = usuarios.find(x => x.id === auditorId)
    || { nome: ref.auditor_nome, matricula: ref.auditor_matricula, planta: ref.planta, area: '', role: ref.auditor_perfil };
  const evMeus = eventos.filter(e => e.auditor_id === auditorId);
  const finalizadas = meus.filter(r => String(r.status).startsWith('finalizada'));
  const durs = finalizadas.map(r => r.duracao_seg).filter(x => x != null);
  const relIds = new Set(meus.map(r => r.id));
  const medsMeus = meds.filter(m => relIds.has(m.relatorio_id));
  const amostras = meus.reduce((s, r) => s + (r.quantidade || 0), 0);
  return {
    identificacao: { nome: u.nome, matricula: u.matricula, planta: u.planta, area: u.area, perfil: u.role },
    producao: {
      inspecoes: meus.length, concluidas: finalizadas.length,
      emAndamento: meus.filter(r => r.status === 'em_andamento' || r.status === 'rascunho').length,
      pecas: amostras, medicoes: medsMeus.length,
      aprovados: meus.filter(r => r.status === 'finalizada_aprovada').length,
      reprovados: meus.filter(r => r.status === 'finalizada_reprovada').length
    },
    tempo: {
      medioInspecao: media(durs), menor: durs.length ? Math.min(...durs) : 0, maior: durs.length ? Math.max(...durs) : 0,
      medioPeca: amostras ? Math.round(soma(durs) / Math.max(1, amostras)) : 0
    },
    qualidade: {
      alteracoes: evMeus.filter(e => e.tipo_evento === 'measurement_updated').length,
      reaberturas: evMeus.filter(e => e.tipo_evento === 'report_reopened').length,
      correcoes: evMeus.filter(e => e.tipo_evento === 'report_corrected').length,
      anexos: evMeus.filter(e => e.tipo_evento === 'attachment_uploaded').length
    },
    relatorios: meus.sort((a, b) => String(b.started_iso).localeCompare(String(a.started_iso)))
  };
}

/* ============================================================ ALERTAS (§53-55) */
export async function alertas(limiares = INSP_ALERT_LIMIARES) {
  const { rels, eventos, meds } = await base();
  const evBy = groupBy(eventos, 'relatorio_id');
  const out = [];
  for (const r of rels) {
    const evs = evBy[r.id] || [];
    // parada (§53)
    if ((r.status === 'em_andamento') && semInteracao(evs, limiares.inatividade_min)) {
      out.push(alerta(r, 'parada', 'warn', `Inspeção sem interação relevante há mais de ${limiares.inatividade_min} minutos.`));
    }
    // muitas alterações na mesma medição (§53/§54)
    const upByCar = {};
    evs.filter(e => e.tipo_evento === 'measurement_updated').forEach(e => { const k = e.caracteristica_id + '#' + e.amostra; upByCar[k] = (upByCar[k] || 0) + 1; });
    if (Object.values(upByCar).some(n => n >= limiares.alteracoes_medicao)) {
      out.push(alerta(r, 'muitas_alteracoes', 'info', 'Foram realizadas várias alterações nos resultados antes da finalização.'));
    }
    // rápido demais (§53) — finalizada com tempo por característica muito baixo
    if (String(r.status).startsWith('finalizada') && r.duracao_seg != null) {
      const nCar = meds.filter(m => m.relatorio_id === r.id).length || 1;
      if (r.duracao_seg / nCar < limiares.rapido_demais_seg) {
        out.push(alerta(r, 'rapido_demais', 'warn', 'Inspeção concluída em tempo significativamente inferior ao padrão. Verifique se todas as medições foram realizadas corretamente.'));
      }
    }
    // valores repetidos (§55) — todas as amostras iguais numa característica reprovável
    const repet = valoresRepetidos(meds.filter(m => m.relatorio_id === r.id));
    if (repet) out.push(alerta(r, 'valores_repetidos', 'info', 'Sequência de valores idênticos entre amostras — requer análise.'));
  }
  return out.sort((a, b) => sevRank(b.severidade) - sevRank(a.severidade));
}
function valoresRepetidos(meds) {
  const byCar = groupBy(meds, 'caracteristica_id');
  return Object.values(byCar).some(list => list.length >= 3 && new Set(list.map(m => String(m.valor))).size === 1 && String(list[0].valor ?? '') !== '');
}
const sevRank = s => ({ crit: 3, warn: 2, info: 1 }[s] || 0);
function alerta(r, tipo, severidade, descricao) {
  return { id: r.id + '-' + tipo, relatorio_id: r.id, numero: r.numero, auditor: r.auditor_nome, tipo, severidade, descricao, quando: r.updated_iso };
}

/* ============================================================ TIMELINE (§56) */
export async function timelineDe(relatorioId) {
  const evs = (await db.list('insp_eventos', { filter: { relatorio_id: relatorioId } }))
    .sort((a, b) => String(a.quando).localeCompare(String(b.quando)));
  return evs.map(e => ({ ...e, label: INSP_EVENTO_LABEL[e.tipo_evento] || e.tipo_evento, hora: formatarHoraBrasil(e.quando, { segundos: true }) }));
}

/* ============================================= COMPARATIVO POR AUDITOR (§58) */
export async function comparativoAuditores() {
  const { rels, usuarios } = await base();
  const byAud = groupBy(rels.filter(r => r.auditor_id), 'auditor_id');
  return Object.entries(byAud).map(([id, list]) => {
    const fin = list.filter(r => String(r.status).startsWith('finalizada'));
    const durs = fin.map(r => r.duracao_seg).filter(x => x != null);
    return {
      auditor: usuarios.find(u => u.id === id)?.nome || list[0].auditor_nome, auditorId: id,
      inspecoes: list.length, concluidas: fin.length, tempoMedio: media(durs),
      reprovados: list.filter(r => r.status === 'finalizada_reprovada').length
    };
  }).sort((a, b) => b.inspecoes - a.inspecoes);
}

/* ============================================= LOG DE ACESSO ADMIN (§64) */
export async function registrarAcesso(admin, action, target = {}) {
  try {
    await db.insert('insp_monitor_logs', {
      administrator_id: admin?.id || null, administrator_nome: admin?.nome || '',
      action, target_type: target.type || null, target_id: target.id || null,
      filter_data: target.filtros || null, occurred_at: nowISO()
    });
  } catch { /* log não pode quebrar o painel */ }
}
export async function logsAcesso(limite = 50) {
  return (await db.list('insp_monitor_logs')).sort((a, b) => String(b.occurred_at).localeCompare(String(a.occurred_at))).slice(0, limite);
}

/* --------------------------------------------------------------- utils ----- */
function groupBy(arr, k) { const m = {}; arr.forEach(x => (m[x[k]] = m[x[k]] || []).push(x)); return m; }
function soma(arr) { return arr.reduce((s, x) => s + x, 0); }
function media(arr) { return arr.length ? Math.round(soma(arr) / arr.length) : 0; }
