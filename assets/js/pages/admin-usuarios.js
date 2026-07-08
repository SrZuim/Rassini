/* ==========================================================================
   RNA One — [MÓDULO USUÁRIOS] Administração de Usuários
   Dashboard de indicadores + tabela (filtros/busca/ordenação/paginação) +
   drawer lateral com ações (aprovar, recusar, bloquear, cargo, excluir).
   Acesso: somente admin (garantido por RBAC no mountShell + RLS/RPC no banco).
   ========================================================================== */
import { mountShell } from '../app.js';
import { usuariosSvc, STATUS_META } from '../../../services/usuarios.js';
import { ROLES, PLANTAS } from '../../../services/config.js';
import { $, $$, toast, initials, confirmDialog, modal } from '../ui.js';

const ctx = await mountShell();
let USER, ALL = [];
const state = { status: 'todos', planta: '', cargo: '', q: '', sort: 'data', page: 1, per: 10 };

if (ctx) { USER = ctx.user; boot(); }

/* ------------------------------------------------------------------ boot -- */
async function boot() {
  $('#rna-content').innerHTML = `
    <div class="rna-page-head">
      <div>
        <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Administração <i class="bi bi-chevron-right"></i> Usuários</div>
        <h1>Administração de Usuários</h1>
        <p>Solicitações de acesso, aprovação, cargos e bloqueios.</p>
      </div>
      <div class="d-flex gap-2">
        <button class="rna-btn rna-btn-ghost" id="btn-logs"><i class="bi bi-clock-history"></i> Auditoria</button>
        <button class="rna-btn rna-btn-dark" id="btn-refresh"><i class="bi bi-arrow-clockwise"></i> Atualizar</button>
      </div>
    </div>

    <div class="row g-3 mb-3" id="cards"></div>

    <div class="rna-card">
      <div class="rna-card__head" style="flex-wrap:wrap">
        <div class="d-flex flex-wrap gap-2" id="chips"></div>
        <div class="d-flex flex-wrap gap-2 ms-auto align-items-center">
          <div class="position-relative">
            <i class="bi bi-search position-absolute" style="left:11px;top:9px;color:var(--rna-gray);font-size:13px"></i>
            <input id="f-q" class="form-control" placeholder="Buscar nome ou e-mail" style="padding-left:32px;min-width:210px">
          </div>
          <select id="f-planta" class="form-select" style="width:auto"><option value="">Todas as plantas</option>${PLANTAS.map(p => `<option>${p}</option>`).join('')}</select>
          <select id="f-cargo" class="form-select" style="width:auto">
            <option value="">Todos os cargos</option>
            <option value="admin">Administrador</option><option value="supervisor">Supervisor</option>
            <option value="auditor">Auditor</option><option value="visitante">Visitante</option>
          </select>
          <select id="f-sort" class="form-select" style="width:auto">
            <option value="data">Ordenar: Data</option><option value="nome">Ordenar: Nome</option><option value="login">Ordenar: Último acesso</option>
          </select>
        </div>
      </div>
      <div class="rna-card__body p-0" style="overflow-x:auto"><div id="tbl-host"></div></div>
      <div class="rna-card__head" style="border-top:1px solid var(--rna-border);border-bottom:0" id="pager"></div>
    </div>

    <div id="drawer-host"></div>`;

  // filtros / ações de topo
  $('#btn-refresh').addEventListener('click', reload);
  $('#btn-logs').addEventListener('click', () => openLogs());
  $('#f-q').addEventListener('input', e => { state.q = e.target.value.trim().toLowerCase(); state.page = 1; renderTable(); });
  $('#f-planta').addEventListener('change', e => { state.planta = e.target.value; state.page = 1; renderTable(); });
  $('#f-cargo').addEventListener('change', e => { state.cargo = e.target.value; state.page = 1; renderTable(); });
  $('#f-sort').addEventListener('change', e => { state.sort = e.target.value; renderTable(); });

  await reload();
}

async function reload() {
  const host = $('#tbl-host');
  if (host) host.innerHTML = skeleton();
  ALL = await usuariosSvc.list();
  renderCards();
  renderChips();
  renderTable();
}

