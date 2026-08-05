/* ==========================================================================
   RNA One — FECHAMENTO MENSAL · Componentes de interface (§48)
   ---------------------------------------------------------------------------
   Cada função aqui é um componente do §48, devolvendo HTML string (o padrão
   do RNA One — as páginas montam markup e ligam eventos depois).

     MonthlyClosingHeader → cabecalhoCompetencia
     ClosingStatusBadge   → seloStatus
     IndicatorCard        → cartaoIndicador
     IndicatorChart       → grafico (delegado a charts.js)
     TargetLine           → linhaMeta (opção do gráfico)
     TrendBadge           → seloTendencia
     DataOriginBadge      → seloOrigem
     ImportWizard         → passosImportacao
     ImportValidationTable→ tabelaValidacao
     CustomerMappingModal → modalAssociacaoCliente
     PendingItemsPanel    → painelPendencias
     QualityCrossCalendar → cruzQualidade
     BreakTrafficLight    → farolQuebra
     ActionPlanCard       → cartaoPlano
     PresentationPreview  → previaApresentacao
     SlideThumbnail       → miniaturaSlide
     ApprovalTimeline     → linhaDoTempo
     AuditHistory         → historicoAuditoria
     VersionSelector      → seletorVersao
     CalculationMemoryModal → modalMemoriaCalculo
   ========================================================================== */
import { modal } from '../ui.js';
import { charts, PALETTE } from '../charts.js';
import { formatarDataHoraBrasil, formatarDataBrasil } from '../../../services/datahora.js';
import {
  STATUS_COMPETENCIA_UI, STATUS_COMPETENCIA_DESC, CORES_INDICADOR, CRUZ_CORES,
  FAROL_QUEBRA, ORIGEM_DADO_LABEL, ORIGEM_DADO_UI, MESES
} from '../../../services/fechamento/fm-schema.js';

/* Escape obrigatório: quase todo texto exibido vem de digitação do usuário. */
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const nf = (v, casas = 0) => v == null ? '—'
  : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

/* ========================================================================== */
/* MonthlyClosingHeader                                                        */
/* ========================================================================== */
export function cabecalhoCompetencia(competencia, { competencias = [], acoes = '', progresso = null } = {}) {
  if (!competencia) {
    return `<div class="fm-header">
      <div class="fm-header__id"><div class="fm-header__mes">—<small>Nenhuma competência</small></div></div>
      <div class="fm-header__acoes">${acoes}</div></div>`;
  }
  const c = competencia;
  const pct = progresso ?? Number(c.percentual || 0);
  const opts = competencias.map(x =>
    `<option value="${x.id}" ${x.id === c.id ? 'selected' : ''}>${esc(x.planta)} · ${MESES[x.mes - 1]}/${x.ano} — ${esc(x.status)}</option>`
  ).join('');

  return `<div class="fm-header">
    <div class="fm-header__id">
      <div class="fm-header__mes">${MESES[c.mes - 1]} ${c.ano}
        <small>Competência ${esc(c.competencia || `${String(c.mes).padStart(2, '0')}/${c.ano}`)}</small></div>
      <div>
        <div class="fm-header__planta">${esc(c.planta)}</div>
        ${seloStatus(c.status)}
      </div>
    </div>
    <div class="fm-header__meta">
      <div>Responsável<b>${esc(c.responsavel || '—')}</b></div>
      <div>Versão<b>${esc(c.versao || 'V0')}</b></div>
      <div>Progresso<b>${nf(pct)}%</b>
        <div class="fm-progresso"><div class="fm-progresso__barra" style="width:${Math.min(100, pct)}%"></div></div>
      </div>
      <div>Atualizado<b>${c.updated_at ? formatarDataHoraBrasil(c.updated_at) : '—'}</b></div>
    </div>
    <div class="fm-header__acoes">
      ${competencias.length ? `<select id="fm-seletor-comp" title="Trocar de competência">${opts}</select>` : ''}
      ${acoes}
    </div>
  </div>`;
}

/* ========================================================================== */
/* ClosingStatusBadge — cor + ícone + texto (§6: nunca só cor)                 */
/* ========================================================================== */
export function seloStatus(status) {
  const ui = STATUS_COMPETENCIA_UI[status] || { cor: 'cinza', icone: 'bi-circle' };
  const desc = STATUS_COMPETENCIA_DESC[status] || '';
  return `<span class="fm-status fm-status--${ui.cor}" title="${esc(desc)}">
    <i class="bi ${ui.icone}"></i> ${esc(status)}</span>`;
}

