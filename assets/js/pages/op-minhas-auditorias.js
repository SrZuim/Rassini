/* ==========================================================================
   Meus Relatórios Dimensionais — Inspeção Dimensional (Operações)
   (renomeado de "Minhas Auditorias"; arquivo/rota/RBAC mantidos)
   Assistente por etapas: Tipo e peça → Identificação → Amostras → Medições →
   Revisão → Resultado. Cálculo automático (§9-11), autosave (§19), classes de
   defeito (§12-16), tratamento de reprovação + pendência (§17), finalização e
   bloqueio (§20-21). Especificações somente-leitura vindas da Biblioteca (§5).
   Toda persistência via inspecao.js (db demo ou Supabase, sem alteração).
   ========================================================================== */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { can, statusClass, podeVerMetricasTempo } from '../../../services/config.js';
import { fmtMedida } from '../../../services/formato.js';
import { formatarHoraBrasil, formatarDataHoraBrasil } from '../../../services/datahora.js';
import { normalizarIdentificadorMaiusculo, normalizarOP, opValida, opTemCaractereInvalido, MSG_OP_INVALIDA } from '../../../services/identificadores.js';
import * as INSP from '../../../services/inspecao.js';
import * as AMOSTRAS from '../../../services/insp-amostras.js';
import * as ATIV from '../../../services/atividades.js';
import { buscarParaInspecao, porId as pecaPorId, contarPecasDoTipo,
         tiposDaPeca, pecaAtendeTipo, nomeDoSlug,
         checarColunaTipos, MSG_MIGRACAO_TIPOS } from '../../../services/biblioteca.js';
import { BIB_IMG_PLACEHOLDER } from '../../../services/biblioteca-data.js';
import { INSP_QUANTIDADES, INSP_STATUS, INSP_MOTIVOS_PAUSA } from '../../../services/inspecao-data.js';
import { $, $$, el, toast, modal, confirmDialog, initials } from '../ui.js';
import { initEvidenceUpload } from '../evidence.js';

const ETAPAS = ['Tipo e peça', 'Identificação', 'Amostras', 'Medições', 'Revisão', 'Resultado'];

// Estado do módulo declarado ANTES do route() de topo — evita TDZ quando a página
// abre já com ?rel= (route → openWizard roda durante a init, antes das seções abaixo).
let USER, PLANTAO, USUARIOS = [], CLASSES = [];
let R, STEP = 0, VIEWONLY = false;   // wizard
let COLABORANDO = false;             // §M04 — relatório em andamento de outro auditor
let LOCAL;                            // modelo local de cálculo (medições)
let saveT;                           // timer do autosave
let PECA_ATUAL = null;                // peça da Biblioteca vinculada (dados atuais)

/* Logs de diagnóstico só em desenvolvimento — nunca registram token/senha/chave. */
const DEV = ['localhost', '127.0.0.1', ''].includes(location.hostname);
const dbg = (...a) => { if (DEV) console.log('%c[INSP]', 'color:#2b6cb0;font-weight:bold', ...a); };

const ctx = await mountShell();
if (ctx) {
  USER = ctx.user;
  PLANTAO = await ATIV.plantaoAtivo(USER.id);
  [USUARIOS, CLASSES] = await Promise.all([db.list('usuarios'), INSP.classes()]);
  route();
}

function route() {
  const params = new URLSearchParams(location.search);
  const rel = params.get('rel');
  if (rel) return openWizard(rel, params.get('view') === '1');
  renderList();
}
function go(url) { history.pushState({}, '', url); route(); }
window.addEventListener('popstate', route);

/* ============================================================== LISTA (§26) */
async function renderList() {
  /* §M04 — inclui os relatórios EM ANDAMENTO de outros auditores, abertos à
     colaboração. Os indicadores continuam calculados só sobre os MEUS, para não
     misturar a produtividade de terceiros na minha tela. */
  const rels = await INSP.relatoriosVisiveis(USER.id);
  const meus = rels.filter(r => !r._colaborativo);
  const ind = await INSP.indicadoresAuditorias(meus);
  const emAndamento = meus.filter(r => r.status === 'em_andamento' || r.status === 'rascunho').length;
  const colaborativos = rels.filter(r => r._colaborativo).length;
  const podeCriar = can(USER.role, 'op_auditorias', 'create');
  const cont = $('#rna-content');
  cont.innerHTML = `
    <div class="rna-page-head">
      <div><div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Operações <i class="bi bi-chevron-right"></i> Meus Relatórios Dimensionais</div>
      <h1>Meus Relatórios Dimensionais</h1><p>Inspeções dimensionais: medições, cálculo automático e relatório.</p></div>
      ${podeCriar ? `<button class="rna-btn rna-btn-primary" id="btn-nova"><i class="bi bi-plus-lg"></i> Nova inspeção</button>` : ''}
    </div>
    ${!PLANTAO ? `<div class="rna-card mb-3" style="border-left:4px solid var(--rna-yellow)"><div class="rna-card__body d-flex flex-wrap align-items-center gap-2">
      <i class="bi bi-exclamation-triangle" style="color:var(--rna-yellow);font-size:20px"></i>
      <span class="flex-fill">Você não tem um <b>plantão ativo</b>. A inspeção dimensional deve ser vinculada a um plantão em andamento.</span>
      <a href="op-plantao.html" class="rna-btn rna-btn-dark rna-btn-sm"><i class="bi bi-broadcast"></i> Iniciar plantão</a></div></div>` : ''}
    <div class="row g-3 mb-3">
      ${mini(ind.total, 'Inspeções realizadas', 'ic-soft-blue', 'bi-rulers')}
      ${mini(ind.aprovadas, 'Aprovadas', 'ic-soft-green', 'bi-check2-circle')}
      ${mini(ind.reprovadas, 'Reprovadas', 'ic-soft-red', 'bi-x-octagon')}
      ${mini(ind.pendencias, 'Pendências geradas', 'ic-soft-yellow', 'bi-exclamation-triangle')}
      ${podeVerMetricasTempo(USER.role) ? mini(INSP.fmtDuracao(ind.tempoMedio), 'Tempo médio/insp.', 'ic-soft-blue', 'bi-stopwatch') : ''}
      ${mini(ind.taxaAprovacao + '%', 'Taxa de aprovação', 'ic-soft-green', 'bi-graph-up-arrow')}
      ${mini(ind.taxaReprovacao + '%', 'Taxa de reprovação', 'ic-soft-red', 'bi-graph-down-arrow')}
      ${mini(emAndamento, 'Em andamento', 'ic-soft-yellow', 'bi-hourglass-split')}
    </div>
    <div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-list-ul"></i> Relatórios de inspeção</h3></div>
      <div class="rna-card__body p-0">${rels.length ? tabela(rels) : `<div class="empty-state" style="padding:40px"><i class="bi bi-rulers"></i><div>Nenhuma inspeção ainda. Clique em <b>Nova inspeção</b> para começar.</div></div>`}</div></div>`;

  $('#btn-nova')?.addEventListener('click', novaInspecao);
  $$('[data-open]', cont).forEach(b => b.addEventListener('click', () => go(`op-minhas-auditorias.html?rel=${b.dataset.open}`)));
  $$('[data-view]', cont).forEach(b => b.addEventListener('click', () => go(`op-minhas-auditorias.html?rel=${b.dataset.view}&view=1`)));
}

function tabela(rels) {
  const st = s => INSP_STATUS[s] || { label: s, badge: 'badge-na' };
  return `<div class="rna-table-wrap"><table class="rna-table"><thead><tr>
    <th>Relatório</th><th>Tipo</th><th>Cliente / Peça</th><th>PN · Rev</th><th>Lote · OP</th><th>Qtd</th><th>Progresso</th><th>Resultado</th><th>Ações</th>
    </tr></thead><tbody>
    ${rels.map(r => {
      const s = st(r.status);
      const fin = String(r.status).startsWith('finalizada') || r.status === 'revisada';
      return `<tr>
      <td class="cell-strong">${r.numero}
        ${r._colaborativo ? `<div class="cell-sub" title="Relatório de outro auditor, aberto para medição colaborativa"><span class="rna-badge badge-info"><i class="bi bi-people-fill"></i> Colaborativo</span> ${escTitle(r.auditor_nome || '')}</div>` : ''}</td>
      <td><span class="cell-sub">${r.tipo_nome || '—'}</span></td>
      <td>${r.cliente || '—'}<div class="cell-sub">${r.peca_nome || '—'}</div></td>
      <td>${r.peca_codigo || '—'}<div class="cell-sub">Rev ${r.revisao_desenho ?? '—'}</div></td>
      <td>${r.lote || '—'}<div class="cell-sub">OP ${r.op || '—'}</div></td>
      <td>${r.quantidade || '—'}</td>
      <td><span class="rna-badge ${s.badge}">${s.label}</span></td>
      <td>${resultadoPill(r.resultado)}</td>
      <td><div class="d-flex flex-wrap gap-1">
        ${fin ? `
          <button class="rna-btn rna-btn-ghost rna-btn-sm" data-view="${r.id}" title="Ver inspeção"><i class="bi bi-eye"></i> Ver</button>
          <a class="rna-btn rna-btn-ghost rna-btn-sm" href="consulta-dimensional.html?rel=${r.id}" title="Abrir relatório"><i class="bi bi-file-earmark-text"></i> Relatório</a>
          <a class="rna-btn rna-btn-ghost rna-btn-sm" href="consulta-dimensional.html?rel=${r.id}&print=1" title="Imprimir relatório"><i class="bi bi-printer"></i> Imprimir</a>
          ${r.status === 'finalizada_reprovada' ? `<a class="rna-btn rna-btn-dark rna-btn-sm" href="op-pendencias.html?rel=${r.id}" title="Ver pendência vinculada"><i class="bi bi-exclamation-triangle"></i> Ver Pendência</a>` : ''}`
        : `<button class="rna-btn rna-btn-primary rna-btn-sm" data-open="${r.id}"><i class="bi ${r._colaborativo ? 'bi-people-fill' : 'bi-pencil-square'}"></i> ${r._colaborativo ? 'Colaborar' : 'Continuar'}</button>`}
      </div></td></tr>`;
    }).join('')}
  </tbody></table></div>`;
}

const mini = (v, l, ic, icon) => `<div class="col-6 col-md-3"><div class="rna-stat"><div class="rna-stat__icon ${ic}"><i class="bi ${icon}"></i></div><div class="rna-stat__val" style="font-size:22px">${v}</div><div class="rna-stat__label">${l}</div></div></div>`;

function resultadoPill(r) {
  if (r === 'aprovado') return `<span class="insp-pill insp-ok"><i class="bi bi-check-circle-fill"></i> Aprovado</span>`;
  if (r === 'reprovado') return `<span class="insp-pill insp-crit"><i class="bi bi-x-circle-fill"></i> Reprovado</span>`;
  return `<span class="insp-pill insp-pend"><i class="bi bi-dash-circle"></i> Pendente</span>`;
}

/* ================================================= NOVA INSPEÇÃO (tipo) (§3) */
async function novaInspecao() {
  if (!PLANTAO) { toast('Inicie um plantão antes de criar uma inspeção.', { type: 'warn', title: 'Plantão obrigatório' }); return; }
  const tipos = await INSP.tiposDisponiveis();
  const m = modal({
    title: 'Nova inspeção dimensional', size: 'modal-lg',
    content: `<div class="mb-2"><label class="form-label">Tipo de inspeção *</label>
        <input class="form-control mb-2" id="ni-busca" placeholder="Pesquisar tipo..." autocomplete="off">
        <div id="ni-lista" class="insp-radio-list">${tiposHtml(tipos)}</div></div>
        <p class="text-muted-2" style="font-size:12.5px;margin:8px 0 0"><i class="bi bi-info-circle"></i> A inspeção será vinculada ao plantão ativo (${PLANTAO.turno} · ${PLANTAO.planta || '—'}). Auditor, planta, turno, data e horário são registrados automaticamente.</p>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-primary" id="ni-ok" disabled><i class="bi bi-play-fill"></i> Iniciar inspeção</button>`
  });
  let escolhido = null;
  const marcar = (id) => { escolhido = id; $$('#ni-lista .insp-radio', m.host).forEach(x => x.classList.toggle('is-sel', x.dataset.id === id)); $('#ni-ok', m.host).disabled = !id; };
  const bind = () => $$('#ni-lista .insp-radio', m.host).forEach(x => x.onclick = () => marcar(x.dataset.id));
  bind();
  $('#ni-busca', m.host).addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    $('#ni-lista', m.host).innerHTML = tiposHtml(tipos.filter(t => t.nome.toLowerCase().includes(q)));
    bind(); if (escolhido) marcar(escolhido);
  });
  $('#ni-ok', m.host).addEventListener('click', async () => {
    const tipo = tipos.find(t => t.id === escolhido); if (!tipo) return;
    $('#ni-ok', m.host).disabled = true;
    const rel = await INSP.criarRelatorio({ user: USER, plantao: PLANTAO, tipo });
    m.close(); go(`op-minhas-auditorias.html?rel=${rel.id}`);
  });
}
const tiposHtml = (tipos) => tipos.length ? tipos.map(t => `<div class="insp-radio" data-id="${t.id}"><div><b>${t.nome}</b>${t.is_dimensional ? '<span class="rna-badge badge-info ms-2">Dimensional</span>' : ''}</div><i class="bi bi-check-lg"></i></div>`).join('') : `<div class="text-muted-2 p-2">Nenhum tipo encontrado.</div>`;