/* ----------------------------------------------------------------- cards -- */
function renderCards() {
  const s = usuariosSvc.stats(ALL);
  const card = (icon, ic, val, label) => `
    <div class="col-6 col-md-4 col-xl">
      <div class="rna-stat">
        <div class="rna-stat__icon ${ic}"><i class="bi ${icon}"></i></div>
        <div class="rna-stat__val">${val}</div>
        <div class="rna-stat__label">${label}</div>
      </div>
    </div>`;
  $('#cards').innerHTML =
    card('bi-hourglass-split', 'ic-soft-yellow', s.pendentes,  'Cadastros pendentes') +
    card('bi-check-circle',    'ic-soft-green',  s.ativos,     'Usuários ativos') +
    card('bi-lock',            'ic-soft-red',    s.bloqueados,  'Usuários bloqueados') +
    card('bi-shield-lock',     'ic-soft-gray',   s.admin,      'Administradores') +
    card('bi-person-gear',     'ic-soft-orange', s.supervisor, 'Supervisores') +
    card('bi-clipboard-check', 'ic-soft-blue',   s.auditor,    'Auditores') +
    card('bi-eye',             'ic-soft-gray',   s.visitante,  'Visitantes');
}

function renderChips() {
  const s = usuariosSvc.stats(ALL);
  const chips = [
    ['todos', 'Todos', s.total], ['pendente', 'Pendentes', s.pendentes],
    ['aprovado', 'Aprovados', s.aprovados], ['recusado', 'Recusados', s.recusados],
    ['bloqueado', 'Bloqueados', s.bloqueados]
  ];
  $('#chips').innerHTML = chips.map(([v, label, n]) =>
    `<button class="rna-chip ${state.status === v ? 'active' : ''}" data-st="${v}">${label} <b style="opacity:.7">${n}</b></button>`).join('');
  $$('#chips [data-st]').forEach(b => b.addEventListener('click', () => { state.status = b.dataset.st; state.page = 1; renderChips(); renderTable(); }));
}

/* ----------------------------------------------------------------- tabela - */
function filtered() {
  let rows = ALL.slice();
  if (state.status !== 'todos') rows = rows.filter(u => (u.status || 'aprovado') === state.status);
  if (state.planta) rows = rows.filter(u => u.planta === state.planta);
  if (state.cargo)  rows = rows.filter(u => u.role === state.cargo);
  if (state.q)      rows = rows.filter(u => (u.nome || '').toLowerCase().includes(state.q) || (u.email || '').toLowerCase().includes(state.q));
  rows.sort((a, b) => {
    if (state.sort === 'nome')  return (a.nome || '').localeCompare(b.nome || '');
    if (state.sort === 'login') return new Date(b.ultimo_login || 0) - new Date(a.ultimo_login || 0);
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });
  return rows;
}

function renderTable() {
  const rows = filtered();
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / state.per));
  state.page = Math.min(state.page, pages);
  const slice = rows.slice((state.page - 1) * state.per, state.page * state.per);

  if (!total) {
    $('#tbl-host').innerHTML = `<div class="text-center" style="padding:44px 20px">
      <i class="bi bi-people" style="font-size:40px;color:var(--rna-gray-300)"></i>
      <p class="text-muted-2" style="margin:10px 0 0">Nenhum usuário encontrado com os filtros atuais.</p></div>`;
    $('#pager').innerHTML = '';
    return;
  }

  $('#tbl-host').innerHTML = `
    <table class="rna-table">
      <thead><tr>
        <th>Usuário</th><th>Planta</th><th>Cargo</th><th>Status</th>
        <th>Cadastro</th><th>Último acesso</th><th>Aprovado por</th><th></th>
      </tr></thead>
      <tbody>${slice.map(rowHtml).join('')}</tbody>
    </table>`;

  $('#pager').innerHTML = `
    <small class="text-muted-2">${total} usuário(s) · página ${state.page} de ${pages}</small>
    <div class="d-flex gap-1 ms-auto">
      <button class="rna-btn rna-btn-ghost rna-btn-sm" ${state.page <= 1 ? 'disabled' : ''} id="pg-prev"><i class="bi bi-chevron-left"></i></button>
      <button class="rna-btn rna-btn-ghost rna-btn-sm" ${state.page >= pages ? 'disabled' : ''} id="pg-next"><i class="bi bi-chevron-right"></i></button>
    </div>`;
  $('#pg-prev')?.addEventListener('click', () => { state.page--; renderTable(); });
  $('#pg-next')?.addEventListener('click', () => { state.page++; renderTable(); });

  $$('#tbl-host [data-open]').forEach(el => el.addEventListener('click', () => openDrawer(el.dataset.open)));
  $$('#tbl-host [data-approve]').forEach(el => el.addEventListener('click', async (e) => {
    e.stopPropagation();
    await runAction('Aprovar acesso', () => usuariosSvc.aprovar(byId(el.dataset.approve)), 'Usuário aprovado.');
  }));
}

