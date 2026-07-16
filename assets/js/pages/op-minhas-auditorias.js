/* ==========================================================================
   Minhas Auditorias — Inspeção Dimensional (Operações)
   Assistente por etapas: Tipo e peça → Identificação → Amostras → Medições →
   Revisão → Resultado. Cálculo automático (§9-11), autosave (§19), classes de
   defeito (§12-16), tratamento de reprovação + pendência (§17), finalização e
   bloqueio (§20-21). Especificações somente-leitura vindas da Biblioteca (§5).
   Toda persistência via inspecao.js (db demo ou Supabase, sem alteração).
   ========================================================================== */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { can, statusClass } from '../../../services/config.js';
import * as INSP from '../../../services/inspecao.js';
import * as ATIV from '../../../services/atividades.js';
import { buscarParaInspecao, porId as pecaPorId } from '../../../services/biblioteca.js';
import { BIB_IMG_PLACEHOLDER } from '../../../services/biblioteca-data.js';
import { INSP_QUANTIDADES, INSP_STATUS, INSP_MOTIVOS_PAUSA } from '../../../services/inspecao-data.js';
import { $, $$, el, toast, modal, confirmDialog, initials } from '../ui.js';
import { initEvidenceUpload } from '../evidence.js';

const ETAPAS = ['Tipo e peça', 'Identificação', 'Amostras', 'Medições', 'Revisão', 'Resultado'];

