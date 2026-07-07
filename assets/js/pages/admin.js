/* Administração — CRUD editável dos catálogos do fluxo do auditor */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { auth } from '../../../services/auth.js';
import { CATALOGOS } from '../../../services/auditoria-data.js';
import { FUNCIONARIOS_DEFAULT } from '../../../services/funcionarios.js';
import { can } from '../../../services/config.js';
import { $, $$, toast, modal, confirmDialog } from '../ui.js';

let USER;
const DEFAULTS = { ...CATALOGOS, funcionarios: FUNCIONARIOS_DEFAULT };

/* Definição das abas: tabela + colunas editáveis */
const ABAS = [
  { id:'funcionarios',      label:'Funcionários',  icon:'bi-people-fill',   cols:[['matricula','MAT'],['nome','Nome'],['area','Área'],['planta','Planta']], podeAtivar:'ativo' },
  { id:'usuarios',          label:'Logins',        icon:'bi-person-badge',  cols:[['nome','Nome'],['email','E-mail'],['role','Perfil'],['matricula','Matrícula'],['area','Área']], podeAtivar:'ativo' },
  { id:'cat_rotinas',       label:'Rotinas',       icon:'bi-list-check',    cols:[['nome','Atividade'],['horario','Horário'],['frequencia','Frequência'],['responsavel','Responsável']], podeAtivar:'ativo' },
  { id:'cat_categorias',    label:'Categorias',    icon:'bi-box-seam',      cols:[['nome','Categoria'],['tipo','Tipo']], podeAtivar:'ativo' },
  { id:'cat_checklist',     label:'Checklist',     icon:'bi-ui-checks',     cols:[['categoria','Categoria'],['nome','Item'],['frequencia','Frequência']], podeAtivar:'ativo' },
  { id:'cat_pecas',         label:'Peças & Tempo', icon:'bi-box',           cols:[['nome','Peça'],['codigo','Código'],['tempo_medio','Tempo médio (min)']], podeAtivar:'ativo' },
  { id:'cat_tipos_auditoria',label:'Tipos de Auditoria', icon:'bi-clipboard-data', cols:[['nome','Tipo']], podeAtivar:'ativo' },
  { id:'cat_motivos_atraso',label:'Motivos de Atraso', icon:'bi-stopwatch', cols:[['nome','Motivo']], podeAtivar:'ativo' },
  { id:'cat_motivos_nc',    label:'Motivos de NC', icon:'bi-exclamation-octagon', cols:[['nome','Motivo']], podeAtivar:'ativo' },
  { id:'acessos',           label:'Logs de Acesso', icon:'bi-shield-check', special:true }
];

let ATUAL = 'funcionarios';

const ctx = await mountShell();
if (ctx) { USER = ctx.user; init(); }

function init() {
  if (!can(USER.role, 'admin', 'view')) {
    $('#rna-content').innerHTML = `<div class="empty-state"><i class="bi bi-shield-lock"></i><div>Apenas o Administrador acessa esta área.</div></div>`;
    return;
  }
  render();
}

