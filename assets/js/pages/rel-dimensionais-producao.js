/* ==========================================================================
   Rel. Dimensionais de Produção (Administração)
   ---------------------------------------------------------------------------
   Antes chamado "Relatórios Dimensionais Simulados", em Qualidade. Passou a
   viver em ADMINISTRAÇÃO e a se chamar "Rel. Dimensionais de Produção"
   (rota rel-dimensionais-producao.html; a rota antiga redireciona).

   Documento de APOIO OPERACIONAL derivado do relatório oficial: as
   características reprovadas recebem valores conformes gerados em memória por
   services/simulacao/*, o relatório é recalculado pelo motor oficial e o
   resultado passa a APROVADO. Serve a treinamento, demonstração, validação de
   interface e planejamento — nunca a liberação de produto ou rastreabilidade.

   ACESSO: exclusivo do administrador. O bloqueio é do RBAC (`rel_dim_producao`
   sem permissões para os demais perfis), aplicado por mountShell tanto no menu
   quanto na abertura direta da URL — não é ocultação de menu.

   POR QUE UM ARQUIVO SEPARADO, e não um parâmetro na tela oficial:
   nenhum relatório oficial pode sofrer modificação. Um flag dentro do arquivo
   oficial colocaria esta lógica no caminho de execução da consulta corporativa,
   que é a única base válida do sistema. A separação é deliberada; o LAYOUT, no
   entanto, é compartilhado (assets/js/relatorio-dim-secoes.js), então as duas
   telas não podem divergir visualmente.

   ESTE MÓDULO NÃO ALTERA NENHUM REGISTRO OFICIAL. Não há edição de medição, não
   há exclusão, não há autosave sobre insp_*. A única gravação que faz é a
   TRILHA DE AUDITORIA do próprio documento (quem gerou/exportou e quando).
   ========================================================================== */
import { mountShell } from '../app.js';
import { BRAND, podeVerMetricasTempo } from '../../../services/config.js';
import { db } from '../../../services/db.js';
import { INSP_STATUS } from '../../../services/inspecao-data.js';
import { fontesConsultaDimensional, pnsDoCliente, revisoesDoPN, fmtRevisao } from '../../../services/consulta-filtros.js';
import { comboFiltro } from '../rna-combo.js';
import { nomeDoSlug } from '../../../services/tipos-inspecao.js';
import { fmtMedida } from '../../../services/formato.js';
import { formatarDataBrasil, formatarDataHoraBrasil } from '../../../services/datahora.js';
import * as SIM from '../../../services/simulacao/simulation-service.js';
import { $, $$, toast } from '../ui.js';

/* Mesmos blocos do relatório oficial — fonte única, para que as duas telas
   tenham exatamente os mesmos campos, títulos e ordem. */
import { esc, cell, resultadoTag, inspecaoAposPinturaHtml } from '../relatorio-dim-secoes.js';

const PAGINA = 'rel-dimensionais-producao.html';

const ctx = await mountShell();
let USER, TIPOS = [], FONTES = null;
if (ctx) {
  USER = ctx.user;
  TIPOS = await tiposDisponiveis();
  queueMicrotask(route);
}

/* Catálogo de tipos do filtro — leitura direta (mesma lista do módulo oficial). */
async function tiposDisponiveis() {
  return (await db.list('insp_tipos').catch(() => []))
    .filter(t => t.ativo !== false).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
}

function route() {
  const params = new URLSearchParams(location.search);
  const rel = params.get('rel');
  if (rel) return abrirRelatorio(rel, params.get('print') === '1');
  renderConsulta();
}
function go(url) { history.pushState({}, '', url); route(); }
window.addEventListener('popstate', route);

/* Escopo por perfil — idêntico ao módulo oficial: o simulado nunca mostra
   relatório que o usuário não poderia ver no original. */
function escopo() {
  if (USER.role === 'auditor') return { somenteAuditor: USER.id };
  return {};
}

const numeroDe = r => r?.numero || ('REL-LEGADO-' + (String(r?.id ?? '').replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase() || '0000'));
const dataBR = iso => formatarDataBrasil(iso);
const dataHoraBR = iso => formatarDataHoraBrasil(iso);
const revLabel = v => (v === '' || v == null) ? '—' : 'Rev ' + fmtRevisao(v);

/* Identificação visual da simulação (§banner, §selo). */
const seloSim = () => `<span class="sim-selo">${SIM.SELO}</span>`;
const bannerSim = () => `<div class="sim-banner">
  <i class="bi bi-magic"></i>
  <div><b>RELATÓRIO DIMENSIONAL DE PRODUÇÃO</b>
  <div>${SIM.AVISO_TOPO}</div></div>
</div>`;
/* Marca d'água do PDF: só aparece na impressão (a tela já tem o banner).
   `position:fixed` faz o navegador repeti-la em TODAS as páginas impressas. */
const marcaDagua = () => `<div class="sim-watermark" aria-hidden="true">${
  Array.from({ length: 12 }, () => '<span>PRODUÇÃO</span>').join('')}</div>`;

