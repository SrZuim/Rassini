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
import { charts, PALETTE } from '../charts.js';
import { $, $$, el, toast, modal, confirmDialog, fmtDate } from '../ui.js';
import { initEvidenceUpload } from '../evidence.js';

let USER, CAN_EDIT, CAN_DELETE;
const state = { view: 'dashboard', q: '', filtros: {}, incluirArquivadas: false, pecaId: null, tab: 'geral' };

const IMG = DATA.BIB_IMG_PLACEHOLDER;
const FILTROS_DEF = [
  ['cliente', 'Cliente', 'bib_clientes'], ['planta', 'Planta', 'bib_plantas'],
  ['familia', 'Família', 'bib_familias'], ['categoria', 'Categoria', 'bib_categorias'],
  ['processo', 'Processo', 'bib_processos'], ['tipo', 'Tipo', 'bib_tipos']
];

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
      ${kpi(ind.metricas, 'Métricas', 'bi-rulers', 'ic-soft-yellow')}
      ${kpi(ind.pontos, 'Pontos de inspeção', 'bi-crosshair', 'ic-soft-red')}
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
      <label class="bib-arch"><input type="checkbox" id="bib-arch" ${state.incluirArquivadas ? 'checked' : ''}> Incluir arquivadas</label>
    </div>
    <div id="bib-results"></div>`);

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
  const chips = Object.entries(state.filtros).filter(([, v]) => v).map(([k, v]) => `<span class="rna-badge badge-info">${v} <i class="bi bi-x" data-rmfiltro="${k}" style="cursor:pointer"></i></span>`).join(' ');
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
      <div class="d-flex justify-content-between align-items-center mt-2">
        <span class="cell-sub"><i class="bi bi-geo-alt"></i> ${p.planta || '—'}</span>${statusBadge(p.status)}
      </div>
    </div></div>`;
}

