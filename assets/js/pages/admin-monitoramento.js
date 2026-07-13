/* ==========================================================================
   Monitoramento Operacional dos Auditores (Administração) — §40-71
   EXCLUSIVO admin (data-module=admin_monitor). Painel baseado em eventos reais
   (insp_eventos): indicadores, atividades ao vivo, alertas, perfil operacional do
   auditor e linha do tempo. Somente acompanhamento — não altera inspeções (§68).
   Registra todo acesso ao módulo (§64).
   ========================================================================== */
import { mountShell } from '../app.js';
import * as MON from '../../../services/inspecao-monitor.js';
import * as INSP from '../../../services/inspecao.js';
import { INSP_STATUS } from '../../../services/inspecao-data.js';
import { charts, PALETTE } from '../charts.js';
import { $, $$, el, toast, modal, initials } from '../ui.js';

const ctx = await mountShell();
let USER;
if (ctx) {
  USER = ctx.user;
  await MON.registrarAcesso(USER, 'abriu_painel');    // §64 — governança
  queueMicrotask(render);
}

async function render() {
  const [dash, vivo, alerts, comp, logs] = await Promise.all([
    MON.dashboard(), MON.atividadesAoVivo(), MON.alertas(), MON.comparativoAuditores(), MON.logsAcesso(8)
  ]);

  $('#rna-content').innerHTML = `
    <div class="rna-page-head">
      <div><div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Administração <i class="bi bi-chevron-right"></i> Monitoramento Operacional</div>
      <h1>Desempenho dos Auditores</h1><p>Acompanhamento da execução real das inspeções — tempos, atividades ao vivo, alertas e indicadores.</p></div>
      <button class="rna-btn rna-btn-ghost" id="btn-refresh"><i class="bi bi-arrow-clockwise"></i> Atualizar</button>
    </div>

    <div class="rna-card mb-3" style="border-left:4px solid var(--rna-crit)"><div class="rna-card__body d-flex align-items-center gap-2" style="font-size:12.5px;color:var(--rna-gray)">
      <i class="bi bi-shield-lock" style="color:var(--rna-crit);font-size:18px"></i>
      Painel exclusivo da administração. O monitoramento cobre apenas atividades realizadas dentro do RNA One. Todo acesso é registrado (finalidade: gestão, rastreabilidade e melhoria de processo — §63-64).
    </div></div>

    <div class="row g-3 mb-3">
      ${stat('bi-person-workspace', 'ic-soft-green', dash.auditoresAtivos, 'Auditores ativos')}
      ${stat('bi-hourglass-split', 'ic-soft-yellow', dash.emAndamento, 'Inspeções em andamento')}
      ${stat('bi-pause-circle', 'ic-soft-orange', dash.pausadas, 'Pausadas')}
      ${stat('bi-slash-circle', 'ic-soft-gray', dash.semInteracao, 'Sem interação')}
      ${stat('bi-check2-circle', 'ic-soft-green', dash.concluidasHoje, 'Concluídas hoje')}
      ${stat('bi-stopwatch', 'ic-soft-blue', MON.fmtDuracao(dash.tempoMedioInspecao), 'Tempo médio / inspeção')}
      ${stat('bi-x-octagon', 'ic-soft-red', dash.reprovados, 'Reprovadas')}
      ${stat('bi-exclamation-triangle', 'ic-soft-red', alerts.length, 'Alertas')}
    </div>

    <div class="row g-3 mb-3">
      <div class="col-lg-7"><div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-broadcast-pin"></i> Atividades em andamento</h3><span class="cell-sub">${vivo.length} auditor(es)</span></div>
        <div class="rna-card__body p-0">${vivoHtml(vivo)}</div></div></div>
      <div class="col-lg-5"><div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-bell"></i> Alertas operacionais</h3></div>
        <div class="rna-card__body p-0">${alertasHtml(alerts)}</div></div></div>
    </div>

    <div class="row g-3 mb-3">
      <div class="col-lg-6"><div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-bar-chart"></i> Inspeções por auditor</h3></div>
        <div class="rna-card__body"><div style="height:240px"><canvas id="ch-aud"></canvas></div></div></div></div>
      <div class="col-lg-6"><div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-speedometer"></i> Tempo médio por auditor (min)</h3></div>
        <div class="rna-card__body"><div style="height:240px"><canvas id="ch-tempo"></canvas></div></div></div></div>
    </div>

    <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-people"></i> Comparativo por auditor</h3></div>
      <div class="rna-card__body p-0">${compHtml(comp)}</div></div>

    <div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-clock-history"></i> Log de acessos ao painel</h3></div>
      <div class="rna-card__body p-0">${logsHtml(logs)}</div></div>`;

  // gráficos
  if (comp.length) {
    charts.bar('ch-aud', comp.map(c => primeiro(c.auditor)), [{ label: 'Inspeções', data: comp.map(c => c.inspecoes), backgroundColor: PALETTE.blue },
      { label: 'Concluídas', data: comp.map(c => c.concluidas), backgroundColor: PALETTE.green }], { plugins: { legend: { display: true } } });
    charts.bar('ch-tempo', comp.map(c => primeiro(c.auditor)), [{ label: 'Tempo médio (min)', data: comp.map(c => Math.round(c.tempoMedio / 60)), backgroundColor: PALETTE.yellow }], { plugins: { legend: { display: false } } });
  }

  $('#btn-refresh').addEventListener('click', () => { toast('Atualizando...', { type: 'info', timeout: 900 }); render(); });
  $$('[data-auditor]').forEach(b => b.addEventListener('click', () => abrirPerfil(b.dataset.auditor)));
  $$('[data-rel]').forEach(b => b.addEventListener('click', () => abrirTimeline(b.dataset.rel)));
}

