/* Checklist — tela de EXECUÇÃO OK/NOK/N-A (Construtor Visual) acionada pelo
   Plantão (op-plantao.html → cards de checklist → ?exec=<id>). O antigo módulo
   de menu "Meus Checklists" foi aposentado: o acesso é exclusivamente pelo
   Plantão, portanto abrir esta página sem ?exec redireciona para lá. */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import * as ATIV from '../../../services/atividades.js';
import { $, $$, toast, modal, confirmDialog } from '../ui.js';
import { initEvidenceUpload } from '../evidence.js';

const ctx = await mountShell();
let USER;
const state = { execId: null };
let UP = {}, ANS = {};

if (ctx) {
  USER = ctx.user;
  const ex = new URLSearchParams(location.search).get('exec');
  if (!ex) { location.replace('op-plantao.html'); }   // sem execução → volta ao Plantão
  else { state.execId = ex; render(); }
}

function head() {
  return `<div class="rna-page-head"><div>
    <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Operações <i class="bi bi-chevron-right"></i> <a href="op-plantao.html">Plantão</a> <i class="bi bi-chevron-right"></i> Checklist</div>
    <h1>Checklist</h1><p>Responda os itens do checklist deste plantão.</p></div></div>`;
}
const _cfg = (o = 'nao', f = 'nao', p = false) => ({ observacao: o, foto: f, criar_pendencia: !!p });
function cfgFor(it, ans) { return (ans === 'OK' ? it.cfg_ok : ans === 'NOK' ? it.cfg_nok : it.cfg_na) || _cfg(); }
function respList(it) { return (Array.isArray(it.respostas) && it.respostas.length) ? it.respostas : ['OK', 'NOK', 'N/A']; }
function segCls(o) { return o === 'OK' ? 'sel-ok' : o === 'NOK' ? 'sel-nok' : 'sel-na'; }

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
  return renderExec(plantao);
}

async function renderExec(plantao) {
  const exec = await db.get('op_execucao', state.execId);
  if (!exec) { location.replace('op-plantao.html'); return; }
  const a = await db.get('op_atividades', exec.atividade_id);
  const itens = await ATIV.itens(exec.atividade_id);
  const resultados = await ATIV.execItens(exec.id);
  const byItem = Object.fromEntries(resultados.map(r => [r.item_id, r]));
  UP = {}; ANS = {};
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

  itens.forEach(it => { if (ANS[it.id].valor) renderAnswerBlock(it); });
  $$('[data-seg] button').forEach(b => b.addEventListener('click', () => {
    const id = b.closest('[data-seg]').dataset.seg, ans = b.dataset.opt;
    ANS[id].valor = ans;
    b.closest('[data-seg]').querySelectorAll('button').forEach(x => x.className = '');
    b.className = segCls(ans);
    const it = itens.find(x => x.id === id); renderAnswerBlock(it);
  }));

  $('#ex-voltar').addEventListener('click', voltarLista);
  $('#ex-na').addEventListener('click', () => confirmDialog('Marcar este checklist como Não Aplicável?', async () => { await ATIV.marcarNA(exec.id); toast('Checklist marcado como N/A.', { type: 'info' }); voltarLista(); }, { title: 'Não aplicável', okLabel: 'Confirmar' }));
  $('#ex-concluir').addEventListener('click', () => concluir(exec, a, itens));
}

function itemCard(it, i) {
  return `<div class="rna-card mb-2 op-exec-item"><div class="rna-card__body">
    <div class="d-flex align-items-start gap-2"><div class="op-idx">${i + 1}</div>
      <div class="flex-fill"><b>${it.nome}</b></div>${it.peso ? `<span class="rna-badge badge-info">peso ${it.peso}</span>` : ''}</div>
    <div class="seg-btn mt-2" data-seg="${it.id}">${respList(it).map(o => `<button type="button" class="${ANS[it.id].valor === o ? segCls(o) : ''}" data-opt="${o}">${o}</button>`).join('')}</div>
    <div class="op-ans-block mt-2" id="ans-${it.id}"></div>
  </div></div>`;
}

