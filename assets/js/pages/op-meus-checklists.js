/* Meus Checklists — execução dos checklists atribuídos (Gestão Operacional · Fase 2) */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import * as ATIV from '../../../services/atividades.js';
import { $, $$, toast, modal, confirmDialog } from '../ui.js';
import { initEvidenceUpload } from '../evidence.js';

const ctx = await mountShell();
let USER;
const state = { view: 'lista', execId: null };
let UP = {}, SIG = {}, ANS = {};

if (ctx) {
  USER = ctx.user;
  const ex = new URLSearchParams(location.search).get('exec');
  if (ex) { state.view = 'exec'; state.execId = ex; }
  render();
}

function head() {
  return `<div class="rna-page-head"><div>
    <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Operações <i class="bi bi-chevron-right"></i> Meus Checklists</div>
    <h1>Meus Checklists</h1><p>Checklists atribuídos a você neste plantão — responda em qualquer ordem.</p></div></div>`;
}

async function render() {
  const plantao = await ATIV.plantaoAtivo(USER.id);
  if (!plantao) {
    $('#rna-content').innerHTML = head() + `<div class="rna-card"><div class="rna-card__body text-center" style="padding:38px 20px">
      <i class="bi bi-lock-fill" style="font-size:44px;color:var(--rna-gray-300)"></i>
      <h3 style="margin:14px 0 6px">Inicie o plantão primeiro</h3>
      <p class="text-muted-2" style="max-width:440px;margin:0 auto 16px">Seus checklists são carregados automaticamente ao iniciar o plantão.</p>
      <a href="op-plantao.html" class="rna-btn rna-btn-primary rna-btn-lg"><i class="bi bi-box-arrow-in-right"></i> Ir para o Plantão</a></div></div>`;
    return;
  }
  await ATIV.montarPlantao(USER, plantao, 'checklist');
  if (state.view === 'exec' && state.execId) return renderExec(plantao);
  return renderLista(plantao);
}

