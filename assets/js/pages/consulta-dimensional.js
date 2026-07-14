/* ==========================================================================
   Consulta de Relatórios Dimensionais (Qualidade) — §27-31
   Consulta corporativa: filtros combináveis (Cliente/PN/Auditor/Revisão como
   listas pesquisáveis — fonte única em services/consulta-filtros.js), resultados
   em tabela (desktop) e cards (mobile), abertura do relatório completo (§30),
   impressão A4 (§24) e exportação (PDF via impressão / CSV / Excel).
   Também serve como visualizador do relatório individual (?rel=<id>).
   Numeração automática: gerada UMA vez em inspecao.js/proximoNumero() na criação
   do relatório — aqui é somente leitura; legados sem número ganham fallback visual.
   ========================================================================== */
import { mountShell } from '../app.js';
import { BRAND } from '../../../services/config.js';
import * as INSP from '../../../services/inspecao.js';
import { INSP_STATUS } from '../../../services/inspecao-data.js';
import { fontesConsultaDimensional, pnsDoCliente, revisoesDoPN, fmtRevisao } from '../../../services/consulta-filtros.js';
import { comboFiltro } from '../rna-combo.js';
import { $, $$, toast } from '../ui.js';

const ctx = await mountShell();
let USER, TIPOS = [], FONTES = null;
if (ctx) {
  USER = ctx.user; TIPOS = await INSP.tiposDisponiveis();
  // defer p/ o microtask: garante que os helpers const (ftxt/fdate/resPill...)
  // declarados abaixo já estejam inicializados quando route() renderizar (evita TDZ).
  queueMicrotask(route);
}

function route() {
  const rel = new URLSearchParams(location.search).get('rel');
  if (rel) return abrirRelatorio(rel);
  renderConsulta();
}
function go(url) { history.pushState({}, '', url); route(); }
window.addEventListener('popstate', route);

/* Escopo por perfil (§31): auditor vê os seus; supervisor/gestor/admin veem a planta/tudo. */
function escopo() {
  if (USER.role === 'auditor') return { somenteAuditor: USER.id };
  return {};   // admin/supervisor/gestor: RLS trata em produção
}

/* Número do relatório: gerado uma única vez na criação (inspecao.js). Relatórios
   legados sem número recebem fallback visual estável derivado do id — nada é regravado. */
const numeroDe = r => r?.numero || ('REL-LEGADO-' + (String(r?.id ?? '').replace(/[^a-z0-9]/gi, '').slice(-4).toUpperCase() || '0000'));
const dataBR = iso => (String(iso || '').slice(0, 10).split('-').reverse().join('/')) || '—';
const revLabel = v => (v === '' || v == null) ? '—' : 'Rev ' + fmtRevisao(v);

/* ============================================================ CONSULTA (§28-29) */
let ULT_RESULT = [], BUSCANDO = false;
const COMBO = {};

