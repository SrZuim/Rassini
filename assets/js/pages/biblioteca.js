/* ==========================================================================
   Biblioteca Técnica — controlador da página (SPA com troca de views)
   Views: dashboard | catalogo | ficha | editor | favoritos | recentes
   Consulta para todos os perfis; cadastro/edição gated por RBAC (can()).
   ========================================================================== */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { can, SUPABASE } from '../../../services/config.js';
import * as BIB from '../../../services/biblioteca.js';
import * as DATA from '../../../services/biblioteca-data.js';
import { fmtMedida } from '../../../services/formato.js';
const TIPO_ESPEC = DATA.BIB_TIPO_ESPEC;
const TIPO_ESPEC_MAP = DATA.BIB_TIPO_ESPEC_MAP;
import { charts, PALETTE } from '../charts.js';
import { $, $$, el, toast, modal, confirmDialog, fmtDate } from '../ui.js';
import { initEvidenceUpload } from '../evidence.js';

let USER, CAN_EDIT, CAN_DELETE;
const state = { view: 'dashboard', q: '', filtros: {}, incluirArquivadas: false, pecaId: null, tab: 'geral' };

const IMG = DATA.BIB_IMG_PLACEHOLDER;
const FILTROS_DEF = [
  ['cliente', 'Cliente', 'bib_clientes'], ['planta', 'Planta', 'bib_plantas'],
  ['familia', 'Família', 'bib_familias']
];

/* Catálogos de especificação (Característica / Equipamento / Quem Mede / Quadrante)
   carregados sob demanda para a ficha e o editor. */
let CAT = { car: [], eq: [], qm: [], quad: [] };
let MAP = { car: {}, eq: {}, qm: {} };
/* Catálogo de tipos de inspeção (fonte única) — carregado uma vez e reusado
   pelos chips da listagem, pela ficha e pelos filtros. */
let TIPOS_MAP = {};
async function loadTiposInspecao() { if (!Object.keys(TIPOS_MAP).length) TIPOS_MAP = await BIB.mapaTipos(); return TIPOS_MAP; }
async function loadCatalogos() {
  const c = await BIB.catalogosEspec();
  CAT.car = c.car; CAT.eq = c.eq; CAT.qm = c.qm;
  CAT.quad = (await db.list('bib_quadrantes').catch(() => [])).filter(x => x.ativo !== false).sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  MAP.car = c.carMap; MAP.eq = c.eqMap; MAP.qm = c.qmMap;
}

const ctx = await mountShell();
if (ctx) {
  USER = ctx.user;
  CAN_EDIT = can(USER.role, 'biblioteca', 'edit') || can(USER.role, 'biblioteca', 'create');
  CAN_DELETE = can(USER.role, 'biblioteca', 'delete');
  boot();
}

async function boot() {
  const codigo = new URLSearchParams(location.search).get('codigo');
  if (codigo) {
    const p = await BIB.porCodigo(codigo);
    if (p) { state.view = 'ficha'; state.pecaId = p.id; }
    else toast(`Peça “${codigo}” não encontrada na Biblioteca.`, { type: 'warn' });
  }
  render();
}

/* ------------------------------------------------------------ shell/nav ---- */
function pageHead() {
  const navItems = [
    ['dashboard', 'bi-grid-1x2', 'Dashboard'],
    ['catalogo', 'bi-search', 'Buscar peças'],
    ['favoritos', 'bi-star', 'Favoritos'],
    ['recentes', 'bi-clock-history', 'Recentes']
  ];
  const ativo = ['ficha', 'editor'].includes(state.view) ? '' : state.view;
  return `<div class="rna-page-head no-print"><div>
      <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Biblioteca Técnica</div>
      <h1>Biblioteca Técnica</h1><p>Toda a informação técnica das peças em um só lugar.</p></div>
      <div class="d-flex gap-2">
        ${CAN_EDIT ? `<button class="rna-btn rna-btn-primary" id="bib-nova"><i class="bi bi-plus-lg"></i> Nova peça</button>` : ''}
      </div>
    </div>
    <div class="admin-tabs no-print">
      ${navItems.map(([id, ic, lb]) => `<button class="rna-chip ${id === ativo ? 'active' : ''}" data-nav="${id}"><i class="bi ${ic}"></i> ${lb}</button>`).join('')}
    </div>`;
}

function mount(html) {
  closeCombo();   // remove qualquer painel de combobox órfão ao trocar de view
  $('#rna-content').innerHTML = pageHead() + html;
  $('#bib-nova')?.addEventListener('click', () => abrirEditor(null));
  $$('[data-nav]').forEach(b => b.addEventListener('click', () => { state.view = b.dataset.nav; state.pecaId = null; render(); }));
}

function render() {
  if (state.view === 'ficha') return renderFicha();
  if (state.view === 'editor') return renderEditor();
  if (state.view === 'catalogo') return renderCatalogo();
  if (state.view === 'favoritos') return renderFavoritos();
  if (state.view === 'recentes') return renderRecentes();
  return renderDashboard();
}

/* ------------------------------------------------------------- dashboard --- */
async function renderDashboard() {
  const ind = await BIB.indicadores();
  const kpi = (v, l, ic, cor) => `<div class="col-6 col-md-3 col-xl"><div class="rna-stat"><div class="rna-stat__icon ${cor}"><i class="bi ${ic}"></i></div><div class="rna-stat__val" style="font-size:22px">${v}</div><div class="rna-stat__label">${l}</div></div></div>`;
  mount(`
    <div class="row g-3 mb-3">
      ${kpi(ind.totalPecas, 'Peças ativas', 'bi-box-seam', 'ic-soft-blue')}
      ${kpi(ind.clientes, 'Clientes', 'bi-buildings', 'ic-soft-green')}
      ${kpi(ind.familias, 'Famílias', 'bi-diagram-2', 'ic-soft-orange')}
      ${kpi(ind.documentos, 'Documentos', 'bi-folder2-open', 'ic-soft-gray')}
      ${kpi(ind.metricas, 'Especificações', 'bi-rulers', 'ic-soft-yellow')}
      ${kpi(ind.revisoes, 'Revisões', 'bi-clock-history', 'ic-soft-blue')}
    </div>
    <div class="row g-3 mb-3">
      <div class="col-lg-6"><div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-buildings"></i> Peças por cliente</h3></div>
        <div class="rna-card__body"><div style="height:250px"><canvas id="bch-cliente"></canvas></div></div></div></div>
      <div class="col-lg-6"><div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-pie-chart"></i> Peças por status</h3></div>
        <div class="rna-card__body"><div style="height:250px"><canvas id="bch-status"></canvas></div></div></div></div>
      <div class="col-lg-6"><div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-geo-alt"></i> Peças por planta</h3></div>
        <div class="rna-card__body"><div style="height:230px"><canvas id="bch-planta"></canvas></div></div></div></div>
      <div class="col-lg-6"><div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-diagram-2"></i> Peças por família</h3></div>
        <div class="rna-card__body"><div style="height:230px"><canvas id="bch-familia"></canvas></div></div></div></div>
    </div>
    <div class="row g-3">
      <div class="col-lg-6"><div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-plus-square"></i> Últimos cadastros</h3></div>
        <div class="rna-card__body p-0">${listaPecas(ind.ultimosCadastros)}</div></div></div>
      <div class="col-lg-6"><div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-activity"></i> Últimas alterações</h3></div>
        <div class="rna-card__body p-0">${timeline(ind.ultimasAlteracoes)}</div></div></div>
    </div>`);

  const cores = [PALETTE.blue, PALETTE.green, PALETTE.orange, PALETTE.yellow, PALETTE.red, PALETTE.steel, PALETTE.gray, PALETTE.graphite];
  const dough = (id, mapa) => { const l = Object.keys(mapa); if (l.length) charts.doughnut(id, l, Object.values(mapa), cores.slice(0, l.length)); };
  dough('bch-cliente', ind.porCliente);
  dough('bch-status', ind.porStatus);
  const pl = Object.keys(ind.porPlanta); if (pl.length) charts.hbar('bch-planta', pl, [{ label: 'Peças', data: Object.values(ind.porPlanta), backgroundColor: PALETTE.blue }], { plugins: { legend: { display: false } } });
  const fm = Object.keys(ind.porFamilia); if (fm.length) charts.bar('bch-familia', fm, [{ label: 'Peças', data: Object.values(ind.porFamilia), backgroundColor: PALETTE.orange }], { plugins: { legend: { display: false } } });
  wireCards();
}

function listaPecas(pecas) {
  if (!pecas.length) return emptyState('Nenhuma peça ainda.');
  return `<div class="bib-list">${pecas.map(p => `<div class="bib-list__item" data-open="${p.id}">
    <img src="${p.imagem || IMG}" alt=""><div class="flex-fill">
      <b>${p.nome}</b><div class="cell-sub">${p.codigo} · ${p.cliente || '—'}</div></div>
    ${statusBadge(p.status)}</div>`).join('')}</div>`;
}
function timeline(hist) {
  if (!hist.length) return emptyState('Sem alterações registradas.');
  return `<div class="bib-timeline">${hist.map(h => `<div class="bib-timeline__item">
    <div class="bib-timeline__dot"></div>
    <div><b>${h.acao} ${h.campo && h.campo !== '—' ? `· ${h.campo}` : ''}</b>
      <div class="cell-sub">${h.antes !== '—' ? `${h.antes} → ` : ''}${h.depois}</div>
      <small class="text-muted-2">${h.usuario} · ${fmtDateTime(h.quando)}</small></div></div>`).join('')}</div>`;
}