/* ================================================================ WIZARD
   Estado (R, STEP, VIEWONLY) declarado no topo do módulo. */
async function openWizard(relId, viewonly = false) {
  VIEWONLY = viewonly;
  R = await INSP.carregarRelatorio(relId, { reparar: !viewonly });
  if (!R) { toast('A auditoria não foi encontrada.', { type: 'crit', title: 'Relatório inexistente' }); return renderList(); }
  const fin = String(R.rel.status).startsWith('finalizada') || R.rel.status === 'revisada';
  if (fin && !viewonly) VIEWONLY = true;           // finalizado só em modo leitura (§21)
  /* §M04 — colaboração: um relatório EM ANDAMENTO de outro auditor abre em modo
     EDITÁVEL para os auditores autorizados (o controle fino é por amostra, via
     trava). Quem não pode colaborar cai em leitura, sem erro. */
  COLABORANDO = !fin && R.rel.auditor_id !== USER.id;
  if (COLABORANDO && !INSP.podeColaborar(R.rel, USER)) {
    VIEWONLY = true;
    toast('Você não tem permissão para medir neste relatório. Abrindo em modo leitura.', { type: 'warn' });
  }
  MINHAS = new Set(); pararBatida();               // estado de trava é por abertura
  // Persistência (§reabrir): o vínculo vem do banco (peca_id) — nunca de memória
  // ou localStorage. Relê os dados ATUAIS da peça na Biblioteca Técnica.
  PECA_ATUAL = await carregarPecaVinculada(R.rel.peca_id);
  dbg('Auditoria aberta:', { id: R.rel.id, numero: R.rel.numero, peca_id: R.rel.peca_id, caracteristicas: R.caracteristicas.length });
  STEP = VIEWONLY ? 4 : (R.rel.etapa || 0);
  paintWizard();
}

/* Peça vinculada, relida da Biblioteca. null = removida do cadastro (o passo 0
   avisa e exige nova seleção). Falha de leitura não derruba a abertura. */
async function carregarPecaVinculada(pecaId) {
  if (!pecaId) return null;
  try { return await pecaPorId(pecaId); }
  catch (e) { INSP.logErro('Falha ao reler a peça vinculada', e); return null; }
}

/* `reparar: true` — esta é a tela dona da inspeção: ao abrir/recarregar, os
   resultados gravados por regras antigas (valor no limite marcado como
   reprovado, OK/NOK marcado como pendente) são corrigidos no banco. Relatório
   finalizado nunca é regravado (ver INSP.carregarRelatorio). */
async function reload() { R = await INSP.carregarRelatorio(R.rel.id, { reparar: !VIEWONLY }); }

function paintWizard() {
  const r = R.rel;
  $('#rna-content').innerHTML = `
    <div class="rna-page-head">
      <div><div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> <a href="op-minhas-auditorias.html" id="bc-back">Meus Relatórios Dimensionais</a><i class="bi bi-chevron-right"></i> ${r.numero}</div>
      <h1>${VIEWONLY ? 'Relatório de inspeção' : 'Inspeção dimensional'} <span class="insp-num">${r.numero}</span></h1>
      <p>${r.tipo_nome} ${r.peca_codigo ? '· ' + r.peca_codigo + ' — ' + r.peca_nome : ''}</p></div>
      <div class="d-flex align-items-center gap-2">
        <span id="insp-save" class="insp-save"></span>
        <button class="rna-btn rna-btn-ghost rna-btn-sm" id="bc-list"><i class="bi bi-arrow-left"></i> Voltar à lista</button>
      </div>
    </div>
    ${COLABORANDO && !VIEWONLY ? `<div class="insp-blocker mb-2" style="border-left:4px solid var(--rna-info)">
      <i class="bi bi-people-fill"></i> <div><b>Inspeção colaborativa.</b> Este relatório foi iniciado por
      ${escTitle(r.auditor_nome || 'outro auditor')}. Assuma uma peça na etapa <b>Medições</b> para registrar as suas
      medições — as demais continuam disponíveis para os outros auditores.</div></div>` : ''}
    <div class="insp-result-banner ${bannerClass(r.resultado)}" id="insp-banner">${bannerHtml(r.resultado)}</div>
    ${stepperHtml()}
    <div class="rna-card mt-3"><div class="rna-card__body" id="insp-step"></div></div>
    ${VIEWONLY ? '' : `<div class="insp-footnav">
      <button class="rna-btn rna-btn-ghost" id="nav-prev"><i class="bi bi-arrow-left"></i> Anterior</button>
      <div class="flex-fill"></div>
      <button class="rna-btn rna-btn-primary" id="nav-next">Avançar <i class="bi bi-arrow-right"></i></button>
    </div>`}`;

  $('#bc-list').addEventListener('click', () => go('op-minhas-auditorias.html'));
  $('#bc-back').addEventListener('click', e => { e.preventDefault(); go('op-minhas-auditorias.html'); });
  $$('#insp-stepper .insp-step').forEach(s => s.addEventListener('click', () => { const i = +s.dataset.i; if (i <= maxStepAllowed()) { STEP = i; renderStep(); } }));
  $('#nav-prev')?.addEventListener('click', () => { if (STEP > 0) { STEP--; renderStep(); } });
  $('#nav-next')?.addEventListener('click', onNext);
  renderStep();
}

function stepperHtml() {
  const max = maxStepAllowed();
  return `<div class="insp-stepper" id="insp-stepper">${ETAPAS.map((e, i) => {
    const done = i < STEP, cur = i === STEP, ok = i <= max;
    return `<div class="insp-step ${cur ? 'is-cur' : ''} ${done ? 'is-done' : ''} ${ok ? '' : 'is-lock'}" data-i="${i}">
      <span class="insp-step__n">${done ? '<i class="bi bi-check-lg"></i>' : i + 1}</span><span class="insp-step__l">${e}</span></div>`;
  }).join('')}</div>`;
}
function maxStepAllowed() {
  // libera navegação até onde os pré-requisitos permitem (autosave garante persistência)
  const r = R.rel;
  if (VIEWONLY) return ETAPAS.length - 1;
  let m = 0;
  if (r.tipo_id && pecaVinculada()) m = 1;
  if (m >= 1 && r.lote && opValida(r.op)) m = 2;
  if (m >= 2 && r.quantidade) m = 3;
  if (m >= 3 && R.caracteristicas.some(c => c.medicoes.length)) m = 4;
  if (m >= 4) m = 5;
  return m;
}

function bannerClass(r) { return r === 'aprovado' ? 'insp-ok' : r === 'reprovado' ? 'insp-crit' : 'insp-pend'; }
function bannerHtml(r) {
  const t = r === 'aprovado' ? 'APROVADO' : r === 'reprovado' ? 'REPROVADO' : 'EM PREENCHIMENTO';
  const ic = r === 'aprovado' ? 'bi-check-circle-fill' : r === 'reprovado' ? 'bi-x-octagon-fill' : 'bi-hourglass-split';
  return `<i class="bi ${ic}"></i> RESULTADO GERAL: <b>${t}</b>`;
}
function refreshBanner() {
  const b = $('#insp-banner'); if (!b) return;
  b.className = `insp-result-banner ${bannerClass(R.rel.resultado)}`; b.innerHTML = bannerHtml(R.rel.resultado);
}

/* ------------------------------------------------------------ autosave UI */
function flagSaving() { const s = $('#insp-save'); if (s) { s.className = 'insp-save is-saving'; s.innerHTML = '<i class="bi bi-arrow-repeat"></i> Salvando...'; } }
function flagSaved() { const s = $('#insp-save'); if (!s) return; s.className = 'insp-save is-ok'; s.innerHTML = '<i class="bi bi-check2"></i> Alterações salvas'; clearTimeout(saveT); saveT = setTimeout(() => { if ($('#insp-save')) $('#insp-save').className = 'insp-save'; }, 2500); }
/* Erro de salvamento: mostra a causa REAL (permissão, sessão, migration pendente,
   peça inexistente...) — nunca "verifique sua conexão" para tudo. O erro completo
   (message/code/details/hint) sai no console via INSP.logErro. */
function flagError(msg) {
  const s = $('#insp-save');
  if (!s) return;
  clearTimeout(saveT);
  s.className = 'insp-save is-err';
  s.title = msg;
  s.innerHTML = `<i class="bi bi-exclamation-octagon"></i> ${escTitle(msg)}`;
}
/** Executa `fn` com feedback de salvamento. Retorna true/false e NÃO lança — o
    chamador decide o que fazer (ex.: só confirmar sucesso se realmente salvou). */
async function autosave(fn, { contexto = 'Falha ao salvar', toastErro = true } = {}) {
  flagSaving();
  try {
    await fn();
    flagSaved();
    return true;
  } catch (e) {
    INSP.logErro(contexto, e);
    const msg = INSP.mensagemErro(e);
    flagError(msg);
    if (toastErro) toast(msg, { type: 'crit', title: 'Não foi possível salvar', timeout: 9000 });
    return false;
  }
}

/* ------------------------------------------------------------ navegação */
/* Só avança com peça REAL vinculada no banco (peca_id) e com as especificações
   já carregadas — nunca com texto digitado no campo de busca. */
function pecaVinculada() { return !!(R?.rel?.peca_id && R.caracteristicas.length); }

/* Habilita/desabilita o Avançar conforme os pré-requisitos da etapa atual. */
function atualizarNav() {
  const next = $('#nav-next');
  if (!next || VIEWONLY) return;
  const bloqueio = STEP === 0 && !(pecaVinculada() && !SELECIONANDO)
    ? 'Selecione uma peça da Biblioteca Técnica para avançar.' : '';
  next.disabled = !!bloqueio;
  next.title = bloqueio;
}

async function onNext() {
  const r = R.rel;
  if (STEP === 0 && !r.tipo_id) return toast('Tipo de inspeção ausente. Reabra a inspeção.', { type: 'warn' });
  if (STEP === 0 && !pecaVinculada())
    return toast('Selecione uma peça da Biblioteca Técnica. O vínculo precisa estar salvo antes de avançar.', { type: 'warn', title: 'Peça obrigatória' });
  if (STEP === 1 && (!String(r.lote).trim() || !String(r.op).trim())) return toast('Informe o lote e a OP.', { type: 'warn' });
  // §Erro 03 — campo obrigatório inválido não deixa avançar
  if (STEP === 1 && !opValida(r.op)) { $('#id-op')?.focus(); return toast(MSG_OP_INVALIDA, { type: 'warn', title: 'OP inválida' }); }
  if (STEP === 2 && !r.quantidade) return toast('Selecione a quantidade de peças.', { type: 'warn' });
  if (STEP < ETAPAS.length - 1) { STEP++; await INSP.patchRelatorio(r.id, { etapa: STEP }); renderStep(); }
}

function renderStep() {
  // atualiza stepper visual sem repintar tudo
  $('#insp-stepper')?.replaceWith(el(stepperHtml()));
  $$('#insp-stepper .insp-step').forEach(s => s.addEventListener('click', () => { const i = +s.dataset.i; if (i <= maxStepAllowed()) { STEP = i; renderStep(); } }));
  const host = $('#insp-step');
  const prev = $('#nav-prev'), next = $('#nav-next');
  if (prev) prev.style.visibility = STEP === 0 ? 'hidden' : 'visible';
  if (next) next.style.display = STEP >= ETAPAS.length - 1 ? 'none' : '';
  /* stepMedicoes é async (carrega o estado colaborativo das amostras); os demais
     são síncronos. `Promise.resolve` uniformiza sem quebrar os existentes. */
  Promise.resolve(({ 0: stepTipoPeca, 1: stepIdentificacao, 2: stepAmostras, 3: stepMedicoes, 4: stepRevisao, 5: stepResultado }[STEP])(host))
    .catch(e => { INSP.logErro('Falha ao renderizar a etapa', e); toast(INSP.mensagemErro(e), { type: 'crit' }); });
  atualizarNav();
}

