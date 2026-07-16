/* ==========================================================================
   Minhas Rotinas — EXECUÇÃO das rotinas atribuídas (área do auditor).
   O auditor preenche apenas os resultados: limites, especificações, unidades,
   regras de validação e frequências são somente-leitura (definidos na Gestão
   Operacional). O status Conforme/Não Conforme é SEMPRE calculado pelo motor
   (services/rotinas.js) — nunca escolhido manualmente.
   ========================================================================== */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import * as ATIV from '../../../services/atividades.js';
import * as ROT from '../../../services/rotinas.js';
import { $, $$, toast, modal, confirmDialog } from '../ui.js';
import { initEvidenceUpload } from '../evidence.js';

const ctx = await mountShell();
let USER;
const state = { view: 'lista', execId: null };
let UP = {};       // item_id -> uploader (fotos)
let ITENS = [];    // itens do modelo/rotina (config somente leitura)
let VALORES = {};  // item_id -> { valor, obs, temFoto }
let CTX = {};      // contexto das regras condicionais (ex.: tipo_cliente)
let SALVANDO = false;

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
    const feito = ATIV.execFeita(e);
    const emCurso = ['em_andamento', 'rascunho'].includes(e.status);
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
        : `<button class="rna-btn rna-btn-primary rna-btn-sm" data-exec="${e.id}"><i class="bi ${emCurso ? 'bi-pencil-square' : 'bi-play-fill'}"></i> ${emCurso ? 'Continuar' : 'Executar'}</button>`}
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
  /* Itens vêm do MODELO vinculado (config central) ou da própria rotina
     (personalizada). Sem itens = rotina legada de ação única. */
  let itens = [];
  try { itens = await ROT.itensDaRotina(a); }
  catch (e) { return falhaCarregar('Não foi possível carregar os itens da rotina', e); }
  if (!itens.length) return renderExecUnica(exec, a);

  ITENS = itens;
  const salvos = await ROT.resultadosDe(exec.id);
  const byItem = Object.fromEntries(salvos.map(r => [r.item_id, r]));
  UP = {}; VALORES = {}; CTX = { ...(exec.contexto || {}) };
  itens.forEach(it => {
    const row = byItem[it.id];
    VALORES[it.id] = { valor: ROT.valorDe(row), obs: row?.obs || '', temFoto: !!row?.foto, foto: row?.foto || null };
    if (it.contexto_chave && VALORES[it.id].valor) CTX[it.contexto_chave] = VALORES[it.id].valor;
  });

  const modelo = a?.modelo_id ? await db.get('op_atividades', a.modelo_id).catch(() => null) : null;
  $('#rna-content').innerHTML = head() + blocoIdentificacao(exec, a, modelo, plantao)
    + `<div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-card-checklist"></i> Itens de inspeção</h3>
         <span class="text-muted-2" style="font-size:12.5px"><i class="bi bi-lock"></i> Especificações definidas na Gestão Operacional</span></div>
       <div class="rna-card__body" id="ex-itens"></div></div>
      <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-bar-chart"></i> Resumo</h3></div>
        <div class="rna-card__body" id="ex-resumo"></div></div>
      <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-flag"></i> Finalização</h3></div>
        <div class="rna-card__body">
          <label class="form-label">Observação geral</label>
          <textarea class="form-control" id="ex-obs-geral" rows="2" placeholder="Opcional">${esc(exec.obs_geral || '')}</textarea>
          <div id="ex-faltas" class="mt-2"></div>
          <div class="d-flex flex-wrap gap-2 justify-content-end mt-3">
            <button class="rna-btn rna-btn-ghost" id="ex-pend"><i class="bi bi-exclamation-circle"></i> Abrir pendência</button>
            <button class="rna-btn rna-btn-ghost" id="ex-rascunho"><i class="bi bi-save"></i> Salvar rascunho</button>
            <button class="rna-btn rna-btn-primary rna-btn-lg" id="ex-concluir"><i class="bi bi-check2-circle"></i> Finalizar rotina</button>
          </div>
        </div></div>`;

  $('#ex-voltar').addEventListener('click', voltarLista);
  $('#ex-pend').addEventListener('click', () => abrirPendencia(exec, a, plantao));
  $('#ex-rascunho').addEventListener('click', () => salvarTudo(exec, { rascunho: true }));
  $('#ex-concluir').addEventListener('click', () => finalizar(exec, a, plantao));
  pintarItens(exec);
}