function rowHtml(u) {
  const st = STATUS_META[u.status] || STATUS_META.aprovado;
  const cargo = ROLES[u.role]?.label || u.role || '—';
  const aprovadoPor = ALL.find(x => x.id === u.aprovado_por);
  const av = u.avatar
    ? `<img src="${u.avatar}" style="width:34px;height:34px;border-radius:9px;object-fit:cover">`
    : `<div class="rna-avatar" style="width:34px;height:34px;font-size:12px">${initials(u.nome)}</div>`;
  const quick = u.status === 'pendente'
    ? `<button class="rna-btn rna-btn-primary rna-btn-sm" data-approve="${u.id}" title="Aprovar"><i class="bi bi-check-lg"></i></button>` : '';
  return `<tr style="cursor:pointer" data-open="${u.id}">
    <td><div class="d-flex align-items-center gap-2">${av}
      <div><div class="cell-strong">${u.nome || '—'}</div><div class="cell-sub">${u.email || ''}</div></div></div></td>
    <td>${u.planta || '—'}</td>
    <td><span class="rna-badge badge-na"><i class="bi ${ROLES[u.role]?.icon || 'bi-person'}"></i> ${cargo}</span></td>
    <td><span class="rna-badge ${st.badge}"><i class="bi ${st.icon}"></i> ${st.label}</span></td>
    <td>${fmtDT(u.created_at, true)}</td>
    <td>${fmtDT(u.ultimo_login)}</td>
    <td class="cell-sub">${aprovadoPor ? aprovadoPor.nome : '—'}</td>
    <td class="text-end" onclick="event.stopPropagation()">${quick}
      <button class="rna-btn rna-btn-ghost rna-btn-sm" data-open="${u.id}"><i class="bi bi-chevron-right"></i></button></td>
  </tr>`;
}