async function renderLista(plantao) {
  const execs = await ATIV.execucoesDo(plantao.id, USER, 'checklist');
  const r = ATIV.resumo(execs);
  const card = (e) => {
    const a = e.atividade || {}; const feito = e.status === 'concluida' || e.status === 'nao_aplicavel';
    return `<div class="col-md-6 col-xl-4"><div class="rna-card h-100 op-rot-card ${feito ? 'is-done' : ''}"><div class="rna-card__body">
      <div class="d-flex justify-content-between align-items-start mb-1"><span class="op-code">${a.codigo || ''}</span>
        ${a.obrigatoria ? '<span class="rna-badge badge-crit">Obrigatório</span>' : '<span class="rna-badge badge-na">Opcional</span>'}</div>
      <b style="font-size:15px">${a.nome || '—'}</b>
      <div class="op-item__resp mt-1"><span><i class="bi bi-tag"></i> ${a.categoria || '—'}</span>${a.horario ? `<span><i class="bi bi-clock"></i> ${a.horario}</span>` : ''}</div>
      <div class="d-flex justify-content-between align-items-center mt-3">${statusBadge(e.status)}
        ${feito ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-reabrir="${e.id}"><i class="bi bi-arrow-counterclockwise"></i> Reabrir</button>`
        : `<button class="rna-btn rna-btn-primary rna-btn-sm" data-exec="${e.id}"><i class="bi bi-play-fill"></i> Responder</button>`}</div>
    </div></div></div>`;
  };
  $('#rna-content').innerHTML = head() + `
    <div class="rna-card mb-3"><div class="rna-card__body d-flex flex-wrap align-items-center gap-3">
      <div class="flex-fill" style="min-width:200px"><div class="d-flex justify-content-between"><b>Progresso</b><b>${r.concluidas}/${r.total}</b></div>
        <div class="rna-progress mt-1"><span style="width:${r.pct}%;background:${r.pct === 100 ? 'var(--rna-ok)' : 'var(--rna-yellow)'}"></span></div></div>
      <a href="op-plantao.html" class="rna-btn rna-btn-ghost"><i class="bi bi-speedometer2"></i> Painel do plantão</a></div>
    ${execs.length ? `<div class="row g-3">${execs.map(card).join('')}</div>` : `<div class="empty-state"><i class="bi bi-inbox"></i><div>Nenhum checklist atribuído a você hoje.</div></div>`}`;
  $$('[data-exec]').forEach(b => b.addEventListener('click', () => { state.view = 'exec'; state.execId = b.dataset.exec; render(); }));
  $$('[data-reabrir]').forEach(b => b.addEventListener('click', async () => { await ATIV.reabrirExec(b.dataset.reabrir); toast('Checklist reaberto.', { type: 'info' }); render(); }));
}

async function renderExec(plantao) {
  const exec = await db.get('op_execucao', state.execId);
  if (!exec) { state.view = 'lista'; return render(); }
  const a = await db.get('op_atividades', exec.atividade_id);
  const itens = await ATIV.itens(exec.atividade_id);
  const resultados = await ATIV.execItens(exec.id);
  const byItem = Object.fromEntries(resultados.map(r => [r.item_id, r]));
  UP = {}; SIG = {}; ANS = {};
  itens.forEach(it => { const r = byItem[it.id] || {}; ANS[it.id] = { valor: r.valor || '', foto: r.foto || null, obs: r.obs || '' }; });

  $('#rna-content').innerHTML = head() + `
    <div class="rna-card mb-3"><div class="rna-card__body d-flex flex-wrap align-items-center gap-3">
      <div class="rna-stat__icon ic-soft-orange" style="margin:0"><i class="bi bi-ui-checks"></i></div>
      <div class="flex-fill"><h3 style="margin:0;font-size:16px">${a?.nome || '—'} <span class="op-code">${a?.codigo || ''}</span></h3>
        <small class="text-muted-2">${a?.descricao || ''}</small></div>
      ${a?.obrigatoria ? '<span class="rna-badge badge-crit">Obrigatório</span>' : ''}
      <button class="rna-btn rna-btn-ghost" id="ex-voltar"><i class="bi bi-arrow-left"></i> Voltar</button></div></div>
    <div class="op-exec">${itens.map((it, i) => itemCard(it, i)).join('') || `<div class="empty-state"><i class="bi bi-inbox"></i><div>Checklist sem itens.</div></div>`}</div>
    <div class="d-flex gap-2 justify-content-end mt-3 mb-4">
      <button class="rna-btn rna-btn-ghost" id="ex-na"><i class="bi bi-slash-circle"></i> Não aplicável</button>
      <button class="rna-btn rna-btn-primary rna-btn-lg" id="ex-concluir"><i class="bi bi-check2-circle"></i> Concluir checklist</button></div>`;

  // uploaders / assinaturas / eventos
  itens.forEach(it => {
    const precisaFoto = it.tipo_resposta === 'foto' || it.foto_obrigatoria;
    if (precisaFoto) { const h = $(`#cfoto-${it.id}`); if (h) UP[it.id] = initEvidenceUpload(h, { label: 'Foto', hint: 'Câmera ou arquivo', multiple: false }); }
    if (it.tipo_resposta === 'assinatura') { const cv = $(`#csig-${it.id}`); if (cv) SIG[it.id] = initSignature(cv); }
  });
  $$('[data-seg] button').forEach(b => b.addEventListener('click', () => {
    const seg = b.closest('[data-seg]'); const id = seg.dataset.seg;
    ANS[id].valor = b.dataset.opt;
    seg.querySelectorAll('button').forEach(x => x.className = '');
    b.className = segCls(b.dataset.opt);
  }));
  $$('[data-multi]').forEach(l => l.addEventListener('click', () => {
    const id = l.dataset.multi, opt = l.dataset.opt;
    const set = new Set((ANS[id].valor || '').split('|').filter(Boolean));
    set.has(opt) ? set.delete(opt) : set.add(opt); ANS[id].valor = [...set].join('|');
    l.classList.toggle('active');
  }));
  $$('[data-check]').forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.check; ANS[id].valor = ANS[id].valor === 'OK' ? '' : 'OK';
    b.className = `rna-btn ${ANS[id].valor === 'OK' ? 'rna-btn-primary' : 'rna-btn-ghost'} op-check`;
    b.innerHTML = `<i class="bi bi-check2"></i> ${ANS[id].valor === 'OK' ? 'Feito' : 'Marcar feito'}`;
  }));
  $$('.op-ans').forEach(el => el.addEventListener('input', () => {
    ANS[el.dataset.ans].valor = el.value;
    if (el.dataset.num) { const it = itens.find(x => x.id === el.dataset.num); el.closest('.op-exec-item').classList.toggle('op-fora', ATIV.foraDoLimite(it, el.value)); }
  }));
  $$('.op-ans[data-num]').forEach(el => { const it = itens.find(x => x.id === el.dataset.num); el.closest('.op-exec-item').classList.toggle('op-fora', ATIV.foraDoLimite(it, el.value)); });
  $$('.op-obs').forEach(el => el.addEventListener('input', () => { ANS[el.dataset.obs].obs = el.value; }));
  $$('[data-sigclear]').forEach(b => b.addEventListener('click', () => SIG[b.dataset.sigclear]?.clear()));

  $('#ex-voltar').addEventListener('click', voltarLista);
  $('#ex-na').addEventListener('click', () => confirmDialog('Marcar este checklist como Não Aplicável?', async () => { await ATIV.marcarNA(exec.id); toast('Checklist marcado como N/A.', { type: 'info' }); voltarLista(); }, { title: 'Não aplicável', okLabel: 'Confirmar' }));
  $('#ex-concluir').addEventListener('click', () => concluir(exec, a, itens));
}