/* -------------------------------------------------------------- catálogo --- */
async function renderCatalogo() {
  const tiposCat = await loadTiposInspecao().then(() => BIB.listarTipos());
  const filtrosHtml = FILTROS_DEF.map(([campo, label, tabela]) => `
    <select class="form-select form-select-sm bib-filter" data-filtro="${campo}" style="max-width:190px">
      <option value="">${label}: todos</option>
    </select>`).join('');

  mount(`
    <div class="bib-search-wrap no-print">
      <div class="bib-search">
        <i class="bi bi-search"></i>
        <input id="bib-search" type="text" autocomplete="off" placeholder="Pesquisar por código, nome, cliente, família, material, norma..." value="${escAttr(state.q)}">
        ${state.q ? `<button class="bib-search__clear" id="bib-clear" title="Limpar"><i class="bi bi-x-lg"></i></button>` : ''}
        <div class="bib-suggest" id="bib-suggest" hidden></div>
      </div>
    </div>
    <div class="bib-filters no-print">
      ${filtrosHtml}
      <select class="form-select form-select-sm bib-filter" id="bib-filtro-tipo" data-filtro="tipo_inspecao" style="max-width:230px">
        <option value="">Tipo de inspeção: todos</option>
        ${tiposCat.map(t => `<option value="${escAttr(t.slug)}" ${state.filtros.tipo_inspecao === t.slug ? 'selected' : ''}>${escHtml(t.nome)}</option>`).join('')}
        <option value="${BIB.FILTRO_SEM_TIPO}" ${state.filtros.tipo_inspecao === BIB.FILTRO_SEM_TIPO ? 'selected' : ''}>— ${escHtml(BIB.SEM_TIPOS_LABEL)}</option>
      </select>
      <label class="bib-arch"><input type="checkbox" id="bib-arch" ${state.incluirArquivadas ? 'checked' : ''}> Incluir arquivadas</label>
    </div>
    <div id="bib-results"></div>`);

  // filtro por tipo de inspeção (§9) — combina com os demais filtros (§10)
  $('#bib-filtro-tipo').addEventListener('change', e => { state.filtros.tipo_inspecao = e.target.value; refreshResults(); });

  // popula selects de filtro
  for (const [campo, , tabela] of FILTROS_DEF) {
    const opts = (await db.list(tabela)).filter(o => o.ativo !== false);
    const sel = $(`.bib-filter[data-filtro="${campo}"]`);
    opts.forEach(o => { const op = document.createElement('option'); op.value = o.nome; op.textContent = o.nome; if (state.filtros[campo] === o.nome) op.selected = true; sel.appendChild(op); });
    sel.addEventListener('change', () => { state.filtros[campo] = sel.value; refreshResults(); });
  }

  const input = $('#bib-search'), suggest = $('#bib-suggest');
  let deb;
  input.addEventListener('input', () => {
    state.q = input.value;
    clearTimeout(deb);
    deb = setTimeout(async () => { await refreshSuggest(); refreshResults(); }, 160);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { suggest.hidden = true; refreshResults(); } if (e.key === 'Escape') suggest.hidden = true; });
  input.addEventListener('focus', refreshSuggest);
  document.addEventListener('click', (e) => { if (!e.target.closest('.bib-search')) suggest.hidden = true; }, { once: false });
  $('#bib-clear')?.addEventListener('click', () => { state.q = ''; renderCatalogo(); });
  $('#bib-arch')?.addEventListener('change', (e) => { state.incluirArquivadas = e.target.checked; refreshResults(); });

  refreshResults();
  input.focus();
}

async function refreshSuggest() {
  const suggest = $('#bib-suggest'); if (!suggest) return;
  const s = await BIB.sugestoes(state.q, 8);
  if (!state.q || !s.length) { suggest.hidden = true; suggest.innerHTML = ''; return; }
  suggest.innerHTML = s.map(p => `<button class="bib-suggest__item" data-open="${p.id}">
    <img src="${p.imagem || IMG}" alt=""><span><b>${destacar(p.codigo)}</b><small>${p.nome} · ${p.cliente || '—'}</small></span>
    <i class="bi bi-arrow-return-left"></i></button>`).join('');
  suggest.hidden = false;
  wireCards(suggest);
}

async function refreshResults() {
  const box = $('#bib-results'); if (!box) return;
  const pecas = await BIB.buscar(state.q, state.filtros, { incluirArquivadas: state.incluirArquivadas });
  const favs = await BIB.favoritosDe(USER.id);
  // O chip do filtro de tipo mostra o nome amigável, nunca o slug interno.
  const rotuloFiltro = (k, v) => k !== 'tipo_inspecao' ? v
    : (v === BIB.FILTRO_SEM_TIPO ? BIB.SEM_TIPOS_LABEL : BIB.nomeDoSlug(v, TIPOS_MAP));
  const chips = Object.entries(state.filtros).filter(([, v]) => v).map(([k, v]) => `<span class="rna-badge badge-info">${escHtml(rotuloFiltro(k, v))} <i class="bi bi-x" data-rmfiltro="${k}" style="cursor:pointer"></i></span>`).join(' ');
  box.innerHTML = `
    <div class="d-flex align-items-center gap-2 mb-2 flex-wrap no-print">
      <b>${pecas.length}</b> <span class="text-muted-2">peça(s)</span> ${chips}
    </div>
    ${pecas.length ? `<div class="bib-grid">${pecas.map(p => cardPeca(p, favs.includes(p.id))).join('')}</div>` : emptyState('Nenhuma peça encontrada. Ajuste a busca ou os filtros.')}`;
  wireCards(box);
  $$('[data-rmfiltro]', box).forEach(b => b.addEventListener('click', () => { state.filtros[b.dataset.rmfiltro] = ''; const sel = $(`.bib-filter[data-filtro="${b.dataset.rmfiltro}"]`); if (sel) sel.value = ''; refreshResults(); }));
}

function cardPeca(p, fav) {
  return `<div class="bib-card" data-open="${p.id}">
    <button class="bib-card__fav ${fav ? 'is-fav' : ''}" data-fav="${p.id}" title="Favoritar"><i class="bi ${fav ? 'bi-star-fill' : 'bi-star'}"></i></button>
    <div class="bib-card__img"><img src="${p.imagem || IMG}" alt="${p.nome}"></div>
    <div class="bib-card__body">
      <div class="bib-card__code">${p.codigo}</div>
      <b class="bib-card__name">${p.nome}</b>
      <div class="cell-sub">${p.cliente || '—'} · ${p.familia || '—'}</div>
      ${tiposChipsHtml(p)}
      <div class="d-flex justify-content-between align-items-center mt-2">
        <span class="cell-sub"><i class="bi bi-geo-alt"></i> ${p.planta || '—'}</span>${statusBadge(p.status)}
      </div>
    </div></div>`;
}

/* Etiquetas dos tipos de inspeção vinculados (§9). Mostra até 2 e resume o
   restante em "+N"; o title traz a lista completa (nomes longos por extenso).
   Peça legada sem vínculo recebe o marcador "Tipo de inspeção não configurado". */
/* Na ficha há espaço: mostra TODOS os tipos com o nome completo. */
function tiposFichaHtml(p) {
  const slugs = BIB.tiposDaPeca(p);
  if (!slugs.length) {
    return `<span class="bib-chip bib-chip--warn"><i class="bi bi-exclamation-triangle"></i> ${escHtml(BIB.SEM_TIPOS_LABEL)}</span>
      <div class="cell-sub mt-1">Edite a peça e selecione ao menos um tipo para que ela apareça nas auditorias.</div>`;
  }
  return `<div class="bib-tipos-row">${slugs.map(s => `<span class="bib-chip">${escHtml(BIB.nomeDoSlug(s, TIPOS_MAP))}</span>`).join('')}</div>`;
}

const TIPOS_CHIPS_VISIVEIS = 2;
function tiposChipsHtml(p) {
  const slugs = BIB.tiposDaPeca(p);
  if (!slugs.length) {
    return `<div class="bib-tipos-row"><span class="bib-chip bib-chip--warn" title="${escAttr(BIB.SEM_TIPOS_LABEL)}">
      <i class="bi bi-exclamation-triangle"></i> ${escHtml(BIB.SEM_TIPOS_LABEL)}</span></div>`;
  }
  const nomes = slugs.map(s => BIB.nomeDoSlug(s, TIPOS_MAP));
  const visiveis = slugs.slice(0, TIPOS_CHIPS_VISIVEIS)
    .map((s, i) => `<span class="bib-chip" title="${escAttr(nomes[i])}">${escHtml(BIB.curtoDoSlug(s, TIPOS_MAP))}</span>`).join('');
  const resto = slugs.length - TIPOS_CHIPS_VISIVEIS;
  const maisChip = resto > 0
    ? `<span class="bib-chip bib-chip--more" title="${escAttr(nomes.slice(TIPOS_CHIPS_VISIVEIS).join(' · '))}">+${resto}</span>` : '';
  return `<div class="bib-tipos-row" title="${escAttr(nomes.join(' · '))}">${visiveis}${maisChip}</div>`;
}

