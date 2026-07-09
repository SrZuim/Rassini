/* Minhas Rotinas — execução das rotinas atribuídas (Gestão Operacional) */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import * as ATIV from '../../../services/atividades.js';
import { $, $$, toast, modal, confirmDialog } from '../ui.js';
import { initEvidenceUpload } from '../evidence.js';

const ctx = await mountShell();
let USER;
const state = { view: 'lista', execId: null };
let UP = {};   // item_id -> uploader (fotos)

if (ctx) {
  USER = ctx.user;
  const ex = new URLSearchParams(location.search).get('exec');
  if (ex) { state.view = 'exec'; state.execId = ex; }
  render();
}

function head() {
  return `<div class="rna-page-head"><div>
    <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Operações <i class="bi bi-chevron-right"></i> Minhas Rotinas</div>
    <h1>Minhas Rotinas</h1><p>Rotinas atribuídas a você neste plantão — execute em qualquer ordem.</p></div></div>`;
}

async function render() {
  const plantao = await ATIV.plantaoAtivo(USER.id);
  if (!plantao) {
    $('#rna-content').innerHTML = head() + `<div class="rna-card"><div class="rna-card__body text-center" style="padding:38px 20px">
      <i class="bi bi-lock-fill" style="font-size:44px;color:var(--rna-gray-300)"></i>
      <h3 style="margin:14px 0 6px">Inicie o plantão primeiro</h3>
      <p class="text-muted-2" style="max-width:440px;margin:0 auto 16px">Suas rotinas são carregadas automaticamente ao iniciar o plantão.</p>
      <a href="op-plantao.html" class="rna-btn rna-btn-primary rna-btn-lg"><i class="bi bi-box-arrow-in-right"></i> Ir para o Plantão</a></div></div>`;
    return;
  }
  await ATIV.montarPlantao(USER, plantao, 'rotina');
  if (state.view === 'exec' && state.execId) return renderExec(plantao);
  return renderLista(plantao);
}