/* ----------------------------------------------------------------- drawer - */
async function openDrawer(id) {
  const u = byId(id);
  if (!u) return;
  const st = STATUS_META[u.status] || STATUS_META.aprovado;
  const cargo = ROLES[u.role]?.label || u.role || '—';
  const isSelf = u.id === USER.id;
  const logs = await usuariosSvc.logs(u.id);

  const act = [];
  if (u.status !== 'aprovado')                       act.push(btn('aprovar',  'bi-check-circle', 'Aprovar', 'rna-btn-primary'));
  if (u.status === 'pendente')                       act.push(btn('recusar',  'bi-x-circle', 'Recusar', 'rna-btn-ghost'));
  if (u.status === 'bloqueado')                      act.push(btn('desbloquear', 'bi-unlock', 'Desbloquear', 'rna-btn-ghost'));
  else if (u.status === 'aprovado' && !isSelf)       act.push(btn('bloquear', 'bi-lock', 'Bloquear', 'rna-btn-ghost'));
  if (!isSelf)                                        act.push(btn('cargo',    'bi-arrow-left-right', 'Alterar cargo', 'rna-btn-ghost'));
  if (!isSelf)                                        act.push(btn('excluir',  'bi-trash', 'Excluir', 'rna-btn-dark'));

  const av = u.avatar
    ? `<img src="${u.avatar}" style="width:64px;height:64px;border-radius:14px;object-fit:cover">`
    : `<div class="rna-avatar" style="width:64px;height:64px;font-size:22px">${initials(u.nome)}</div>`;

  $('#drawer-host').innerHTML = `
    <div class="rna-drawer-backdrop" id="dw-bd"></div>
    <aside class="rna-drawer" id="dw">
      <div style="padding:18px 20px;border-bottom:1px solid var(--rna-border);display:flex;align-items:center;justify-content:space-between">
        <b style="font-size:14.5px">Detalhes do usuário</b>
        <button class="rna-icon-btn" id="dw-close"><i class="bi bi-x-lg"></i></button>
      </div>
      <div style="padding:20px;overflow:auto;flex:1">
        <div class="d-flex align-items-center gap-3 mb-3">${av}
          <div><h3 style="margin:0;font-size:18px">${u.nome || '—'}</h3>
            <span class="rna-badge ${st.badge}"><i class="bi ${st.icon}"></i> ${st.label}</span></div></div>

        <div style="font-size:13px;line-height:2.2">
          ${infoRow('E-mail', u.email)}
          ${infoRow('Cargo', `<span class="rna-badge badge-na"><i class="bi ${ROLES[u.role]?.icon || 'bi-person'}"></i> ${cargo}</span>`)}
          ${infoRow('Planta', u.planta || '—')}
          ${infoRow('Telefone', u.telefone || '—')}
          ${infoRow('Cadastro', fmtDT(u.created_at, true))}
          ${infoRow('Último acesso', fmtDT(u.ultimo_login))}
          ${u.recusado_motivo ? infoRow('Motivo recusa', u.recusado_motivo) : ''}
        </div>

        <div class="d-flex flex-wrap gap-2 mt-3">${act.join('')}</div>

        <h4 style="font-size:13px;font-weight:700;margin:22px 0 10px"><i class="bi bi-clock-history text-muted-2"></i> Histórico de alterações</h4>
        ${logs.length ? `<div class="rna-timeline">${logs.map(logHtml).join('')}</div>`
                      : '<p class="text-muted-2" style="font-size:12.5px">Nenhum registro de auditoria.</p>'}
      </div>
    </aside>`;

  const close = () => { $('#dw')?.classList.remove('open'); $('#dw-bd')?.classList.remove('show'); setTimeout(() => $('#drawer-host').innerHTML = '', 220); };
  requestAnimationFrame(() => { $('#dw').classList.add('open'); $('#dw-bd').classList.add('show'); });
  $('#dw-close').addEventListener('click', close);
  $('#dw-bd').addEventListener('click', close);

  $$('#dw [data-act]').forEach(b => b.addEventListener('click', () => onAction(b.dataset.act, u, close)));
}

function onAction(act, u, close) {
  if (act === 'aprovar')     return runAction('Aprovar acesso', () => usuariosSvc.aprovar(u), `${u.nome} aprovado.`, close);
  if (act === 'desbloquear') return runAction('Desbloquear', () => usuariosSvc.desbloquear(u), `${u.nome} desbloqueado.`, close);
  if (act === 'bloquear')    return confirmDialog(`Bloquear o acesso de <b>${u.nome}</b>?`, () => runAction('Bloquear', () => usuariosSvc.bloquear(u), `${u.nome} bloqueado.`, close), { title:'Bloquear usuário', okLabel:'Bloquear', danger:true });
  if (act === 'excluir')     return confirmDialog(
    'Tem certeza que deseja excluir este usuário? Essa ação apagará o usuário do banco de dados.',
    () => runAction('Excluir usuário', () => usuariosSvc.excluir(u),
      'Usuário excluído do banco de dados com sucesso.', close),
    { title: 'Excluir usuário', okLabel: 'Excluir', danger: true });
  if (act === 'recusar')     return recusarModal(u, close);
  if (act === 'cargo')       return cargoModal(u, close);
}