/* ========================================================================== */
/* DataOriginBadge (§30)                                                       */
/* ========================================================================== */
export function seloOrigem(origem) {
  const ui = ORIGEM_DADO_UI[origem] || ORIGEM_DADO_UI.manual;
  const label = ORIGEM_DADO_LABEL[origem] || origem;
  return `<span class="fm-origem" title="Origem do dado: ${esc(label)}">
    <i class="bi ${ui.icone}"></i> ${esc(label)}</span>`;
}

/* ========================================================================== */
/* TrendBadge                                                                  */
/* ========================================================================== */
export function seloTendencia(card) {
  if (!card.variacao || card.variacao.absoluta == null) {
    return `<span class="fm-tend fm-tend--estavel" title="Sem base de comparação com o mês anterior">
      <i class="bi bi-dash"></i> sem base</span>`;
  }
  const t = card.tendencia || 'estavel';
  const icone = t === 'melhora' ? 'bi-arrow-down-right' : t === 'piora' ? 'bi-arrow-up-right' : 'bi-arrow-right';
  const seta = card.variacao.absoluta > 0 ? 'bi-arrow-up-right' : card.variacao.absoluta < 0 ? 'bi-arrow-down-right' : 'bi-arrow-right';
  const titulo = t === 'melhora' ? 'Evoluiu na direção da meta'
               : t === 'piora' ? 'Piorou em relação ao mês anterior' : 'Estável';
  return `<span class="fm-tend fm-tend--${t}" title="${titulo} · ${esc(card.variacao.exibicao)}">
    <i class="bi ${seta || icone}"></i> ${esc(card.variacao.exibicao)}</span>`;
}

/* ========================================================================== */
/* IndicatorCard (§6)                                                          */
/* ========================================================================== */
/* A unidade só é acrescentada quando o valor exibido ainda não a traz. Sem
   isso, "0 dias" (que já vem formatado com a unidade) virava "0 diasdias".
   Moeda e percentual nunca recebem sufixo: já saem formatados. */
function mostrarUnidade(card, semValor) {
  if (semValor || !card.unidade) return false;
  if (card.unidade === 'BRL' || card.unidade === '%') return false;
  return !String(card.exibicao).toLowerCase().includes(String(card.unidade).toLowerCase());
}

export function cartaoIndicador(card, { comMemoria = true } = {}) {
  const cor = card.status?.cor || 'cinza';
  const ui = CORES_INDICADOR[cor] || CORES_INDICADOR.cinza;
  const semValor = !card.calculavel;
  const tooltip = [
    card.label,
    `Resultado: ${card.exibicao}`,
    card.meta != null ? `Meta: ${nf(card.meta)} ${card.metaUnidade || ''}` : 'Sem meta cadastrada',
    card.anterior != null ? `Mês anterior: ${nf(card.anterior)}` : 'Sem mês anterior',
    `Status: ${card.status?.texto || '—'}`,
    `Origem: ${ORIGEM_DADO_LABEL[card.origem] || card.origem}`,
    card.atualizadoEm ? `Atualizado em ${formatarDataHoraBrasil(card.atualizadoEm)}` : ''
  ].filter(Boolean).join('\n');

  const acumulado = card.acumulado?.exibicao
    || (card.acumulado?.soma != null ? nf(card.acumulado.soma) : null);

  return `<div class="fm-card fm-card--${cor}" title="${esc(tooltip)}" data-card="${esc(card.chave)}">
    <div class="fm-card__topo">
      <div class="fm-card__label">${esc(card.label)}</div>
      <i class="bi ${card.icone || 'bi-graph-up'} fm-card__icone"></i>
    </div>
    <div class="fm-card__valor ${semValor ? 'is-texto' : ''}">
      ${esc(card.exibicao)}${mostrarUnidade(card, semValor)
        ? `<span class="fm-card__unidade">${esc(card.unidade)}</span>` : ''}
    </div>
    <div class="fm-card__linha">
      <span>Meta: <b>${card.meta == null ? 'não cadastrada' : nf(card.meta)}</b></span>
      ${seloTendencia(card)}
    </div>
    <div class="fm-card__linha">
      <span>Mês anterior: <b>${card.anterior == null ? '—' : nf(card.anterior)}</b></span>
      <span>Ano: <b>${acumulado || '—'}</b></span>
    </div>
    <div class="fm-card__rodape">
      <span class="fm-status fm-status--${cor}"><i class="bi ${ui.icone}"></i> ${esc(card.status?.texto || '—')}</span>
      ${seloOrigem(card.origem)}
      ${comMemoria && card.memoria ? `<button class="rna-btn rna-btn-ghost rna-btn-sm ms-auto" data-memoria="${esc(card.chave)}"
        title="Ver memória de cálculo"><i class="bi bi-calculator"></i></button>` : ''}
    </div>
  </div>`;
}