async function render() {
  const aba = ABAS.find(a => a.id === ATUAL);
  if (aba.special) return renderAcessos(aba);
  const rows = await db.list(ATUAL);
  const podeEditar = can(USER.role, 'admin', 'edit');

  $('#rna-content').innerHTML = `
    <div class="rna-page-head"><div>
      <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Administração</div>
      <h1>Administração</h1><p>Edite os cadastros sem mexer no código. As mudanças refletem no fluxo do auditor.</p></div>
      <div class="d-flex gap-2">
        <button class="rna-btn rna-btn-ghost" id="btn-reset"><i class="bi bi-arrow-counterclockwise"></i> Restaurar planilha</button>
        ${podeEditar?`<button class="rna-btn rna-btn-primary" id="btn-add"><i class="bi bi-plus-lg"></i> Novo</button>`:''}
      </div>
    </div>
    <div class="admin-tabs">
      ${ABAS.map(a=>`<button class="rna-chip ${a.id===ATUAL?'active':''}" data-aba="${a.id}"><i class="bi ${a.icon}"></i> ${a.label}</button>`).join('')}
    </div>
    <div class="rna-card"><div class="rna-card__head"><h3><i class="bi ${aba.icon}"></i> ${aba.label} <span class="rna-badge badge-info">${rows.length}</span></h3></div>
      <div class="rna-card__body p-0" style="overflow:auto">
        <table class="rna-table"><thead><tr>${aba.cols.map(c=>`<th>${c[1]}</th>`).join('')}<th>Ativo</th><th></th></tr></thead><tbody>
          ${rows.length?rows.map(r=>linha(r, aba, podeEditar)).join(''):`<tr><td colspan="${aba.cols.length+2}"><div class="empty-state"><i class="bi bi-inbox"></i><div>Sem registros.</div></div></td></tr>`}
        </tbody></table>
      </div></div>`;

  $$('[data-aba]').forEach(b=>b.addEventListener('click',()=>{ ATUAL=b.dataset.aba; render(); }));
  $('#btn-add')?.addEventListener('click',()=>editar(null, aba));
  $('#btn-reset')?.addEventListener('click', resetAba);
  $$('[data-edit]').forEach(b=>b.addEventListener('click',async ()=>editar(await db.get(ATUAL,b.dataset.edit), aba)));
  $$('[data-del]').forEach(b=>b.addEventListener('click',()=>excluir(b.dataset.del, aba)));
  $$('[data-toggle]').forEach(b=>b.addEventListener('click',()=>toggle(b.dataset.toggle)));
}

function header(aba, extra='') {
  return `<div class="rna-page-head"><div>
      <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Administração</div>
      <h1>Administração</h1><p>Edite os cadastros sem mexer no código. As mudanças refletem no fluxo do auditor.</p></div>
      <div class="d-flex gap-2">${extra}</div></div>
    <div class="admin-tabs">${ABAS.map(a=>`<button class="rna-chip ${a.id===ATUAL?'active':''}" data-aba="${a.id}"><i class="bi ${a.icon}"></i> ${a.label}</button>`).join('')}</div>`;
}

function renderAcessos(aba) {
  const logs = auth.acessos();
  const ev = (e) => ({ login:'badge-ok', logout:'badge-na', falha:'badge-crit', expirou:'badge-warn' }[e] || 'badge-info');
  const icon = (e) => ({ login:'bi-box-arrow-in-right', logout:'bi-box-arrow-left', falha:'bi-x-octagon', expirou:'bi-clock-history' }[e] || 'bi-dot');
  $('#rna-content').innerHTML = header(aba, `<button class="rna-btn rna-btn-ghost" id="btn-limpar"><i class="bi bi-trash"></i> Limpar logs</button>`) + `
    <div class="row g-3 mb-3">
      ${[['Logins','login','ic-soft-green'],['Logouts','logout','ic-soft-gray'],['Falhas','falha','ic-soft-red'],['Expiradas','expirou','ic-soft-orange']]
        .map(([l,k,c])=>`<div class="col-6 col-md-3"><div class="rna-stat"><div class="rna-stat__icon ${c}"><i class="bi ${icon(k)}"></i></div><div class="rna-stat__val" style="font-size:22px">${logs.filter(x=>x.evento===k).length}</div><div class="rna-stat__label">${l}</div></div></div>`).join('')}
    </div>
    <div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-shield-check"></i> Logs de Acesso <span class="rna-badge badge-info">${logs.length}</span></h3></div>
      <div class="rna-card__body p-0" style="overflow:auto">
        <table class="rna-table"><thead><tr><th>Quando</th><th>Evento</th><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Detalhe</th></tr></thead><tbody>
        ${logs.length?logs.map(l=>`<tr><td class="cell-sub">${l.quando||'—'}</td>
          <td><span class="rna-badge ${ev(l.evento)}"><i class="bi ${icon(l.evento)}"></i> ${l.evento}</span></td>
          <td class="cell-strong">${l.nome||'—'}</td><td class="cell-sub">${l.email||'—'}</td><td>${l.perfil||'—'}</td>
          <td class="cell-sub">${l.motivo?('motivo: '+l.motivo):(l.dispositivo||'')}</td></tr>`).join('')
          :`<tr><td colspan="6"><div class="empty-state"><i class="bi bi-inbox"></i><div>Nenhum acesso registrado ainda.</div></div></td></tr>`}
        </tbody></table>
      </div></div>`;
  $$('[data-aba]').forEach(b=>b.addEventListener('click',()=>{ ATUAL=b.dataset.aba; render(); }));
  $('#btn-limpar')?.addEventListener('click',()=>confirmDialog('Limpar todos os logs de acesso?', ()=>{ localStorage.removeItem('rna_acessos'); toast('Logs de acesso limpos.',{type:'ok'}); render(); }, { title:'Limpar logs', okLabel:'Limpar', danger:true }));
}