async function renderLista(plantao) {
  const execs = await ATIV.execucoesDo(plantao.id, USER, 'rotina');
  const r = ATIV.resumo(execs);
  const card = (e) => {
    const a = e.atividade || {};
    const feito = e.status === 'concluida' || e.status === 'nao_aplicavel';
    return `<div class="col-md-6 col-xl-4"><div class="rna-card h-100 op-rot-card ${feito ? 'is-done' : ''}">
      <div class="rna-card__body">
        <div class="d-flex justify-content-between align-items-start mb-1">
          <span class="op-code">${a.codigo || ''}</span>
          ${a.obrigatoria ? '<span class="rna-badge badge-crit">Obrigatória</span>' : '<span class="rna-badge badge-na">Opcional</span>'}
        </div>
        <b style="font-size:15px">${a.nome || '—'}</b>
        <div class="op-item__resp mt-1"><span><i class="bi bi-tag"></i> ${a.categoria || '—'}</span>${a.horario ? `<span><i class="bi bi-clock"></i> ${a.horario}</span>` : ''}${a.tempo_estimado ? `<span><i class="bi bi-stopwatch"></i> ${a.tempo_estimado} min</span>` : ''}</div>
        <div class="d-flex justify-content-between align-items-center mt-3">
          ${statusBadge(e.status)}
          ${feito
        ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-reabrir="${e.id}"><i class="bi bi-arrow-counterclockwise"></i> Reabrir</button>`
        : `<button class="rna-btn rna-btn-primary rna-btn-sm" data-exec="${e.id}"><i class="bi bi-play-fill"></i> Executar</button>`}
        </div>
      </div></div></div>`;
  };
  $('#rna-content').innerHTML = head() + `
    <div class="rna-card mb-3"><div class="rna-card__body d-flex flex-wrap align-items-center gap-3">
      <div class="flex-fill" style="min-width:200px">
        <div class="d-flex justify-content-between"><b>Progresso</b><b>${r.concluidas}/${r.total}</b></div>
        <div class="rna-progress mt-1"><span style="width:${r.pct}%;background:${r.pct === 100 ? 'var(--rna-ok)' : 'var(--rna-yellow)'}"></span></div>
      </div>
      <a href="op-plantao.html" class="rna-btn rna-btn-ghost"><i class="bi bi-speedometer2"></i> Painel do plantão</a>
    </div>
    ${execs.length ? `<div class="row g-3">${execs.map(card).join('')}</div>` : `<div class="empty-state"><i class="bi bi-inbox"></i><div>Nenhuma rotina atribuída a você hoje.</div></div>`}`;

  $$('[data-exec]').forEach(b => b.addEventListener('click', () => { state.view = 'exec'; state.execId = b.dataset.exec; render(); }));
  $$('[data-reabrir]').forEach(b => b.addEventListener('click', async () => { await ATIV.reabrirExec(b.dataset.reabrir); toast('Rotina reaberta.', { type: 'info' }); render(); }));
}

async function renderExec(plantao) {
  const exec = await db.get('op_execucao', state.execId);
  if (!exec) { state.view = 'lista'; return render(); }
  const a = await db.get('op_atividades', exec.atividade_id);
  const itens = await ATIV.itens(exec.atividade_id);
  const resultados = await ATIV.execItens(exec.id);
  const byItem = Object.fromEntries(resultados.map(r => [r.item_id, r]));
  UP = {};

  $('#rna-content').innerHTML = head() + `
    <div class="rna-card mb-3"><div class="rna-card__body d-flex flex-wrap align-items-center gap-3">
      <div class="rna-stat__icon ic-soft-yellow" style="margin:0"><i class="bi bi-list-check"></i></div>
      <div class="flex-fill"><h3 style="margin:0;font-size:16px">${a?.nome || '—'} <span class="op-code">${a?.codigo || ''}</span></h3>
        <small class="text-muted-2">${a?.descricao || ''}</small></div>
      ${a?.obrigatoria ? '<span class="rna-badge badge-crit">Obrigatória</span>' : ''}
      <button class="rna-btn rna-btn-ghost" id="ex-voltar"><i class="bi bi-arrow-left"></i> Voltar</button>
    </div></div>
    <div class="op-exec">${itens.map((it, i) => itemCard(it, byItem[it.id], i)).join('') || `<div class="empty-state"><i class="bi bi-inbox"></i><div>Esta rotina não tem itens cadastrados.</div></div>`}</div>
    <div class="d-flex gap-2 justify-content-end mt-3 mb-4">
      <button class="rna-btn rna-btn-ghost" id="ex-na"><i class="bi bi-slash-circle"></i> Não aplicável</button>
      <button class="rna-btn rna-btn-ghost" id="ex-pend"><i class="bi bi-exclamation-circle"></i> Abrir pendência</button>
      <button class="rna-btn rna-btn-primary rna-btn-lg" id="ex-concluir"><i class="bi bi-check2-circle"></i> Concluir rotina</button>
    </div>`;

  // uploaders de foto
  itens.forEach(it => {
    if (it.foto_obrigatoria || it.tipo_resposta === 'foto') {
      const host = $(`#foto-${it.id}`);
      if (host) UP[it.id] = initEvidenceUpload(host, { label: 'Foto do item', hint: 'Toque para câmera ou arquivo', multiple: false });
    }
  });
  // destaque numérico fora do limite
  $$('[data-num]').forEach(inp => {
    const it = itens.find(x => x.id === inp.dataset.num);
    const upd = () => inp.closest('.op-exec-item').classList.toggle('op-fora', ATIV.foraDoLimite(it, inp.value));
    inp.addEventListener('input', upd); upd();
  });

  $('#ex-voltar').addEventListener('click', () => { state.view = 'lista'; state.execId = null; history.replaceState(null, '', 'op-minhas-rotinas.html'); render(); });
  $('#ex-na').addEventListener('click', () => confirmDialog('Marcar esta rotina como Não Aplicável?', async () => { await ATIV.marcarNA(exec.id); toast('Rotina marcada como N/A.', { type: 'info' }); voltarLista(); }, { title: 'Não aplicável', okLabel: 'Confirmar' }));
  $('#ex-pend').addEventListener('click', () => abrirPendencia(exec, a, plantao));
  $('#ex-concluir').addEventListener('click', () => concluir(exec, a, itens, byItem));
}

function itemCard(it, res, i) {
  const val = res?.valor ?? '';
  const obs = res?.obs ?? '';
  const foto = res?.foto || null;
  const precisaFoto = it.foto_obrigatoria || it.tipo_resposta === 'foto';
  const controles = [];
  if (it.valor_numerico) {
    const lim = [it.limite_min != null ? `mín ${it.limite_min}` : '', it.limite_max != null ? `máx ${it.limite_max}` : ''].filter(Boolean).join(' · ');
    controles.push(`<div class="col-md-6"><label class="form-label">Valor ${it.unidade ? `(${it.unidade})` : ''}</label>
      <input class="form-control" data-item="${it.id}" data-f="valor" data-num="${it.id}" inputmode="decimal" value="${esc(val)}">
      ${lim ? `<small class="text-muted-2">Limite: ${lim} <span class="op-fora-tag"><i class="bi bi-exclamation-triangle-fill"></i> fora do padrão</span></small>` : ''}</div>`);
  } else if (it.tipo_resposta === 'texto') {
    controles.push(`<div class="col-12"><label class="form-label">Resposta</label><input class="form-control" data-item="${it.id}" data-f="valor" value="${esc(val)}"></div>`);
  }
  if (precisaFoto) {
    controles.push(`<div class="col-12"><label class="form-label">Foto ${it.foto_obrigatoria ? '<span class="text-danger">*</span>' : ''}</label>
      ${foto ? `<div class="mb-2"><img src="${foto}" class="op-foto-thumb"><small class="text-muted-2 ms-2">Foto registrada — envie outra para substituir.</small></div>` : ''}
      <div id="foto-${it.id}"></div></div>`);
  }
  controles.push(`<div class="col-12"><label class="form-label">Observação ${it.obs_obrigatoria ? '<span class="text-danger">*</span>' : ''}</label>
    <textarea class="form-control" data-item="${it.id}" data-f="obs" rows="2" placeholder="${it.obs_obrigatoria ? 'Observação obrigatória...' : 'Opcional'}">${esc(obs)}</textarea></div>`);

  return `<div class="rna-card mb-2 op-exec-item"><div class="rna-card__body">
    <div class="d-flex align-items-start gap-2">
      <div class="op-idx">${i + 1}</div>
      <div class="flex-fill"><b>${it.nome}</b>${it.descricao ? `<div class="cell-sub">${it.descricao}</div>` : ''}</div>
      ${it.peso ? `<span class="rna-badge badge-info" title="Peso">peso ${it.peso}</span>` : ''}
    </div>
    <div class="row g-2 mt-1">${controles.join('')}</div>
  </div></div>`;
}

