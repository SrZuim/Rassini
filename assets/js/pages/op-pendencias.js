/* ==========================================================================
   Pendências (Operações) — §Regra 10 do novo fluxo de Auditorias
   A página deixou de ser manual: lista AUTOMATICAMENTE toda inspeção dimensional
   finalizada como "Finalizada — Reprovada", com sua pendência vinculada (criada
   na finalização; relatórios legados recebem a pendência por backfill idempotente).
   Também mantém as pendências operacionais (rotina/checklist) já existentes.
   Escopo por perfil: auditor vê as suas; supervisor/admin veem todas.
   ========================================================================== */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import * as ATIV from '../../../services/atividades.js';
import * as INSP from '../../../services/inspecao.js';
import { INSP_STATUS } from '../../../services/inspecao-data.js';
import { $, $$, toast, confirmDialog } from '../ui.js';

const ctx = await mountShell();
let USER;
if (ctx) { USER = ctx.user; render(); }

function escopo() {
  if (USER.role === 'auditor') return { somenteAuditor: USER.id };
  return {};   // supervisor/admin: todas (RLS trata em produção)
}
const dataBR = iso => (String(iso || '').slice(0, 10).split('-').reverse().join('/')) || '—';
const fmtQuando = iso => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); };
const badgeStatus = s => ({ aberta: 'badge-crit', em_tratativa: 'badge-warn', resolvida: 'badge-ok' }[s] || 'badge-na');
const labelStatus = s => ({ aberta: 'Aberta', em_tratativa: 'Em tratativa', resolvida: 'Resolvida' }[s] || s);