/* ---------------------------------------------------------------- ficha ---- */
async function renderFicha() {
  const f = await BIB.ficha(state.pecaId);
  if (!f) { state.view = 'catalogo'; toast('Peça não encontrada.', { type: 'warn' }); return render(); }
  BIB.registrarRecente(USER.id, f.peca.id);
  const p = f.peca;
  const fav = await BIB.ehFavorito(USER.id, p.id);
  const alertas = f.metricas.filter(BIB.foraDePadrao).length;

  const tabs = [
    ['geral', 'bi-info-circle', 'Geral'],
    ['especificacoes', 'bi-file-earmark-text', 'Especificações'],
    ['metricas', 'bi-rulers', `Métricas${alertas ? ` <span class="rna-badge badge-crit">${alertas}</span>` : ''}`],
    ['pontos', 'bi-crosshair', 'Pontos de Inspeção'],
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
            <span class="rna-badge badge-na">Rev ${String(p.revisao || 1).padStart(2, '0')}</span>
          </div>
          <h2>${p.nome}</h2>
          <p class="text-muted-2">${p.descricao || ''}</p>
          <div class="bib-ficha__meta">
            ${metaChip('bi-buildings', p.cliente)} ${metaChip('bi-diagram-2', p.familia)}
            ${metaChip('bi-geo-alt', p.planta)} ${metaChip('bi-gear-wide-connected', p.processo)}
            ${metaChip('bi-person', p.responsavel)}
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
  if (tab === 'geral') return cardTabela([
    ['Código', p.codigo], ['Nome', p.nome], ['Descrição', p.descricao], ['Cliente', p.cliente],
    ['Família', p.familia], ['Linha', p.linha], ['Processo', p.processo], ['Tipo', p.tipo],
    ['Aplicação', p.aplicacao], ['Categoria', p.categoria], ['Peso', p.peso], ['Planta', p.planta],
    ['Fornecedor', p.fornecedor], ['Responsável', p.responsavel], ['Observações', p.observacoes]
  ]);
  if (tab === 'especificacoes') return cardTabela([
    ['Material', p.material], ['Acabamento', p.acabamento], ['Cor', p.cor], ['Norma', p.norma],
    ['Especificação', p.especificacao], ['Revisão atual', `Rev ${String(p.revisao || 1).padStart(2, '0')}`],
    ['Data da revisão', fmtDate(p.data_revisao)], ['Criada em', fmtDate(p.created_at)], ['Atualizada em', fmtDate(p.updated_at)]
  ]);
  if (tab === 'metricas') {
    if (!f.metricas.length) return emptyState('Nenhuma métrica cadastrada.');
    const alertas = f.metricas.filter(BIB.foraDePadrao).length;
    return `${alertas ? `<div class="bib-alert"><i class="bi bi-exclamation-triangle-fill"></i> ${alertas} métrica(s) com valor nominal fora da faixa de tolerância.</div>` : ''}
    <div class="rna-card"><div class="rna-card__body p-0" style="overflow:auto"><table class="rna-table"><thead><tr>
      <th>Medida</th><th>Nominal</th><th>Tol. mín</th><th>Tol. máx</th><th>Un.</th><th>Método</th><th>Equipamento</th><th>Period.</th></tr></thead><tbody>
      ${f.metricas.map(m => { const fora = BIB.foraDePadrao(m); return `<tr class="${fora ? 'bib-metric--fora' : ''}">
        <td class="cell-strong">${m.nome}${fora ? ' <i class="bi bi-exclamation-triangle-fill text-danger" title="Fora do padrão"></i>' : ''}</td>
        <td>${fmtVal(m.nominal)}</td><td>${fmtVal(m.tol_min)}</td><td>${fmtVal(m.tol_max)}</td><td>${m.unidade || '—'}</td>
        <td class="cell-sub">${m.metodo || '—'}</td><td class="cell-sub">${m.equipamento || '—'}</td><td class="cell-sub">${m.periodicidade || '—'}</td></tr>`; }).join('')}
    </tbody></table></div></div>`;
  }
  if (tab === 'pontos') {
    if (!f.pontos.length) return emptyState('Nenhum ponto de inspeção cadastrado.');
    return `<div class="row g-3">${f.pontos.map(pt => `<div class="col-md-6"><div class="rna-card h-100"><div class="rna-card__body">
      <div class="d-flex justify-content-between align-items-start"><b>${pt.descricao}</b><span class="rna-badge ${critBadge(pt.criticidade)}">${pt.criticidade || '—'}</span></div>
      <div class="op-item__resp mt-2"><span><i class="bi bi-tools"></i> ${pt.metodo || '—'}</span><span><i class="bi bi-arrow-repeat"></i> ${pt.periodicidade || '—'}</span>${pt.equipamento ? `<span><i class="bi bi-wrench"></i> ${pt.equipamento}</span>` : ''}</div>
      ${pt.foto ? `<img src="${pt.foto}" class="bib-point-foto mt-2" alt="">` : ''}
    </div></div></div>`).join('')}</div>`;
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
let edMetricas = [], edPontos = [], edDocsNovos = [];
function abrirEditor(pecaId) { state.view = 'editor'; state.pecaId = pecaId; render(); }

async function renderEditor() {
  const isNew = !state.pecaId;
  let p = { status: 'Em revisão', revisao: 1, ativo: true, galeria: [] };
  let f = null;
  if (!isNew) { f = await BIB.ficha(state.pecaId); if (!f) { state.view = 'catalogo'; return render(); } p = f.peca; }
  edMetricas = f ? f.metricas.map(clone) : [];
  edPontos = f ? f.pontos.map(clone) : [];
  edDocsNovos = [];

  const [cli, pla, fam, cat, pro, tip] = await Promise.all(['bib_clientes', 'bib_plantas', 'bib_familias', 'bib_categorias', 'bib_processos', 'bib_tipos'].map(t => db.list(t)));
  const opt = (arr, val) => `<option value="">—</option>` + arr.filter(o => o.ativo !== false).map(o => `<option ${o.nome === val ? 'selected' : ''}>${o.nome}</option>`).join('');
  const inp = (campo, label, val, type = 'text') => `<div class="col-md-4"><label class="form-label">${label}</label><input class="form-control" data-p="${campo}" type="${type}" value="${escAttr(val)}"></div>`;
  const selc = (campo, label, arr, val) => `<div class="col-md-4"><label class="form-label">${label}</label><select class="form-select" data-p="${campo}">${opt(arr, val)}</select></div>`;

  mount(`
    <div class="rna-card mb-3"><div class="rna-card__body d-flex align-items-center gap-2">
      <i class="bi bi-pencil-square" style="font-size:20px;color:var(--rna-yellow-600)"></i>
      <b>${isNew ? 'Nova peça' : `Editar ${p.codigo}`}</b>
      ${!isNew ? `<span class="rna-badge badge-na ms-1">Rev ${String(p.revisao || 1).padStart(2, '0')} → salvar cria Rev ${String((p.revisao || 1) + 1).padStart(2, '0')}</span>` : ''}
    </div></div>

    <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-info-circle"></i> Informações gerais</h3></div>
      <div class="rna-card__body"><div class="row g-3">
        ${inp('codigo', 'Código *', p.codigo)}${inp('nome', 'Nome *', p.nome)}
        ${selc('cliente', 'Cliente', cli, p.cliente)}
        <div class="col-12"><label class="form-label">Descrição</label><textarea class="form-control" data-p="descricao" rows="2">${escHtml(p.descricao)}</textarea></div>
        ${selc('familia', 'Família', fam, p.familia)}${selc('categoria', 'Categoria', cat, p.categoria)}${selc('processo', 'Processo', pro, p.processo)}
        ${selc('tipo', 'Tipo', tip, p.tipo)}${selc('planta', 'Planta', pla, p.planta)}${inp('linha', 'Linha', p.linha)}
        ${inp('aplicacao', 'Aplicação', p.aplicacao)}${inp('responsavel', 'Responsável', p.responsavel)}${inp('fornecedor', 'Fornecedor', p.fornecedor)}
      </div></div></div>

    <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-file-earmark-text"></i> Especificações</h3></div>
      <div class="rna-card__body"><div class="row g-3">
        ${inp('material', 'Material', p.material)}${inp('acabamento', 'Acabamento', p.acabamento)}${inp('cor', 'Cor', p.cor)}
        ${inp('peso', 'Peso', p.peso)}${inp('norma', 'Norma', p.norma)}${inp('especificacao', 'Especificação', p.especificacao)}
        <div class="col-md-4"><label class="form-label">Status</label><select class="form-select" data-p="status">${DATA.BIB_STATUS.map(s => `<option ${s === p.status ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        ${inp('data_revisao', 'Data da revisão', p.data_revisao, 'date')}
        <div class="col-12"><label class="form-label">Observações</label><textarea class="form-control" data-p="observacoes" rows="2">${escHtml(p.observacoes)}</textarea></div>
      </div></div></div>

    <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-image"></i> Imagem principal</h3></div>
      <div class="rna-card__body"><div id="ed-img"></div>
        ${p.imagem ? `<div class="mt-2 d-flex align-items-center gap-2"><img src="${p.imagem}" style="height:54px;border-radius:8px"><small class="text-muted-2">Imagem atual — envie uma nova para substituir.</small></div>` : ''}
      </div></div>

    <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-rulers"></i> Métricas</h3>
      <button class="rna-btn rna-btn-ghost rna-btn-sm" id="ed-add-metrica"><i class="bi bi-plus-lg"></i> Adicionar</button></div>
      <div class="rna-card__body p-0" style="overflow:auto"><table class="rna-table bib-edit-table" id="ed-metricas"></table></div></div>

    <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-crosshair"></i> Pontos de inspeção</h3>
      <button class="rna-btn rna-btn-ghost rna-btn-sm" id="ed-add-ponto"><i class="bi bi-plus-lg"></i> Adicionar</button></div>
      <div class="rna-card__body p-0" style="overflow:auto"><table class="rna-table bib-edit-table" id="ed-pontos"></table></div></div>

    <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-folder2-open"></i> Documentos</h3></div>
      <div class="rna-card__body">
        ${f && f.documentos.length ? `<div class="mb-2">${f.documentos.map(d => `<span class="rna-badge badge-info me-1"><i class="bi ${docIcon(d.tipo)}"></i> ${d.nome}</span>`).join('')}</div>` : ''}
        <div class="bib-doc-drop" id="ed-doc-drop"><i class="bi bi-cloud-arrow-up"></i> Selecionar arquivos (PDF, Excel, Word, imagem, DWG, DXF, ZIP)
          <input type="file" id="ed-doc-input" multiple hidden></div>
        <div id="ed-doc-list" class="mt-2"></div>
      </div></div>

    <div class="d-flex gap-2 justify-content-end mb-4 no-print">
      <button class="rna-btn rna-btn-ghost" id="ed-cancel">Cancelar</button>
      <button class="rna-btn rna-btn-primary rna-btn-lg" id="ed-save"><i class="bi bi-check2"></i> ${isNew ? 'Cadastrar peça' : 'Salvar revisão'}</button>
    </div>`);

  const upImg = initEvidenceUpload($('#ed-img'), { label: 'Imagem principal da peça', multiple: false });
  renderMetricRows(); renderPointRows();

  $('#ed-add-metrica').addEventListener('click', () => { edMetricas.push(blankMetrica()); renderMetricRows(); });
  $('#ed-add-ponto').addEventListener('click', () => { edPontos.push(blankPonto()); renderPointRows(); });

  const dropInput = $('#ed-doc-input');
  $('#ed-doc-drop').addEventListener('click', () => dropInput.click());
  dropInput.addEventListener('change', () => { edDocsNovos.push(...[...dropInput.files]); dropInput.value = ''; renderDocList(); });

  $('#ed-cancel').addEventListener('click', () => { if (isNew) { state.view = 'catalogo'; } else { state.view = 'ficha'; } render(); });
  $('#ed-save').addEventListener('click', () => salvar(isNew, p, f, upImg));
}

function renderMetricRows() {
  const head = `<thead><tr><th>Medida</th><th>Nominal</th><th>Tol. mín</th><th>Tol. máx</th><th>Un.</th><th>Método</th><th>Equipamento</th><th>Period.</th><th></th></tr></thead>`;
  const body = edMetricas.map((m, i) => `<tr data-mrow="${i}">
    <td><input class="form-control form-control-sm" data-mf="nome" value="${escAttr(m.nome)}"></td>
    <td><input class="form-control form-control-sm" data-mf="nominal" value="${escAttr(m.nominal)}" style="width:82px"></td>
    <td><input class="form-control form-control-sm" data-mf="tol_min" value="${escAttr(m.tol_min)}" style="width:82px"></td>
    <td><input class="form-control form-control-sm" data-mf="tol_max" value="${escAttr(m.tol_max)}" style="width:82px"></td>
    <td><input class="form-control form-control-sm" data-mf="unidade" value="${escAttr(m.unidade)}" style="width:64px"></td>
    <td><input class="form-control form-control-sm" data-mf="metodo" value="${escAttr(m.metodo)}"></td>
    <td><input class="form-control form-control-sm" data-mf="equipamento" value="${escAttr(m.equipamento)}"></td>
    <td><input class="form-control form-control-sm" data-mf="periodicidade" value="${escAttr(m.periodicidade)}" style="width:110px"></td>
    <td><button class="rna-btn rna-btn-ghost rna-btn-sm" data-mdel="${i}"><i class="bi bi-trash text-danger"></i></button></td></tr>`).join('');
  const t = $('#ed-metricas'); t.innerHTML = head + `<tbody>${body || `<tr><td colspan="9" class="cell-sub" style="padding:14px">Nenhuma métrica. Clique em “Adicionar”.</td></tr>`}</tbody>`;
  syncOnInput(t, edMetricas, 'm');
  $$('[data-mdel]', t).forEach(b => b.addEventListener('click', () => { edMetricas.splice(+b.dataset.mdel, 1); renderMetricRows(); }));
}

function renderPointRows() {
  const head = `<thead><tr><th>Descrição</th><th>Criticidade</th><th>Método</th><th>Periodicidade</th><th>Equipamento</th><th></th></tr></thead>`;
  const body = edPontos.map((pt, i) => `<tr data-prow="${i}">
    <td><input class="form-control form-control-sm" data-pf="descricao" value="${escAttr(pt.descricao)}"></td>
    <td><select class="form-select form-select-sm" data-pf="criticidade" style="width:110px">${DATA.BIB_CRITICIDADES.map(c => `<option ${c === pt.criticidade ? 'selected' : ''}>${c}</option>`).join('')}</select></td>
    <td><input class="form-control form-control-sm" data-pf="metodo" value="${escAttr(pt.metodo)}"></td>
    <td><input class="form-control form-control-sm" data-pf="periodicidade" value="${escAttr(pt.periodicidade)}" style="width:120px"></td>
    <td><input class="form-control form-control-sm" data-pf="equipamento" value="${escAttr(pt.equipamento)}"></td>
    <td><button class="rna-btn rna-btn-ghost rna-btn-sm" data-pdel="${i}"><i class="bi bi-trash text-danger"></i></button></td></tr>`).join('');
  const t = $('#ed-pontos'); t.innerHTML = head + `<tbody>${body || `<tr><td colspan="6" class="cell-sub" style="padding:14px">Nenhum ponto. Clique em “Adicionar”.</td></tr>`}</tbody>`;
  syncOnInput(t, edPontos, 'p');
  $$('[data-pdel]', t).forEach(b => b.addEventListener('click', () => { edPontos.splice(+b.dataset.pdel, 1); renderPointRows(); }));
}

function syncOnInput(table, arr, kind) {
  const rowAttr = kind === 'm' ? 'mrow' : 'prow', fAttr = kind === 'm' ? 'mf' : 'pf';
  table.querySelectorAll(`[data-${rowAttr}]`).forEach(tr => {
    const i = +tr.dataset[rowAttr];
    tr.querySelectorAll(`[data-${fAttr}]`).forEach(inp => inp.addEventListener('input', () => { arr[i][inp.dataset[fAttr]] = inp.value; }));
  });
}

function renderDocList() {
  const box = $('#ed-doc-list'); if (!box) return;
  box.innerHTML = edDocsNovos.map((file, i) => `<span class="rna-badge badge-yellow me-1"><i class="bi ${docIcon(file.name.split('.').pop())}"></i> ${file.name} <i class="bi bi-x" data-docdel="${i}" style="cursor:pointer"></i></span>`).join('');
  $$('[data-docdel]', box).forEach(b => b.addEventListener('click', () => { edDocsNovos.splice(+b.dataset.docdel, 1); renderDocList(); }));
}

async function salvar(isNew, p, f, upImg) {
  const btn = $('#ed-save'); btn.disabled = true;
  try {
    const patch = {};
    $$('[data-p]').forEach(i => { patch[i.dataset.p] = i.value.trim(); });
    if (!patch.codigo || !patch.nome) { toast('Código e Nome são obrigatórios.', { type: 'warn' }); btn.disabled = false; return; }

    // imagem principal (opcional)
    let imagemUrl = p.imagem || null;
    if (upImg.hasFiles()) {
      const evs = await upImg.commit({ registro_tipo: 'biblioteca', registro_id: p.id || patch.codigo, usuario: USER });
      if (evs[0]) imagemUrl = evs[0].url;
    }

    let peca;
    if (isNew) {
      peca = await db.insert('bib_pecas', {
        ...patch, revisao: 1, ativo: patch.status !== 'Arquivado',
        imagem: imagemUrl, galeria: [], created_at: BIB.hoje(), updated_at: BIB.hoje(), created_by: USER.id
      });
      await BIB.registrarCriacao(peca.id, USER);
    } else {
      peca = await BIB.salvarRevisao(p.id, { ...patch, imagem: imagemUrl, ativo: patch.status !== 'Arquivado' }, USER);
    }

    // métricas e pontos: substitui o conjunto (simples e consistente)
    await substituir('bib_metricas', peca.id, edMetricas.filter(m => (m.nome || '').trim()), (m, ord) => ({ peca_id: peca.id, nome: m.nome, nominal: numOrNull(m.nominal), tol_min: numOrNull(m.tol_min), tol_max: numOrNull(m.tol_max), unidade: m.unidade, metodo: m.metodo, equipamento: m.equipamento, periodicidade: m.periodicidade, observacao: m.observacao || '', ordem: ord }));
    await substituir('bib_pontos_inspecao', peca.id, edPontos.filter(pt => (pt.descricao || '').trim()), (pt, ord) => ({ peca_id: peca.id, descricao: pt.descricao, criticidade: pt.criticidade, metodo: pt.metodo, periodicidade: pt.periodicidade, equipamento: pt.equipamento, foto: pt.foto || null, ordem: ord }));

    // documentos novos
    for (const file of edDocsNovos) {
      const url = await uploadArquivo(file, peca.id);
      await db.insert('bib_documentos', { peca_id: peca.id, nome: file.name, categoria: 'Outro', versao: '—', data: BIB.hoje(), responsavel: USER.nome, descricao: '', url, tipo: (file.name.split('.').pop() || '').toLowerCase(), tamanho: fmtBytes(file.size) });
    }

    toast(isNew ? 'Peça cadastrada com sucesso.' : `Revisão salva (Rev ${String(peca.revisao).padStart(2, '0')}).`, { type: 'ok', title: 'Biblioteca' });
    state.view = 'ficha'; state.pecaId = peca.id; render();
  } catch (err) {
    console.error('[biblioteca] salvar', err);
    toast('Erro ao salvar. ' + (err?.message || ''), { type: 'crit' });
    btn.disabled = false;
  }
}

async function substituir(tabela, pecaId, itens, mapFn) {
  const existentes = await db.list(tabela, { filter: { peca_id: pecaId } });
  for (const e of existentes) await db.remove(tabela, e.id);
  let ord = 1;
  for (const it of itens) await db.insert(tabela, mapFn(it, ord++));
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
function fmtVal(v) { return v == null || v === '' ? '—' : String(v).replace('.', ','); }
function fmtDateTime(iso) { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? iso : d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function fmtBytes(n) { if (!n) return ''; const kb = n / 1024; return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`; }
function escHtml(s) { return String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function escAttr(s) { return String(s ?? '').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }
function destacar(txt) { const q = BIB.normaliza(state.q); const t = String(txt); const i = BIB.normaliza(t).indexOf(q); if (i < 0 || !q) return t; return `${t.slice(0, i)}<mark>${t.slice(i, i + q.length)}</mark>${t.slice(i + q.length)}`; }
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function numOrNull(v) { if (v === '' || v == null) return null; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? null : n; }
function blankMetrica() { return { nome: '', nominal: '', tol_min: '', tol_max: '', unidade: '', metodo: '', equipamento: '', periodicidade: '' }; }
function blankPonto() { return { descricao: '', criticidade: 'Média', metodo: '', periodicidade: '', equipamento: '' }; }
