/* ==========================================================================
   Consulta de Relatórios Dimensionais (Qualidade) — §27-31
   Consulta corporativa: filtros combináveis, resultados, abertura do relatório
   completo (§30), impressão A4 (§24) e exportação (PDF via impressão / CSV / Excel).
   Também serve como visualizador do relatório individual (?rel=<id>).
   Dados reais do banco (via inspecao.js). Sem registros fictícios.
   ========================================================================== */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { can, BRAND } from '../../../services/config.js';
import * as INSP from '../../../services/inspecao.js';
import { INSP_STATUS } from '../../../services/inspecao-data.js';
import { $, $$, el, toast } from '../ui.js';

const ctx = await mountShell();
let USER, TIPOS = [];
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

/* ============================================================ CONSULTA (§28-29) */
let ULT_RESULT = [];
async function renderConsulta() {
  const st = INSP_STATUS;
  $('#rna-content').innerHTML = `
    <div class="rna-page-head">
      <div><div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Qualidade <i class="bi bi-chevron-right"></i> Relatórios Dimensionais</div>
      <h1>Consulta de Relatórios Dimensionais</h1><p>Consulte, visualize, imprima e exporte relatórios de inspeção dimensional.</p></div>
    </div>
    <div class="rna-card mb-3"><div class="rna-card__body">
      <div class="row g-2">
        ${ftxt('numero', 'Nº do relatório')} ${ftxt('cliente', 'Cliente')} ${ftxt('pn', 'Part Number (PN)')} ${ftxt('peca', 'Nome da peça')}
        ${ftxt('auditor', 'Auditor')} ${ftxt('lote', 'Lote')} ${ftxt('op', 'OP')} ${ftxt('revisao', 'Revisão')}
        <div class="col-6 col-md-3"><label class="form-label">Tipo</label><select class="form-select" id="f-tipo"><option value="">Todos</option>${TIPOS.map(t => `<option value="${t.id}">${t.nome}</option>`).join('')}</select></div>
        <div class="col-6 col-md-3"><label class="form-label">Status</label><select class="form-select" id="f-status"><option value="">Todos</option>${Object.entries(st).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></div>
        <div class="col-6 col-md-3"><label class="form-label">Resultado</label><select class="form-select" id="f-resultado"><option value="">Todos</option><option value="aprovado">Aprovado</option><option value="reprovado">Reprovado</option><option value="pendente">Em andamento</option></select></div>
        <div class="col-6 col-md-3"><label class="form-label">Classe (maior)</label><select class="form-select" id="f-classe"><option value="">Todas</option><option value="A">Classe A</option><option value="B">Classe B</option><option value="C">Classe C</option></select></div>
        ${fdate('de', 'Período — de')} ${fdate('ate', 'Período — até')}
        <div class="col-6 col-md-3 d-flex align-items-end"><div class="form-check"><input class="form-check-input" type="checkbox" id="f-reprov"><label class="form-check-label" for="f-reprov">Somente com reprovação</label></div></div>
      </div>
      <div class="d-flex flex-wrap gap-2 mt-3">
        <button class="rna-btn rna-btn-primary" id="btn-buscar"><i class="bi bi-search"></i> Buscar</button>
        <button class="rna-btn rna-btn-ghost" id="btn-limpar"><i class="bi bi-x-circle"></i> Limpar filtros</button>
        <div class="flex-fill"></div>
        <button class="rna-btn rna-btn-ghost" id="btn-csv"><i class="bi bi-filetype-csv"></i> CSV</button>
        <button class="rna-btn rna-btn-ghost" id="btn-xls"><i class="bi bi-file-earmark-excel"></i> Excel</button>
      </div>
    </div></div>
    <div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-table"></i> Resultados</h3><span id="res-count" class="cell-sub"></span></div>
      <div class="rna-card__body p-0" id="res-host"><div class="empty-state" style="padding:32px"><i class="bi bi-search"></i><div>Use os filtros e clique em <b>Buscar</b>.</div></div></div></div>`;

  $('#btn-buscar').addEventListener('click', buscar);
  $('#btn-limpar').addEventListener('click', () => { $$('#rna-content input, #rna-content select').forEach(i => { if (i.type === 'checkbox') i.checked = false; else i.value = ''; }); buscar(); });
  $('#btn-csv').addEventListener('click', () => exportar('csv'));
  $('#btn-xls').addEventListener('click', () => exportar('xls'));
  $$('#rna-content input').forEach(i => i.addEventListener('keydown', e => { if (e.key === 'Enter') buscar(); }));
  buscar();
}
const ftxt = (id, label) => `<div class="col-6 col-md-3"><label class="form-label">${label}</label><input class="form-control" id="f-${id}"></div>`;
const fdate = (id, label) => `<div class="col-6 col-md-3"><label class="form-label">${label}</label><input type="date" class="form-control" id="f-${id}"></div>`;

