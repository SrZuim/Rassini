/* ==========================================================================
   Gestão Operacional — cadastro configurável de atividades (Fase 1: Rotinas)
   Admin cria/edita rotinas, itens, categorias, tipos, atribuições e agenda.
   Nada de rotina fixa no código: tudo persiste nas tabelas op_*.
   ========================================================================== */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { can, PLANTAS, TURNOS } from '../../../services/config.js';
import * as ATIV from '../../../services/atividades.js';
import * as DATA from '../../../services/gestao-op-data.js';
import { charts, PALETTE } from '../charts.js';
import { $, $$, el, toast, modal, confirmDialog } from '../ui.js';

let USER, CAN_EDIT, CAN_DELETE;
const state = { tab: 'rotinas', view: 'lista', ativId: null };
const ROLES = ['admin', 'supervisor', 'auditor'];
const ABAS = [
  ['rotinas', 'bi-list-check', 'Rotinas'], ['checklists', 'bi-ui-checks', 'Checklists'], ['categorias', 'bi-tags', 'Categorias'], ['tipos', 'bi-collection', 'Tipos de Atividades'],
  ['atribuicoes', 'bi-diagram-2', 'Atribuições'], ['agenda', 'bi-calendar-week', 'Agenda'], ['templates', 'bi-files', 'Templates'], ['indicadores', 'bi-bar-chart', 'Indicadores']
];
const TIPO_LABEL = { rotina: { sing: 'rotina', Sing: 'Rotina', plur: 'Rotinas', icon: 'bi-list-check' }, checklist: { sing: 'checklist', Sing: 'Checklist', plur: 'Checklists', icon: 'bi-ui-checks' } };
function curTipo() { return state.tab === 'checklists' ? 'checklist' : 'rotina'; }

const ctx = await mountShell();
if (ctx) { USER = ctx.user; CAN_EDIT = can(USER.role, 'gestao_op', 'edit'); CAN_DELETE = can(USER.role, 'gestao_op', 'delete'); render(); }

function head(extra = '') {
  return `<div class="rna-page-head"><div>
      <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Gestão Operacional</div>
      <h1>Gestão Operacional</h1><p>Cadastre e configure as atividades operacionais — sem depender de código.</p></div>
      <div class="d-flex gap-2">${extra}</div></div>
    <div class="admin-tabs no-print">${ABAS.map(([id, ic, lb]) => `<button class="rna-chip ${id === state.tab ? 'active' : ''}" data-aba="${id}"><i class="bi ${ic}"></i> ${lb}</button>`).join('')}</div>`;
}
function mount(html, extraHead = '') {
  $('#rna-content').innerHTML = head(extraHead) + html;
  $$('[data-aba]').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.aba; state.view = 'lista'; render(); }));
}

function render() {
  if ((state.tab === 'rotinas' || state.tab === 'checklists') && state.view === 'editor') return renderEditor(curTipo());
  if (state.tab === 'rotinas' || state.tab === 'checklists') return renderLista(curTipo());
  if (state.tab === 'categorias') return renderCategorias();
  if (state.tab === 'tipos') return renderTipos();
  if (state.tab === 'atribuicoes') return renderAtribuicoesOverview();
  if (state.tab === 'agenda') return renderAgendaOverview();
  if (state.tab === 'templates') return renderTemplates();
  if (state.tab === 'indicadores') return renderIndicadores();
}