function linha(r, aba, podeEditar) {
  const ativo = r.ativo !== false;
  return `<tr style="${ativo?'':'opacity:.5'}">
    ${aba.cols.map(c=>`<td class="${c[0]==='nome'?'cell-strong':''}">${r[c[0]] ?? '—'}</td>`).join('')}
    <td><span class="rna-badge ${ativo?'badge-ok':'badge-na'}" data-toggle="${r.id}" style="cursor:pointer">${ativo?'Sim':'Não'}</span></td>
    <td class="text-end">${podeEditar?`<button class="rna-btn rna-btn-ghost rna-btn-sm" data-edit="${r.id}"><i class="bi bi-pencil"></i></button>
      <button class="rna-btn rna-btn-ghost rna-btn-sm" data-del="${r.id}"><i class="bi bi-trash text-danger"></i></button>`:''}</td></tr>`;
}

function editar(row, aba) {
  const isNew = !row;
  const fields = aba.cols.map(c => {
    const val = row ? (row[c[0]] ?? '') : '';
    const type = c[0]==='tempo_medio' ? 'number' : 'text';
    return `<div class="col-md-6"><label class="form-label">${c[1]}</label><input class="form-control" data-f="${c[0]}" type="${type}" value="${val}"></div>`;
  }).join('');
  const m = modal({ title:`${isNew?'Novo registro':'Editar'} · ${aba.label}`,
    content:`<form class="row g-3">${fields}</form>`,
    footer:`<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button><button class="rna-btn rna-btn-primary" id="ad-ok"><i class="bi bi-check2"></i> Salvar</button>` });
  $('#ad-ok', m.host).addEventListener('click', async () => {
    const patch = {};
    $$('[data-f]', m.host).forEach(i => { patch[i.dataset.f] = i.type==='number' ? +i.value : i.value; });
    if (!Object.values(patch).some(v=>String(v).trim())) return toast('Preencha ao menos um campo.', { type:'warn' });
    if (isNew) { patch.ativo = true; await db.insert(ATUAL, patch); }
    else await db.update(ATUAL, row.id, patch);
    await db.log({ usuario:USER.nome, acao:`${isNew?'Criou':'Editou'} ${aba.label}`, entidade:ATUAL, antes:isNew?'—':'registro', depois:patch.nome||'registro' });
    m.close(); toast('Registro salvo.', { type:'ok' }); render();
  });
}

function excluir(id, aba) {
  confirmDialog('Excluir este registro? Esta ação não pode ser desfeita.', async () => {
    await db.remove(ATUAL, id);
    await db.log({ usuario:USER.nome, acao:`Excluiu ${aba.label}`, entidade:ATUAL, antes:'registro', depois:'—' });
    toast('Registro excluído.', { type:'ok' }); render();
  }, { title:'Excluir', okLabel:'Excluir', danger:true });
}

async function toggle(id) {
  const r = await db.get(ATUAL, id);
  await db.update(ATUAL, id, { ativo: !(r.ativo !== false) });
  render();
}

function resetAba() {
  if (!DEFAULTS[ATUAL]) return toast('Esta aba não tem versão padrão para restaurar.', { type:'info' });
  confirmDialog('Restaurar esta aba para os valores originais? Edições atuais serão substituídas.', async () => {
    const atuais = await db.list(ATUAL);
    for (const r of atuais) await db.remove(ATUAL, r.id);
    for (const r of DEFAULTS[ATUAL]) await db.insert(ATUAL, structuredClone(r));
    toast('Cadastro restaurado para o padrão.', { type:'ok' }); render();
  }, { title:'Restaurar', okLabel:'Restaurar', danger:true });
}