async function buscar() {
  const g = id => $('#f-' + id)?.value?.trim() || '';
  const filtros = {
    numero: g('numero'), cliente: g('cliente'), pn: g('pn'), peca: g('peca'), auditor: g('auditor'),
    lote: g('lote'), op: g('op'), revisao: g('revisao'), tipo: g('tipo'), status: g('status'),
    resultado: g('resultado'), classe: g('classe'), de: g('de'), ate: g('ate'), comReprovacao: $('#f-reprov')?.checked
  };
  const rows = await INSP.consultarRelatorios(filtros, escopo());
  ULT_RESULT = rows;
  $('#res-count').textContent = `${rows.length} relatório(s)`;
  const host = $('#res-host');
  if (!rows.length) { host.innerHTML = `<div class="empty-state" style="padding:32px"><i class="bi bi-inbox"></i><div>Nenhum relatório foi encontrado com os filtros informados.</div></div>`; return; }
  host.innerHTML = `<div class="rna-table-wrap"><table class="rna-table"><thead><tr>
    <th>Relatório</th><th>Data</th><th>Cliente / Peça</th><th>PN · Rev</th><th>Lote · OP</th><th>Auditor</th><th>Tipo</th><th>Result.</th><th>Classe</th><th>Ações</th>
    </tr></thead><tbody>${rows.map(rowHtml).join('')}</tbody></table></div>`;
  $$('[data-open]', host).forEach(b => b.addEventListener('click', () => go(`consulta-dimensional.html?rel=${b.dataset.open}`)));
}
function rowHtml(r) {
  const s = INSP_STATUS[r.status] || { label: r.status, badge: 'badge-na' };
  const cls = r._maiorClasse ? `<span class="rna-badge ${r._maiorClasse === 'A' ? 'badge-crit' : r._maiorClasse === 'B' ? 'badge-warn' : 'badge-pend'}">Classe ${r._maiorClasse}</span>` : '<span class="text-muted-2">—</span>';
  return `<tr>
    <td class="cell-strong">${r.numero}</td>
    <td class="cell-sub">${(r.started_iso || '').slice(0, 10).split('-').reverse().join('/')}</td>
    <td>${r.cliente || '—'}<div class="cell-sub">${r.peca_nome || '—'}</div></td>
    <td>${r.peca_codigo || '—'}<div class="cell-sub">Rev ${r.revisao_desenho ?? '—'}</div></td>
    <td>${r.lote || '—'}<div class="cell-sub">OP ${r.op || '—'}</div></td>
    <td>${r.auditor_nome || '—'}</td>
    <td class="cell-sub">${r.tipo_nome || '—'}</td>
    <td>${resPill(r.resultado)}</td>
    <td>${cls}${r._reprovacoes ? `<div class="cell-sub">${r._reprovacoes} repr.</div>` : ''}</td>
    <td><button class="rna-btn rna-btn-primary rna-btn-sm" data-open="${r.id}"><i class="bi bi-eye"></i> Abrir</button></td></tr>`;
}
function resPill(r) {
  if (r === 'aprovado') return `<span class="insp-pill insp-ok">Aprovado</span>`;
  if (r === 'reprovado') return `<span class="insp-pill insp-crit">Reprovado</span>`;
  return `<span class="insp-pill insp-pend">Em andamento</span>`;
}