/* ============================================================ CONSULTA ====== */
let ULT_RESULT = [], BUSCANDO = false;
const COMBO = {};

async function renderConsulta() {
  const st = INSP_STATUS;
  if (!FONTES) FONTES = await fontesConsultaDimensional().catch(e => { console.error('[SIM-DIM] fontes de filtro:', e); return { clientes: [], pns: [], auditores: [] }; });
  $('#rna-content').innerHTML = `
    <div class="rna-page-head">
      <div><div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Administração <i class="bi bi-chevron-right"></i> Rel. Dimensionais de Produção</div>
      <h1>Consulta de Rel. Dimensionais de Produção ${seloSim()}</h1><p>Mesma consulta do módulo oficial, exibindo a versão de produção de cada relatório.</p></div>
    </div>
    ${bannerSim()}
    <div class="rna-card mb-3"><div class="rna-card__body">
      <div class="row g-2">
        ${ftxt('numero', 'Nº do relatório', 'Número completo ou parte', 60)}
        ${fcombo('cliente', 'Cliente')}
        ${fcombo('pn', 'Part Number (PN)')}
        ${fcombo('auditor', 'Auditor')}
        ${ftxt('lote', 'Lote', '', 40)}
        ${ftxt('op', 'OP', '', 40)}
        ${fcombo('revisao', 'Revisão')}
        ${fsel('tipo', 'Tipo', `<option value="">Todos</option>${TIPOS.map(t => `<option value="${t.id}">${esc(t.nome)}</option>`).join('')}`)}
        ${fsel('status', 'Status', `<option value="">Todos</option>${Object.entries(st).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}`)}
        ${fsel('resultado', 'Resultado', `<option value="">Todos</option><option value="aprovado">Aprovado</option><option value="reprovado">Reprovado</option><option value="pendente">Em andamento</option>`)}
        ${fsel('classe', 'Classe no relatório oficial', `<option value="">Todas</option><option value="A">Classe A</option><option value="B">Classe B</option><option value="C">Classe C</option>`)}
        <div class="col-12 col-sm-6 col-lg-3 d-flex align-items-end"><div class="form-check cdim-check"><input class="form-check-input" type="checkbox" id="f-reprov"><label class="form-check-label" for="f-reprov">Somente com reprovação no oficial</label></div></div>
        ${fdate('de', 'Período — de')} ${fdate('ate', 'Período — até')}
        <div class="col-12 col-lg-6 d-flex align-items-end gap-2 cdim-actions">
          <button class="rna-btn rna-btn-primary" id="btn-buscar"><i class="bi bi-search"></i> Buscar</button>
          <button class="rna-btn rna-btn-ghost" id="btn-limpar"><i class="bi bi-x-circle"></i> Limpar filtros</button>
        </div>
      </div>
      <div class="cdim-export d-flex flex-wrap align-items-center gap-2 mt-3 pt-3">
        <span class="cell-sub"><i class="bi bi-download"></i> Exportar os resultados da pesquisa atual:</span>
        <div class="flex-fill"></div>
        <button class="rna-btn rna-btn-ghost" id="btn-csv"><i class="bi bi-filetype-csv"></i> CSV</button>
        <button class="rna-btn rna-btn-ghost" id="btn-xls"><i class="bi bi-file-earmark-excel"></i> Excel</button>
      </div>
    </div></div>
    <div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-table"></i> Resultados</h3><span id="res-count" class="cell-sub"></span></div>
      <div class="rna-card__body p-0" id="res-host"><div class="empty-state" style="padding:32px"><i class="bi bi-search"></i><div>Use os filtros e clique em <b>Buscar</b>.</div></div></div></div>`;

  COMBO.cliente = comboFiltro($('#f-cliente'), {
    allLabel: 'Todos os clientes', emptyText: 'Nenhum cliente encontrado',
    options: FONTES.clientes.map(c => ({ value: c, label: c })), onChange: aoTrocarCliente
  });
  COMBO.pn = comboFiltro($('#f-pn'), {
    allLabel: 'Todos os Part Numbers', emptyText: 'Nenhum Part Number encontrado',
    options: opcoesPN(''), onChange: aoTrocarPN
  });
  COMBO.auditor = comboFiltro($('#f-auditor'), {
    allLabel: 'Todos os auditores', emptyText: 'Nenhum auditor encontrado',
    options: FONTES.auditores.map(a => ({ value: a, label: a }))
  });
  COMBO.revisao = comboFiltro($('#f-revisao'), {
    allLabel: 'Todas as revisões', emptyText: 'Nenhuma revisão disponível.',
    options: revisoesDoPN(FONTES, '')
  });

  $('#btn-buscar').addEventListener('click', buscar);
  $('#btn-limpar').addEventListener('click', limparFiltros);
  $('#btn-csv').addEventListener('click', () => exportar('csv'));
  $('#btn-xls').addEventListener('click', () => exportar('xls'));
  $$('#rna-content input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') buscar(); }));
  buscar();
}
const fld  = (id, label, inner) => `<div class="col-12 col-sm-6 col-lg-3"><label class="form-label" for="f-${id}">${label}</label>${inner}</div>`;
const ftxt = (id, label, ph = '', max = 80) => fld(id, label, `<input class="form-control" id="f-${id}" placeholder="${ph}" maxlength="${max}" autocomplete="off">`);
const fsel = (id, label, opts) => fld(id, label, `<select class="form-select" id="f-${id}">${opts}</select>`);
const fdate = (id, label) => fld(id, label, `<input type="date" class="form-control" id="f-${id}">`);
const fcombo = (id, label) => fld(id, label, `<div class="rna-combo bib-combo"><input class="form-control" id="f-${id}"></div>`);