/* ---------------------------------------------------------------- ficha ---- */
async function renderFicha() {
  const f = await BIB.ficha(state.pecaId);
  if (!f) { state.view = 'catalogo'; toast('Peça não encontrada.', { type: 'warn' }); return render(); }
  await Promise.all([loadCatalogos(), loadTiposInspecao()]);
  BIB.registrarRecente(USER.id, f.peca.id);
  const p = f.peca;
  const fav = await BIB.ehFavorito(USER.id, p.id);
  const alertas = f.metricas.filter(BIB.foraDePadrao).length;
  if (['metricas', 'material'].includes(state.tab)) state.tab = 'especificacoes';

  if (state.tab === 'pontos') state.tab = 'especificacoes';   // aba removida
  const tabs = [
    ['geral', 'bi-info-circle', 'Geral'],
    ['especificacoes', 'bi-rulers', `Especificações${alertas ? ` <span class="rna-badge badge-crit">${alertas}</span>` : ''}`],
    ['documentos', 'bi-folder2-open', 'Documentos'],
    ['historico', 'bi-activity', 'Histórico'],
    ['revisoes', 'bi-clock-history', 'Revisões']
  ];
  const galeria = [p.imagem, ...(Array.isArray(p.galeria) ? p.galeria : [])].filter(Boolean);

  mount(`
    <div class="bib-ficha">
      <div class="bib-ficha__head">
        <div class="bib-ficha__media">
          <img src="${galeria[0] || IMG}" id="bib-main-img" alt="${p.nome}">
          ${galeria.length > 1 ? `<div class="bib-ficha__gallery">${galeria.map((g, i) => `<img src="${g}" data-gal="${i}" class="${i === 0 ? 'active' : ''}">`).join('')}</div>` : ''}
        </div>
        <div class="bib-ficha__info">
          <div class="d-flex align-items-center gap-2 flex-wrap">
            <span class="bib-ficha__code">${p.codigo}</span>${statusBadge(p.status)}
            ${p.revisao_desenho != null && p.revisao_desenho !== '' ? `<span class="rna-badge badge-info" title="Revisão do Desenho (Engenharia)">Desenho Rev ${String(p.revisao_desenho).padStart(2, '0')}</span>` : ''}
            <span class="rna-badge badge-na" title="Revisão do Cadastro (RNA One)">Cadastro Rev ${String(p.revisao_cadastro ?? p.revisao ?? 1).padStart(2, '0')}</span>
          </div>
          <h2>${p.nome}</h2>
          <div class="bib-ficha__meta">
            ${metaChip('bi-buildings', p.cliente)} ${metaChip('bi-diagram-2', p.familia)}
            ${metaChip('bi-geo-alt', p.planta)}
            ${metaChip('bi-file-earmark-ruled', p.numero_ad)}
          </div>
          <div class="bib-ficha__actions no-print">
            <button class="rna-btn ${fav ? 'rna-btn-primary' : 'rna-btn-ghost'}" id="bib-fav"><i class="bi ${fav ? 'bi-star-fill' : 'bi-star'}"></i> ${fav ? 'Favoritada' : 'Favoritar'}</button>
            <button class="rna-btn rna-btn-ghost" id="bib-print"><i class="bi bi-printer"></i> Imprimir</button>
            ${CAN_EDIT ? `<button class="rna-btn rna-btn-ghost" id="bib-edit"><i class="bi bi-pencil"></i> Editar</button>
            <button class="rna-btn rna-btn-ghost" id="bib-dup"><i class="bi bi-files"></i> Duplicar</button>
            ${p.ativo === false
              ? `<button class="rna-btn rna-btn-ghost" id="bib-restore"><i class="bi bi-arrow-counterclockwise"></i> Restaurar</button>`
              : `<button class="rna-btn rna-btn-ghost" id="bib-archive"><i class="bi bi-archive"></i> Arquivar</button>`}` : ''}
            ${CAN_DELETE ? `<button class="rna-btn rna-btn-ghost text-danger" id="bib-del"><i class="bi bi-trash"></i> Excluir</button>` : ''}
            <button class="rna-btn rna-btn-ghost" id="bib-voltar"><i class="bi bi-arrow-left"></i> Voltar</button>
          </div>
        </div>
        <div class="bib-ficha__qr">
          <div id="bib-qr"></div>
          <small class="text-muted-2">Escaneie para abrir a ficha</small>
        </div>
      </div>
      <div class="bib-tabs no-print">${tabs.map(([id, ic, lb]) => `<button class="bib-tab ${state.tab === id ? 'active' : ''}" data-tab="${id}"><i class="bi ${ic}"></i> ${lb}</button>`).join('')}</div>
      <div class="bib-tabpane" id="bib-tabpane">${tabPane(state.tab, f)}</div>
    </div>`);

  // QR
  try { if (window.QRCode) { $('#bib-qr').innerHTML = ''; new window.QRCode($('#bib-qr'), { text: BIB.qrPayload(p), width: 116, height: 116, colorDark: '#1b1d21', colorLight: '#ffffff' }); } } catch { /* noop */ }

  // galeria
  $$('[data-gal]').forEach(t => t.addEventListener('click', () => { $('#bib-main-img').src = galeria[+t.dataset.gal]; $$('[data-gal]').forEach(x => x.classList.remove('active')); t.classList.add('active'); }));
  // tabs
  $$('[data-tab]').forEach(b => b.addEventListener('click', () => { state.tab = b.dataset.tab; $('#bib-tabpane').innerHTML = tabPane(state.tab, f); wireTabPane(f); $$('[data-tab]').forEach(x => x.classList.toggle('active', x === b)); }));
  wireTabPane(f);
  // ações
  $('#bib-voltar').addEventListener('click', () => { state.view = 'catalogo'; render(); });
  $('#bib-print').addEventListener('click', () => window.print());
  $('#bib-fav').addEventListener('click', async () => { await BIB.alternarFavorito(USER.id, p.id); renderFicha(); });
  $('#bib-edit')?.addEventListener('click', () => abrirEditor(p.id));
  $('#bib-dup')?.addEventListener('click', () => confirmDialog(`Duplicar a peça ${p.codigo}?`, async () => { const nova = await BIB.duplicar(p.id, USER); toast('Peça duplicada.', { type: 'ok' }); state.pecaId = nova.id; renderFicha(); }, { title: 'Duplicar peça', okLabel: 'Duplicar' }));
  $('#bib-archive')?.addEventListener('click', () => confirmDialog(`Arquivar ${p.codigo}? Ela sairá da busca padrão.`, async () => { await BIB.arquivar(p.id, USER); toast('Peça arquivada.', { type: 'ok' }); renderFicha(); }, { title: 'Arquivar peça', okLabel: 'Arquivar', danger: true }));
  $('#bib-restore')?.addEventListener('click', async () => { await BIB.restaurar(p.id, USER); toast('Peça restaurada.', { type: 'ok' }); renderFicha(); });
  $('#bib-del')?.addEventListener('click', () => confirmDialog(`Excluir definitivamente ${p.codigo}? Esta ação não pode ser desfeita.`, async () => { await excluirPeca(p.id); }, { title: 'Excluir peça', okLabel: 'Excluir', danger: true }));
}

