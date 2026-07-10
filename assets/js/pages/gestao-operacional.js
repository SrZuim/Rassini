/* ==========================================================================
   Gestão Operacional — Construtor Visual de Rotinas e Checklists
   Rotina = ação única (config de Concluir). Checklist = itens OK/NOK/N-A com
   config por resposta. Pré-visualização em tempo real = exatamente o que o
   auditor verá. Campos técnicos antigos permanecem nas tabelas (ocultos).
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
const ABAS = [
  ['rotinas', 'bi-list-check', 'Rotinas'], ['checklists', 'bi-ui-checks', 'Checklists'], ['categorias', 'bi-tags', 'Categorias'], ['tipos', 'bi-collection', 'Tipos de Atividades'],
  ['atribuicoes', 'bi-diagram-2', 'Atribuições'], ['agenda', 'bi-calendar-week', 'Agenda'], ['templates', 'bi-files', 'Templates'], ['indicadores', 'bi-bar-chart', 'Indicadores']
];
const TIPO_LABEL = { rotina: { sing: 'rotina', Sing: 'Rotina', plur: 'Rotinas', icon: 'bi-list-check' }, checklist: { sing: 'checklist', Sing: 'Checklist', plur: 'Checklists', icon: 'bi-ui-checks' } };
function curTipo() { return state.tab === 'checklists' ? 'checklist' : 'rotina'; }
const _cfg = (obs = 'nao', foto = 'nao', pend = false) => ({ observacao: obs, foto, criar_pendencia: !!pend });

const ctx = await mountShell();
if (ctx) { USER = ctx.user; CAN_EDIT = can(USER.role, 'gestao_op', 'edit'); CAN_DELETE = can(USER.role, 'gestao_op', 'delete'); render(); }

function head(extra = '') {
  return `<div class="rna-page-head"><div>
      <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Gestão Operacional</div>
      <h1>Gestão Operacional</h1><p>Construtor visual de rotinas e checklists — monte o que o auditor verá.</p></div>
      <div class="d-flex gap-2">${extra}</div></div>
    <div class="admin-tabs no-print">${ABAS.map(([id, ic, lb]) => `<button class="rna-chip ${id === state.tab ? 'active' : ''}" data-aba="${id}"><i class="bi ${ic}"></i> ${lb}</button>`).join('')}</div>`;
}
function mount(html, extraHead = '') {
  $('#rna-content').innerHTML = head(extraHead) + html;
  $$('[data-aba]').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.aba; state.view = 'lista'; render(); }));
}

function render() {
  if ((state.tab === 'rotinas' || state.tab === 'checklists') && state.view === 'editor') return curTipo() === 'checklist' ? renderBuilderChecklist() : renderBuilderRotina();
  if (state.tab === 'rotinas' || state.tab === 'checklists') return renderLista(curTipo());
  if (state.tab === 'categorias') return renderCategorias();
  if (state.tab === 'tipos') return renderTipos();
  if (state.tab === 'atribuicoes') return renderAtribuicoesOverview();
  if (state.tab === 'agenda') return renderAgendaOverview();
  if (state.tab === 'templates') return renderTemplates();
  if (state.tab === 'indicadores') return renderIndicadores();
}

/* --------------------------------------------------- Lista (Rotinas/Chk) --- */
async function renderLista(tipo) {
  const L = TIPO_LABEL[tipo];
  const ativs = (await db.list('op_atividades')).filter(a => a.tipo_slug === tipo && !a.is_template);
  const linha = a => `<tr>
    <td class="cell-strong">${a.nome}<div class="cell-sub">${a.categoria || ''}</div></td>
    <td class="cell-sub">${a.frequencia || '—'}${a.horario ? ` · ${a.horario}` : ''}</td>
    <td>${a.obrigatoria ? '<span class="rna-badge badge-crit">Sim</span>' : '<span class="rna-badge badge-na">Não</span>'}</td>
    <td><span class="rna-badge ${a.status === 'publicada' ? 'badge-ok' : a.status === 'arquivada' ? 'badge-na' : 'badge-warn'}">${a.status}</span></td>
    <td class="text-end">${CAN_EDIT ? `
      <button class="rna-btn rna-btn-ghost rna-btn-sm" data-edit="${a.id}"><i class="bi bi-pencil"></i></button>
      <button class="rna-btn rna-btn-ghost rna-btn-sm" data-dup="${a.id}" title="Duplicar"><i class="bi bi-files"></i></button>
      <button class="rna-btn rna-btn-ghost rna-btn-sm" data-arch="${a.id}" title="${a.status === 'arquivada' ? 'Publicar' : 'Arquivar'}"><i class="bi ${a.status === 'arquivada' ? 'bi-upload' : 'bi-archive'}"></i></button>
      ${CAN_DELETE ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-del="${a.id}"><i class="bi bi-trash text-danger"></i></button>` : ''}` : ''}</td></tr>`;
  mount(`<div class="rna-card"><div class="rna-card__head"><h3><i class="bi ${L.icon}"></i> ${L.plur} <span class="rna-badge badge-info">${ativs.length}</span></h3></div>
    <div class="rna-card__body p-0" style="overflow:auto"><table class="rna-table"><thead><tr><th>${L.Sing}</th><th>Frequência</th><th>Obrig.</th><th>Status</th><th></th></tr></thead>
      <tbody>${ativs.length ? ativs.map(linha).join('') : `<tr><td colspan="5"><div class="empty-state"><i class="bi bi-inbox"></i><div>Nenhum(a) ${L.sing}. Clique em “Novo(a) ${L.sing}”.</div></div></td></tr>`}</tbody></table></div></div>`,
    CAN_EDIT ? `<button class="rna-btn rna-btn-primary" id="btn-nova"><i class="bi bi-plus-lg"></i> Novo(a) ${L.sing}</button>` : '');
  $('#btn-nova')?.addEventListener('click', () => { state.ativId = null; state.view = 'editor'; render(); });
  $$('[data-edit]').forEach(b => b.addEventListener('click', () => { state.ativId = b.dataset.edit; state.view = 'editor'; render(); }));
  $$('[data-dup]').forEach(b => b.addEventListener('click', () => duplicar(b.dataset.dup)));
  $$('[data-arch]').forEach(b => b.addEventListener('click', () => toggleArquivo(b.dataset.arch)));
  $$('[data-del]').forEach(b => b.addEventListener('click', () => excluir(b.dataset.del)));
}

/* ============================ CONSTRUTOR DE ROTINA ========================= */
let R = {}, C = {}, edItens = [], USUARIOS = [];
function respLabel(r) { return r === 'todos' ? 'Todos os auditores' : (USUARIOS.find(u => u.id === r)?.nome || r); }
function radioExec(field, val) {
  return `<div class="op-radios">${DATA.OP_EXEC_OPCOES.map(o => `<label class="op-radio ${o.slug === val ? 'active' : ''}"><input type="radio" name="${field}" value="${o.slug}" ${o.slug === val ? 'checked' : ''}> ${o.nome}</label>`).join('')}</div>`;
}

async function renderBuilderRotina() {
  const isNew = !state.ativId;
  let a = { tipo_slug: 'rotina', status: 'rascunho', obrigatoria: true, frequencia: 'Diária', horario: '', exec_observacao: 'opcional', exec_foto: 'opcional', permite_na: true, responsavel: 'todos' };
  if (!isNew) a = await db.get('op_atividades', state.ativId) || a;
  R = { nome: a.nome || '', descricao: a.descricao || '', categoria: a.categoria || '', frequencia: a.frequencia || 'Diária', horario: a.horario || '', planta: a.planta || '', turno: a.turno || '', setor: a.setor || '', responsavel: a.responsavel || 'todos', exec_observacao: a.exec_observacao || 'opcional', exec_foto: a.exec_foto || 'opcional', permite_na: a.permite_na !== false, obrigatoria: a.obrigatoria !== false, status: a.status || 'rascunho' };
  const cats = (await db.list('op_categorias')).filter(c => c.ativo !== false && c.tipo_slug === 'rotina');
  USUARIOS = (await db.list('usuarios')).filter(u => u.role === 'auditor');
  const catOpt = `<option value="">—</option>` + cats.map(c => `<option ${c.nome === R.categoria ? 'selected' : ''}>${c.nome}</option>`).join('');
  const freqOpt = DATA.OP_FREQUENCIAS.map(f => `<option ${f === R.frequencia ? 'selected' : ''}>${f}</option>`).join('');
  const respOpt = `<option value="todos" ${R.responsavel === 'todos' ? 'selected' : ''}>Todos os auditores</option>` + USUARIOS.map(u => `<option value="${u.id}" ${u.id === R.responsavel ? 'selected' : ''}>${u.nome}</option>`).join('');
  const plantaOpt = `<option value="">Todas</option>` + PLANTAS.map(p => `<option ${p === R.planta ? 'selected' : ''}>${p}</option>`).join('');
  const turnoOpt = `<option value="">Todos</option>` + TURNOS.map(t => `<option ${t === R.turno ? 'selected' : ''}>${t}</option>`).join('');

  mount(`
    <div class="rna-card mb-3"><div class="rna-card__body d-flex align-items-center gap-2">
      <i class="bi bi-list-check" style="font-size:20px;color:var(--rna-yellow-600)"></i><b>${isNew ? 'Nova rotina' : 'Editar rotina'}</b>
      <span class="text-muted-2 ms-1" style="font-size:12.5px">Construtor visual — monte exatamente o que o auditor verá.</span></div></div>
    <div class="row g-3">
      <div class="col-lg-7">
        <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-info-circle"></i> Informações gerais</h3></div><div class="rna-card__body"><div class="row g-3">
          <div class="col-md-8"><label class="form-label">Nome da rotina *</label><input class="form-control" data-r="nome" value="${esc(R.nome)}"></div>
          <div class="col-md-4"><label class="form-label">Horário</label><input class="form-control" type="time" data-r="horario" value="${esc(R.horario)}"></div>
          <div class="col-md-8"><label class="form-label">Descrição</label><input class="form-control" data-r="descricao" value="${esc(R.descricao)}"></div>
          <div class="col-md-4"><label class="form-label">Frequência</label><select class="form-select" data-r="frequencia">${freqOpt}</select></div>
          <div class="col-12"><label class="form-label">Categoria</label><div class="d-flex gap-1"><select class="form-select" data-r="categoria">${catOpt}</select><button class="rna-btn rna-btn-ghost" id="add-cat" title="Nova categoria"><i class="bi bi-plus-lg"></i></button></div></div>
        </div></div></div>
        <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-geo-alt"></i> Onde será executada</h3></div><div class="rna-card__body"><div class="row g-3">
          <div class="col-md-6"><label class="form-label">Planta</label><select class="form-select" data-r="planta">${plantaOpt}</select></div>
          <div class="col-md-6"><label class="form-label">Turno</label><select class="form-select" data-r="turno">${turnoOpt}</select></div>
          <div class="col-md-6"><label class="form-label">Área / Setor</label><input class="form-control" data-r="setor" value="${esc(R.setor)}"></div>
          <div class="col-md-6"><label class="form-label">Responsável</label><select class="form-select" data-r="responsavel">${respOpt}</select></div>
          <div class="col-12"><small class="text-muted-2">Define quem verá a rotina. Responsável específico tem prioridade; senão Planta+Turno; senão todos os auditores.</small></div>
        </div></div></div>
        <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-sliders"></i> Configuração da execução</h3></div><div class="rna-card__body">
          <div class="mb-3"><label class="form-label">Observação</label>${radioExec('exec_observacao', R.exec_observacao)}</div>
          <div class="mb-3"><label class="form-label">Foto</label>${radioExec('exec_foto', R.exec_foto)}</div>
          <label class="form-check"><input type="checkbox" class="form-check-input" data-r="permite_na" ${R.permite_na ? 'checked' : ''}> <span class="ms-1">Permitir marcar N/A</span></label>
          <div class="divider"></div>
          <div class="d-flex gap-4 flex-wrap">
            <label class="form-check"><input type="checkbox" class="form-check-input" data-r="obrigatoria" ${R.obrigatoria ? 'checked' : ''}> <span class="ms-1">Obrigatória (bloqueia fechamento)</span></label>
            <label class="form-check"><input type="checkbox" class="form-check-input" data-r="publicar" ${R.status === 'publicada' ? 'checked' : ''}> <span class="ms-1">Publicar</span></label>
          </div>
        </div></div>
        <div class="d-flex gap-2 justify-content-end mb-4"><button class="rna-btn rna-btn-ghost" id="ed-cancel">Cancelar</button><button class="rna-btn rna-btn-primary rna-btn-lg" id="ed-save"><i class="bi bi-check2"></i> Salvar rotina</button></div>
      </div>
      <div class="col-lg-5"><div class="op-preview-wrap"><div class="op-preview__label"><i class="bi bi-eye"></i> Prévia — visão do auditor</div><div id="rot-preview"></div></div></div>
    </div>`);

  $$('[data-r]').forEach(inp => {
    const ev = inp.type === 'checkbox' || inp.tagName === 'SELECT' ? 'change' : 'input';
    inp.addEventListener(ev, () => { const f = inp.dataset.r; if (f === 'publicar') R.status = inp.checked ? 'publicada' : 'rascunho'; else R[f] = inp.type === 'checkbox' ? inp.checked : inp.value; renderRotinaPreview(); });
  });
  ['exec_observacao', 'exec_foto'].forEach(name => $$(`input[name="${name}"]`).forEach(r => r.addEventListener('change', () => { R[name] = document.querySelector(`input[name="${name}"]:checked`).value; markRadios(); renderRotinaPreview(); })));
  $('#add-cat').addEventListener('click', () => novaCategoria('rotina'));
  $('#ed-cancel').addEventListener('click', () => { state.view = 'lista'; render(); });
  $('#ed-save').addEventListener('click', () => salvarRotina(isNew));
  renderRotinaPreview();
}
function markRadios() { $$('.op-radio').forEach(l => l.classList.toggle('active', l.querySelector('input').checked)); }

function renderRotinaPreview() {
  const box = $('#rot-preview'); if (!box) return;
  const naBtn = R.permite_na ? `<button class="rna-btn rna-btn-ghost">N/A</button>` : '';
  box.innerHTML = `
    <div class="rna-card op-rot-card mb-2"><div class="rna-card__body">
      <div class="d-flex justify-content-between align-items-start"><b style="font-size:15px">${esc(R.nome) || 'Nome da rotina'}</b>${R.obrigatoria ? '<span class="rna-badge badge-crit">Obrigatória</span>' : '<span class="rna-badge badge-na">Opcional</span>'}</div>
      <div class="op-item__resp mt-1">${R.horario ? `<span><i class="bi bi-clock"></i> ${R.horario}</span>` : ''}<span><i class="bi bi-arrow-repeat"></i> ${R.frequencia}</span><span><i class="bi bi-person"></i> ${respLabel(R.responsavel)}</span></div>
      <div class="d-flex gap-2 mt-3"><button class="rna-btn rna-btn-primary" id="pv-concluir"><i class="bi bi-check2"></i> Concluir</button>${naBtn}</div>
    </div></div>
    <div id="pv-modal"></div>`;
  $('#pv-concluir').addEventListener('click', togglePvModal);
}
function togglePvModal() {
  const box = $('#pv-modal'); if (!box) return;
  if (box.innerHTML) { box.innerHTML = ''; return; }
  const obs = R.exec_observacao === 'nao' ? '<div class="text-muted-2" style="font-size:12.5px">Sem observação.</div>' : `<div class="mb-2"><label class="form-label">Observação ${R.exec_observacao === 'obrigatoria' ? '<span class="text-danger">*</span>' : ''}</label><textarea class="form-control" rows="2" placeholder="${R.exec_observacao === 'obrigatoria' ? 'Obrigatória' : 'Opcional'}"></textarea></div>`;
  const foto = R.exec_foto === 'nao' ? '' : `<div class="mb-2"><label class="form-label">Foto ${R.exec_foto === 'obrigatoria' ? '<span class="text-danger">*</span>' : ''}</label><div class="d-flex gap-2"><button class="rna-btn rna-btn-ghost rna-btn-sm"><i class="bi bi-folder2-open"></i> Arquivo</button><button class="rna-btn rna-btn-dark rna-btn-sm"><i class="bi bi-camera-fill"></i> Câmera</button></div></div>`;
  box.innerHTML = `<div class="op-preview-modal"><div class="op-preview-modal__head">Concluir — ${esc(R.nome) || 'Rotina'}</div><div class="op-preview-modal__body">${obs}${foto}</div><div class="op-preview-modal__foot"><button class="rna-btn rna-btn-ghost rna-btn-sm">Cancelar</button><button class="rna-btn rna-btn-primary rna-btn-sm"><i class="bi bi-check2"></i> Concluir</button></div></div>`;
}

async function salvarRotina(isNew) {
  if (!R.nome.trim()) return toast('Informe o nome da rotina.', { type: 'warn' });
  const patch = { tipo_slug: 'rotina', nome: R.nome.trim(), descricao: R.descricao || '', categoria: R.categoria || '', frequencia: R.frequencia, horario: R.horario || '', planta: R.planta || '', turno: R.turno || '', setor: R.setor || '', responsavel: R.responsavel || 'todos', exec_observacao: R.exec_observacao, exec_foto: R.exec_foto, permite_na: !!R.permite_na, obrigatoria: !!R.obrigatoria, status: R.status || 'rascunho', updated_at: ATIV.hoje() };
  let ativ;
  if (isNew) ativ = await db.insert('op_atividades', { ...patch, is_template: false, anexos: [], created_by: USER.id, created_at: ATIV.hoje() });
  else ativ = await db.update('op_atividades', state.ativId, patch);
  for (const it of await db.list('op_atividade_itens', { filter: { atividade_id: ativ.id } })) await db.remove('op_atividade_itens', it.id); // ação única: sem itens
  await gerarAtribuicao(ativ.id, R);
  await upsertAgenda(ativ.id, R.frequencia);
  await db.log({ usuario: USER.nome, acao: `${isNew ? 'Criou' : 'Editou'} rotina ${ativ.nome}`, entidade: 'op_atividades', antes: isNew ? '—' : '', depois: ativ.status });
  toast(isNew ? 'Rotina criada.' : 'Rotina salva.', { type: 'ok', title: 'Gestão Operacional' });
  state.view = 'lista'; render();
}

/* ========================== CONSTRUTOR DE CHECKLIST ======================= */
async function renderBuilderChecklist() {
  const isNew = !state.ativId;
  let a = { tipo_slug: 'checklist', status: 'rascunho', obrigatoria: true, frequencia: 'Diária', responsavel: 'todos' };
  if (!isNew) a = await db.get('op_atividades', state.ativId) || a;
  C = { nome: a.nome || '', categoria: a.categoria || '', descricao: a.descricao || '', obrigatoria: a.obrigatoria !== false, status: a.status || 'rascunho', responsavel: a.responsavel || 'todos', frequencia: a.frequencia || 'Diária', planta: a.planta || '', turno: a.turno || '' };
  edItens = isNew ? [] : (await ATIV.itens(a.id)).map(it => ({ nome: it.nome, respostas: (Array.isArray(it.respostas) && it.respostas.length) ? it.respostas.slice() : ['OK', 'NOK', 'N/A'], cfg_ok: it.cfg_ok || _cfg(), cfg_nok: it.cfg_nok || _cfg('nao', 'nao', true), cfg_na: it.cfg_na || _cfg() }));
  const cats = (await db.list('op_categorias')).filter(c => c.ativo !== false && c.tipo_slug === 'checklist');
  const catOpt = `<option value="">—</option>` + cats.map(c => `<option ${c.nome === C.categoria ? 'selected' : ''}>${c.nome}</option>`).join('');
  mount(`
    <div class="rna-card mb-3"><div class="rna-card__body d-flex align-items-center gap-2">
      <i class="bi bi-ui-checks" style="font-size:20px;color:var(--rna-yellow-600)"></i><b>${isNew ? 'Novo checklist' : 'Editar checklist'}</b>
      <span class="text-muted-2 ms-1" style="font-size:12.5px">Construtor visual — monte exatamente o que o auditor verá.</span></div></div>
    <div class="row g-3">
      <div class="col-lg-7">
        <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-info-circle"></i> Informações gerais</h3></div><div class="rna-card__body"><div class="row g-3">
          <div class="col-md-8"><label class="form-label">Nome *</label><input class="form-control" data-c="nome" value="${esc(C.nome)}"></div>
          <div class="col-md-4"><label class="form-label">Categoria</label><div class="d-flex gap-1"><select class="form-select" data-c="categoria">${catOpt}</select><button class="rna-btn rna-btn-ghost" id="add-cat" title="Nova categoria"><i class="bi bi-plus-lg"></i></button></div></div>
          <div class="col-12"><label class="form-label">Descrição</label><input class="form-control" data-c="descricao" value="${esc(C.descricao)}"></div>
          <div class="col-12 d-flex gap-4 flex-wrap">
            <label class="form-check"><input type="checkbox" class="form-check-input" data-c="obrigatoria" ${C.obrigatoria ? 'checked' : ''}> <span class="ms-1">Obrigatório</span></label>
            <label class="form-check"><input type="checkbox" class="form-check-input" data-c="publicar" ${C.status === 'publicada' ? 'checked' : ''}> <span class="ms-1">Publicar</span></label>
          </div>
        </div></div></div>
        <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-card-checklist"></i> Itens do checklist</h3><button class="rna-btn rna-btn-primary rna-btn-sm" id="add-item"><i class="bi bi-plus-lg"></i> Adicionar Item</button></div>
          <div class="rna-card__body" id="chk-itens"></div></div>
        <div class="d-flex gap-2 justify-content-end mb-4"><button class="rna-btn rna-btn-ghost" id="ed-cancel">Cancelar</button><button class="rna-btn rna-btn-primary rna-btn-lg" id="ed-save"><i class="bi bi-check2"></i> Salvar checklist</button></div>
      </div>
      <div class="col-lg-5"><div class="op-preview-wrap"><div class="op-preview__label"><i class="bi bi-eye"></i> Prévia — visão do auditor</div><div id="chk-preview"></div></div></div>
    </div>`);
  $$('[data-c]').forEach(inp => { const ev = inp.type === 'checkbox' || inp.tagName === 'SELECT' ? 'change' : 'input'; inp.addEventListener(ev, () => { const f = inp.dataset.c; if (f === 'publicar') C.status = inp.checked ? 'publicada' : 'rascunho'; else C[f] = inp.type === 'checkbox' ? inp.checked : inp.value; renderChkPreview(); }); });
  $('#add-cat').addEventListener('click', () => novaCategoria('checklist'));
  $('#add-item').addEventListener('click', () => itemModal(null));
  $('#ed-cancel').addEventListener('click', () => { state.view = 'lista'; render(); });
  $('#ed-save').addEventListener('click', () => salvarChecklist(isNew));
  renderChkItens(); renderChkPreview();
}

function renderChkItens() {
  const box = $('#chk-itens'); if (!box) return;
  box.innerHTML = edItens.length ? edItens.map((it, i) => `<div class="op-item" data-irow="${i}">
      <div class="op-item__main"><b>${esc(it.nome)}</b><div class="op-item__resp">${it.respostas.map(r => `<span class="rna-badge ${r === 'OK' ? 'badge-ok' : r === 'NOK' ? 'badge-crit' : 'badge-na'}">${r}</span>`).join(' ')}</div></div>
      <div class="d-flex gap-1"><button class="rna-icon-mini" data-iup="${i}"><i class="bi bi-chevron-up"></i></button><button class="rna-icon-mini" data-idown="${i}"><i class="bi bi-chevron-down"></i></button><button class="rna-icon-mini" data-iedit="${i}"><i class="bi bi-pencil"></i></button><button class="rna-icon-mini" data-idel="${i}"><i class="bi bi-trash text-danger"></i></button></div>
    </div>`).join('') : `<div class="empty-state" style="padding:22px"><i class="bi bi-inbox"></i><div>Nenhum item. Clique em “Adicionar Item”.</div></div>`;
  $$('[data-iedit]', box).forEach(b => b.addEventListener('click', () => itemModal(+b.dataset.iedit)));
  $$('[data-idel]', box).forEach(b => b.addEventListener('click', () => { edItens.splice(+b.dataset.idel, 1); renderChkItens(); renderChkPreview(); }));
  $$('[data-iup]', box).forEach(b => b.addEventListener('click', () => { const i = +b.dataset.iup; if (i > 0) { [edItens[i - 1], edItens[i]] = [edItens[i], edItens[i - 1]]; renderChkItens(); renderChkPreview(); } }));
  $$('[data-idown]', box).forEach(b => b.addEventListener('click', () => { const i = +b.dataset.idown; if (i < edItens.length - 1) { [edItens[i + 1], edItens[i]] = [edItens[i], edItens[i + 1]]; renderChkItens(); renderChkPreview(); } }));
}

function itemModal(idx) {
  const it = idx == null ? { nome: '', respostas: ['OK', 'NOK', 'N/A'], cfg_ok: _cfg(), cfg_nok: _cfg('nao', 'nao', true), cfg_na: _cfg() } : clone(edItens[idx]);
  const pairs = [['OK', 'OK', false], ['NOK', 'NOK', true], ['N/A', 'NA', true]];
  const cfgOf = r => r === 'OK' ? it.cfg_ok : r === 'NOK' ? it.cfg_nok : it.cfg_na;
  const cfgBlock = ([resp, key, pend]) => { const cfg = cfgOf(resp); return `<div class="op-cfg">
      <div class="op-cfg__title"><span class="rna-badge ${resp === 'OK' ? 'badge-ok' : resp === 'NOK' ? 'badge-crit' : 'badge-na'}">${resp}</span></div>
      <div class="mb-2"><label class="form-label">Observação</label><div class="op-radios">${DATA.OP_EXEC_OPCOES.map(o => `<label class="op-radio2"><input type="radio" name="obs-${key}" value="${o.slug}" ${o.slug === cfg.observacao ? 'checked' : ''}> ${o.nome}</label>`).join('')}</div></div>
      <div class="mb-2"><label class="form-label">Foto</label><div class="op-radios">${DATA.OP_EXEC_OPCOES.map(o => `<label class="op-radio2"><input type="radio" name="foto-${key}" value="${o.slug}" ${o.slug === cfg.foto ? 'checked' : ''}> ${o.nome}</label>`).join('')}</div></div>
      ${pend ? `<label class="form-check"><input type="checkbox" class="form-check-input" name="pend-${key}" ${cfg.criar_pendencia ? 'checked' : ''}> <span class="ms-1">Criar pendência automaticamente</span></label>` : ''}
    </div>`; };
  const m = modal({
    title: idx == null ? 'Adicionar item' : 'Editar item', size: 'modal-lg', content: `
    <div class="mb-3"><label class="form-label">Nome do item *</label><input class="form-control" id="it-nome" value="${esc(it.nome)}" placeholder="Ex.: Devolução"></div>
    <label class="form-label">Respostas permitidas</label>
    <div class="d-flex gap-3 mb-3">${pairs.map(([r, key]) => `<label class="form-check"><input type="checkbox" class="form-check-input" id="rp-${key}" ${it.respostas.includes(r) ? 'checked' : ''}> <span class="ms-1">${r}</span></label>`).join('')}</div>
    <div class="op-cfg-grid">${pairs.map(cfgBlock).join('')}</div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button><button class="rna-btn rna-btn-primary" id="it-ok"><i class="bi bi-check2"></i> Salvar item</button>`
  });
  $('#it-ok', m.host).addEventListener('click', () => {
    const nome = $('#it-nome', m.host).value.trim(); if (!nome) return toast('Informe o nome do item.', { type: 'warn' });
    const resp = pairs.filter(([, key]) => m.host.querySelector(`#rp-${key}`)?.checked).map(([r]) => r);
    if (!resp.length) return toast('Selecione ao menos uma resposta.', { type: 'warn' });
    const readCfg = key => ({ observacao: (m.host.querySelector(`input[name="obs-${key}"]:checked`) || {}).value || 'nao', foto: (m.host.querySelector(`input[name="foto-${key}"]:checked`) || {}).value || 'nao', criar_pendencia: !!(m.host.querySelector(`input[name="pend-${key}"]`) || {}).checked });
    const novo = { nome, respostas: resp, cfg_ok: readCfg('OK'), cfg_nok: readCfg('NOK'), cfg_na: readCfg('NA') };
    if (idx == null) edItens.push(novo); else edItens[idx] = novo;
    m.close(); renderChkItens(); renderChkPreview();
  });
}