const opcoesPN = cliente => pnsDoCliente(FONTES, cliente).map(c => ({ value: c, label: c }));
function aoTrocarCliente(cliente) {
  COMBO.pn.clear();
  COMBO.pn.setOptions(opcoesPN(cliente), {
    emptyText: cliente ? 'Nenhum Part Number disponível para este cliente.' : 'Nenhum Part Number encontrado'
  });
  aoTrocarPN('');
}
function aoTrocarPN(pn) {
  COMBO.revisao.clear();
  COMBO.revisao.setOptions(revisoesDoPN(FONTES, pn), { emptyText: 'Nenhuma revisão disponível.' });
}

function limparFiltros() {
  $$('#rna-content input, #rna-content select').forEach(i => { if (i.type === 'checkbox') i.checked = false; else i.value = ''; });
  Object.values(COMBO).forEach(c => c.clear());
  COMBO.pn.setOptions(opcoesPN(''), { emptyText: 'Nenhum Part Number encontrado' });
  COMBO.revisao.setOptions(revisoesDoPN(FONTES, ''));
  buscar();
}

async function buscar() {
  if (BUSCANDO) return;
  const g = id => $('#f-' + id)?.value?.trim() || '';
  const de = g('de'), ate = g('ate');
  if (de && ate && de > ate) { toast('Período inválido: a data inicial não pode ser maior que a data final.', { type: 'warn' }); return; }
  const filtros = {
    numero: g('numero').replace(/\s+/g, ''), cliente: COMBO.cliente.value, pn: COMBO.pn.value,
    auditor: COMBO.auditor.value, lote: g('lote'), op: g('op'), revisao: COMBO.revisao.value,
    tipo: g('tipo'), status: g('status'), resultado: g('resultado'), classe: g('classe'),
    de, ate, comReprovacao: $('#f-reprov')?.checked
  };
  const btn = $('#btn-buscar'), btnHtml = btn?.innerHTML;
  BUSCANDO = true;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Buscando...'; }
  try {
    const rows = await SIM.consultarSimulados(filtros, escopo());
    ULT_RESULT = rows;
    renderResultados(rows);
  } catch (e) {
    console.error('[SIM-DIM] busca falhou:', e);
    ULT_RESULT = [];
    $('#res-count').textContent = '';
    $('#res-host').innerHTML = `<div class="empty-state" style="padding:32px"><i class="bi bi-exclamation-triangle"></i><div>Não foi possível concluir a busca. Tente novamente.</div></div>`;
    toast('Erro ao buscar os relatórios de produção.', { type: 'crit' });
  } finally {
    BUSCANDO = false;
    if (btn) { btn.disabled = false; btn.innerHTML = btnHtml; }
  }
}

function renderResultados(rows) {
  const simulados = rows.filter(r => r._simulado).length;
  $('#res-count').innerHTML = (rows.length === 1 ? '1 relatório' : `${rows.length} relatórios`) +
    (simulados ? ` · <b>${simulados}</b> com valores de produção` : '');
  const host = $('#res-host');
  if (!rows.length) {
    host.innerHTML = `<div class="empty-state" style="padding:32px"><i class="bi bi-inbox"></i>
      <div>Nenhum relatório encontrado com os filtros informados.</div>
      <div class="cell-sub mt-1">Revise os filtros ou clique em <b>Limpar filtros</b>.</div></div>`;
    return;
  }
  host.innerHTML = `
    <div class="rna-table-wrap cdim-table"><table class="rna-table"><thead><tr>
      <th>Relatório</th><th>Data</th><th>Cliente</th><th>PN · Rev</th><th>Lote · OP</th><th>Qtd. Peças</th><th>Auditor</th><th>Tipo</th><th>Result.</th><th>Classe</th><th>Ações</th>
      </tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table></div>
    <div class="cdim-cards">${rows.map(cardHtml).join('')}</div>`;
  $$('[data-open]', host).forEach(b => b.addEventListener('click', () => go(`${PAGINA}?rel=${b.dataset.open}`)));
}

/* Aviso honesto de geração parcial: um relatório cuja reprovação não tem como
   virar valor conforme (cadastro sem limites na Biblioteca) NÃO é apresentado
   como aprovado. Mostrar "Aprovado" aqui e "Reprovado" ao abrir seria um falso
   sucesso — o usuário precisa saber que a cota não pôde ser recalculada. */
const avisoParcial = r => r._simulacaoParcial
  ? `<div class="cell-sub sim-parcial" title="Cotas sem limites utilizáveis na Biblioteca Técnica: ${esc((r._cotasNaoSimulaveis || []).join(', '))}">
       <i class="bi bi-exclamation-triangle"></i> geração parcial</div>`
  : '';