/** Grade de cartões, com skeleton enquanto carrega (§49). */
export function gradeCartoes(cards, chaves) {
  if (!cards) return skeletonCartoes(chaves.length);
  return `<div class="fm-cards">${chaves.map(k => cards[k] ? cartaoIndicador(cards[k]) : '').join('')}</div>`;
}

export function skeletonCartoes(n = 6) {
  return `<div class="fm-cards">${Array.from({ length: n },
    () => '<div class="fm-skeleton fm-skeleton--card"></div>').join('')}</div>`;
}

export function skeletonTabela(linhas = 5) {
  return `<div style="padding:18px">${Array.from({ length: linhas },
    () => '<div class="fm-skeleton fm-skeleton--linha"></div>').join('')}</div>`;
}

/* ========================================================================== */
/* CalculationMemoryModal (§8)                                                 */
/* ========================================================================== */
export function modalMemoriaCalculo(card) {
  const m = card.memoria;
  if (!m) {
    return modal({ title: `Memória de cálculo — ${card.label}`,
      content: `<div class="fm-aviso fm-aviso--info"><i class="bi bi-info-circle"></i>
        Este indicador é uma contagem direta dos lançamentos: não há fórmula intermediária a registrar.</div>` });
  }
  const linhas = [
    ['Fórmula aplicada', m.formula],
    ['Numerador', m.numerador == null ? '—' : nf(m.numerador)],
    ['Denominador', m.denominador == null ? '—' : nf(m.denominador)],
    ['Resultado sem arredondamento', m.resultado_bruto == null ? '—' : String(m.resultado_bruto)],
    ['Resultado exibido', m.resultado_exibido],
    ['Critério utilizado', m.criterio_nome || '—'],
    ['Versão do critério', m.criterio_versao || '—'],
    ['Data do cálculo', m.calculado_em ? formatarDataHoraBrasil(m.calculado_em) : '—']
  ];
  const entradas = Object.entries(m.entradas || {});
  const detalhe = (m.detalhe || []).slice(0, 40);

  return modal({
    title: `Memória de cálculo — ${card.label}`,
    size: 'modal-lg',
    content: `
      <div class="fm-formula">${esc(m.formula || '—')}</div>
      <h6 style="font-size:13px;font-weight:700;margin:16px 0 6px">Rastreabilidade</h6>
      <table class="fm-memoria-tabela">${linhas.map(([k, v]) =>
        `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
      ${entradas.length ? `<h6 style="font-size:13px;font-weight:700;margin:18px 0 6px">Entradas do cálculo</h6>
        <table class="fm-memoria-tabela">${entradas.map(([k, v]) =>
          `<tr><td>${esc(k)}</td><td>${esc(typeof v === 'number' ? nf(v) : v)}</td></tr>`).join('')}</table>` : ''}
      ${detalhe.length ? `<h6 style="font-size:13px;font-weight:700;margin:18px 0 6px">Registros considerados (${(m.detalhe || []).length})</h6>
        <div class="rna-table-wrap"><table class="rna-table"><thead><tr>
          ${Object.keys(detalhe[0]).map(k => `<th>${esc(k)}</th>`).join('')}</tr></thead>
          <tbody>${detalhe.map(d => `<tr>${Object.values(d).map(v =>
            `<td>${esc(typeof v === 'number' ? nf(v) : (v ?? '—'))}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>
        ${(m.detalhe || []).length > 40 ? `<div class="fm-form__hint" style="margin-top:8px">
          Mostrando 40 de ${(m.detalhe || []).length} registros — a lista completa sai no Excel de memória de cálculo.</div>` : ''}` : ''}
      <div class="fm-aviso fm-aviso--info" style="margin-top:18px"><i class="bi bi-shield-check"></i>
        Este valor é <b>calculado</b> e não pode ser editado diretamente (§30). Para corrigi-lo, ajuste os
        lançamentos de origem ou abra uma solicitação de ajuste com justificativa.</div>`
  });
}

/* ========================================================================== */
/* QualityCrossCalendar (§16)                                                  */
/* ========================================================================== */
export function cruzQualidade(cruz, { competencia } = {}) {
  const dias = cruz.dias;
  const primeiroDiaSemana = new Date(Date.UTC(competencia.ano, competencia.mes - 1, 1)).getUTCDay();
  const vazios = Array.from({ length: primeiroDiaSemana }, () => '<div></div>').join('');

  const celulas = dias.map(d => `
    <div class="fm-cruz__dia fm-cruz__dia--${d.status} ${d.manual ? 'is-manual' : ''}"
         data-dia="${d.dia}" title="${esc(`${formatarDataBrasil(d.dia)} — ${CRUZ_CORES[d.status]?.label || d.status}\n${d.motivo}`)}">
      ${Number(d.dia.slice(8, 10))}
      ${d.pecasNG ? `<small>${nf(d.pecasNG)}</small>` : ''}
    </div>`).join('');

  const legenda = Object.entries(CRUZ_CORES).map(([k, v]) =>
    `<span><i style="background:${v.hex}"></i> ${esc(v.label)}</span>`).join('');

  const e = cruz.estatisticas;
  return `<div class="row g-3">
    <div class="col-lg-6">
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;max-width:460px;margin-bottom:6px">
        ${['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map(d =>
          `<div style="text-align:center;font-size:11px;font-weight:700;color:var(--rna-gray)">${d}</div>`).join('')}
      </div>
      <div class="fm-cruz">${vazios}${celulas}</div>
      <div class="fm-cruz-legenda">${legenda}</div>
      <div class="fm-form__hint" style="margin-top:10px">
        <i class="bi bi-circle-fill" style="font-size:6px"></i> Ponto no canto = status definido manualmente com justificativa.
        Clique em um dia para ver os detalhes.
      </div>
    </div>
    <div class="col-lg-6">
      <table class="fm-memoria-tabela">
        <tr><td>Dias sem ocorrência</td><td><b>${nf(e.diasSemOcorrencia)}</b></td></tr>
        <tr><td>Maior sequência sem ocorrência</td><td><b>${nf(e.maiorSequencia)} dias</b></td></tr>
        <tr><td>Dias amarelos (ocorrência leve)</td><td>${nf(e.amarelos)}</td></tr>
        <tr><td>Dias vermelhos (ocorrência relevante)</td><td>${nf(e.vermelhos)}</td></tr>
        <tr><td>Dias críticos (quebra)</td><td>${nf(e.criticos)}</td></tr>
        <tr><td>Dias sem produção / sem informação</td><td>${nf(e.semProducao)}</td></tr>
        <tr><td>Percentual de dias conformes</td><td><b>${e.percentualConformes == null ? 'Sem base' : nf(e.percentualConformes, 1) + '%'}</b></td></tr>
      </table>
    </div>
  </div>`;
}

/* ========================================================================== */
/* BreakTrafficLight (§18)                                                     */
/* ========================================================================== */
export function farolQuebra(status) {
  const f = FAROL_QUEBRA[status] || { cor: 'cinza', icone: 'bi-circle', texto: status };
  return `<span class="fm-farol" title="${esc(status)}">
    <span class="fm-farol__luz fm-farol__luz--${f.cor}"></span>${esc(f.texto)}</span>`;
}

/* ========================================================================== */
/* ActionPlanCard (§23)                                                        */
/* ========================================================================== */
export function cartaoPlano(acao, { competenciaAtual = null } = {}) {
  const herdada = acao.competencia_origem_id && competenciaAtual && acao.competencia_origem_id !== competenciaAtual;
  const atrasado = acao.status === 'Atrasado';
  return `<div class="rna-card" style="height:100%">
    <div class="rna-card__body">
      <div class="d-flex justify-content-between align-items-start gap-2 mb-2">
        <span class="rna-badge ${atrasado ? 'badge-crit' : acao.status === 'Concluído' ? 'badge-ok' : 'badge-warn'}">${esc(acao.status)}</span>
        ${herdada ? `<span class="fm-origem" title="Plano aberto em uma competência anterior — continua acompanhado aqui sem ser duplicado (§5)">
          <i class="bi bi-arrow-return-right"></i> mês anterior</span>` : ''}
      </div>
      <b style="font-size:14px;display:block;line-height:1.4">${esc(acao.what || acao.problema || '—')}</b>
      <div class="cell-sub" style="margin-top:4px">${esc(acao.problema || '')}</div>
      <table class="fm-memoria-tabela" style="margin-top:10px;font-size:12.5px">
        <tr><td>Who</td><td>${esc(acao.who || '—')}</td></tr>
        <tr><td>When</td><td>${acao.when_ ? formatarDataBrasil(acao.when_) : '—'}</td></tr>
        <tr><td>Causa raiz</td><td>${esc(acao.causa_raiz || '—')}</td></tr>
        <tr><td>How much</td><td>${acao.how_much == null ? '—' : Number(acao.how_much).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td></tr>
      </table>
      <div class="fm-rank__barra" style="margin-top:10px"><i style="width:${Number(acao.percentual || 0)}%"></i></div>
      <div class="cell-sub" style="margin-top:4px">${Number(acao.percentual || 0)}% concluído</div>
    </div>
  </div>`;
}

/* ========================================================================== */
/* PendingItemsPanel (§32)                                                     */
/* ========================================================================== */
export function painelPendencias(pendencias, { podeConcluir = false } = {}) {
  if (!pendencias.length) {
    return `<div class="empty-state"><i class="bi bi-check2-circle"></i>
      <div>Nenhuma pendência aberta nesta competência.</div></div>`;
  }
  const CLASSE = { 'Crítica': 'badge-crit', 'Alta': 'badge-warn', 'Média': 'badge-info', 'Baixa': 'badge-na' };
  return `<div class="rna-table-wrap"><table class="rna-table">
    <thead><tr><th>Prioridade</th><th>Pendência</th><th>Módulo</th><th>Responsável</th><th>Prazo</th><th>Status</th><th></th></tr></thead>
    <tbody>${pendencias.map(p => `<tr>
      <td><span class="rna-badge ${CLASSE[p.prioridade] || 'badge-na'}">${esc(p.prioridade)}</span>
        ${p.bloqueia_final ? '<div class="cell-sub" title="Impede a geração da versão FINAL">bloqueia final</div>' : ''}</td>
      <td class="cell-strong">${esc(p.titulo)}<div class="cell-sub">${esc(p.descricao || '')}</div></td>
      <td class="cell-sub">${esc(p.modulo || '—')}</td>
      <td class="cell-sub">${esc(p.responsavel || '—')}</td>
      <td class="cell-sub">${p.prazo ? formatarDataBrasil(p.prazo) : '—'}</td>
      <td><span class="rna-badge ${p.status === 'Concluída' ? 'badge-ok' : 'badge-pend'}">${esc(p.status)}</span></td>
      <td class="text-end">${podeConcluir && p.status === 'Aberta'
        ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-pend-concluir="${p.id}"><i class="bi bi-check2"></i> Concluir</button>` : ''}</td>
    </tr>`).join('')}</tbody></table></div>`;
}

/* ========================================================================== */
/* ImportWizard (§24)                                                          */
/* ========================================================================== */
export const PASSOS_IMPORT = [
  'Selecionar arquivo', 'Ler arquivo', 'Cabeçalhos', 'Prévia',
  'Validar clientes', 'Validar números', 'Duplicidades', 'Comparar versão', 'Confirmar'
];

export function passosImportacao(atual = 0) {
  return `<div class="fm-import-passos">${PASSOS_IMPORT.map((p, i) => `
    <div class="fm-import-passo ${i === atual ? 'is-atual' : i < atual ? 'is-feito' : ''}">
      <span class="fm-import-passo__n">${i < atual ? '<i class="bi bi-check"></i>' : i + 1}</span>${esc(p)}
    </div>`).join('')}</div>`;
}

/* ImportValidationTable (§26) */
export function tabelaValidacao(linhas, { podeCorrigir = true } = {}) {
  if (!linhas.length) {
    return `<div class="empty-state"><i class="bi bi-file-earmark-x"></i><div>O arquivo não tem linhas de dados.</div></div>`;
  }
  return `<div class="rna-table-wrap"><table class="rna-table">
    <thead><tr>
      <th>Linha</th><th>Cliente no arquivo</th><th>Cliente oficial</th>
      <th>Qtd. fornecida</th><th>Faturamento</th><th>Comparação</th><th>Situação</th><th></th>
    </tr></thead>
    <tbody>${linhas.map(l => `<tr class="fm-linha--${l.status}">
      <td class="cell-sub">${l.linha_num}</td>
      <td class="cell-strong">${esc(l.cliente_arquivo || '—')}</td>
      <td>${l.cliente_oficial
          ? esc(l.cliente_oficial)
          : `<span class="cell-sub"><i class="bi bi-question-circle"></i> não associado</span>`}
        ${l.sugestao_cliente && !l.cliente_oficial
          ? `<div class="cell-sub">sugestão: ${esc(l.sugestao_cliente)}</div>` : ''}</td>
      <td>${nf(l.dados?.qtd_fornecida)}</td>
      <td>${l.dados?.faturamento_real == null ? '—'
          : Number(l.dados.faturamento_real).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
      <td class="cell-sub">${l.diff ? diffTexto(l.diff) : '—'}</td>
      <td>
        ${(l.erros || []).map(e => `<div class="fm-linha-msg fm-linha-msg--erro"><i class="bi bi-x-circle"></i> ${esc(e)}</div>`).join('')}
        ${(l.alertas || []).map(a => `<div class="fm-linha-msg fm-linha-msg--alerta"><i class="bi bi-exclamation-triangle"></i> ${esc(a)}</div>`).join('')}
        ${!(l.erros || []).length && !(l.alertas || []).length ? '<span class="rna-badge badge-ok"><i class="bi bi-check"></i> válida</span>' : ''}
      </td>
      <td class="text-end">${podeCorrigir && !l.ignorada ? `
        ${!l.cliente_oficial ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-associar="${l.id || l.linha_num}"><i class="bi bi-link-45deg"></i> Associar</button>` : ''}
        <button class="rna-btn rna-btn-ghost rna-btn-sm" data-ignorar="${l.id || l.linha_num}" title="Ignorar esta linha (exige justificativa)"><i class="bi bi-slash-circle"></i></button>` : ''}
      </td>
    </tr>`).join('')}</tbody></table></div>`;
}

function diffTexto(diff) {
  if (diff.tipo === 'adicionado') return '<span class="rna-badge badge-info">novo</span>';
  if (diff.tipo === 'inalterado') return 'sem alteração';
  const v = diff.variacao;
  return `${nf(diff.antes)} → ${nf(diff.agora)}${v == null ? '' : ` (${v > 0 ? '+' : ''}${nf(v, 1)}%)`}`;
}

/** Resumo numérico da validação (§26). */
export function resumoValidacao(r) {
  const item = (valor, label, classe = '') =>
    `<div class="fm-resumo-item ${classe}"><b>${nf(valor)}</b><span>${esc(label)}</span></div>`;
  return `<div class="fm-resumo-grid">
    ${item(r.total, 'Registros lidos')}
    ${item(r.validos, 'Registros válidos', r.validos ? 'is-ok' : '')}
    ${item(r.invalidos, 'Registros inválidos', r.invalidos ? 'is-erro' : '')}
    ${item(r.clientesNaoReconhecidos, 'Clientes não reconhecidos', r.clientesNaoReconhecidos ? 'is-erro' : '')}
    ${item(r.clientesPossiveis, 'Clientes a confirmar', r.clientesPossiveis ? 'is-alerta' : '')}
    ${item(r.duplicados, 'Registros duplicados', r.duplicados ? 'is-erro' : '')}
    ${item(r.valoresVazios, 'Campos obrigatórios vazios', r.valoresVazios ? 'is-erro' : '')}
    ${item(r.valoresNegativos, 'Valores negativos', r.valoresNegativos ? 'is-alerta' : '')}
    ${item(r.alterados, 'Alterados vs. versão anterior')}
    ${item(r.adicionados, 'Adicionados')}
    ${item(r.removidos, 'Removidos', r.removidos ? 'is-alerta' : '')}
    ${item(r.variacaoAlta, 'Variação acima do limite', r.variacaoAlta ? 'is-alerta' : '')}
  </div>`;
}

/* ========================================================================== */
/* SlideThumbnail / PresentationPreview (§35)                                   */
/* ========================================================================== */
const ESTADO_SLIDE = {
  atualizado: { label: 'Atualizado', icone: 'bi-check-circle' },
  pendente:   { label: 'Pendente',   icone: 'bi-hourglass' },
  alerta:     { label: 'Com alerta', icone: 'bi-exclamation-triangle' },
  sem_dados:  { label: 'Sem dados',  icone: 'bi-dash-circle' },
  bloqueado:  { label: 'Bloqueado',  icone: 'bi-lock' }
};

export function miniaturaSlide(slide) {
  const e = ESTADO_SLIDE[slide.estado] || ESTADO_SLIDE.sem_dados;
  return `<div class="fm-slide" data-slide="${esc(slide.slug)}">
    <div class="fm-slide__mini">
      <span class="fm-slide__num">${slide.numero}</span>
      <div>
        <div class="fm-slide__barra" style="margin-bottom:7px"></div>
        <div class="fm-slide__titulo">${esc(slide.titulo)}</div>
      </div>
      <div class="fm-slide__preview">${esc(resumoSlide(slide))}</div>
    </div>
    <div class="fm-slide__rodape">
      <span class="fm-slide-estado fm-slide-estado--${slide.estado}"><i class="bi ${e.icone}"></i> ${e.label}</span>
      <i class="bi bi-arrows-angle-expand" style="font-size:11px;color:var(--rna-gray-300)"></i>
    </div>
  </div>`;
}

function resumoSlide(s) {
  if (s.indicadores?.length) return s.indicadores.map(i => `${i.label}: ${i.valor}`).join(' · ');
  if (s.tabela?.linhas?.length) return `${s.tabela.linhas.length} linha(s)`;
  if (s.rankings?.length) return s.rankings.map(r => r.titulo).join(' · ');
  if (s.cruz) return `${s.cruz.dias.length} dias`;
  if (s.texto?.length) return s.texto[0]?.[1] || '';
  if (s.linhas?.length) return s.linhas.map(([, v]) => v).join(' · ');
  return s.vazio || '';
}

export function previaApresentacao(slides) {
  return `<div class="fm-slides">${slides.map(miniaturaSlide).join('')}</div>`;
}

/* ========================================================================== */
/* ApprovalTimeline (§42) / AuditHistory (§45)                                 */
/* ========================================================================== */
export function linhaDoTempo(historico) {
  if (!historico.length) {
    return `<div class="empty-state"><i class="bi bi-clock"></i><div>Nenhuma movimentação registrada.</div></div>`;
  }
  return `<div class="fm-timeline">${historico.map((h, i) => `
    <div class="fm-timeline__item ${i === 0 ? 'is-atual' : ''}">
      <div class="fm-timeline__quando">${formatarDataHoraBrasil(h.quando)}</div>
      <div class="fm-timeline__acao">${esc(h.status_anterior || '—')} → <b>${esc(h.status_novo)}</b></div>
      <div class="fm-timeline__detalhe">
        ${esc(h.usuario || '—')}${h.comentario ? ` · ${esc(h.comentario)}` : ''}
      </div>
    </div>`).join('')}</div>`;
}

export function historicoAuditoria(logs, { limite = 200 } = {}) {
  if (!logs.length) {
    return `<div class="empty-state"><i class="bi bi-journal-x"></i><div>Nenhum registro de auditoria nesta competência.</div></div>`;
  }
  return `<div class="rna-table-wrap"><table class="rna-table">
    <thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Tabela / Campo</th><th>Antes</th><th>Depois</th><th>Justificativa</th></tr></thead>
    <tbody>${logs.slice(0, limite).map(l => `<tr>
      <td class="cell-sub">${formatarDataHoraBrasil(l.quando)}</td>
      <td class="cell-strong">${esc(l.usuario || '—')}<div class="cell-sub">${esc(l.perfil || '')}</div></td>
      <td><span class="rna-badge badge-info">${esc(l.acao)}</span></td>
      <td class="cell-sub">${esc(l.tabela || '—')}${l.campo ? `<div>${esc(l.campo)}</div>` : ''}</td>
      <td class="cell-sub">${esc(corta(l.valor_anterior, 60))}</td>
      <td class="cell-sub">${esc(corta(l.valor_novo, 60))}</td>
      <td class="cell-sub">${esc(corta(l.justificativa, 60))}</td>
    </tr>`).join('')}</tbody></table>
    ${logs.length > limite ? `<div class="fm-form__hint" style="padding:10px 14px">
      Mostrando ${limite} de ${logs.length} registros.</div>` : ''}</div>`;
}

const corta = (s, n) => {
  const t = String(s ?? '—');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/* ========================================================================== */
/* VersionSelector (§40)                                                       */
/* ========================================================================== */
export function seletorVersao(versoes, { selecionada = null } = {}) {
  if (!versoes.length) return '<span class="cell-sub">Nenhuma versão gerada.</span>';
  return `<select id="fm-versao" class="rna-chip" style="padding:7px 12px">
    ${versoes.map(v => `<option value="${v.id}" ${v.id === selecionada ? 'selected' : ''}>
      ${esc(v.versao)} — ${formatarDataHoraBrasil(v.gerado_em)}${v.preliminar ? ' (preliminar)' : ''}
    </option>`).join('')}</select>`;
}

/* ========================================================================== */
/* Checklist de validação (§41)                                                */
/* ========================================================================== */
export function checklistValidacao(validacao) {
  const ICONE = { ok: 'bi-check-lg', alerta: 'bi-exclamation-lg', bloqueio: 'bi-x-lg' };
  return `<div>${validacao.itens.map(i => `
    <div class="fm-check">
      <div class="fm-check__icone fm-check__icone--${i.estado}"><i class="bi ${ICONE[i.estado]}"></i></div>
      <div>
        <div class="fm-check__nome">${esc(i.nome)}</div>
        <div class="fm-check__detalhe">${esc(i.detalhe)}</div>
      </div>
    </div>`).join('')}</div>`;
}

/* ========================================================================== */
/* Ranking (§15)                                                               */
/* ========================================================================== */
export function listaRanking(itens, { campo = 'valor', vazio = 'Sem registros no período.' } = {}) {
  if (!itens?.length) return `<div class="empty-state" style="padding:22px"><div>${esc(vazio)}</div></div>`;
  const max = Math.max(...itens.map(i => Number(i[campo]) || 0), 1);
  const TEND = { melhora: ['bi-arrow-down-right', 'fm-tend--melhora'], piora: ['bi-arrow-up-right', 'fm-tend--piora'],
                 estavel: ['bi-arrow-right', 'fm-tend--estavel'], novo: ['bi-star-fill', 'fm-tend--piora'] };
  return itens.map(i => {
    const [ic, cls] = TEND[i.tendencia] || TEND.estavel;
    return `<div class="fm-rank">
      <span class="fm-rank__pos">${i.posicao}</span>
      <div style="flex:1;min-width:0">
        <div class="fm-rank__nome" title="${esc(i.chave)}">${esc(i.chave)}</div>
        <div class="fm-rank__barra"><i style="width:${((Number(i[campo]) || 0) / max) * 100}%"></i></div>
      </div>
      <div style="text-align:right">
        <div class="fm-rank__valor">${nf(i[campo])}</div>
        <div class="fm-rank__pct">${i.percentual != null ? nf(i.percentual, 1) + '%' : ''}
          ${i.tendencia ? `<span class="${cls}" title="${i.posicaoAnterior ? 'Posição anterior: ' + i.posicaoAnterior : 'Não aparecia no mês anterior'}"><i class="bi ${ic}"></i></span>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');
}

/* ========================================================================== */
/* Avisos (§49 — mensagens úteis, nunca genéricas)                             */
/* ========================================================================== */
export function aviso(texto, tipo = 'info', { icone = null } = {}) {
  const ICONE = { info: 'bi-info-circle', alerta: 'bi-exclamation-triangle', erro: 'bi-x-octagon', ok: 'bi-check-circle' };
  return `<div class="fm-aviso fm-aviso--${tipo}"><i class="bi ${icone || ICONE[tipo]}"></i><div>${texto}</div></div>`;
}

export function vazio(titulo, descricao, acao = '') {
  return `<div class="empty-state">
    <i class="bi bi-inbox"></i>
    <div style="font-weight:600;margin-top:6px">${esc(titulo)}</div>
    <div style="font-size:12.5px;margin-top:3px">${esc(descricao)}</div>
    ${acao ? `<div style="margin-top:14px">${acao}</div>` : ''}
  </div>`;
}

/* ========================================================================== */
/* IndicatorChart + TargetLine (§38) — delegam a charts.js                     */
/* ========================================================================== */

/** Linha de meta como dataset — mesma meta em todos os meses (§38 TargetLine). */
export function linhaMeta(valor, n = 12, rotulo = 'Meta') {
  if (valor == null) return null;
  return {
    label: rotulo, type: 'line', data: Array(n).fill(Number(valor)),
    borderColor: PALETTE.red, borderWidth: 2, borderDash: [6, 4],
    pointRadius: 0, fill: false, tension: 0
  };
}

/**
 * Gráfico de colunas mensais com linha de meta opcional.
 * `dados` aceita null nos meses sem informação — Chart.js corta a linha ali,
 * que é o correto: não há dado, não há ponto.
 */
export function graficoMensal(canvasId, { labels, series, meta = null, rotuloMeta = 'Meta' }) {
  const datasets = series.map((s, i) => ({
    label: s.nome,
    type: s.tipo === 'linha' ? 'line' : 'bar',
    data: s.dados,
    backgroundColor: s.tipo === 'linha' ? 'transparent' : [PALETTE.yellow, PALETTE.blue, PALETTE.green][i % 3],
    borderColor: [PALETTE.blue, PALETTE.graphite, PALETTE.green][i % 3],
    borderWidth: s.tipo === 'linha' ? 2.5 : 0,
    pointRadius: s.tipo === 'linha' ? 3 : 0,
    tension: .35, fill: false,
    yAxisID: s.eixo === 'direito' ? 'y1' : 'y',
    spanGaps: false
  }));
  const linha = linhaMeta(meta, labels.length, rotuloMeta);
  if (linha) datasets.push(linha);

  const temEixoDireito = series.some(s => s.eixo === 'direito');
  return charts.bar(canvasId, labels, datasets, temEixoDireito ? {
    scales: {
      y:  { beginAtZero: true, position: 'left' },
      y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false } }
    }
  } : {});
}

export { modal, charts, PALETTE };