function renderChkPreview() {
  const box = $('#chk-preview'); if (!box) return;
  box.innerHTML = `<div class="rna-card mb-2"><div class="rna-card__body"><b style="font-size:15px">${esc(C.nome) || 'Nome do checklist'}</b><div class="cell-sub">${edItens.length} ${edItens.length === 1 ? 'item' : 'itens'}</div></div></div>
    ${edItens.length ? edItens.map((it, i) => `<div class="rna-card mb-2"><div class="rna-card__body">
        <b>${esc(it.nome) || 'Item'}</b>
        <div class="seg-btn mt-2">${it.respostas.map(r => `<button type="button" data-pvresp="${i}|${r}">${r}</button>`).join('')}</div>
        <div id="pvi-${i}"></div>
      </div></div>`).join('') : `<div class="empty-state" style="padding:22px"><i class="bi bi-inbox"></i><div>Adicione itens para ver a prévia.</div></div>`}`;
  $$('[data-pvresp]', box).forEach(b => b.addEventListener('click', () => {
    const [i, r] = b.dataset.pvresp.split('|'); const it = edItens[+i]; const cfg = r === 'OK' ? it.cfg_ok : r === 'NOK' ? it.cfg_nok : it.cfg_na;
    const seg = b.closest('.seg-btn'); seg.querySelectorAll('button').forEach(x => x.className = ''); b.className = r === 'OK' ? 'sel-ok' : r === 'NOK' ? 'sel-nok' : 'sel-na';
    $(`#pvi-${i}`).innerHTML = pvAnswerModal(r, cfg);
  }));
}
function pvAnswerModal(r, cfg) {
  if (cfg.observacao === 'nao' && cfg.foto === 'nao' && !cfg.criar_pendencia) return `<div class="text-muted-2 mt-2" style="font-size:12px">Resposta ${r} registrada.</div>`;
  const obs = cfg.observacao === 'nao' ? '' : `<div class="mb-1"><label class="form-label">Observação ${cfg.observacao === 'obrigatoria' ? '<span class="text-danger">*</span>' : ''}</label><textarea class="form-control form-control-sm" rows="2" placeholder="${cfg.observacao === 'obrigatoria' ? 'Obrigatória' : 'Opcional'}"></textarea></div>`;
  const foto = cfg.foto === 'nao' ? '' : `<div class="mb-1"><label class="form-label">Foto ${cfg.foto === 'obrigatoria' ? '<span class="text-danger">*</span>' : ''}</label><div class="d-flex gap-2"><button class="rna-btn rna-btn-ghost rna-btn-sm"><i class="bi bi-folder2-open"></i> Arquivo</button><button class="rna-btn rna-btn-dark rna-btn-sm"><i class="bi bi-camera-fill"></i> Câmera</button></div></div>`;
  const pend = cfg.criar_pendencia ? `<div class="rna-badge badge-warn mt-1"><i class="bi bi-exclamation-circle"></i> Gera pendência automática</div>` : '';
  return `<div class="op-preview-modal mt-2"><div class="op-preview-modal__head">${r}</div><div class="op-preview-modal__body">${obs}${foto}${pend}</div><div class="op-preview-modal__foot"><button class="rna-btn rna-btn-ghost rna-btn-sm">Cancelar</button><button class="rna-btn rna-btn-primary rna-btn-sm">Confirmar</button></div></div>`;
}