function clsBadge(r) {
  const cls = r._maiorClasse ? `<span class="rna-badge ${r._maiorClasse === 'A' ? 'badge-crit' : r._maiorClasse === 'B' ? 'badge-warn' : 'badge-pend'}">Classe ${r._maiorClasse}</span>` : '<span class="text-muted-2">—</span>';
  return cls + (r._reprovacoes ? `<div class="cell-sub">${r._reprovacoes} repr.</div>` : '');
}

function rowHtml(r) {
  return `<tr>
    <td class="cell-strong">${numeroDe(r)} ${r._simulado ? seloSim() : ''}${avisoParcial(r)}</td>
    <td class="cell-sub">${dataBR(r.started_iso)}</td>
    <td>${esc(r.cliente) || '—'}</td>
    <td>${esc(r.peca_codigo) || '—'}<div class="cell-sub">${revLabel(r.revisao_desenho)}</div></td>
    <td>${esc(r.lote) || '—'}<div class="cell-sub">OP ${esc(r.op) || '—'}</div></td>
    <td class="cell-strong" style="text-align:center">${(r.quantidade === 0 || r.quantidade) ? r.quantidade : '—'}</td>
    <td>${esc(r.auditor_nome) || '—'}</td>
    <td class="cell-sub">${esc(r.tipo_nome) || '—'}</td>
    <td>${resPill(r.resultado)}</td>
    <td>${clsBadge(r)}</td>
    <td><div class="cdim-row-actions">
      <button class="rna-btn rna-btn-primary rna-btn-sm" data-open="${r.id}"><i class="bi bi-eye"></i> Abrir</button>
    </div></td></tr>`;
}
const mini = (l, v) => `<div><span class="insp-info-l">${l}</span><span class="insp-info-v">${(v === 0 || v) ? esc(v) : '—'}</span></div>`;
function cardHtml(r) {
  return `<div class="cdim-card">
    <div class="cdim-card__head">
      <div><div class="cdim-card__num">${numeroDe(r)} ${r._simulado ? seloSim() : ''}</div>
      <div class="cell-sub">${dataBR(r.started_iso)} · ${esc(r.tipo_nome) || '—'}</div>${avisoParcial(r)}</div>
      ${resPill(r.resultado)}
    </div>
    <div class="cdim-card__grid">
      ${mini('Cliente', r.cliente)} ${mini('Part Number', r.peca_codigo)}
      ${mini('Revisão', revLabel(r.revisao_desenho))} ${mini('Auditor', r.auditor_nome)}
      ${mini('Lote', r.lote)} ${mini('OP', r.op)}
      ${mini('Qtd. de Peças', r.quantidade)}
    </div>
    <div class="d-flex align-items-center gap-2 cdim-actions">
      <div>${clsBadge(r)}</div><div class="flex-fill"></div>
      <button class="rna-btn rna-btn-primary rna-btn-sm" data-open="${r.id}"><i class="bi bi-eye"></i> Abrir</button>
    </div></div>`;
}
function resPill(r) {
  if (r === 'aprovado') return `<span class="insp-pill insp-ok">Aprovado</span>`;
  if (r === 'reprovado') return `<span class="insp-pill insp-crit">Reprovado</span>`;
  return `<span class="insp-pill insp-pend">Em andamento</span>`;
}
const resultadoLabel = r => r === 'aprovado' ? 'Aprovado' : r === 'reprovado' ? 'Reprovado' : 'Em andamento';

/* ------------------------------------------------------------- exportação ---
   Exporta a VISÃO DE PRODUÇÃO e diz isso em duas colunas próprias (De produção /
   Resultado oficial), para que a planilha jamais seja confundida com o extrato
   do módulo oficial. */