/* ============================================================ ETAPA 0 (§5)
   Busca dinâmica na Biblioteca Técnica → vínculo pelo ID oficial da peça.
   RESULTADOS: guardados para validar a seleção contra a lista oficial (o auditor
   nunca avança com texto digitado — só com peça escolhida da Biblioteca). */
let RESULTADOS = [];      // última busca (fonte da validação do clique)
let SELECIONANDO = false; // trava anti-clique-duplo (§Teste 10)

async function stepTipoPeca(host) {
  const r = R.rel;
  const tipos = await INSP.tiposDisponiveis();
  /* §8 — quantas peças existem para ESTE tipo, antes de o auditor digitar.
     FALHA ≠ VAZIO (§5.1): se a consulta à Biblioteca der erro (rede, RLS, sessão
     expirada), dizer "nenhuma peça cadastrada" manda o auditor cadastrar peça
     que já existe. Os dois casos têm mensagem e tratamento próprios. */
  let disponiveis = 0, erroBiblioteca = null;
  try {
    disponiveis = await contarPecasDoTipo(r.tipo_slug);
  } catch (e) {
    erroBiblioteca = e;
    INSP.logErro('Falha ao consultar a Biblioteca Técnica', e);
  }
  const semPecas = !erroBiblioteca && disponiveis === 0;
  const bloqueado = !!erroBiblioteca || semPecas;
  /* Causa provável do "zero peças": o banco ainda não tem a coluna do vínculo.
     Sem isso a tela culpa o cadastro, que na verdade está correto. */
  const migracaoPendente = semPecas ? !(await checarColunaTipos()) : false;
  const podeCadastrar = can(USER.role, 'biblioteca', 'create');
  host.innerHTML = `
    <h3 class="insp-h"><i class="bi bi-diagram-3"></i> Tipo de inspeção e peça</h3>
    <div class="row g-3">
      <div class="col-md-5">
        <label class="form-label">Tipo de inspeção *</label>
        <select class="form-select" id="pc-tipo" ${VIEWONLY ? 'disabled' : ''}>
          ${tipos.map(t => `<option value="${t.id}" ${t.id === r.tipo_id ? 'selected' : ''}>${escTitle(t.nome)}</option>`).join('')}
        </select>
        <small class="text-muted-2">Define quais peças da Biblioteca ficam disponíveis. ${r.is_dimensional ? 'Exige medição dimensional.' : ''}</small>
      </div>
      <div class="col-md-7">
        <label class="form-label">Selecionar peça * <span class="text-muted-2">(Biblioteca Técnica)</span></label>
        <input class="form-control" id="pc-busca" placeholder="PN, nome, cliente, número da AD, revisão..." autocomplete="off" ${VIEWONLY || bloqueado ? 'disabled' : ''}>
        <div id="pc-res" class="insp-search-res"></div>
        ${erroBiblioteca
          ? `<div class="insp-blocker mt-2"><i class="bi bi-exclamation-octagon"></i>
              <div>Não foi possível consultar a Biblioteca Técnica. ${escTitle(INSP.mensagemErro(erroBiblioteca))}
              <div class="mt-2"><button class="rna-btn rna-btn-dark rna-btn-sm" id="pc-retry"><i class="bi bi-arrow-clockwise"></i> Tentar novamente</button></div></div></div>`
          : semPecas
          ? `<div class="insp-blocker mt-2"><i class="bi bi-exclamation-triangle"></i>
              <div>${migracaoPendente
                  ? `A Biblioteca Técnica não consegue informar os tipos de inspeção das peças. ${escTitle(MSG_MIGRACAO_TIPOS)}`
                  : 'Nenhuma peça cadastrada para este tipo de inspeção. Verifique o cadastro na Biblioteca Técnica.'}
              ${podeCadastrar ? `<div class="mt-2"><a class="rna-btn rna-btn-dark rna-btn-sm" href="biblioteca.html"><i class="bi bi-box-seam"></i> Cadastrar ou configurar peça</a></div>` : ''}</div></div>`
          : `<small class="text-muted-2">Somente peças ativas e aplicáveis a <b>${escTitle(r.tipo_nome)}</b> (${disponiveis} disponível(is)). Pesquise por PN, nome, cliente, AD ou revisão.</small>`}
      </div>
    </div>
    <div id="pc-sel" class="mt-3">${pecaSelHtml(r)}</div>`;

  if (VIEWONLY) return;
  $('#pc-tipo').addEventListener('change', e => trocarTipo(e.target.value, tipos));
  // Erro de consulta é recuperável: refaz só esta etapa, sem recarregar a tela.
  $('#pc-retry')?.addEventListener('click', () => stepTipoPeca(host));
  if (bloqueado) return;                              // campo desabilitado (§8)
  const inp = $('#pc-busca'), res = $('#pc-res');
  let t;
  inp.addEventListener('input', () => {
    clearTimeout(t);
    const q = inp.value.trim();
    if (q.length < 2) { RESULTADOS = []; res.innerHTML = ''; return; }
    res.innerHTML = `<div class="text-muted-2 p-2"><span class="spinner-border spinner-border-sm"></span> Carregando Biblioteca Técnica...</div>`;
    t = setTimeout(async () => {
      try {
        // §11 — o recorte por tipo é aplicado no serviço; a tela nunca recebe peça incompatível.
        RESULTADOS = await buscarParaInspecao(q, 8, { tipo: R.rel.tipo_slug });
      } catch (e) {
        INSP.logErro('Falha ao consultar a Biblioteca Técnica', e);
        RESULTADOS = [];
        res.innerHTML = `<div class="insp-blocker"><i class="bi bi-exclamation-octagon"></i> ${escTitle(INSP.mensagemErro(e))}</div>`;
        return;
      }
      if (inp.value.trim() !== q) return;              // resposta velha: ignora
      res.innerHTML = RESULTADOS.length
        ? RESULTADOS.map(pecaItemHtml).join('')
        : `<div class="text-muted-2 p-2"><i class="bi bi-search"></i> Nenhuma peça de <b>${escTitle(R.rel.tipo_nome)}</b> encontrada para "${escTitle(q)}".</div>`;
      $$('.insp-search-item', res).forEach(it => it.addEventListener('click', () => selecionarPeca(it.dataset.id)));
    }, 250);
  });
}

/* §7 — Troca do tipo de inspeção. Se a peça já vinculada não for aplicável ao
   novo tipo, o vínculo E todos os dados dependentes (snapshot das características
   e medições) são limpos: nada de peça incompatível permanece carregado. */
async function trocarTipo(tipoId, tipos) {
  const tipo = tipos.find(t => t.id === tipoId);
  if (!tipo || tipo.id === R.rel.tipo_id) return;
  const peca = PECA_ATUAL;
  const incompativel = !!(R.rel.peca_id && peca && !pecaAtendeTipo(peca, tipo.slug));
  const aplicar = async () => {
    const ok = await autosave(async () => {
      await INSP.trocarTipoInspecao(R.rel.id, tipo, { limparPeca: incompativel || !!R.rel.peca_id && !peca });
      await reload();
    }, { contexto: 'Falha ao trocar o tipo de inspeção' });
    if (!ok) return;
    if (incompativel) {
      PECA_ATUAL = null; RESULTADOS = [];
      toast('A peça selecionada não é aplicável ao novo tipo de inspeção. Selecione outra peça.',
        { type: 'warn', title: 'Peça removida', timeout: 8000 });
    }
    renderStep(); refreshBanner();
  };
  // Troca destrutiva (há medições) exige confirmação explícita do auditor.
  const temMedicoes = R.caracteristicas.some(c => c.medicoes.length);
  if (incompativel && temMedicoes) {
    // O select volta ao tipo persistido enquanto a confirmação está aberta: se o
    // auditor cancelar, a tela continua refletindo exatamente o que está salvo.
    const sel = $('#pc-tipo'); if (sel) sel.value = R.rel.tipo_id;
    return confirmDialog(
      `A peça ${R.rel.peca_codigo || ''} não é aplicável a "${tipo.nome}". Trocar o tipo vai remover a peça e as medições já preenchidas. Deseja continuar?`,
      aplicar,
      { title: 'Trocar tipo de inspeção', okLabel: 'Trocar e limpar', danger: true });
  }
  aplicar();
}

/* Resultado da busca: PN, nome, cliente, revisão, AD, código interno, imagem e status. */
function pecaItemHtml(p) {
  const img = p.imagem || BIB_IMG_PLACEHOLDER;
  const meta = [p.cliente, p.revisao_desenho != null && p.revisao_desenho !== '' ? `Rev. ${p.revisao_desenho}` : null,
    p.numero_ad ? `AD ${p.numero_ad}` : null, p.familia].filter(Boolean).join(' · ');
  return `<div class="insp-search-item d-flex align-items-center gap-2" data-id="${p.id}">
    <img src="${escTitle(img)}" alt="" class="insp-search-thumb">
    <div class="flex-fill">
      <div><b>${escTitle(p.codigo)}</b> — ${escTitle(p.nome)}</div>
      <div class="cell-sub">${escTitle(meta) || '—'}</div>
    </div>
    <span class="rna-badge ${statusClass(p.status)}">${escTitle(p.status || 'Ativo')}</span>
  </div>`;
}

/* Vincula a peça à auditoria: valida contra a lista oficial → salva o ID no banco
   → confirma → recarrega o estado → libera o Avançar. Sem duplicidade e sem
   depender de localStorage: a fonte da verdade é o registro no banco. */
async function selecionarPeca(pecaId) {
  if (SELECIONANDO) return;                                    // clique duplo (§Teste 10)
  const peca = RESULTADOS.find(p => p.id === pecaId);          // só a lista oficial vale
  if (!peca) {
    toast('A peça selecionada não foi encontrada na Biblioteca Técnica. Refaça a busca.', { type: 'warn' });
    return;
  }
  SELECIONANDO = true;
  atualizarNav();                                              // trava o Avançar enquanto salva
  const res = $('#pc-res'), sel = $('#pc-sel');
  res.innerHTML = `<div class="text-muted-2 p-2"><span class="spinner-border spinner-border-sm"></span> Salvando peça na auditoria...</div>`;
  flagSaving();
  dbg('Vinculando peça à auditoria:', { auditoria: R.rel.id, peca_id: peca.id, pn: peca.codigo, auditor: USER?.id });
  try {
    const n = await INSP.carregarEspecs(R.rel.id, peca.id);    // grava o ID no banco
    await reload();                                            // estado local ← banco
    dbg('Vínculo salvo. Relatório no banco:', { peca_id: R.rel.peca_id, caracteristicas: R.caracteristicas.length });
    PECA_ATUAL = peca;
    RESULTADOS = [];
    res.innerHTML = ''; $('#pc-busca').value = '';
    sel.innerHTML = pecaSelHtml(R.rel);
    flagSaved();
    refreshBanner();
    toast(`Peça ${peca.codigo} vinculada com sucesso — ${n} característica(s) carregada(s).`, { type: 'ok', title: 'Peça vinculada', timeout: 4000 });
  } catch (e) {
    // Causa real: permissão, sessão, migration, peça inativa, cadastro incompleto...
    INSP.logErro('Falha ao vincular a peça à auditoria', e);
    const msg = INSP.mensagemErro(e);
    flagError(msg);
    res.innerHTML = '';
    // Mantém o card da peça anterior, se ainda houver um vínculo válido salvo.
    sel.innerHTML = `<div class="insp-blocker mb-2"><i class="bi bi-exclamation-octagon"></i> <div>${escTitle(msg)}</div></div>`
      + (pecaVinculada() ? pecaSelHtml(R.rel) : '');
    toast(msg, { type: 'crit', title: 'Não foi possível vincular a peça', timeout: 9000 });
  } finally {
    SELECIONANDO = false;
    atualizarNav();                                            // libera o Avançar se houve sucesso
  }
}

/* Bloco da peça selecionada: avisa quando o cadastro sumiu ou está inativo
   (§Teste 8) e, fora isso, mostra o card com os dados atuais da Biblioteca. */