function itemCard(it, i) {
  const precisaFoto = it.tipo_resposta === 'foto' || it.foto_obrigatoria;
  const blocos = [];
  if (it.tipo_resposta !== 'foto') blocos.push(`<div class="mt-2">${controle(it)}</div>`);
  if (precisaFoto) blocos.push(`<div class="mt-2"><label class="form-label">Foto <span class="text-danger">*</span></label>${ANS[it.id].foto ? `<div class="mb-1"><img src="${ANS[it.id].foto}" class="op-foto-thumb"></div>` : ''}<div id="cfoto-${it.id}"></div></div>`);
  blocos.push(`<div class="mt-2"><label class="form-label">Comentário ${it.comentario_obrigatorio ? '<span class="text-danger">*</span>' : ''}</label>
    <textarea class="form-control op-obs" data-obs="${it.id}" rows="2" placeholder="${it.comentario_obrigatorio ? 'Comentário obrigatório...' : 'Opcional'}">${esc(ANS[it.id].obs)}</textarea></div>`);
  return `<div class="rna-card mb-2 op-exec-item"><div class="rna-card__body">
    <div class="d-flex align-items-start gap-2"><div class="op-idx">${i + 1}</div>
      <div class="flex-fill"><b>${it.nome}</b>${it.descricao ? `<div class="cell-sub">${it.descricao}</div>` : ''}${it.resposta_esperada ? `<div class="cell-sub">Esperado: <b>${it.resposta_esperada}</b></div>` : ''}</div>
      ${it.peso ? `<span class="rna-badge badge-info">peso ${it.peso}</span>` : ''}</div>
    ${blocos.join('')}</div></div>`;
}