function recusarModal(u, close) {
  const m = modal({
    title: 'Recusar acesso',
    content: `<p style="font-size:13.5px">Recusar a solicitação de <b>${u.nome}</b>.</p>
      <label class="form-label">Motivo (opcional)</label>
      <textarea id="rec-motivo" class="form-control" rows="3" placeholder="Ex.: cargo incompatível, aguardando validação do RH…"></textarea>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-dark" id="rec-ok">Recusar acesso</button>`
  });
  $('#rec-ok', m.host).addEventListener('click', () => {
    const motivo = $('#rec-motivo', m.host).value.trim();
    m.close();
    runAction('Recusar', () => usuariosSvc.recusar(u, motivo), `${u.nome} recusado.`, close);
  });
}

function cargoModal(u, close) {
  const opts = [['visitante','Visitante'],['auditor','Auditor'],['supervisor','Supervisor'],['admin','Administrador']];
  const m = modal({
    title: 'Alterar cargo',
    content: `<p style="font-size:13.5px">Cargo atual de <b>${u.nome}</b>: <b>${ROLES[u.role]?.label || u.role}</b></p>
      <label class="form-label">Novo cargo</label>
      <select id="cg-role" class="form-select">${opts.map(([v, l]) => `<option value="${v}" ${u.role === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <small class="text-muted-2" style="font-size:11.5px">Hierarquia: Visitante → Auditor → Supervisor → Administrador.</small>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-primary" id="cg-ok">Salvar cargo</button>`
  });
  $('#cg-ok', m.host).addEventListener('click', () => {
    const role = $('#cg-role', m.host).value;
    if (role === u.role) { m.close(); return; }
    m.close();
    runAction('Alterar cargo', () => usuariosSvc.alterarCargo(u, role), `Cargo de ${u.nome} alterado.`, close);
  });
}

/* ----------------------------------------------------------------- logs --- */
async function openLogs() {
  const logs = await usuariosSvc.logs();
  modal({
    title: 'Trilha de auditoria — usuários',
    size: 'modal-lg',
    content: logs.length ? `<div style="max-height:60vh;overflow:auto"><div class="rna-timeline">${logs.map(logHtml).join('')}</div></div>`
                         : '<p class="text-muted-2">Nenhum registro ainda.</p>'
  });
}

/* ---------------------------------------------------------------- helpers - */
async function runAction(nome, fn, okMsg, close) {
  try {
    await fn();
    toast(okMsg, { type: 'ok', title: nome });
    close?.();
    await reload();
  } catch (e) {
    toast(e.message || 'Falha na operação.', { type: 'crit', title: nome });
  }
}

function byId(id) { return ALL.find(u => u.id === id); }
function btn(act, icon, label, cls) { return `<button class="rna-btn ${cls} rna-btn-sm" data-act="${act}"><i class="bi ${icon}"></i> ${label}</button>`; }
function infoRow(k, v) { return `<div class="d-flex justify-content-between gap-3"><span class="text-muted-2">${k}</span><b style="text-align:right">${v}</b></div>`; }

const ACAO_META = {
  cadastro:'Cadastro', aprovacao:'Aprovação', recusa:'Recusa', promocao:'Promoção',
  rebaixamento:'Rebaixamento', bloqueio:'Bloqueio', desbloqueio:'Desbloqueio',
  exclusao:'Exclusão', alteracao_dados:'Alteração'
};
function logHtml(l) {
  return `<div class="rna-timeline__item" style="padding-bottom:12px">
    <div style="font-size:12.5px"><b>${ACAO_META[l.acao] || l.acao}</b>${l.executor_nome ? ` · ${l.executor_nome}` : ''}</div>
    <div class="text-muted-2" style="font-size:12px">${l.detalhe || ''}${l.afetado_nome ? ` — ${l.afetado_nome}` : ''}</div>
    <small style="color:var(--rna-gray-300)">${fmtDT(l.created_at, true)}</small>
  </div>`;
}

function fmtDT(v, withTime = false) {
  if (!v) return '—';
  const d = new Date(v);
  if (isNaN(d)) return '—';
  return withTime ? d.toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' }) : d.toLocaleDateString('pt-BR');
}

function skeleton() {
  return `<div style="padding:16px">${Array.from({ length: 6 }).map(() =>
    `<div class="rna-skeleton" style="height:44px;border-radius:9px;margin-bottom:8px"></div>`).join('')}</div>`;
}