function tabPane(tab, f) {
  const p = f.peca;
  if (tab === 'geral') {
    const desenho = f.documentos.find(d => (d.categoria === 'Desenho')) || null;
    const anexo = desenho
      ? (desenho.url ? `<a href="${desenho.url}" target="_blank" rel="noopener"><i class="bi ${docIcon(desenho.tipo)}"></i> ${desenho.nome}</a>` : desenho.nome)
      : '<span class="cell-sub">Nenhum desenho anexado</span>';
    return cardTabela([
      ['Código da peça', p.codigo], ['Nome da peça', p.nome], ['Cliente', p.cliente], ['Família', p.familia],
      ['Planta', p.planta],
      ['Revisão do Desenho', p.revisao_desenho != null && p.revisao_desenho !== '' ? `Rev ${String(p.revisao_desenho).padStart(2, '0')}` : ''],
      ['Data da Revisão do Desenho', fmtDate(p.data_revisao_desenho)],
      ['Número da AD', p.numero_ad],
      ['Tipos de inspeção aplicáveis', tiposFichaHtml(p)],
      ['Anexo do Desenho', anexo],
      ['Revisão do Cadastro', `Rev ${String(p.revisao_cadastro ?? p.revisao ?? 1).padStart(2, '0')}`],
      ['Criado em', fmtDate(p.created_at)], ['Atualizado em', fmtDate(p.updated_at)]
    ]);
  }
  if (tab === 'especificacoes') {
    if (!f.metricas.length) return emptyState('Nenhuma especificação cadastrada.');
    const alertas = f.metricas.filter(BIB.foraDePadrao).length;
    const dimCells = m => {
      if (BIB.ehAtributo(m.tipo_especificacao)) return `<td colspan="3" class="cell-sub" style="text-align:center">OK / NOK (atributo)</td>`;
      if (BIB.ehInformativo(m.tipo_especificacao)) return `<td colspan="3" class="cell-sub" style="text-align:center"><i class="bi bi-info-circle"></i> Informativa</td>`;
      return `<td>${fmtVal(m.nominal)}</td><td>${fmtVal(m.tol_min)}</td><td>${fmtVal(m.tol_max)}</td>`;
    };
    return `${alertas ? `<div class="bib-alert"><i class="bi bi-exclamation-triangle-fill"></i> ${alertas} especificação(ões) com valor nominal fora da faixa de tolerância.</div>` : ''}
    <div class="rna-card"><div class="rna-card__body p-0" style="overflow:auto"><table class="rna-table"><thead><tr>
      <th>Cota</th><th>Característica</th><th>Quadrante</th><th>Referência</th><th>Nominal</th><th>Tol. mín</th><th>Tol. máx</th><th>Un.</th><th>Equipamento de Medição</th><th>Quem Mede</th><th>Observação</th></tr></thead><tbody>
      ${f.metricas.map(m => { const fora = BIB.foraDePadrao(m); const t = TIPO_ESPEC_MAP[m.tipo_especificacao]; return `<tr class="${fora ? 'bib-metric--fora' : ''}">
        <td class="cell-strong">${fmtCota(m.cota)}</td>
        <td class="cell-strong">${MAP.car[m.caracteristica_id] || '—'}${t ? ` <span class="bib-tipo-badge" title="${t.titulo}">${t.titulo}</span>` : ''}${fora ? ' <i class="bi bi-exclamation-triangle-fill text-danger" title="Fora do padrão"></i>' : ''}</td>
        <td class="cell-sub">${m.quadrante || '—'}</td>
        <td class="cell-sub">${m.referencia || '—'}</td>
        ${dimCells(m)}<td>${m.unidade || '—'}</td>
        <td class="cell-sub">${MAP.eq[m.equipamento_id] || '—'}</td><td class="cell-sub">${MAP.qm[m.quem_mede_id] || '—'}</td><td class="cell-sub">${m.observacao || '—'}</td></tr>`; }).join('')}
    </tbody></table></div></div>`;
  }
  if (tab === 'documentos') {
    if (!f.documentos.length) return emptyState('Nenhum documento anexado.');
    return `<div class="rna-card"><div class="rna-card__body p-0" style="overflow:auto"><table class="rna-table"><thead><tr>
      <th>Documento</th><th>Categoria</th><th>Versão</th><th>Data</th><th>Responsável</th><th></th></tr></thead><tbody>
      ${f.documentos.map(d => `<tr><td class="cell-strong"><i class="bi ${docIcon(d.tipo)}"></i> ${d.nome}<div class="cell-sub">${d.descricao || ''} ${d.tamanho ? `· ${d.tamanho}` : ''}</div></td>
        <td>${d.categoria || '—'}</td><td>${d.versao || '—'}</td><td class="cell-sub">${fmtDate(d.data)}</td><td class="cell-sub">${d.responsavel || '—'}</td>
        <td class="text-end no-print">${d.url ? `<a class="rna-btn rna-btn-ghost rna-btn-sm" href="${d.url}" target="_blank" rel="noopener"><i class="bi bi-eye"></i></a>
          <a class="rna-btn rna-btn-ghost rna-btn-sm" href="${d.url}" download><i class="bi bi-download"></i></a>` : '<span class="cell-sub">sem arquivo</span>'}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  }
  if (tab === 'historico') return `<div class="rna-card"><div class="rna-card__body">${timeline(f.historico)}</div></div>`;
  if (tab === 'revisoes') {
    if (!f.versoes.length) return emptyState('Nenhuma revisão anterior. A ficha está na primeira versão.');
    return `<div class="rna-card"><div class="rna-card__body p-0" style="overflow:auto"><table class="rna-table"><thead><tr>
      <th>Revisão</th><th>Resumo</th><th>Por</th><th>Quando</th><th></th></tr></thead><tbody>
      ${f.versoes.map(v => `<tr><td class="cell-strong">Rev ${String(v.revisao).padStart(2, '0')}</td><td>${v.resumo || '—'}</td>
        <td class="cell-sub">${v.usuario}</td><td class="cell-sub">${fmtDateTime(v.quando)}</td>
        <td class="text-end no-print">${CAN_EDIT ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-restore="${v.id}"><i class="bi bi-arrow-counterclockwise"></i> Restaurar</button>` : ''}</td></tr>`).join('')}
    </tbody></table></div></div>`;
  }
  return '';
}

function wireTabPane(f) {
  $$('[data-restore]').forEach(b => b.addEventListener('click', () => confirmDialog('Restaurar esta revisão? Uma nova revisão será criada com o conteúdo anterior.', async () => {
    await BIB.restaurarVersao(f.peca.id, b.dataset.restore, USER); toast('Revisão restaurada.', { type: 'ok' }); renderFicha();
  }, { title: 'Restaurar revisão', okLabel: 'Restaurar' })));
}

/* -------------------------------------------------------- favoritos/recentes */
async function renderFavoritos() {
  const ids = await BIB.favoritosDe(USER.id);
  const todas = await BIB.listarPecas({ incluirArquivadas: true });
  const pecas = todas.filter(p => ids.includes(p.id));
  mount(`<div class="rna-card mb-3"><div class="rna-card__body d-flex align-items-center gap-2"><i class="bi bi-star-fill text-yellow" style="font-size:20px"></i>
    <b>Minhas peças favoritas</b><span class="rna-badge badge-info ms-1">${pecas.length}</span></div></div>
    ${pecas.length ? `<div class="bib-grid">${pecas.map(p => cardPeca(p, true)).join('')}</div>` : emptyState('Você ainda não favoritou nenhuma peça. Abra uma ficha e toque na estrela.')}`);
  wireCards();
}

async function renderRecentes() {
  const ids = BIB.recentesIds(USER.id);
  const todas = await BIB.listarPecas({ incluirArquivadas: true });
  const byId = Object.fromEntries(todas.map(p => [p.id, p]));
  const pecas = ids.map(id => byId[id]).filter(Boolean);
  const favs = await BIB.favoritosDe(USER.id);
  mount(`<div class="rna-card mb-3"><div class="rna-card__body d-flex align-items-center gap-2"><i class="bi bi-clock-history" style="font-size:20px"></i>
    <b>Peças abertas recentemente</b><span class="rna-badge badge-info ms-1">${pecas.length}</span></div></div>
    ${pecas.length ? `<div class="bib-grid">${pecas.map(p => cardPeca(p, favs.includes(p.id))).join('')}</div>` : emptyState('Nenhuma peça aberta recentemente neste dispositivo.')}`);
  wireCards();
}

/* --------------------------------------------------------------- editor ---- */
let edMetricas = [], edDocsNovos = [];
/* Tipos de inspeção aplicáveis em edição (array de slugs canônicos, §2). */
let edTipos = [];
function abrirEditor(pecaId) { state.view = 'editor'; state.pecaId = pecaId; render(); }

async function renderEditor() {
  const isNew = !state.pecaId;
  let p = { status: 'Em revisão', revisao: 1, ativo: true, galeria: [] };
  let f = null;
  if (!isNew) { f = await BIB.ficha(state.pecaId); if (!f) { state.view = 'catalogo'; return render(); } p = f.peca; }
  await loadCatalogos();
  // enriquece especificações com nomes resolvidos (para os combos)
  edMetricas = f ? f.metricas.map(m => ({
    id: m.id,                              // usado no diff do salvamento (não recria o que não mudou)
    cota: m.cota ?? '', quadrante: m.quadrante || '',
    tipo_especificacao: m.tipo_especificacao || 'TOLERANCIA',
    caracteristica_id: m.caracteristica_id || null, caracteristica_nome: MAP.car[m.caracteristica_id] || '',
    referencia: m.referencia || '',
    nominal: m.nominal ?? '', superior: m.superior ?? '', inferior: m.inferior ?? '',
    tol_simetrica: m.tol_simetrica ?? '', simetrica: m.tol_simetrica != null && m.tol_simetrica !== '',
    tol_min: m.tol_min ?? '', tol_max: m.tol_max ?? '', unidade: m.unidade || '',
    equipamento_id: m.equipamento_id || null, equipamento_nome: MAP.eq[m.equipamento_id] || '',
    quem_mede_id: m.quem_mede_id || null, quem_mede_nome: MAP.qm[m.quem_mede_id] || '', observacao: m.observacao || '',
    obrigatorio: !!m.obrigatorio          // preserva a marcação ao reeditar a peça
  })) : [];
  edDocsNovos = [];

  const [cli, pla, fam] = await Promise.all(['bib_clientes', 'bib_plantas', 'bib_familias'].map(t => db.list(t)));
  // Tipos de inspeção aplicáveis (§2) — catálogo vem da fonte única (insp_tipos).
  const tiposCat = await BIB.listarTipos();
  /* Avisa ANTES de o usuário preencher o formulário, não depois de salvar: se o
     banco está atrás da migration, o vínculo não tem onde ser gravado. */
  const migracaoTiposOk = await BIB.checarColunaTipos();
  edTipos = BIB.tiposDaPeca(p);              // seleção atual (vazia em peça nova/legada)
  /* Catálogos: só as opções ATIVAS aparecem para novos cadastros. Mas se a peça
     já usa um valor hoje inativo (ex.: cliente "Randon", fora da lista oficial
     §M05), ele entra como opção LEGADA — do contrário, abrir a peça para editar
     apagaria silenciosamente o vínculo. Mesmo tratamento já dado a Planta. */
  const opt = (arr, val) => {
    const ativos = arr.filter(o => o.ativo !== false);
    const legado = val && !ativos.some(o => o.nome === val) ? `<option selected>${escHtml(val)}</option>` : '';
    return `<option value="">—</option>` + legado
      + ativos.map(o => `<option ${o.nome === val ? 'selected' : ''}>${o.nome}</option>`).join('');
  };
  const inp = (campo, label, val, type = 'text', req = false) => `<div class="col-md-4"><label class="form-label">${label}${req ? ' *' : ''}</label><input class="form-control" data-p="${campo}" type="${type}" value="${escAttr(val)}"${req ? ' required' : ''}></div>`;
  const selc = (campo, label, arr, val) => `<div class="col-md-4"><label class="form-label">${label}</label><select class="form-select" data-p="${campo}">${opt(arr, val)}</select></div>`;
  // Planta — lista fixa (catálogo). Inclui o valor legado como opção extra p/ não
  // perder o dado de peças antigas cadastradas antes da padronização.
  const plantaSelect = (arr, val) => {
    const ativos = arr.filter(o => o.ativo !== false);
    const legado = val && !ativos.some(o => o.nome === val) ? `<option selected>${escHtml(val)}</option>` : '';
    return `<div class="col-md-4"><label class="form-label">Planta *</label>
      <select class="form-select" data-p="planta" required>
        <option value="">Selecione…</option>${legado}
        ${ativos.map(o => `<option ${o.nome === val ? 'selected' : ''}>${o.nome}</option>`).join('')}
      </select></div>`;
  };

  mount(`
    <div class="rna-card mb-3"><div class="rna-card__body d-flex align-items-center gap-2">
      <i class="bi bi-pencil-square" style="font-size:20px;color:var(--rna-yellow-600)"></i>
      <b>${isNew ? 'Nova peça' : `Editar ${p.codigo}`}</b>
      ${!isNew ? `<span class="rna-badge badge-na ms-1">Cadastro Rev ${String(p.revisao_cadastro ?? p.revisao ?? 1).padStart(2, '0')} → salvar cria Rev ${String((p.revisao_cadastro ?? p.revisao ?? 1) + 1).padStart(2, '0')}</span>` : ''}
    </div></div>

    <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-info-circle"></i> Informações gerais</h3></div>
      <div class="rna-card__body"><div class="row g-3">
        ${inp('codigo', 'Código da peça', p.codigo, 'text', true)}${inp('nome', 'Nome da peça', p.nome, 'text', true)}
        ${selc('cliente', 'Cliente', cli, p.cliente)}
        ${selc('familia', 'Família', fam, p.familia)}${plantaSelect(pla, p.planta)}
        ${inp('revisao_desenho', 'Revisão do Desenho', p.revisao_desenho, 'number', true)}${inp('data_revisao_desenho', 'Data da Revisão do Desenho', p.data_revisao_desenho, 'date', true)}${inp('numero_ad', 'Número da AD', p.numero_ad)}
        ${tiposInspecaoField(tiposCat, migracaoTiposOk)}
        <div class="col-md-4"><label class="form-label">Status</label><select class="form-select" data-p="status">${DATA.BIB_STATUS.map(s => `<option ${s === p.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div class="col-md-4"><label class="form-label">Revisão do Cadastro</label>
          <input class="form-control" value="Rev ${String(p.revisao_cadastro ?? p.revisao ?? 1).padStart(2, '0')}" disabled>
          <small class="text-muted-2" style="font-size:11px">Incrementada automaticamente a cada revisão salva.</small></div>
        <div class="col-12"><label class="form-label">Anexo do Desenho e demais documentos (PDF, DWG, DXF, imagem, Excel, Word)</label>
          ${f && f.documentos.length ? `<div class="mb-2">${f.documentos.map(d => `<span class="rna-badge badge-info me-1"><i class="bi ${docIcon(d.tipo)}"></i> ${d.nome}</span>`).join('')}</div>` : ''}
          <div class="bib-doc-drop" id="ed-doc-drop"><i class="bi bi-cloud-arrow-up"></i> Selecionar arquivos <input type="file" id="ed-doc-input" accept=".pdf,.dwg,.dxf,.xls,.xlsx,.doc,.docx,.png,.jpg,.jpeg,.webp,.zip,image/*" multiple hidden></div>
          <div id="ed-doc-list" class="mt-2"></div></div>
      </div></div></div>

    <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-image"></i> Imagem principal</h3></div>
      <div class="rna-card__body"><div id="ed-img"></div>
        ${p.imagem ? `<div class="mt-2 d-flex align-items-center gap-2"><img src="${p.imagem}" style="height:54px;border-radius:8px"><small class="text-muted-2">Imagem atual — envie uma nova para substituir.</small></div>` : ''}
      </div></div>

    <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-rulers"></i> Especificações</h3>
      <div class="d-flex align-items-center gap-2"><small class="text-muted-2 d-none d-lg-block">Clique no <b>tipo</b> para o cadastro inteligente · Enter: nova linha · cole do Excel</small>
      <button class="rna-btn rna-btn-ghost rna-btn-sm" id="ed-add-metrica"><i class="bi bi-plus-lg"></i> Adicionar</button></div></div>
      <div class="rna-card__body p-0" style="overflow:auto"><table class="rna-table bib-edit-table bib-espec-table" id="ed-metricas"></table></div></div>

    <div class="d-flex gap-2 justify-content-end mb-4 no-print">
      <button class="rna-btn rna-btn-ghost" id="ed-cancel">Cancelar</button>
      <button class="rna-btn rna-btn-primary rna-btn-lg" id="ed-save"><i class="bi bi-check2"></i> ${isNew ? 'Cadastrar peça' : 'Salvar revisão'}</button>
    </div>`);

  const upImg = initEvidenceUpload($('#ed-img'), { label: 'Imagem principal da peça', multiple: false });
  renderEspecRows();
  wireTiposInspecao(tiposCat);

  $('#ed-add-metrica').addEventListener('click', () => { edMetricas.push(blankSpec()); renderEspecRows(); focusRow(edMetricas.length - 1); });

  const dropInput = $('#ed-doc-input');
  $('#ed-doc-drop').addEventListener('click', () => dropInput.click());
  dropInput.addEventListener('change', () => { edDocsNovos.push(...[...dropInput.files]); dropInput.value = ''; renderDocList(); });

  $('#ed-cancel').addEventListener('click', () => { if (isNew) { state.view = 'catalogo'; } else { state.view = 'ficha'; } render(); });
  $('#ed-save').addEventListener('click', () => salvar(isNew, p, f, upImg));
}

/* =============================== TIPOS DE INSPEÇÃO APLICÁVEIS (§2, §3, §13)
   Seleção múltipla obrigatória. Sem texto livre: as opções vêm da fonte única
   (insp_tipos via BIB.listarTipos). Cada opção selecionada vira um chip
   removível; o estado fica em `edTipos` (array de slugs canônicos).
   Ocupa 2 colunas no desktop (nomes longos como o do PPAP ficam legíveis) e
   100% no mobile, seguindo a mesma grade Bootstrap do restante do formulário. */
function tiposInspecaoField(tiposCat, migracaoOk = true) {
  return `<div class="col-md-8">
    <label class="form-label" for="ed-tipos-add">Tipos de inspeção aplicáveis *</label>
    ${migracaoOk ? '' : `<div class="bib-multi__err mb-2"><i class="bi bi-database-exclamation"></i> ${escHtml(BIB.MSG_MIGRACAO_TIPOS)}</div>`}
    <div class="bib-multi" id="ed-tipos-box">
      <div class="bib-multi__chips" id="ed-tipos-chips"></div>
      <select class="form-select bib-multi__add" id="ed-tipos-add">
        <option value="">Adicionar tipo de inspeção…</option>
        ${tiposCat.map(t => `<option value="${escAttr(t.slug)}">${escHtml(t.nome)}</option>`).join('')}
      </select>
    </div>
    <small class="text-muted-2" style="font-size:11px">A peça só aparecerá nas auditorias dos tipos selecionados.</small>
    <div class="bib-multi__err" id="ed-tipos-err" hidden></div>
  </div>`;
}

/** Liga o componente: pinta os chips, adiciona e remove seleções. */
function wireTiposInspecao(tiposCat) {
  const chips = $('#ed-tipos-chips'), add = $('#ed-tipos-add');
  if (!chips || !add) return;
  const pintar = () => {
    chips.innerHTML = edTipos.length
      ? edTipos.map(s => {
          const t = tiposCat.find(x => x.slug === s);
          return `<span class="bib-chip" title="${escAttr(t?.nome || s)}">${escHtml(t?.curto || s)}
            <button type="button" class="bib-chip__x" data-rmtipo="${escAttr(s)}" aria-label="Remover ${escAttr(t?.nome || s)}"><i class="bi bi-x"></i></button></span>`;
        }).join('')
      : `<span class="bib-multi__ph">Nenhum tipo selecionado</span>`;
    // some do select o que já está escolhido (evita duplicidade)
    Array.from(add.options).forEach(o => { if (o.value) o.hidden = edTipos.includes(o.value); });
    $$('[data-rmtipo]', chips).forEach(b => b.addEventListener('click', () => {
      edTipos = edTipos.filter(x => x !== b.dataset.rmtipo); pintar(); limparErroTipos();
    }));
  };
  add.addEventListener('change', () => {
    const v = add.value; add.value = '';
    if (!v || edTipos.includes(v)) return;
    edTipos = BIB.normalizarParaGravar([...edTipos, v]);   // ordem canônica
    pintar(); limparErroTipos();
  });
  pintar();
}
const limparErroTipos = () => { const e = $('#ed-tipos-err'); if (e) { e.hidden = true; } $('#ed-tipos-box')?.classList.remove('is-invalid'); };
/** Erro visual no próprio campo (§3 "visualmente no formulário"). */
function mostrarErroTipos(msg) {
  const e = $('#ed-tipos-err'), box = $('#ed-tipos-box');
  if (e) { e.textContent = msg; e.hidden = false; }
  box?.classList.add('is-invalid');
  box?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

/* Tabela de Especificações — nova ordem: Cota · Característica · Quadrante ·
   Referência · Tipo · Nominal · Tol.mín · Tol.máx · Un. · Equip. · Quem Mede · Obs.
   Nominal/limites são calculados no cadastro inteligente (modal do "Tipo") e
   exibidos aqui como leitura. Índices data-col == índice em ESPEC_FIELDS. */
const ESPEC_FIELDS = ['cota', 'caracteristica_nome', 'quadrante', 'referencia', 'nominal', 'tol_min', 'tol_max', 'unidade', 'equipamento_nome', 'quem_mede_nome', 'observacao'];
const QUEM_MEDE_FIXO = DATA.BIB_QUEM_MEDE.map(x => x.nome);
function renderEspecRows() {
  const cols = ['Cota', 'Característica', 'Quadrante', 'Referência', 'Tipo', 'Nominal', 'Tol. mín', 'Tol. máx', 'Un.', 'Equipamento de Medição', 'Quem Mede', 'Observação', ''];
  const head = `<thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>`;
  const cell = (m, i, field, col, w) => `<input class="form-control form-control-sm bib-cell" data-mf="${field}" data-col="${col}" value="${escAttr(m[field])}"${w ? ` style="width:${w}px"` : ''}${field === 'cota' ? ' inputmode="decimal"' : ''}>`;
  const combo = (m, i, kind, field, col, w) => `<div class="bib-combo"><input class="form-control form-control-sm bib-cell bib-combo__input" data-combo="${kind}" data-row="${i}" data-col="${col}" value="${escAttr(m[field])}" autocomplete="off"${w ? ` style="width:${w}px"` : ''} placeholder="Buscar..."></div>`;
  const qmCell = (m, i) => { const legado = m.quem_mede_nome && !QUEM_MEDE_FIXO.includes(m.quem_mede_nome) ? `<option selected>${escHtml(m.quem_mede_nome)}</option>` : '';
    return `<select class="form-select form-select-sm bib-qm" data-row="${i}" style="width:160px"><option value="">—</option>${legado}${QUEM_MEDE_FIXO.map(n => `<option ${n === m.quem_mede_nome ? 'selected' : ''}>${n}</option>`).join('')}</select>`; };
  const tipoBtn = (m, i) => { const t = TIPO_ESPEC_MAP[m.tipo_especificacao] || TIPO_ESPEC_MAP.TOLERANCIA;
    return `<button type="button" class="bib-tipo-btn" data-tipo="${i}" title="Definir tipo e valores"><i class="bi ${t.icon}"></i> ${t.titulo}</button>`; };
  const roCell = v => `<td class="bib-ro">${v == null || v === '' ? '<span class="cell-sub">-</span>' : fmtVal(v)}</td>`;
  const row = (m, i) => {
    const lim = BIB.calcularLimites(m);
    const info = BIB.ehInformativo(m.tipo_especificacao), attr = BIB.ehAtributo(m.tipo_especificacao);
    const dim = (info || attr)
      ? `<td class="bib-ro" colspan="3" style="text-align:center"><span class="cell-sub">${attr ? 'OK / NOK' : 'informativa'}</span></td>`
      : `${roCell(m.nominal)}${roCell(lim.tol_min)}${roCell(lim.tol_max)}`;
    return `<tr data-mrow="${i}">
    <td>${cell(m, i, 'cota', 0, 52)}</td>
    <td>${combo(m, i, 'car', 'caracteristica_nome', 1, 180)}</td>
    <td>${cell(m, i, 'quadrante', 2, 78)}</td>
    <td>${cell(m, i, 'referencia', 3, 110)}</td>
    <td>${tipoBtn(m, i)}</td>
    ${dim}
    <td>${cell(m, i, 'unidade', 7, 56)}</td>
    <td>${combo(m, i, 'eq', 'equipamento_nome', 8, 180)}</td>
    <td>${qmCell(m, i)}</td>
    <td>${cell(m, i, 'observacao', 10, 120)}</td>
    <td class="bib-row-actions">
      <button class="rna-icon-mini" data-mup="${i}" title="Subir"><i class="bi bi-chevron-up"></i></button>
      <button class="rna-icon-mini" data-mdown="${i}" title="Descer"><i class="bi bi-chevron-down"></i></button>
      <button class="rna-icon-mini" data-mdup="${i}" title="Duplicar linha"><i class="bi bi-files"></i></button>
      <button class="rna-icon-mini" data-mdel="${i}" title="Excluir linha"><i class="bi bi-trash text-danger"></i></button>
    </td></tr>`; };
  const t = $('#ed-metricas');
  t.innerHTML = head + `<tbody>${edMetricas.map(row).join('') || `<tr><td colspan="13" class="cell-sub" style="padding:14px">Nenhuma especificação. Clique em “Adicionar”, defina o <b>Tipo</b> e os valores, ou <b>cole</b> várias do Excel.</td></tr>`}</tbody>`;
  // campos simples
  t.querySelectorAll('[data-mrow]').forEach(tr => { const i = +tr.dataset.mrow; tr.querySelectorAll('[data-mf]').forEach(inp => inp.addEventListener('input', () => { edMetricas[i][inp.dataset.mf] = inp.value; })); });
  wireCombos(t);
  // quem mede (lista fixa)
  $$('.bib-qm', t).forEach(sel => sel.addEventListener('change', () => { edMetricas[+sel.dataset.row].quem_mede_nome = sel.value; }));
  // tipo (cadastro inteligente)
  $$('[data-tipo]', t).forEach(b => b.addEventListener('click', () => abrirTipoModal(+b.dataset.tipo)));
  // ações de linha
  $$('[data-mup]', t).forEach(b => b.addEventListener('click', () => moveSpec(+b.dataset.mup, -1)));
  $$('[data-mdown]', t).forEach(b => b.addEventListener('click', () => moveSpec(+b.dataset.mdown, 1)));
  $$('[data-mdup]', t).forEach(b => b.addEventListener('click', () => { const i = +b.dataset.mdup; edMetricas.splice(i + 1, 0, clone(edMetricas[i])); renderEspecRows(); }));
  $$('[data-mdel]', t).forEach(b => b.addEventListener('click', () => { edMetricas.splice(+b.dataset.mdel, 1); renderEspecRows(); }));
  // teclado (Enter/Tab) e colar
  t.querySelectorAll('.bib-cell').forEach(inp => inp.addEventListener('keydown', e => especKeydown(e, inp)));
  if (!t._pasteWired) { t._pasteWired = true; t.addEventListener('paste', onEspecPaste); }
}

function addSpecAfter(i) { edMetricas.splice(i + 1, 0, blankSpec()); renderEspecRows(); focusRow(i + 1, 0); }
function moveSpec(i, dir) { const j = i + dir; if (j < 0 || j >= edMetricas.length) return; [edMetricas[i], edMetricas[j]] = [edMetricas[j], edMetricas[i]]; renderEspecRows(); focusRow(j, 0); }
function focusRow(i, col = 0) { const inp = document.querySelector(`#ed-metricas [data-mrow="${i}"] [data-col="${col}"]`); if (inp) { inp.focus(); inp.select?.(); } }

function especKeydown(e, inp) {
  const tr = inp.closest('[data-mrow]'); if (!tr) return;
  const i = +tr.dataset.mrow, col = +inp.dataset.col;
  if (e.key === 'Enter') { e.preventDefault(); addSpecAfter(i); }
  else if (e.key === 'Tab' && !e.shiftKey && col === 10 && i === edMetricas.length - 1) { e.preventDefault(); addSpecAfter(i); }
}

function onEspecPaste(e) {
  const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
  if (!/[\t\n]/.test(text)) return;                 // valor único → cola normal
  e.preventDefault();
  const cell = e.target.closest('.bib-cell'); if (!cell) return;
  const tr = cell.closest('[data-mrow]');
  const startRow = tr ? +tr.dataset.mrow : Math.max(edMetricas.length - 1, 0);
  const startCol = +cell.dataset.col || 0;
  const lines = text.replace(/\r/g, '').split('\n'); if (lines.length && lines[lines.length - 1] === '') lines.pop();
  lines.forEach((line, r) => {
    const cells = line.split('\t'); const idx = startRow + r;
    while (edMetricas.length <= idx) edMetricas.push(blankSpec());
    cells.forEach((val, c) => { const fi = startCol + c; if (fi < ESPEC_FIELDS.length) edMetricas[idx][ESPEC_FIELDS[fi]] = val.trim(); });
    inferirTipoColado(edMetricas[idx]);
  });
  renderEspecRows();
  toast(`${lines.length} linha(s) coladas.`, { type: 'ok' });
}

/* Ao colar do Excel, deduz o tipo a partir dos valores: nominal + min/máx vira
   TOLERANCIA (deriva desvios); só máx ou só mín vira Unidimensional; min e máx
   vira Máx/Mín. Mantém consistência entre os campos colados e o cálculo. */
function inferirTipoColado(m) {
  const has = v => v !== '' && v != null;
  if (has(m.nominal) && (has(m.tol_min) || has(m.tol_max))) {
    m.tipo_especificacao = 'TOLERANCIA'; m.simetrica = false;
    const nom = numOrNull(m.nominal);
    if (nom != null) { const mn = numOrNull(m.tol_min), mx = numOrNull(m.tol_max);
      m.inferior = mn != null ? +(mn - nom).toFixed(6) : ''; m.superior = mx != null ? +(mx - nom).toFixed(6) : ''; }
  } else if (has(m.tol_max) && !has(m.tol_min)) m.tipo_especificacao = 'UNID_MAX';
  else if (has(m.tol_min) && !has(m.tol_max)) m.tipo_especificacao = 'UNID_MIN';
  else if (has(m.tol_min) && has(m.tol_max)) m.tipo_especificacao = 'MAX_MIN';
}

/* -------------------------------------------------- combobox pesquisável ---- */
let comboState = null;
const COMBO_FIELD = { car: 'caracteristica_nome', eq: 'equipamento_nome', qm: 'quem_mede_nome' };
const COMBO_TABLE = { car: 'caracteristicas_ml', eq: 'equipamentos_medicao', qm: 'quem_mede', quad: 'bib_quadrantes' };
function comboArr(kind) { return CAT[kind] || []; }

function wireCombos(root) {
  $$('.bib-combo__input', root).forEach(inp => {
    if (inp._comboWired) return; inp._comboWired = true;
    inp.addEventListener('focus', () => openCombo(inp));
    inp.addEventListener('input', () => { if (!comboState || comboState.input !== inp) openCombo(inp); comboState.hi = 0; renderComboOptions(); syncCombo(inp); });
    inp.addEventListener('keydown', e => comboKeydown(e, inp));
    inp.addEventListener('blur', () => setTimeout(() => { if (comboState && comboState.input === inp) closeCombo(); }, 160));
  });
}
function openCombo(inp) {
  if (comboState && comboState.input === inp) return;
  closeCombo();
  comboState = { input: inp, kind: inp.dataset.combo, hi: 0, panel: el('<div class="bib-combo-panel"></div>') };
  document.body.appendChild(comboState.panel);
  positionCombo(); renderComboOptions();
  comboState._on = () => positionCombo();
  window.addEventListener('scroll', comboState._on, true);
  window.addEventListener('resize', comboState._on);
}
function closeCombo() { if (!comboState) return; window.removeEventListener('scroll', comboState._on, true); window.removeEventListener('resize', comboState._on); comboState.panel.remove(); comboState = null; }
function positionCombo() { if (!comboState) return; const r = comboState.input.getBoundingClientRect(); const p = comboState.panel; p.style.left = r.left + 'px'; p.style.top = (r.bottom + 3) + 'px'; p.style.minWidth = Math.max(r.width, 220) + 'px'; }
function comboMatches() { const q = BIB.normaliza(comboState.input.value); const arr = comboArr(comboState.kind); return (q ? arr.filter(o => BIB.normaliza(o.nome).includes(q)) : arr.slice()).slice(0, 60); }
function renderComboOptions() {
  if (!comboState) return;
  const val = comboState.input.value.trim();
  const list = comboMatches();
  const exists = comboArr(comboState.kind).some(o => BIB.normaliza(o.nome) === BIB.normaliza(val));
  const canCreate = val && !exists;
  const total = list.length + (canCreate ? 1 : 0);
  if (comboState.hi >= total) comboState.hi = 0;
  comboState.panel.innerHTML =
    list.map((o, idx) => `<button type="button" class="bib-combo-opt ${idx === comboState.hi ? 'hi' : ''}" data-pick="${escAttr(o.nome)}">${highlightMatch(o.nome, val)}</button>`).join('')
    + (canCreate ? `<button type="button" class="bib-combo-opt bib-combo-new ${comboState.hi === list.length ? 'hi' : ''}" data-create="1"><i class="bi bi-plus-lg"></i> Cadastrar novo: “${escHtml(val)}”</button>` : '')
    + (!total ? `<div class="bib-combo-empty">Nenhum resultado</div>` : '');
  comboState.panel.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('mousedown', e => { e.preventDefault(); pickCombo(b.dataset.pick); }));
  comboState.panel.querySelector('[data-create]')?.addEventListener('mousedown', e => { e.preventDefault(); createFromCombo(val); });
}
function pickCombo(nome) { const inp = comboState.input; inp.value = nome; syncCombo(inp); closeCombo(); }
async function createFromCombo(nome) {
  const kind = comboState.kind, inp = comboState.input, tabela = COMBO_TABLE[kind];
  try {
    await db.insert(tabela, kind === 'car' ? { nome, ativo: true, criado_em: BIB.hoje() } : { nome, ativo: true });
    await loadCatalogos();
    toast(`Cadastrado: ${nome}`, { type: 'ok' });
  } catch { toast('Não foi possível cadastrar agora (será criado ao salvar).', { type: 'warn' }); }
  inp.value = nome; syncCombo(inp); closeCombo();
}
function syncCombo(inp) { if (inp.dataset.row != null && inp.dataset.combo !== 'quad') { const i = +inp.dataset.row, field = COMBO_FIELD[inp.dataset.combo]; if (edMetricas[i]) edMetricas[i][field] = inp.value; } }
function comboKeydown(e, inp) {
  if (!comboState || comboState.input !== inp) { if (e.key === 'ArrowDown') { openCombo(inp); e.preventDefault(); } return; }
  const list = comboMatches(), val = inp.value.trim();
  const exists = comboArr(comboState.kind).some(o => BIB.normaliza(o.nome) === BIB.normaliza(val));
  const canCreate = val && !exists, total = list.length + (canCreate ? 1 : 0);
  if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); comboState.hi = total ? (comboState.hi + 1) % total : 0; renderComboOptions(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); comboState.hi = total ? (comboState.hi - 1 + total) % total : 0; renderComboOptions(); }
  else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); if (canCreate && comboState.hi === list.length) createFromCombo(val); else if (list[comboState.hi]) pickCombo(list[comboState.hi].nome); else if (canCreate) createFromCombo(val); else closeCombo(); }
  else if (e.key === 'Escape') { closeCombo(); }
}
function highlightMatch(nome, q) { const n = BIB.normaliza(q); if (!n) return escHtml(nome); const idx = BIB.normaliza(nome).indexOf(n); if (idx < 0) return escHtml(nome); return `${escHtml(nome.slice(0, idx))}<mark>${escHtml(nome.slice(idx, idx + q.length))}</mark>${escHtml(nome.slice(idx + q.length))}`; }

