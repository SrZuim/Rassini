/* Pendências — do auditor (Gestão Operacional) */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import * as ATIV from '../../../services/atividades.js';
import { $, $$, toast, confirmDialog } from '../ui.js';

const ctx = await mountShell();
let USER;
if (ctx) { USER = ctx.user; render(); }

async function render() {
  const pend = await ATIV.pendenciasDe(USER);
  const ativs = Object.fromEntries((await db.list('op_atividades')).map(a => [a.id, a]));
  const abertas = pend.filter(p => p.status !== 'resolvida');
  const badge = s => ({ aberta: 'badge-crit', em_tratativa: 'badge-warn', resolvida: 'badge-ok' }[s] || 'badge-na');
  const linha = p => `<tr>
    <td class="cell-strong">${p.descricao}</td>
    <td>${ativs[p.atividade_id]?.codigo || '—'}<div class="cell-sub">${ativs[p.atividade_id]?.nome || ''}</div></td>
    <td><span class="rna-badge ${badge(p.status)}">${p.status}</span></td>
    <td class="cell-sub">${fmt(p.quando)}</td>
    <td class="text-end">${p.status !== 'resolvida' ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-res="${p.id}"><i class="bi bi-check2"></i> Resolver</button>` : ''}</td></tr>`;

  $('#rna-content').innerHTML = `
    <div class="rna-page-head"><div>
      <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Operações <i class="bi bi-chevron-right"></i> Pendências</div>
      <h1>Pendências</h1><p>Pendências abertas por você durante as execuções.</p></div></div>
    <div class="row g-3 mb-3">
      <div class="col-6 col-md-3"><div class="rna-stat"><div class="rna-stat__icon ic-soft-red"><i class="bi bi-exclamation-circle"></i></div><div class="rna-stat__val" style="font-size:22px">${abertas.length}</div><div class="rna-stat__label">Abertas</div></div></div>
      <div class="col-6 col-md-3"><div class="rna-stat"><div class="rna-stat__icon ic-soft-green"><i class="bi bi-check2-circle"></i></div><div class="rna-stat__val" style="font-size:22px">${pend.length - abertas.length}</div><div class="rna-stat__label">Resolvidas</div></div></div>
    </div>
    <div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-exclamation-circle"></i> Minhas pendências <span class="rna-badge badge-info">${pend.length}</span></h3></div>
      <div class="rna-card__body p-0" style="overflow:auto"><table class="rna-table"><thead><tr><th>Descrição</th><th>Atividade</th><th>Status</th><th>Quando</th><th></th></tr></thead>
        <tbody>${pend.length ? pend.map(linha).join('') : `<tr><td colspan="5"><div class="empty-state"><i class="bi bi-check2-circle"></i><div>Nenhuma pendência. Tudo em ordem!</div></div></td></tr>`}</tbody></table></div></div>`;

  $$('[data-res]').forEach(b => b.addEventListener('click', () => confirmDialog('Marcar esta pendência como resolvida?', async () => { await ATIV.resolverPendencia(b.dataset.res); toast('Pendência resolvida.', { type: 'ok' }); render(); }, { title: 'Resolver pendência', okLabel: 'Resolver' })));
}
function fmt(iso) { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); }