async function renderConsulta() {
  const st = INSP_STATUS;
  if (!FONTES) FONTES = await fontesConsultaDimensional().catch(e => { console.error('[CONSULTA-DIM] fontes de filtro:', e); return { clientes: [], pns: [], auditores: [] }; });
  $('#rna-content').innerHTML = `
    <div class="rna-page-head">
      <div><div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Qualidade <i class="bi bi-chevron-right"></i> Relatórios Dimensionais</div>
      <h1>Consulta de Relatórios Dimensionais</h1><p>Consulte, visualize, imprima e exporte relatórios de inspeção dimensional.</p></div>
    </div>
    <div class="rna-card mb-3"><div class="rna-card__body">
      <div class="row g-2">
        ${ftxt('numero', 'Nº do relatório', 'Número completo ou parte', 60)}
        ${fcombo('cliente', 'Cliente')}
        ${fcombo('pn', 'Part Number (PN)')}
        ${fcombo('auditor', 'Auditor')}
        ${ftxt('lote', 'Lote', '', 40)}
        ${ftxt('op', 'OP', '', 40)}
        ${fcombo('revisao', 'Revisão')}
        ${fsel('tipo', 'Tipo', `<option value="">Todos</option>${TIPOS.map(t => `<option value="${t.id}">${t.nome}</option>`).join('')}`)}
        ${fsel('status', 'Status', `<option value="">Todos</option>${Object.entries(st).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}`)}
        ${fsel('resultado', 'Resultado', `<option value="">Todos</option><option value="aprovado">Aprovado</option><option value="reprovado">Reprovado</option><option value="pendente">Em andamento</option>`)}
        ${fsel('classe', 'Classe (maior)', `<option value="">Todas</option><option value="A">Classe A</option><option value="B">Classe B</option><option value="C">Classe C</option>`)}
        <div class="col-12 col-sm-6 col-lg-3 d-flex align-items-end"><div class="form-check cdim-check"><input class="form-check-input" type="checkbox" id="f-reprov"><label class="form-check-label" for="f-reprov">Somente com reprovação</label></div></div>
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

  /* listas pesquisáveis — fonte única (Biblioteca + relatórios + usuários) */
  COMBO.cliente = comboFiltro($('#f-cliente'), {
    allLabel: 'Todos os clientes', emptyText: 'Nenhum cliente encontrado',
    options: FONTES.clientes.map(c => ({ value: c, label: c })),
    onChange: aoTrocarCliente
  });
  COMBO.pn = comboFiltro($('#f-pn'), {
    allLabel: 'Todos os Part Numbers', emptyText: 'Nenhum Part Number encontrado',
    options: opcoesPN(''),
    onChange: aoTrocarPN
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

/* Relação Cliente → Part Number → Revisão (limpa dependentes ao trocar o pai). */
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
  if (BUSCANDO) return;                                  // evita cliques múltiplos
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
    const rows = await INSP.consultarRelatorios(filtros, escopo());
    ULT_RESULT = rows;
    renderResultados(rows);
  } catch (e) {
    console.error('[CONSULTA-DIM] busca falhou:', e);
    ULT_RESULT = [];
    $('#res-count').textContent = '';
    $('#res-host').innerHTML = `<div class="empty-state" style="padding:32px"><i class="bi bi-exclamation-triangle"></i><div>Não foi possível concluir a busca. Tente novamente.</div></div>`;
    toast('Erro ao buscar relatórios.', { type: 'crit' });
  } finally {
    BUSCANDO = false;
    if (btn) { btn.disabled = false; btn.innerHTML = btnHtml; }
  }
}

function renderResultados(rows) {
  $('#res-count').textContent = rows.length === 1 ? '1 relatório' : `${rows.length} relatórios`;
  const host = $('#res-host');
  if (!rows.length) {
    host.innerHTML = `<div class="empty-state" style="padding:32px"><i class="bi bi-inbox"></i>
      <div>Nenhum relatório encontrado com os filtros informados.</div>
      <div class="cell-sub mt-1">Revise os filtros ou clique em <b>Limpar filtros</b>.</div></div>`;
    return;
  }
  host.innerHTML = `
    <div class="rna-table-wrap cdim-table"><table class="rna-table"><thead><tr>
      <th>Relatório</th><th>Data</th><th>Cliente</th><th>PN · Rev</th><th>Lote · OP</th><th>Auditor</th><th>Tipo</th><th>Result.</th><th>Classe</th><th>Ações</th>
      </tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table></div>
    <div class="cdim-cards">${rows.map(cardHtml).join('')}</div>`;
  $$('[data-open]', host).forEach(b => b.addEventListener('click', () => go(`consulta-dimensional.html?rel=${b.dataset.open}`)));
}
function clsBadge(r) {
  const cls = r._maiorClasse ? `<span class="rna-badge ${r._maiorClasse === 'A' ? 'badge-crit' : r._maiorClasse === 'B' ? 'badge-warn' : 'badge-pend'}">Classe ${r._maiorClasse}</span>` : '<span class="text-muted-2">—</span>';
  return cls + (r._reprovacoes ? `<div class="cell-sub">${r._reprovacoes} repr.</div>` : '');
}
function rowHtml(r) {
  return `<tr>
    <td class="cell-strong">${numeroDe(r)}</td>
    <td class="cell-sub">${dataBR(r.started_iso)}</td>
    <td>${r.cliente || '—'}</td>
    <td>${r.peca_codigo || '—'}<div class="cell-sub">${revLabel(r.revisao_desenho)}</div></td>
    <td>${r.lote || '—'}<div class="cell-sub">OP ${r.op || '—'}</div></td>
    <td>${r.auditor_nome || '—'}</td>
    <td class="cell-sub">${r.tipo_nome || '—'}</td>
    <td>${resPill(r.resultado)}</td>
    <td>${clsBadge(r)}</td>
    <td><button class="rna-btn rna-btn-primary rna-btn-sm" data-open="${r.id}"><i class="bi bi-eye"></i> Abrir</button></td></tr>`;
}
/* Card mobile — mesmas informações principais da tabela (§23). */
const mini = (l, v) => `<div><span class="insp-info-l">${l}</span><span class="insp-info-v">${(v === 0 || v) ? v : '—'}</span></div>`;
function cardHtml(r) {
  return `<div class="cdim-card">
    <div class="cdim-card__head">
      <div><div class="cdim-card__num">${numeroDe(r)}</div><div class="cell-sub">${dataBR(r.started_iso)} · ${r.tipo_nome || '—'}</div></div>
      ${resPill(r.resultado)}
    </div>
    <div class="cdim-card__grid">
      ${mini('Cliente', r.cliente)} ${mini('Part Number', r.peca_codigo)}
      ${mini('Revisão', revLabel(r.revisao_desenho))} ${mini('Auditor', r.auditor_nome)}
      ${mini('Lote', r.lote)} ${mini('OP', r.op)}
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

/* ------------------------------------------------------------ exportação (§31)
   Exporta somente os resultados da pesquisa atual, sem "Nome da peça" (§25). */
function exportar(fmt) {
  if (!ULT_RESULT.length) return toast('Não existem relatórios para exportar.', { type: 'warn' });
  const cols = ['Nº do Relatório', 'Data', 'Cliente', 'Part Number', 'Revisão', 'Lote', 'OP', 'Auditor', 'Tipo', 'Status', 'Resultado', 'Maior Classe'];
  const linhas = ULT_RESULT.map(r => [numeroDe(r), dataBR(r.started_iso), r.cliente, r.peca_codigo, (r.revisao_desenho === '' || r.revisao_desenho == null) ? '' : fmtRevisao(r.revisao_desenho),
    r.lote, r.op, r.auditor_nome, r.tipo_nome, INSP_STATUS[r.status]?.label || r.status, resultadoLabel(r.resultado), r._maiorClasse || '']);
  const sep = fmt === 'csv' ? ';' : '\t';
  const esc = v => { const s = String(v ?? ''); return (s.includes(sep) || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; };
  const conteudo = [cols.join(sep), ...linhas.map(l => l.map(esc).join(sep))].join('\r\n');
  const bom = '﻿';
  const blob = new Blob([bom + conteudo], { type: fmt === 'csv' ? 'text/csv;charset=utf-8' : 'application/vnd.ms-excel;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `relatorios-dimensionais-${new Date().toISOString().slice(0, 10)}.${fmt === 'csv' ? 'csv' : 'xls'}`;
  a.click(); URL.revokeObjectURL(a.href);
  toast(`Exportado (${fmt.toUpperCase()}).`, { type: 'ok' });
}

/* ============================================================ RELATÓRIO (§23,30) */
async function abrirRelatorio(relId) {
  const data = await INSP.carregarRelatorio(relId);
  if (!data) { toast('Relatório não encontrado.', { type: 'crit' }); return renderConsulta(); }
  const { rel, caracteristicas, acoes } = data;
  const [resumo, hist] = await Promise.all([INSP.resumoRelatorio(relId), INSP.historicoDe(relId)]);
  const acaoBy = Object.fromEntries(acoes.map(a => [a.caracteristica_id, a]));
  const s = INSP_STATUS[rel.status] || { label: rel.status, badge: 'badge-na' };
  const horaBR = iso => (iso || '').slice(11, 16);
  const numero = numeroDe(rel);
  const codigoVerif = 'V-' + (numero.replace(/[^0-9]/g, '').slice(-8) || numero.replace(/[^A-Z0-9]/gi, '').slice(-8));

  $('#rna-content').innerHTML = `
    <div class="rna-page-head no-print">
      <div><div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> <a href="#" id="bc-back">Relatórios Dimensionais</a><i class="bi bi-chevron-right"></i> ${numero}</div>
      <h1>Relatório de Inspeção Dimensional</h1></div>
      <div class="d-flex gap-2">
        <button class="rna-btn rna-btn-ghost" id="btn-voltar"><i class="bi bi-arrow-left"></i> Voltar</button>
        <button class="rna-btn rna-btn-primary" id="btn-imprimir"><i class="bi bi-printer"></i> Imprimir / PDF</button>
      </div>
    </div>
    <div class="insp-report" id="insp-report">
      <div class="insp-rep-head">
        <div class="insp-rep-brand"><img src="${BRAND.logo}" alt="logo"><div><b>${BRAND.company}</b><div class="cell-sub">${BRAND.full}</div></div></div>
        <div class="insp-rep-title"><h2>Relatório de Inspeção Dimensional</h2>
          <div class="insp-rep-meta"><span><b>${numero}</b></span><span>${rel.tipo_nome}</span>
          <span class="rna-badge ${s.badge}">${s.label}</span> ${resPill(rel.resultado)}</div>
          <div class="cell-sub">Código de verificação: ${codigoVerif}</div></div>
      </div>

      <div class="insp-rep-section"><div class="insp-rep-sec-t">Identificação da peça</div>
        <div class="insp-rep-grid">
          ${cell('Cliente', rel.cliente)} ${cell('PN', rel.peca_codigo)} ${cell('Peça', rel.peca_nome)} ${cell('Desenho / Rev', revLabel(rel.revisao_desenho))}
          ${cell('Data da revisão', dataBR(rel.data_revisao_desenho) || rel.data_revisao_desenho)} ${cell('Número da AD', rel.numero_ad)} ${cell('Lote', rel.lote)} ${cell('OP', rel.op)}
          ${cell('Quantidade', rel.quantidade)} ${cell('Planta', rel.planta)} ${cell('Linha', rel.linha)} ${cell('Turno', rel.turno)}
        </div></div>

      <div class="insp-rep-section"><div class="insp-rep-sec-t">Identificação da inspeção</div>
        <div class="insp-rep-grid">
          ${cell('Auditor', rel.auditor_nome)} ${cell('Matrícula', rel.auditor_matricula)}
          ${cell('Início', dataBR(rel.started_iso) + ' ' + horaBR(rel.started_iso))} ${cell('Conclusão', rel.completed_iso ? dataBR(rel.completed_iso) + ' ' + horaBR(rel.completed_iso) : '—')}
          ${cell('Duração', INSP.fmtDuracao(rel.duracao_seg))}
        </div></div>

      <div class="insp-rep-section"><div class="insp-rep-sec-t">Resultados das medições</div>
        <div class="insp-table-wrap"><table class="insp-mtable insp-rep-table"><thead><tr>
          <th>Cota</th><th>Característica</th><th>Un.</th><th>Nom.</th><th>Mín</th><th>Máx</th><th>Equip.</th>
          ${Array.from({ length: rel.quantidade || 0 }, (_, i) => `<th>P${i + 1}</th>`).join('')}
          <th>Result.</th><th>Classe</th></tr></thead><tbody>
          ${caracteristicas.map(c => `<tr>
            <td>${c.cota ?? '—'}</td><td>${c.caracteristica}</td><td>${c.unidade || ''}</td><td>${dash(c.nominal)}</td><td>${dash(c.minimo)}</td><td>${dash(c.maximo)}</td><td class="cell-sub">${c.equipamento || '—'}</td>
            ${Array.from({ length: rel.quantidade || 0 }, (_, i) => { const m = c.medicoes.find(x => x.amostra === i + 1); return `<td class="${m ? (m.resultado === 'aprovado' ? 'rep-ok' : m.resultado === 'reprovado' ? 'rep-crit' : '') : ''}">${m ? dash(m.valor) : '—'}</td>`; }).join('')}
            <td>${c.resultado === 'aprovado' ? '<span class="rep-tag rep-ok">✓ Aprovado</span>' : c.resultado === 'reprovado' ? '<span class="rep-tag rep-crit">✗ Reprovado</span>' : '—'}</td>
            <td>${c.classe_defeito ? 'Classe ' + c.classe_defeito : '—'}</td></tr>`).join('')}
        </tbody></table></div></div>

      ${caracteristicas.some(c => c.resultado === 'reprovado') ? `<div class="insp-rep-section"><div class="insp-rep-sec-t">Reprovações e tratamento</div>
        ${caracteristicas.filter(c => c.resultado === 'reprovado').map(c => { const a = acaoBy[c.id] || {}; return `<div class="insp-rep-reprov">
          <b>${c.caracteristica}</b> (cota ${c.cota}) — <span class="rep-tag rep-crit">Classe ${c.classe_defeito || '—'}</span>
          <div class="insp-rep-grid mt-1">
            ${cell('Limite', `${dash(c.minimo)} a ${dash(c.maximo)} ${c.unidade || ''}`)} ${cell('Amostras reprovadas', c.medicoes.filter(m => m.resultado === 'reprovado').map(m => `#${m.amostra}=${dash(m.valor)}`).join(', '))}
            ${cell('Observação', c.observacao || a.observacao)} ${cell('Ação imediata', a.acao_imediata)} ${cell('Ação permanente', a.acao_permanente)}
            ${cell('Responsável', a.responsavel)} ${cell('Prazo', a.prazo ? dataBR(a.prazo) : '—')} ${cell('Pendência', a.pendencia_id ? 'Gerada' : '—')}
          </div></div>`; }).join('')}</div>` : ''}

      <div class="insp-rep-section"><div class="insp-rep-sec-t">Resumo</div>
        <div class="insp-rep-grid">
          ${cell('Características', resumo.totalCaracteristicas)} ${cell('Aprovadas', resumo.caracteristicasAprovadas)} ${cell('Reprovadas', resumo.caracteristicasReprovadas)}
          ${cell('Medições', resumo.totalMedicoes)} ${cell('Conformidade', resumo.conformidade + '%')} ${cell('Classe A / B / C', `${resumo.classeA} / ${resumo.classeB} / ${resumo.classeC}`)}
        </div>
        <div class="insp-rep-final ${INSP_STATUS[rel.status]?.badge}">RESULTADO GERAL: <b>${rel.resultado === 'aprovado' ? 'APROVADO' : rel.resultado === 'reprovado' ? 'REPROVADO' : 'EM ANDAMENTO'}</b></div>
      </div>

      ${hist.length ? `<div class="insp-rep-section no-print-optional"><div class="insp-rep-sec-t">Histórico</div>
        <table class="rna-table"><tbody>${hist.map(h => `<tr><td class="cell-sub" style="width:150px">${dataBR(h.quando)} ${horaBR(h.quando)}</td><td><b>${h.acao}</b> ${h.campo && h.campo !== '—' ? `· ${h.campo}: ${h.antes} → ${h.depois}` : h.depois} ${h.justificativa ? `<div class="cell-sub">Justificativa: ${h.justificativa}</div>` : ''}</td><td class="cell-sub">${h.user_nome}</td></tr>`).join('')}</tbody></table></div>` : ''}

      <div class="insp-rep-footer">
        <span>${numero}</span><span>Emitido em ${new Date().toLocaleDateString('pt-BR')}</span>
        <span>Código de verificação: ${codigoVerif}</span><span>Documento controlado — RNA One</span>
      </div>
    </div>`;

  $('#bc-back').addEventListener('click', e => { e.preventDefault(); go('consulta-dimensional.html'); });
  $('#btn-voltar').addEventListener('click', () => go('consulta-dimensional.html'));
  $('#btn-imprimir').addEventListener('click', () => window.print());
}
const cell = (l, v) => `<div class="insp-rep-cell"><span class="insp-info-l">${l}</span><span class="insp-info-v">${(v === 0 || v) ? v : '—'}</span></div>`;
const dash = v => (v == null || v === '') ? '—' : String(v).replace('.', ',');