async function concluir(exec, a, itens, byItem) {
  const btn = $('#ex-concluir'); btn.disabled = true;
  try {
    // lê os controles do DOM
    const dados = {};
    $$('[data-item]').forEach(el => { (dados[el.dataset.item] = dados[el.dataset.item] || {})[el.dataset.f] = el.value; });

    // valida obrigatórios
    for (const it of itens) {
      const d = dados[it.id] || {};
      if (it.valor_numerico && String(d.valor ?? '').trim() === '') { falha(`Informe o valor de “${it.nome}”.`); return; }
      if (it.obs_obrigatoria && String(d.obs ?? '').trim() === '') { falha(`Observação obrigatória em “${it.nome}”.`); return; }
      const temFotoExistente = !!byItem[it.id]?.foto;
      if (it.foto_obrigatoria && !temFotoExistente && !UP[it.id]?.hasFiles()) { falha(`Foto obrigatória em “${it.nome}”.`); return; }
    }

    // salva itens (com upload de foto quando houver)
    for (const it of itens) {
      const d = dados[it.id] || {};
      let fotoUrl = byItem[it.id]?.foto || null;
      if (UP[it.id]?.hasFiles()) {
        const evs = await UP[it.id].commit({ registro_tipo: 'op_rotina', registro_id: exec.id, usuario: USER });
        if (evs[0]) fotoUrl = evs[0].url;
      }
      const fora = ATIV.foraDoLimite(it, d.valor);
      await ATIV.salvarItem(exec.id, it.id, { valor: d.valor ?? '', obs: d.obs ?? '', foto: fotoUrl, ok: !fora, status: fora ? 'fora' : 'ok' });
      if (fora) {
        await ATIV.abrirPendencia({ atividade_id: a.id, execucao_id: exec.id, plantao_id: exec.plantao_id, descricao: `Valor fora do limite em “${it.nome}”: ${d.valor} ${it.unidade || ''}`.trim(), aberta_por: USER.id });
      }
    }
    await ATIV.concluirExec(exec.id);
    await db.log({ usuario: USER.nome, acao: `Concluiu rotina ${a?.codigo || ''}`, entidade: 'op_execucao', antes: 'pendente', depois: 'concluida' });
    toast(`Rotina “${a?.nome || ''}” concluída.`, { type: 'ok', title: 'Rotina' });
    voltarLista();
  } catch (err) { console.error('[op-rotinas] concluir', err); toast('Erro ao concluir. ' + (err?.message || ''), { type: 'crit' }); btn.disabled = false; }
  function falha(msg) { toast(msg, { type: 'warn' }); btn.disabled = false; }
}

function abrirPendencia(exec, a, plantao) {
  const m = modal({
    title: `Abrir pendência · ${a?.codigo || ''}`,
    content: `<div class="col-12"><label class="form-label">Descrição da pendência *</label><textarea class="form-control" id="pd-desc" rows="3" placeholder="Descreva o problema encontrado..."></textarea></div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button><button class="rna-btn rna-btn-dark" id="pd-ok"><i class="bi bi-exclamation-circle"></i> Abrir</button>`
  });
  $('#pd-ok', m.host).addEventListener('click', async () => {
    const desc = $('#pd-desc', m.host).value.trim();
    if (!desc) return toast('Descreva a pendência.', { type: 'warn' });
    await ATIV.abrirPendencia({ atividade_id: a.id, execucao_id: exec.id, plantao_id: plantao.id, descricao: desc, aberta_por: USER.id });
    m.close(); toast('Pendência aberta.', { type: 'ok' });
  });
}

function voltarLista() { state.view = 'lista'; state.execId = null; history.replaceState(null, '', 'op-minhas-rotinas.html'); render(); }
function statusBadge(s) {
  const m = { pendente: ['badge-pend', 'Pendente'], em_andamento: ['badge-info', 'Em andamento'], concluida: ['badge-ok', 'Concluída'], nao_aplicavel: ['badge-na', 'Não aplicável'] };
  const [cls, lb] = m[s] || ['badge-na', s];
  return `<span class="rna-badge ${cls}">${lb}</span>`;
}
function esc(s) { return String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