async function render() {
  // 1) inspeções reprovadas no escopo → garante a pendência de cada uma (backfill).
  //    A inspeção reprovada SEMPRE aparece; se o backfill falhar (ex.: RLS ao abrir
  //    como não-autor em produção), mostra a linha sem número de pendência.
  const reprovadas = await INSP.consultarRelatorios({ status: 'finalizada_reprovada' }, escopo());
  const dimensionais = [];
  for (const rel of reprovadas) {
    let pend = await INSP.pendenciaDoRelatorio(rel.id).catch(() => null);
    if (!pend) { try { pend = await INSP.garantirPendencia(rel, USER); } catch { pend = null; } }
    dimensionais.push(pend
      ? { ...pend, _rel: rel, _semPendencia: false }
      : { id: 'nopend-' + rel.id, numero: null, status: 'aberta', dados: null, _rel: rel, _semPendencia: true });
  }
  dimensionais.sort((a, b) => String(b.quando || b._rel.completed_iso || '').localeCompare(String(a.quando || a._rel.completed_iso || '')));

  // 2) pendências operacionais (não dimensionais) — mantém o comportamento anterior
  const todas = await db.list('op_pendencias').catch(() => []);
  const escopoOp = USER.role === 'auditor' ? todas.filter(p => p.aberta_por === USER.id) : todas;
  const operacionais = escopoOp.filter(p => p.origem !== 'inspecao_dimensional' && !p.relatorio_id)
    .sort((a, b) => String(b.quando).localeCompare(String(a.quando)));

  const ativs = Object.fromEntries((await db.list('op_atividades').catch(() => [])).map(a => [a.id, a]));
  const abertas = dimensionais.filter(p => p.status !== 'resolvida').length + operacionais.filter(p => p.status !== 'resolvida').length;
  const resolvidas = dimensionais.length + operacionais.length - abertas;

  const alvoRel = new URLSearchParams(location.search).get('rel');   // vindo de "Ver Pendência"

  $('#rna-content').innerHTML = `
    <div class="rna-page-head"><div>
      <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Operações <i class="bi bi-chevron-right"></i> Pendências</div>
      <h1>Pendências</h1><p>Inspeções reprovadas geram pendências automaticamente. Acompanhe e trate cada ocorrência.</p></div></div>
    <div class="row g-3 mb-3">
      <div class="col-6 col-md-3"><div class="rna-stat"><div class="rna-stat__icon ic-soft-red"><i class="bi bi-exclamation-circle"></i></div><div class="rna-stat__val" style="font-size:22px">${abertas}</div><div class="rna-stat__label">Abertas</div></div></div>
      <div class="col-6 col-md-3"><div class="rna-stat"><div class="rna-stat__icon ic-soft-green"><i class="bi bi-check2-circle"></i></div><div class="rna-stat__val" style="font-size:22px">${resolvidas}</div><div class="rna-stat__label">Resolvidas</div></div></div>
      <div class="col-6 col-md-3"><div class="rna-stat"><div class="rna-stat__icon ic-soft-yellow"><i class="bi bi-x-octagon"></i></div><div class="rna-stat__val" style="font-size:22px">${dimensionais.length}</div><div class="rna-stat__label">De inspeções reprovadas</div></div></div>
      <div class="col-6 col-md-3"><div class="rna-stat"><div class="rna-stat__icon ic-soft-blue"><i class="bi bi-list-check"></i></div><div class="rna-stat__val" style="font-size:22px">${dimensionais.length + operacionais.length}</div><div class="rna-stat__label">Total</div></div></div>
    </div>

    <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-x-octagon"></i> Inspeções reprovadas <span class="rna-badge badge-info">${dimensionais.length}</span></h3></div>
      <div class="rna-card__body p-0">${dimensionais.length ? tabelaDim(dimensionais) : `<div class="empty-state" style="padding:32px"><i class="bi bi-check2-circle"></i><div>Nenhuma inspeção reprovada. Qualidade em dia!</div></div>`}</div></div>

    ${operacionais.length ? `<div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-exclamation-circle"></i> Pendências operacionais <span class="rna-badge badge-info">${operacionais.length}</span></h3></div>
      <div class="rna-card__body p-0"><div class="rna-table-wrap"><table class="rna-table"><thead><tr><th>Descrição</th><th>Atividade</th><th>Status</th><th>Quando</th><th></th></tr></thead>
        <tbody>${operacionais.map(p => linhaOp(p, ativs)).join('')}</tbody></table></div></div></div>` : ''}`;

  $$('[data-res]').forEach(b => b.addEventListener('click', () => confirmDialog('Marcar esta pendência como resolvida?', async () => { await ATIV.resolverPendencia(b.dataset.res); toast('Pendência resolvida.', { type: 'ok' }); render(); }, { title: 'Resolver pendência', okLabel: 'Resolver' })));
  $$('[data-detalhe]').forEach(b => b.addEventListener('click', () => detalhe(dimensionais.find(p => p.id === b.dataset.detalhe))));

  // realce da pendência vinda de "Ver Pendência" (op-pendencias.html?rel=<id>)
  if (alvoRel) {
    const row = $(`tr[data-rel="${alvoRel}"]`);
    if (row) { row.classList.add('cdim-highlight'); row.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    else toast('Nenhuma pendência vinculada a este relatório.', { type: 'info' });
  }
}

function tabelaDim(list) {
  return `<div class="rna-table-wrap"><table class="rna-table"><thead><tr>
    <th>Pendência</th><th>Relatório</th><th>Cliente · PN</th><th>Lote · OP</th><th>Auditor</th><th>Data</th><th>Reprov.</th><th>Status</th><th>Ações</th>
    </tr></thead><tbody>${list.map(p => {
      const r = p._rel, d = p.dados || {};
      return `<tr data-rel="${r.id}">
        <td class="cell-strong">${p.numero || '<span class="cell-sub">a gerar</span>'}</td>
        <td>${r.numero || '—'}</td>
        <td>${d.cliente || r.cliente || '—'}<div class="cell-sub">${d.part_number || r.peca_codigo || '—'}</div></td>
        <td>${d.lote || r.lote || '—'}<div class="cell-sub">OP ${d.op || r.op || '—'}</div></td>
        <td>${d.auditor || r.auditor_nome || '—'}</td>
        <td class="cell-sub">${d.data || dataBR(r.completed_iso || r.started_iso)}</td>
        <td><span class="rna-badge badge-crit">${d.qtd_reprovadas ?? r._reprovacoes ?? '—'}</span></td>
        <td><span class="rna-badge ${badgeStatus(p.status)}">${labelStatus(p.status)}</span></td>
        <td><div class="d-flex flex-wrap gap-1">
          ${p._semPendencia ? '' : `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-detalhe="${p.id}" title="Detalhes"><i class="bi bi-card-list"></i></button>`}
          <a class="rna-btn rna-btn-ghost rna-btn-sm" href="consulta-dimensional.html?rel=${r.id}" title="Ver relatório"><i class="bi bi-file-earmark-text"></i></a>
          ${!p._semPendencia && p.status !== 'resolvida' ? `<button class="rna-btn rna-btn-primary rna-btn-sm" data-res="${p.id}"><i class="bi bi-check2"></i> Resolver</button>` : ''}
        </div></td></tr>`;
    }).join('')}</tbody></table></div>`;
}

function linhaOp(p, ativs) {
  return `<tr>
    <td class="cell-strong">${p.descricao || '—'}</td>
    <td>${ativs[p.atividade_id]?.codigo || '—'}<div class="cell-sub">${ativs[p.atividade_id]?.nome || ''}</div></td>
    <td><span class="rna-badge ${badgeStatus(p.status)}">${labelStatus(p.status)}</span></td>
    <td class="cell-sub">${fmtQuando(p.quando)}</td>
    <td class="text-end">${p.status !== 'resolvida' ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-res="${p.id}"><i class="bi bi-check2"></i> Resolver</button>` : ''}</td></tr>`;
}

/* Detalhe da pendência dimensional — todos os campos rastreáveis (§Regra 7/8). */
function detalhe(p) {
  if (!p) return;
  const r = p._rel, d = p.dados || {};
  const s = INSP_STATUS[r.status] || { label: r.status, badge: 'badge-na' };
  const linha = (l, v) => `<div class="insp-rep-cell"><span class="insp-info-l">${l}</span><span class="insp-info-v">${(v === 0 || v) ? v : '—'}</span></div>`;
  const car = (d.caracteristicas_reprovadas || []).map(c => `<div class="insp-rep-reprov">
      <b>${c.caracteristica}</b> (cota ${c.cota}) ${c.classe ? `<span class="rep-tag rep-crit">Classe ${c.classe}</span>` : ''}
      <div class="cell-sub">Limite: ${c.limite} · Amostras reprovadas: ${c.amostras || '—'}${c.observacao ? ' · Obs.: ' + c.observacao : ''}</div>
    </div>`).join('') || '<span class="cell-sub">—</span>';
  import('../ui.js').then(({ modal }) => {
    modal({
      title: `Pendência ${p.numero || ''}`, size: 'modal-lg',
      content: `
        <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
          <span class="rna-badge ${badgeStatus(p.status)}">${labelStatus(p.status)}</span>
          <span class="rna-badge ${s.badge}">${s.label}</span>
          <span class="cell-sub">Relatório ${r.numero}</span></div>
        <div class="insp-rep-grid">
          ${linha('Cliente', d.cliente)} ${linha('Part Number', d.part_number)} ${linha('Revisão', d.revisao === '' ? '—' : 'Rev ' + d.revisao)}
          ${linha('Lote', d.lote)} ${linha('OP', d.op)} ${linha('Auditor', d.auditor)}
          ${linha('Data', d.data)} ${linha('Hora', d.hora)} ${linha('Planta', d.planta)}
          ${linha('Máquina', d.maquina)} ${linha('Operação', d.operacao)} ${linha('Fotos anexadas', d.fotos)}
        </div>
        <div class="insp-rep-sec-t mt-3">Características reprovadas (${d.qtd_reprovadas ?? 0})</div>
        ${car}
        ${d.observacoes ? `<div class="mt-2"><b>Observações do auditor:</b> <span class="cell-sub">${d.observacoes}</span></div>` : ''}`,
      footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Fechar</button>
        <a class="rna-btn rna-btn-primary" href="consulta-dimensional.html?rel=${r.id}"><i class="bi bi-file-earmark-text"></i> Ver relatório completo</a>`
    });
  });
}
