/* Rotina Obrigatória — etapa 2 do Fluxo do Auditor */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { estado, rotinasDoDia, hhmm } from '../../../services/fluxo.js';
import { stepper, bloqueio } from '../flow-ui.js';
import { $, $$, toast, modal } from '../ui.js';
import { initEvidenceUpload } from '../evidence.js';

const ctx = await mountShell();
let USER;
if (ctx) { USER = ctx.user; render(); }

async function render() {
  const st = await estado(USER.id);

  if (!st.plantao) {
    $('#rna-content').innerHTML = head('plantao', st) +
      bloqueio('Inicie o plantão primeiro', 'A rotina obrigatória só é liberada após o check-in do plantão.', 'checkin.html', 'Iniciar Plantão');
    return;
  }

  const cat = await rotinasDoDia();
  const ex = (await db.list('rotina_exec')).filter(e => e.plantao_id === st.plantao.id);
  const byId = Object.fromEntries(ex.map(e => [e.rotina_id, e]));
  const agora = hhmm();

  const grupos = { 'Diário':[], 'Semanal':[], 'Mensal':[] };
  cat.forEach(r => (grupos[r.frequencia] = grupos[r.frequencia] || []).push(r));

  const itemHtml = (r) => {
    const e = byId[r.id];
    const stt = e?.status || 'Pendente';
    const atrasado = stt === 'Pendente' && r.frequencia === 'Diário' && r.horario < agora;
    const cls = stt === 'Concluído' ? 'ok' : stt === 'Não aplicável' ? 'na' : atrasado ? 'late' : '';
    return `<div class="op-item ${cls}">
      <div class="op-item__main">
        <b>${r.nome}</b>
        <div class="op-item__resp">
          <span><i class="bi bi-clock"></i> ${r.horario}</span>
          <span><i class="bi bi-arrow-repeat"></i> ${r.frequencia}</span>
          <span><i class="bi bi-person"></i> ${r.responsavel}</span>
          ${atrasado?'<span style="background:rgba(244,169,17,.18);color:#b97e00"><i class="bi bi-exclamation-triangle"></i> Atrasado</span>':''}
          ${e?.hora?`<span style="background:rgba(34,168,90,.14);color:#1c8c4a"><i class="bi bi-check2"></i> ${e.hora}</span>`:''}
          ${e?.obs?`<span title="${e.obs}"><i class="bi bi-chat-left-text"></i> obs</span>`:''}
        </div>
      </div>
      ${stt==='Pendente'
        ? `<div class="d-flex gap-2">
            <button class="rna-btn rna-btn-primary rna-btn-sm" data-concluir="${r.id}"><i class="bi bi-check2"></i> Concluir</button>
            <button class="rna-btn rna-btn-ghost rna-btn-sm" data-na="${r.id}">N/A</button>
          </div>`
        : `<span class="rna-badge ${stt==='Concluído'?'badge-ok':'badge-na'}">${stt}</span>
           <button class="rna-btn rna-btn-ghost rna-btn-sm ms-2" data-reabrir="${r.id}"><i class="bi bi-arrow-counterclockwise"></i></button>`}
    </div>`;
  };

  const secao = (titulo, arr, badge) => arr.length ? `
    <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-list-check"></i> ${titulo} <span class="rna-badge ${badge}">${arr.length}</span></h3></div>
      <div class="rna-card__body">${arr.map(itemHtml).join('')}</div></div>` : '';

  $('#rna-content').innerHTML = head('rotina', st) + `
    <div class="rna-card mb-3" style="border-left:4px solid ${st.rotinaOk?'var(--rna-ok)':'var(--rna-yellow)'}">
      <div class="rna-card__body d-flex flex-wrap align-items-center gap-3">
        <div class="flex-fill" style="min-width:200px">
          <div class="d-flex justify-content-between"><b>Progresso da rotina diária</b><b>${st.rot.concluidas}/${st.rot.total}</b></div>
          <div class="rna-progress mt-1"><span style="width:${st.rot.pct}%;background:${st.rotinaOk?'var(--rna-ok)':'var(--rna-yellow)'}"></span></div>
        </div>
        ${st.rotinaOk
          ? `<span class="rna-badge badge-ok"><i class="bi bi-check-lg"></i> Rotina concluída</span>`
          : `<span class="rna-badge badge-warn"><i class="bi bi-hourglass-split"></i> Conclua todos os itens da rotina</span>`}
      </div>
    </div>
    ${secao('Itens obrigatórios do dia', grupos['Diário']||[], 'badge-crit')}
    ${secao('Semanais', grupos['Semanal']||[], 'badge-info')}
    ${secao('Mensais', grupos['Mensal']||[], 'badge-na')}`;

  $$('[data-concluir]').forEach(b => b.addEventListener('click', () => concluir(b.dataset.concluir, cat, st.plantao.id, byId)));
  $$('[data-na]').forEach(b => b.addEventListener('click', () => marcarNA(b.dataset.na, cat, st.plantao.id, byId)));
  $$('[data-reabrir]').forEach(b => b.addEventListener('click', () => reabrir(b.dataset.reabrir, st.plantao.id, byId)));
}