const stat = (icon, cor, val, label) => `<div class="col-6 col-lg-3"><div class="rna-stat"><div class="rna-stat__icon ${cor}"><i class="bi ${icon}"></i></div>
  <div class="rna-stat__val" style="font-size:22px">${val}</div><div class="rna-stat__label">${label}</div></div></div>`;
const primeiro = n => String(n || '').split(/\s+/)[0];

function vivoHtml(vivo) {
  if (!vivo.length) return `<div class="empty-state" style="padding:28px"><i class="bi bi-cup-hot"></i><div>Nenhuma inspeção em andamento no momento.</div></div>`;
  const sit = s => s === 'Ativo' ? 'badge-ok' : s === 'Pausado' ? 'badge-warn' : 'badge-pend';
  return `<div class="rna-table-wrap"><table class="rna-table"><thead><tr><th>Auditor</th><th>Atividade</th><th>Peça</th><th>Etapa</th><th>Início</th><th>Ativo</th><th>Última</th><th>Situação</th><th></th></tr></thead><tbody>
    ${vivo.map(v => `<tr><td class="cell-strong">${v.auditor}</td><td class="cell-sub">${v.tipo}</td><td>${v.peca}</td><td>${v.etapa}</td>
      <td class="cell-sub">${v.inicio}</td><td>${MON.fmtDuracao(v.tempoAtivoSeg)}</td><td class="cell-sub">${v.ultima}</td>
      <td><span class="rna-badge ${sit(v.situacao)}">${v.situacao}</span></td>
      <td><button class="rna-btn rna-btn-ghost rna-btn-sm" data-rel="${v.id}"><i class="bi bi-clock-history"></i></button></td></tr>`).join('')}
  </tbody></table></div>`;
}
function alertasHtml(alerts) {
  if (!alerts.length) return `<div class="empty-state" style="padding:28px"><i class="bi bi-check2-all"></i><div>Nenhum alerta no momento.</div></div>`;
  const cor = s => s === 'crit' ? 'insp-crit' : s === 'warn' ? 'insp-pend' : 'insp-pend';
  const ic = s => s === 'crit' ? 'bi-x-octagon' : s === 'warn' ? 'bi-exclamation-triangle' : 'bi-info-circle';
  return `<div class="bib-list">${alerts.map(a => `<div class="bib-list__item" style="cursor:pointer" data-rel="${a.relatorio_id}">
    <div class="rna-stat__icon ${a.severidade === 'crit' ? 'ic-soft-red' : a.severidade === 'warn' ? 'ic-soft-orange' : 'ic-soft-blue'}" style="margin:0;width:34px;height:34px"><i class="bi ${ic(a.severidade)}"></i></div>
    <div class="flex-fill"><b style="font-size:13px">${a.numero} · ${a.auditor}</b><div class="cell-sub">${a.descricao}</div></div>
    <span class="rna-badge badge-warn">Requer análise</span></div>`).join('')}</div>`;
}
function compHtml(comp) {
  if (!comp.length) return `<div class="empty-state" style="padding:28px"><i class="bi bi-people"></i><div>Sem dados de auditores ainda.</div></div>`;
  return `<div class="rna-table-wrap"><table class="rna-table"><thead><tr><th>Auditor</th><th>Inspeções</th><th>Concluídas</th><th>Reprovadas</th><th>Tempo médio</th><th></th></tr></thead><tbody>
    ${comp.map(c => `<tr><td class="cell-strong">${c.auditor}</td><td>${c.inspecoes}</td><td>${c.concluidas}</td><td>${c.reprovados}</td><td>${MON.fmtDuracao(c.tempoMedio)}</td>
      <td><button class="rna-btn rna-btn-ghost rna-btn-sm" data-auditor="${c.auditorId}"><i class="bi bi-person-lines-fill"></i> Perfil</button></td></tr>`).join('')}
  </tbody></table></div>`;
}
function logsHtml(logs) {
  if (!logs.length) return `<div class="empty-state" style="padding:22px"><i class="bi bi-clock"></i><div>Nenhum acesso registrado.</div></div>`;
  return `<div class="bib-list">${logs.map(l => `<div class="bib-list__item" style="cursor:default">
    <div class="rna-stat__icon ic-soft-gray" style="margin:0;width:32px;height:32px"><i class="bi bi-eye"></i></div>
    <div class="flex-fill"><b style="font-size:12.5px">${l.administrator_nome || '—'}</b> <span class="cell-sub">${l.action}${l.target_id ? ' · ' + l.target_id : ''}</span></div>
    <span class="cell-sub">${(l.occurred_at || '').slice(0, 16).replace('T', ' ')}</span></div>`).join('')}</div>`;
}