function falhaCarregar(titulo, e) {
  console.error(`[ROTINAS] ${titulo}:`, { message: e?.message, code: e?.code, details: e?.details, hint: e?.hint });
  const mig = /column .* does not exist|schema cache|PGRST204/i.test(`${e?.message} ${e?.code}`);
  $('#rna-content').innerHTML = head() + `<div class="rna-card"><div class="rna-card__body">
    <div class="insp-blocker"><i class="bi bi-exclamation-octagon"></i><div><b>${esc(titulo)}</b>
    <div class="cell-sub">${mig ? 'Erro de configuração do banco: rode database/rotinas_inteligentes.sql no Supabase.' : esc(e?.message || 'Erro desconhecido')}</div></div></div>
    <button class="rna-btn rna-btn-ghost mt-3" onclick="history.back()"><i class="bi bi-arrow-left"></i> Voltar</button></div></div>`;
}

/* ------------------------------------------------- Bloco 1 — Identificação */
function blocoIdentificacao(exec, a, modelo, plantao) {
  const info = (l, v) => `<div><span class="insp-info-l">${l}</span><span class="insp-info-v">${esc(v || '—')}</span></div>`;
  const st = ROT.STATUS_EXEC[exec.status] || { label: exec.status, badge: 'badge-na' };
  return `<div class="rna-card mb-3"><div class="rna-card__body">
      <div class="d-flex flex-wrap align-items-center gap-3 mb-2">
        <div class="rna-stat__icon ic-soft-yellow" style="margin:0"><i class="bi bi-list-check"></i></div>
        <div class="flex-fill"><h3 style="margin:0;font-size:16px">${esc(a?.nome || '—')} ${a?.codigo ? `<span class="op-code">${esc(a.codigo)}</span>` : ''}</h3>
          <small class="text-muted-2">${esc(a?.descricao || '')}</small></div>
        <span class="rna-badge ${st.badge}">${st.label}</span>
        ${a?.obrigatoria ? '<span class="rna-badge badge-crit">Obrigatória</span>' : ''}
        <button class="rna-btn rna-btn-ghost" id="ex-voltar"><i class="bi bi-arrow-left"></i> Voltar</button>
      </div>
      <div class="insp-peca-grid">
        ${info('Modelo', modelo ? `${modelo.codigo} — ${modelo.nome}` : 'Rotina personalizada')}
        ${info('Versão do modelo', modelo ? `v${exec.modelo_versao || modelo.versao || 1}` : '—')}
        ${info('Data', ROT.hoje().split('-').reverse().join('/'))}
        ${info('Horário', a?.horario || '—')}
        ${info('Auditor', USER?.nome)}
        ${info('Setor', a?.setor || plantao?.planta || '—')}
      </div></div></div>`;
}

/* ---------------------------------- Bloco 2 — Itens (cálculo em tempo real) */
function itensAplicaveis() {
  return ITENS.filter(it => ROT.itemAplicavel(it, CTX, ROT.hoje()));
}
function pintarItens(exec) {
  const box = $('#ex-itens'); if (!box) return;
  const aplicaveis = itensAplicaveis();
  const ocultos = ITENS.length - aplicaveis.length;
  box.innerHTML = aplicaveis.map((it, i) => cardItem(it, i)).join('')
    + (ocultos ? `<div class="text-muted-2 mt-2" style="font-size:12.5px"><i class="bi bi-info-circle"></i> ${ocultos} item(ns) não se aplicam hoje (frequência ou regra de cliente) e não serão cobrados.</div>` : '');

  aplicaveis.forEach(it => {
    if (it.permite_foto) {
      const host = $(`#foto-${it.id}`);
      if (host) UP[it.id] = initEvidenceUpload(host, { label: 'Evidência', hint: 'Câmera ou arquivo', multiple: false });
    }
    const campo = $(`[data-item="${it.id}"][data-f="valor"]`);
    campo?.addEventListener('input', () => onValor(it, campo.value, exec));
    campo?.addEventListener('change', () => onValor(it, campo.value, exec));
    const obs = $(`[data-item="${it.id}"][data-f="obs"]`);
    obs?.addEventListener('input', () => { VALORES[it.id].obs = obs.value; });
  });
  pintarResumo();
}