// Estado do módulo declarado ANTES do route() de topo — evita TDZ quando a página
// abre já com ?rel= (route → openWizard roda durante a init, antes das seções abaixo).
let USER, PLANTAO, USUARIOS = [], CLASSES = [];
let R, STEP = 0, VIEWONLY = false;   // wizard
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
  const rels = await INSP.meusRelatorios(USER.id);
  const ind = await INSP.indicadoresAuditorias(rels);
  const emAndamento = rels.filter(r => r.status === 'em_andamento' || r.status === 'rascunho').length;
  const podeCriar = can(USER.role, 'op_auditorias', 'create');
  const cont = $('#rna-content');
  cont.innerHTML = `
    <div class="rna-page-head">
      <div><div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Operações <i class="bi bi-chevron-right"></i> Minhas Auditorias</div>
      <h1>Minhas Auditorias</h1><p>Inspeções dimensionais: medições, cálculo automático e relatório.</p></div>
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
      ${mini(INSP.fmtDuracao(ind.tempoMedio), 'Tempo médio/insp.', 'ic-soft-blue', 'bi-stopwatch')}
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
      <td class="cell-strong">${r.numero}</td>
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
        : `<button class="rna-btn rna-btn-primary rna-btn-sm" data-open="${r.id}"><i class="bi bi-pencil-square"></i> Continuar</button>`}
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
  R = await INSP.carregarRelatorio(relId);
  if (!R) { toast('A auditoria não foi encontrada.', { type: 'crit', title: 'Relatório inexistente' }); return renderList(); }
  const fin = String(R.rel.status).startsWith('finalizada') || R.rel.status === 'revisada';
  if (fin && !viewonly) VIEWONLY = true;           // finalizado só em modo leitura (§21)
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

async function reload() { R = await INSP.carregarRelatorio(R.rel.id); }

function paintWizard() {
  const r = R.rel;
  $('#rna-content').innerHTML = `
    <div class="rna-page-head">
      <div><div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> <a href="op-minhas-auditorias.html" id="bc-back">Minhas Auditorias</a><i class="bi bi-chevron-right"></i> ${r.numero}</div>
      <h1>${VIEWONLY ? 'Relatório de inspeção' : 'Inspeção dimensional'} <span class="insp-num">${r.numero}</span></h1>
      <p>${r.tipo_nome} ${r.peca_codigo ? '· ' + r.peca_codigo + ' — ' + r.peca_nome : ''}</p></div>
      <div class="d-flex align-items-center gap-2">
        <span id="insp-save" class="insp-save"></span>
        <button class="rna-btn rna-btn-ghost rna-btn-sm" id="bc-list"><i class="bi bi-arrow-left"></i> Voltar à lista</button>
      </div>
    </div>
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
  if (m >= 1 && r.lote && r.op) m = 2;
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
  ({ 0: stepTipoPeca, 1: stepIdentificacao, 2: stepAmostras, 3: stepMedicoes, 4: stepRevisao, 5: stepResultado }[STEP])(host);
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
  host.innerHTML = `
    <h3 class="insp-h"><i class="bi bi-diagram-3"></i> Tipo de inspeção e peça</h3>
    <div class="row g-3">
      <div class="col-md-5">
        <label class="form-label">Tipo de inspeção</label>
        <input class="form-control" value="${r.tipo_nome}" disabled>
        <small class="text-muted-2">Definido na criação. ${r.is_dimensional ? 'Exige medição dimensional.' : ''}</small>
      </div>
      <div class="col-md-7">
        <label class="form-label">Selecionar peça * <span class="text-muted-2">(Biblioteca Técnica)</span></label>
        <input class="form-control" id="pc-busca" placeholder="PN, nome, cliente, número da AD, revisão..." autocomplete="off" ${VIEWONLY ? 'disabled' : ''}>
        <div id="pc-res" class="insp-search-res"></div>
        <small class="text-muted-2">Pesquise por Part Number, nome, cliente, número da AD ou revisão do desenho. Somente peças ativas na Biblioteca Técnica.</small>
      </div>
    </div>
    <div id="pc-sel" class="mt-3">${pecaSelHtml(r)}</div>`;

  if (VIEWONLY) return;
  const inp = $('#pc-busca'), res = $('#pc-res');
  let t;
  inp.addEventListener('input', () => {
    clearTimeout(t);
    const q = inp.value.trim();
    if (q.length < 2) { RESULTADOS = []; res.innerHTML = ''; return; }
    res.innerHTML = `<div class="text-muted-2 p-2"><span class="spinner-border spinner-border-sm"></span> Carregando Biblioteca Técnica...</div>`;
    t = setTimeout(async () => {
      try {
        RESULTADOS = await buscarParaInspecao(q, 8);
      } catch (e) {
        INSP.logErro('Falha ao consultar a Biblioteca Técnica', e);
        RESULTADOS = [];
        res.innerHTML = `<div class="insp-blocker"><i class="bi bi-exclamation-octagon"></i> ${escTitle(INSP.mensagemErro(e))}</div>`;
        return;
      }
      if (inp.value.trim() !== q) return;              // resposta velha: ignora
      res.innerHTML = RESULTADOS.length
        ? RESULTADOS.map(pecaItemHtml).join('')
        : `<div class="text-muted-2 p-2"><i class="bi bi-search"></i> Nenhuma peça encontrada na Biblioteca Técnica.</div>`;
      $$('.insp-search-item', res).forEach(it => it.addEventListener('click', () => selecionarPeca(it.dataset.id)));
    }, 250);
  });
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
      <div class="col-md-4"><label class="form-label">Lote *</label><input class="form-control" id="id-lote" value="${r.lote || ''}" placeholder="Ex.: L-2026-0043" ${dis}></div>
      <div class="col-md-4"><label class="form-label">OP — Ordem de Produção *</label><input class="form-control" id="id-op" value="${r.op || ''}" placeholder="Ex.: OP-88123" ${dis}></div>
      <div class="col-md-4"><label class="form-label">Linha</label><input class="form-control" id="id-linha" value="${r.linha || ''}" placeholder="Linha" ${dis}></div>
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
  const persist = () => autosave(() => INSP.patchRelatorio(r.id, {
    lote: clean($('#id-lote').value), op: clean($('#id-op').value), linha: clean($('#id-linha').value),
    campos_opcionais: collectOpc()
  }, { evento: 'save' }).then(reload));
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
function stepMedicoes(host) {
  const r = R.rel;
  if (!r.quantidade) { host.innerHTML = `<div class="insp-blocker"><i class="bi bi-info-circle"></i> Selecione a quantidade de peças na etapa <b>Amostras</b> antes de medir.</div>`; return; }
  if (!R.caracteristicas.length) { host.innerHTML = `<div class="insp-blocker"><i class="bi bi-info-circle"></i> Esta peça não possui características cadastradas.</div>`; return; }
  const qtd = r.quantidade;
  LOCAL = {};
  R.caracteristicas.forEach(c => { LOCAL[c.id] = { min: c.minimo, max: c.maximo, tipo: c.tipo_especificacao, informativo: !!c.informativo, vals: {} }; c.medicoes.forEach(m => LOCAL[c.id].vals[m.amostra] = m.valor); });

  host.innerHTML = `
    <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
      <h3 class="insp-h mb-0"><i class="bi bi-table"></i> Medições</h3>
      <button class="rna-btn rna-btn-ghost rna-btn-sm" id="btn-ajuda-classe"><i class="bi bi-question-circle"></i> Definição das classes</button>
      <div class="flex-fill"></div>
      <span class="text-muted-2" style="font-size:12.5px"><i class="bi bi-lock"></i> Nominal/limites vêm da Biblioteca (somente leitura)</span>
    </div>
    <div class="insp-table-wrap"><table class="insp-mtable"><thead><tr>
      <th class="sticky-l">Cota</th><th>Característica</th><th>Ref.</th><th>Un.</th><th>Nominal</th><th>Mín</th><th>Máx</th><th>Equip.</th><th>Obs.</th>
      ${Array.from({ length: qtd }, (_, i) => `<th class="insp-samp">Peça ${i + 1}</th>`).join('')}
      <th>Classe</th><th>Status</th>
    </tr></thead><tbody>
      ${R.caracteristicas.map(c => linhaMedicao(c, qtd)).join('')}
    </tbody></table></div>`;

  $('#btn-ajuda-classe').addEventListener('click', ajudaClasses);
  if (VIEWONLY) { $$('.insp-minput', host).forEach(i => i.disabled = true); $$('.insp-attr', host).forEach(s => s.disabled = true); $$('.insp-classe-sel', host).forEach(s => s.disabled = true); return; }
  $$('.insp-minput', host).forEach(inp => {
    inp.addEventListener('input', () => onMedInput(inp));
    inp.addEventListener('change', () => persistMed(inp));
  });
  $$('.insp-attr', host).forEach(sel => sel.addEventListener('change', () => onAttrInput(sel)));
  $$('.insp-classe-sel', host).forEach(sel => sel.addEventListener('change', () => onClasse(sel)));
  $$('.insp-tratar', host).forEach(b => b.addEventListener('click', () => abrirTratamento(b.dataset.car)));
}