async function salvarChecklist(isNew) {
  if (!C.nome.trim()) return toast('Informe o nome do checklist.', { type: 'warn' });
  if (!edItens.length) return toast('Adicione ao menos um item.', { type: 'warn' });
  const patch = { tipo_slug: 'checklist', nome: C.nome.trim(), categoria: C.categoria || '', descricao: C.descricao || '', obrigatoria: !!C.obrigatoria, status: C.status || 'rascunho', responsavel: C.responsavel || 'todos', frequencia: C.frequencia || 'Diária', planta: C.planta || '', turno: C.turno || '', updated_at: ATIV.hoje() };
  let ativ;
  if (isNew) ativ = await db.insert('op_atividades', { ...patch, is_template: false, anexos: [], created_by: USER.id, created_at: ATIV.hoje() });
  else ativ = await db.update('op_atividades', state.ativId, patch);
  await substituir('op_atividade_itens', ativ.id, edItens, (it, ord) => ({ atividade_id: ativ.id, ordem: ord, nome: it.nome, tipo_resposta: 'oknokna', respostas: it.respostas, cfg_ok: it.cfg_ok, cfg_nok: it.cfg_nok, cfg_na: it.cfg_na, peso: 1 }));
  await gerarAtribuicao(ativ.id, C);
  await upsertAgenda(ativ.id, C.frequencia);
  await db.log({ usuario: USER.nome, acao: `${isNew ? 'Criou' : 'Editou'} checklist ${ativ.nome}`, entidade: 'op_atividades', antes: isNew ? '—' : '', depois: ativ.status });
  toast(isNew ? 'Checklist criado.' : 'Checklist salvo.', { type: 'ok', title: 'Gestão Operacional' });
  state.view = 'lista'; render();
}