/* Recalcula no ato (§16) — sem recarregar a página. */
function onValor(it, valor, exec) {
  VALORES[it.id].valor = valor;
  const res = ROT.avaliarItem(it, valor);
  const row = document.querySelector(`[data-row="${it.id}"]`);
  if (row) {
    row.querySelector('.op-res').outerHTML = pillResultado(res);
    row.classList.toggle('op-fora', res === 'nao_conforme');
    const obsBox = row.querySelector('.op-obs-wrap');
    if (obsBox) obsBox.classList.toggle('op-obs-req', res === 'nao_conforme');
    const lb = row.querySelector('.op-obs-label');
    if (lb) lb.innerHTML = `Observação ${res === 'nao_conforme' ? '<span class="text-danger">*</span>' : ''}`;
  }
  /* Item de contexto (tipo de cliente) liga/desliga os condicionais (§19). */
  if (it.contexto_chave) {
    const antes = CTX[it.contexto_chave];
    CTX[it.contexto_chave] = valor;
    if (antes !== valor) { pintarItens(exec); return; }
  }
  pintarResumo();
}

function pillResultado(res) {
  const r = ROT.RESULTADOS[res] || ROT.RESULTADOS.pendente;
  return `<span class="rna-badge ${r.badge} op-res"><i class="bi ${r.icon}"></i> ${r.label}</span>`;
}