/* --------------------------------------------------- Rotinas / Checklists -- */
async function renderLista(tipo) {
  const L = TIPO_LABEL[tipo];
  const ativs = (await db.list('op_atividades')).filter(a => a.tipo_slug === tipo && !a.is_template);
  const linha = a => `<tr>
    <td class="cell-strong">${a.nome}<div class="cell-sub">${a.codigo || ''}</div></td>
    <td>${a.categoria || '—'}</td><td class="cell-sub">${a.planta || 'Todas'}</td>
    <td>${a.obrigatoria ? '<span class="rna-badge badge-crit">Sim</span>' : '<span class="rna-badge badge-na">Não</span>'}</td>
    <td><span class="rna-badge ${a.status === 'publicada' ? 'badge-ok' : a.status === 'arquivada' ? 'badge-na' : 'badge-warn'}">${a.status}</span></td>
    <td class="text-end">${CAN_EDIT ? `
      <button class="rna-btn rna-btn-ghost rna-btn-sm" data-edit="${a.id}"><i class="bi bi-pencil"></i></button>
      <button class="rna-btn rna-btn-ghost rna-btn-sm" data-dup="${a.id}" title="Duplicar"><i class="bi bi-files"></i></button>
      <button class="rna-btn rna-btn-ghost rna-btn-sm" data-arch="${a.id}" title="${a.status === 'arquivada' ? 'Publicar' : 'Arquivar'}"><i class="bi ${a.status === 'arquivada' ? 'bi-upload' : 'bi-archive'}"></i></button>
      ${CAN_DELETE ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-del="${a.id}"><i class="bi bi-trash text-danger"></i></button>` : ''}` : ''}</td></tr>`;
  mount(`<div class="rna-card"><div class="rna-card__head"><h3><i class="bi ${L.icon}"></i> ${L.plur} <span class="rna-badge badge-info">${ativs.length}</span></h3></div>
    <div class="rna-card__body p-0" style="overflow:auto"><table class="rna-table"><thead><tr><th>${L.Sing}</th><th>Categoria</th><th>Planta</th><th>Obrig.</th><th>Status</th><th></th></tr></thead>
      <tbody>${ativs.length ? ativs.map(linha).join('') : `<tr><td colspan="6"><div class="empty-state"><i class="bi bi-inbox"></i><div>Nenhum(a) ${L.sing} cadastrado(a). Clique em “Novo(a) ${L.sing}”.</div></div></td></tr>`}</tbody></table></div></div>`,
    CAN_EDIT ? `<button class="rna-btn rna-btn-primary" id="btn-nova"><i class="bi bi-plus-lg"></i> Novo(a) ${L.sing}</button>` : '');

  $('#btn-nova')?.addEventListener('click', () => { state.ativId = null; state.view = 'editor'; render(); });
  $$('[data-edit]').forEach(b => b.addEventListener('click', () => { state.ativId = b.dataset.edit; state.view = 'editor'; render(); }));
  $$('[data-dup]').forEach(b => b.addEventListener('click', () => duplicar(b.dataset.dup)));
  $$('[data-arch]').forEach(b => b.addEventListener('click', () => toggleArquivo(b.dataset.arch)));
  $$('[data-del]').forEach(b => b.addEventListener('click', () => excluir(b.dataset.del)));
}

let edItens = [], edAtrs = [], edAgenda = { tipo: 'diaria', dias: [], ref: '', intervalo_horas: null };

async function renderEditor(tipo = 'rotina') {
  const L = TIPO_LABEL[tipo];
  const isNew = !state.ativId;
  let a = { tipo_slug: tipo, status: 'rascunho', obrigatoria: true, prioridade: 'Média', frequencia: 'Diária', anexos: [] };
  if (!isNew) { a = await db.get('op_atividades', state.ativId) || a; }
  const cats = (await db.list('op_categorias')).filter(c => c.ativo !== false && c.tipo_slug === tipo);
  edItens = isNew ? [] : (await ATIV.itens(a.id)).map(clone);
  edAtrs = isNew ? [] : (await db.list('op_atribuicoes', { filter: { atividade_id: a.id } })).map(clone);
  const ags = isNew ? [] : (await db.list('op_agenda', { filter: { atividade_id: a.id } }));
  edAgenda = ags[0] ? clone(ags[0]) : { tipo: 'diaria', dias: [], ref: '', intervalo_horas: null };
  if (!Array.isArray(edAgenda.dias)) edAgenda.dias = [];

  const inp = (f, l, v, t = 'text') => `<div class="col-md-4"><label class="form-label">${l}</label><input class="form-control" data-a="${f}" type="${t}" value="${esc(v)}"></div>`;
  const selOpt = (arr, v) => `<option value="">—</option>` + arr.map(o => `<option ${o === v ? 'selected' : ''}>${o}</option>`).join('');
  const sel = (f, l, arr, v) => `<div class="col-md-4"><label class="form-label">${l}</label><select class="form-select" data-a="${f}">${selOpt(arr, v)}</select></div>`;

  mount(`
    <div class="rna-card mb-3"><div class="rna-card__body d-flex align-items-center gap-2">
      <i class="bi bi-pencil-square" style="font-size:20px;color:var(--rna-yellow-600)"></i>
      <b>${isNew ? `Novo(a) ${L.sing}` : `Editar ${a.codigo || a.nome}`}</b></div></div>

    <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-info-circle"></i> Informações gerais</h3></div>
      <div class="rna-card__body"><div class="row g-3">
        ${inp('nome', 'Nome *', a.nome)}${inp('codigo', 'Código', a.codigo)}
        <div class="col-md-4"><label class="form-label">Categoria</label>
          <div class="d-flex gap-1"><select class="form-select" data-a="categoria">${selOpt(cats.map(c => c.nome), a.categoria)}</select>
          <button class="rna-btn rna-btn-ghost" id="add-cat" title="Nova categoria"><i class="bi bi-plus-lg"></i></button></div></div>
        <div class="col-12"><label class="form-label">Descrição</label><textarea class="form-control" data-a="descricao" rows="2">${escHtml(a.descricao)}</textarea></div>
        ${sel('planta', 'Planta', PLANTAS, a.planta)}${inp('setor', 'Setor', a.setor)}${inp('linha', 'Linha', a.linha)}
        ${inp('processo', 'Processo', a.processo)}${inp('maquina', 'Máquina', a.maquina)}${sel('turno', 'Turno', TURNOS, a.turno)}
        ${sel('frequencia', 'Frequência', DATA.OP_FREQUENCIAS, a.frequencia)}${inp('horario', 'Horário', a.horario, 'time')}${inp('tempo_estimado', 'Tempo estimado (min)', a.tempo_estimado, 'number')}
        ${inp('data_inicio', 'Data início', a.data_inicio, 'date')}${inp('data_fim', 'Data fim', a.data_fim, 'date')}
        ${sel('prioridade', 'Prioridade', DATA.OP_PRIORIDADES, a.prioridade)}
        <div class="col-md-4"><label class="form-label">Status</label><select class="form-select" data-a="status">${DATA.OP_STATUS.map(s => `<option ${s === a.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="col-md-4 d-flex align-items-end"><label class="form-check"><input type="checkbox" class="form-check-input" data-a="obrigatoria" ${a.obrigatoria ? 'checked' : ''}> <span class="ms-1">Obrigatória</span></label></div>
      </div></div></div>

    <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-card-checklist"></i> Itens do(a) ${L.sing}</h3>
      <button class="rna-btn rna-btn-ghost rna-btn-sm" id="add-item"><i class="bi bi-plus-lg"></i> Adicionar item</button></div>
      <div class="rna-card__body p-0" style="overflow:auto"><table class="rna-table bib-edit-table" id="ed-itens"></table></div></div>

    <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-diagram-2"></i> Atribuições <small class="text-muted-2" style="font-weight:400">(prioridade: usuário › cargo › planta+turno)</small></h3>
      <button class="rna-btn rna-btn-ghost rna-btn-sm" id="add-atr"><i class="bi bi-plus-lg"></i> Adicionar</button></div>
      <div class="rna-card__body" id="ed-atrs"></div></div>

    <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-calendar-week"></i> Agenda</h3></div>
      <div class="rna-card__body"><div class="row g-3" id="ed-agenda"></div></div></div>

    <div class="d-flex gap-2 justify-content-end mb-4">
      <button class="rna-btn rna-btn-ghost" id="ed-cancel">Cancelar</button>
      <button class="rna-btn rna-btn-primary rna-btn-lg" id="ed-save"><i class="bi bi-check2"></i> ${isNew ? 'Criar rotina' : 'Salvar'}</button>
    </div>`);

  renderItens(tipo); renderAtrs(); renderAgenda();
  $('#add-item').addEventListener('click', () => { edItens.push(blankItem()); renderItens(tipo); });
  $('#add-atr').addEventListener('click', () => { edAtrs.push({ alvo_tipo: 'planta_turno', alvo_valor: '', planta: '', turno: '' }); renderAtrs(); });
  $('#add-cat').addEventListener('click', () => novaCategoria(tipo));
  $('#ed-cancel').addEventListener('click', () => { state.view = 'lista'; render(); });
  $('#ed-save').addEventListener('click', () => salvar(isNew, a, tipo));
}

function renderItens(tipo = 'rotina') {
  const t = $('#ed-itens');
  const chk = (m, f) => `<input type="checkbox" class="form-check-input" data-if="${f}" ${m[f] ? 'checked' : ''}>`;
  const rowRot = (m, i) => `<tr data-irow="${i}">
    <td><input class="form-control form-control-sm" data-if="nome" value="${esc(m.nome)}" style="min-width:150px"></td>
    <td><select class="form-select form-select-sm" data-if="tipo_resposta" style="width:110px">${['checkbox', 'numero', 'texto', 'foto'].map(o => `<option ${o === m.tipo_resposta ? 'selected' : ''}>${o}</option>`).join('')}</select></td>
    <td class="text-center">${chk(m, 'valor_numerico')}</td>
    <td><input class="form-control form-control-sm" data-if="limite_min" value="${esc(m.limite_min)}" style="width:70px" inputmode="decimal"></td>
    <td><input class="form-control form-control-sm" data-if="limite_max" value="${esc(m.limite_max)}" style="width:70px" inputmode="decimal"></td>
    <td><input class="form-control form-control-sm" data-if="unidade" value="${esc(m.unidade)}" style="width:60px"></td>
    <td class="text-center">${chk(m, 'foto_obrigatoria')}</td>
    <td class="text-center">${chk(m, 'obs_obrigatoria')}</td>
    <td><input class="form-control form-control-sm" data-if="peso" value="${esc(m.peso)}" style="width:56px" inputmode="decimal"></td>
    ${acoes(i)}</tr>`;
  const rowChk = (m, i) => `<tr data-irow="${i}">
    <td><input class="form-control form-control-sm" data-if="nome" value="${esc(m.nome)}" style="min-width:160px"></td>
    <td><select class="form-select form-select-sm" data-if="tipo_resposta" style="width:130px">${DATA.OP_TIPOS_RESPOSTA.map(o => `<option value="${o.slug}" ${o.slug === m.tipo_resposta ? 'selected' : ''}>${o.nome}</option>`).join('')}</select></td>
    <td><input class="form-control form-control-sm" data-if="opcoes" value="${esc((m.opcoes || []).join(', '))}" placeholder="A, B, C" style="min-width:130px"></td>
    <td><input class="form-control form-control-sm" data-if="resposta_esperada" value="${esc(m.resposta_esperada)}" placeholder="ex.: Sim" style="width:100px"></td>
    <td><input class="form-control form-control-sm" data-if="limite_min" value="${esc(m.limite_min)}" style="width:66px" inputmode="decimal"></td>
    <td><input class="form-control form-control-sm" data-if="limite_max" value="${esc(m.limite_max)}" style="width:66px" inputmode="decimal"></td>
    <td><input class="form-control form-control-sm" data-if="unidade" value="${esc(m.unidade)}" style="width:54px"></td>
    <td class="text-center">${chk(m, 'foto_obrigatoria')}</td>
    <td class="text-center">${chk(m, 'comentario_obrigatorio')}</td>
    <td class="text-center">${chk(m, 'abrir_pendencia')}</td>
    <td><input class="form-control form-control-sm" data-if="peso" value="${esc(m.peso)}" style="width:52px" inputmode="decimal"></td>
    ${acoes(i)}</tr>`;
  const acoes = i => `<td class="bib-row-actions">
      <button class="rna-icon-mini" data-iup="${i}"><i class="bi bi-chevron-up"></i></button>
      <button class="rna-icon-mini" data-idown="${i}"><i class="bi bi-chevron-down"></i></button>
      <button class="rna-icon-mini" data-idup="${i}"><i class="bi bi-files"></i></button>
      <button class="rna-icon-mini" data-idel="${i}"><i class="bi bi-trash text-danger"></i></button></td>`;
  const isChk = tipo === 'checklist';
  const heads = isChk
    ? ['Item', 'Tipo resposta', 'Opções', 'Resp. esperada', 'Lim. mín', 'Lim. máx', 'Un.', 'Foto obr.', 'Coment. obr.', 'Abrir pend.', 'Peso', '']
    : ['Item', 'Tipo', 'Valor nº', 'Lim. mín', 'Lim. máx', 'Un.', 'Foto obr.', 'Obs obr.', 'Peso', ''];
  t.innerHTML = `<thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}</tr></thead>
    <tbody>${edItens.map(isChk ? rowChk : rowRot).join('') || `<tr><td colspan="${heads.length}" class="cell-sub" style="padding:14px">Nenhum item. Clique em “Adicionar item”.</td></tr>`}</tbody>`;
  t.querySelectorAll('[data-irow]').forEach(tr => {
    const i = +tr.dataset.irow;
    tr.querySelectorAll('[data-if]').forEach(inp => inp.addEventListener('change', () => {
      const f = inp.dataset.if;
      edItens[i][f] = f === 'opcoes' ? inp.value.split(',').map(s => s.trim()).filter(Boolean) : inp.type === 'checkbox' ? inp.checked : inp.value;
    }));
  });
  $$('[data-iup]', t).forEach(b => b.addEventListener('click', () => moveItem(+b.dataset.iup, -1, tipo)));
  $$('[data-idown]', t).forEach(b => b.addEventListener('click', () => moveItem(+b.dataset.idown, 1, tipo)));
  $$('[data-idup]', t).forEach(b => b.addEventListener('click', () => { const i = +b.dataset.idup; edItens.splice(i + 1, 0, clone(edItens[i])); renderItens(tipo); }));
  $$('[data-idel]', t).forEach(b => b.addEventListener('click', () => { edItens.splice(+b.dataset.idel, 1); renderItens(tipo); }));
}
function moveItem(i, d, tipo) { const j = i + d; if (j < 0 || j >= edItens.length) return;[edItens[i], edItens[j]] = [edItens[j], edItens[i]]; renderItens(tipo); }

async function renderAtrs() {
  const box = $('#ed-atrs');
  const usuarios = await db.list('usuarios');
  const userOpts = usuarios.map(u => `<option value="${u.id}">${u.nome} (${u.role})</option>`).join('');
  const row = (r, i) => {
    const valorField = r.alvo_tipo === 'usuario'
      ? `<select class="form-select form-select-sm" data-af="alvo_valor">${`<option value="">—</option>` + userOpts.replace(`value="${r.alvo_valor}"`, `value="${r.alvo_valor}" selected`)}</select>`
      : r.alvo_tipo === 'cargo'
        ? `<select class="form-select form-select-sm" data-af="alvo_valor"><option value="">—</option>${ROLES.map(o => `<option ${o === r.alvo_valor ? 'selected' : ''}>${o}</option>`).join('')}</select>`
        : `<div class="d-flex gap-1"><select class="form-select form-select-sm" data-af="planta"><option value="">Todas plantas</option>${PLANTAS.map(o => `<option ${o === r.planta ? 'selected' : ''}>${o}</option>`).join('')}</select>
           <select class="form-select form-select-sm" data-af="turno"><option value="">Todos turnos</option>${TURNOS.map(o => `<option ${o === r.turno ? 'selected' : ''}>${o}</option>`).join('')}</select></div>`;
    return `<div class="d-flex gap-2 mb-2 align-items-center" data-arow="${i}">
      <select class="form-select form-select-sm" data-af="alvo_tipo" style="max-width:170px">${DATA.OP_ALVO_TIPOS.map(o => `<option value="${o.slug}" ${o.slug === r.alvo_tipo ? 'selected' : ''}>${o.nome}</option>`).join('')}</select>
      <div class="flex-fill">${valorField}</div>
      <button class="rna-icon-mini" data-adel="${i}"><i class="bi bi-trash text-danger"></i></button></div>`;
  };
  box.innerHTML = edAtrs.length ? edAtrs.map(row).join('') : `<div class="cell-sub">Sem atribuições — a rotina não aparecerá para ninguém. Adicione ao menos uma.</div>`;
  box.querySelectorAll('[data-arow]').forEach(rowEl => {
    const i = +rowEl.dataset.arow;
    rowEl.querySelectorAll('[data-af]').forEach(inp => inp.addEventListener('change', () => {
      edAtrs[i][inp.dataset.af] = inp.value;
      if (inp.dataset.af === 'alvo_tipo') { edAtrs[i].alvo_valor = ''; edAtrs[i].planta = ''; edAtrs[i].turno = ''; renderAtrs(); }
    }));
  });
  $$('[data-adel]', box).forEach(b => b.addEventListener('click', () => { edAtrs.splice(+b.dataset.adel, 1); renderAtrs(); }));
}

function renderAgenda() {
  const box = $('#ed-agenda');
  box.innerHTML = `
    <div class="col-md-4"><label class="form-label">Recorrência</label>
      <select class="form-select" id="ag-tipo">${DATA.OP_AGENDA_TIPOS.map(o => `<option value="${o}" ${o === edAgenda.tipo ? 'selected' : ''}>${agLabel(o)}</option>`).join('')}</select></div>
    <div class="col-md-8" id="ag-extra"></div>`;
  $('#ag-tipo').addEventListener('change', e => { edAgenda.tipo = e.target.value; renderAgendaExtra(); });
  renderAgendaExtra();
}
function renderAgendaExtra() {
  const box = $('#ag-extra'); if (!box) return;
  if (['dia_semana', 'semanal'].includes(edAgenda.tipo)) {
    box.innerHTML = `<label class="form-label">Dias da semana</label><div class="d-flex flex-wrap gap-1">${DATA.OP_DIAS_SEMANA.map(d => `<button type="button" class="rna-chip ${edAgenda.dias.includes(d) ? 'active' : ''}" data-dia="${d}">${d}</button>`).join('')}</div>`;
    $$('[data-dia]', box).forEach(b => b.addEventListener('click', () => { const d = b.dataset.dia; edAgenda.dias = edAgenda.dias.includes(d) ? edAgenda.dias.filter(x => x !== d) : [...edAgenda.dias, d]; renderAgendaExtra(); }));
  } else if (edAgenda.tipo === 'mensal') {
    box.innerHTML = `<label class="form-label">Dia do mês</label><input class="form-control" type="number" min="1" max="31" id="ag-ref" value="${esc(edAgenda.ref)}" style="max-width:120px">`;
    $('#ag-ref').addEventListener('input', e => edAgenda.ref = e.target.value);
  } else if (edAgenda.tipo === 'a_cada_x_horas') {
    box.innerHTML = `<label class="form-label">Intervalo (horas)</label><input class="form-control" type="number" min="1" id="ag-int" value="${esc(edAgenda.intervalo_horas)}" style="max-width:120px">`;
    $('#ag-int').addEventListener('input', e => edAgenda.intervalo_horas = e.target.value);
  } else { box.innerHTML = `<label class="form-label">&nbsp;</label><div class="text-muted-2" style="font-size:12.5px">${agLabel(edAgenda.tipo)} — sem parâmetros adicionais.</div>`; }
}
function agLabel(t) { return { diaria: 'Diária', dia_semana: 'Dias da semana', semanal: 'Semanal', mensal: 'Mensal', por_turno: 'Por turno', sob_demanda: 'Sob demanda', a_cada_x_horas: 'A cada X horas' }[t] || t; }

async function salvar(isNew, a, tipo = 'rotina') {
  const btn = $('#ed-save'); btn.disabled = true;
  try {
    const patch = {};
    $$('[data-a]').forEach(i => { patch[i.dataset.a] = i.type === 'checkbox' ? i.checked : i.value.trim(); });
    if (!patch.nome) { toast('Nome é obrigatório.', { type: 'warn' }); btn.disabled = false; return; }
    patch.tempo_estimado = ATIV.numOrNull(patch.tempo_estimado);
    patch.tipo_slug = tipo;

    let ativ;
    if (isNew) ativ = await db.insert('op_atividades', { ...patch, is_template: false, anexos: [], created_by: USER.id, created_at: ATIV.hoje(), updated_at: ATIV.hoje() });
    else ativ = await db.update('op_atividades', a.id, { ...patch, updated_at: ATIV.hoje() });

    // itens (substitui) — valor_numerico derivado do tipo de resposta 'numero'
    await substituir('op_atividade_itens', ativ.id, edItens.filter(m => (m.nome || '').trim()), (m, ord) => ({
      atividade_id: ativ.id, ordem: ord, nome: m.nome, descricao: m.descricao || '', tipo_resposta: m.tipo_resposta || 'checkbox',
      opcoes: Array.isArray(m.opcoes) ? m.opcoes : [], resposta_esperada: m.resposta_esperada || '',
      abrir_pendencia: !!m.abrir_pendencia, comentario_obrigatorio: !!m.comentario_obrigatorio,
      foto_obrigatoria: !!m.foto_obrigatoria || m.tipo_resposta === 'foto', obs_obrigatoria: !!m.obs_obrigatoria,
      valor_numerico: tipo === 'checklist' ? m.tipo_resposta === 'numero' : !!m.valor_numerico,
      limite_min: ATIV.numOrNull(m.limite_min), limite_max: ATIV.numOrNull(m.limite_max), unidade: m.unidade || '', peso: ATIV.numOrNull(m.peso) || 1, qrcode: m.qrcode || '', codigo_barras: m.codigo_barras || ''
    }));
    // atribuições (substitui)
    await substituir('op_atribuicoes', ativ.id, edAtrs, (r) => ({ atividade_id: ativ.id, alvo_tipo: r.alvo_tipo, alvo_valor: r.alvo_valor || '', planta: r.planta || '', turno: r.turno || '', prioridade: ATIV.ALVO_PRIORIDADE[r.alvo_tipo] || 1 }));
    // agenda (uma linha)
    const agsOld = await db.list('op_agenda', { filter: { atividade_id: ativ.id } });
    for (const g of agsOld) await db.remove('op_agenda', g.id);
    await db.insert('op_agenda', { atividade_id: ativ.id, tipo: edAgenda.tipo, dias: edAgenda.dias || [], intervalo_horas: ATIV.numOrNull(edAgenda.intervalo_horas), ref: edAgenda.ref || '' });

    await db.log({ usuario: USER.nome, acao: `${isNew ? 'Criou' : 'Editou'} ${TIPO_LABEL[tipo].sing} ${ativ.codigo || ativ.nome}`, entidade: 'op_atividades', antes: isNew ? '—' : a.status, depois: ativ.status });
    toast(isNew ? `${TIPO_LABEL[tipo].Sing} criado(a).` : `${TIPO_LABEL[tipo].Sing} salvo(a).`, { type: 'ok', title: 'Gestão Operacional' });
    state.view = 'lista'; render();
  } catch (err) { console.error('[gestao-op] salvar', err); toast('Erro ao salvar. ' + (err?.message || ''), { type: 'crit' }); btn.disabled = false; }
}

async function substituir(tabela, ativId, itens, mapFn) {
  const old = await db.list(tabela, { filter: { atividade_id: ativId } });
  for (const o of old) await db.remove(tabela, o.id);
  let ord = 1; for (const it of itens) await db.insert(tabela, mapFn(it, ord++));
}

async function duplicar(id) {
  const a = await db.get('op_atividades', id); if (!a) return;
  const { id: _i, ...base } = a;
  const nova = await db.insert('op_atividades', { ...base, codigo: (a.codigo || '') + '-COPIA', nome: a.nome + ' (cópia)', status: 'rascunho', is_template: false, created_by: USER.id, created_at: ATIV.hoje(), updated_at: ATIV.hoje() });
  for (const it of await ATIV.itens(id)) { const { id: _x, atividade_id: _y, ...r } = it; await db.insert('op_atividade_itens', { ...r, atividade_id: nova.id }); }
  for (const at of await db.list('op_atribuicoes', { filter: { atividade_id: id } })) { const { id: _x, atividade_id: _y, ...r } = at; await db.insert('op_atribuicoes', { ...r, atividade_id: nova.id }); }
  for (const ag of await db.list('op_agenda', { filter: { atividade_id: id } })) { const { id: _x, atividade_id: _y, ...r } = ag; await db.insert('op_agenda', { ...r, atividade_id: nova.id }); }
  toast('Rotina duplicada.', { type: 'ok' }); render();
}
async function toggleArquivo(id) {
  const a = await db.get('op_atividades', id); if (!a) return;
  await db.update('op_atividades', id, { status: a.status === 'arquivada' ? 'publicada' : 'arquivada', updated_at: ATIV.hoje() });
  toast(a.status === 'arquivada' ? 'Rotina publicada.' : 'Rotina arquivada.', { type: 'ok' }); render();
}
function excluir(id) {
  confirmDialog('Excluir esta rotina e seus itens/atribuições? Não pode ser desfeito.', async () => {
    for (const t of ['op_atividade_itens', 'op_atribuicoes', 'op_agenda']) { for (const r of await db.list(t, { filter: { atividade_id: id } })) await db.remove(t, r.id); }
    await db.remove('op_atividades', id); toast('Rotina excluída.', { type: 'ok' }); render();
  }, { title: 'Excluir rotina', okLabel: 'Excluir', danger: true });
}

function novaCategoria(tipo = 'rotina') {
  const m = modal({ title: 'Nova categoria', content: `<label class="form-label">Nome da categoria (${TIPO_LABEL[tipo].sing})</label><input class="form-control" id="nc-nome" placeholder="Ex.: Segurança">`, footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button><button class="rna-btn rna-btn-primary" id="nc-ok">Adicionar</button>` });
  $('#nc-ok', m.host).addEventListener('click', async () => { const nome = $('#nc-nome', m.host).value.trim(); if (!nome) return; await db.insert('op_categorias', { nome, tipo_slug: tipo, ativo: true }); m.close(); toast('Categoria adicionada.', { type: 'ok' }); render(); });
}

/* ------------------------------------------------- Categorias / Tipos ------ */
async function renderCategorias() {
  const rows = await db.list('op_categorias');
  mount(`<div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-tags"></i> Categorias <span class="rna-badge badge-info">${rows.length}</span></h3></div>
    <div class="rna-card__body p-0" style="overflow:auto"><table class="rna-table"><thead><tr><th>Nome</th><th>Tipo</th><th>Ativo</th><th></th></tr></thead>
      <tbody>${rows.map(c => `<tr><td class="cell-strong">${c.nome}</td><td>${c.tipo_slug}</td><td>${c.ativo !== false ? 'Sim' : 'Não'}</td>
        <td class="text-end">${CAN_DELETE ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-cdel="${c.id}"><i class="bi bi-trash text-danger"></i></button>` : ''}</td></tr>`).join('') || emptyRow(4)}</tbody></table></div></div>`,
    CAN_EDIT ? `<button class="rna-btn rna-btn-primary" id="btn-cat"><i class="bi bi-plus-lg"></i> Nova categoria</button>` : '');
  $('#btn-cat')?.addEventListener('click', novaCategoria);
  $$('[data-cdel]').forEach(b => b.addEventListener('click', () => confirmDialog('Excluir categoria?', async () => { await db.remove('op_categorias', b.dataset.cdel); render(); }, { title: 'Excluir', okLabel: 'Excluir', danger: true })));
}

async function renderTipos() {
  const rows = await db.list('op_tipos_atividade');
  mount(`<div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-collection"></i> Tipos de Atividades <span class="rna-badge badge-info">${rows.length}</span></h3></div>
    <div class="rna-card__body p-0" style="overflow:auto"><table class="rna-table"><thead><tr><th>Nome</th><th>Slug</th><th>Ativo</th><th></th></tr></thead>
      <tbody>${rows.map(t => `<tr><td class="cell-strong"><i class="bi ${t.icone}"></i> ${t.nome}</td><td class="cell-sub">${t.slug}</td><td>${t.ativo !== false ? 'Sim' : 'Não'}</td>
        <td class="text-end">${CAN_DELETE ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-tdel="${t.id}"><i class="bi bi-trash text-danger"></i></button>` : ''}</td></tr>`).join('')}</tbody></table></div></div>`,
    CAN_EDIT ? `<button class="rna-btn rna-btn-primary" id="btn-tipo"><i class="bi bi-plus-lg"></i> Novo tipo</button>` : '');
  $('#btn-tipo')?.addEventListener('click', () => {
    const m = modal({ title: 'Novo tipo de atividade', content: `<label class="form-label">Nome</label><input class="form-control mb-2" id="nt-nome"><label class="form-label">Ícone (Bootstrap Icons)</label><input class="form-control" id="nt-ic" value="bi-three-dots" placeholder="bi-...">`, footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button><button class="rna-btn rna-btn-primary" id="nt-ok">Adicionar</button>` });
    $('#nt-ok', m.host).addEventListener('click', async () => { const nome = $('#nt-nome', m.host).value.trim(); if (!nome) return; const slug = nome.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '_'); await db.insert('op_tipos_atividade', { nome, slug, cor: 'gray', icone: $('#nt-ic', m.host).value.trim() || 'bi-three-dots', ativo: true }); m.close(); toast('Tipo adicionado.', { type: 'ok' }); render(); });
  });
  $$('[data-tdel]').forEach(b => b.addEventListener('click', () => confirmDialog('Excluir tipo?', async () => { await db.remove('op_tipos_atividade', b.dataset.tdel); render(); }, { title: 'Excluir', okLabel: 'Excluir', danger: true })));
}