/* --------------- helpers: atribuição/agenda a partir dos campos simples ---- */
async function gerarAtribuicao(ativId, src) {
  for (const o of await db.list('op_atribuicoes', { filter: { atividade_id: ativId } })) await db.remove('op_atribuicoes', o.id);
  let rule;
  if (src.responsavel && src.responsavel !== 'todos') rule = { alvo_tipo: 'usuario', alvo_valor: src.responsavel, planta: '', turno: '', prioridade: 100 };
  else if (src.planta || src.turno) rule = { alvo_tipo: 'planta_turno', alvo_valor: '', planta: src.planta || '', turno: src.turno || '', prioridade: 10 };
  else rule = { alvo_tipo: 'cargo', alvo_valor: 'auditor', planta: '', turno: '', prioridade: 50 };
  await db.insert('op_atribuicoes', { atividade_id: ativId, ...rule });
}
async function upsertAgenda(ativId, frequencia) {
  for (const g of await db.list('op_agenda', { filter: { atividade_id: ativId } })) await db.remove('op_agenda', g.id);
  await db.insert('op_agenda', { atividade_id: ativId, tipo: ATIV.agendaDeFrequencia(frequencia), dias: [], intervalo_horas: null, ref: '' });
}
async function substituir(tabela, ativId, itens, mapFn) {
  for (const o of await db.list(tabela, { filter: { atividade_id: ativId } })) await db.remove(tabela, o.id);
  let ord = 1; for (const it of itens) await db.insert(tabela, mapFn(it, ord++));
}