async function resolveCat(kind, nome) {
  nome = (nome || '').trim(); if (!nome) return null;
  const found = CAT[kind].find(o => BIB.normaliza(o.nome) === BIB.normaliza(nome));
  if (found) return found.id;
  const rec = await db.insert(COMBO_TABLE[kind], kind === 'car' ? { nome, ativo: true, criado_em: BIB.hoje() } : { nome, ativo: true });
  CAT[kind].push(rec); return rec.id;
}

/* ========================================================= CADASTRO INTELIGENTE
   Modal "Tipo da Especificação": cards de tipo + campos condicionais + preview
   dos limites em tempo real + validação. Escreve de volta na linha (edMetricas). */
function abrirTipoModal(idx) {
  const m = edMetricas[idx];
  const draft = {
    tipo_especificacao: m.tipo_especificacao || 'TOLERANCIA',
    nominal: m.nominal ?? '', superior: m.superior ?? '', inferior: m.inferior ?? '',
    tol_simetrica: m.tol_simetrica ?? '', simetrica: !!m.simetrica,
    tol_min: m.tol_min ?? '', tol_max: m.tol_max ?? '', referencia: m.referencia ?? '',
    obrigatorio: !!m.obrigatorio          // exige registro do valor medido na auditoria
  };
  const dlg = modal({
    title: `Tipo da especificação${m.caracteristica_nome ? ` — ${m.caracteristica_nome}` : ''}`,
    size: 'modal-lg',
    content: `<div id="tipo-cards" class="bib-tipo-cards"></div>
      <div class="row g-3 mt-1">
        <div class="col-lg-7"><div id="tipo-fields"></div></div>
        <div class="col-lg-5"><div id="tipo-preview"></div></div>
      </div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-primary" id="tipo-ok"><i class="bi bi-check2"></i> Aplicar</button>`
  });
  const host = dlg.host;
  const cardsBox = $('#tipo-cards', host), fieldsBox = $('#tipo-fields', host), prevBox = $('#tipo-preview', host);

  const renderCards = () => {
    cardsBox.innerHTML = TIPO_ESPEC.map(t => `
      <button type="button" class="bib-tipo-card ${draft.tipo_especificacao === t.id ? 'is-sel' : ''}" data-t="${t.id}">
        <i class="bi ${t.icon}"></i><b>${t.titulo}</b><span>${t.desc}</span></button>`).join('');
    $$('[data-t]', cardsBox).forEach(b => b.addEventListener('click', () => { draft.tipo_especificacao = b.dataset.t; renderCards(); renderFields(); }));
  };
  const numInput = (key, label, ph = '') => `<div class="col-6"><label class="form-label">${label}</label>
    <input class="form-control tipo-num" data-k="${key}" inputmode="decimal" value="${escAttr(draft[key])}" placeholder="${ph}"></div>`;
  const roInput = (label) => `<div class="col-6"><label class="form-label text-muted-2">${label}</label>
    <input class="form-control" value="" placeholder="-" disabled></div>`;

  const renderFields = () => {
    const tipo = draft.tipo_especificacao;
    let html = '';
    if (tipo === 'TOLERANCIA') {
      html = `<div class="row g-2">
        ${numInput('nominal', 'Nominal')}
        <div class="col-6 d-flex align-items-end"><label class="bib-switch"><input type="checkbox" id="tipo-sim" ${draft.simetrica ? 'checked' : ''}> Tolerância simétrica (±)</label></div>
        ${draft.simetrica ? numInput('tol_simetrica', '± (mais/menos)') : `${numInput('superior', 'Superior (ex.: +2)')}${numInput('inferior', 'Inferior (ex.: -1)')}`}
      </div>`;
    } else if (tipo === 'MAX_MIN') {
      html = `<div class="row g-2">${numInput('tol_min', 'Valor Mínimo')}${numInput('tol_max', 'Valor Máximo')}</div>`;
    } else if (tipo === 'UNID_MAX') {
      html = `<div class="row g-2">${numInput('tol_max', 'Valor Máximo')}${roInput('Valor Mínimo')}</div>`;
    } else if (tipo === 'UNID_MIN') {
      html = `<div class="row g-2">${numInput('tol_min', 'Valor Mínimo')}${roInput('Valor Máximo')}</div>`;
    } else if (tipo === 'ATRIBUTO') {
      html = `<div class="bib-tipo-note"><i class="bi bi-check2-square"></i> Inspeção OK/NOK — sem valores dimensionais. Na auditoria o operador responderá apenas <b>OK</b> ou <b>NOK</b>.</div>`;
    } else if (tipo === 'REFERENCIA') {
      html = `<label class="form-label">Referência *</label>
        <input class="form-control tipo-num" data-k="referencia" value="${escAttr(draft.referencia)}" placeholder="Ex.: 73,00 · Conforme desenho · Ver Nota 01…">
        <div class="mt-2"><label class="bib-switch"><input type="checkbox" id="tipo-obrig" ${draft.obrigatorio ? 'checked' : ''}> Registro obrigatório na auditoria</label></div>
        <div class="bib-tipo-info"><i class="bi bi-info-circle"></i> A característica <b>é medida normalmente</b> na auditoria: o auditor informa o valor medido de cada peça. O valor de Referência fica visível como orientação técnica, mas <b>não há limites</b> — a medição nunca reprova e não participa da conformidade. Marque <b>Registro obrigatório</b> para exigir o preenchimento antes de finalizar a auditoria.</div>`;
    }
    fieldsBox.innerHTML = html;
    $('#tipo-sim', fieldsBox)?.addEventListener('change', e => { draft.simetrica = e.target.checked; renderFields(); renderPreview(); });
    $('#tipo-obrig', fieldsBox)?.addEventListener('change', e => { draft.obrigatorio = e.target.checked; });
    $$('.tipo-num', fieldsBox).forEach(inp => inp.addEventListener('input', () => { draft[inp.dataset.k] = inp.value; renderPreview(); }));
    renderPreview();
  };

  const renderPreview = () => {
    const tipo = draft.tipo_especificacao;
    if (tipo === 'ATRIBUTO') { prevBox.innerHTML = `<div class="bib-preview"><div class="bib-preview__t">Resultado</div><div class="bib-preview__ok">OK / NOK</div><div class="cell-sub">Sem limites dimensionais.</div></div>`; return; }
    if (tipo === 'REFERENCIA') { prevBox.innerHTML = `<div class="bib-preview"><div class="bib-preview__t">Referência</div><div class="bib-preview__ref">${escHtml(draft.referencia) || '—'}</div><div class="cell-sub">Medida e registrada na auditoria, sem limites — não participa da conformidade.${draft.obrigatorio ? '<br><b>Registro obrigatório.</b>' : ''}</div></div>`; return; }
    const lim = BIB.calcularLimites(draft);
    prevBox.innerHTML = `<div class="bib-preview">
      <div class="bib-preview__t">Limites calculados</div>
      <div class="bib-preview__row"><span>Nominal</span><b>${tipo === 'TOLERANCIA' ? (fmtVal(draft.nominal) || '—') : '—'}</b></div>
      <div class="bib-preview__arrow"><i class="bi bi-arrow-down"></i></div>
      <div class="bib-preview__row"><span>Mínimo</span><b>${lim.tol_min == null ? '—' : fmtVal(lim.tol_min)}</b></div>
      <div class="bib-preview__row"><span>Máximo</span><b>${lim.tol_max == null ? '—' : fmtVal(lim.tol_max)}</b></div>
    </div>`;
  };

  renderCards(); renderFields();

  $('#tipo-ok', host).addEventListener('click', () => {
    const err = validarSpecDraft(draft);
    if (err) { toast(err, { type: 'warn' }); return; }
    const lim = BIB.calcularLimites(draft);
    Object.assign(m, {
      tipo_especificacao: draft.tipo_especificacao,
      nominal: draft.tipo_especificacao === 'TOLERANCIA' ? draft.nominal : '',
      superior: draft.simetrica ? '' : draft.superior, inferior: draft.simetrica ? '' : draft.inferior,
      tol_simetrica: draft.simetrica ? draft.tol_simetrica : '', simetrica: draft.simetrica,
      tol_min: lim.tol_min ?? '', tol_max: lim.tol_max ?? '',
      referencia: draft.tipo_especificacao === 'REFERENCIA' ? draft.referencia : m.referencia,
      // Registro obrigatório só faz sentido em Referência (os demais tipos já
      // exigem todas as medições para finalizar a auditoria).
      obrigatorio: draft.tipo_especificacao === 'REFERENCIA' ? !!draft.obrigatorio : false
    });
    dlg.close(); renderEspecRows();
  });
}