/* ------------------------------------------------------ perfil do auditor (§49) */
async function abrirPerfil(auditorId) {
  await MON.registrarAcesso(USER, 'abriu_perfil_auditor', { type: 'auditor', id: auditorId });
  const p = await MON.perfilAuditor(auditorId);
  const i = p.identificacao;
  const m = modal({
    title: `Perfil operacional — ${i.nome || '—'}`, size: 'modal-lg',
    content: `
      <div class="d-flex align-items-center gap-3 mb-3">
        <div class="rna-avatar" style="width:52px;height:52px;font-size:18px">${initials(i.nome)}</div>
        <div><b style="font-size:16px">${i.nome || '—'}</b><div class="cell-sub">${i.matricula || '—'} · ${i.planta || '—'} · ${i.area || '—'}</div></div>
      </div>
      <div class="insp-rep-sec-t">Produção</div>
      <div class="insp-summary-grid mb-3">
        ${sum(p.producao.inspecoes, 'Inspeções')} ${sum(p.producao.concluidas, 'Concluídas')} ${sum(p.producao.emAndamento, 'Em andamento')}
        ${sum(p.producao.pecas, 'Peças auditadas')} ${sum(p.producao.medicoes, 'Medições')} ${sum(p.producao.reprovados, 'Reprovados', 'crit')}
      </div>
      <div class="insp-rep-sec-t">Tempo</div>
      <div class="insp-summary-grid mb-3">
        ${sum(MON.fmtDuracao(p.tempo.medioInspecao), 'Médio / inspeção')} ${sum(MON.fmtDuracao(p.tempo.menor), 'Menor')} ${sum(MON.fmtDuracao(p.tempo.maior), 'Maior')}
        ${sum(MON.fmtDuracao(p.tempo.medioPeca), 'Médio / peça')} ${sum(p.qualidade.alteracoes, 'Alterações')} ${sum(p.qualidade.anexos, 'Anexos')}
      </div>
      <div class="insp-rep-sec-t">Relatórios recentes</div>
      <div class="rna-table-wrap" style="max-height:220px"><table class="rna-table"><tbody>
        ${p.relatorios.slice(0, 12).map(r => `<tr><td class="cell-strong">${r.numero}</td><td class="cell-sub">${r.peca_codigo || '—'}</td>
          <td><span class="rna-badge ${INSP_STATUS[r.status]?.badge || 'badge-na'}">${INSP_STATUS[r.status]?.label || r.status}</span></td>
          <td><button class="rna-btn rna-btn-ghost rna-btn-sm" data-rel2="${r.id}">Linha do tempo</button></td></tr>`).join('') || '<tr><td class="cell-sub">Nenhum relatório.</td></tr>'}
      </tbody></table></div>`,
    footer: `<button class="rna-btn rna-btn-primary" data-bs-dismiss="modal">Fechar</button>`
  });
  $$('[data-rel2]', m.host).forEach(b => b.addEventListener('click', () => { m.close(); abrirTimeline(b.dataset.rel2); }));
}
const sum = (v, l, tone = '') => `<div class="insp-sum ${tone ? 'insp-sum-' + tone : ''}"><div class="insp-sum__v" style="font-size:18px">${v}</div><div class="insp-sum__l">${l}</div></div>`;

/* ------------------------------------------------------ linha do tempo (§56) */
async function abrirTimeline(relId) {
  const [tl, rel] = await Promise.all([MON.timelineDe(relId), INSP.carregarRelatorio(relId)]);
  modal({
    title: `Linha do tempo — ${rel?.rel?.numero || relId}`, size: 'modal-lg',
    content: tl.length ? `<div class="insp-timeline">${tl.map(e => `<div class="insp-tl-item">
      <div class="insp-tl-time">${e.hora}</div><div class="insp-tl-dot"></div>
      <div class="insp-tl-body"><b>${e.label}</b>${e.metadata && Object.keys(e.metadata).length ? `<div class="cell-sub">${Object.entries(e.metadata).map(([k, v]) => `${k}: ${v}`).join(' · ')}</div>` : ''}</div>
    </div>`).join('')}</div>` : `<div class="empty-state"><i class="bi bi-hourglass"></i><div>Nenhum evento registrado.</div></div>`,
    footer: `<button class="rna-btn rna-btn-primary" data-bs-dismiss="modal">Fechar</button>`
  });
}