function exportar(fmt) {
  if (!ULT_RESULT.length) return toast('Não existem relatórios para exportar.', { type: 'warn' });
  const cols = ['Nº do Relatório', 'Data', 'Cliente', 'Part Number', 'Revisão', 'Lote', 'OP', 'Qtd. de Peças', 'Auditor', 'Tipo',
    'Status', 'Resultado (PRODUÇÃO)', 'Resultado oficial', 'De produção', 'Maior Classe (oficial)'];
  const linhas = ULT_RESULT.map(r => [numeroDe(r), dataBR(r.started_iso), r.cliente, r.peca_codigo,
    (r.revisao_desenho === '' || r.revisao_desenho == null) ? '' : fmtRevisao(r.revisao_desenho),
    r.lote, r.op, (r.quantidade === 0 || r.quantidade) ? r.quantidade : '', r.auditor_nome, r.tipo_nome,
    INSP_STATUS[r.status]?.label || r.status, resultadoLabel(r.resultado),
    resultadoLabel(r._resultadoOriginal ?? r.resultado), r._simulado ? 'SIM' : 'NÃO',
    r._maiorClasseOriginal ?? r._maiorClasse ?? '']);
  const sep = fmt === 'csv' ? ';' : '\t';
  const escCel = v => { const s = String(v ?? ''); return (s.includes(sep) || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; };
  const conteudo = ['REL. DIMENSIONAIS DE PRODUÇÃO — ' + SIM.AVISO_TOPO, cols.join(sep), ...linhas.map(l => l.map(escCel).join(sep))].join('\r\n');
  const blob = new Blob(['﻿' + conteudo], { type: fmt === 'csv' ? 'text/csv;charset=utf-8' : 'application/vnd.ms-excel;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `REL_DIM_PRODUCAO_${new Date().toISOString().slice(0, 10)}.${fmt === 'csv' ? 'csv' : 'xls'}`;
  a.click(); URL.revokeObjectURL(a.href);
  registrarUso(`Exportou a lista de produção (${fmt.toUpperCase()})`, `${ULT_RESULT.length} relatório(s)`, a.download);
  toast(`Exportado (${fmt.toUpperCase()}) — Rel. Dimensionais de Produção.`, { type: 'ok' });
}

/* ============================================================ RELATÓRIO ===== */
async function abrirRelatorio(relId, autoPrint = false) {
  const data = await SIM.carregarSimulado(relId).catch(e => { console.error('[SIM-DIM] carga falhou:', e); return null; });
  if (!data) { toast('Relatório não encontrado.', { type: 'crit' }); return renderConsulta(); }
  const { rel, caracteristicas, acoes, amostras, resumo, simulacao } = data;
  const hist = await SIM.historicoOficial(relId);
  const acaoBy = Object.fromEntries(acoes.map(a => [a.caracteristica_id, a]));
  const s = INSP_STATUS[rel.status] || { label: rel.status, badge: 'badge-na' };
  const numero = numeroDe(rel);
  /* Identificador PRÓPRIO do documento de produção — nunca o número oficial
     sozinho, para que uma cópia impressa não se confunda com o registro real. */
  const codigoVerif = 'PROD-' + (numero.replace(/[^0-9]/g, '').slice(-8) || numero.replace(/[^A-Z0-9]/gi, '').slice(-8));

  $('#rna-content').innerHTML = `
    <div class="rna-page-head no-print">
      <div><div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> <a href="#" id="bc-back">Rel. Dimensionais de Produção</a><i class="bi bi-chevron-right"></i> ${numero}</div>
      <h1>Relatório de Inspeção Dimensional — Produção ${seloSim()}</h1></div>
      <div class="d-flex gap-2">
        <button class="rna-btn rna-btn-ghost" id="btn-voltar"><i class="bi bi-arrow-left"></i> Voltar</button>
        <button class="rna-btn rna-btn-primary" id="btn-imprimir"><i class="bi bi-printer"></i> Imprimir / PDF</button>
      </div>
    </div>
    ${bannerSim()}
    ${avisoSimulacao(simulacao, rel)}
    <div class="insp-report insp-report--simulado" id="insp-report">
      ${marcaDagua()}
      <div class="insp-rep-head">
        <div class="insp-rep-brand"><img src="${BRAND.logo}" alt="logo"><div><b>${BRAND.company}</b><div class="cell-sub">${BRAND.full}</div></div></div>
        <div class="insp-rep-title"><h2>Relatório Dimensional de Produção</h2>
          <div class="insp-rep-meta"><span><b>${numero}</b></span><span>${esc(rel.tipo_nome)}</span>
          <span class="rna-badge ${s.badge}">${s.label}</span> ${resPill(rel.resultado)} ${seloSim()}</div>
          <div class="cell-sub">Código de verificação: ${codigoVerif}</div></div>
      </div>

      <div class="sim-aviso-print">RELATÓRIO DIMENSIONAL DE PRODUÇÃO — ${SIM.AVISO_TOPO}</div>

      <div class="insp-rep-section"><div class="insp-rep-sec-t">Identificação da peça</div>
        <div class="insp-rep-grid">
          ${cell('Cliente', esc(rel.cliente))} ${cell('PN', esc(rel.peca_codigo))} ${cell('Peça', esc(rel.peca_nome))} ${cell('Desenho / Rev', revLabel(rel.revisao_desenho))}
          ${cell('Data da revisão', dataBR(rel.data_revisao_desenho) || esc(rel.data_revisao_desenho))} ${cell('Número da AD', esc(rel.numero_ad))} ${cell('Lote', esc(rel.lote))} ${cell('OP', esc(rel.op))}
          ${cell('Quantidade', rel.quantidade)} ${cell('Planta', esc(rel.planta))} ${cell('Linha', esc(rel.linha))} ${cell('Turno', esc(rel.turno))}
        </div></div>

      <div class="insp-rep-section"><div class="insp-rep-sec-t">Identificação da inspeção</div>
        <div class="insp-rep-grid">
          ${cell('Tipo de inspeção', esc(rel.tipo_nome))}
          ${cell('Peça aplicável a', tiposVinculoTexto(rel))}
          ${cell('Auditor', esc(rel.auditor_nome))} ${cell('Matrícula', esc(rel.auditor_matricula))}
          ${cell('Início', dataHoraBR(rel.started_iso))} ${cell('Conclusão', rel.completed_iso ? dataHoraBR(rel.completed_iso) : '—')}
          ${podeVerMetricasTempo(USER.role) ? cell('Duração', fmtDuracao(rel.duracao_seg)) : ''}
          ${cell('Resultado no relatório oficial', resultadoLabel(rel._resultadoOriginal))}
        </div></div>

      ${amostras.length ? `<div class="insp-rep-section"><div class="insp-rep-sec-t">Medição por peça</div>
        <table class="insp-mtable insp-rep-table"><thead><tr>
          <th>Peça</th><th>Auditor responsável</th><th>Início</th><th>Conclusão</th>${podeVerMetricasTempo(USER.role) ? '<th>Tempo</th>' : ''}<th>Resultado</th><th>Observação</th>
        </tr></thead><tbody>
        ${amostras.map(a => `<tr>
          <td>Peça ${a.amostra}</td>
          <td>${esc(a.auditor_nome || '—')}${a.concluido_por_nome && a.concluido_por_nome !== a.auditor_nome ? `<div class="cell-sub">Concluída por ${esc(a.concluido_por_nome)}</div>` : ''}</td>
          <td>${dataHoraBR(a.inicio_iso)}</td>
          <td>${dataHoraBR(a.fim_iso)}</td>
          ${podeVerMetricasTempo(USER.role) ? `<td>${a.duracao_seg != null ? fmtDuracao(a.duracao_seg) : '—'}</td>` : ''}
          <td>${a.resultado === 'aprovado' ? '<span class="rep-tag rep-ok">✓ Aprovada</span>' : a.resultado === 'reprovado' ? '<span class="rep-tag rep-crit">✗ Reprovada</span>' : '—'}${a._simulado ? ' ' + tagAjustado() : ''}</td>
          <td class="cell-sub">${esc(a.observacao || '—')}</td></tr>`).join('')}
        </tbody></table>
        <div class="cell-sub mt-1">Resultado por peça recalculado sobre os valores de produção. Auditor, horários e observações são os do registro oficial.</div></div>` : ''}

      <div class="insp-rep-section"><div class="insp-rep-sec-t">Resultados das medições</div>
        <div class="insp-table-wrap"><table class="insp-mtable insp-rep-table ${(rel.quantidade || 0) > 5 ? 'insp-rep-table--wide' : ''}"><thead><tr>
          <th>Cota</th><th>Característica</th><th>Quadrante</th><th>Un.</th><th>Nom.</th><th>Mín</th><th>Máx</th><th>Equip.</th><th>Obs.</th>
          ${Array.from({ length: rel.quantidade || 0 }, (_, i) => `<th>P${i + 1}</th>`).join('')}
          <th>Result.</th><th>Classe</th></tr></thead><tbody>
          ${caracteristicas.map(c => {
            const info = !!c.informativo;
            const attr = c.tipo_especificacao === 'ATRIBUTO';
            const nomeCel = `${esc(c.caracteristica)}${c._simulado ? ' ' + tagAjustado() : ''}${c._simulacaoImpossivel ? ' ' + tagNaoSimulavel(c) : ''}${c.referencia ? `<div class="cell-sub"><i class="bi bi-info-circle"></i> ${esc(c.referencia)}</div>` : ''}`;
            const dimCels = info ? `<td colspan="3" class="cell-sub" style="text-align:center">Referência</td>`
              : attr ? `<td colspan="3" class="cell-sub" style="text-align:center">OK / NOK</td>`
              : `<td>${dash(c.nominal)}</td><td>${dash(c.minimo)}</td><td>${dash(c.maximo)}</td>`;
            const obsCel = `<td class="cell-sub insp-rep-obs">${c.observacao_tec ? esc(c.observacao_tec) : '—'}</td>`;
            const sampCels = Array.from({ length: rel.quantidade || 0 }, (_, i) => {
              const m = c.medicoes.find(x => x.amostra === i + 1);
              const cls = (!info && m) ? repCls(m._visual) : '';
              const sim = m?._simulado;
              return `<td class="${cls}${sim ? ' sim-cel' : ''}"${sim ? ` title="Valor de produção. No relatório oficial: ${esc(dash(m._valorOriginal))}"` : ''}>${
                m ? esc(dash(m.valor)) : '—'}${sim ? '<i class="bi bi-check2-circle sim-cel__ic"></i>' : ''}</td>`;
            }).join('');
            const temMedRef = c.medicoes.some(m => String(m.valor ?? '') !== '');
            const resCel = info
              ? `<span class="rep-tag">${temMedRef ? 'Registrado — Referência' : 'Referência informativa'}</span>`
              : resultadoTag(c.resultado, c._visual);
            return `<tr class="${c._simulado ? 'sim-linha' : ''}">
            <td>${esc(c.cota ?? '—')}</td><td>${nomeCel}</td><td>${esc(c.quadrante || '—')}</td><td>${esc(c.unidade || '')}</td>${dimCels}<td class="cell-sub">${esc(c.equipamento || '—')}</td>${obsCel}
            ${sampCels}
            <td>${resCel}</td>
            <td>${classeCel(c)}</td></tr>`; }).join('')}
        </tbody></table></div>
        <div class="cell-sub mt-1"><span class="rep-tag rep-ok">✓ Aprovado</span> dentro da faixa segura ·
          <span class="rep-tag rep-warn">▲ Aprovado com atenção</span> no limite ou próximo dele ·
          <span class="rep-tag rep-crit">✗ Reprovado</span> fora do limite. Limites inclusivos.
          ${tagAjustado()} valor gerado automaticamente — no relatório oficial esta cota estava reprovada.</div></div>

      ${/* Mesma seção e mesmo título do relatório oficial. Neste documento ela
            costuma vir vazia (os valores ficam dentro dos limites); quando
            aparece, é porque a cota não tinha desfecho conforme possível. */''}
      ${inspecaoAposPinturaHtml(caracteristicas, resumo)}

      ${caracteristicas.some(c => c.resultado === 'reprovado') ? `<div class="insp-rep-section"><div class="insp-rep-sec-t">Reprovações e tratamento</div>
        ${caracteristicas.filter(c => c.resultado === 'reprovado').map(c => { const a = acaoBy[c.id] || {}; return `<div class="insp-rep-reprov">
          <b>${esc(c.caracteristica)}</b> (cota ${esc(c.cota)}) — ${classeCel(c)}
          ${c._simulacaoImpossivel ? `<div class="cell-sub"><i class="bi bi-exclamation-triangle"></i> ${esc(c._motivoSimulacao)}</div>` : ''}
          <div class="insp-rep-grid mt-1">
            ${cell('Limite', `${dash(c.minimo)} a ${dash(c.maximo)} ${esc(c.unidade || '')}`)} ${cell('Amostras reprovadas', esc(c.medicoes.filter(m => m.resultado === 'reprovado').map(m => `#${m.amostra}=${dash(m.valor)}`).join(', ')))}
            ${cell('Observação', esc(c.observacao || a.observacao))} ${cell('Ação imediata', esc(a.acao_imediata))} ${cell('Ação permanente', esc(a.acao_permanente))}
            ${cell('Responsável', esc(a.responsavel))} ${cell('Prazo', a.prazo ? dataBR(a.prazo) : '—')}
            ${cell('Pendência', a.pendencia_id ? 'Gerada' : '—')}
          </div></div>`; }).join('')}</div>` : ''}

      <div class="insp-rep-section"><div class="insp-rep-sec-t">Resumo</div>
        <div class="insp-rep-grid">
          ${cell('Características', resumo.totalCaracteristicas)} ${cell('Aprovadas', resumo.caracteristicasAprovadas)} ${cell('Reprovadas', resumo.caracteristicasReprovadas)}
          ${cell('Medições', resumo.totalMedicoes)} ${cell('Conformidade', resumo.conformidade + '%')} ${cell('Classe A / B / C', `${resumo.classeA} / ${resumo.classeB} / ${resumo.classeC}`)}
          ${resumo.classeNaoAplica ? cell('Sem classificação (Não se aplica)', resumo.classeNaoAplica) : ''}
          ${resumo.caracteristicasReferencia ? cell('Referências registradas', `${resumo.medicoesReferencia} medição(ões) · ${resumo.caracteristicasReferencia} característica(s)`) : ''}
          ${/* Exclusivos deste documento: quantificam o que foi gerado. Não
                existem no relatório oficial porque lá nada é gerado. */''}
          ${cell('Características ajustadas', simulacao.caracteristicasAjustadas)} ${cell('Medições ajustadas', simulacao.medicoesAjustadas)}
        </div>
        <div class="insp-rep-final ${INSP_STATUS[rel.status]?.badge}">RESULTADO GERAL: <b>${rel.resultado === 'aprovado' ? 'APROVADO' : rel.resultado === 'reprovado' ? 'REPROVADO' : 'EM ANDAMENTO'}</b></div>
        <div class="cell-sub mt-1" style="text-align:center">Resultado no relatório oficial: <b>${resultadoLabel(rel._resultadoOriginal)}</b> — preservado, sem qualquer alteração.</div>
      </div>

      ${hist.length ? `<div class="insp-rep-section no-print-optional"><div class="insp-rep-sec-t">Histórico</div>
        <table class="rna-table"><tbody>${hist.map(h => `<tr><td class="cell-sub" style="width:150px">${dataHoraBR(h.quando)}</td><td><b>${esc(h.acao)}</b> ${h.campo && h.campo !== '—' ? `· ${esc(h.campo)}: ${esc(h.antes)} → ${esc(h.depois)}` : esc(h.depois)} ${h.justificativa ? `<div class="cell-sub">Justificativa: ${esc(h.justificativa)}</div>` : ''}</td><td class="cell-sub">${esc(h.user_nome)}</td></tr>`).join('')}</tbody></table>
        <div class="cell-sub mt-1">O histórico pertence ao relatório oficial e não é alterado por este documento.</div></div>` : ''}

      ${/* Rodapé do PDF: identificador próprio, origem, quem gerou e quando —
            os quatro dados que permitem auditar uma cópia impressa. */''}
      <div class="insp-rep-footer">
        <span><b>${codigoVerif}</b> · DE PRODUÇÃO</span>
        <span>Origem: relatório oficial ${numero}</span>
        <span>Gerado por ${esc(USER?.nome || '—')} em ${dataHoraBR(new Date())}</span>
        <span>Documento de apoio operacional — não substitui o registro oficial de medição</span>
      </div>
    </div>`;

  /* Nome sugerido do PDF. O navegador usa document.title como nome padrão do
     arquivo na caixa de impressão — é o único ponto onde dá para influenciar
     isso sem gerar o PDF no cliente. Restaurado ao sair da tela. */
  document.title = `REL_DIM_PRODUCAO_${(rel.peca_codigo || 'SEM-PN').replace(/[^\w.-]+/g, '-')}_${new Date().toISOString().slice(0, 10)}_${codigoVerif}`;

  /* TRILHA DE AUDITORIA (§histórico) — geração e exportação vão para a tabela
     `logs`, a mesma trilha do resto do sistema (legível só por admin/supervisor).
     Reusa a estrutura existente em vez de criar um histórico paralelo. Nunca
     derruba a tela: db.log já é não-lançante por contrato. */
  registrarUso('Gerou relatório dimensional de produção', numero, codigoVerif);

  $('#bc-back').addEventListener('click', e => { e.preventDefault(); go(PAGINA); });
  $('#btn-voltar').addEventListener('click', () => go(PAGINA));
  $('#btn-imprimir').addEventListener('click', () => {
    registrarUso('Exportou/imprimiu relatório dimensional de produção', numero, codigoVerif);
    window.print();
  });
  if (autoPrint) setTimeout(() => window.print(), 500);
}

/** Registro de uso do documento de produção: quem, quando, qual documento e de
    qual relatório oficial ele derivou. */
function registrarUso(acao, numeroOficial, codigo) {
  db.log({
    usuario: USER?.nome || '—', acao, entidade: 'rel_dim_producao',
    antes: `origem: ${numeroOficial}`, depois: codigo
  });
}

/* Aviso de topo quando a simulação NÃO conseguiu aprovar tudo. Sem isto, o
   usuário veria "REPROVADO" num módulo que promete aprovar e não saberia por quê. */
function avisoSimulacao(sim, rel) {
  if (!rel._simulado) {
    return `<div class="sim-nota"><i class="bi bi-info-circle"></i>
      <div>Este relatório já estava <b>${resultadoLabel(rel._resultadoOriginal)}</b> no módulo oficial — nenhum valor foi gerado.</div></div>`;
  }
  if (sim.completa) return '';
  const partes = [];
  if (sim.impossiveis.length) partes.push(`${sim.impossiveis.length} característica(s) sem limites utilizáveis na Biblioteca Técnica (cotas ${
    sim.impossiveis.map(c => esc(c.cota ?? '—')).join(', ')})`);
  if (sim.pendentes.length) partes.push(`${sim.pendentes.length} característica(s) com medição não preenchida no relatório oficial`);
  return `<div class="sim-nota sim-nota--warn"><i class="bi bi-exclamation-triangle"></i>
    <div><b>Geração parcial.</b> ${partes.join(' e ')}. Por isso o resultado não é "Aprovado":
    a geração só troca valores reprovados por valores que a regra de tolerância realmente aprova.</div></div>`;
}

const dash = v => fmtMedida(v);
const tagAjustado = () => `<span class="sim-ajustado" title="Valor gerado automaticamente dentro dos limites cadastrados."><i class="bi bi-check2-circle"></i> Ajustado automaticamente</span>`;
const tagNaoSimulavel = c => `<span class="sim-ajustado sim-ajustado--warn" title="${esc(c._motivoSimulacao)}"><i class="bi bi-exclamation-triangle"></i> Não simulável</span>`;

function classeCel(c) {
  if (c.resultado !== 'reprovado' || c.informativo) return '—';
  if (c.classe_defeito) return `<span class="rep-tag ${c.classe_defeito === 'A' ? 'rep-crit' : c.classe_defeito === 'B' ? 'rep-warn' : ''}">Classe ${esc(c.classe_defeito)}</span>`;
  return '<span class="cell-sub">—</span>';
}
const repCls = v => v === 'ok' ? 'rep-ok' : v === 'atencao' ? 'rep-warn' : v === 'crit' ? 'rep-crit' : '';
function tiposVinculoTexto(rel) {
  const arr = Array.isArray(rel.peca_tipos_inspecao) ? rel.peca_tipos_inspecao : [];
  return arr.length ? esc(arr.map(s => nomeDoSlug(s)).join(' · ')) : '—';
}
/* Formata segundos → "1h 12m 03s" (mesma apresentação do módulo oficial). */
function fmtDuracao(seg) {
  if (seg == null) return '—';
  const h = Math.floor(seg / 3600), m = Math.floor(seg % 3600 / 60), s = seg % 60;
  return (h ? `${h}h ` : '') + (h || m ? `${String(m).padStart(2, '0')}m ` : '') + `${String(s).padStart(2, '0')}s`;
}