/* Validações por tipo (Parte 7 do processo). Retorna string de erro ou null. */
function validarSpecDraft(d) {
  const has = v => v !== '' && v != null && !isNaN(parseFloat(String(v).replace(',', '.')));
  switch (d.tipo_especificacao) {
    case 'MAX_MIN':  return (has(d.tol_min) && has(d.tol_max)) ? null : 'Informe o Valor Mínimo e o Valor Máximo.';
    case 'UNID_MAX': return has(d.tol_max) ? null : 'Informe o Valor Máximo.';
    case 'UNID_MIN': return has(d.tol_min) ? null : 'Informe o Valor Mínimo.';
    case 'REFERENCIA': return String(d.referencia || '').trim() ? null : 'Informe o texto da Referência.';
    case 'ATRIBUTO': return null;
    case 'TOLERANCIA':
      if (!has(d.nominal)) return 'Informe o valor Nominal.';
      return d.simetrica ? (has(d.tol_simetrica) ? null : 'Informe o valor da tolerância simétrica (±).')
                         : ((has(d.superior) || has(d.inferior)) ? null : 'Informe o desvio Superior e/ou Inferior.');
    default: return null;
  }
}

function renderDocList() {
  const box = $('#ed-doc-list'); if (!box) return;
  box.innerHTML = edDocsNovos.map((file, i) => `<span class="rna-badge badge-yellow me-1"><i class="bi ${docIcon(file.name.split('.').pop())}"></i> ${file.name} <i class="bi bi-x" data-docdel="${i}" style="cursor:pointer"></i></span>`).join('');
  $$('[data-docdel]', box).forEach(b => b.addEventListener('click', () => { edDocsNovos.splice(+b.dataset.docdel, 1); renderDocList(); }));
}