function pecaSelHtml(r) {
  if (!r.peca_id) return '';
  if (!PECA_ATUAL) {
    return `<div class="insp-blocker"><i class="bi bi-exclamation-octagon"></i>
      <div><b>A peça vinculada não existe mais na Biblioteca Técnica.</b>
      <div class="cell-sub">PN ${escTitle(r.peca_codigo || '—')} — ${escTitle(r.peca_nome || '')}. O cadastro foi removido. Selecione outra peça para continuar.</div></div></div>`;
  }
  const inativa = PECA_ATUAL.ativo === false || ['Arquivado', 'Obsoleto'].includes(PECA_ATUAL.status);
  const aviso = inativa ? `<div class="insp-blocker mb-2"><i class="bi bi-exclamation-triangle"></i>
    <div>O cadastro desta peça está <b>${escTitle(PECA_ATUAL.status || 'inativo')}</b> na Biblioteca Técnica. Confirme com a Engenharia antes de concluir a inspeção.</div></div>` : '';
  return aviso + pecaCard(r);
}

function pecaCard(r) {
  const nCar = R.caracteristicas.length;
  const p = PECA_ATUAL || {};
  const img = p.imagem || BIB_IMG_PLACEHOLDER;
  return `<div class="insp-peca-card">
    <div class="insp-peca-card__head"><i class="bi bi-box-seam"></i> <b>${escTitle(r.peca_codigo)}</b> — ${escTitle(r.peca_nome)}
      <span class="rna-badge badge-ok ms-auto"><i class="bi bi-check2"></i> ${nCar} característica(s)</span></div>
    <div class="d-flex gap-3 flex-wrap">
      <img src="${escTitle(img)}" alt="Imagem da peça ${escTitle(r.peca_codigo)}" class="insp-peca-img">
      <div class="flex-fill">
        <div class="insp-peca-grid">
          ${info('Cliente', r.cliente)} ${info('PN', r.peca_codigo)} ${info('Desenho / Rev', 'Rev ' + (r.revisao_desenho ?? '—'))}
          ${info('Data da revisão', r.data_revisao_desenho)} ${info('Número da AD', r.numero_ad)} ${info('Quadrante', r.quadrante || '—')}
        </div>
      </div>
    </div>
    <small class="text-muted-2"><i class="bi bi-lock"></i> As especificações são somente para consulta e cálculo — não podem ser alteradas na inspeção.</small>
  </div>`;
}
const info = (l, v) => `<div><span class="insp-info-l">${l}</span><span class="insp-info-v">${v || '—'}</span></div>`;

/* ============================================================ ETAPA 1 (§7) */
function stepIdentificacao(host) {
  const r = R.rel, o = r.campos_opcionais || {};
  const dis = VIEWONLY ? 'disabled' : '';
  host.innerHTML = `
    <h3 class="insp-h"><i class="bi bi-upc-scan"></i> Identificação do lote e OP</h3>
    <div class="row g-3">
      <div class="col-md-4"><label class="form-label" for="id-lote">Lote *</label>
        <input class="form-control insp-upper" id="id-lote" value="${escTitle(r.lote || '')}" placeholder="Ex.: L-2026-0043"
               autocapitalize="characters" autocomplete="off" maxlength="60" ${dis}>
        <small class="text-muted-2">Convertido automaticamente para letras maiúsculas.</small></div>
      <div class="col-md-4"><label class="form-label" for="id-op">OP — Ordem de Produção *</label>
        <input class="form-control" id="id-op" value="${escTitle(r.op || '')}" placeholder="Ex.: 088123"
               inputmode="numeric" autocomplete="off" maxlength="20" ${dis}>
        <div class="insp-campo-erro" id="err-op" hidden></div>
        <small class="text-muted-2">Somente números. Zeros à esquerda são preservados.</small></div>
      <div class="col-md-4"><label class="form-label" for="id-linha">Linha</label><input class="form-control" id="id-linha" value="${escTitle(r.linha || '')}" placeholder="Linha" ${dis}></div>
    </div>
    <details class="insp-details mt-3"><summary>Campos opcionais</summary>
      <div class="row g-3 mt-1">
        ${opc('Data de fabricação', 'data_fabricacao', o, dis, 'date')}
        ${opc('Turno', 'turno', o, dis)}
        ${opc('Máquina', 'maquina', o, dis)}
        ${opc('Fornecedor', 'fornecedor', o, dis)}
        ${opc('Código interno', 'codigo_interno', o, dis)}
        ${opc('Lote do fornecedor', 'lote_fornecedor', o, dis)}
        <div class="col-12">${opcTa('Observação', 'observacao', o, dis)}</div>
      </div>
    </details>`;
  if (VIEWONLY) return;

  /* §Erro 02 — LOTE em maiúsculas durante a digitação e no Ctrl+V, preservando a
     posição do cursor (sem isso o cursor pula para o fim a cada tecla). O valor
     é normalizado de novo antes de gravar (services/inspecao.js). */
  const lote = $('#id-lote');
  lote.addEventListener('input', () => {
    // durante a digitação só a caixa muda (aparar espaços aqui impediria digitá-los)
    const pos = lote.selectionStart, fim = lote.selectionEnd;
    const up = lote.value.toLocaleUpperCase('pt-BR');
    if (up !== lote.value) { lote.value = up; try { lote.setSelectionRange(pos, fim); } catch { /* campo sem seleção */ } }
  });
  // ao sair do campo aplica a regra completa (mesma da gravação)
  lote.addEventListener('blur', () => { lote.value = normalizarIdentificadorMaiusculo(lote.value); });

  /* §Erro 03 — OP somente dígitos: letras e símbolos são descartados na hora
     (inclusive em conteúdo colado) e o auditor é avisado do que foi bloqueado. */
  const op = $('#id-op'), errOp = $('#err-op');
  const avisoOp = (mostrar) => { errOp.hidden = !mostrar; errOp.textContent = mostrar ? MSG_OP_INVALIDA : ''; op.classList.toggle('is-erro', !!mostrar); };
  op.addEventListener('input', () => {
    const invalido = opTemCaractereInvalido(op.value);
    if (invalido) {
      const pos = op.selectionStart;
      const antes = normalizarOP(op.value.slice(0, pos)).length;
      op.value = normalizarOP(op.value);
      try { op.setSelectionRange(antes, antes); } catch { /* campo sem seleção */ }
    }
    avisoOp(invalido);
  });
  op.addEventListener('blur', () => { if (op.value && !opValida(op.value)) avisoOp(true); });

  const persist = () => autosave(async () => {
    await INSP.salvarIdentificacao(r.id, {
      lote: lote.value, op: op.value, linha: $('#id-linha').value, campos_opcionais: collectOpc()
    });
    await reload();
    // reflete na tela exatamente o que foi salvo (fonte da verdade = banco)
    lote.value = R.rel.lote || ''; op.value = R.rel.op || '';
  }, { contexto: 'Falha ao salvar a identificação' });
  ['id-lote', 'id-op', 'id-linha'].forEach(id => $('#' + id).addEventListener('change', persist));
  $$('[data-opc]', host).forEach(i => i.addEventListener('change', persist));
}
const clean = v => String(v || '').trim().replace(/\s+/g, ' ');
const opc = (l, k, o, dis, type = 'text') => `<div class="col-md-4"><label class="form-label">${l}</label><input type="${type}" class="form-control" data-opc="${k}" value="${o[k] || ''}" ${dis}></div>`;
const opcTa = (l, k, o, dis) => `<label class="form-label">${l}</label><textarea class="form-control" rows="2" data-opc="${k}" ${dis}>${o[k] || ''}</textarea>`;
function collectOpc() { const o = {}; $$('[data-opc]').forEach(i => { const v = clean(i.value); if (v) o[i.dataset.opc] = v; }); return o; }

/* ============================================================ ETAPA 2 (§6) */
function stepAmostras(host) {
  const r = R.rel;
  host.innerHTML = `
    <h3 class="insp-h"><i class="bi bi-collection"></i> Quantidade de peças auditadas</h3>
    <p class="text-muted-2">Define automaticamente as colunas de medição (1 a 5 peças).</p>
    <div class="insp-qtd">${INSP_QUANTIDADES.map(q => `<button class="insp-qtd__b ${r.quantidade === q ? 'is-sel' : ''}" data-q="${q}" ${VIEWONLY ? 'disabled' : ''}>
      <span class="insp-qtd__n">${q}</span><span>peça${q > 1 ? 's' : ''}</span></button>`).join('')}</div>`;
  if (VIEWONLY) return;
  $$('.insp-qtd__b', host).forEach(b => b.addEventListener('click', () => escolherQtd(+b.dataset.q)));
}
async function escolherQtd(q) {
  const atual = R.rel.quantidade;
  if (atual && q < atual) {
    const afetadas = await INSP.medicoesAcimaDe(R.rel.id, q);
    if (afetadas.length) {
      return confirmDialog(
        `Reduzir para ${q} peça(s) vai remover ${afetadas.length} medição(ões) já preenchida(s) das amostras acima de ${q}. Deseja continuar?`,
        () => aplicarQtd(q), { title: 'Confirmar redução de amostras', okLabel: 'Reduzir e remover', danger: true });
    }
  }
  aplicarQtd(q);
}
async function aplicarQtd(q) {
  const ok = await autosave(async () => { await INSP.aplicarQuantidade(R.rel.id, q); await reload(); },
    { contexto: 'Falha ao aplicar a quantidade de amostras' });
  if (!ok) return;                                   // erro real já exibido — não marca como salvo
  $$('.insp-qtd__b').forEach(b => b.classList.toggle('is-sel', +b.dataset.q === q));
  refreshBanner();
}

/* ============================================================ ETAPA 3 (§8-17)
   LOCAL: modelo p/ cálculo em tempo real { [carId]: { min,max,vals:{amostra:valor} } } */
async function stepMedicoes(host) {
  const r = R.rel;
  if (!r.quantidade) { host.innerHTML = `<div class="insp-blocker"><i class="bi bi-info-circle"></i> Selecione a quantidade de peças na etapa <b>Amostras</b> antes de medir.</div>`; return; }
  if (!R.caracteristicas.length) { host.innerHTML = `<div class="insp-blocker"><i class="bi bi-info-circle"></i> Esta peça não possui características cadastradas.</div>`; return; }
  const qtd = r.quantidade;
  LOCAL = {};
  R.caracteristicas.forEach(c => { LOCAL[c.id] = { min: c.minimo, max: c.maximo, tipo: c.tipo_especificacao, informativo: !!c.informativo, vals: {} }; c.medicoes.forEach(m => LOCAL[c.id].vals[m.amostra] = m.valor); });

  /* §M04 — estado colaborativo das amostras. Travas abandonadas são liberadas
     ao abrir a tela (higiene), então uma queda de rede não deixa peça presa. */
  await AMOSTRAS.liberarExpiradas(r.id).catch(() => {});
  AMOST = await AMOSTRAS.estadoAmostras(r.id, qtd).catch(() => []);

  host.innerHTML = `
    <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
      <h3 class="insp-h mb-0"><i class="bi bi-table"></i> Medições</h3>
      <button class="rna-btn rna-btn-ghost rna-btn-sm" id="btn-ajuda-classe"><i class="bi bi-question-circle"></i> Definição das classes</button>
      <div class="flex-fill"></div>
      <span class="text-muted-2" style="font-size:12.5px"><i class="bi bi-lock"></i> Nominal/limites vêm da Biblioteca (somente leitura)</span>
    </div>
    <div id="insp-colab"></div>
    <div class="insp-table-wrap"><table class="insp-mtable"><thead><tr>
      <th class="sticky-l">Cota</th><th>Característica</th><th>Quadrante</th><th>Ref.</th><th>Un.</th><th>Nominal</th><th>Mín</th><th>Máx</th><th>Equip.</th><th>Obs.</th>
      ${Array.from({ length: qtd }, (_, i) => cabecalhoAmostra(i + 1)).join('')}
      <th>Classe</th><th>Status</th>
    </tr></thead><tbody>
      ${R.caracteristicas.map(c => linhaMedicao(c, qtd)).join('')}
    </tbody></table></div>`;

  $('#btn-ajuda-classe').addEventListener('click', ajudaClasses);
  pintarColaboradores();
  /* §Erro 05 — observação completa por clique/toque (também em modo leitura). */
  $$('[data-obs]', host).forEach(b => b.addEventListener('click', () => abrirObservacao(b.dataset.obs)));
  if (VIEWONLY) { $$('.insp-minput', host).forEach(i => i.disabled = true); $$('.insp-attr', host).forEach(s => s.disabled = true); $$('.insp-classe-sel', host).forEach(s => s.disabled = true); return; }
  $$('.insp-minput', host).forEach(inp => {
    inp.addEventListener('input', () => onMedInput(inp));
    inp.addEventListener('change', () => persistMed(inp));
  });
  $$('.insp-attr', host).forEach(sel => sel.addEventListener('change', () => onAttrInput(sel)));
  /* §Erro 04 — Enter avança para a próxima medição. UM ÚNICO listener delegado
     no container da etapa: ele morre junto com o HTML quando a etapa é
     repintada, então não há acúmulo de listeners nem vazamento. */
  host.addEventListener('keydown', onTeclaMedicao);
  $$('.insp-classe-sel', host).forEach(sel => sel.addEventListener('change', () => onClasse(sel)));
  $$('.insp-tratar', host).forEach(b => b.addEventListener('click', () => abrirTratamento(b.dataset.car)));
  wireAmostras();
  aplicarBloqueios();
}