function cardItem(it, i) {
  const v = VALORES[it.id] || { valor: '', obs: '' };
  const res = ROT.avaliarItem(it, v.valor);
  const unid = it.unidade_simbolo || it.unidade || '';
  const controle = () => {
    const base = `class="form-control" data-item="${it.id}" data-f="valor"`;
    switch (it.tipo_resposta) {
      case 'lista':
      case 'sim_nao':
      case 'conforme_nc': {
        const ops = it.opcoes?.length ? it.opcoes : (ROT.TIPOS_RESPOSTA_MAP[it.tipo_resposta]?.opcoes || []);
        return `<select class="form-select" data-item="${it.id}" data-f="valor"><option value="">—</option>
          ${ops.map(o => `<option ${String(v.valor) === String(o) ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      }
      case 'texto_longo': return `<textarea ${base} rows="2">${esc(v.valor)}</textarea>`;
      case 'data':        return `<input type="date" ${base} value="${esc(v.valor)}">`;
      case 'hora':        return `<input type="time" ${base} value="${esc(v.valor)}">`;
      case 'inteiro':     return `<input ${base} inputmode="numeric" value="${esc(v.valor)}" placeholder="${esc(unid)}">`;
      case 'decimal':     return `<input ${base} inputmode="decimal" value="${esc(v.valor)}" placeholder="${esc(unid)}">`;
      case 'foto':
      case 'anexo':       return `<div class="text-muted-2" style="font-size:12.5px">Anexe a evidência abaixo.</div>`;
      default:            return `<input ${base} value="${esc(v.valor)}" placeholder="${esc(unid)}">`;
    }
  };
  return `<div class="rna-card mb-2 op-exec-item ${res === 'nao_conforme' ? 'op-fora' : ''}" data-row="${it.id}"><div class="rna-card__body">
    <div class="d-flex align-items-start gap-2 flex-wrap">
      <div class="op-idx">${i + 1}</div>
      <div class="flex-fill" style="min-width:180px">
        <b>${esc(it.nome)}</b>${it.obrigatorio ? ' <span class="text-danger">*</span>' : ' <span class="rna-badge badge-na">Opcional</span>'}
        ${it.descricao ? `<div class="cell-sub">${esc(it.descricao)}</div>` : ''}
        <div class="op-item__resp mt-1">
          <span title="Especificação"><i class="bi bi-rulers"></i> ${esc(ROT.especificacaoTexto(it))}</span>
          ${unid ? `<span title="Unidade"><i class="bi bi-123"></i> ${esc(unid)}</span>` : ''}
          <span title="Frequência"><i class="bi bi-arrow-repeat"></i> ${esc(ROT.FREQUENCIAS_ITEM_MAP[it.frequencia_item]?.nome || '—')}</span>
        </div>
      </div>
      ${pillResultado(res)}
    </div>
    <div class="row g-2 mt-1">
      <div class="col-md-5"><label class="form-label">Resultado</label>${controle()}</div>
      ${it.permite_obs ? `<div class="col-md-7 op-obs-wrap ${res === 'nao_conforme' ? 'op-obs-req' : ''}">
        <label class="form-label op-obs-label">Observação ${res === 'nao_conforme' ? '<span class="text-danger">*</span>' : ''}</label>
        <textarea class="form-control" data-item="${it.id}" data-f="obs" rows="1" placeholder="${it.exige_foto_nc ? 'Obrigatória quando Não Conforme' : 'Opcional'}">${esc(v.obs)}</textarea></div>` : ''}
      ${it.permite_foto ? `<div class="col-12"><label class="form-label">Evidência ${it.exige_foto_nc ? '<span class="text-muted-2">(obrigatória se Não Conforme)</span>' : ''}</label>
        ${v.foto ? `<div class="mb-2"><img src="${esc(v.foto)}" class="op-foto-thumb"><small class="text-muted-2 ms-2">Evidência registrada — envie outra para substituir.</small></div>` : ''}
        <div id="foto-${it.id}"></div></div>` : ''}
    </div>
  </div></div>`;
}

/* --------------------------------------------------- Bloco 3 — Resumo (§20) */
function pintarResumo() {
  const box = $('#ex-resumo'); if (!box) return;
  const aplic = itensAplicaveis();
  const avals = aplic.map(it => ROT.avaliarItem(it, VALORES[it.id]?.valor));
  const r = ROT.resumoItens([...avals, ...Array(ITENS.length - aplic.length).fill('nao_aplicavel')]);
  const cel = (v, l, cor) => `<div class="insp-sum ${cor ? 'insp-sum-' + cor : ''}"><div class="insp-sum__v">${v}</div><div class="insp-sum__l">${l}</div></div>`;
  box.innerHTML = `<div class="insp-summary-grid">
      ${cel(ITENS.length, 'Total de itens')}
      ${cel(r.preenchidos, 'Preenchidos')}
      ${cel(r.conformes, 'Conformes', 'ok')}
      ${cel(r.naoConformes, 'Não conformes', 'crit')}
      ${cel(r.naoAplicaveis, 'Não aplicáveis')}
      ${cel(r.pct + '%', 'Conclusão')}
    </div>
    <div class="rna-progress mt-2"><span style="width:${r.pct}%;background:${r.naoConformes ? 'var(--rna-crit)' : r.pct === 100 ? 'var(--rna-ok)' : 'var(--rna-yellow)'}"></span></div>`;
}

/* Rotina de ação única: card + Concluir (modal obs/foto) + N/A */
function renderExecUnica(exec, a) {
  $('#rna-content').innerHTML = head() + `
    <div class="rna-card mb-3"><div class="rna-card__body d-flex flex-wrap align-items-center gap-3">
      <div class="rna-stat__icon ic-soft-yellow" style="margin:0"><i class="bi bi-list-check"></i></div>
      <div class="flex-fill"><h3 style="margin:0;font-size:16px">${a?.nome || '—'}</h3><small class="text-muted-2">${a?.descricao || ''}</small></div>
      ${a?.obrigatoria ? '<span class="rna-badge badge-crit">Obrigatória</span>' : ''}
      <button class="rna-btn rna-btn-ghost" id="ex-voltar"><i class="bi bi-arrow-left"></i> Voltar</button></div></div>
    <div class="rna-card"><div class="rna-card__body text-center" style="padding:34px 20px">
      <i class="bi bi-check2-circle" style="font-size:44px;color:var(--rna-yellow-600)"></i>
      <h3 style="margin:12px 0 4px">${a?.nome || 'Rotina'}</h3>
      <p class="text-muted-2">${a?.frequencia || ''}${a?.horario ? ` · ${a.horario}` : ''}</p>
      <div class="d-flex gap-2 justify-content-center">
        <button class="rna-btn rna-btn-primary rna-btn-lg" id="ex-concluir"><i class="bi bi-check2"></i> Concluir</button>
        ${a?.permite_na ? `<button class="rna-btn rna-btn-ghost rna-btn-lg" id="ex-na">N/A</button>` : ''}
      </div></div></div>`;
  $('#ex-voltar').addEventListener('click', voltarLista);
  $('#ex-na')?.addEventListener('click', () => confirmDialog('Marcar esta rotina como Não Aplicável?', async () => { await ATIV.marcarNA(exec.id); toast('Rotina marcada como N/A.', { type: 'info' }); voltarLista(); }, { title: 'Não aplicável', okLabel: 'Confirmar' }));
  $('#ex-concluir').addEventListener('click', () => modalConcluirUnica(exec, a));
}

function modalConcluirUnica(exec, a) {
  const obsMode = a?.exec_observacao || 'opcional', fotoMode = a?.exec_foto || 'opcional';
  const obsHtml = obsMode === 'nao' ? '' : `<div class="col-12"><label class="form-label">Observação ${obsMode === 'obrigatoria' ? '<span class="text-danger">*</span>' : ''}</label><textarea class="form-control" id="mc-obs" rows="2" placeholder="${obsMode === 'obrigatoria' ? 'Obrigatória' : 'Opcional'}"></textarea></div>`;
  const fotoHtml = fotoMode === 'nao' ? '' : `<div class="col-12"><label class="form-label">Foto ${fotoMode === 'obrigatoria' ? '<span class="text-danger">*</span>' : ''}</label><div id="mc-foto"></div></div>`;
  const m = modal({ title: `Concluir · ${a?.nome || ''}`, content: `<div class="row g-3">${obsHtml}${fotoHtml}${!obsHtml && !fotoHtml ? '<div class="col-12 text-muted-2" style="font-size:13px">Confirme a conclusão desta rotina.</div>' : ''}</div>`, footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button><button class="rna-btn rna-btn-primary" id="mc-ok"><i class="bi bi-check2"></i> Concluir</button>` });
  const up = fotoMode !== 'nao' ? initEvidenceUpload($('#mc-foto', m.host), { label: 'Foto', multiple: false }) : null;
  $('#mc-ok', m.host).addEventListener('click', async () => {
    const obs = obsMode === 'nao' ? '' : $('#mc-obs', m.host).value.trim();
    if (obsMode === 'obrigatoria' && !obs) return toast('Observação obrigatória.', { type: 'warn' });
    if (fotoMode === 'obrigatoria' && !up?.hasFiles()) return toast('Foto obrigatória.', { type: 'warn' });
    const btn = $('#mc-ok', m.host); btn.disabled = true;
    try {
      let fotoUrl = null;
      if (up?.hasFiles()) { const evs = await up.commit({ registro_tipo: 'op_rotina', registro_id: exec.id, usuario: USER }); if (evs[0]) fotoUrl = evs[0].url; }
      if (fotoUrl || obs) await ATIV.salvarItem(exec.id, 'rotina', { valor: '', obs, foto: fotoUrl, ok: true, status: 'ok' });
      await ATIV.concluirExec(exec.id, obs);
      await db.log({ usuario: USER.nome, acao: `Concluiu rotina ${a?.codigo || a?.nome || ''}`, entidade: 'op_execucao', antes: 'pendente', depois: 'concluida' });
      m.close(); toast(`Rotina “${a?.nome || ''}” concluída.`, { type: 'ok', title: 'Rotina' }); voltarLista();
    } catch (err) { btn.disabled = false; console.error(err); toast('Erro ao concluir. ' + (err?.message || ''), { type: 'crit' }); }
  });
}


/* Sobe as evidências pendentes e grava cada item COM snapshot (§23). */
async function salvarTudo(exec, { rascunho = false } = {}) {
  if (SALVANDO) return null;                                  // clique duplo (§26)
  SALVANDO = true;
  const btn = rascunho ? $('#ex-rascunho') : $('#ex-concluir');
  const orig = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Salvando...'; }
  try {
    const aplic = itensAplicaveis();
    for (const it of aplic) {
      const v = VALORES[it.id] || {};
      let foto = v.foto || null;
      if (UP[it.id]?.hasFiles()) {
        const evs = await UP[it.id].commit({ registro_tipo: 'op_rotina', registro_id: exec.id, usuario: USER });
        if (evs[0]) { foto = evs[0].url; v.foto = foto; v.temFoto = true; }
      }
      await ROT.salvarResultado(exec.id, it, { valor: v.valor, obs: v.obs, foto }, USER);
    }
    const avals = aplic.map(it => ROT.avaliarItem(it, VALORES[it.id]?.valor));
    const r = ROT.resumoItens([...avals, ...Array(ITENS.length - aplic.length).fill('nao_aplicavel')]);
    await db.update('op_execucao', exec.id, {
      status: rascunho ? 'rascunho' : exec.status, contexto: CTX,
      obs_geral: $('#ex-obs-geral')?.value || '',
      total_itens: ITENS.length, itens_conformes: r.conformes,
      itens_nao_conformes: r.naoConformes, itens_nao_aplicaveis: r.naoAplicaveis,
      atualizado_iso: ROT.nowISO(), iniciado_iso: exec.iniciado_iso || ROT.nowISO()
    });
    if (rascunho) toast('Rascunho salvo. Você pode continuar depois.', { type: 'ok', title: 'Rascunho' });
    return { aplic, resumo: r, avals };
  } catch (e) {
    console.error('[ROTINAS] Falha ao salvar', { message: e?.message, code: e?.code, details: e?.details, hint: e?.hint });
    const mig = /column .* does not exist|schema cache|PGRST204/i.test(`${e?.message} ${e?.code}`);
    toast(mig ? 'Erro de configuração do banco: rode database/rotinas_inteligentes.sql no Supabase.'
      : `Não foi possível salvar: ${e?.message || 'erro desconhecido'}`, { type: 'crit', title: 'Falha ao salvar', timeout: 9000 });
    return null;
  } finally {
    SALVANDO = false;
    if (btn) { btn.disabled = false; btn.innerHTML = orig; }
  }
}

/* Finalização: valida obrigatórios e o tratamento das NC, confirma e conclui. */
async function finalizar(exec, a, plantao) {
  const aplic = itensAplicaveis();
  // sincroniza o que está no DOM antes de validar
  aplic.forEach(it => { if (UP[it.id]?.hasFiles()) VALORES[it.id].temFoto = true; });
  const val = ROT.validarFinalizacao(aplic, VALORES);
  const box = $('#ex-faltas');
  if (!val.ok) {
    box.innerHTML = `<div class="insp-blocker"><i class="bi bi-exclamation-octagon"></i><div>
      <b>${val.faltas.length} pendência(s) impedem a finalização</b>
      <ul class="insp-ul mt-1">${val.faltas.map(f => `<li>${esc(f)}</li>`).join('')}</ul></div></div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  box.innerHTML = '';
  const avals = aplic.map(it => ROT.avaliarItem(it, VALORES[it.id]?.valor));
  const nc = avals.filter(x => x === 'nao_conforme').length;
  confirmDialog(
    nc ? `Esta rotina será finalizada com ${nc} item(ns) NÃO CONFORME. Uma pendência será aberta automaticamente. Deseja continuar?`
       : 'Finalizar esta rotina? Após a finalização ela fica registrada no histórico.',
    async () => {
      const r = await salvarTudo(exec, { rascunho: false });
      if (!r) return;                                          // erro real já exibido
      const status = ROT.statusFinal(r.avals);
      try {
        await db.update('op_execucao', exec.id, { status, concluido_iso: ROT.nowISO(), obs: $('#ex-obs-geral')?.value || '' });
        /* Uma pendência CONSOLIDADA por rotina reprovada (não uma por item). */
        if (status === 'concluida_nc') {
          const detalhes = r.aplic
            .filter(it => ROT.avaliarItem(it, VALORES[it.id]?.valor) === 'nao_conforme')
            .map(it => `${it.nome}: ${VALORES[it.id]?.valor} (esperado ${ROT.especificacaoTexto(it)})`);
          await ATIV.abrirPendencia({
            atividade_id: a.id, execucao_id: exec.id, plantao_id: exec.plantao_id,
            descricao: `Rotina “${a?.nome}” finalizada com ${detalhes.length} não conformidade(s) — ${detalhes.join(' · ')}.`,
            aberta_por: USER.id
          });
        }
        await db.log({ usuario: USER.nome, acao: `Finalizou rotina ${a?.codigo || a?.nome || ''}`, entidade: 'op_execucao', antes: 'em andamento', depois: ROT.STATUS_EXEC[status].label });
        toast(status === 'concluida_nc'
          ? `Rotina finalizada com não conformidade. Pendência aberta automaticamente.`
          : `Rotina “${a?.nome || ''}” finalizada.`, { type: status === 'concluida_nc' ? 'warn' : 'ok', title: 'Rotina', timeout: 6000 });
        voltarLista();
      } catch (e) {
        console.error('[ROTINAS] Falha ao finalizar', { message: e?.message, code: e?.code });
        toast(`Não foi possível finalizar: ${e?.message || 'erro desconhecido'}`, { type: 'crit' });
      }
    },
    { title: nc ? 'Finalizar com não conformidade' : 'Finalizar rotina', okLabel: 'Finalizar', danger: !!nc });
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
/* Status da execução (§21) — rótulos centralizados no motor. */
function statusBadge(s) {
  const st = ROT.STATUS_EXEC[s] || { label: s, badge: 'badge-na' };
  return `<span class="rna-badge ${st.badge}">${st.label}</span>`;
}
function esc(s) { return String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