function renderAnswerBlock(it) {
  const box = $(`#ans-${it.id}`); if (!box) return;
  const ans = ANS[it.id].valor; if (!ans) { box.innerHTML = ''; return; }
  const cfg = cfgFor(it, ans);
  const blocos = [];
  if (cfg.foto !== 'nao') blocos.push(`<div class="col-12"><label class="form-label">Foto ${cfg.foto === 'obrigatoria' ? '<span class="text-danger">*</span>' : ''}</label>${ANS[it.id].foto ? `<div class="mb-1"><img src="${ANS[it.id].foto}" class="op-foto-thumb"></div>` : ''}<div id="cfoto-${it.id}"></div></div>`);
  if (cfg.observacao !== 'nao') blocos.push(`<div class="col-12"><label class="form-label">Observação ${cfg.observacao === 'obrigatoria' ? '<span class="text-danger">*</span>' : ''}</label><textarea class="form-control op-obs" data-obs="${it.id}" rows="2" placeholder="${cfg.observacao === 'obrigatoria' ? 'Obrigatória' : 'Opcional'}">${esc(ANS[it.id].obs)}</textarea></div>`);
  if (cfg.criar_pendencia) blocos.push(`<div class="col-12"><span class="rna-badge badge-warn"><i class="bi bi-exclamation-circle"></i> Esta resposta gera pendência automática</span></div>`);
  box.innerHTML = blocos.length ? `<div class="row g-2">${blocos.join('')}</div>` : '';
  if (cfg.foto !== 'nao') { const h = $(`#cfoto-${it.id}`); if (h) UP[it.id] = initEvidenceUpload(h, { label: 'Foto', hint: 'Câmera ou arquivo', multiple: false }); } else { delete UP[it.id]; }
  const obsEl = $(`.op-obs[data-obs="${it.id}"]`, box); obsEl?.addEventListener('input', () => ANS[it.id].obs = obsEl.value);
}

async function concluir(exec, a, itens) {
  const btn = $('#ex-concluir'); btn.disabled = true;
  const falha = (msg) => { toast(msg, { type: 'warn' }); btn.disabled = false; };
  try {
    $$('.op-obs').forEach(el => { ANS[el.dataset.obs].obs = el.value; });
    for (const it of itens) {
      const ans = ANS[it.id];
      if (!ans.valor) return falha(`Responda “${it.nome}”.`);
      const cfg = cfgFor(it, ans.valor);
      if (cfg.observacao === 'obrigatoria' && !String(ans.obs || '').trim()) return falha(`Observação obrigatória em “${it.nome}”.`);
      if (cfg.foto === 'obrigatoria' && !ans.foto && !UP[it.id]?.hasFiles()) return falha(`Foto obrigatória em “${it.nome}”.`);
    }
    let nc = 0;
    for (const it of itens) {
      const ans = ANS[it.id]; const cfg = cfgFor(it, ans.valor);
      let fotoUrl = ans.foto || null;
      if (UP[it.id]?.hasFiles()) { const evs = await UP[it.id].commit({ registro_tipo: 'op_checklist', registro_id: exec.id, usuario: USER }); if (evs[0]) fotoUrl = evs[0].url; }
      const ok = ans.valor !== 'NOK';
      await ATIV.salvarItem(exec.id, it.id, { valor: ans.valor, obs: ans.obs || '', foto: fotoUrl, ok, status: ans.valor });
      if (cfg.criar_pendencia) { nc++; await ATIV.abrirPendencia({ atividade_id: a.id, execucao_id: exec.id, plantao_id: exec.plantao_id, descricao: `${ans.valor} em “${it.nome}”${ans.obs ? `: ${ans.obs}` : ''}`, aberta_por: USER.id }); }
    }
    await ATIV.concluirExec(exec.id);
    await db.log({ usuario: USER.nome, acao: `Concluiu checklist ${a?.codigo || ''}`, entidade: 'op_execucao', antes: 'pendente', depois: 'concluida' });
    toast(`Checklist “${a?.nome || ''}” concluído.${nc ? ` ${nc} pendência(s) aberta(s).` : ''}`, { type: nc ? 'warn' : 'ok', title: 'Checklist' });
    voltarLista();
  } catch (err) { console.error('[op-checklists] concluir', err); toast('Erro ao concluir. ' + (err?.message || ''), { type: 'crit' }); btn.disabled = false; }
}

function voltarLista() { location.href = 'op-plantao.html'; }   // execução aposentada como lista → volta ao Plantão
function esc(s) { return String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