/* Trava de reentrância do salvamento. `btn.disabled` sozinho não bastava: o
   handler é assíncrono e um segundo clique disparado antes do primeiro `await`
   (ou um Enter no formulário) entrava de novo e duplicava toda a gravação. */
let salvandoPeca = false;

async function salvar(isNew, p, f, upImg) {
  if (salvandoPeca) return;
  salvandoPeca = true;
  const btn = $('#ed-save');
  const btnHtml = btn.innerHTML;
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Salvando…';
  const soltarBotao = () => {
    salvandoPeca = false;
    if (!btn.isConnected) return;          // a tela já trocou (sucesso): nada a restaurar
    btn.disabled = false; btn.removeAttribute('aria-busy'); btn.innerHTML = btnHtml;
  };
  try {
    const patch = {};
    $$('[data-p]').forEach(i => { patch[i.dataset.p] = i.value.trim(); });
    if (!patch.codigo || !patch.nome) { toast('Código e Nome são obrigatórios.', { type: 'warn' }); soltarBotao(); return; }

    /* Tipos de inspeção aplicáveis: obrigatório (§3). Valida ANTES do envio, com
       destaque no próprio campo; a camada de serviço revalida em salvarPeca. */
    const tiposNormalizados = BIB.normalizarParaGravar(edTipos);
    const erroTipos = BIB.validarTiposInspecao(tiposNormalizados);
    if (erroTipos) {
      mostrarErroTipos(erroTipos);
      toast(erroTipos, { type: 'warn', title: 'Tipos de inspeção' });
      soltarBotao(); return;
    }
    patch.tipos_inspecao = tiposNormalizados;

    // imagem principal (opcional)
    let imagemUrl = p.imagem || null;
    if (upImg.hasFiles()) {
      const evs = await upImg.commit({ registro_tipo: 'biblioteca', registro_id: p.id || patch.codigo, usuario: USER });
      if (evs[0]) imagemUrl = evs[0].url;
    }

    let peca;
    if (isNew) {
      // via serviço: revalida o vínculo e tolera banco sem a coluna nova.
      peca = await BIB.inserirPeca({
        ...patch, revisao: 1, revisao_cadastro: 1, ativo: patch.status !== 'Arquivado',
        imagem: imagemUrl, galeria: [], created_at: BIB.hoje(), updated_at: BIB.hoje(), created_by: USER.id
      });
      await BIB.registrarCriacao(peca.id, USER);
    } else {
      peca = await BIB.salvarRevisao(p.id, { ...patch, imagem: imagemUrl, ativo: patch.status !== 'Arquivado' }, USER);
    }

    /* Especificações: calcula limites pelo tipo e resolve catálogos. A ordem e a
       decisão de inserir/atualizar/remover ficam em `sincronizarMetricas`. */
    const specsRows = [];
    for (const m of edMetricas) {
      const vazia = !(m.caracteristica_nome || '').trim() && !String(m.cota ?? '').trim()
        && numOrNull(m.nominal) == null && numOrNull(m.tol_min) == null && numOrNull(m.tol_max) == null && !(m.referencia || '').trim();
      if (vazia) continue;
      const erro = validarSpecDraft({ ...m });
      if (erro) throw new Error(`Especificação (cota ${m.cota || '?'}): ${erro}`);
      const lim = BIB.calcularLimites(m);
      const info = BIB.ehInformativo(m.tipo_especificacao), attr = BIB.ehAtributo(m.tipo_especificacao);
      specsRows.push({
        // `id` só existe em linha que já estava no banco — é a chave do diff.
        id: m.id || null,
        peca_id: peca.id, cota: numOrNull(m.cota), quadrante: (m.quadrante || '').trim() || null,
        tipo_especificacao: m.tipo_especificacao || 'TOLERANCIA',
        caracteristica_id: await resolveCat('car', m.caracteristica_nome),
        referencia: m.referencia || '',
        nominal: (info || attr) ? null : numOrNull(m.nominal),
        superior: m.simetrica ? null : numOrNull(m.superior), inferior: m.simetrica ? null : numOrNull(m.inferior),
        tol_simetrica: m.simetrica ? numOrNull(m.tol_simetrica) : null,
        tol_min: lim.tol_min, tol_max: lim.tol_max,
        unidade: m.unidade || '', equipamento_id: await resolveCat('eq', m.equipamento_nome), quem_mede_id: await resolveCat('qm', m.quem_mede_nome),
        observacao: m.observacao || '',
        // Exige o registro do valor medido na auditoria (só em REFERENCIA — os
        // demais tipos já exigem todas as medições). Ver fix_referencia_mensuravel.sql.
        obrigatorio: info ? !!m.obrigatorio : false
      });
    }
    /* Especificações e documentos são independentes entre si — vão juntos.
       `allSettled` não serve aqui: sucesso parcial silencioso deixaria a ficha
       inconsistente sem ninguém saber. Se qualquer um falhar, o catch reporta. */
    await Promise.all([
      sincronizarMetricas(peca.id, specsRows),
      ...edDocsNovos.map(async file => {
        const url = await uploadArquivo(file, peca.id);
        return db.insert('bib_documentos', { peca_id: peca.id, nome: file.name, categoria: 'Outro', versao: '—', data: BIB.hoje(), responsavel: USER.nome, descricao: '', url, tipo: (file.name.split('.').pop() || '').toLowerCase(), tamanho: fmtBytes(file.size) });
      })
    ]);

    /* §4.8 — sucesso só é anunciado como sucesso quando o banco gravou TUDO.
       Se a coluna do vínculo não existe, a peça foi salva mas os tipos não:
       isso é um aviso, não um "salvo com sucesso". */
    if (peca.tipos_nao_gravados) {
      toast(BIB.MSG_MIGRACAO_TIPOS, { type: 'warn', title: 'Salvo parcialmente' });
    } else {
      toast(isNew ? 'Peça cadastrada com sucesso.' : `Revisão salva (Rev ${String(peca.revisao).padStart(2, '0')}).`, { type: 'ok', title: 'Biblioteca' });
    }
    state.view = 'ficha'; state.pecaId = peca.id; render();
  } catch (err) {
    console.error('[biblioteca] salvar', { message: err?.message, code: err?.code, details: err?.details, hint: err?.hint, err });
    toast('Erro ao salvar. ' + (err?.message || ''), { type: 'crit' });
  } finally {
    soltarBotao();
  }
}