/* --------------------------------------- Overviews / Templates / KPIs ------ */
async function renderAtribuicoesOverview() {
  const [atrs, ativs, usuarios] = await Promise.all([db.list('op_atribuicoes'), db.list('op_atividades'), db.list('usuarios')]);
  const aBy = Object.fromEntries(ativs.map(a => [a.id, a])); const uBy = Object.fromEntries(usuarios.map(u => [u.id, u]));
  const alvoTxt = r => r.alvo_tipo === 'usuario' ? `Usuário: ${uBy[r.alvo_valor]?.nome || r.alvo_valor}` : r.alvo_tipo === 'cargo' ? `Cargo: ${r.alvo_valor}` : `Planta: ${r.planta || 'Todas'} · Turno: ${r.turno || 'Todos'}`;
  mount(`<div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-diagram-2"></i> Atribuições <span class="rna-badge badge-info">${atrs.length}</span></h3></div>
    <div class="rna-card__body p-0" style="overflow:auto"><table class="rna-table"><thead><tr><th>Atividade</th><th>Alvo</th><th>Prioridade</th></tr></thead>
      <tbody>${atrs.map(r => `<tr><td class="cell-strong">${aBy[r.atividade_id]?.nome || '—'}<div class="cell-sub">${aBy[r.atividade_id]?.codigo || ''}</div></td><td>${alvoTxt(r)}</td><td>${r.prioridade}</td></tr>`).join('') || emptyRow(3)}</tbody></table></div>
    <div class="rna-card__body"><small class="text-muted-2">As atribuições são editadas dentro de cada rotina. A prioridade (usuário 100 › cargo 50 › planta+turno 10) resolve qual regra inclui a atividade para o auditor.</small></div></div>`);
}
async function renderAgendaOverview() {
  const [ags, ativs] = await Promise.all([db.list('op_agenda'), db.list('op_atividades')]);
  const aBy = Object.fromEntries(ativs.map(a => [a.id, a]));
  mount(`<div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-calendar-week"></i> Agenda <span class="rna-badge badge-info">${ags.length}</span></h3></div>
    <div class="rna-card__body p-0" style="overflow:auto"><table class="rna-table"><thead><tr><th>Atividade</th><th>Recorrência</th><th>Detalhe</th></tr></thead>
      <tbody>${ags.map(g => `<tr><td class="cell-strong">${aBy[g.atividade_id]?.nome || '—'}</td><td>${agLabel(g.tipo)}</td><td class="cell-sub">${(g.dias || []).join(', ') || (g.ref ? `dia ${g.ref}` : g.intervalo_horas ? `a cada ${g.intervalo_horas}h` : '—')}</td></tr>`).join('') || emptyRow(3)}</tbody></table></div></div>`);
}
async function renderTemplates() {
  const tpls = (await db.list('op_atividades')).filter(a => a.is_template);
  mount(`<div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-files"></i> Templates <span class="rna-badge badge-info">${tpls.length}</span></h3></div>
    <div class="rna-card__body">${tpls.length ? `<div class="row g-3">${tpls.map(t => `<div class="col-md-4"><div class="rna-card h-100"><div class="rna-card__body">
      <b>${t.nome}</b><div class="cell-sub mb-2">${t.categoria || ''} · ${t.codigo || ''}</div>
      ${CAN_EDIT ? `<button class="rna-btn rna-btn-primary rna-btn-sm" data-usetpl="${t.id}"><i class="bi bi-plus-lg"></i> Criar rotina a partir deste</button>` : ''}</div></div></div>`).join('')}</div>` : `<div class="empty-state"><i class="bi bi-inbox"></i><div>Nenhum template.</div></div>`}</div></div>`);
  $$('[data-usetpl]').forEach(b => b.addEventListener('click', async () => { await duplicarComoRotina(b.dataset.usetpl); }));
}
async function duplicarComoRotina(id) {
  const a = await db.get('op_atividades', id); const { id: _i, ...base } = a;
  const nova = await db.insert('op_atividades', { ...base, is_template: false, status: 'rascunho', nome: a.nome.replace(/^Template — /, ''), codigo: '', created_by: USER.id, created_at: ATIV.hoje(), updated_at: ATIV.hoje() });
  for (const it of await ATIV.itens(id)) { const { id: _x, atividade_id: _y, ...r } = it; await db.insert('op_atividade_itens', { ...r, atividade_id: nova.id }); }
  toast('Rotina criada a partir do template.', { type: 'ok' }); state.tab = 'rotinas'; state.ativId = nova.id; state.view = 'editor'; render();
}
async function renderIndicadores() {
  const ativs = (await db.list('op_atividades')).filter(a => !a.is_template);
  const porTipo = {}, porStatus = {};
  ativs.forEach(a => { porTipo[a.tipo_slug] = (porTipo[a.tipo_slug] || 0) + 1; porStatus[a.status] = (porStatus[a.status] || 0) + 1; });
  const execs = await db.list('op_execucao');
  const kpi = (v, l, ic, c) => `<div class="col-6 col-md-3"><div class="rna-stat"><div class="rna-stat__icon ${c}"><i class="bi ${ic}"></i></div><div class="rna-stat__val" style="font-size:22px">${v}</div><div class="rna-stat__label">${l}</div></div></div>`;
  mount(`<div class="row g-3 mb-3">
      ${kpi(ativs.length, 'Atividades', 'bi-collection', 'ic-soft-blue')}
      ${kpi(ativs.filter(a => a.status === 'publicada').length, 'Publicadas', 'bi-check2-circle', 'ic-soft-green')}
      ${kpi(execs.filter(e => e.status === 'concluida').length, 'Execuções concluídas', 'bi-list-check', 'ic-soft-yellow')}
      ${kpi((await db.list('op_pendencias')).filter(p => p.status !== 'resolvida').length, 'Pendências abertas', 'bi-exclamation-circle', 'ic-soft-red')}
    </div>
    <div class="row g-3"><div class="col-lg-6"><div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-collection"></i> Atividades por tipo</h3></div><div class="rna-card__body"><div style="height:240px"><canvas id="k-tipo"></canvas></div></div></div></div>
      <div class="col-lg-6"><div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-pie-chart"></i> Por status</h3></div><div class="rna-card__body"><div style="height:240px"><canvas id="k-status"></canvas></div></div></div></div></div>`);
  const cores = [PALETTE.blue, PALETTE.green, PALETTE.orange, PALETTE.yellow, PALETTE.red, PALETTE.gray];
  if (Object.keys(porTipo).length) charts.bar('k-tipo', Object.keys(porTipo), [{ label: 'Qtd', data: Object.values(porTipo), backgroundColor: PALETTE.blue }], { plugins: { legend: { display: false } } });
  if (Object.keys(porStatus).length) charts.doughnut('k-status', Object.keys(porStatus), Object.values(porStatus), cores.slice(0, Object.keys(porStatus).length));
}

/* --------------------------------------------------------------- utils ----- */
function blankItem() { return { nome: '', descricao: '', tipo_resposta: 'checkbox', opcoes: [], resposta_esperada: '', abrir_pendencia: false, comentario_obrigatorio: false, foto_obrigatoria: false, obs_obrigatoria: false, valor_numerico: false, limite_min: '', limite_max: '', unidade: '', peso: 1, qrcode: '', codigo_barras: '' }; }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function esc(s) { return String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function emptyRow(cols) { return `<tr><td colspan="${cols}"><div class="empty-state"><i class="bi bi-inbox"></i><div>Sem registros.</div></div></td></tr>`; }