/* ==================== COLABORAÇÃO POR AMOSTRA (§M04) ======================== */
let AMOST = [];          // estado das amostras (com trava)
let BATIDA;              // timer do sinal de vida
let MINHAS = new Set();  // amostras que ESTE navegador está segurando

const amostraDe = n => AMOST.find(a => Number(a.amostra) === Number(n));
/* Só edita quem detém a trava. Sem trava ativa, a coluna fica somente-leitura —
   é o que impede dois auditores de sobrescreverem a mesma peça. */
const euEdito = n => AMOSTRAS.podeEditar(amostraDe(n), USER.id);

/** Cabeçalho da coluna da peça: dono, status e o botão de assumir/concluir. */
function cabecalhoAmostra(n) {
  const a = amostraDe(n);
  const st = AMOSTRAS.AMOSTRA_STATUS[a?.status || 'pendente'];
  const meu = a && a.bloqueado_por === USER.id && a._travaAtiva;
  const deOutro = a && a._travaAtiva && a.bloqueado_por !== USER.id;
  const concluida = a?.status === 'concluida';
  let acao = '';
  if (!VIEWONLY) {
    if (concluida) acao = `<button class="rna-btn rna-btn-ghost rna-btn-sm insp-amostra-btn" data-reabrir="${n}" title="Reabrir para corrigir"><i class="bi bi-arrow-counterclockwise"></i> Reabrir</button>`;
    else if (meu) acao = `<button class="rna-btn rna-btn-primary rna-btn-sm insp-amostra-btn" data-concluir="${n}"><i class="bi bi-check2"></i> Concluir</button>
                          <button class="rna-btn rna-btn-ghost rna-btn-sm insp-amostra-btn" data-liberar="${n}" title="Liberar sem concluir"><i class="bi bi-unlock"></i></button>`;
    else if (deOutro) acao = `<span class="rna-badge badge-warn" title="Em edição por ${escTitle(a.bloqueado_nome)}"><i class="bi bi-lock-fill"></i> ${escTitle(a.bloqueado_nome || 'ocupada')}</span>`;
    else acao = `<button class="rna-btn rna-btn-dark rna-btn-sm insp-amostra-btn" data-assumir="${n}"><i class="bi bi-hand-index"></i> Assumir</button>`;
  }
  const dono = a?.auditor_nome ? `<div class="cell-sub" title="Auditor responsável">${escTitle(a.auditor_nome)}</div>` : '';
  return `<th class="insp-samp ${deOutro ? 'is-locked' : ''} ${meu ? 'is-mine' : ''}" data-th="${n}">
    <div>Peça ${n}</div>
    <span class="rna-badge ${st.badge}" style="font-weight:600"><i class="bi ${st.icone}"></i> ${st.label}</span>
    ${dono}<div class="mt-1 d-flex gap-1 justify-content-center flex-wrap">${acao}</div></th>`;
}

/** Faixa "quem está trabalhando agora" + resumo de participação. */
async function pintarColaboradores() {
  const box = $('#insp-colab'); if (!box) return;
  const ativos = AMOST.filter(a => a._travaAtiva);
  const donos = new Map();
  AMOST.forEach(a => { if (a.auditor_id) donos.set(a.auditor_id, a.auditor_nome || '—'); });
  if (!ativos.length && !donos.size) { box.innerHTML = ''; return; }
  const chips = ativos.map(a => `<span class="rna-badge badge-warn"><i class="bi bi-pencil-fill"></i> ${escTitle(a.bloqueado_nome)} · Peça ${a.amostra}</span>`).join(' ');
  const parts = [...donos.values()].map(n => `<span class="rna-badge badge-info">${escTitle(n)}</span>`).join(' ');
  box.className = 'insp-blocker mb-2';
  box.innerHTML = `<i class="bi bi-people-fill"></i> <div>
    ${ativos.length ? `<b>Medindo agora:</b> ${chips}` : '<b>Nenhuma peça em edição no momento.</b>'}
    ${donos.size ? `<div class="cell-sub mt-1">Participaram desta inspeção: ${parts}</div>` : ''}</div>`;
}

/** Liga/desliga os campos conforme a posse da coluna. */
function aplicarBloqueios() {
  if (VIEWONLY) return;
  $$('.insp-minput, .insp-attr').forEach(el => {
    const n = +el.dataset.a;
    const livre = euEdito(n);
    el.disabled = !livre;
    el.classList.toggle('is-bloqueada', !livre);
    if (!livre) {
      const a = amostraDe(n);
      el.title = a?.status === 'concluida' ? `Peça ${n} concluída — use Reabrir para corrigir.`
        : a?._travaAtiva ? `Peça ${n} em edição por ${a.bloqueado_nome}.`
        : `Clique em "Assumir" no topo da coluna da Peça ${n} para medir.`;
    } else {
      /* Campo liberado: o tooltip volta a explicar o STATUS da medição
         (aprovado / aprovado com atenção / reprovado), não a trava. */
      const d = LOCAL[el.dataset.car] ? avaliarLocal(el.dataset.car, el.value) : null;
      el.title = d ? `${d.label}${d.motivo ? ' · ' + d.motivo : ''}` : '';
    }
  });
}

function wireAmostras() {
  $$('[data-assumir]').forEach(b => b.addEventListener('click', () => assumir(+b.dataset.assumir)));
  $$('[data-liberar]').forEach(b => b.addEventListener('click', () => liberar(+b.dataset.liberar)));
  $$('[data-concluir]').forEach(b => b.addEventListener('click', () => concluirAmostraUI(+b.dataset.concluir)));
  $$('[data-reabrir]').forEach(b => b.addEventListener('click', () => reabrir(+b.dataset.reabrir)));
}

/** Repinta só os cabeçalhos e o estado dos campos (sem remontar a tabela). */
async function refreshAmostras() {
  AMOST = await AMOSTRAS.estadoAmostras(R.rel.id, R.rel.quantidade).catch(() => AMOST);
  AMOST.forEach(a => {
    const th = document.querySelector(`th[data-th="${a.amostra}"]`);
    if (th) th.outerHTML = cabecalhoAmostra(a.amostra);
  });
  wireAmostras();
  aplicarBloqueios();
  pintarColaboradores();
}

async function assumir(n) {
  const res = await AMOSTRAS.assumirAmostra(R.rel.id, n, USER);
  if (!res.ok) {
    const msg = res.motivo === 'bloqueada' ? `A Peça ${n} está sendo medida por ${res.por}. Você pode ver os valores, mas não editar.`
      : res.motivo === 'concluida' ? `A Peça ${n} já foi concluída. Use "Reabrir" para corrigir.`
      : 'Não foi possível assumir esta peça.';
    toast(msg, { type: 'warn', title: 'Peça indisponível', timeout: 6000 });
    await refreshAmostras();
    return;
  }
  MINHAS.add(n);
  iniciarBatida();
  await refreshAmostras();
  toast(`Peça ${n} assumida. As demais seguem disponíveis para os outros auditores.`, { type: 'ok', timeout: 3500 });
}

async function liberar(n) {
  await AMOSTRAS.liberarAmostra(R.rel.id, n, USER);
  MINHAS.delete(n);
  if (!MINHAS.size) pararBatida();
  await refreshAmostras();
}

async function reabrir(n) {
  await AMOSTRAS.reabrirAmostra(R.rel.id, n, USER);
  await INSP.registrarHistorico(R.rel.id, USER, 'Reabriu peça', `Peça ${n}`, 'concluída', 'em medição').catch(() => {});
  await refreshAmostras();
  toast(`Peça ${n} reaberta. Assuma a peça para editar.`, { type: 'info' });
}

/** Conclusão da amostra: pede observação e congela auditor, tempo e resultado. */
async function concluirAmostraUI(n) {
  const a = amostraDe(n);
  const faltam = medicoesFaltantes(n);
  const m = modal({
    title: `Concluir Peça ${n}`,
    content: `
      ${faltam ? `<div class="insp-blocker mb-2"><i class="bi bi-exclamation-triangle"></i> <div><b>${faltam} medição(ões) ainda em branco</b> nesta peça. Você pode concluir mesmo assim, mas a inspeção só finaliza com tudo preenchido.</div></div>` : ''}
      <div class="insp-treat-spec mb-2">
        ${info('Auditor responsável', a?.auditor_nome || USER.nome)}
        ${info('Início', a?.inicio_iso ? fmtDataHora(a.inicio_iso) : '—')}
        ${info('Tempo acumulado', INSP.fmtDuracao(a?.duracao_seg ?? 0))}
      </div>
      <label class="form-label">Observação da peça</label>
      <textarea class="form-control" id="ca-obs" rows="3" placeholder="Registro livre sobre esta peça (opcional)">${escTitle(a?.observacao || '')}</textarea>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-primary" id="ca-ok"><i class="bi bi-check2-circle"></i> Concluir peça</button>`
  });
  $('#ca-ok', m.host).addEventListener('click', async () => {
    const btn = $('#ca-ok', m.host); btn.disabled = true;
    const res = await AMOSTRAS.concluirAmostra(R.rel.id, n, USER, { observacao: $('#ca-obs', m.host).value });
    if (!res.ok) { btn.disabled = false; return toast('Não foi possível concluir esta peça.', { type: 'crit' }); }
    await INSP.registrarHistorico(R.rel.id, USER, 'Concluiu peça', `Peça ${n}`, 'em medição', 'concluída').catch(() => {});
    MINHAS.delete(n); if (!MINHAS.size) pararBatida();
    m.close();
    await refreshAmostras();
    toast(`Peça ${n} concluída.`, { type: 'ok' });
  });
}

function medicoesFaltantes(n) {
  let f = 0;
  R.caracteristicas.forEach(c => {
    if (c.informativo && !c.obrigatorio) return;
    const v = LOCAL[c.id]?.vals[n];
    if (String(v ?? '') === '') f++;
  });
  return f;
}

/* Sinal de vida: enquanto este navegador segura amostras, renova a trava. Sem
   isso a trava expira sozinha em LOCK_TTL_SEG — que é justamente o que evita
   peça travada para sempre depois de um fechamento abrupto. */
function iniciarBatida() {
  if (BATIDA) return;
  BATIDA = setInterval(async () => {
    for (const n of MINHAS) {
      const vivo = await AMOSTRAS.baterCoracao(R.rel.id, n, USER).catch(() => false);
      if (!vivo) MINHAS.delete(n);          // perdi a trava (expirou / outro assumiu)
    }
    if (!MINHAS.size) { pararBatida(); refreshAmostras(); }
  }, AMOSTRAS.BATIDA_SEG * 1000);
}
function pararBatida() { clearInterval(BATIDA); BATIDA = null; }

/* Sair da página solta as travas deste navegador — o colega não espera o TTL. */
window.addEventListener('beforeunload', () => {
  for (const n of MINHAS) {
    try { AMOSTRAS.liberarAmostra(R?.rel?.id, n, USER); } catch { /* melhor esforço */ }
  }
});

/* §Erro 06 — horário sempre no fuso oficial da operação (America/Sao_Paulo),
   independentemente do fuso configurado no computador ou no celular. */
const fmtHora = iso => formatarHoraBrasil(iso);
const fmtDataHora = iso => formatarDataHoraBrasil(iso);

