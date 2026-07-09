/* Histórico — execuções do auditor (Gestão Operacional) */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { $ } from '../ui.js';

const ctx = await mountShell();
if (ctx) render(ctx.user);

async function render(user) {
  const [execs, ativs, plantoes, tipos] = await Promise.all([
    db.list('op_execucao'), db.list('op_atividades'), db.list('plantoes'), db.list('op_tipos_atividade')
  ]);
  const aById = Object.fromEntries(ativs.map(a => [a.id, a]));
  const pById = Object.fromEntries(plantoes.map(p => [p.id, p]));
  const tBySlug = Object.fromEntries(tipos.map(t => [t.slug, t]));
  const feito = e => e.status === 'concluida' || e.status === 'nao_aplicavel';
  const mine = execs.filter(e => e.usuario === user.id && feito(e))
    .sort((a, b) => String(b.concluido_iso || '').localeCompare(String(a.concluido_iso || '')));

  const linha = e => {
    const a = aById[e.atividade_id] || {}; const p = pById[e.plantao_id] || {};
    return `<tr>
      <td class="cell-sub">${fmt(e.concluido_iso)}</td>
      <td class="cell-strong">${a.nome || '—'}<div class="cell-sub">${a.codigo || ''}</div></td>
      <td><span class="rna-badge badge-info">${tBySlug[e.tipo_slug]?.nome || e.tipo_slug}</span></td>
      <td class="cell-sub">${p.turno || '—'} · ${p.planta || ''}</td>
      <td><span class="rna-badge ${e.status === 'concluida' ? 'badge-ok' : 'badge-na'}">${e.status === 'concluida' ? 'Concluída' : 'N/A'}</span></td></tr>`;
  };

  $('#rna-content').innerHTML = `
    <div class="rna-page-head"><div>
      <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Operações <i class="bi bi-chevron-right"></i> Histórico</div>
      <h1>Histórico</h1><p>Todas as atividades que você já executou.</p></div></div>
    <div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-clock-history"></i> Atividades executadas <span class="rna-badge badge-info">${mine.length}</span></h3></div>
      <div class="rna-card__body p-0" style="overflow:auto"><table class="rna-table"><thead><tr><th>Quando</th><th>Atividade</th><th>Tipo</th><th>Plantão</th><th>Status</th></tr></thead>
        <tbody>${mine.length ? mine.map(linha).join('') : `<tr><td colspan="5"><div class="empty-state"><i class="bi bi-inbox"></i><div>Você ainda não concluiu nenhuma atividade.</div></div></td></tr>`}</tbody></table></div></div>`;
}
function fmt(iso) { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