/* --------------------------------------------- ações da lista / catálogos -- */
async function duplicar(id) {
  const a = await db.get('op_atividades', id); if (!a) return;
  const { id: _i, ...base } = a;
  const nova = await db.insert('op_atividades', { ...base, codigo: (a.codigo || '') + '-COPIA', nome: a.nome + ' (cópia)', status: 'rascunho', is_template: false, created_by: USER.id, created_at: ATIV.hoje(), updated_at: ATIV.hoje() });
  for (const it of await ATIV.itens(id)) { const { id: _x, atividade_id: _y, ...r } = it; await db.insert('op_atividade_itens', { ...r, atividade_id: nova.id }); }
  for (const at of await db.list('op_atribuicoes', { filter: { atividade_id: id } })) { const { id: _x, atividade_id: _y, ...r } = at; await db.insert('op_atribuicoes', { ...r, atividade_id: nova.id }); }
  for (const ag of await db.list('op_agenda', { filter: { atividade_id: id } })) { const { id: _x, atividade_id: _y, ...r } = ag; await db.insert('op_agenda', { ...r, atividade_id: nova.id }); }
  toast('Atividade duplicada.', { type: 'ok' }); render();
}
async function toggleArquivo(id) {
  const a = await db.get('op_atividades', id); if (!a) return;
  await db.update('op_atividades', id, { status: a.status === 'arquivada' ? 'publicada' : 'arquivada', updated_at: ATIV.hoje() });
  toast(a.status === 'arquivada' ? 'Publicada.' : 'Arquivada.', { type: 'ok' }); render();
}
function excluir(id) {
  confirmDialog('Excluir esta atividade e seus itens/atribuições? Não pode ser desfeito.', async () => {
    for (const t of ['op_atividade_itens', 'op_atribuicoes', 'op_agenda']) { for (const r of await db.list(t, { filter: { atividade_id: id } })) await db.remove(t, r.id); }
    await db.remove('op_atividades', id); toast('Atividade excluída.', { type: 'ok' }); render();
  }, { title: 'Excluir', okLabel: 'Excluir', danger: true });
}
function novaCategoria(tipo = 'rotina') {
  const m = modal({ title: 'Nova categoria', content: `<label class="form-label">Nome da categoria (${TIPO_LABEL[tipo].sing})</label><input class="form-control" id="nc-nome" placeholder="Ex.: Segurança">`, footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button><button class="rna-btn rna-btn-primary" id="nc-ok">Adicionar</button>` });
  $('#nc-ok', m.host).addEventListener('click', async () => { const nome = $('#nc-nome', m.host).value.trim(); if (!nome) return; await db.insert('op_categorias', { nome, tipo_slug: tipo, ativo: true }); m.close(); toast('Categoria adicionada.', { type: 'ok' }); render(); });
}

async function renderCategorias() {
  const rows = await db.list('op_categorias');
  mount(`<div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-tags"></i> Categorias <span class="rna-badge badge-info">${rows.length}</span></h3></div>
    <div class="rna-card__body p-0" style="overflow:auto"><table class="rna-table"><thead><tr><th>Nome</th><th>Tipo</th><th>Ativo</th><th></th></tr></thead>
      <tbody>${rows.map(c => `<tr><td class="cell-strong">${c.nome}</td><td>${c.tipo_slug}</td><td>${c.ativo !== false ? 'Sim' : 'Não'}</td>
        <td class="text-end">${CAN_DELETE ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-cdel="${c.id}"><i class="bi bi-trash text-danger"></i></button>` : ''}</td></tr>`).join('') || emptyRow(4)}</tbody></table></div></div>`,
    CAN_EDIT ? `<button class="rna-btn rna-btn-primary" id="btn-cat"><i class="bi bi-plus-lg"></i> Nova categoria</button>` : '');
  $('#btn-cat')?.addEventListener('click', () => novaCategoria('rotina'));
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
      <tbody>${atrs.map(r => `<tr><td class="cell-strong">${aBy[r.atividade_id]?.nome || '—'}</td><td>${alvoTxt(r)}</td><td>${r.prioridade}</td></tr>`).join('') || emptyRow(3)}</tbody></table></div>
    <div class="rna-card__body"><small class="text-muted-2">Geradas automaticamente pelo bloco “Onde será executada” de cada construtor. Prioridade: usuário 100 › cargo 50 › planta+turno 10.</small></div></div>`);
}
async function renderAgendaOverview() {
  const [ags, ativs] = await Promise.all([db.list('op_agenda'), db.list('op_atividades')]);
  const aBy = Object.fromEntries(ativs.map(a => [a.id, a]));
  mount(`<div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-calendar-week"></i> Agenda <span class="rna-badge badge-info">${ags.length}</span></h3></div>
    <div class="rna-card__body p-0" style="overflow:auto"><table class="rna-table"><thead><tr><th>Atividade</th><th>Recorrência</th></tr></thead>
      <tbody>${ags.map(g => `<tr><td class="cell-strong">${aBy[g.atividade_id]?.nome || '—'}</td><td>${agLabel(g.tipo)}</td></tr>`).join('') || emptyRow(2)}</tbody></table></div>
    <div class="rna-card__body"><small class="text-muted-2">Definida pela Frequência de cada rotina/checklist.</small></div></div>`);
}
async function renderTemplates() {
  const tpls = (await db.list('op_atividades')).filter(a => a.is_template);
  mount(`<div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-files"></i> Templates <span class="rna-badge badge-info">${tpls.length}</span></h3></div>
    <div class="rna-card__body">${tpls.length ? `<div class="row g-3">${tpls.map(t => `<div class="col-md-4"><div class="rna-card h-100"><div class="rna-card__body">
      <b>${t.nome}</b><div class="cell-sub mb-2">${t.categoria || ''}</div>
      ${CAN_EDIT ? `<button class="rna-btn rna-btn-primary rna-btn-sm" data-usetpl="${t.id}"><i class="bi bi-plus-lg"></i> Criar a partir deste</button>` : ''}</div></div></div>`).join('')}</div>` : `<div class="empty-state"><i class="bi bi-inbox"></i><div>Nenhum template.</div></div>`}</div></div>`);
  $$('[data-usetpl]').forEach(b => b.addEventListener('click', async () => { await duplicarComoRotina(b.dataset.usetpl); }));
}
async function duplicarComoRotina(id) {
  const a = await db.get('op_atividades', id); const { id: _i, ...base } = a;
  const nova = await db.insert('op_atividades', { ...base, is_template: false, status: 'rascunho', nome: a.nome.replace(/^Template — /, ''), codigo: '', created_by: USER.id, created_at: ATIV.hoje(), updated_at: ATIV.hoje() });
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
function agLabel(t) { return { diaria: 'Diária', dia_semana: 'Dias da semana', semanal: 'Semanal', mensal: 'Mensal', por_turno: 'Por turno', sob_demanda: 'Sob demanda', a_cada_x_horas: 'A cada X horas' }[t] || t; }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function esc(s) { return String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function emptyRow(cols) { return `<tr><td colspan="${cols}"><div class="empty-state"><i class="bi bi-inbox"></i><div>Sem registros.</div></div></td></tr>`; }