function linhaMedicao(c, qtd) {
  const attr = c.tipo_especificacao === 'ATRIBUTO';
  const informativo = !!c.informativo;
  /* Célula por amostra: OK/NOK (atributo) ou campo numérico — inclusive para
     REFERÊNCIA, que também é medida e registrada. A referência só não possui
     limites: nunca fica vermelha nem reprova (ver INSP.avaliarReferencia). */
  const cells = Array.from({ length: qtd }, (_, i) => {
    const a = i + 1; const m = c.medicoes.find(x => x.amostra === a);
    const val = m ? m.valor : '';
    /* Estado visual derivado da regra (§Erro 01): verde / amarelo / vermelho. */
    const d = INSP.avaliarMedicaoDetalhe(val, c.minimo, c.maximo, INSP.tipoDeAvaliacao(c));
    if (attr) {
      const sel = String(val ?? '').toUpperCase();
      return `<td class="insp-samp"><select class="insp-attr ${visCls(d.visual)}" data-car="${c.id}" data-a="${a}" title="${escTitle(d.label)}">
        <option value="">—</option><option value="OK" ${sel === 'OK' ? 'selected' : ''}>OK</option><option value="NOK" ${sel === 'NOK' ? 'selected' : ''}>NOK</option></select></td>`;
    }
    return `<td class="insp-samp"><input class="insp-minput ${informativo ? 'is-ref' : ''} ${visCls(d.visual)}"
      data-car="${c.id}" data-a="${a}" data-ref="${informativo ? '1' : ''}" value="${escTitle(val ?? '')}"
      inputmode="decimal" placeholder="—" title="Peça ${a} — ${escTitle(d.label)}${d.motivo ? ' · ' + escTitle(d.motivo) : ''}${informativo ? ' (referência, sem limites)' : ''}"></td>`;
  }).join('');
  const tipoTag = informativo ? ' <span class="insp-tipo-tag">Referência</span>' : (attr ? ' <span class="insp-tipo-tag">OK/NOK</span>' : '');
  const obrigTag = informativo && c.obrigatorio ? ' <span class="insp-tipo-tag insp-tipo-obrig">Obrigatória</span>' : '';
  /* Referência mantém o valor cadastrado visível (destaque azul) no lugar dos
     limites — é consulta técnica, não substitui o campo de medição. */
  const dimCols = attr
    ? `<td colspan="3" class="cell-sub" style="text-align:center">OK / NOK</td>`
    : informativo
      ? `<td colspan="3" class="insp-ref-spec" style="text-align:center"><i class="bi bi-info-circle"></i> Referência: <b>${fmt(c.referencia ?? c.nominal)}</b> ${escTitle(c.unidade || '')}</td>`
      : `<td>${fmt(c.nominal)}</td><td>${fmt(c.minimo)}</td><td>${fmt(c.maximo)}</td>`;
  // Referência e Observações vêm da Biblioteca Técnica (snapshot da especificação):
  // c.referencia = bib_metricas.referencia · c.observacao_tec = bib_metricas.observacao.
  // c.quadrante = bib_metricas.quadrante — localização no desenho, somente leitura.
  const obs = c.observacao_tec || '';
  return `<tr data-row="${c.id}">
    <td class="sticky-l cell-strong">${c.cota ?? '—'}</td>
    <td>${c.caracteristica}${tipoTag}${obrigTag}</td>
    <td class="insp-quadrante">${c.quadrante ? escTitle(c.quadrante) : '—'}</td>
    <td class="cell-sub">${c.referencia || '—'}</td>
    <td>${c.unidade || ''}</td>${dimCols}
    <td class="cell-sub">${c.equipamento || '—'}</td>
    ${obsCellHtml(c, obs)}
    ${cells}
    <td class="insp-classe-cell">${informativo ? '<span class="text-muted-2">—</span>' : classeCellHtml(c)}</td>
    <td class="insp-status-cell">${informativo ? statusReferenciaHtml(c) : statusCellHtml(c.resultado, c._visual)}</td>
  </tr>`;
}

/* §Erro 05 — OBSERVAÇÃO SEMPRE LEGÍVEL.
   O texto vem inteiro do banco (nada de substring na consulta). Na tela ele é
   exibido em até 3 linhas; quando não cabe, o auditor abre o conteúdo completo
   por clique/toque (funciona em celular e tablet, onde tooltip não existe) ou
   pelo teclado (Enter/Espaço). `title` mantém o tooltip nativo no desktop. */
function obsCellHtml(c, obs) {
  if (!obs) return `<td class="cell-sub insp-obs-cell">—</td>`;
  return `<td class="cell-sub insp-obs-cell">
    <button type="button" class="insp-obs" data-obs="${c.id}" title="${escTitle(obs)}"
      aria-label="Observação da cota ${escTitle(String(c.cota ?? ''))}: ${escTitle(obs)}. Toque para ver o texto completo.">
      <span class="insp-obs__txt">${escTitle(obs)}</span><i class="bi bi-arrows-angle-expand insp-obs__ic"></i>
    </button></td>`;
}

/** Abre a observação completa — preserva acentos, símbolos e quebras de linha. */
function abrirObservacao(carId) {
  const c = R.caracteristicas.find(x => x.id === carId); if (!c) return;
  modal({
    title: `Observação — cota ${c.cota ?? '—'}`,
    content: `<div class="insp-obs-full">
        <div class="cell-sub mb-2"><b>${escTitle(c.caracteristica || '')}</b>${c.referencia ? ' · ' + escTitle(c.referencia) : ''}</div>
        <div class="insp-obs-full__txt">${escTitle(c.observacao_tec || '')}</div>
        <div class="cell-sub mt-2"><i class="bi bi-lock"></i> Texto cadastrado na Biblioteca Técnica (somente leitura).</div>
      </div>`,
    footer: `<button class="rna-btn rna-btn-primary" data-bs-dismiss="modal">Fechar</button>`
  });
}
/* §M07 — padrão brasileiro 00,00 vindo da fonte única (services/formato.js).
   Cota/OP/lote/revisão NÃO passam por aqui: são identificadores. */
const fmt = v => fmtMedida(v);
/* Escapa texto livre (observação da Biblioteca) p/ conteúdo e atributo title. */
const escTitle = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/* Classe CSS do estado visual (§Erro 01): 'ok' verde · 'atencao' amarelo ·
   'crit' vermelho. Amarelo NUNCA é reprovação — é aprovado com atenção. */
const visCls = v => v === 'ok' ? 'is-ok' : v === 'atencao' ? 'is-warn' : v === 'crit' ? 'is-crit' : '';
const cellCls = r => r === 'aprovado' ? 'is-ok' : r === 'reprovado' ? 'is-crit' : '';
function statusCellHtml(res, visual = '') {
  if (res === 'reprovado') return `<span class="insp-pill insp-crit"><i class="bi bi-x-circle-fill"></i> Reprovado</span>`;
  if (res === 'aprovado' && visual === 'atencao')
    return `<span class="insp-pill insp-warn" title="Valor no limite ou próximo dele — aprovado, com atenção."><i class="bi bi-exclamation-triangle-fill"></i> Aprovado com atenção</span>`;
  if (res === 'aprovado') return `<span class="insp-pill insp-ok"><i class="bi bi-check-circle-fill"></i> Aprovado</span>`;
  return `<span class="insp-pill insp-pend">Aguardando medição</span>`;
}
/* Status NEUTRO da referência (§status visual): jamais "Reprovado", qualquer que
   seja a diferença entre o valor medido e o valor de referência cadastrado. */
function statusReferenciaHtml(c) {
  const temMedicao = c.medicoes?.some(m => String(m.valor ?? '') !== '');
  return temMedicao
    ? `<span class="insp-pill insp-info"><i class="bi bi-check2"></i> Registrado — Referência</span>`
    : `<span class="insp-pill insp-info"><i class="bi bi-info-circle"></i> Referência informativa</span>`;
}
function classeCellHtml(c) {
  if (c.resultado !== 'reprovado') return '<span class="text-muted-2">—</span>';
  const opts = ['A', 'B', 'C'].map(k => `<option value="${k}" ${c.classe_defeito === k ? 'selected' : ''}>Classe ${k}</option>`).join('');
  return `<div class="d-flex flex-column gap-1">
    <select class="form-select form-select-sm insp-classe-sel" data-car="${c.id}"><option value="">Classificar...</option>${opts}</select>
    <button class="rna-btn rna-btn-ghost rna-btn-sm insp-tratar" data-car="${c.id}"><i class="bi bi-clipboard-plus"></i> Tratar</button></div>`;
}

/* cálculo local imediato + persistência debounced */
function onMedInput(inp) {
  const carId = inp.dataset.car, a = +inp.dataset.a;
  const L = LOCAL[carId];
  L.vals[a] = inp.value;
  pintarCampo(inp, avaliarLocal(carId, inp.value));
  limparErroCampo(inp);
  recalcLinha(carId);
}
/* Atributo OK/NOK: recalcula local e persiste imediatamente (select change). */
function onAttrInput(sel) {
  const carId = sel.dataset.car, a = +sel.dataset.a;
  LOCAL[carId].vals[a] = sel.value;
  pintarCampo(sel, avaliarLocal(carId, sel.value));
  recalcLinha(carId);
  persistMed(sel);
}
/** Avaliação local (mesma regra do servidor) a partir do modelo LOCAL. */
function avaliarLocal(carId, valor) {
  const L = LOCAL[carId];
  return INSP.avaliarMedicaoDetalhe(valor, L.min, L.max, L.informativo ? 'REFERENCIA' : L.tipo);
}
/** Pinta o campo com o estado visual (verde/amarelo/vermelho/azul). */
function pintarCampo(campo, d) {
  campo.classList.remove('is-ok', 'is-warn', 'is-crit');
  const cls = visCls(d.visual);
  if (cls) campo.classList.add(cls);
  campo.title = `${d.label}${d.motivo ? ' · ' + d.motivo : ''}`;
}
/* Recalcula o status da linha e o banner geral a partir do modelo local. */
function recalcLinha(carId) {
  const qtd = R.rel.quantidade;
  const row = document.querySelector(`tr[data-row="${carId}"]`);
  const car = R.caracteristicas.find(c => c.id === carId);
  const informativo = !!LOCAL[carId].informativo;
  const dets = detInputs(carId, qtd);
  const rowRes = INSP.resultadoCaracteristica(dets.map(d => d.status), { referencia: informativo });
  const rowVis = INSP.visualCaracteristica(dets.map(d => d.visual));
  if (car) { car.resultado = rowRes; car._visual = rowVis; }
  if (informativo) {
    /* Referência: status neutro derivado do que está digitado; sem classe de
       defeito e sem impacto no resultado geral (excluída de resultadoGeral). */
    const preenchidas = Array.from({ length: qtd }, (_, i) => LOCAL[carId].vals[i + 1])
      .filter(v => String(v ?? '') !== '').length;
    row.querySelector('.insp-status-cell').innerHTML = statusReferenciaHtml({ medicoes: preenchidas ? [{ valor: '1' }] : [] });
  } else {
    row.querySelector('.insp-status-cell').innerHTML = statusCellHtml(rowRes, rowVis);
    row.querySelector('.insp-classe-cell').innerHTML = classeCellHtml(car);
    bindRowClasse(row);
  }
  R.rel.resultado = INSP.resultadoGeral(R.caracteristicas.filter(c => !c.informativo).map(c => c.resultado));
  refreshBanner();
}
function detInputs(carId, qtd) {
  const out = [];
  for (let s = 1; s <= qtd; s++) out.push(avaliarLocal(carId, LOCAL[carId].vals[s]));
  return out;
}
function bindRowClasse(row) {
  row.querySelectorAll('.insp-classe-sel').forEach(sel => sel.addEventListener('change', () => onClasse(sel)));
  row.querySelectorAll('.insp-tratar').forEach(b => b.addEventListener('click', () => abrirTratamento(b.dataset.car)));
}
/* ==================== NAVEGAÇÃO POR TECLADO NAS MEDIÇÕES (§Erro 04) =========
   Enter          → valida, salva e vai para a PRÓXIMA medição
   Shift + Enter  → volta para a medição anterior
   O Enter do teclado numérico chega com a mesma `key` ('Enter'), então os dois
   funcionam. O padrão do formulário é sempre cancelado: Enter nunca envia nem
   recarrega a página.

   ORDEM: conclui todas as cotas da Peça 1, depois a Peça 2... (a tabela é
   desenhada por linha, então a lista é reordenada por amostra e depois por
   linha). Campos desabilitados, ocultos, somente leitura ou de peça travada
   por outro auditor são PULADOS. */
function camposMedicao() {
  const host = $('#insp-step'); if (!host) return [];
  return $$('.insp-minput, .insp-attr', host)
    .filter(el => !el.disabled && !el.readOnly && el.offsetParent !== null && !el.closest('[hidden]'))
    .map(el => ({ el, amostra: +el.dataset.a || 0, linha: el.closest('tr')?.rowIndex ?? 0 }))
    .sort((a, b) => a.amostra - b.amostra || a.linha - b.linha)
    .map(x => x.el);
}