function head(etapa, st) {
  return `<div class="rna-page-head"><div>
    <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Rotina Obrigatória</div>
    <h1>Rotina Obrigatória</h1><p>Itens da planilha de rotinas 2026 — conclua todos para liberar o fechamento do plantão.</p></div></div>
    ${stepper(st, 'rotina')}`;
}

async function concluir(rotinaId, cat, plantaoId, byId) {
  const r = cat.find(x => x.id === rotinaId);
  const m = modal({ title:`Concluir · ${r.nome}`,
    content:`<div class="row g-3">
      <div class="col-12"><label class="form-label">Observação</label><textarea class="form-control" id="r-obs" rows="2" placeholder="Resultado / observação (opcional)"></textarea></div>
      <div class="col-12"><label class="form-label">Evidência (foto)</label><div id="r-evid"></div></div>
    </div>`,
    footer:`<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button><button class="rna-btn rna-btn-primary" id="r-ok"><i class="bi bi-check2"></i> Concluir</button>` });
  const up = initEvidenceUpload($('#r-evid', m.host), { label:'Evidência da rotina', multiple:true });
  $('#r-ok', m.host).addEventListener('click', async () => {
    const btn = $('#r-ok', m.host); btn.disabled = true;
    try {
      const exec = await saveExec(rotinaId, plantaoId, byId, 'Concluído', $('#r-obs', m.host).value);
      const evs = await up.commit({ registro_tipo:'rotina', registro_id:exec?.id, usuario:USER });
      if (evs[0]) await db.update('rotina_exec', exec.id, { evidencia: evs[0].url });
      m.close(); toast(`Rotina concluída: ${r.nome}`, { type:'ok' }); render();
    } catch { btn.disabled = false; }
  });
}

async function marcarNA(rotinaId, cat, plantaoId, byId) {
  await saveExec(rotinaId, plantaoId, byId, 'Não aplicável', '');
  toast('Item marcado como Não aplicável.', { type:'info' }); render();
}

async function reabrir(rotinaId, plantaoId, byId) {
  const e = byId[rotinaId];
  if (e) await db.update('rotina_exec', e.id, { status:'Pendente', hora:null });
  render();
}

async function saveExec(rotinaId, plantaoId, byId, status, obs) {
  const e = byId[rotinaId];
  const payload = { status, hora: status==='Concluído'?hhmm():null, obs, auditor:USER.id };
  let rec;
  if (e) rec = await db.update('rotina_exec', e.id, payload);
  else rec = await db.insert('rotina_exec', { plantao_id:plantaoId, rotina_id:rotinaId, ...payload });
  await db.log({ usuario:USER.nome, acao:`Rotina ${status}`, entidade:'rotina_exec', antes:'Pendente', depois:status });
  return rec;
}