/* ------------------------------------------------------------ exportação (§31) */
function exportar(fmt) {
  if (!ULT_RESULT.length) return toast('Nada para exportar. Faça uma busca primeiro.', { type: 'warn' });
  const cols = ['Relatório', 'Data', 'Cliente', 'PN', 'Peça', 'Revisão', 'Lote', 'OP', 'Auditor', 'Tipo', 'Planta', 'Turno', 'Status', 'Resultado', 'Reprovações', 'Maior Classe'];
  const linhas = ULT_RESULT.map(r => [r.numero, (r.started_iso || '').slice(0, 10), r.cliente, r.peca_codigo, r.peca_nome, r.revisao_desenho,
    r.lote, r.op, r.auditor_nome, r.tipo_nome, r.planta, r.turno, INSP_STATUS[r.status]?.label || r.status, r.resultado, r._reprovacoes, r._maiorClasse || '']);
  const sep = fmt === 'csv' ? ';' : '\t';
  const esc = v => { const s = String(v ?? ''); return (s.includes(sep) || s.includes('"') || s.includes('\n')) ? `"${s.replace(/"/g, '""')}"` : s; };
  const conteudo = [cols.join(sep), ...linhas.map(l => l.map(esc).join(sep))].join('\r\n');
  const bom = '﻿';
  const blob = new Blob([bom + conteudo], { type: fmt === 'csv' ? 'text/csv;charset=utf-8' : 'application/vnd.ms-excel;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `relatorios-dimensionais.${fmt === 'csv' ? 'csv' : 'xls'}`;
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
  const dataBR = iso => (iso || '').slice(0, 10).split('-').reverse().join('/');
  const horaBR = iso => (iso || '').slice(11, 16);
  const codigoVerif = 'V-' + (rel.numero || '').replace(/[^0-9]/g, '').slice(-8);

  $('#rna-content').innerHTML = `
    <div class="rna-page-head no-print">
      <div><div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> <a href="#" id="bc-back">Relatórios Dimensionais</a><i class="bi bi-chevron-right"></i> ${rel.numero}</div>
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
          <div class="insp-rep-meta"><span><b>${rel.numero}</b></span><span>${rel.tipo_nome}</span>
          <span class="rna-badge ${s.badge}">${s.label}</span> ${resPill(rel.resultado)}</div>
          <div class="cell-sub">Código de verificação: ${codigoVerif}</div></div>
      </div>

      <div class="insp-rep-section"><div class="insp-rep-sec-t">Identificação da peça</div>
        <div class="insp-rep-grid">
          ${cell('Cliente', rel.cliente)} ${cell('PN', rel.peca_codigo)} ${cell('Peça', rel.peca_nome)} ${cell('Desenho / Rev', 'Rev ' + (rel.revisao_desenho ?? '—'))}
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
        <span>${rel.numero}</span><span>Emitido em ${new Date().toLocaleDateString('pt-BR')}</span>
        <span>Código de verificação: ${codigoVerif}</span><span>Documento controlado — RNA One</span>
      </div>
    </div>`;

  $('#bc-back').addEventListener('click', e => { e.preventDefault(); go('consulta-dimensional.html'); });
  $('#btn-voltar').addEventListener('click', () => go('consulta-dimensional.html'));
  $('#btn-imprimir').addEventListener('click', () => window.print());
}
const cell = (l, v) => `<div class="insp-rep-cell"><span class="insp-info-l">${l}</span><span class="insp-info-v">${(v === 0 || v) ? v : '—'}</span></div>`;
const dash = v => (v == null || v === '') ? '—' : String(v).replace('.', ',');