function onTeclaMedicao(e) {
  if (e.key !== 'Enter') return;
  const campo = e.target;
  if (!campo.classList?.contains('insp-minput') && !campo.classList?.contains('insp-attr')) return;
  e.preventDefault();                       // nunca envia formulário / recarrega
  if (e.shiftKey) return moverFoco(campo, -1);

  /* Valor inválido trava o avanço. Fora de especificação NÃO é inválido: a
     medição pode estar reprovada e o auditor precisa seguir preenchendo. */
  const erro = erroDeValor(campo);
  if (erro) { mostrarErroCampo(campo, erro); campo.select?.(); return; }
  limparErroCampo(campo);
  persistMed(campo);                        // salva sem bloquear o cursor
  moverFoco(campo, +1);
}

/** Mensagem quando o valor digitado não é uma medição válida; null se estiver ok. */
function erroDeValor(campo) {
  const carId = campo.dataset.car;
  const valor = String(campo.value ?? '').trim();
  const L = LOCAL[carId];
  if (valor === '') {
    const car = R.caracteristicas.find(c => c.id === carId);
    // vazio só é erro quando o registro é obrigatório; senão, segue em frente
    return (car?.obrigatorio && !car?.informativo) ? 'Esta medição é obrigatória.' : null;
  }
  if (L?.tipo === 'ATRIBUTO' || campo.classList.contains('insp-attr')) return null;
  const d = avaliarLocal(carId, valor);
  if (d.status === 'pendente' && d.motivo) return d.motivo;   // texto em campo numérico
  return null;
}