/* Sincroniza as especificações da peça por DIFERENÇA, em vez de apagar todas e
   reinserir. O modelo antigo custava (1 + N_antigas + N_novas) round-trips em
   série a cada salvamento — numa peça com 20 cotas, ~41 requisições, mesmo quando
   só o tipo de inspeção mudou. Além de lento, era arriscado: as linhas eram
   apagadas antes de as novas entrarem, então uma falha no meio perdia as cotas.
   Agora: linha inalterada não gera requisição; alterada vira UPDATE; nova vira
   INSERT; removida vira DELETE — e tudo em paralelo. */
async function sincronizarMetricas(pecaId, linhas) {
  const existentes = await db.list('bib_metricas', { filter: { peca_id: pecaId } });
  const porId = new Map(existentes.map(r => [r.id, r]));
  const mantidos = new Set();
  const ops = [];

  linhas.forEach((linha, i) => {
    const { id, ...campos } = linha;
    campos.ordem = i + 1;
    const atual = id ? porId.get(id) : null;
    if (!atual) { ops.push(inserirTolerante('bib_metricas', campos)); return; }
    mantidos.add(id);
    if (mudou(atual, campos)) ops.push(atualizarTolerante('bib_metricas', id, campos));
  });
  for (const r of existentes) if (!mantidos.has(r.id)) ops.push(db.remove('bib_metricas', r.id));

  await Promise.all(ops);
}

/* Compara só os campos que serão gravados: o registro do banco traz colunas
   extras (created_at, etc.) que não devem contar como alteração.
   `''` e `null` são o MESMO "vazio" aqui — o formulário devolve string vazia
   onde o banco guarda null, e tratá-los como diferentes faria toda linha parecer
   alterada, anulando o ganho do diff. */
function mudou(atual, campos) {
  const vazio = v => v == null || v === '';
  return Object.keys(campos).some(k => {
    const a = atual[k], b = campos[k];
    if (vazio(a) && vazio(b)) return false;
    if (vazio(a) !== vazio(b)) return true;
    if (typeof a === 'number' || typeof b === 'number') return Number(a) !== Number(b);
    return JSON.stringify(a) !== JSON.stringify(b);
  });
}

/* Colunas opcionais criadas por migrations posteriores. Como `substituir` APAGA
   antes de reinserir, um banco atrás das migrations perderia as métricas se o
   insert falhasse no meio. Por isso o insert é tolerante: se a coluna não existe,
   avisa uma vez e regrava sem ela (mesmo padrão de inspecao.js). */
const COLUNAS_OPCIONAIS = ['obrigatorio'];
let _semColunasOpcionais = false;
const ehErroDeSchema = e =>
  ['PGRST204', 'PGRST205', '42703', '42P01'].includes(String(e?.code || ''))
  || /could not find the .*column|column .* does not exist|schema cache/i.test(`${e?.message || ''} ${e?.details || ''}`);
async function inserirTolerante(tabela, row) {
  const semOpcionais = () => { const r = { ...row }; COLUNAS_OPCIONAIS.forEach(k => delete r[k]); return r; };
  if (_semColunasOpcionais) return db.insert(tabela, semOpcionais());
  try {
    return await db.insert(tabela, row);
  } catch (e) {
    if (!ehErroDeSchema(e)) throw e;
    _semColunasOpcionais = true;
    console.warn(`[BIB] ${tabela} não tem ${COLUNAS_OPCIONAIS.join('/')} — gravando sem esses campos. ` +
      'Rode database/fix_referencia_mensuravel.sql no Supabase para normalizar o banco. Detalhe:', e?.message || e);
    return db.insert(tabela, semOpcionais());
  }
}

/* Mesma tolerância do insert, para o UPDATE do diff de especificações. */
async function atualizarTolerante(tabela, id, patch) {
  const semOpcionais = () => { const r = { ...patch }; COLUNAS_OPCIONAIS.forEach(k => delete r[k]); return r; };
  if (_semColunasOpcionais) return db.update(tabela, id, semOpcionais());
  try {
    return await db.update(tabela, id, patch);
  } catch (e) {
    if (!ehErroDeSchema(e)) throw e;
    _semColunasOpcionais = true;
    console.warn(`[BIB] ${tabela} não tem ${COLUNAS_OPCIONAIS.join('/')} — gravando sem esses campos. ` +
      'Rode database/fix_referencia_mensuravel.sql no Supabase. Detalhe:', e?.message || e);
    return db.update(tabela, id, semOpcionais());
  }
}

async function excluirPeca(pecaId) {
  for (const t of ['bib_metricas', 'bib_pontos_inspecao', 'bib_documentos', 'bib_historico', 'bib_versoes']) {
    const rows = await db.list(t, { filter: { peca_id: pecaId } });
    for (const r of rows) await db.remove(t, r.id);
  }
  await db.remove('bib_pecas', pecaId);
  toast('Peça excluída.', { type: 'ok' });
  state.view = 'catalogo'; state.pecaId = null; render();
}

async function uploadArquivo(file, pecaId) {
  if (SUPABASE.enabled) {
    const { getSupabase } = await import('../../../services/supabaseClient.js');
    const sb = await getSupabase();
    const safe = (file.name || 'arquivo').replace(/[^\w.\-]+/g, '_');
    const path = `docs/${pecaId || 'tmp'}/${Date.now()}_${safe}`;
    const { error } = await sb.storage.from('biblioteca').upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (error) throw error;
    return sb.storage.from('biblioteca').getPublicUrl(path).data.publicUrl;
  }
  return await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
}

/* ------------------------------------------------------------- utilidades -- */
function wireCards(root = document) {
  $$('[data-open]', root).forEach(c => c.addEventListener('click', (e) => {
    if (e.target.closest('[data-fav]')) return;
    state.view = 'ficha'; state.pecaId = c.dataset.open; state.tab = 'geral'; render();
  }));
  $$('[data-fav]', root).forEach(b => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    const on = await BIB.alternarFavorito(USER.id, b.dataset.fav);
    b.classList.toggle('is-fav', on); b.querySelector('i').className = `bi ${on ? 'bi-star-fill' : 'bi-star'}`;
  }));
}

function statusBadge(s) {
  const m = { 'Ativo': 'badge-ok', 'Em revisão': 'badge-warn', 'Arquivado': 'badge-na', 'Obsoleto': 'badge-crit' };
  return `<span class="rna-badge ${m[s] || 'badge-na'}">${s || '—'}</span>`;
}
function critBadge(c) {
  const m = { 'Crítico': 'badge-crit', 'Alta': 'badge-crit', '100%': 'badge-crit', 'Média': 'badge-warn', 'Baixa': 'badge-info', 'Visual': 'badge-info' };
  return m[c] || 'badge-na';
}
function docIcon(ext = '') {
  ext = String(ext).toLowerCase();
  if (ext === 'pdf') return 'bi-file-earmark-pdf';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'bi-file-earmark-spreadsheet';
  if (['doc', 'docx'].includes(ext)) return 'bi-file-earmark-word';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'bi-file-earmark-image';
  if (['zip', 'rar'].includes(ext)) return 'bi-file-earmark-zip';
  if (['dwg', 'dxf'].includes(ext)) return 'bi-file-earmark-ruled';
  return 'bi-file-earmark';
}
function metaChip(ic, v) { return v ? `<span class="bib-meta-chip"><i class="bi ${ic}"></i> ${v}</span>` : ''; }
function cardTabela(pares) {
  return `<div class="rna-card"><div class="rna-card__body p-0"><table class="rna-table bib-kv"><tbody>${pares.map(([k, v]) => `<tr><th>${k}</th><td>${v == null || v === '' ? '<span class="cell-sub">—</span>' : v}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function emptyState(msg) { return `<div class="empty-state"><i class="bi bi-inbox"></i><div>${msg}</div></div>`; }
/* §M07 — padrão 00,00 (fonte única). EXCEÇÃO: a Cota é identificador da
   característica no desenho, não medida — segue como inteiro. */
function fmtVal(v) { return fmtMedida(v); }
function fmtCota(v) { return (v == null || v === '') ? '—' : String(v); }
function fmtDateTime(iso) { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function fmtBytes(n) { if (!n) return ''; const kb = n / 1024; return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`; }
function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escAttr(s) { return String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function destacar(txt) { const q = BIB.normaliza(state.q); const t = String(txt); const i = BIB.normaliza(t).indexOf(q); if (i < 0 || !q) return t; return `${t.slice(0, i)}<mark>${t.slice(i, i + q.length)}</mark>${t.slice(i + q.length)}`; }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function numOrNull(v) { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; }
function blankSpec() {
  return {
    cota: '', quadrante: '', tipo_especificacao: 'TOLERANCIA', caracteristica_nome: '', referencia: '',
    nominal: '', superior: '', inferior: '', tol_simetrica: '', simetrica: false, tol_min: '', tol_max: '',
    unidade: '', equipamento_nome: '', quem_mede_nome: '', observacao: '', obrigatorio: false
  };
}