function controle(it) {
  const a = ANS[it.id] || {};
  switch (it.tipo_resposta) {
    case 'sim_nao': return seg(it, ['Sim', 'Não', 'N/A'], a.valor);
    case 'lista': return `<select class="form-select op-ans" data-ans="${it.id}" style="max-width:240px"><option value="">Selecione...</option>${(it.opcoes || []).map(o => `<option ${o === a.valor ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
    case 'multipla': return `<div class="d-flex flex-wrap gap-2">${(it.opcoes || []).map(o => `<button type="button" class="rna-chip ${(a.valor || '').split('|').includes(o) ? 'active' : ''}" data-multi="${it.id}" data-opt="${o}">${o}</button>`).join('')}</div>`;
    case 'numero': return `<div class="d-flex align-items-center gap-2"><input class="form-control op-ans" data-ans="${it.id}" data-num="${it.id}" inputmode="decimal" value="${esc(a.valor)}" style="max-width:160px">${it.unidade ? `<small class="text-muted-2">${it.unidade}</small>` : ''}${limHint(it)}</div>`;
    case 'texto': return `<input class="form-control op-ans" data-ans="${it.id}" value="${esc(a.valor)}">`;
    case 'qrcode': case 'codigo_barras': return `<div class="input-group" style="max-width:320px"><span class="input-group-text"><i class="bi ${it.tipo_resposta === 'qrcode' ? 'bi-qr-code-scan' : 'bi-upc-scan'}"></i></span><input class="form-control op-ans" data-ans="${it.id}" value="${esc(a.valor)}" placeholder="Escanear ou digitar..."></div>`;
    case 'assinatura': return `<div class="op-sign"><canvas id="csig-${it.id}" class="op-sign__pad" width="440" height="140"></canvas><div class="mt-1"><button type="button" class="rna-btn rna-btn-ghost rna-btn-sm" data-sigclear="${it.id}"><i class="bi bi-eraser"></i> Limpar</button></div></div>`;
    case 'checkbox': default: return `<button type="button" class="rna-btn ${a.valor === 'OK' ? 'rna-btn-primary' : 'rna-btn-ghost'} op-check" data-check="${it.id}"><i class="bi bi-check2"></i> ${a.valor === 'OK' ? 'Feito' : 'Marcar feito'}</button>`;
  }
}
function seg(it, opts, sel) { return `<div class="seg-btn" data-seg="${it.id}">${opts.map(o => `<button type="button" class="${sel === o ? segCls(o) : ''}" data-opt="${o}">${o}</button>`).join('')}</div>`; }
function segCls(o) { return o === 'Sim' ? 'sel-ok' : o === 'Não' ? 'sel-nok' : 'sel-na'; }
function limHint(it) { const l = [it.limite_min != null && it.limite_min !== '' ? `mín ${it.limite_min}` : '', it.limite_max != null && it.limite_max !== '' ? `máx ${it.limite_max}` : ''].filter(Boolean).join(' · '); return l ? `<small class="text-muted-2">Limite: ${l}<span class="op-fora-tag"><i class="bi bi-exclamation-triangle-fill"></i> fora</span></small>` : ''; }

async function concluir(exec, a, itens) {
  const btn = $('#ex-concluir'); btn.disabled = true;
  const falha = (msg) => { toast(msg, { type: 'warn' }); btn.disabled = false; };
  try {
    $$('.op-ans').forEach(el => { ANS[el.dataset.ans].valor = el.value; });
    $$('.op-obs').forEach(el => { ANS[el.dataset.obs].obs = el.value; });
    for (const it of itens) {
      const ans = ANS[it.id] || {};
      const precisaFoto = it.tipo_resposta === 'foto' || it.foto_obrigatoria;
      const assinado = SIG[it.id] && !SIG[it.id].isEmpty();
      if (it.tipo_resposta === 'assinatura' && !ans.foto && !assinado) return falha(`Assinatura obrigatória em “${it.nome}”.`);
      if (precisaFoto && !ans.foto && !UP[it.id]?.hasFiles()) return falha(`Foto obrigatória em “${it.nome}”.`);
      if (!['foto', 'assinatura'].includes(it.tipo_resposta) && String(ans.valor ?? '').trim() === '') return falha(`Responda “${it.nome}”.`);
      if (it.comentario_obrigatorio && String(ans.obs ?? '').trim() === '') return falha(`Comentário obrigatório em “${it.nome}”.`);
    }
    let nc = 0;
    for (const it of itens) {
      const ans = ANS[it.id] || {};
      let fotoUrl = ans.foto || null;
      if (UP[it.id]?.hasFiles()) { const evs = await UP[it.id].commit({ registro_tipo: 'op_checklist', registro_id: exec.id, usuario: USER }); if (evs[0]) fotoUrl = evs[0].url; }
      if (it.tipo_resposta === 'assinatura' && SIG[it.id] && !SIG[it.id].isEmpty()) fotoUrl = SIG[it.id].dataURL();
      const ok = ATIV.avaliarResposta(it, ans.valor);
      await ATIV.salvarItem(exec.id, it.id, { valor: ans.valor || '', obs: ans.obs || '', foto: fotoUrl, ok, status: ok ? 'ok' : 'nok' });
      if (!ok && it.abrir_pendencia) { nc++; await ATIV.abrirPendencia({ atividade_id: a.id, execucao_id: exec.id, plantao_id: exec.plantao_id, descricao: `Não conformidade em “${it.nome}”: “${ans.valor}” (esperado ${it.resposta_esperada || 'dentro do limite'})`, aberta_por: USER.id }); }
    }
    await ATIV.concluirExec(exec.id);
    await db.log({ usuario: USER.nome, acao: `Concluiu checklist ${a?.codigo || ''}`, entidade: 'op_execucao', antes: 'pendente', depois: 'concluida' });
    toast(`Checklist “${a?.nome || ''}” concluído.${nc ? ` ${nc} pendência(s) aberta(s).` : ''}`, { type: nc ? 'warn' : 'ok', title: 'Checklist' });
    voltarLista();
  } catch (err) { console.error('[op-checklists] concluir', err); toast('Erro ao concluir. ' + (err?.message || ''), { type: 'crit' }); btn.disabled = false; }
}

function initSignature(canvas) {
  const cx = canvas.getContext('2d'); cx.lineWidth = 2.2; cx.lineCap = 'round'; cx.strokeStyle = '#1b1d21';
  let drawing = false, empty = true;
  const pos = e => { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) }; };
  canvas.addEventListener('pointerdown', e => { drawing = true; const p = pos(e); cx.beginPath(); cx.moveTo(p.x, p.y); canvas.setPointerCapture?.(e.pointerId); e.preventDefault(); });
  canvas.addEventListener('pointermove', e => { if (!drawing) return; const p = pos(e); cx.lineTo(p.x, p.y); cx.stroke(); empty = false; e.preventDefault(); });
  const stop = () => { drawing = false; };
  canvas.addEventListener('pointerup', stop); canvas.addEventListener('pointerleave', stop);
  return { dataURL: () => canvas.toDataURL('image/png'), isEmpty: () => empty, clear: () => { cx.clearRect(0, 0, canvas.width, canvas.height); empty = true; } };
}

function voltarLista() { state.view = 'lista'; state.execId = null; history.replaceState(null, '', 'op-meus-checklists.html'); render(); }
function statusBadge(s) { const m = { pendente: ['badge-pend', 'Pendente'], em_andamento: ['badge-info', 'Em andamento'], concluida: ['badge-ok', 'Concluído'], nao_aplicavel: ['badge-na', 'Não aplicável'] }; const [cls, lb] = m[s] || ['badge-na', s]; return `<span class="rna-badge ${cls}">${lb}</span>`; }
function esc(s) { return String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