function linhaMedicao(c, qtd) {
  const attr = c.tipo_especificacao === 'ATRIBUTO';
  const informativo = !!c.informativo;
  // Célula por amostra: numérica, OK/NOK (atributo) ou nada (informativa).
  const cells = informativo
    ? `<td class="insp-samp insp-info-cell" colspan="${qtd}"><i class="bi bi-info-circle"></i> ${c.referencia || 'Característica informativa'}</td>`
    : Array.from({ length: qtd }, (_, i) => {
        const a = i + 1; const m = c.medicoes.find(x => x.amostra === a);
        const val = m ? m.valor : ''; const res = m ? m.resultado : 'pendente';
        if (attr) {
          const sel = String(val ?? '').toUpperCase();
          return `<td class="insp-samp"><select class="insp-attr ${cellCls(res)}" data-car="${c.id}" data-a="${a}">
            <option value="">—</option><option value="OK" ${sel === 'OK' ? 'selected' : ''}>OK</option><option value="NOK" ${sel === 'NOK' ? 'selected' : ''}>NOK</option></select></td>`;
        }
        return `<td class="insp-samp"><input class="insp-minput ${cellCls(res)}" data-car="${c.id}" data-a="${a}" value="${val ?? ''}" inputmode="decimal" placeholder="—"></td>`;
      }).join('');
  const tipoTag = informativo ? ' <span class="insp-tipo-tag">Referência</span>' : (attr ? ' <span class="insp-tipo-tag">OK/NOK</span>' : '');
  const dimCols = (attr || informativo)
    ? `<td colspan="3" class="cell-sub" style="text-align:center">${informativo ? '—' : 'OK / NOK'}</td>`
    : `<td>${fmt(c.nominal)}</td><td>${fmt(c.minimo)}</td><td>${fmt(c.maximo)}</td>`;
  // Referência e Observações vêm da Biblioteca Técnica (snapshot da especificação):
  // c.referencia = bib_metricas.referencia · c.observacao_tec = bib_metricas.observacao.
  const obs = c.observacao_tec || '';
  return `<tr data-row="${c.id}">
    <td class="sticky-l cell-strong">${c.cota ?? '—'}</td>
    <td>${c.caracteristica}${tipoTag}</td>
    <td class="cell-sub">${c.referencia || '—'}</td>
    <td>${c.unidade || ''}</td>${dimCols}
    <td class="cell-sub">${c.equipamento || '—'}</td>
    <td class="cell-sub insp-obs-cell"${obs ? ` title="${escTitle(obs)}"` : ''}>${obs ? `<span class="insp-obs">${escTitle(obs)}</span>` : '—'}</td>
    ${cells}
    <td class="insp-classe-cell">${informativo ? '<span class="text-muted-2">—</span>' : classeCellHtml(c)}</td>
    <td class="insp-status-cell">${informativo ? '<span class="insp-pill insp-info">Informativa</span>' : statusCellHtml(c.resultado)}</td>
  </tr>`;
}
const fmt = v => (v == null || v === '') ? '—' : String(v).replace('.', ',');
/* Escapa texto livre (observação da Biblioteca) p/ conteúdo e atributo title. */
const escTitle = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cellCls = r => r === 'aprovado' ? 'is-ok' : r === 'reprovado' ? 'is-crit' : '';
function statusCellHtml(res) {
  if (res === 'aprovado') return `<span class="insp-pill insp-ok"><i class="bi bi-check-circle-fill"></i> Aprovado</span>`;
  if (res === 'reprovado') return `<span class="insp-pill insp-crit"><i class="bi bi-x-circle-fill"></i> Reprovado</span>`;
  return `<span class="insp-pill insp-pend">Aguardando medição</span>`;
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
  LOCAL[carId].vals[a] = inp.value;
  const res = INSP.avaliarMedicao(inp.value, LOCAL[carId].min, LOCAL[carId].max, LOCAL[carId].tipo);
  inp.classList.remove('is-ok', 'is-crit'); if (res !== 'pendente') inp.classList.add(cellCls(res));
  recalcLinha(carId);
}
/* Atributo OK/NOK: recalcula local e persiste imediatamente (select change). */
function onAttrInput(sel) {
  const carId = sel.dataset.car, a = +sel.dataset.a;
  LOCAL[carId].vals[a] = sel.value;
  const res = INSP.avaliarMedicao(sel.value, null, null, 'ATRIBUTO');
  sel.classList.remove('is-ok', 'is-crit'); if (res !== 'pendente') sel.classList.add(cellCls(res));
  recalcLinha(carId);
  persistMed(sel);
}
/* Recalcula o status da linha e o banner geral a partir do modelo local. */
function recalcLinha(carId) {
  const qtd = R.rel.quantidade;
  const rowRes = INSP.resultadoCaracteristica(resInputs(carId, qtd));
  const row = document.querySelector(`tr[data-row="${carId}"]`);
  row.querySelector('.insp-status-cell').innerHTML = statusCellHtml(rowRes);
  const car = R.caracteristicas.find(c => c.id === carId); if (car) car.resultado = rowRes;
  row.querySelector('.insp-classe-cell').innerHTML = classeCellHtml(car);
  bindRowClasse(row);
  R.rel.resultado = INSP.resultadoGeral(R.caracteristicas.filter(c => !c.informativo).map(c => c.resultado));
  refreshBanner();
}
function resInputs(carId, qtd) { const out = []; const L = LOCAL[carId]; for (let s = 1; s <= qtd; s++) out.push(INSP.avaliarMedicao(L.vals[s], L.min, L.max, L.tipo)); return out; }
function bindRowClasse(row) {
  row.querySelectorAll('.insp-classe-sel').forEach(sel => sel.addEventListener('change', () => onClasse(sel)));
  row.querySelectorAll('.insp-tratar').forEach(b => b.addEventListener('click', () => abrirTratamento(b.dataset.car)));
}
async function persistMed(inp) {
  const carId = inp.dataset.car, a = +inp.dataset.a;
  await autosave(async () => { await INSP.salvarMedicao(R.rel.id, carId, a, inp.value); await reload(); });
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
  host.innerHTML = `
    <h3 class="insp-h"><i class="bi bi-clipboard-check"></i> Revisão</h3>
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