/** Move o foco N posições na ordem operacional; no fim, vai para "Avançar". */
function moverFoco(campo, passo) {
  const campos = camposMedicao();
  const i = campos.indexOf(campo);
  const alvo = campos[i + passo];
  if (!alvo) {
    /* Última medição: não volta ao início, não finaliza e não troca de etapa
       sozinho — só oferece o próximo passo (§Erro 04). */
    if (passo > 0) {
      const btn = $('#nav-next');
      if (btn && !btn.disabled) { btn.focus(); toast('Todas as medições desta tela foram percorridas. Avance para a Revisão.', { type: 'info', timeout: 3500 }); }
    }
    return;
  }
  alvo.focus();
  if (alvo.select && String(alvo.value ?? '') !== '') alvo.select();   // já preenchido: substitui digitando
  alvo.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/* Mensagem de erro colada ao campo (não usa alert nem toast: o auditor precisa
   ver onde está o problema sem tirar os olhos da tabela). */
function mostrarErroCampo(campo, msg) {
  limparErroCampo(campo);
  campo.classList.add('is-erro');
  const td = campo.closest('td') || campo.parentElement;
  td.classList.add('insp-td-erro');
  td.insertAdjacentHTML('beforeend', `<div class="insp-campo-erro insp-campo-erro--flut" role="alert">${escTitle(msg)}</div>`);
}
function limparErroCampo(campo) {
  campo.classList.remove('is-erro');
  const td = campo.closest('td') || campo.parentElement;
  td?.classList.remove('insp-td-erro');
  td?.querySelector('.insp-campo-erro--flut')?.remove();
}

async function persistMed(inp) {
  const carId = inp.dataset.car, a = +inp.dataset.a;
  /* §M04 — só grava quem detém a trava da amostra. Guarda de segurança: mesmo
     que o campo escape do `disabled` (DOM alterado, corrida de repintura), a
     medição de uma peça de outro auditor não é persistida. */
  if (!VIEWONLY && !euEdito(a)) {
    const dono = amostraDe(a);
    toast(dono?.status === 'concluida'
      ? `A Peça ${a} está concluída. Use "Reabrir" para corrigir.`
      : `A Peça ${a} está com ${dono?.bloqueado_nome || 'outro auditor'}. Assuma a peça para medir.`,
      { type: 'warn', title: 'Peça bloqueada' });
    inp.value = LOCAL[carId]?.vals?.[a] ?? '';
    aplicarBloqueios();
    return;
  }
  /* USER vai junto: é o que grava a AUTORIA da medição e a linha de histórico. */
  await autosave(async () => {
    await INSP.salvarMedicao(R.rel.id, carId, a, inp.value, USER);
    await AMOSTRAS.recalcularResultados(R.rel.id, R.rel.quantidade).catch(() => {});
    await reload();
  });
}
async function onClasse(sel) {
  await autosave(async () => { await INSP.salvarClasse(sel.dataset.car, sel.value); await reload(); });
  toast(sel.value ? `Classificado como Classe ${sel.value}.` : 'Classificação removida.', { type: 'info', timeout: 1800 });
}

/* --------------------------------------------------- TRATAMENTO / PENDÊNCIA (§17) */
async function abrirTratamento(carId) {
  const c = R.caracteristicas.find(x => x.id === carId); if (!c) return;
  const acao = await INSP.acaoDaCaracteristica(R.rel.id, carId) || {};
  const cls = CLASSES.find(k => k.codigo === (c.classe_defeito || acao.defect_class)) || null;
  const reprovadas = c.medicoes.filter(m => m.resultado === 'reprovado');
  const opcoesResp = USUARIOS.map(u => `<option value="${u.id}" ${acao.responsavel_id === u.id ? 'selected' : ''}>${u.nome}</option>`).join('');
  const m = modal({
    title: `Tratamento — ${c.caracteristica}`, size: 'modal-lg',
    content: `
      <div class="insp-treat-spec">
        ${info('Nominal', fmt(c.nominal) + ' ' + (c.unidade || ''))} ${info('Mínimo', fmt(c.minimo))} ${info('Máximo', fmt(c.maximo))}
        ${info('Amostras reprovadas', reprovadas.map(m => `#${m.amostra}=${fmt(m.valor)}`).join(' · ') || '—')}
      </div>
      <div class="row g-2 mt-1">
        <div class="col-md-4"><label class="form-label">Classe do defeito *</label>
          <select class="form-select" id="tr-classe">${['', 'A', 'B', 'C'].map(k => `<option value="${k}" ${c.classe_defeito === k ? 'selected' : ''}>${k ? 'Classe ' + k : 'Selecionar...'}</option>`).join('')}</select></div>
        <div class="col-md-8" id="tr-cls-info"></div>
        <div class="col-12"><label class="form-label">Observação ${cls?.obrig?.observacao ? '*' : ''}</label><textarea class="form-control" id="tr-obs" rows="2">${c.observacao || acao.observacao || ''}</textarea></div>
        <div class="col-12"><label class="form-label">Ação imediata executada</label><textarea class="form-control" id="tr-ai" rows="2">${acao.acao_imediata || ''}</textarea></div>
        <div class="col-12"><label class="form-label">Ação permanente</label><textarea class="form-control" id="tr-ap" rows="2">${acao.acao_permanente || ''}</textarea></div>
        <div class="col-md-6"><label class="form-label">Responsável</label><select class="form-select" id="tr-resp"><option value="">—</option>${opcoesResp}</select></div>
        <div class="col-md-6"><label class="form-label">Prazo</label><input type="date" class="form-control" id="tr-prazo" value="${acao.prazo || ''}"></div>
        <div class="col-12"><label class="form-label">Evidências</label><div id="tr-ev"></div></div>
      </div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
      <button class="rna-btn rna-btn-primary" id="tr-save"><i class="bi bi-save"></i> Salvar tratamento</button>`
  });
  const ev = initEvidenceUpload($('#tr-ev', m.host), { multiple: true, label: 'Anexar evidência', accent: 'crit' });
  const paintCls = () => {
    const k = $('#tr-classe', m.host).value; const ci = CLASSES.find(x => x.codigo === k);
    $('#tr-cls-info', m.host).innerHTML = ci ? `<div class="insp-cls-box insp-cls-${ci.cor}"><b>Classe ${ci.codigo} — ${ci.gravidade}</b><div class="cell-sub">${ci.definicao}</div>
      <div class="mt-1"><b>Obrigatórios:</b> ${Object.entries(ci.obrig).filter(([, v]) => v).map(([k]) => k).join(', ') || '—'}</div></div>` : '';
  };
  paintCls();
  $('#tr-classe', m.host).addEventListener('change', paintCls);

  $('#tr-save', m.host).addEventListener('click', async () => {
    const classe = $('#tr-classe', m.host).value;
    if (!classe) return toast('Selecione a classe do defeito.', { type: 'warn' });
    const ok = await autosave(async () => {
      await INSP.salvarClasse(carId, classe);
      await INSP.salvarObservacao(carId, $('#tr-obs', m.host).value);
      const saved = await ev.commit({ usuario: USER, registro_tipo: 'insp_acao', registro_id: R.rel.id });
      for (const s of saved) await db.insert('insp_anexos', { relatorio_id: R.rel.id, caracteristica_id: carId, medicao_id: null, nome: s.nome, tipo: s.tipo, url: s.url, tamanho: '', uploaded_by: USER.id, created_at: INSP.nowISO() });
      await INSP.salvarAcao(R.rel.id, carId, {
        defect_class: classe, observacao: $('#tr-obs', m.host).value, acao_imediata: $('#tr-ai', m.host).value,
        acao_permanente: $('#tr-ap', m.host).value, responsavel_id: $('#tr-resp', m.host).value || null,
        responsavel: USUARIOS.find(u => u.id === $('#tr-resp', m.host).value)?.nome || '', prazo: $('#tr-prazo', m.host).value || null
      });
      await INSP.registrarEvento({ relatorio: R.rel, tipo_evento: 'corrective_action_created', caracteristica_id: carId, metadata: { classe } });
      await reload();
    }, { contexto: 'Falha ao salvar o tratamento' });
    if (!ok) return;                                 // erro real exibido — modal segue aberto p/ correção
    m.close(); toast('Tratamento salvo.', { type: 'ok' }); renderStep();
  });
}

/* --------------------------------------------------------- ajuda classes (§16) */
function ajudaClasses() {
  modal({
    title: 'Definição das Classes de Defeitos', size: 'modal-lg',
    content: CLASSES.map(c => `<div class="insp-cls-box insp-cls-${c.cor} mb-2">
      <b>Classe ${c.codigo} — ${c.gravidade}</b>
      <p class="mb-1" style="font-size:13px">${c.definicao}</p>
      <details><summary>Critérios</summary><ul class="insp-ul">${c.criterios.map(x => `<li>${x}</li>`).join('')}</ul></details>
      <details><summary>Ações imediatas</summary><ul class="insp-ul">${c.acoes_imediatas.map(x => `<li>${x}</li>`).join('')}</ul></details>
      <details><summary>Ações permanentes</summary><ul class="insp-ul">${c.acoes_permanentes.map(x => `<li>${x}</li>`).join('')}</ul></details>
      <div class="cell-sub mt-1">Campos obrigatórios: ${Object.entries(c.obrig).filter(([, v]) => v).map(([k]) => k).join(', ') || '—'}</div>
    </div>`).join(''),
    footer: `<button class="rna-btn rna-btn-primary" data-bs-dismiss="modal">Entendi</button>`
  });
}

/* ============================================================ ETAPA 4 (§22) */
async function stepRevisao(host) {
  const s = await INSP.resumoRelatorio(R.rel.id);
  const r = R.rel;
  const amostras = await AMOSTRAS.estadoAmostras(r.id, r.quantidade).catch(() => []);
  host.innerHTML = `
    <h3 class="insp-h"><i class="bi bi-clipboard-check"></i> Revisão</h3>
    ${amostras.length ? tabelaAmostras(amostras) : ''}
    <div class="row g-3">
      <div class="col-lg-7">
        <div class="insp-summary-grid">
          ${sum('Características avaliadas', s.totalCaracteristicas)} ${sum('Aprovadas', s.caracteristicasAprovadas, 'ok')} ${sum('Reprovadas', s.caracteristicasReprovadas, 'crit')}
          ${sum('Medições realizadas', s.totalMedicoes)} ${sum('Aprovadas', s.medicoesAprovadas, 'ok')} ${sum('Reprovadas', s.medicoesReprovadas, 'crit')}
          ${sum('Amostras', s.amostras)} ${sum('Conformidade', s.conformidade + '%')} ${sum('Classe A / B / C', `${s.classeA} / ${s.classeB} / ${s.classeC}`)}
        </div>
      </div>
      <div class="col-lg-5">
        <div class="insp-card-lite"><b>Identificação</b>
          <div class="insp-peca-grid mt-2">
            ${info('Relatório', r.numero)} ${info('Tipo', r.tipo_nome)} ${info('Cliente', r.cliente)} ${info('PN', r.peca_codigo)}
            ${info('Lote', r.lote)} ${info('OP', r.op)} ${info('Rev', r.revisao_desenho)} ${info('Auditor', r.auditor_nome)}
          </div>
        </div>
      </div>
    </div>
    ${s.caracteristicasReprovadas ? `<div class="insp-card-lite mt-3"><b class="text-crit"><i class="bi bi-exclamation-octagon"></i> Reprovações a tratar</b>
      <div class="mt-2">${R.caracteristicas.filter(c => c.resultado === 'reprovado').map(c => `<div class="insp-reprov-row">
        <div><b>${c.caracteristica}</b> <span class="cell-sub">cota ${c.cota}</span></div>
        <div>${c.classe_defeito ? `<span class="rna-badge ${c.classe_defeito === 'A' ? 'badge-crit' : c.classe_defeito === 'B' ? 'badge-warn' : 'badge-pend'}">Classe ${c.classe_defeito}</span>` : `<span class="rna-badge badge-crit">Sem classe</span>`}</div>
        ${VIEWONLY ? '' : `<button class="rna-btn rna-btn-ghost rna-btn-sm insp-tratar" data-car="${c.id}"><i class="bi bi-clipboard-plus"></i> Tratar</button>`}
      </div>`).join('')}</div></div>` : `<div class="insp-blocker insp-ok-blocker mt-3"><i class="bi bi-check-circle"></i> Nenhuma reprovação. Todas as características avaliadas estão aprovadas.</div>`}
    <div class="mt-2"><button class="rna-btn rna-btn-ghost rna-btn-sm" id="btn-ajuda-classe2"><i class="bi bi-question-circle"></i> Definição das classes</button></div>`;
  $('#btn-ajuda-classe2').addEventListener('click', ajudaClasses);
  $$('.insp-tratar', host).forEach(b => b.addEventListener('click', () => abrirTratamento(b.dataset.car)));
}
const sum = (l, v, tone = '') => `<div class="insp-sum ${tone ? 'insp-sum-' + tone : ''}"><div class="insp-sum__v">${v}</div><div class="insp-sum__l">${l}</div></div>`;

/* §M04 — quadro por peça: auditor, horários, tempo, resultado e observação.
   É a prestação de contas do trabalho dividido — mostra quem fez o quê. */
function tabelaAmostras(amostras) {
  const res = r => r === 'aprovado' ? '<span class="insp-pill insp-ok">Aprovada</span>'
    : r === 'reprovado' ? '<span class="insp-pill insp-crit">Reprovada</span>'
    : r === 'registrado' ? '<span class="insp-pill insp-info">Registrada</span>'
    : '<span class="insp-pill insp-pend">Pendente</span>';
  return `<div class="insp-card-lite mb-3"><b><i class="bi bi-people-fill"></i> Medição por peça</b>
    <div class="insp-table-wrap mt-2"><table class="rna-table"><thead><tr>
      <th>Peça</th><th>Auditor responsável</th><th>Início</th><th>Fim</th><th>Tempo</th><th>Resultado</th><th>Situação</th><th>Observação</th>
    </tr></thead><tbody>
    ${amostras.map(a => {
      const st = AMOSTRAS.AMOSTRA_STATUS[a.status] || AMOSTRAS.AMOSTRA_STATUS.pendente;
      return `<tr>
        <td class="cell-strong">Peça ${a.amostra}</td>
        <td>${escTitle(a.auditor_nome || '—')}${a.concluido_por_nome && a.concluido_por_nome !== a.auditor_nome
          ? `<div class="cell-sub">Concluída por ${escTitle(a.concluido_por_nome)}</div>` : ''}</td>
        <td class="cell-sub">${a.inicio_iso ? fmtHora(a.inicio_iso) : '—'}</td>
        <td class="cell-sub">${a.fim_iso ? fmtHora(a.fim_iso) : '—'}</td>
        <td class="cell-sub">${a.duracao_seg != null ? INSP.fmtDuracao(a.duracao_seg) : '—'}</td>
        <td>${res(a.resultado)}</td>
        <td><span class="rna-badge ${st.badge}">${st.label}</span>${a._travaAtiva ? `<div class="cell-sub"><i class="bi bi-lock-fill"></i> ${escTitle(a.bloqueado_nome)}</div>` : ''}</td>
        <td class="cell-sub">${escTitle(a.observacao || '—')}</td></tr>`;
    }).join('')}
    </tbody></table></div></div>`;
}

/* ============================================================ ETAPA 5 (§20) */
async function stepResultado(host) {
  const val = await INSP.validarFinalizacao(R.rel.id);
  const s = await INSP.resumoRelatorio(R.rel.id);
  const r = R.rel;
  const fin = String(r.status).startsWith('finalizada') || r.status === 'revisada';
  host.innerHTML = `
    <h3 class="insp-h"><i class="bi bi-flag"></i> Resultado e finalização</h3>
    <div class="insp-result-final ${bannerClass(r.resultado)}">
      <div class="insp-result-final__ic"><i class="bi ${r.resultado === 'aprovado' ? 'bi-check-circle-fill' : r.resultado === 'reprovado' ? 'bi-x-octagon-fill' : 'bi-hourglass-split'}"></i></div>
      <div><div class="insp-result-final__t">RESULTADO GERAL</div><div class="insp-result-final__v">${r.resultado === 'aprovado' ? 'APROVADO' : r.resultado === 'reprovado' ? 'REPROVADO' : 'EM PREENCHIMENTO'}</div>
      <div class="cell-sub">${s.caracteristicasAprovadas}/${s.totalCaracteristicas} características aprovadas · conformidade ${s.conformidade}%</div></div>
    </div>
    ${fin ? `<div class="insp-blocker insp-ok-blocker mt-3"><i class="bi bi-lock-fill"></i> Relatório finalizado e bloqueado para edição comum. Correções exigem revisão com justificativa (supervisor/admin).</div>
      ${r.status === 'finalizada_reprovada' && r.pendencia_numero ? `<div class="insp-blocker mt-2"><i class="bi bi-exclamation-triangle"></i> Pendência <b>${r.pendencia_numero}</b> gerada automaticamente a partir da reprovação.</div>` : ''}
      <div class="d-flex flex-wrap gap-2 mt-3">
        <a class="rna-btn rna-btn-primary" href="consulta-dimensional.html?rel=${r.id}"><i class="bi bi-file-earmark-text"></i> Ver relatório</a>
        <a class="rna-btn rna-btn-ghost" href="consulta-dimensional.html?rel=${r.id}&print=1"><i class="bi bi-printer"></i> Imprimir</a>
        ${r.status === 'finalizada_reprovada' ? `<a class="rna-btn rna-btn-dark" href="op-pendencias.html?rel=${r.id}"><i class="bi bi-exclamation-triangle"></i> Ver pendência</a>` : ''}</div>`
    : val.ok ? `<div class="insp-blocker insp-ok-blocker mt-3"><i class="bi bi-check2-all"></i> Medições concluídas. ${r.resultado === 'reprovado' ? 'A inspeção pode ser finalizada — como há reprovação, uma <b>pendência será criada automaticamente</b>.' : 'Você pode finalizar a inspeção.'}</div>
      <div class="d-flex gap-2 mt-3">
        <button class="rna-btn rna-btn-ghost" id="btn-rev">Voltar e revisar</button>
        <button class="rna-btn rna-btn-primary rna-btn-xl" id="btn-fin"><i class="bi bi-check2-circle"></i> Finalizar inspeção</button></div>`
    : `<div class="insp-card-lite mt-3"><b class="text-crit"><i class="bi bi-exclamation-triangle"></i> ${val.faltas.length} pendência(s) impedem a finalização</b>
      <ul class="insp-ul mt-2">${val.faltas.map(f => `<li><span class="rna-badge badge-pend">${f.etapa}</span> ${f.msg}</li>`).join('')}</ul>
      <button class="rna-btn rna-btn-dark rna-btn-sm mt-2" id="btn-goto"><i class="bi bi-arrow-right-circle"></i> Ir à primeira pendência</button></div>`}`;

  $('#btn-rev')?.addEventListener('click', () => { STEP = 4; renderStep(); });
  $('#btn-goto')?.addEventListener('click', () => { const et = val.faltas[0].etapa; STEP = ETAPAS.indexOf(et) >= 0 ? ETAPAS.indexOf(et) : 3; renderStep(); });
  $('#btn-fin')?.addEventListener('click', () => finalizarInspecao(r));
}

/* Finalização com modal controlado: passos explícitos, botão bloqueado durante o
   processamento, erro por etapa e SEM falha silenciosa (o modal só fecha no sucesso).
   Fluxo: (1) atualizar auditoria→FINALIZADA + (2) gerar relatório + (3) pendência se
   reprovado [tudo em INSP.finalizar] → (4) fechar modal → (5) atualizar UI → (6) ir p/ leitura. */
function finalizarInspecao(r) {
  const reprovado = r.resultado === 'reprovado';
  const m = modal({
    title: 'Finalizar inspeção',
    content: `
      <p style="margin:0 0 12px;font-size:14px">Deseja finalizar esta inspeção? Após a finalização, o relatório fica bloqueado para edição comum.</p>
      <div class="insp-result-final ${bannerClass(r.resultado)}" style="padding:12px 16px">
        <div class="insp-result-final__ic"><i class="bi ${reprovado ? 'bi-x-octagon-fill' : 'bi-check-circle-fill'}"></i></div>
        <div><div class="insp-result-final__t">RESULTADO CALCULADO</div><div class="insp-result-final__v">${reprovado ? 'REPROVADO' : 'APROVADO'}</div></div>
      </div>
      <p class="text-muted-2" style="font-size:13px;margin:10px 0 0">${reprovado
        ? 'A inspeção será concluída, o relatório gerado e uma <b>pendência criada automaticamente</b> a partir da reprovação.'
        : 'A inspeção será concluída e o relatório gerado.'}</p>
      <div id="fin-erro" class="insp-blocker mt-2" style="display:none"></div>`,
    footer: `<button class="rna-btn rna-btn-ghost" id="fin-cancel" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-primary" id="fin-ok"><i class="bi bi-check2-circle"></i> Confirmar finalização</button>`
  });
  const okBtn = $('#fin-ok', m.host), cancelBtn = $('#fin-cancel', m.host), errBox = $('#fin-erro', m.host);
  const original = okBtn.innerHTML;
  const mostrarErro = (etapa, err) => {
    console.error(`[FINALIZAR] ${etapa}:`, err);
    errBox.style.display = 'flex';
    errBox.innerHTML = `<i class="bi bi-exclamation-octagon"></i> <div><b>${etapa}</b><div class="cell-sub">${(err && err.message) || err || 'Erro desconhecido'}</div></div>`;
    okBtn.disabled = false; okBtn.innerHTML = original; cancelBtn.disabled = false;
  };

  okBtn.addEventListener('click', async () => {
    console.log('[FINALIZAR] Botão clicado — relatório', r.id);
    okBtn.disabled = true; cancelBtn.disabled = true;
    okBtn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Confirmando...';
    errBox.style.display = 'none';
    try {
      console.log('[FINALIZAR] Iniciando finalização');
      const res = await INSP.finalizar(r.id, USER);      // PASSOS 1–3 (auditoria, relatório, pendência)
      console.log('[FINALIZAR] Resultado:', res);
      if (!res.ok) {
        mostrarErro('Não é possível finalizar', new Error(res.faltas?.[0]?.msg || 'Há medições ou campos obrigatórios pendentes.'));
        return;                                           // mantém o modal aberto p/ correção
      }
      m.close();                                          // PASSO 4 — fecha o modal (só no sucesso)
      await reload(); refreshBanner();                    // PASSO 5 — atualiza a interface
      if (res.pendenciaErro) {
        toast('Inspeção finalizada, mas a pendência não pôde ser criada agora. Ela será gerada ao abrir Pendências.', { type: 'warn', title: 'Atenção', timeout: 7000 });
      } else if (res.pendencia) {
        toast(`Inspeção finalizada com sucesso. Pendência ${res.pendencia.numero} gerada automaticamente.`, { type: 'ok', title: 'Concluído', timeout: 6000 });
      } else {
        toast('Inspeção finalizada com sucesso.', { type: 'ok', title: 'Concluído' });
      }
      VIEWONLY = true; STEP = 5; paintWizard();            // PASSO 6 — vai para a visualização (leitura)
    } catch (err) {
      // Qualquer erro do PASSO 1 (atualizar auditoria) chega aqui — nunca silencioso.
      mostrarErro('❌ Erro ao finalizar a inspeção', err);
    }
  });
}
