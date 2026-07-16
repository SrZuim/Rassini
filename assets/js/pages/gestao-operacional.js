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
import * as ROT from '../../../services/rotinas.js';
import { charts, PALETTE } from '../charts.js';
import { $, $$, el, toast, modal, confirmDialog } from '../ui.js';

let USER, CAN_EDIT, CAN_DELETE;
const state = { tab: 'rotinas', view: 'lista', ativId: null, modeloId: null };
const ABAS = [
  ['rotinas', 'bi-list-check', 'Rotinas'], ['modelos', 'bi-diagram-3-fill', 'Modelos de Rotina'], ['checklists', 'bi-ui-checks', 'Checklists'], ['categorias', 'bi-tags', 'Categorias'], ['tipos', 'bi-collection', 'Tipos de Atividades'],
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
  if (state.tab === 'modelos') return state.view === 'editor' ? renderBuilderModelo() : renderModelos();
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

/* ======================= MODELOS DE ROTINA (§22) ===========================
   Área de CONFIGURAÇÃO: o administrador define itens, unidades, especificações,
   validações e frequências. O auditor só executa (Minhas Rotinas). */
async function renderModelos() {
  const mods = await ROT.listarModelos({ incluirInativos: true });
  const itensAll = await db.list('op_atividade_itens');
  const nItens = id => itensAll.filter(i => i.atividade_id === id && i.ativo !== false).length;

  const card = m => `<div class="col-md-6 col-xl-4"><div class="rna-card h-100 op-modelo-card">
    <div class="rna-card__body">
      <div class="d-flex justify-content-between align-items-start mb-1">
        <span class="op-code">${esc(m.codigo || '—')}</span>
        <span class="rna-badge ${m.status === 'publicada' ? 'badge-ok' : m.status === 'arquivada' ? 'badge-na' : 'badge-warn'}">${m.status === 'publicada' ? 'Ativo' : m.status === 'arquivada' ? 'Inativo' : 'Rascunho'}</span>
      </div>
      <b style="font-size:15px">${esc(m.nome)}</b>
      <div class="cell-sub" style="min-height:32px">${esc(m.descricao || '')}</div>
      <div class="op-item__resp mt-1">
        <span><i class="bi bi-tag"></i> ${esc(m.categoria || '—')}</span>
        <span><i class="bi bi-list-ol"></i> ${nItens(m.id)} ${nItens(m.id) === 1 ? 'item' : 'itens'}</span>
        <span><i class="bi bi-arrow-repeat"></i> ${esc(m.frequencia || '—')}</span>
        <span title="Versão do modelo"><i class="bi bi-clock-history"></i> v${m.versao || 1}</span>
      </div>
      <div class="cell-sub mt-1"><i class="bi bi-pencil"></i> ${esc(m.updated_at || '—')}${m.updated_by ? ` · ${esc(nomeUser(m.updated_by))}` : ''}</div>
      <div class="d-flex flex-wrap gap-1 mt-3">
        <button class="rna-btn rna-btn-ghost rna-btn-sm" data-mver="${m.id}"><i class="bi bi-eye"></i> Ver</button>
        ${CAN_EDIT ? `<button class="rna-btn rna-btn-primary rna-btn-sm" data-medit="${m.id}"><i class="bi bi-pencil"></i> Editar</button>
        <button class="rna-btn rna-btn-ghost rna-btn-sm" data-mdup="${m.id}" title="Duplicar"><i class="bi bi-files"></i></button>
        <button class="rna-btn rna-btn-ghost rna-btn-sm" data-mtoggle="${m.id}" title="${m.status === 'arquivada' ? 'Ativar' : 'Desativar'}"><i class="bi ${m.status === 'arquivada' ? 'bi-toggle-off' : 'bi-toggle-on'}"></i></button>` : ''}
        ${CAN_DELETE ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-mdel="${m.id}" title="Excluir"><i class="bi bi-trash text-danger"></i></button>` : ''}
      </div>
    </div></div></div>`;

  mount(`
    <div class="rna-card mb-3"><div class="rna-card__body d-flex flex-wrap align-items-center gap-2">
      <i class="bi bi-info-circle" style="color:var(--rna-info)"></i>
      <span class="flex-fill" style="font-size:13px">Modelos padronizados de rotina. O que você configura aqui é <b>somente leitura</b> na execução do auditor: limites, especificações, unidades e regras não podem ser alterados em Minhas Rotinas.</span>
    </div></div>
    ${mods.length ? `<div class="row g-3">${mods.map(card).join('')}</div>`
      : `<div class="empty-state" style="padding:40px"><i class="bi bi-diagram-3"></i>
          <div>Nenhum modelo cadastrado.</div>
          ${CAN_EDIT ? `<div class="cell-sub mt-1">Instale os modelos padrão (SP1–SP5, Magnaflux, Temperatura e Umidade) ou crie o seu.</div>` : ''}</div>`}`,
    CAN_EDIT ? `<button class="rna-btn rna-btn-ghost" id="btn-seed"><i class="bi bi-download"></i> Instalar modelos padrão</button>
                <button class="rna-btn rna-btn-primary" id="btn-novo-mod"><i class="bi bi-plus-lg"></i> Novo modelo</button>` : '');

  $('#btn-seed')?.addEventListener('click', instalarPadrao);
  $('#btn-novo-mod')?.addEventListener('click', () => { state.modeloId = null; state.view = 'editor'; render(); });
  $$('[data-medit]').forEach(b => b.addEventListener('click', () => { state.modeloId = b.dataset.medit; state.view = 'editor'; render(); }));
  $$('[data-mver]').forEach(b => b.addEventListener('click', () => verModelo(b.dataset.mver)));
  $$('[data-mdup]').forEach(b => b.addEventListener('click', async () => {
    try { const n = await ROT.duplicarModelo(b.dataset.mdup, USER); toast(`Modelo duplicado como ${n.codigo}.`, { type: 'ok' }); render(); }
    catch (e) { erro('Não foi possível duplicar o modelo', e); }
  }));
  $$('[data-mtoggle]').forEach(b => b.addEventListener('click', async () => {
    const m = await db.get('op_atividades', b.dataset.mtoggle);
    const novo = m.status === 'arquivada' ? 'publicada' : 'arquivada';
    try {
      await db.update('op_atividades', m.id, { status: novo, updated_at: ATIV.hoje(), updated_by: USER.id });
      toast(novo === 'publicada' ? 'Modelo ativado.' : 'Modelo desativado.', { type: 'ok' }); render();
    } catch (e) { erro('Não foi possível alterar o status', e); }
  }));
  $$('[data-mdel]').forEach(b => b.addEventListener('click', () => excluirModelo(b.dataset.mdel)));
}

async function instalarPadrao() {
  const btn = $('#btn-seed'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Instalando...'; }
  try {
    const criados = await ROT.garantirModelosPadrao(USER);
    toast(criados.length ? `${criados.length} modelo(s) instalado(s): ${criados.join(', ')}.` : 'Todos os modelos padrão já estão instalados — nada foi duplicado.',
      { type: 'ok', title: 'Modelos padrão', timeout: 6000 });
    render();
  } catch (e) { erro('Não foi possível instalar os modelos padrão', e); if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-download"></i> Instalar modelos padrão'; } }
}

/* Erro real no console + mensagem legível (nunca "erro genérico"). */
function erro(titulo, e) {
  console.error(`[GESTAO-OP] ${titulo}:`, { message: e?.message, code: e?.code, details: e?.details, hint: e?.hint });
  const migration = /column .* does not exist|schema cache|PGRST204/i.test(`${e?.message} ${e?.code}`);
  toast(migration
    ? 'Erro de configuração do banco: rode database/rotinas_inteligentes.sql no Supabase.'
    : `${titulo}: ${e?.message || 'erro desconhecido'}`, { type: 'crit', title: titulo, timeout: 9000 });
}

let USERS_CACHE = [];
const nomeUser = id => USERS_CACHE.find(u => u.id === id)?.nome || id;

async function verModelo(id) {
  const m = await ROT.modelo(id);
  const itens = await ROT.itensDoModelo(id);
  modal({
    title: `${m.codigo} — ${m.nome}`, size: 'modal-xl',
    content: `<div class="op-item__resp mb-2"><span><i class="bi bi-tag"></i> ${esc(m.categoria || '—')}</span><span><i class="bi bi-arrow-repeat"></i> ${esc(m.frequencia || '—')}</span><span><i class="bi bi-clock-history"></i> versão ${m.versao || 1}</span><span><i class="bi bi-list-ol"></i> ${itens.length} itens</span></div>
      <p class="cell-sub">${esc(m.descricao || '')}</p>
      <div class="rna-table-wrap"><table class="rna-table"><thead><tr><th>#</th><th>Item</th><th>Unid.</th><th>Especificação</th><th>Validação</th><th>Frequência</th><th>Obrig.</th><th>Condição</th></tr></thead><tbody>
      ${itens.map((it, i) => `<tr>
        <td>${i + 1}</td><td class="cell-strong">${esc(it.nome)}</td>
        <td>${esc(it.unidade_simbolo || it.unidade || '—')}</td>
        <td>${esc(ROT.especificacaoTexto(it))}</td>
        <td class="cell-sub">${esc(ROT.TIPOS_VALIDACAO_MAP[it.tipo_validacao]?.nome || it.tipo_validacao || '—')}</td>
        <td class="cell-sub">${esc(ROT.FREQUENCIAS_ITEM_MAP[it.frequencia_item]?.nome || '—')}</td>
        <td>${it.obrigatorio ? '<span class="rna-badge badge-crit">Sim</span>' : '<span class="rna-badge badge-na">Não</span>'}</td>
        <td class="cell-sub">${it.regra_condicional ? esc(`${it.regra_condicional.campo} = ${it.regra_condicional.igual}`) : '—'}</td>
      </tr>`).join('')}
      </tbody></table></div>`,
    footer: `<button class="rna-btn rna-btn-primary" data-bs-dismiss="modal">Fechar</button>`
  });
}

function excluirModelo(id) {
  confirmDialog('Excluir este modelo e seus itens? As rotinas que o utilizam deixarão de carregar os itens. As execuções já realizadas mantêm o histórico (snapshot).',
    async () => {
      try {
        const emUso = (await db.list('op_atividades')).filter(a => a.modelo_id === id);
        if (emUso.length) return toast(`Não é possível excluir: ${emUso.length} rotina(s) usam este modelo. Desative-o.`, { type: 'warn', title: 'Modelo em uso', timeout: 8000 });
        for (const it of await db.list('op_atividade_itens', { filter: { atividade_id: id } })) await db.remove('op_atividade_itens', it.id);
        await db.remove('op_atividades', id);
        toast('Modelo excluído.', { type: 'ok' }); render();
      } catch (e) { erro('Não foi possível excluir o modelo', e); }
    }, { title: 'Excluir modelo', okLabel: 'Excluir', danger: true });
}

/* ---------------------- CONSTRUTOR DE MODELO (itens) ---------------------- */
let M = {}, mItens = [];
async function renderBuilderModelo() {
  const isNew = !state.modeloId;
  let m = { codigo: '', nome: '', descricao: '', categoria: '', frequencia: 'Diária', horario: '', status: 'rascunho', versao: 1 };
  if (!isNew) m = await ROT.modelo(state.modeloId) || m;
  M = { ...m };
  mItens = isNew ? [] : (await ROT.itensDoModelo(state.modeloId)).map(clone);
  const cats = (await db.list('op_categorias')).filter(c => c.ativo !== false && c.tipo_slug === 'rotina');
  const catOpt = `<option value="">—</option>` + cats.map(c => `<option ${c.nome === M.categoria ? 'selected' : ''}>${esc(c.nome)}</option>`).join('');
  const freqOpt = DATA.OP_FREQUENCIAS.map(f => `<option ${f === M.frequencia ? 'selected' : ''}>${f}</option>`).join('');

  mount(`
    <div class="rna-card mb-3"><div class="rna-card__body d-flex align-items-center gap-2">
      <i class="bi bi-diagram-3-fill" style="font-size:20px;color:var(--rna-yellow-600)"></i><b>${isNew ? 'Novo modelo de rotina' : `Editar modelo · ${esc(M.codigo)}`}</b>
      ${!isNew ? `<span class="rna-badge badge-info ms-1">versão ${M.versao || 1}</span>` : ''}
      <span class="text-muted-2 ms-1" style="font-size:12.5px">Configuração — define o que o auditor verá e como o resultado é calculado.</span></div></div>
    <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-info-circle"></i> Informações gerais</h3></div><div class="rna-card__body"><div class="row g-3">
      <div class="col-md-3"><label class="form-label">Código *</label><input class="form-control" data-m="codigo" value="${esc(M.codigo)}" placeholder="Ex.: SP6"><small class="text-muted-2">Único. Usado na seleção.</small></div>
      <div class="col-md-5"><label class="form-label">Nome do modelo *</label><input class="form-control" data-m="nome" value="${esc(M.nome)}" placeholder="Ex.: SP6"></div>
      <div class="col-md-4"><label class="form-label">Categoria</label><select class="form-select" data-m="categoria">${catOpt}</select></div>
      <div class="col-md-8"><label class="form-label">Descrição</label><input class="form-control" data-m="descricao" value="${esc(M.descricao)}"></div>
      <div class="col-md-2"><label class="form-label">Frequência</label><select class="form-select" data-m="frequencia">${freqOpt}</select></div>
      <div class="col-md-2"><label class="form-label">Horário padrão</label><input type="time" class="form-control" data-m="horario" value="${esc(M.horario)}"></div>
      <div class="col-12"><label class="form-check"><input type="checkbox" class="form-check-input" data-m="publicar" ${M.status === 'publicada' ? 'checked' : ''}> <span class="ms-1">Ativo (disponível para seleção)</span></label></div>
    </div></div></div>
    <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-list-ol"></i> Itens do modelo <span class="rna-badge badge-info" id="mi-count">${mItens.length}</span></h3>
      <button class="rna-btn rna-btn-primary rna-btn-sm" id="mi-add"><i class="bi bi-plus-lg"></i> Adicionar item</button></div>
      <div class="rna-card__body p-0" id="mi-lista"></div></div>
    <div class="d-flex gap-2 justify-content-end mb-4">
      <button class="rna-btn rna-btn-ghost" id="m-cancel">Cancelar</button>
      <button class="rna-btn rna-btn-primary rna-btn-lg" id="m-save"><i class="bi bi-check2"></i> Salvar modelo</button></div>`);

  $$('[data-m]').forEach(inp => {
    const ev = inp.type === 'checkbox' || inp.tagName === 'SELECT' ? 'change' : 'input';
    inp.addEventListener(ev, () => {
      const f = inp.dataset.m;
      if (f === 'publicar') M.status = inp.checked ? 'publicada' : 'rascunho';
      else M[f] = inp.value;
    });
  });
  $('#mi-add').addEventListener('click', () => itemModeloModal(null));
  $('#m-cancel').addEventListener('click', () => { state.view = 'lista'; render(); });
  $('#m-save').addEventListener('click', () => salvarModelo(isNew));
  renderItensModelo();
}

function renderItensModelo() {
  const box = $('#mi-lista'); if (!box) return;
  $('#mi-count').textContent = mItens.length;
  box.innerHTML = mItens.length ? `<div class="rna-table-wrap"><table class="rna-table"><thead><tr>
      <th style="width:38px">#</th><th>Item</th><th>Tipo</th><th>Unid.</th><th>Especificação</th><th>Frequência</th><th>Obrig.</th><th>Condição</th><th style="width:150px"></th>
    </tr></thead><tbody>
    ${mItens.map((it, i) => `<tr class="${it.ativo === false ? 'op-item-off' : ''}">
      <td class="cell-sub">${i + 1}</td>
      <td class="cell-strong">${esc(it.nome)}${it.contexto_chave ? ' <span class="insp-tipo-tag" title="Alimenta as regras condicionais">contexto</span>' : ''}</td>
      <td class="cell-sub">${esc(ROT.TIPOS_RESPOSTA_MAP[it.tipo_resposta]?.nome || it.tipo_resposta)}</td>
      <td>${esc(it.unidade_simbolo || it.unidade || '—')}</td>
      <td class="cell-sub">${esc(ROT.especificacaoTexto(it))}</td>
      <td class="cell-sub">${esc(ROT.FREQUENCIAS_ITEM_MAP[it.frequencia_item]?.nome || '—')}</td>
      <td>${it.obrigatorio ? '<span class="rna-badge badge-crit">Sim</span>' : '<span class="rna-badge badge-na">Não</span>'}</td>
      <td class="cell-sub">${it.regra_condicional ? esc(String(it.regra_condicional.igual)) : '—'}</td>
      <td class="text-end"><div class="d-flex gap-1 justify-content-end">
        <button class="rna-icon-mini" data-mup="${i}" title="Subir"><i class="bi bi-chevron-up"></i></button>
        <button class="rna-icon-mini" data-mdown="${i}" title="Descer"><i class="bi bi-chevron-down"></i></button>
        <button class="rna-icon-mini" data-medit2="${i}" title="Editar"><i class="bi bi-pencil"></i></button>
        <button class="rna-icon-mini" data-mdup2="${i}" title="Duplicar"><i class="bi bi-files"></i></button>
        <button class="rna-icon-mini" data-mdel2="${i}" title="Excluir"><i class="bi bi-trash text-danger"></i></button>
      </div></td></tr>`).join('')}
    </tbody></table></div>`
    : `<div class="empty-state" style="padding:26px"><i class="bi bi-inbox"></i><div>Nenhum item. Clique em “Adicionar item”.</div></div>`;

  const re = () => { renderItensModelo(); };
  $$('[data-medit2]', box).forEach(b => b.addEventListener('click', () => itemModeloModal(+b.dataset.medit2)));
  $$('[data-mdel2]', box).forEach(b => b.addEventListener('click', () => { mItens.splice(+b.dataset.mdel2, 1); re(); }));
  $$('[data-mdup2]', box).forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.mdup2; const c = clone(mItens[i]); delete c.id; c.nome = `${c.nome} (cópia)`; mItens.splice(i + 1, 0, c); re();
  }));
  $$('[data-mup]', box).forEach(b => b.addEventListener('click', () => { const i = +b.dataset.mup; if (i > 0) { [mItens[i - 1], mItens[i]] = [mItens[i], mItens[i - 1]]; re(); } }));
  $$('[data-mdown]', box).forEach(b => b.addEventListener('click', () => { const i = +b.dataset.mdown; if (i < mItens.length - 1) { [mItens[i + 1], mItens[i]] = [mItens[i], mItens[i + 1]]; re(); } }));
}

/* Modal de item — todos os campos do cadastro inteligente (§13). */
function itemModeloModal(idx) {
  const novo = {
    nome: '', descricao: '', unidade: '', unidade_simbolo: '', tipo_resposta: 'decimal',
    tipo_validacao: 'intervalo', limite_min: null, limite_max: null, valor_nominal: null, valor_esperado: '',
    especificacao_texto: '', frequencia_item: 'diario', obrigatorio: true, permite_obs: true,
    permite_foto: true, exige_foto_nc: false, regra_condicional: null, contexto_chave: null, opcoes: [], ativo: true
  };
  const it = idx == null ? novo : clone(mItens[idx]);
  const sel = (arr, val, key = 'slug', lb = 'nome') => arr.map(o => `<option value="${o[key]}" ${o[key] === val ? 'selected' : ''}>${esc(o[lb])}</option>`).join('');
  const m = modal({
    title: idx == null ? 'Adicionar item' : `Editar item · ${esc(it.nome)}`, size: 'modal-xl',
    content: `<div class="row g-3">
      <div class="col-md-6"><label class="form-label">Nome do item *</label><input class="form-control" id="i-nome" value="${esc(it.nome)}" placeholder="Ex.: Amperagem — Turbina 1"></div>
      <div class="col-md-6"><label class="form-label">Descrição</label><input class="form-control" id="i-desc" value="${esc(it.descricao)}"></div>
      <div class="col-md-3"><label class="form-label">Tipo de resposta *</label><select class="form-select" id="i-tresp">${sel(ROT.TIPOS_RESPOSTA, it.tipo_resposta)}</select></div>
      <div class="col-md-3"><label class="form-label">Unidade</label><input class="form-control" id="i-unid" value="${esc(it.unidade)}" placeholder="Ex.: Ampère"></div>
      <div class="col-md-2"><label class="form-label">Símbolo</label><input class="form-control" id="i-simb" value="${esc(it.unidade_simbolo)}" placeholder="A"></div>
      <div class="col-md-4"><label class="form-label">Frequência do item *</label><select class="form-select" id="i-freq">${sel(ROT.FREQUENCIAS_ITEM, it.frequencia_item)}</select></div>

      <div class="col-md-4"><label class="form-label">Tipo de validação *</label><select class="form-select" id="i-tval">${sel(ROT.TIPOS_VALIDACAO, it.tipo_validacao)}</select></div>
      <div class="col-md-8"><div class="row g-2" id="i-campos"></div></div>

      <div class="col-md-6"><label class="form-label">Especificação exibida</label><input class="form-control" id="i-espec" value="${esc(it.especificacao_texto)}" placeholder="Deixe vazio para gerar automaticamente"><small class="text-muted-2" id="i-espec-hint"></small></div>
      <div class="col-md-6"><label class="form-label">Opções da lista <span class="text-muted-2">(separe por ; )</span></label><input class="form-control" id="i-opcoes" value="${esc((it.opcoes || []).join('; '))}" placeholder="Ex.: Scania; Demais clientes"></div>

      <div class="col-md-6"><label class="form-label">Regra condicional</label>
        <div class="d-flex gap-1">
          <select class="form-select" id="i-cond-campo"><option value="">Sem condição</option><option value="tipo_cliente" ${it.regra_condicional?.campo === 'tipo_cliente' ? 'selected' : ''}>Tipo de cliente</option></select>
          <input class="form-control" id="i-cond-val" value="${esc(it.regra_condicional?.igual || '')}" placeholder="Ex.: Scania">
        </div><small class="text-muted-2">O item só aparece quando o valor informado for igual a este.</small></div>
      <div class="col-md-6"><label class="form-label">Alimenta o contexto</label>
        <select class="form-select" id="i-ctx"><option value="">Não</option><option value="tipo_cliente" ${it.contexto_chave === 'tipo_cliente' ? 'selected' : ''}>Tipo de cliente</option></select>
        <small class="text-muted-2">A resposta deste item liga/desliga os itens condicionais.</small></div>

      <div class="col-12"><div class="d-flex flex-wrap gap-4">
        <label class="form-check"><input type="checkbox" class="form-check-input" id="i-obrig" ${it.obrigatorio ? 'checked' : ''}> <span class="ms-1">Obrigatório</span></label>
        <label class="form-check"><input type="checkbox" class="form-check-input" id="i-obs" ${it.permite_obs ? 'checked' : ''}> <span class="ms-1">Permitir observação</span></label>
        <label class="form-check"><input type="checkbox" class="form-check-input" id="i-foto" ${it.permite_foto ? 'checked' : ''}> <span class="ms-1">Permitir foto</span></label>
        <label class="form-check"><input type="checkbox" class="form-check-input" id="i-fotonc" ${it.exige_foto_nc ? 'checked' : ''}> <span class="ms-1">Exigir foto quando Não Conforme</span></label>
        <label class="form-check"><input type="checkbox" class="form-check-input" id="i-ativo" ${it.ativo !== false ? 'checked' : ''}> <span class="ms-1">Ativo</span></label>
      </div></div>
      <div class="col-12"><div id="i-erros"></div></div>
    </div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button><button class="rna-btn rna-btn-primary" id="i-ok"><i class="bi bi-check2"></i> Salvar item</button>`
  });

  const q = id => $(id, m.host);
  /* Campos do tipo de validação aparecem conforme a regra escolhida (§15). */
  const pintarCampos = () => {
    const tv = q('#i-tval').value;
    const campos = ROT.TIPOS_VALIDACAO_MAP[tv]?.campos || [];
    const inp = (id, lb, val, ph = '') => `<div class="col-md-4"><label class="form-label">${lb} *</label><input class="form-control" id="${id}" value="${val ?? ''}" placeholder="${ph}" inputmode="decimal"></div>`;
    q('#i-campos').innerHTML = [
      campos.includes('limite_min') ? inp('i-min', 'Valor mínimo', it.limite_min ?? '', 'Ex.: 79') : '',
      campos.includes('limite_max') ? inp('i-max', 'Valor máximo', it.limite_max ?? '', 'Ex.: 92') : '',
      campos.includes('valor_esperado') ? `<div class="col-md-4"><label class="form-label">Valor esperado *</label><input class="form-control" id="i-esp" value="${esc(it.valor_esperado)}"></div>` : '',
      `<div class="col-md-4"><label class="form-label">Valor nominal</label><input class="form-control" id="i-nom" value="${it.valor_nominal ?? ''}" inputmode="decimal" placeholder="Opcional"></div>`
    ].join('') || `<div class="col-12"><small class="text-muted-2">Este tipo não exige limites — o item apenas registra a informação.</small></div>`;
    atualizarHint();
  };
  const lerParcial = () => ({
    nome: q('#i-nome').value.trim(), tipo_resposta: q('#i-tresp').value, tipo_validacao: q('#i-tval').value,
    unidade: q('#i-unid').value.trim(), unidade_simbolo: q('#i-simb').value.trim(),
    limite_min: q('#i-min') ? ROT.num(q('#i-min').value) : null,
    limite_max: q('#i-max') ? ROT.num(q('#i-max').value) : null,
    valor_esperado: q('#i-esp') ? q('#i-esp').value.trim() : '',
    especificacao_texto: q('#i-espec').value.trim()
  });
  const atualizarHint = () => {
    const p = lerParcial();
    q('#i-espec-hint').textContent = p.especificacao_texto ? '' : `Gerada automaticamente: “${ROT.especificacaoTexto({ ...p, especificacao_texto: '' })}”`;
  };
  q('#i-tval').addEventListener('change', pintarCampos);
  ['#i-unid', '#i-simb', '#i-espec'].forEach(s => q(s).addEventListener('input', atualizarHint));
  m.host.addEventListener('input', e => { if (['i-min', 'i-max'].includes(e.target.id)) atualizarHint(); });
  pintarCampos();

  q('#i-ok').addEventListener('click', () => {
    const condCampo = q('#i-cond-campo').value, condVal = q('#i-cond-val').value.trim();
    const out = {
      ...it,
      nome: q('#i-nome').value.trim(), descricao: q('#i-desc').value.trim(),
      tipo_resposta: q('#i-tresp').value, unidade: q('#i-unid').value.trim(), unidade_simbolo: q('#i-simb').value.trim(),
      frequencia_item: q('#i-freq').value, tipo_validacao: q('#i-tval').value,
      limite_min: q('#i-min') ? ROT.num(q('#i-min').value) : null,
      limite_max: q('#i-max') ? ROT.num(q('#i-max').value) : null,
      valor_nominal: q('#i-nom') ? ROT.num(q('#i-nom').value) : null,
      valor_esperado: q('#i-esp') ? q('#i-esp').value.trim() : '',
      especificacao_texto: q('#i-espec').value.trim(),
      opcoes: q('#i-opcoes').value.split(';').map(s => s.trim()).filter(Boolean),
      regra_condicional: condCampo && condVal ? { campo: condCampo, igual: condVal } : null,
      contexto_chave: q('#i-ctx').value || null,
      obrigatorio: q('#i-obrig').checked, permite_obs: q('#i-obs').checked,
      permite_foto: q('#i-foto').checked, exige_foto_nc: q('#i-fotonc').checked, ativo: q('#i-ativo').checked
    };
    const erros = ROT.validarItemCadastro(out);
    if (erros.length) {
      q('#i-erros').innerHTML = `<div class="insp-blocker"><i class="bi bi-exclamation-octagon"></i><div>${erros.map(esc).join('<br>')}</div></div>`;
      return;
    }
    if (idx == null) mItens.push(out); else mItens[idx] = out;
    m.close(); renderItensModelo();
  });
}

async function salvarModelo(isNew) {
  const btn = $('#m-save'); if (btn.disabled) return;
  const erros = ROT.validarModeloCadastro(M, mItens);
  if (erros.length) return toast(erros[0], { type: 'warn', title: 'Revise o cadastro' });
  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Salvando...';
  try {
    const codUp = String(M.codigo).trim().toUpperCase();
    const jaExiste = (await ROT.listarModelos({ incluirInativos: true }))
      .find(x => String(x.codigo || '').toUpperCase() === codUp && x.id !== state.modeloId);
    if (jaExiste) { toast(`O código ${codUp} já é usado pelo modelo “${jaExiste.nome}”.`, { type: 'warn', title: 'Código duplicado' }); return; }

    const patch = {
      tipo_slug: 'rotina', is_template: true, codigo: codUp, nome: M.nome.trim(),
      descricao: M.descricao || '', categoria: M.categoria || '', frequencia: M.frequencia || 'Diária',
      horario: M.horario || '', status: M.status || 'rascunho',
      updated_at: ATIV.hoje(), updated_by: USER.id
    };
    let mod;
    if (isNew) {
      mod = await db.insert('op_atividades', { ...patch, versao: 1, responsavel: 'todos', obrigatoria: true, anexos: [], created_by: USER.id, created_at: ATIV.hoje() });
    } else {
      // Alterar um modelo já usado gera NOVA VERSÃO — o histórico das execuções
      // antigas continua intacto pelo snapshot (§23).
      const usado = await modeloJaExecutado(state.modeloId);
      mod = await db.update('op_atividades', state.modeloId, usado ? { ...patch, versao: (M.versao || 1) + 1 } : patch);
      if (usado) toast(`Modelo já executado: publicada a versão ${mod.versao}. As execuções anteriores mantêm a especificação da versão antiga.`, { type: 'info', title: 'Nova versão', timeout: 8000 });
    }
    // regrava os itens na ordem da tela
    for (const antigo of await db.list('op_atividade_itens', { filter: { atividade_id: mod.id } })) await db.remove('op_atividade_itens', antigo.id);
    let ordem = 1;
    for (const it of mItens) { const { id: _i, atividade_id: _a, ...resto } = it; await db.insert('op_atividade_itens', { ...resto, atividade_id: mod.id, ordem: ordem++ }); }
    await db.log({ usuario: USER.nome, acao: `${isNew ? 'Criou' : 'Editou'} modelo de rotina ${mod.codigo}`, entidade: 'op_atividades', antes: isNew ? '—' : `v${M.versao || 1}`, depois: `v${mod.versao || 1}` });
    toast(isNew ? 'Modelo criado.' : 'Modelo salvo.', { type: 'ok', title: 'Modelos de Rotina' });
    state.view = 'lista'; render();
  } catch (e) {
    erro('Não foi possível salvar o modelo', e);
    btn.disabled = false; btn.innerHTML = '<i class="bi bi-check2"></i> Salvar modelo';
  }
}

/** Existe execução concluída de alguma rotina que usa este modelo? (§23) */
async function modeloJaExecutado(modeloId) {
  const execs = await db.list('op_execucao');
  if (execs.some(e => e.modelo_id === modeloId && String(e.status).startsWith('conclu'))) return true;
  const rotinas = (await db.list('op_atividades')).filter(a => a.modelo_id === modeloId).map(a => a.id);
  return execs.some(e => rotinas.includes(e.atividade_id) && String(e.status).startsWith('conclu'));
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
  R = { nome: a.nome || '', descricao: a.descricao || '', categoria: a.categoria || '', frequencia: a.frequencia || 'Diária', horario: a.horario || '', planta: a.planta || '', turno: a.turno || '', setor: a.setor || '', responsavel: a.responsavel || 'todos', exec_observacao: a.exec_observacao || 'opcional', exec_foto: a.exec_foto || 'opcional', permite_na: a.permite_na !== false, obrigatoria: a.obrigatoria !== false, status: a.status || 'rascunho', modelo_id: a.modelo_id || '' };
  /* Rotina personalizada = sem modelo, com itens próprios (§13). */
  R.personalizada = !isNew && !a.modelo_id;
  mItens = (!isNew && !a.modelo_id) ? (await ROT.itensDoModelo(a.id)).map(clone) : [];
  MODELOS = await ROT.listarModelos();
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
        <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-diagram-3-fill"></i> Modelo de rotina</h3></div><div class="rna-card__body">
          <label class="form-label">Nome da rotina / Modelo de rotina *</label>
          <input class="form-control" id="mod-busca" placeholder="Selecione um modelo de rotina" autocomplete="off" role="combobox" aria-expanded="false" aria-controls="mod-lista">
          <div id="mod-lista" class="insp-search-res" role="listbox"></div>
          <div id="mod-sel" class="mt-2"></div>
        </div></div>
        <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-info-circle"></i> Informações gerais</h3></div><div class="rna-card__body"><div class="row g-3">
          <div class="col-md-8"><label class="form-label">Nome da rotina *</label><input class="form-control" data-r="nome" value="${esc(R.nome)}"></div>
          <div class="col-md-4"><label class="form-label">Horário</label><input class="form-control" type="time" data-r="horario" value="${esc(R.horario)}"></div>
          <div class="col-md-8"><label class="form-label">Descrição</label><input class="form-control" data-r="descricao" value="${esc(R.descricao)}"></div>
          <div class="col-md-4"><label class="form-label">Frequência</label><select class="form-select" data-r="frequencia">${freqOpt}</select></div>
          <div class="col-12"><label class="form-label">Categoria</label><div class="d-flex gap-1"><select class="form-select" data-r="categoria">${catOpt}</select><button class="rna-btn rna-btn-ghost" id="add-cat" title="Nova categoria"><i class="bi bi-plus-lg"></i></button></div></div>
        </div></div></div>
        <div class="rna-card mb-3" id="rot-itens-card" hidden><div class="rna-card__head"><h3><i class="bi bi-list-ol"></i> Itens da rotina <span class="rna-badge badge-info" id="mi-count">0</span></h3>
          <button class="rna-btn rna-btn-primary rna-btn-sm" id="mi-add"><i class="bi bi-plus-lg"></i> Adicionar item</button></div>
          <div class="rna-card__body p-0" id="mi-lista"></div>
          <div class="rna-card__body"><label class="form-check"><input type="checkbox" class="form-check-input" id="r-salvar-modelo"> <span class="ms-1">Salvar também como modelo reutilizável</span></label>
            <small class="text-muted-2 d-block">O modelo passa a aparecer na lista de seleção para as próximas rotinas.</small></div></div>
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
  $('#mi-add').addEventListener('click', () => itemModeloModal(null));
  initSeletorModelo();
  renderRotinaPreview();
}
function markRadios() { $$('.op-radio').forEach(l => l.classList.toggle('active', l.querySelector('input').checked)); }

/* -------------------- Seleção pesquisável do modelo (§3, §4) --------------- */
let MODELOS = [];
const OPCAO_PERSONALIZADA = { id: '__custom__', codigo: 'PERSONALIZADA', nome: 'Rotina personalizada', descricao: 'Monte os itens manualmente, sem modelo padrão.' };

function initSeletorModelo() {
  const inp = $('#mod-busca'), lista = $('#mod-lista');
  let marcado = -1;

  const opcoes = (q = '') => {
    const norm = s => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
    const t = norm(q);
    const achados = MODELOS.filter(m => !t || [m.nome, m.codigo, m.categoria].some(c => norm(c).includes(t)));
    const custom = !t || norm(OPCAO_PERSONALIZADA.nome).includes(t) ? [OPCAO_PERSONALIZADA] : [];
    return [...achados, ...custom];
  };
  const fechar = () => { lista.innerHTML = ''; inp.setAttribute('aria-expanded', 'false'); marcado = -1; };
  const abrir = (q = '') => {
    const ops = opcoes(q);
    lista.innerHTML = ops.length
      ? ops.map((m, i) => `<div class="insp-search-item" role="option" data-mid="${m.id}" data-i="${i}">
          <div><b>${esc(m.codigo)}</b> — ${esc(m.nome)}</div>
          <div class="cell-sub">${esc(m.descricao || '')}</div></div>`).join('')
      : `<div class="text-muted-2 p-2"><i class="bi bi-search"></i> Nenhum modelo encontrado.</div>`;
    inp.setAttribute('aria-expanded', 'true');
    $$('.insp-search-item', lista).forEach(el2 => el2.addEventListener('click', () => escolherModelo(el2.dataset.mid)));
  };
  const marcar = d => {
    const its = $$('.insp-search-item', lista); if (!its.length) return;
    marcado = (marcado + d + its.length) % its.length;
    its.forEach((x, i) => x.classList.toggle('is-sel', i === marcado));
    its[marcado].scrollIntoView({ block: 'nearest' });
  };

  inp.addEventListener('focus', () => abrir(inp.value.trim()));
  inp.addEventListener('input', () => abrir(inp.value.trim()));
  /* Navegação por teclado (§3) */
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); marcar(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); marcar(-1); }
    else if (e.key === 'Enter') { const s = $$('.insp-search-item', lista)[marcado]; if (s) { e.preventDefault(); escolherModelo(s.dataset.mid); } }
    else if (e.key === 'Escape') fechar();
  });
  document.addEventListener('click', e => { if (!e.target.closest('#mod-busca, #mod-lista')) fechar(); });

  pintarModeloSel();
}

/* Carrega automaticamente a configuração do modelo (§4). */
async function escolherModelo(id) {
  $('#mod-lista').innerHTML = '';
  if (id === OPCAO_PERSONALIZADA.id) {
    R.modelo_id = ''; R.personalizada = true;
    $('#mod-busca').value = '';
    pintarModeloSel(); renderRotinaPreview();
    return;
  }
  const m = MODELOS.find(x => x.id === id);
  if (!m) return toast('Modelo não encontrado. Atualize a página.', { type: 'warn' });
  R.modelo_id = m.id; R.personalizada = false;
  // herda a configuração do modelo — o admin ainda pode ajustar nome/horário
  R.nome = m.nome; R.descricao = m.descricao || ''; R.categoria = m.categoria || '';
  R.frequencia = m.frequencia || 'Diária';
  if (m.horario) R.horario = m.horario;
  $('#mod-busca').value = '';
  ['nome', 'descricao', 'horario'].forEach(f => { const el2 = document.querySelector(`[data-r="${f}"]`); if (el2) el2.value = R[f] || ''; });
  const selCat = document.querySelector('[data-r="categoria"]'); if (selCat) selCat.value = R.categoria || '';
  const selFreq = document.querySelector('[data-r="frequencia"]'); if (selFreq) selFreq.value = R.frequencia;
  await pintarModeloSel(); renderRotinaPreview();
}

/* Mostra o modelo escolhido + seus itens (somente leitura) ou o editor de itens. */
async function pintarModeloSel() {
  const box = $('#mod-sel'), card = $('#rot-itens-card'); if (!box) return;
  if (R.personalizada) {
    box.innerHTML = `<div class="insp-blocker insp-ok-blocker"><i class="bi bi-pencil-square"></i>
      <div><b>Rotina personalizada</b><div class="cell-sub">Monte os itens manualmente no bloco abaixo.</div></div></div>`;
    if (card) card.hidden = false;
    renderItensModelo();
    return;
  }
  if (card) card.hidden = true;
  if (!R.modelo_id) {
    box.innerHTML = `<small class="text-muted-2">Escolha um modelo padronizado (os itens são carregados automaticamente) ou “Rotina personalizada”.</small>`;
    return;
  }
  const m = MODELOS.find(x => x.id === R.modelo_id) || await ROT.modelo(R.modelo_id);
  if (!m) { box.innerHTML = `<div class="insp-blocker"><i class="bi bi-exclamation-octagon"></i> O modelo vinculado não existe mais. Selecione outro.</div>`; return; }
  let itens = [];
  try { itens = await ROT.itensDoModelo(m.id); }
  catch (e) { erro('Não foi possível carregar os itens do modelo', e); return; }
  box.innerHTML = `<div class="insp-peca-card">
    <div class="insp-peca-card__head"><i class="bi bi-diagram-3-fill"></i> <b>${esc(m.codigo)}</b> — ${esc(m.nome)}
      <span class="rna-badge badge-ok ms-auto">${itens.length} ${itens.length === 1 ? 'item' : 'itens'} · v${m.versao || 1}</span></div>
    <div class="cell-sub mb-2">${esc(m.descricao || '')}</div>
    <div class="op-modelo-itens">${itens.map((it, i) => `<div class="op-modelo-item">
      <span class="op-idx">${i + 1}</span>
      <div class="flex-fill"><b>${esc(it.nome)}</b>
        <div class="cell-sub">${esc(ROT.especificacaoTexto(it))} · ${esc(ROT.FREQUENCIAS_ITEM_MAP[it.frequencia_item]?.nome || '')}${it.regra_condicional ? ` · só ${esc(String(it.regra_condicional.igual))}` : ''}</div></div>
      ${it.obrigatorio ? '<span class="rna-badge badge-crit">Obrig.</span>' : '<span class="rna-badge badge-na">Opc.</span>'}
    </div>`).join('') || '<div class="text-muted-2 p-2">Este modelo não tem itens.</div>'}</div>
    <small class="text-muted-2"><i class="bi bi-lock"></i> Itens, limites e especificações são definidos no modelo (aba “Modelos de Rotina”) — o auditor não altera.</small>
  </div>`;
}

async function renderRotinaPreview() {
  const box = $('#rot-preview'); if (!box) return;
  const naBtn = R.permite_na ? `<button class="rna-btn rna-btn-ghost">N/A</button>` : '';
  const cab = `<div class="rna-card op-rot-card mb-2"><div class="rna-card__body">
      <div class="d-flex justify-content-between align-items-start"><b style="font-size:15px">${esc(R.nome) || 'Nome da rotina'}</b>${R.obrigatoria ? '<span class="rna-badge badge-crit">Obrigatória</span>' : '<span class="rna-badge badge-na">Opcional</span>'}</div>
      <div class="op-item__resp mt-1">${R.horario ? `<span><i class="bi bi-clock"></i> ${R.horario}</span>` : ''}<span><i class="bi bi-arrow-repeat"></i> ${R.frequencia}</span><span><i class="bi bi-person"></i> ${respLabel(R.responsavel)}</span></div>`;

  /* Com itens (modelo ou personalizada) a prévia mostra o formulário do auditor. */
  let itens = R.personalizada ? mItens : [];
  if (R.modelo_id) { try { itens = await ROT.itensDoModelo(R.modelo_id); } catch { itens = []; } }
  if (itens.length) {
    box.innerHTML = cab + `<div class="cell-sub mt-2">${itens.length} ${itens.length === 1 ? 'item' : 'itens'} — o auditor preenche apenas os resultados.</div></div></div>
      ${itens.slice(0, 8).map(it => `<div class="rna-card mb-2"><div class="rna-card__body">
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div><b style="font-size:13.5px">${esc(it.nome)}</b>
            <div class="cell-sub">${esc(ROT.especificacaoTexto(it))}</div></div>
          <span class="rna-badge badge-pend">Aguardando</span></div>
        <input class="form-control form-control-sm mt-2" placeholder="${esc(it.unidade_simbolo || it.unidade || 'Resultado')}" disabled>
      </div></div>`).join('')}
      ${itens.length > 8 ? `<div class="text-muted-2 text-center" style="font-size:12.5px">+ ${itens.length - 8} item(ns)</div>` : ''}`;
    return;
  }
  /* Sem itens = rotina de ação única (comportamento legado preservado). */
  box.innerHTML = cab + `<div class="d-flex gap-2 mt-3"><button class="rna-btn rna-btn-primary" id="pv-concluir"><i class="bi bi-check2"></i> Concluir</button>${naBtn}</div>
    </div></div><div id="pv-modal"></div>`;
  $('#pv-concluir')?.addEventListener('click', togglePvModal);
}
function togglePvModal() {
  const box = $('#pv-modal'); if (!box) return;
  if (box.innerHTML) { box.innerHTML = ''; return; }
  const obs = R.exec_observacao === 'nao' ? '<div class="text-muted-2" style="font-size:12.5px">Sem observação.</div>' : `<div class="mb-2"><label class="form-label">Observação ${R.exec_observacao === 'obrigatoria' ? '<span class="text-danger">*</span>' : ''}</label><textarea class="form-control" rows="2" placeholder="${R.exec_observacao === 'obrigatoria' ? 'Obrigatória' : 'Opcional'}"></textarea></div>`;
  const foto = R.exec_foto === 'nao' ? '' : `<div class="mb-2"><label class="form-label">Foto ${R.exec_foto === 'obrigatoria' ? '<span class="text-danger">*</span>' : ''}</label><div class="d-flex gap-2"><button class="rna-btn rna-btn-ghost rna-btn-sm"><i class="bi bi-folder2-open"></i> Arquivo</button><button class="rna-btn rna-btn-dark rna-btn-sm"><i class="bi bi-camera-fill"></i> Câmera</button></div></div>`;
  box.innerHTML = `<div class="op-preview-modal"><div class="op-preview-modal__head">Concluir — ${esc(R.nome) || 'Rotina'}</div><div class="op-preview-modal__body">${obs}${foto}</div><div class="op-preview-modal__foot"><button class="rna-btn rna-btn-ghost rna-btn-sm">Cancelar</button><button class="rna-btn rna-btn-primary rna-btn-sm"><i class="bi bi-check2"></i> Concluir</button></div></div>`;
}

async function salvarRotina(isNew) {
  const btn = $('#ed-save'); if (btn?.disabled) return;                  // clique duplo (§26)
  if (!R.nome.trim()) return toast('Informe o nome da rotina.', { type: 'warn' });
  if (R.personalizada && !mItens.length) return toast('Rotina personalizada: adicione ao menos um item.', { type: 'warn' });
  if (R.personalizada) {
    const erros = mItens.flatMap(it => ROT.validarItemCadastro(it));
    if (erros.length) return toast(erros[0], { type: 'warn', title: 'Revise os itens' });
  }
  const modeloSel = R.modelo_id ? MODELOS.find(m => m.id === R.modelo_id) : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Salvando...'; }
  try {
    const patch = {
      tipo_slug: 'rotina', nome: R.nome.trim(), descricao: R.descricao || '', categoria: R.categoria || '',
      frequencia: R.frequencia, horario: R.horario || '', planta: R.planta || '', turno: R.turno || '',
      setor: R.setor || '', responsavel: R.responsavel || 'todos', exec_observacao: R.exec_observacao,
      exec_foto: R.exec_foto, permite_na: !!R.permite_na, obrigatoria: !!R.obrigatoria,
      status: R.status || 'rascunho', updated_at: ATIV.hoje(), updated_by: USER.id,
      // vínculo com o modelo: os itens vêm dele na execução (§4, §23)
      modelo_id: R.modelo_id || null,
      modelo_versao: modeloSel ? (modeloSel.versao || 1) : null
    };
    let ativ;
    if (isNew) ativ = await db.insert('op_atividades', { ...patch, is_template: false, anexos: [], created_by: USER.id, created_at: ATIV.hoje() });
    else ativ = await db.update('op_atividades', state.ativId, patch);

    /* Itens próprios existem só na rotina PERSONALIZADA. Com modelo vinculado, os
       itens vivem no modelo — não são copiados (evita duplicidade e divergência). */
    for (const it of await db.list('op_atividade_itens', { filter: { atividade_id: ativ.id } })) await db.remove('op_atividade_itens', it.id);
    if (R.personalizada) {
      let ordem = 1;
      for (const it of mItens) { const { id: _i, atividade_id: _a, ...resto } = it; await db.insert('op_atividade_itens', { ...resto, atividade_id: ativ.id, ordem: ordem++ }); }
      /* "Salvar como modelo reutilizável" (§13) — vira um modelo na lista de seleção. */
      if ($('#r-salvar-modelo')?.checked) {
        const codigo = await ROT.codigoLivre(slug(R.nome));
        const mod = await db.insert('op_atividades', {
          ...patch, is_template: true, modelo_id: null, modelo_versao: null, codigo,
          versao: 1, status: 'publicada', anexos: [], created_by: USER.id, created_at: ATIV.hoje()
        });
        let o = 1;
        for (const it of mItens) { const { id: _i, atividade_id: _a, ...resto } = it; await db.insert('op_atividade_itens', { ...resto, atividade_id: mod.id, ordem: o++ }); }
        await db.update('op_atividades', ativ.id, { modelo_id: mod.id, modelo_versao: 1 });
        toast(`Modelo “${codigo}” criado e disponível para seleção.`, { type: 'ok', title: 'Modelo salvo', timeout: 6000 });
      }
    }
    await gerarAtribuicao(ativ.id, R);
    await upsertAgenda(ativ.id, R.frequencia);
    await db.log({ usuario: USER.nome, acao: `${isNew ? 'Criou' : 'Editou'} rotina ${ativ.nome}`, entidade: 'op_atividades', antes: isNew ? '—' : '', depois: ativ.status });
    toast(isNew ? 'Rotina criada.' : 'Rotina salva.', { type: 'ok', title: 'Gestão Operacional' });
    state.view = 'lista'; render();
  } catch (e) {
    erro('Não foi possível salvar a rotina', e);
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check2"></i> Salvar rotina'; }
  }
}
const slug = s => String(s || 'ROTINA').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').toUpperCase().slice(0, 24) || 'ROTINA';

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
