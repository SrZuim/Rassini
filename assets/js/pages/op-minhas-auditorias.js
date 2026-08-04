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
import { usuarioPodeMedirCaracteristica, motivoBloqueioMedicao, obterCargoResponsavel,
         rotuloCargoResponsavel, rotuloCargo, normalizarQuemMede } from '../../../services/quem-mede.js';
import { SUPABASE } from '../../../services/config.js';
import { getSupabase } from '../../../services/supabaseClient.js';
import { $, $$, el, toast, modal, confirmDialog, initials } from '../ui.js';
import { initEvidenceUpload, removeEvidenceFromStorage, mensagemStorage, mensagemRegistro,
         sanitizarNomeArquivo, logAnexo, AnexoError, BUCKET,
         materializarArquivo, diagnosticarAnexos } from '../evidence.js';

/* Diagnóstico de anexos ao alcance do suporte, sem build nem breakpoint:
   abra o console (F12) e rode __rnaDiagAnexo(). */
window.__rnaDiagAnexo = diagnosticarAnexos;

/* Fluxo por etapas. "Inspeção Após Pintura" (características de equipamento
   "Visual", respondidas OK/NOK) entra ENTRE Medições e Revisão. Ao inserir aqui,
   todos os índices de STEP abaixo passam a valer por NOME via ETAPAS.indexOf. */
const ETAPAS = ['Tipo e peça', 'Identificação', 'Amostras', 'Medições', 'Inspeção Após Pintura', 'Revisão', 'Resultado'];
/* Índices nomeados — fonte única para o dispatch e os gates (evita números soltos). */
const ET = {
  TIPO_PECA: ETAPAS.indexOf('Tipo e peça'),
  IDENTIFICACAO: ETAPAS.indexOf('Identificação'),
  AMOSTRAS: ETAPAS.indexOf('Amostras'),
  MEDICOES: ETAPAS.indexOf('Medições'),
  APOS_PINTURA: ETAPAS.indexOf('Inspeção Após Pintura'),
  REVISAO: ETAPAS.indexOf('Revisão'),
  RESULTADO: ETAPAS.indexOf('Resultado')
};

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
  $$('[data-del]', cont).forEach(b => b.addEventListener('click', () => { const r = rels.find(x => x.id === b.dataset.del); confirmarExclusao(r || { id: b.dataset.del }); }));
}

/* §M01 — Confirmação de exclusão com a IDENTIFICAÇÃO do relatório (excluir é
   permanente, então o admin reconhece o registro antes de confirmar) e a lista
   explícita do que será removido em cascata. A exclusão em si (cascata + Log
   Administrativo + revalidação do perfil no servidor) fica no serviço, fonte
   única compartilhada com a Consulta de Relatórios. */
async function confirmarExclusao(r) {
  if (!podeExcluirRel()) return toast('Acesso negado.', { type: 'crit', title: 'Sem permissão' });
  if (!r) return;
  const st = INSP_STATUS[r.status] || { label: r.status, badge: 'badge-na' };
  const cell = (l, v) => `<div><span class="insp-info-l">${l}</span><span class="insp-info-v">${(v === 0 || v) ? escTitle(v) : '—'}</span></div>`;
  const m = modal({
    title: 'Excluir Relatório Dimensional',
    content: `
      <div class="cdim-del-box">
        ${cell('Nº do relatório', r.numero)} ${cell('Cliente', r.cliente)}
        ${cell('PN', r.peca_codigo)} ${cell('Tipo de inspeção', r.tipo_nome)}
        ${cell('Auditor', r.auditor_nome)} ${cell('Status', st.label)}
      </div>
      <div class="insp-blocker mt-3" style="border-left:4px solid var(--rna-crit)">
        <i class="bi bi-exclamation-octagon"></i>
        <div><b>Tem certeza que deseja excluir este relatório?</b>
        <div class="cell-sub">Esta ação removerá permanentemente: relatório, medições, resultados,
        anexos, colaboradores, revisões, histórico e pendências vinculadas.
        <b>Esta ação não poderá ser desfeita.</b></div></div>
      </div>
      <div id="del-erro" class="insp-blocker mt-2" style="display:none"></div>`,
    footer: `<button class="rna-btn rna-btn-ghost" id="del-cancel" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-dark" id="del-ok"><i class="bi bi-trash"></i> Excluir relatório</button>`
  });
  const ok = $('#del-ok', m.host), cancel = $('#del-cancel', m.host), err = $('#del-erro', m.host);
  ok.addEventListener('click', async () => {
    ok.disabled = true; cancel.disabled = true;
    ok.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Excluindo...';
    err.style.display = 'none';
    try {
      const res = await INSP.excluirRelatorios([r.id], USER);
      if (res.erros.length) throw new Error(res.erros[0].mensagem);
      m.close();
      if (res.ok[0]?.logRegistrado === false) {
        toast('Relatório excluído, mas o Log Administrativo não pôde ser gravado. Verifique as permissões de log.',
          { type: 'warn', title: 'Excluído com ressalva', timeout: 8000 });
      } else {
        toast(`Relatório ${res.ok[0]?.numero || ''} excluído permanentemente.`, { type: 'ok', title: 'Exclusão concluída' });
      }
      await renderList();                              // atualiza tabela + indicadores sem recarregar a página
    } catch (e) {
      INSP.logErro('Falha ao excluir o relatório', e);
      err.style.display = 'flex';
      err.innerHTML = `<i class="bi bi-exclamation-octagon"></i> <div><b>Não foi possível excluir</b><div class="cell-sub">${escTitle(INSP.mensagemErro(e))}</div></div>`;
      ok.disabled = false; cancel.disabled = false; ok.innerHTML = '<i class="bi bi-trash"></i> Excluir relatório';
    }
  });
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
        ${btnExcluir(r)}
      </div></td></tr>`;
    }).join('')}
  </tbody></table></div>`;
}

/* §M01 — Exclusão direta na tela "Meus Relatórios Dimensionais", sem depender da
   Biblioteca. Regra de permissão vinda da fonte única do serviço (reavaliada no
   clique e de novo no servidor antes de gravar): SOMENTE administrador. Os demais
   perfis (auditor, supervisor, visitante) nem recebem o botão no HTML. Admin pode
   excluir em QUALQUER status — inclusive relatórios colaborativos de terceiros. */
const podeExcluirRel = () => INSP.podeExcluirRelatorio(USER) && can(USER.role, 'op_auditorias', 'delete');
const btnExcluir = r => podeExcluirRel()
  ? `<button class="rna-btn rna-btn-ghost rna-btn-sm insp-btn-del" data-del="${r.id}" title="Excluir relatório"
       aria-label="Excluir relatório ${escTitle(r.numero || '')}"><i class="bi bi-trash"></i> Excluir</button>`
  : '';

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
  STEP = VIEWONLY ? ET.REVISAO : (R.rel.etapa || 0);
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
  if (r.tipo_id && pecaVinculada()) m = ET.IDENTIFICACAO;
  if (m >= ET.IDENTIFICACAO && r.lote && opValida(r.op)) m = ET.AMOSTRAS;
  if (m >= ET.AMOSTRAS && r.quantidade) m = ET.MEDICOES;
  // §Gate — só libera a Inspeção Após Pintura quando NÃO houver característica
  // dimensional obrigatória sem preenchimento (visuais saem deste gate).
  if (m >= ET.MEDICOES && pendentesMedicao().length === 0) m = ET.APOS_PINTURA;
  // §Gate visual — só libera a Revisão com toda característica visual respondida
  // (OK/NOK). O Relatório de Pintura é opcional e não participa deste gate.
  if (m >= ET.APOS_PINTURA && visualCompleto()) m = ET.REVISAO;
  if (m >= ET.REVISAO) m = ET.RESULTADO;
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
  let bloqueio = '';
  if (STEP === ET.TIPO_PECA && !(pecaVinculada() && !SELECIONANDO)) {
    bloqueio = 'Selecione uma peça da Biblioteca Técnica para avançar.';
  } else if (STEP === ET.MEDICOES) {
    // §Gate — Próximo só habilita com 100% das dimensionais obrigatórias preenchidas.
    const n = pendentesMedicao().length;
    if (n) bloqueio = `Faltam ${n} característica(s) obrigatória(s) sem medição. Preencha todas para avançar à Inspeção Após Pintura.`;
  } else if (STEP === ET.APOS_PINTURA) {
    // §Gate visual — todas OK/NOK respondidas + Relatório de Pintura anexado.
    bloqueio = bloqueioVisual();
  }
  next.disabled = !!bloqueio;
  next.title = bloqueio;
}

async function onNext() {
  const r = R.rel;
  if (STEP === ET.TIPO_PECA && !r.tipo_id) return toast('Tipo de inspeção ausente. Reabra a inspeção.', { type: 'warn' });
  if (STEP === ET.TIPO_PECA && !pecaVinculada())
    return toast('Selecione uma peça da Biblioteca Técnica. O vínculo precisa estar salvo antes de avançar.', { type: 'warn', title: 'Peça obrigatória' });
  if (STEP === ET.IDENTIFICACAO && (!String(r.lote).trim() || !String(r.op).trim())) return toast('Informe o lote e a OP.', { type: 'warn' });
  // §Erro 03 — campo obrigatório inválido não deixa avançar
  if (STEP === ET.IDENTIFICACAO && !opValida(r.op)) { $('#id-op')?.focus(); return toast(MSG_OP_INVALIDA, { type: 'warn', title: 'OP inválida' }); }
  if (STEP === ET.AMOSTRAS && !r.quantidade) return toast('Selecione a quantidade de peças.', { type: 'warn' });
  /* §Gate — Medições → Inspeção Após Pintura só com TODAS as dimensionais
     obrigatórias preenchidas. Lista as cotas faltantes e destaca as linhas. */
  if (STEP === ET.MEDICOES) {
    const pend = pendentesMedicao();
    if (pend.length) { alertaPendenciasMedicao(pend); return; }
  }
  /* §Gate visual — não avança à Revisão com característica visual sem OK/NOK ou
     sem o Relatório de Pintura anexado (não é possível pular para Resultado). */
  if (STEP === ET.APOS_PINTURA) {
    const b = bloqueioVisual();
    if (b) { alertaVisualPendente(); return; }
  }
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
  const passos = {
    [ET.TIPO_PECA]: stepTipoPeca, [ET.IDENTIFICACAO]: stepIdentificacao, [ET.AMOSTRAS]: stepAmostras,
    [ET.MEDICOES]: stepMedicoes, [ET.APOS_PINTURA]: stepInspecaoPintura, [ET.REVISAO]: stepRevisao, [ET.RESULTADO]: stepResultado
  };
  Promise.resolve(passos[STEP](host))
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
    <p class="text-muted-2">Define automaticamente as colunas de medição (1 a 10 peças).</p>
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
/* ================================================= SEPARAÇÃO POR EQUIPAMENTO ==
   Características de equipamento "Visual" NÃO aparecem em Medições — elas vivem
   exclusivamente na etapa Inspeção Após Pintura. A separação é só de fluxo (o
   banco não muda): fonte única no serviço (INSP.ehCaracteristicaVisual). */
function caracteristicasMedicao() { return R.caracteristicas.filter(c => !INSP.ehCaracteristicaVisual(c)); }
function caracteristicasVisuais() { return R.caracteristicas.filter(c => INSP.ehCaracteristicaVisual(c)); }

async function stepMedicoes(host) {
  const r = R.rel;
  if (!r.quantidade) { host.innerHTML = `<div class="insp-blocker"><i class="bi bi-info-circle"></i> Selecione a quantidade de peças na etapa <b>Amostras</b> antes de medir.</div>`; atualizarNav(); return; }
  const medCars = caracteristicasMedicao();
  if (!medCars.length) {
    // Peça só com características visuais (ou sem cadastro dimensional): nada a medir.
    host.innerHTML = `<div class="insp-blocker"><i class="bi bi-info-circle"></i> Esta peça não possui características dimensionais para medir. ${
      caracteristicasVisuais().length ? 'Avance para a etapa <b>Inspeção Após Pintura</b>.' : 'Verifique o cadastro na Biblioteca Técnica.'}</div>`;
    atualizarNav();
    return;
  }
  const qtd = r.quantidade;
  LOCAL = {};
  medCars.forEach(c => { LOCAL[c.id] = { min: c.minimo, max: c.maximo, tipo: c.tipo_especificacao, informativo: !!c.informativo, vals: {} }; c.medicoes.forEach(m => LOCAL[c.id].vals[m.amostra] = m.valor); });

  /* §M04 — estado colaborativo das amostras. Travas abandonadas são liberadas
     ao abrir a tela (higiene), então uma queda de rede não deixa peça presa. */
  await AMOSTRAS.liberarExpiradas(r.id).catch(() => {});
  AMOST_ERRO = null;
  AMOST = await AMOSTRAS.estadoAmostras(r.id, qtd).catch(e => { AMOST_ERRO = e; INSP.logErro('Falha ao carregar amostras colaborativas', e); return []; });

  host.innerHTML = `
    <div class="d-flex flex-wrap align-items-center gap-2 mb-2">
      <h3 class="insp-h mb-0"><i class="bi bi-table"></i> Medições</h3>
      <button class="rna-btn rna-btn-ghost rna-btn-sm" id="btn-ajuda-classe"><i class="bi bi-question-circle"></i> Definição das classes</button>
      <div class="flex-fill"></div>
      <span class="text-muted-2" style="font-size:12.5px"><i class="bi bi-lock"></i> Nominal/limites vêm da Biblioteca (somente leitura)</span>
    </div>
    ${progressoMedicaoHtml()}
    ${progressoSetorHtml()}
    <div id="insp-colab"></div>
    <div id="insp-classe-alerta"></div>
    <div class="insp-table-wrap"><table class="insp-mtable"><thead><tr>
      <th class="sticky-l">Cota</th><th>Característica</th><th>Quadrante</th><th>Ref.</th><th>Un.</th><th>Nominal</th><th>Mín</th><th>Máx</th><th>Equip.</th><th>Obs.</th>
      ${Array.from({ length: qtd }, (_, i) => cabecalhoAmostra(i + 1)).join('')}
      <th>Classe</th><th>Status</th>
    </tr></thead><tbody>
      ${medCars.map(c => linhaMedicao(c, qtd)).join('')}
    </tbody></table></div>`;

  $('#btn-ajuda-classe').addEventListener('click', ajudaClasses);
  pintarColaboradores();
  pintarAlertaClasse();
  /* §Erro 05 — observação completa por clique/toque (também em modo leitura). */
  $$('[data-obs]', host).forEach(b => b.addEventListener('click', () => abrirObservacao(b.dataset.obs)));
  if (VIEWONLY) { $$('.insp-minput', host).forEach(i => i.disabled = true); $$('.insp-oknok__b', host).forEach(b => b.disabled = true); return; }
  $$('.insp-minput', host).forEach(inp => {
    inp.addEventListener('input', () => onMedInput(inp));
    inp.addEventListener('change', () => persistMed(inp));
  });
  $$('.insp-oknok__b', host).forEach(btn => btn.addEventListener('click', () => onOkNok(btn)));
  /* §Erro 04 — Enter avança para a próxima medição. UM ÚNICO listener delegado
     no container da etapa: ele morre junto com o HTML quando a etapa é
     repintada, então não há acúmulo de listeners nem vazamento. */
  host.addEventListener('keydown', onTeclaMedicao);
  $$('.insp-tratar', host).forEach(b => b.addEventListener('click', () => abrirTratamento(b.dataset.car)));
  wireAmostras();
  aplicarBloqueios();
  marcarPendentesMedicao();     // §Gate — destaca as obrigatórias sem preenchimento
  atualizarNav();               // reflete o estado do "Próximo" ao abrir a etapa
}

/* ==================== COLABORAÇÃO POR AMOSTRA (§M04) ======================== */
let AMOST = [];          // estado das amostras (com trava)
let AMOST_ERRO = null;   // erro ao carregar as amostras (ex.: migration pendente)
let BATIDA;              // timer do sinal de vida
let MINHAS = new Set();  // amostras que ESTE navegador está segurando

/* A camada colaborativa vive na tabela `insp_amostras`, criada por
   database/fix_amostras_colaborativas.sql. Em bancos onde essa migration ainda
   não rodou, o PostgREST devolve PGRST205 ("tabela não encontrada") e QUALQUER
   operação de posse (assumir/liberar/concluir) falha. Sem tratamento, o botão
   "Assumir" morre calado e os campos de medição nunca são liberados — o auditor
   vê só o placeholder "—". Estas mensagens transformam a falha silenciosa em uma
   instrução acionável. */
const MSG_AMOSTRAS_MIGRACAO = 'O módulo de medição colaborativa (§M04) ainda não foi instalado neste banco: a tabela <b>insp_amostras</b> não existe. Peça ao administrador para executar <b>database/fix_amostras_colaborativas.sql</b> no Supabase. Enquanto isso não é possível assumir peças nem registrar medições.';
const amostrasSemTabela = e => e?.code === 'PGRST205' || /insp_amostras/i.test(String(e?.message || ''));
function msgErroAmostras(e) {
  return amostrasSemTabela(e)
    ? 'Módulo de medição colaborativa não instalado neste banco (tabela insp_amostras ausente). Rode database/fix_amostras_colaborativas.sql no Supabase.'
    : 'Não foi possível falar com o servidor para assumir a peça. Verifique a conexão e tente novamente.';
}

const amostraDe = n => AMOST.find(a => Number(a.amostra) === Number(n));
/* Só edita quem detém a trava. Sem trava ativa, a coluna fica somente-leitura —
   é o que impede dois auditores de sobrescreverem a mesma peça. */
const euEdito = n => AMOSTRAS.podeEditar(amostraDe(n), USER.id);
/* [CONTROLE DE MEDIÇÃO POR CARGO] O usuário pode ASSUMIR a peça? Só se houver ao
   menos uma característica que o cargo dele responda (§6). Caso contrário, a peça
   é de outro setor e ele apenas acompanha — o botão Assumir some (§21). */
const euPossoAssumir = () => (R?.caracteristicas || []).some(c => podeMedirCarac(c));

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
    else if (!euPossoAssumir()) acao = `<span class="rna-badge badge-na" title="Nenhuma característica desta peça é do seu cargo (${escTitle(rotuloCargo(USER.role))}). Você acompanha, mas não mede."><i class="bi bi-lock"></i> Bloqueado p/ seu cargo</span>`;
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
  /* Migration pendente: sem a tabela insp_amostras não há posse possível. Avisa
     com destaque de erro em vez de deixar botões "Assumir" inertes na tela. */
  if (AMOST_ERRO) {
    box.className = 'insp-blocker mb-2';
    box.style.borderLeft = '4px solid var(--rna-red-600, #c0392b)';
    box.innerHTML = `<i class="bi bi-exclamation-octagon-fill"></i> <div>${amostrasSemTabela(AMOST_ERRO)
      ? MSG_AMOSTRAS_MIGRACAO
      : 'Não foi possível carregar o estado colaborativo das peças. Verifique a conexão e recarregue a página.'}</div>`;
    return;
  }
  box.style.borderLeft = '';
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

/* §Erro 10 — alerta de cadastro incompleto. Item reprovado sem classe cadastrada
   NÃO impede medir nem finalizar: apenas avisa quem pode corrigir a Biblioteca.
   O sistema jamais "chuta" A, B ou C. */
function pintarAlertaClasse() {
  const box = $('#insp-classe-alerta'); if (!box) return;
  const faltando = INSP.caracteristicasSemClasse(caracteristicasMedicao());
  if (!faltando.length) { box.innerHTML = ''; box.className = ''; return; }
  box.className = 'insp-blocker mb-2';
  box.style.borderLeft = '4px solid var(--rna-yellow-600)';
  box.innerHTML = `<i class="bi bi-exclamation-triangle"></i> <div>
    <b>${faltando.length} característica(s) reprovada(s) sem Classe da Não Conformidade cadastrada.</b>
    <div class="cell-sub">${faltando.map(c => `Cota ${escTitle(String(c.cota ?? '—'))} · ${escTitle(c.caracteristica || '')}`).join(' · ')}</div>
    <div class="cell-sub mt-1">A classificação pertence à característica e é cadastrada na
    <b>Biblioteca Técnica</b>. Você pode concluir a inspeção normalmente — avise o administrador para completar o cadastro.
    ${can(USER.role, 'biblioteca', 'edit') ? `<a class="rna-btn rna-btn-dark rna-btn-sm ms-2" href="biblioteca.html"><i class="bi bi-box-seam"></i> Abrir Biblioteca Técnica</a>` : ''}</div></div>`;
}

/** Liga/desliga os campos conforme a posse da coluna. */
function aplicarBloqueios() {
  if (VIEWONLY) return;
  const tituloTrava = n => { const a = amostraDe(n); return a?.status === 'concluida'
    ? `Peça ${n} concluída — use Reabrir para corrigir.`
    : a?._travaAtiva ? `Peça ${n} em edição por ${a.bloqueado_nome}.`
    : `Clique em "Assumir" no topo da coluna da Peça ${n} para medir.`; };
  /* [CONTROLE DE MEDIÇÃO POR CARGO] uma célula só é editável se (a) o cargo do
     usuário responde por aquela característica E (b) ele detém a trava da peça.
     O bloqueio por cargo vence o de trava e mostra o motivo do cargo. */
  const carDe = el => R.caracteristicas.find(x => x.id === el.dataset.car);
  const cargoBloqueado = c => c && !VIEWONLY && !podeMedirCarac(c);
  $$('.insp-minput').forEach(el => {
    const n = +el.dataset.a, c = carDe(el);
    const bloqCargo = cargoBloqueado(c);
    const livre = !bloqCargo && euEdito(n);
    el.disabled = !livre;
    el.classList.toggle('is-cargo-block', !!bloqCargo);
    el.classList.toggle('is-bloqueada', !livre && !bloqCargo);
    if (bloqCargo) el.title = motivoBloqueioMedicao(USER, c)?.msg || 'Bloqueado para o seu cargo.';
    else if (!livre) el.title = tituloTrava(n);
    else {
      /* Campo liberado: o tooltip volta a explicar o STATUS da medição
         (aprovado / aprovado com atenção / reprovado), não a trava. */
      const d = LOCAL[el.dataset.car] ? avaliarLocal(el.dataset.car, el.value) : null;
      el.title = d ? `${d.label}${d.motivo ? ' · ' + d.motivo : ''}` : '';
    }
  });
  /* Grupos OK/NOK: bloqueio = desabilitar os DOIS botões + marca visual na célula. */
  $$('.insp-oknok').forEach(grupo => {
    const n = +grupo.dataset.a, c = carDe(grupo);
    const bloqCargo = cargoBloqueado(c);
    const livre = !bloqCargo && euEdito(n);
    grupo.classList.toggle('is-cargo-block', !!bloqCargo);
    grupo.classList.toggle('is-bloqueada', !livre && !bloqCargo);
    grupo.querySelectorAll('.insp-oknok__b').forEach(b => { b.disabled = !livre; });
    if (bloqCargo) grupo.title = motivoBloqueioMedicao(USER, c)?.msg || 'Bloqueado para o seu cargo.';
    else if (!livre) grupo.title = tituloTrava(n);
    else { const d = LOCAL[grupo.dataset.car] ? avaliarLocal(grupo.dataset.car, grupo.dataset.val) : null;
      grupo.title = d ? `${d.label}${d.motivo ? ' · ' + d.motivo : ''}` : ''; }
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
  let res;
  try {
    res = await AMOSTRAS.assumirAmostra(R.rel.id, n, USER);
  } catch (e) {
    /* §Erro — assumir falhava calado quando a camada colaborativa não respondia
       (tabela ausente, RLS, rede). Sem isto o campo ficava travado no "—". */
    INSP.logErro('Falha ao assumir amostra', e);
    if (amostrasSemTabela(e)) { AMOST_ERRO = e; pintarColaboradores(); }
    return toast(msgErroAmostras(e), { type: 'crit', title: 'Não foi possível assumir a peça', timeout: 9000 });
  }
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
  caracteristicasMedicao().forEach(c => {
    if (!INSP.caracteristicaObrigatoriaMedicao(c)) return;
    const v = LOCAL[c.id]?.vals[n];
    if (INSP.celulaPendente(c, v)) f++;
  });
  return f;
}

/* ============== GATE DE COMPLETUDE DAS MEDIÇÕES (frontend, espelha o serviço) ==
   Bloqueia Medições → Revisão enquanto houver característica obrigatória sem
   preencher. "Obrigatória" e "vazio" vêm da FONTE ÚNICA no serviço
   (INSP.caracteristicaObrigatoriaMedicao / INSP.medicaoVazia); o back revalida em
   validarFinalizacao, então a regra não é apenas visual. */

/** Valor atual da amostra: na etapa Medições prioriza o valor AO VIVO digitado
    (LOCAL); fora dela usa o persistido (R.caracteristicas). */
function valorAmostra(c, a) {
  const L = LOCAL?.[c.id];
  if (STEP === ET.MEDICOES && L && Object.prototype.hasOwnProperty.call(L.vals, a)) return L.vals[a];
  const m = (c.medicoes || []).find(x => x.amostra === a);
  return m ? m.valor : undefined;
}

/** Características DIMENSIONAIS obrigatórias ainda sem preenchimento completo.
    Visuais são excluídas: têm o seu gate próprio (Inspeção Após Pintura). */
function pendentesMedicao() {
  const qtd = R.rel.quantidade || 0;
  const pend = [];
  caracteristicasMedicao().forEach(c => {
    if (!INSP.caracteristicaObrigatoriaMedicao(c)) return;
    let faltam = 0;
    for (let a = 1; a <= qtd; a++) if (INSP.celulaPendente(c, valorAmostra(c, a))) faltam++;
    if (faltam) pend.push({ id: c.id, cota: c.cota, caracteristica: c.caracteristica, referencia: !!c.informativo });
  });
  return pend;
}

/** Progresso das medições obrigatórias (característica 100% medida = concluída). */
function progressoMedicao() {
  const qtd = R.rel.quantidade || 0;
  const obrig = caracteristicasMedicao().filter(c => INSP.caracteristicaObrigatoriaMedicao(c));
  const feitas = obrig.filter(c => {
    for (let a = 1; a <= qtd; a++) if (INSP.celulaPendente(c, valorAmostra(c, a))) return false;
    return true;
  }).length;
  const total = obrig.length;
  return { feitas, total, pct: total ? Math.round(feitas / total * 100) : 100 };
}

function progressoMedicaoHtml() {
  const { feitas, total, pct } = progressoMedicao();
  const done = total > 0 && feitas >= total;
  return `<div class="insp-med-progress ${done ? 'is-done' : ''}" id="insp-med-progress">
    <div class="insp-med-progress__top">
      <span class="insp-med-progress__t"><i class="bi ${done ? 'bi-check-circle-fill' : 'bi-rulers'}"></i> Medições obrigatórias</span>
      <span class="insp-med-progress__n">${feitas} / ${total} concluídas · ${pct}%</span>
    </div>
    <div class="insp-med-progress__bar"><span style="width:${pct}%"></span></div>
    ${done ? `<div class="insp-med-progress__ok"><i class="bi bi-check2-all"></i> Todas as medições obrigatórias realizadas.</div>` : ''}
  </div>`;
}

/* [CONTROLE DE MEDIÇÃO POR CARGO] §15 — progresso por SETOR (Quem Mede). Agrupa
   as características obrigatórias por responsável e conta quantas estão 100%
   preenchidas em todas as peças. Ajuda a entender por que o relatório não avança
   (§16) — "faltam 4 do Laboratório", em vez de uma mensagem genérica. */
function progressoPorSetor() {
  const qtd = R.rel.quantidade || 0;
  const grupos = new Map();
  caracteristicasMedicao().forEach(c => {
    if (!INSP.caracteristicaObrigatoriaMedicao(c)) return;
    const setor = normalizarQuemMede(c.quem_mede) || (c.quem_mede || 'Sem responsável');
    const g = grupos.get(setor) || { setor, feitas: 0, total: 0 };
    g.total++;
    let completa = true;
    for (let a = 1; a <= qtd; a++) if (INSP.celulaPendente(c, valorAmostra(c, a))) { completa = false; break; }
    if (completa) g.feitas++;
    grupos.set(setor, g);
  });
  return [...grupos.values()].sort((a, b) => a.setor.localeCompare(b.setor));
}
function progressoSetorHtml() {
  const setores = progressoPorSetor();
  if (setores.length <= 1) return '';   // peça de um setor só: o progresso geral já basta
  const chip = g => {
    const done = g.total > 0 && g.feitas >= g.total;
    const st = done ? 'Concluído' : g.feitas === 0 ? 'Não iniciado' : 'Em andamento';
    const cls = done ? 'is-done' : g.feitas === 0 ? 'is-idle' : 'is-doing';
    return `<div class="insp-setor-chip ${cls}"><span class="insp-setor-chip__t"><i class="bi bi-person-badge"></i> ${escTitle(g.setor)}</span>
      <span class="insp-setor-chip__n">${g.feitas} de ${g.total} · ${st}</span></div>`;
  };
  return `<div class="insp-setor-grid" id="insp-setor-grid"><div class="insp-setor-grid__t"><i class="bi bi-diagram-3"></i> Progresso por setor</div>
    <div class="insp-setor-chips">${setores.map(chip).join('')}</div></div>`;
}

/** Recalcula barra de progresso, destaque das pendências e o botão Próximo. */
function atualizarProgressoMedicoes() {
  $('#insp-med-progress')?.replaceWith(el(progressoMedicaoHtml()));
  const setorHtml = progressoSetorHtml();
  const grid = $('#insp-setor-grid');
  if (grid && setorHtml) grid.replaceWith(el(setorHtml));   // só existe quando há +de 1 setor
  marcarPendentesMedicao();
  atualizarNav();
}

/** Destaque visual (borda/fundo vermelhos + ícone) das obrigatórias sem preencher. */
function marcarPendentesMedicao() {
  const qtd = R.rel.quantidade || 0;
  caracteristicasMedicao().forEach(c => {
    const row = document.querySelector(`tr[data-row="${c.id}"]`);
    if (!row) return;
    const obrig = INSP.caracteristicaObrigatoriaMedicao(c);
    const faltam = [];
    if (obrig) for (let a = 1; a <= qtd; a++) if (INSP.celulaPendente(c, valorAmostra(c, a))) faltam.push(a);
    row.classList.toggle('insp-row-pend', faltam.length > 0);
    row.querySelectorAll('.insp-minput, .insp-oknok').forEach(elm => {
      elm.classList.toggle('is-pend', obrig && faltam.includes(+elm.dataset.a));
    });
    const cota = row.querySelector('.sticky-l');
    if (cota) {
      const ic = cota.querySelector('.insp-pend-ic');
      if (faltam.length && !ic) cota.insertAdjacentHTML('afterbegin', '<i class="bi bi-exclamation-triangle-fill insp-pend-ic" title="Medição obrigatória pendente"></i> ');
      else if (!faltam.length && ic) ic.remove();
    }
  });
}

/** Modal de pendências ao tentar avançar com medições faltando (§gate). */
function alertaPendenciasMedicao(pend) {
  marcarPendentesMedicao();
  const itens = pend.map(p => `<li><span class="rna-badge badge-pend">Cota ${escTitle(p.cota ?? '—')}</span> ${escTitle(p.caracteristica || '')}${p.referencia ? ' <span class="cell-sub">(referência — obrigatória)</span>' : ''}</li>`).join('');
  modal({
    title: 'Medições pendentes',
    content: `<p style="margin:0 0 10px;font-size:14px">Existem características sem medição. Finalize todas as medições antes de prosseguir para a etapa de revisão.</p>
      <div class="insp-card-lite"><b class="text-crit"><i class="bi bi-exclamation-triangle"></i> Pendentes (${pend.length})</b>
      <ul class="insp-ul mt-2">${itens}</ul></div>`,
    footer: `<button class="rna-btn rna-btn-primary" data-bs-dismiss="modal">OK</button>`
  });
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

/* [CONTROLE DE MEDIÇÃO POR CARGO] Este usuário pode medir ESTA característica?
   Regra única em services/quem-mede.js (admin sempre; supervisor conforme const;
   demais: cargo === responsável do "Quem Mede"). */
const podeMedirCarac = c => usuarioPodeMedirCaracteristica(USER, c);

/* Badge discreto do "Quem Mede" (setor) sob o nome da característica (§20). */
function quemMedeBadge(c) {
  const qm = normalizarQuemMede(c?.quem_mede) || (c?.quem_mede || '');
  if (!qm) return ' <span class="insp-setor-tag insp-setor-tag--sem" title="Sem responsável definido em Quem Mede — corrija na Biblioteca Técnica."><i class="bi bi-exclamation-triangle"></i> Sem responsável</span>';
  const bloq = !VIEWONLY && !podeMedirCarac(c);
  return ` <span class="insp-setor-tag ${bloq ? 'insp-setor-tag--block' : ''}" title="Quem mede: ${escTitle(qm)}${bloq ? ` · Bloqueado para o seu cargo (${escTitle(rotuloCargo(USER.role))})` : ''}"><i class="bi bi-person-badge"></i> ${escTitle(qm)}</span>`;
}

function linhaMedicao(c, qtd) {
  /* O tipo cadastrado na Biblioteca decide o COMPONENTE de entrada: Verificação
     (ATRIBUTO) → <select> OK/NOK; demais tipos → campo numérico. Comparação
     tolerante a caixa/espaço para que um tipo legado ('atributo') nunca escorregue
     para o campo numérico (as leituras já normalizam via normalizarCaracteristica;
     isto é a rede de segurança final na própria renderização). */
  const attr = String(c.tipo_especificacao ?? '').trim().toUpperCase() === 'ATRIBUTO';
  /* [CONTROLE DE MEDIÇÃO POR CARGO] célula bloqueada quando o cargo do usuário
     não responde por este "Quem Mede". A linha permanece VISÍVEL (acompanhamento);
     só o preenchimento é travado (§5/§7). aplicarBloqueios reforça no runtime. */
  const bloqCargo = !VIEWONLY && !podeMedirCarac(c);
  const tituloCargo = bloqCargo ? (motivoBloqueioMedicao(USER, c)?.msg || 'Bloqueado para o seu cargo.') : '';
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
      /* Verificação (OK/NOK): NENHUM campo digitável. Dois botões [OK] [NOK] —
         o auditor só MARCA. Valor legado inválido ('85', 'okkkk') não seleciona
         nada: a característica aparece pendente e exige nova escolha. */
      const sel = INSP.valorOkNokValido(val) ? String(val).trim().toUpperCase() : '';
      const cargoTitle = bloqCargo ? ` title="${escTitle(tituloCargo)}"` : '';
      return `<td class="insp-samp"><div class="insp-oknok ${visCls(d.visual)} ${bloqCargo ? 'is-cargo-block' : ''}" data-car="${c.id}" data-a="${a}" data-val="${sel}" role="group" aria-label="Resultado da Peça ${a}" title="${escTitle(bloqCargo ? tituloCargo : d.label)}">
        <button type="button" class="insp-oknok__b insp-oknok__ok ${sel === 'OK' ? 'is-on' : ''}" data-oknok="OK" data-car="${c.id}" data-a="${a}" aria-pressed="${sel === 'OK'}"${bloqCargo ? ' disabled' : ''}${cargoTitle || ` title="Peça ${a} — Conforme (OK)"`}><i class="bi bi-check-lg"></i> OK</button>
        <button type="button" class="insp-oknok__b insp-oknok__nok ${sel === 'NOK' ? 'is-on' : ''}" data-oknok="NOK" data-car="${c.id}" data-a="${a}" aria-pressed="${sel === 'NOK'}"${bloqCargo ? ' disabled' : ''}${cargoTitle || ` title="Peça ${a} — Não conforme (NOK)"`}><i class="bi bi-x-lg"></i> NOK</button>
      </div></td>`;
    }
    return `<td class="insp-samp"><input class="insp-minput ${informativo ? 'is-ref' : ''} ${visCls(d.visual)} ${bloqCargo ? 'is-cargo-block' : ''}"
      data-car="${c.id}" data-a="${a}" data-ref="${informativo ? '1' : ''}" value="${escTitle(val ?? '')}" ${bloqCargo ? 'disabled' : ''}
      inputmode="decimal" placeholder="${bloqCargo ? '🔒' : '—'}" title="${escTitle(bloqCargo ? tituloCargo : `Peça ${a} — ${d.label}${d.motivo ? ' · ' + d.motivo : ''}${informativo ? ' (referência, sem limites)' : ''}`)}"></td>`;
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
  return `<tr data-row="${c.id}" class="${bloqCargo ? 'insp-row-cargo-block' : ''}">
    <td class="sticky-l cell-strong">${c.cota ?? '—'}</td>
    <td>${c.caracteristica}${tipoTag}${obrigTag}<div class="insp-setor-line">${quemMedeBadge(c)}</div></td>
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
/* §Erro 10 — CLASSE AUTOMÁTICA, SOMENTE LEITURA.
   A classe pertence à característica cadastrada na Biblioteca Técnica: quando o
   item reprova, o sistema a preenche sozinho. O auditor não escolhe e não edita
   — por isso aqui não há mais `<select>`, apenas o selo do que está cadastrado.
   Aprovado não exibe classe nenhuma. */
function classeCellHtml(c) {
  if (c.resultado !== 'reprovado' || c.informativo) return '<span class="text-muted-2">—</span>';
  const cad = INSP.classeCadastrada(c);
  const selo = c.classe_defeito
    ? `<span class="rna-badge ${c.classe_defeito === 'A' ? 'badge-crit' : c.classe_defeito === 'B' ? 'badge-warn' : 'badge-pend'}"
         title="Classe cadastrada na Biblioteca Técnica para esta característica."><i class="bi bi-lock-fill"></i> Classe ${c.classe_defeito}</span>`
    : cad === 'NA'
      ? `<span class="rna-badge badge-na" title="A Engenharia definiu que esta característica reprova sem classificação.">Não se aplica</span>`
      : `<span class="rna-badge badge-warn insp-classe-pend" title="Cadastre a Classe da Não Conformidade desta característica na Biblioteca Técnica."><i class="bi bi-exclamation-triangle"></i> Classe não cadastrada</span>`;
  return `<div class="d-flex flex-column gap-1">${selo}
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
/* Verificação OK/NOK: um clique MARCA a opção (nunca digita). Recalcula local e
   persiste imediatamente. O valor gravado é sempre 'OK' ou 'NOK' exatos — não há
   caminho para texto livre. */
function onOkNok(btn) {
  const grupo = btn.closest('.insp-oknok'); if (!grupo) return;
  const carId = grupo.dataset.car, a = +grupo.dataset.a;
  /* §M04 — só marca quem detém a trava da peça (defesa além do `disabled`). */
  if (!VIEWONLY && !euEdito(a)) {
    const dono = amostraDe(a);
    return toast(dono?.status === 'concluida'
      ? `A Peça ${a} está concluída. Use "Reabrir" para corrigir.`
      : `A Peça ${a} está com ${dono?.bloqueado_nome || 'outro auditor'}. Assuma a peça para medir.`,
      { type: 'warn', title: 'Peça bloqueada' });
  }
  const val = btn.dataset.oknok;                 // 'OK' | 'NOK'
  grupo.dataset.val = val;
  selecionarBotaoOkNok(grupo, val);
  LOCAL[carId].vals[a] = val;
  pintarCampo(grupo, avaliarLocal(carId, val));
  recalcLinha(carId);
  /* Persiste como qualquer medição: grava autoria + histórico com 'OK'/'NOK'. */
  autosave(async () => {
    await INSP.salvarMedicao(R.rel.id, carId, a, val, USER);
    await AMOSTRAS.recalcularResultados(R.rel.id, R.rel.quantidade).catch(() => {});
    await reload();
  });
}
/** Marca visualmente só o botão escolhido (apenas um ativo por vez). */
function selecionarBotaoOkNok(grupo, val) {
  grupo.querySelectorAll('.insp-oknok__b').forEach(b => {
    const on = b.dataset.oknok === val;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
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
  /* §Erro 10 — a classe segue o resultado automaticamente, sem passar por
     nenhuma escolha do auditor. */
  if (car) { car.resultado = rowRes; car._visual = rowVis; car.classe_defeito = INSP.classeAutomatica(car, rowRes); }
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
    pintarAlertaClasse();
  }
  R.rel.resultado = INSP.resultadoGeral(R.caracteristicas.filter(c => !c.informativo).map(c => c.resultado));
  refreshBanner();
  atualizarProgressoMedicoes();   // §Gate — atualiza contador/%, destaque e "Próximo" ao vivo
}
function detInputs(carId, qtd) {
  const out = [];
  for (let s = 1; s <= qtd; s++) out.push(avaliarLocal(carId, LOCAL[carId].vals[s]));
  return out;
}
/* A célula de classe virou somente leitura (§Erro 10): resta religar o "Tratar". */
function bindRowClasse(row) {
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
/* --------------------------------------------------- TRATAMENTO / PENDÊNCIA (§17) */
async function abrirTratamento(carId) {
  const c = R.caracteristicas.find(x => x.id === carId); if (!c) return;
  const acao = await INSP.acaoDaCaracteristica(R.rel.id, carId) || {};
  /* §Erro 10 — a classe já vem definida pela característica; o tratamento apenas
     a exibe. Nada aqui altera a classificação. */
  const classe = c.classe_defeito || null;
  const cls = CLASSES.find(k => k.codigo === classe) || null;
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
        <div class="col-md-4"><label class="form-label">Classe do defeito</label>
          <div class="insp-classe-ro">${classe
            ? `<span class="rna-badge ${classe === 'A' ? 'badge-crit' : classe === 'B' ? 'badge-warn' : 'badge-pend'}"><i class="bi bi-lock-fill"></i> Classe ${classe}</span>`
            : INSP.classeCadastrada(c) === 'NA'
              ? `<span class="rna-badge badge-na">Não se aplica</span>`
              : `<span class="rna-badge badge-warn"><i class="bi bi-exclamation-triangle"></i> Classe não cadastrada</span>`}</div>
          <small class="text-muted-2">Definida na Biblioteca Técnica para esta característica.</small></div>
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
  // Painel de apoio da classe: definição, critérios e campos obrigatórios.
  $('#tr-cls-info', m.host).innerHTML = cls
    ? `<div class="insp-cls-box insp-cls-${cls.cor}"><b>Classe ${cls.codigo} — ${cls.gravidade}</b><div class="cell-sub">${cls.definicao}</div>
      <div class="mt-1"><b>Obrigatórios:</b> ${Object.entries(cls.obrig).filter(([, v]) => v).map(([k]) => k).join(', ') || '—'}</div></div>`
    : `<div class="insp-blocker" style="border-left:4px solid var(--rna-yellow-600)"><i class="bi bi-info-circle"></i>
        <div>Esta característica ainda não tem <b>Classe da Não Conformidade</b> cadastrada na Biblioteca Técnica.
        O tratamento pode ser registrado normalmente; peça ao administrador para completar o cadastro.</div></div>`;

  $('#tr-save', m.host).addEventListener('click', async () => {
    const ok = await autosave(async () => {
      await INSP.salvarObservacao(carId, $('#tr-obs', m.host).value);
      // Mesmo contrato da evidência visual: insp_anexos é a fonte única e o
      // upload é desfeito se o vínculo falhar (ver abrirEvidenciaVisual).
      const ctxTr = contextoAnexo({ name: '(evidências)', size: 1, type: 'image/*' }, { caracteristicaId: carId });
      if (!ctxTr.ok) throw new AnexoError(ctxTr.msg, null);
      const saved = await ev.commit({
        usuario: USER, registro_tipo: 'insp_acao', registro_id: R.rel.id, mirror: false,
        path: it => pathEvidencia(ctxTr.ctx, it.nome)
      });
      for (const s of saved) {
        try {
          await INSP.inserirAnexo({
            relatorio_id: R.rel.id, peca_id: R.rel.peca_id, caracteristica_id: carId, medicao_id: null,
            nome: s.nome, tipo: s.tipo, url: s.url, path: s.path, tamanho: s.tamanho || '',
            uploaded_by: USER.id, uploaded_nome: USER.nome || '', created_at: INSP.nowISO()
          });
        } catch (e) {
          await removeEvidenceFromStorage(s.path);
          logAnexo('registro do anexo de tratamento falhou; upload desfeito', e, { tabela: 'insp_anexos', caracteristica_id: carId, path: s.path });
          throw e?.amigavel ? e : new AnexoError(mensagemRegistro(e), e);
        }
      }
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

/* ==================================================== ETAPA — INSPEÇÃO APÓS PINTURA
   Características de equipamento "Visual" (separadas de Medições). Cada uma é
   respondida como OK/NOK (resposta única na amostra AMOSTRA_VISUAL). Inclui o
   anexo (opcional) do Relatório de Pintura. Reabre preenchida (as respostas vêm
   do banco). O gate impede avançar à Revisão/Resultado apenas enquanto houver
   característica visual sem resposta OK/NOK — o Relatório de Pintura não bloqueia. */
async function stepInspecaoPintura(host) {
  const r = R.rel;
  const visuais = caracteristicasVisuais();
  const pintura = INSP.relatorioPintura(r);
  /* Descobre a migration pendente ANTES de o usuário escolher um arquivo: o
     aviso aparece no campo, em vez de o upload falhar depois de já ter subido. */
  await INSP.checarColunaPintura(r.id);
  const semColuna = !INSP.temColunaPintura();
  host.innerHTML = `
    <h3 class="insp-h"><i class="bi bi-brush"></i> Inspeção Após Pintura</h3>
    ${!visuais.length
      ? `<div class="insp-blocker insp-ok-blocker"><i class="bi bi-info-circle"></i> Esta peça não possui características de inspeção visual (equipamento <b>Visual</b>) na Biblioteca Técnica. Você pode avançar para a Revisão.</div>`
      : `
      <p class="text-muted-2">Itens cadastrados com equipamento <b>Visual</b>. Responda cada característica como <b>OK</b> ou <b>NOK</b>. O resultado visual é calculado automaticamente.</p>
      <div id="insp-visual-result">${resultadoVisualHtml(visuais)}</div>
      <div class="insp-table-wrap"><table class="insp-mtable"><thead><tr>
        <th class="sticky-l">Cota</th><th>Característica</th><th>Quadrante</th><th>Ref.</th><th>Especificação visual</th><th>Resultado *</th><th>Observação</th><th>Evidência</th>
      </tr></thead><tbody>
        ${visuais.map(linhaVisual).join('')}
      </tbody></table></div>`}
    ${/* O Relatório de Pintura é um documento DO RELATÓRIO, não da característica:
          aparece mesmo quando a peça não tem item visual (antes ficava escondido
          junto com a tabela, e não havia como anexá-lo nessas peças). */''}
    ${campoRelatorioPintura(pintura, semColuna)}`;

  if (VIEWONLY) { atualizarNav(); return; }
  $$('.insp-visual-oknok .insp-oknok__b', host).forEach(b => b.addEventListener('click', () => onVisualOkNok(b)));
  $$('.insp-visual-obs', host).forEach(inp => inp.addEventListener('change', () => onVisualObs(inp)));
  $$('.insp-visual-evid', host).forEach(b => b.addEventListener('click', () => abrirEvidenciaVisual(b.dataset.vevid)));
  const fileInp = $('#insp-pintura-file'), pickBtn = $('#insp-pintura-btn');
  pickBtn?.addEventListener('click', () => fileInp.click());
  /* O input é limpo sempre (sem isso, reescolher o MESMO arquivo depois de uma
     falha não dispara 'change'); a seleção sobrevive em PINTURA_PENDENTE. */
  fileInp?.addEventListener('change', () => { const f = fileInp.files?.[0]; fileInp.value = ''; if (f) enviarRelatorioPintura(f); });
  $('#insp-pintura-retry')?.addEventListener('click', () => { const f = PINTURA_PENDENTE; if (f) enviarRelatorioPintura(f); });
  $('#insp-pintura-descartar')?.addEventListener('click', () => { PINTURA_PENDENTE = null; renderStep(); });
  $('#insp-pintura-rm')?.addEventListener('click', removerRelatorioPintura);
  atualizarNav();
}

/** Linha de uma característica visual: cota, característica, quadrante,
    referência, especificação visual, OK/NOK, observação e evidência. */
function linhaVisual(c) {
  const m = (c.medicoes || []).find(x => Number(x.amostra) === INSP.AMOSTRA_VISUAL);
  const sel = String(m?.valor ?? '').toUpperCase();       // '', 'OK' ou 'NOK'
  const dis = VIEWONLY ? ' disabled' : '';
  // "Especificação visual" = observação técnica cadastrada (o que inspecionar).
  const espec = c.observacao_tec || c.referencia || '—';
  /* Indicador de anexo salvo: o ícone só fica verde quando a evidência já está
     PERSISTIDA (veio de insp_anexos no reload), nunca por ter escolhido arquivo. */
  const nEvid = (R.anexos || []).filter(a => a.caracteristica_id === c.id).length;
  const evidCell = VIEWONLY
    ? (nEvid ? `<span class="cell-sub"><i class="bi bi-paperclip"></i> ${nEvid} anexo(s)</span>` : '—')
    : `<button class="rna-btn rna-btn-ghost rna-btn-sm insp-visual-evid" data-vevid="${c.id}">${nEvid
        ? `<i class="bi bi-check-circle-fill" style="color:var(--rna-green,#2e7d32)"></i> ${nEvid} anexo(s)`
        : '<i class="bi bi-paperclip"></i> Anexar'}</button>`;
  return `<tr data-vrow="${c.id}">
    <td class="sticky-l cell-strong">${escTitle(String(c.cota ?? '—'))}</td>
    <td>${escTitle(c.caracteristica || '—')}</td>
    <td class="insp-quadrante">${c.quadrante ? escTitle(c.quadrante) : '—'}</td>
    <td class="cell-sub">${escTitle(c.referencia || '—')}</td>
    <td class="cell-sub">${escTitle(espec)}</td>
    <td class="insp-samp"><div class="insp-oknok insp-visual-oknok ${sel === 'OK' ? 'is-ok' : sel === 'NOK' ? 'is-crit' : ''}" data-vcar="${c.id}" data-val="${sel}" role="group" aria-label="Resultado visual">
      <button type="button" class="insp-oknok__b insp-oknok__ok ${sel === 'OK' ? 'is-on' : ''}" data-oknok="OK" aria-pressed="${sel === 'OK'}"${dis}><i class="bi bi-check-lg"></i> OK</button>
      <button type="button" class="insp-oknok__b insp-oknok__nok ${sel === 'NOK' ? 'is-on' : ''}" data-oknok="NOK" aria-pressed="${sel === 'NOK'}"${dis}><i class="bi bi-x-lg"></i> NOK</button>
    </div></td>
    <td><input class="form-control form-control-sm insp-visual-obs" data-vobs="${c.id}" value="${escTitle(c.observacao || '')}" placeholder="Observação"${dis}></td>
    <td>${evidCell}</td>
  </tr>`;
}

/** Banner do resultado consolidado da inspeção visual. */
function resultadoVisualHtml(visuais) {
  const res = INSP.resultadoVisual(visuais);
  const ok = visuais.filter(c => c.resultado === 'aprovado').length;
  const nok = visuais.filter(c => c.resultado === 'reprovado').length;
  const map = {
    aprovado: ['insp-ok', 'bi-check-circle-fill', 'APROVADO'],
    reprovado: ['insp-crit', 'bi-x-octagon-fill', 'REPROVADO'],
    pendente: ['insp-pend', 'bi-hourglass-split', 'EM PREENCHIMENTO'],
    na: ['insp-pend', 'bi-dash-circle', '—']
  };
  const [cls, ic, label] = map[res] || map.pendente;
  return `<div class="insp-result-banner ${cls}"><i class="bi ${ic}"></i> RESULTADO DA INSPEÇÃO VISUAL: <b>${label}</b>
    <span class="cell-sub" style="margin-left:8px">${ok} OK · ${nok} NOK · ${visuais.length} item(ns)</span></div>`;
}

/** Campo de anexo do Relatório de Pintura (PDF/JPG/JPEG/PNG). */
function campoRelatorioPintura(pintura, semColuna) {
  return `<div class="insp-card-lite mt-3" id="insp-pintura-box">
    <b><i class="bi bi-file-earmark-arrow-up"></i> Relatório de Pintura</b>
    <div class="cell-sub">Documento complementar (opcional) — PDF, JPG, JPEG ou PNG (máx. ${PINTURA_MAX_MB} MB).</div>
    ${semColuna ? `<div class="insp-blocker mt-2" style="border-left:4px solid var(--rna-yellow-600)"><i class="bi bi-exclamation-triangle"></i>
      <div>O anexo (opcional) do Relatório de Pintura ainda não pode ser salvo neste banco. Rode <b>database/fix_anexos_pintura.sql</b> no Supabase para habilitar. A inspeção pode ser salva e finalizada normalmente sem ele.</div></div>` : ''}
    <div id="insp-pintura-atual" class="mt-2">${pinturaAtualHtml(pintura)}</div>
    ${PINTURA_PENDENTE && !VIEWONLY ? `<div class="insp-blocker mt-2" style="border-left:4px solid var(--rna-red,#c62828)">
      <i class="bi bi-exclamation-octagon"></i><div>O arquivo <b>${escTitle(PINTURA_PENDENTE.name)}</b> não foi salvo.
      A seleção foi mantida — corrija a causa indicada e tente de novo.</div></div>` : ''}
    ${VIEWONLY ? '' : `<div class="mt-2 d-flex flex-wrap gap-2">
      <input type="file" id="insp-pintura-file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" hidden>
      <button class="rna-btn rna-btn-dark rna-btn-sm" id="insp-pintura-btn"${semColuna ? ' disabled title="Rode database/fix_anexos_pintura.sql para habilitar"' : ''}><i class="bi bi-upload"></i> ${pintura ? 'Substituir arquivo' : 'Anexar arquivo'}</button>
      ${PINTURA_PENDENTE ? `<button class="rna-btn rna-btn-primary rna-btn-sm" id="insp-pintura-retry"><i class="bi bi-arrow-clockwise"></i> Tentar novamente</button>
        <button class="rna-btn rna-btn-ghost rna-btn-sm" id="insp-pintura-descartar">Descartar seleção</button>` : ''}
    </div>`}
  </div>`;
}
/* Estado do anexo: nome, tamanho, quem enviou e quando, com abrir/baixar. Sem
   isso o auditor não tinha como confirmar que o arquivo ficou mesmo salvo. */
function pinturaAtualHtml(p) {
  if (!p) return `<span class="cell-sub"><i class="bi bi-dash-circle"></i> Nenhum arquivo anexado.</span>`;
  const meta = [tamanhoLegivel(p.tamanho), p.uploaded_nome ? `por ${escTitle(p.uploaded_nome)}` : '',
                formatarDataHoraBrasil(p.created_at, { vazio: '' })].filter(Boolean).join(' · ');
  return `<div class="d-flex align-items-center flex-wrap gap-2">
    <i class="bi bi-file-earmark-check" style="color:var(--rna-green,#2e7d32)"></i>
    <b>${escTitle(p.nome)}</b>
    ${meta ? `<span class="cell-sub">${meta}</span>` : ''}
    ${p.url ? `<a class="rna-btn rna-btn-ghost rna-btn-sm" href="${escTitle(p.url)}" target="_blank" rel="noopener"><i class="bi bi-eye"></i> Visualizar</a>
               <a class="rna-btn rna-btn-ghost rna-btn-sm" href="${escTitle(p.url)}" download="${escTitle(p.nome)}"><i class="bi bi-download"></i> Baixar</a>` : ''}
    ${VIEWONLY ? '' : `<button class="rna-btn rna-btn-ghost rna-btn-sm" id="insp-pintura-rm" title="Remover anexo"><i class="bi bi-trash"></i> Remover</button>`}
  </div>`;
}
/** Bytes → texto curto ('' quando desconhecido). */
function tamanhoLegivel(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------- gate da inspeção visual
   Só o preenchimento OK/NOK das características visuais bloqueia o avanço. O
   Relatório de Pintura é OPCIONAL (documento complementar) — nunca bloqueia. */
function visualPendentes() { return INSP.visuaisPendentes(caracteristicasVisuais()); }
function visualCompleto() { return visualPendentes().length === 0; }
function bloqueioVisual() {
  const p = visualPendentes();
  if (p.length) return `Responda OK/NOK em ${p.length} característica(s) visual(is) para avançar.`;
  return '';
}
function alertaVisualPendente() {
  const p = visualPendentes();
  // realça as linhas sem resposta
  document.querySelectorAll('.insp-visual-oknok').forEach(g => {
    const pend = p.some(x => x.id === g.dataset.vcar);
    g.closest('tr')?.classList.toggle('insp-row-pend', pend && !g.dataset.val);
  });
  const itens = p.map(x => `<li><span class="rna-badge badge-pend">Cota ${escTitle(x.cota ?? '—')}</span> ${escTitle(x.caracteristica || '')} — sem OK/NOK</li>`).join('');
  modal({
    title: 'Inspeção Após Pintura pendente',
    content: `<p style="margin:0 0 10px;font-size:14px">Conclua a Inspeção Após Pintura antes de avançar para a Revisão.</p>
      <div class="insp-card-lite"><b class="text-crit"><i class="bi bi-exclamation-triangle"></i> Pendências</b>
      <ul class="insp-ul mt-2">${itens}</ul></div>`,
    footer: `<button class="rna-btn rna-btn-primary" data-bs-dismiss="modal">OK</button>`
  });
}

/* ------------------------------------------------------- ações da inspeção visual */
async function onVisualOkNok(btn) {
  const grupo = btn.closest('.insp-visual-oknok'); if (!grupo) return;
  const carId = grupo.dataset.vcar, val = btn.dataset.oknok;   // 'OK' | 'NOK'
  // marca visualmente na hora (feedback imediato antes do autosave)
  grupo.dataset.val = val;
  grupo.classList.remove('is-ok', 'is-crit');
  grupo.classList.add(val === 'OK' ? 'is-ok' : 'is-crit');
  grupo.querySelectorAll('.insp-oknok__b').forEach(b => {
    const on = b.dataset.oknok === val;
    b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const ok = await autosave(async () => {
    await INSP.salvarResultadoVisual(R.rel.id, carId, val, USER);
    await reload();
  }, { contexto: 'Falha ao salvar o resultado visual' });
  if (!ok) return;
  refreshBanner();
  const box = $('#insp-visual-result'); if (box) box.innerHTML = resultadoVisualHtml(caracteristicasVisuais());
  grupo.closest('tr')?.classList.remove('insp-row-pend');
  atualizarNav();
}
async function onVisualObs(inp) {
  const carId = inp.dataset.vobs;
  await autosave(async () => {
    await INSP.salvarObservacao(carId, inp.value);
    const c = R.caracteristicas.find(x => x.id === carId); if (c) c.observacao = inp.value;
  }, { contexto: 'Falha ao salvar a observação' });
}

/** Modal de evidências (fotos) de uma característica visual — reusa insp_anexos.
    insp_anexos é a FONTE ÚNICA do que a tela mostra; o espelho na tabela legada
    `evidencias` é best-effort (mirror:false) para que uma policy antiga daquela
    tabela não derrube a evidência que já subiu e já foi vinculada. */
function abrirEvidenciaVisual(carId) {
  const c = R.caracteristicas.find(x => x.id === carId); if (!c) return;
  const m = modal({
    title: `Evidência — ${c.caracteristica || 'característica visual'}`,
    content: `<div id="ev-lista">${listaAnexosHtml(carId)}</div><div id="ev-visual" class="mt-2"></div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Fechar</button>
             <button class="rna-btn rna-btn-primary" id="ev-save"><i class="bi bi-save"></i> Salvar evidência</button>`
  });
  const ev = initEvidenceUpload($('#ev-visual', m.host), { multiple: true, label: 'Anexar evidência (foto)' });
  const ligarRemocao = () => $$('.ev-rm', m.host).forEach(b => b.addEventListener('click', () => removerAnexoVisual(b.dataset.anexo, carId, m)));
  ligarRemocao();
  $('#ev-save', m.host).addEventListener('click', async () => {
    /* Fechar em silêncio quando nada foi anexado ensinava o usuário a achar que
       tinha salvo. Se não há arquivo, diga isso. */
    if (!ev.hasFiles()) return toast('Selecione uma imagem antes de salvar.', { type: 'warn', title: 'Evidência' });
    // ETAPA 1/6 — IDs completos antes de qualquer byte subir.
    const v = contextoAnexo({ name: '(evidências)', size: 1, type: 'image/*' }, { caracteristicaId: carId });
    if (!v.ok) return toast(v.msg, { type: 'crit', title: 'Evidência não enviada', timeout: 9000 });
    let salvos = [];
    const ok = await autosave(async () => {
      salvos = await ev.commit({
        usuario: USER, registro_tipo: 'insp_visual', registro_id: R.rel.id, mirror: false,
        path: it => pathEvidencia(v.ctx, it.nome)        // ETAPA 8 — caminho por característica
      });
      for (const s of salvos) {
        try {
          await INSP.inserirAnexo({
            relatorio_id: R.rel.id, peca_id: R.rel.peca_id, caracteristica_id: carId, medicao_id: null,
            nome: s.nome, tipo: s.tipo, url: s.url, path: s.path, tamanho: s.tamanho || '',
            uploaded_by: USER.id, uploaded_nome: USER.nome || '', created_at: INSP.nowISO()
          });
        } catch (e) {
          await removeEvidenceFromStorage(s.path);   // ETAPA 7 — vínculo falhou: sem órfão
          logAnexo('registro da evidência falhou; upload desfeito', e, { tabela: 'insp_anexos', caracteristica_id: carId, path: s.path });
          throw e?.amigavel ? e : new AnexoError(mensagemRegistro(e), e);
        }
      }
      await reload();
    }, { contexto: 'Falha ao salvar a evidência' });
    if (!ok) return;
    ev.clear();
    $('#ev-lista', m.host).innerHTML = listaAnexosHtml(carId);
    ligarRemocao();
    renderStep();
    if (!INSP.temColunasAnexo()) toast(INSP.MSG_MIGRACAO_ANEXO, { type: 'warn', title: 'Salvo com limitação', timeout: 9000 });
    toast(`${salvos.length} evidência(s) salva(s).`, { type: 'ok' });
  });
}

/** Lista dos anexos já persistidos da característica (nome, tamanho, autor, ações). */
function listaAnexosHtml(carId) {
  const existentes = (R.anexos || []).filter(a => a.caracteristica_id === carId);
  if (!existentes.length) return `<div class="cell-sub"><i class="bi bi-dash-circle"></i> Nenhuma evidência anexada ainda.</div>`;
  return `<div class="insp-card-lite"><b><i class="bi bi-paperclip"></i> Evidências salvas (${existentes.length})</b>
    ${existentes.map(a => {
      const meta = [tamanhoLegivel(a.tamanho), a.uploaded_nome ? `por ${escTitle(a.uploaded_nome)}` : '',
                    formatarDataHoraBrasil(a.created_at, { vazio: '' })].filter(Boolean).join(' · ');
      return `<div class="d-flex align-items-center flex-wrap gap-2 mt-2">
        <i class="bi bi-image" style="color:var(--rna-green,#2e7d32)"></i>
        <span>${escTitle(a.nome || 'evidência')}</span>
        ${meta ? `<span class="cell-sub">${meta}</span>` : ''}
        ${a.url ? `<a class="rna-btn rna-btn-ghost rna-btn-sm" href="${escTitle(a.url)}" target="_blank" rel="noopener"><i class="bi bi-eye"></i> Ver</a>
                   <a class="rna-btn rna-btn-ghost rna-btn-sm" href="${escTitle(a.url)}" download="${escTitle(a.nome || 'evidencia')}"><i class="bi bi-download"></i> Baixar</a>` : ''}
        ${VIEWONLY ? '' : `<button class="rna-btn rna-btn-ghost rna-btn-sm ev-rm" data-anexo="${a.id}" title="Remover"><i class="bi bi-trash"></i></button>`}
      </div>`;
    }).join('')}</div>`;
}

/** Remove o anexo: primeiro o registro, depois o arquivo do Storage. */
function removerAnexoVisual(anexoId, carId, m) {
  const a = (R.anexos || []).find(x => x.id === anexoId); if (!a) return;
  confirmDialog(`Remover a evidência <b>${escTitle(a.nome || 'imagem')}</b>?`, async () => {
    const ok = await autosave(async () => {
      await INSP.removerAnexo(anexoId);
      await removeEvidenceFromStorage(a.path);
      await reload();
    }, { contexto: 'Falha ao remover a evidência' });
    if (!ok) return;
    if (m?.host && document.body.contains(m.host)) {
      $('#ev-lista', m.host).innerHTML = listaAnexosHtml(carId);
      $$('.ev-rm', m.host).forEach(b => b.addEventListener('click', () => removerAnexoVisual(b.dataset.anexo, carId, m)));
    }
    renderStep();
    toast('Evidência removida.', { type: 'ok' });
  }, { title: 'Remover evidência', okLabel: 'Remover', danger: true });
}

/* ------------------------------------------------- upload do Relatório de Pintura */
const PINTURA_EXT = ['pdf', 'jpg', 'jpeg', 'png'];
const PINTURA_MAX_MB = 15;

/* ================================================ ETAPA 1 — CONTEXTO DO ANEXO
   Nenhum byte sobe antes de os identificadores estarem completos. Cada ID que
   falta tem a SUA mensagem — "falha de conexão" nunca é resposta para contexto
   incompleto. Os valores vão para o console (console.table) a cada tentativa.

   NOTA DE MODELAGEM: neste sistema NÃO existe tabela de vínculo
   auditoria×peça. O vínculo É a coluna `insp_relatorios.peca_id` (UUID de
   bib_pecas), gravada na etapa "Tipo e peça"; a evidência aponta para a
   característica por `insp_caracteristicas.id` (UUID). Por isso não há
   "auditoriaPecaId" a localizar ou criar — há esses dois IDs a validar. */
function contextoAnexo(file, { caracteristicaId } = {}) {
  const ctx = {
    relatorioId: R?.rel?.id || null,
    relatorioNumero: R?.rel?.numero || null,
    pecaId: R?.rel?.peca_id || null,
    caracteristicaId: caracteristicaId ?? null,
    usuarioId: USER?.id || null,
    arquivo: file?.name || null,
    tipo: file?.type || null,
    tamanho: file?.size ?? null,
    bucket: BUCKET
  };
  console.table?.([ctx]);
  const falta = m => ({ ok: false, ctx, msg: m });
  if (!ctx.relatorioId) return falta('Relatório não identificado. Feche e abra a inspeção novamente.');
  if (!ctx.pecaId) return falta('Não foi possível identificar a peça vinculada a esta auditoria. Volte à etapa "Tipo e peça" e selecione a peça da Biblioteca Técnica.');
  if (caracteristicaId !== undefined && !ctx.caracteristicaId)
    return falta('Não foi possível identificar a característica desta evidência. Reabra a etapa Inspeção Após Pintura.');
  if (caracteristicaId !== undefined && !R.caracteristicas.some(c => c.id === ctx.caracteristicaId))
    return falta('A característica desta evidência não pertence mais a este relatório. Recarregue a página.');
  if (!ctx.usuarioId) return falta('Sessão sem usuário identificado. Entre novamente.');
  if (!file || !file.size) return falta('Arquivo inválido ou vazio.');
  return { ok: true, ctx };
}

/* ETAPA 8 — caminhos previsíveis, únicos e sanitizados (sem acento/espaço/símbolo). */
const pathEvidencia = (ctx, nome) =>
  `inspecao-apos-pintura/${ctx.relatorioId}/${ctx.pecaId}/${ctx.caracteristicaId}/${Date.now()}-${sanitizarNomeArquivo(nome)}`;
const pathPintura = (ctx, nome) =>
  `relatorios-pintura/${ctx.relatorioId}/${Date.now()}-${sanitizarNomeArquivo(nome)}`;
/* Ordem obrigatória: (1) sobe o arquivo, (2) grava a URL no relatório. Se (2)
   falhar, o objeto recém-enviado é APAGADO do Storage — o Storage nunca fica com
   arquivo que o banco desconhece, e o banco nunca aponta para arquivo que não
   subiu. O anexo anterior só é apagado DEPOIS de o novo estar gravado. */
async function enviarRelatorioPintura(file) {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (!PINTURA_EXT.includes(ext)) return toast('Formato de arquivo não permitido. Use PDF, JPG, JPEG ou PNG.', { type: 'warn', title: 'Relatório de Pintura' });
  if (file.size > PINTURA_MAX_MB * 1024 * 1024) return toast(`O arquivo excede o limite de ${PINTURA_MAX_MB} MB.`, { type: 'warn', title: 'Relatório de Pintura' });
  // ETAPA 1/6 — contexto validado ANTES do upload; sem IDs, nada sobe.
  const v = contextoAnexo(file);
  if (!v.ok) { PINTURA_PENDENTE = file; renderStep(); return toast(v.msg, { type: 'crit', title: 'Anexo não enviado', timeout: 9000 }); }

  const anterior = INSP.relatorioPintura(R.rel);
  const ok = await autosave(async () => {
    const enviado = await uploadArquivoPintura(file, v.ctx);           // 5/6 upload
    const anexo = { nome: file.name, tipo: file.type || ext, url: enviado.url, path: enviado.path, tamanho: String(file.size) };
    try {
      await INSP.salvarRelatorioPintura(R.rel.id, anexo, USER);        // 7 registro
    } catch (e) {
      await removeEvidenceFromStorage(enviado.path);                   // ETAPA 7 — rollback
      logAnexo('registro do Relatório de Pintura falhou; upload desfeito', e, { payload: anexo, tabela: 'insp_relatorios' });
      throw (e?.amigavel || e instanceof INSP.InspError) ? e : new AnexoError(mensagemRegistro(e), e);
    }
    // Só depois de o novo estar gravado o anterior é descartado.
    if (anterior?.path && anterior.path !== enviado.path) await removeEvidenceFromStorage(anterior.path);
    await reload();
  }, { contexto: 'Falha ao anexar o Relatório de Pintura' });
  if (!ok) { PINTURA_PENDENTE = file; renderStep(); return; }           // mantém o arquivo p/ nova tentativa
  PINTURA_PENDENTE = null;
  renderStep();
  toast('Relatório de Pintura anexado.', { type: 'ok' });
}
/* Arquivo escolhido cuja gravação falhou. O <input type=file> é limpo (senão
   reescolher o MESMO arquivo não dispara 'change'), mas o File fica aqui para o
   botão "Tentar novamente" — o usuário não perde a seleção. */
let PINTURA_PENDENTE = null;
async function removerRelatorioPintura() {
  const p = INSP.relatorioPintura(R.rel);
  confirmDialog(`Remover o anexo <b>${escTitle(p?.nome || 'Relatório de Pintura')}</b>? O arquivo será apagado do repositório.`, async () => {
    const ok = await autosave(async () => {
      await INSP.salvarRelatorioPintura(R.rel.id, null, USER);   // primeiro o registro
      await removeEvidenceFromStorage(p?.path);                  // depois o arquivo
      await reload();
    }, { contexto: 'Falha ao remover o Relatório de Pintura' });
    if (!ok) return;
    renderStep();
    toast('Relatório de Pintura removido.', { type: 'ok' });
  }, { title: 'Remover anexo', okLabel: 'Remover', danger: true });
}
/* Envia ao Supabase Storage (bucket 'evidencias') OU devolve Base64 (demo).
   Retorna { url, path } — `path` permite apagar o objeto depois.
   O erro do Storage é traduzido UMA vez, aqui, e viaja como AnexoError: as
   camadas de cima devolvem a mensagem intacta em vez de reembrulhá-la. */
async function uploadArquivoPintura(file, ctx) {
  if (!SUPABASE.enabled) return { url: await lerArquivoDataURL(file), path: null };   // fallback demo: Base64
  const sb = await getSupabase();
  const path = pathPintura(ctx, file.name || 'relatorio-pintura');
  /* Lê o arquivo para a memória ANTES do envio: falha de leitura de disco vira
     erro nomeado aqui, em vez de "Failed to fetch" no meio da requisição. */
  const corpo = await materializarArquivo(file);
  const { error } = await sb.storage.from(BUCKET).upload(path, corpo, { contentType: file.type || corpo.type, upsert: false });
  if (error) {
    logAnexo('upload do Relatório de Pintura recusado pelo Storage', error, { bucket: BUCKET, path, ctx, bytes: corpo.size });
    throw new AnexoError(await mensagemStorage(error), error);
  }
  const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new AnexoError('O arquivo subiu, mas o Storage não devolveu a URL pública.', null, `path ${path}`);
  return { url: data.publicUrl, path };
}
function lerArquivoDataURL(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
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
        ${s.classeNaoCadastrada ? `<div class="insp-blocker mt-2" style="border-left:4px solid var(--rna-yellow-600)">
          <i class="bi bi-exclamation-triangle"></i> <div><b>${s.classeNaoCadastrada} reprovação(ões) sem classe cadastrada na Biblioteca Técnica.</b>
          <div class="cell-sub">A inspeção pode ser finalizada normalmente. O administrador deve cadastrar a Classe da Não Conformidade da característica.</div></div></div>` : ''}
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
    ${revisaoInspecaoVisualHtml(s)}
    ${(s.caracteristicasReprovadas || s.inspecaoVisual?.reprovadas) ? `<div class="insp-card-lite mt-3"><b class="text-crit"><i class="bi bi-exclamation-octagon"></i> Reprovações a tratar</b>
      <div class="mt-2">${R.caracteristicas.filter(c => c.resultado === 'reprovado').map(c => `<div class="insp-reprov-row">
        <div><b>${c.caracteristica}</b> <span class="cell-sub">cota ${c.cota}</span>${c.visual ? ' <span class="rna-badge badge-info"><i class="bi bi-brush"></i> Visual</span>' : ''}</div>
        <div>${c.classe_defeito
          ? `<span class="rna-badge ${c.classe_defeito === 'A' ? 'badge-crit' : c.classe_defeito === 'B' ? 'badge-warn' : 'badge-pend'}"><i class="bi bi-lock-fill"></i> Classe ${c.classe_defeito}</span>`
          : INSP.classeCadastrada(c) === 'NA'
            ? `<span class="rna-badge badge-na">Não se aplica</span>`
            : `<span class="rna-badge badge-warn"><i class="bi bi-exclamation-triangle"></i> Classe não cadastrada</span>`}</div>
        ${VIEWONLY ? '' : `<button class="rna-btn rna-btn-ghost rna-btn-sm insp-tratar" data-car="${c.id}"><i class="bi bi-clipboard-plus"></i> Tratar</button>`}
      </div>`).join('')}</div></div>` : `<div class="insp-blocker insp-ok-blocker mt-3"><i class="bi bi-check-circle"></i> Nenhuma reprovação. Todas as características avaliadas estão aprovadas.</div>`}
    <div class="mt-2"><button class="rna-btn rna-btn-ghost rna-btn-sm" id="btn-ajuda-classe2"><i class="bi bi-question-circle"></i> Definição das classes</button></div>`;
  $('#btn-ajuda-classe2').addEventListener('click', ajudaClasses);
  $$('.insp-tratar', host).forEach(b => b.addEventListener('click', () => abrirTratamento(b.dataset.car)));
}
const sum = (l, v, tone = '') => `<div class="insp-sum ${tone ? 'insp-sum-' + tone : ''}"><div class="insp-sum__v">${v}</div><div class="insp-sum__l">${l}</div></div>`;

/* Bloco-resumo da Inspeção Após Pintura na Revisão. Só aparece quando a peça tem
   características visuais — reforça o resultado visual e o Relatório de Pintura. */
function revisaoInspecaoVisualHtml(s) {
  const v = s.inspecaoVisual;
  if (!v || !v.total) return '';
  const res = v.resultado;
  const cls = res === 'aprovado' ? 'insp-ok' : res === 'reprovado' ? 'insp-crit' : 'insp-pend';
  const label = res === 'aprovado' ? 'APROVADO' : res === 'reprovado' ? 'REPROVADO' : 'EM PREENCHIMENTO';
  const pint = v.relatorioPintura;
  return `<div class="insp-card-lite mt-3"><b><i class="bi bi-brush"></i> Inspeção Após Pintura</b>
    <div class="insp-summary-grid mt-2">
      ${sum('Itens visuais', v.total)} ${sum('OK', v.aprovadas, 'ok')} ${sum('NOK', v.reprovadas, 'crit')}
    </div>
    <div class="d-flex flex-wrap align-items-center gap-2 mt-2">
      <span class="insp-pill ${cls}"><i class="bi ${res === 'reprovado' ? 'bi-x-circle-fill' : res === 'aprovado' ? 'bi-check-circle-fill' : 'bi-hourglass-split'}"></i> Resultado visual: ${label}</span>
      <span class="cell-sub"><i class="bi bi-file-earmark${pint ? '-check' : ''}"></i> Relatório de Pintura: ${pint ? escTitle(pint.nome) : 'não anexado'}</span>
    </div></div>`;
}

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
    : val.ok ? `<div class="insp-blocker insp-ok-blocker mt-3"><i class="bi bi-check2-all"></i> Medições concluídas. ${r.resultado === 'reprovado' ? 'O relatório pode ser finalizado — como há reprovação, o resultado será salvo como <b>REPROVADO</b> e uma <b>pendência será criada automaticamente</b>.' : 'Você pode finalizar o relatório.'}</div>
      <div class="d-flex gap-2 mt-3">
        <button class="rna-btn rna-btn-ghost" id="btn-rev">Voltar e revisar</button>
        <button class="rna-btn rna-btn-primary rna-btn-xl" id="btn-fin"><i class="bi bi-check2-circle"></i> Finalizar Relatório</button></div>`
    : `<div class="insp-card-lite mt-3"><b class="text-crit"><i class="bi bi-exclamation-triangle"></i> ${val.faltas.length} pendência(s) impedem a finalização</b>
      <ul class="insp-ul mt-2">${val.faltas.map(f => `<li><span class="rna-badge badge-pend">${f.etapa}</span> ${f.msg}</li>`).join('')}</ul>
      <button class="rna-btn rna-btn-dark rna-btn-sm mt-2" id="btn-goto"><i class="bi bi-arrow-right-circle"></i> Ir à primeira pendência</button></div>`}`;

  $('#btn-rev')?.addEventListener('click', () => { STEP = ET.REVISAO; renderStep(); });
  $('#btn-goto')?.addEventListener('click', () => { const et = val.faltas[0].etapa; STEP = ETAPAS.indexOf(et) >= 0 ? ETAPAS.indexOf(et) : ET.MEDICOES; renderStep(); });
  $('#btn-fin')?.addEventListener('click', () => finalizarInspecao(r));
}

/* Finalização com modal controlado: passos explícitos, botão bloqueado durante o
   processamento, erro por etapa e SEM falha silenciosa (o modal só fecha no sucesso).
   Fluxo: (1) atualizar auditoria→FINALIZADA + (2) gerar relatório + (3) pendência se
   reprovado [tudo em INSP.finalizar] → (4) fechar modal → (5) atualizar UI → (6) ir p/ leitura. */
function finalizarInspecao(r) {
  const reprovado = r.resultado === 'reprovado';
  /* §Finalização de reprovado — a reprovação NÃO bloqueia; é apenas o RESULTADO.
     Quando há NOK, a confirmação é específica (título e itens do requisito) para o
     auditor reconhecer que está encerrando um relatório REPROVADO — não é impeditivo. */
  const conteudoReprovado = `
      <p style="margin:0 0 12px;font-size:14px">Esta inspeção possui características fora da especificação (NOK).</p>
      <div class="insp-result-final ${bannerClass(r.resultado)}" style="padding:12px 16px">
        <div class="insp-result-final__ic"><i class="bi bi-x-octagon-fill"></i></div>
        <div><div class="insp-result-final__t">RESULTADO GERAL</div><div class="insp-result-final__v">REPROVADO</div></div>
      </div>
      <p style="font-size:14px;margin:12px 0 6px">Ao finalizar:</p>
      <ul class="insp-ul" style="font-size:13.5px;margin:0">
        <li>o relatório será encerrado;</li>
        <li>o resultado será salvo como <b>REPROVADO</b>;</li>
        <li>as pendências serão criadas automaticamente;</li>
        <li>toda a rastreabilidade será preservada.</li>
      </ul>
      <p style="font-size:14px;margin:12px 0 0"><b>Deseja realmente finalizar?</b></p>
      <div id="fin-erro" class="insp-blocker mt-2" style="display:none"></div>`;
  const conteudoAprovado = `
      <p style="margin:0 0 12px;font-size:14px">Deseja finalizar este relatório? Após a finalização, ele fica bloqueado para edição comum.</p>
      <div class="insp-result-final ${bannerClass(r.resultado)}" style="padding:12px 16px">
        <div class="insp-result-final__ic"><i class="bi bi-check-circle-fill"></i></div>
        <div><div class="insp-result-final__t">RESULTADO GERAL</div><div class="insp-result-final__v">APROVADO</div></div>
      </div>
      <p class="text-muted-2" style="font-size:13px;margin:10px 0 0">A inspeção será concluída e o relatório gerado.</p>
      <div id="fin-erro" class="insp-blocker mt-2" style="display:none"></div>`;
  const m = modal({
    title: reprovado ? 'Finalizar Relatório Reprovado' : 'Finalizar Relatório',
    content: reprovado ? conteudoReprovado : conteudoAprovado,
    footer: `<button class="rna-btn rna-btn-ghost" id="fin-cancel" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn ${reprovado ? 'rna-btn-dark' : 'rna-btn-primary'}" id="fin-ok"><i class="bi bi-check2-circle"></i> Finalizar Relatório</button>`
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
      VIEWONLY = true; STEP = ET.RESULTADO; paintWizard();  // PASSO 6 — vai para a visualização (leitura)
    } catch (err) {
      // Qualquer erro do PASSO 1 (atualizar auditoria) chega aqui — nunca silencioso.
      mostrarErro('❌ Erro ao finalizar a inspeção', err);
    }
  });
}
