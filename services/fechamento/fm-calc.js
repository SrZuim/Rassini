/* ==========================================================================
   RNA One — FECHAMENTO MENSAL · Motor de cálculo
   ---------------------------------------------------------------------------
   TODAS as funções deste arquivo são PURAS: recebem os registros já lidos do
   banco e devolvem o resultado + a MEMÓRIA DE CÁLCULO (§1.14 / §8). Nada de
   `db`, `document` ou `localStorage` aqui — é o que permite testar o cálculo
   no Node (tests/fechamento) sem navegador e sem Supabase.

   Contrato do retorno de um indicador:
     {
       valor,            // número | null  (null = não foi possível calcular)
       exibicao,         // texto pronto para a tela (inclui "Sem base ...")
       calculavel,       // boolean
       motivo,           // por que não foi calculado
       memoria: {        // §8 — rastreabilidade completa
         formula, numerador, denominador, resultado_bruto, resultado_exibido,
         criterio_nome, criterio_versao, calculado_em, entradas, detalhe
       }
     }

   REGRA DE OURO: denominador zero NUNCA vira erro nem zero — vira
   "Sem base de fornecimento" / "Sem base de produção" (§8.4/§8.5).
   ========================================================================== */
import { fmtInteiro, fmtNumAgrupado, fmtPercent } from '../formato.js';

const M = 1_000_000;

/* ------------------------------------------------------------- utilitários */
const ativo = r => !r?.deleted_at;
const num = v => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/** Soma uma coluna numérica. */
export const soma = (rows, campo) => (rows || []).filter(ativo).reduce((t, r) => t + num(r[campo]), 0);

/** ISO do instante do cálculo — injetável para o teste ser determinístico. */
function agora(ref) { return ref || new Date().toISOString(); }

/** Resultado "não calculável" padronizado. */
function semBase(formula, motivo, entradas = {}, ref) {
  return {
    valor: null, exibicao: motivo, calculavel: false, motivo,
    memoria: {
      formula, numerador: null, denominador: 0, resultado_bruto: null,
      resultado_exibido: motivo, calculado_em: agora(ref), entradas, detalhe: []
    }
  };
}

/** Formata PPM: número inteiro com separador de milhar (§37). */
export const fmtPPM = v => v == null ? '—' : fmtInteiro(Math.round(v));

/* ========================================================================== */
/* §8 — PPM EXTERNO OFICIAL                                                    */
/* ========================================================================== */

/**
 * PPM externo oficial = peças NG COM DEMÉRITO de reclamações OFICIAIS
 *                       ÷ peças fornecidas × 1.000.000
 * @param {Array} reclamacoes  registros de fm_reclamacoes da competência
 * @param {Array} fornecimento registros de fm_fornecimento da competência
 */
export function ppmExternoOficial(reclamacoes = [], fornecimento = [], { ref } = {}) {
  const consideradas = reclamacoes.filter(r => ativo(r) && r.oficial === true && r.demerito === true);
  const numerador = soma(consideradas, 'qtd_pecas');
  const denominador = soma(fornecimento, 'qtd_fornecida');
  const formula = 'peças NG com demérito ÷ peças fornecidas × 1.000.000';

  if (!denominador) {
    return semBase(formula, 'Sem base de fornecimento',
      { pecas_ng: numerador, reclamacoes_consideradas: consideradas.length }, ref);
  }

  const bruto = (numerador / denominador) * M;
  return {
    valor: bruto, exibicao: fmtPPM(bruto), calculavel: true, motivo: null,
    memoria: {
      formula, numerador, denominador,
      resultado_bruto: bruto, resultado_exibido: fmtPPM(bruto),
      criterio_nome: 'Reclamações oficiais com demérito', criterio_versao: 1,
      calculado_em: agora(ref),
      entradas: {
        'Quantidade de peças NG consideradas': numerador,
        'Quantidade de peças fornecidas': denominador,
        'Reclamações consideradas': consideradas.length
      },
      detalhe: consideradas.map(r => ({
        codigo: r.codigo || '—', cliente: r.cliente_oficial || r.cliente || '—',
        part_number: r.part_number || '—', pecas: num(r.qtd_pecas)
      }))
    }
  };
}

/* ========================================================================== */
/* §9 — PPM EXTERNO REAL                                                       */
/* ========================================================================== */

/** PPM real = (NG oficiais + NG negociadas) ÷ fornecidas × 1.000.000 */
export function ppmExternoReal(reclamacoes = [], fornecimento = [], { ref } = {}) {
  const oficiais   = reclamacoes.filter(r => ativo(r) && r.oficial === true && r.demerito === true);
  const negociadas = reclamacoes.filter(r => ativo(r) && r.negociada === true);
  const ngOficial   = soma(oficiais, 'qtd_pecas');
  const ngNegociada = soma(negociadas, 'qtd_pecas');
  const numerador   = ngOficial + ngNegociada;
  const denominador = soma(fornecimento, 'qtd_fornecida');
  const formula = '(peças NG oficiais + peças NG negociadas) ÷ peças fornecidas × 1.000.000';

  if (!denominador) {
    return semBase(formula, 'Sem base de fornecimento',
      { pecas_ng_oficiais: ngOficial, pecas_ng_negociadas: ngNegociada }, ref);
  }

  const bruto = (numerador / denominador) * M;
  return {
    valor: bruto, exibicao: fmtPPM(bruto), calculavel: true, motivo: null,
    memoria: {
      formula, numerador, denominador,
      resultado_bruto: bruto, resultado_exibido: fmtPPM(bruto),
      criterio_nome: 'Oficiais com demérito + negociadas', criterio_versao: 1,
      calculado_em: agora(ref),
      entradas: {
        'Peças NG oficiais': ngOficial,
        'Peças NG negociadas': ngNegociada,
        'Quantidade de peças NG consideradas': numerador,
        'Quantidade de peças fornecidas': denominador
      },
      detalhe: [...oficiais, ...negociadas].map(r => ({
        codigo: r.codigo || '—', cliente: r.cliente_oficial || r.cliente || '—',
        tipo: r.negociada ? 'negociada' : 'oficial', pecas: num(r.qtd_pecas)
      }))
    }
  };
}

/** §9 — comparativo oficial × real, com diferença absoluta e percentual. */
export function comparativoPPM(oficial, real) {
  if (!oficial?.calculavel || !real?.calculavel) {
    return { diferenca: null, diferencaPercentual: null, exibicao: 'Sem base de fornecimento' };
  }
  const dif = real.valor - oficial.valor;
  const pct = oficial.valor === 0 ? null : (dif / oficial.valor) * 100;
  return {
    diferenca: dif,
    diferencaPercentual: pct,
    exibicao: `${fmtPPM(dif)} PPM${pct == null ? '' : ` (${fmtPercent(pct)})`}`
  };
}

/* ========================================================================== */
/* §13 — PPM INTERNO (critério configurável e versionado por vigência)         */
/* ========================================================================== */

/** Uma data civil "AAAA-MM-DD" está dentro da vigência do critério? */
export function criterioVigente(criterios, dataRef, { planta = null, indicador = 'ppm_interno' } = {}) {
  const cands = (criterios || [])
    .filter(c => ativo(c) && c.indicador === indicador && c.status === 'Ativo')
    .filter(c => !c.planta || c.planta === planta)
    .filter(c => (!c.vigencia_inicio || c.vigencia_inicio <= dataRef) &&
                 (!c.vigencia_fim || c.vigencia_fim >= dataRef));
  /* Empate: vence o mais específico (com planta) e, depois, o de vigência mais
     recente — o histórico usa o critério da ÉPOCA, nunca o critério novo (§13). */
  return cands.sort((a, b) => {
    const esp = (b.planta ? 1 : 0) - (a.planta ? 1 : 0);
    if (esp) return esp;
    return String(b.vigencia_inicio || '').localeCompare(String(a.vigencia_inicio || ''));
  })[0] || null;
}

/**
 * PPM interno = peças NG consideradas ÷ peças fabricadas × 1.000.000
 * O numerador respeita as FONTES INCLUÍDAS pelo critério vigente na competência.
 * Fontes possíveis vêm de: ocorrências internas (origem_ocorrencia), reclamações
 * oficiais/negociadas, sucata e retrabalho — cada uma só entra se listada.
 */
export function ppmInterno({ ocorrencias = [], producao = [], reclamacoes = [], sucata = [], retrabalho = [] },
                           criterio, { ref } = {}) {
  const formula = 'peças NG consideradas ÷ peças fabricadas × 1.000.000';
  const incluidas = new Set(criterio?.fontes_incluidas || []);
  const excluidas = new Set(criterio?.fontes_excluidas || []);
  const entra = fonte => incluidas.has(fonte) && !excluidas.has(fonte);

  const detalhe = [];
  let numerador = 0;

  for (const o of (ocorrencias || []).filter(ativo)) {
    const fonte = o.origem_ocorrencia || 'Outro';
    if (!entra(fonte)) continue;
    numerador += num(o.qtd_pecas);
    detalhe.push({ fonte, referencia: o.part_number || '—', pecas: num(o.qtd_pecas), data: o.data });
  }
  if (entra('Reclamações oficiais')) {
    for (const r of (reclamacoes || []).filter(r => ativo(r) && r.oficial)) {
      numerador += num(r.qtd_pecas);
      detalhe.push({ fonte: 'Reclamações oficiais', referencia: r.codigo || r.part_number || '—', pecas: num(r.qtd_pecas), data: r.data_reclamacao });
    }
  }
  if (entra('Reclamações negociadas')) {
    for (const r of (reclamacoes || []).filter(r => ativo(r) && r.negociada)) {
      numerador += num(r.qtd_pecas);
      detalhe.push({ fonte: 'Reclamações negociadas', referencia: r.codigo || r.part_number || '—', pecas: num(r.qtd_pecas), data: r.data_reclamacao });
    }
  }
  /* Sucata e retrabalho só entram pela tabela PRÓPRIA quando a fonte estiver
     incluída E não houver ocorrência interna equivalente — evitar contar duas
     vezes é responsabilidade do critério (fonte listada uma única vez). */
  if (entra('Sucata') && !((ocorrencias || []).some(o => o.origem_ocorrencia === 'Sucata'))) {
    for (const s of (sucata || []).filter(ativo)) {
      numerador += num(s.quantidade);
      detalhe.push({ fonte: 'Sucata', referencia: s.part_number || '—', pecas: num(s.quantidade) });
    }
  }
  if (entra('Retrabalho') && !((ocorrencias || []).some(o => o.origem_ocorrencia === 'Retrabalho'))) {
    for (const r of (retrabalho || []).filter(ativo)) {
      numerador += num(r.qtd_retrabalhada);
      detalhe.push({ fonte: 'Retrabalho', referencia: r.part_number || '—', pecas: num(r.qtd_retrabalhada) });
    }
  }

  const denominador = soma(producao, 'qtd_fabricada');
  if (!denominador) {
    return semBase(formula, 'Sem base de produção',
      { pecas_ng: numerador, criterio: criterio?.nome || 'não definido' }, ref);
  }
  if (!criterio) {
    return semBase(formula, 'Sem critério vigente para a competência',
      { pecas_fabricadas: denominador }, ref);
  }

  const bruto = (numerador / denominador) * M;
  return {
    valor: bruto, exibicao: fmtPPM(bruto), calculavel: true, motivo: null,
    memoria: {
      formula, numerador, denominador,
      resultado_bruto: bruto, resultado_exibido: fmtPPM(bruto),
      criterio_nome: criterio.nome, criterio_versao: criterio.versao || 1,
      criterio_id: criterio.id,
      calculado_em: agora(ref),
      entradas: {
        'Quantidade de peças NG consideradas': numerador,
        'Quantidade de peças fabricadas': denominador,
        'Fontes incluídas': (criterio.fontes_incluidas || []).join(', '),
        'Fontes excluídas': (criterio.fontes_excluidas || []).join(', ') || '—',
        'Vigência do critério': `${criterio.vigencia_inicio || '—'} a ${criterio.vigencia_fim || 'em aberto'}`
      },
      detalhe
    }
  };
}

/* ========================================================================== */
/* §10 — DIAS SEM RECLAMAÇÃO                                                   */
/* ========================================================================== */

/** Diferença em dias entre duas datas CIVIS, sem passar por fuso (§20). */
export function diasEntre(dataA, dataB) {
  if (!dataA || !dataB) return null;
  const [ay, am, ad] = String(dataA).slice(0, 10).split('-').map(Number);
  const [by, bm, bd] = String(dataB).slice(0, 10).split('-').map(Number);
  if (!ay || !by) return null;
  const a = Date.UTC(ay, am - 1, ad), b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86_400_000);
}

/**
 * §10 — nunca digitado: sempre derivado da última reclamação OFICIAL.
 * @param {Array}  reclamacoes  TODAS as reclamações (histórico completo)
 * @param {string} dataRef      data civil de referência "AAAA-MM-DD"
 */
export function diasSemReclamacao(reclamacoes = [], dataRef, { ref } = {}) {
  const oficiais = (reclamacoes || [])
    .filter(r => ativo(r) && r.oficial === true && r.data_reclamacao)
    .sort((a, b) => String(b.data_reclamacao).localeCompare(String(a.data_reclamacao)));

  if (!oficiais.length) {
    return {
      valor: null, exibicao: 'Sem reclamações registradas', calculavel: false,
      motivo: 'Sem reclamações registradas', ultima: null, recorde: null, diferencaRecorde: null,
      memoria: {
        formula: 'data de referência − data da última reclamação oficial',
        numerador: null, denominador: null, resultado_bruto: null,
        resultado_exibido: 'Sem reclamações registradas',
        calculado_em: agora(ref), entradas: { 'Reclamações oficiais na base': 0 }, detalhe: []
      }
    };
  }

  const ultima = oficiais[0];
  const dias = diasEntre(ultima.data_reclamacao, dataRef);

  /* Recorde histórico = maior intervalo entre reclamações oficiais consecutivas,
     comparado também com a sequência em curso. */
  const datas = oficiais.map(r => r.data_reclamacao).sort();
  let recorde = 0, recordeEntre = null;
  for (let i = 1; i < datas.length; i++) {
    const d = diasEntre(datas[i - 1], datas[i]);
    if (d != null && d > recorde) { recorde = d; recordeEntre = [datas[i - 1], datas[i]]; }
  }
  const emCurso = dias ?? 0;
  const recordeFinal = Math.max(recorde, emCurso);

  return {
    valor: dias, exibicao: `${fmtInteiro(dias)} dias`, calculavel: true, motivo: null,
    ultima: {
      data: ultima.data_reclamacao,
      cliente: ultima.cliente_oficial || ultima.cliente || '—',
      codigo: ultima.codigo || '—'
    },
    recorde: recordeFinal,
    recordeEntre,
    diferencaRecorde: recordeFinal - emCurso,
    memoria: {
      formula: 'data de referência − data da última reclamação oficial',
      numerador: null, denominador: null, resultado_bruto: dias,
      resultado_exibido: `${dias} dias`, calculado_em: agora(ref),
      entradas: {
        'Data de referência': dataRef,
        'Última reclamação oficial': ultima.data_reclamacao,
        'Cliente': ultima.cliente_oficial || ultima.cliente || '—',
        'Recorde histórico (dias)': recordeFinal
      },
      detalhe: []
    }
  };
}

/* ========================================================================== */
/* §20/§21 — RETRABALHO E SUCATA                                               */
/* ========================================================================== */

/** Índice de retrabalho — em PPM ou percentual, conforme configuração (§20). */
export function indiceRetrabalho(retrabalho = [], { modo = 'ppm', ref } = {}) {
  const numerador = soma(retrabalho, 'qtd_retrabalhada');
  const denominador = soma(retrabalho, 'qtd_produzida');
  const fator = modo === 'percentual' ? 100 : M;
  const formula = `quantidade retrabalhada ÷ quantidade produzida × ${modo === 'percentual' ? '100' : '1.000.000'}`;

  if (!denominador) return semBase(formula, 'Sem base de produção', { qtd_retrabalhada: numerador }, ref);

  const bruto = (numerador / denominador) * fator;
  const exib = modo === 'percentual' ? fmtPercent(bruto) : fmtPPM(bruto);
  return {
    valor: bruto, exibicao: exib, calculavel: true, motivo: null, modo,
    memoria: {
      formula, numerador, denominador, resultado_bruto: bruto, resultado_exibido: exib,
      criterio_nome: `Índice de retrabalho (${modo})`, criterio_versao: 1, calculado_em: agora(ref),
      entradas: { 'Quantidade retrabalhada': numerador, 'Quantidade produzida': denominador, 'Modo': modo },
      detalhe: agrupar(retrabalho, 'etapa', 'qtd_retrabalhada')
    }
  };
}

/** PPM de sucata sobre a produção fabricada (§21). */
export function ppmSucata(sucata = [], producao = [], { ref } = {}) {
  const numerador = soma(sucata, 'quantidade');
  const denominador = soma(producao, 'qtd_fabricada');
  const formula = 'quantidade de sucata ÷ peças fabricadas × 1.000.000';
  if (!denominador) return semBase(formula, 'Sem base de produção', { quantidade_sucata: numerador }, ref);
  const bruto = (numerador / denominador) * M;
  return {
    valor: bruto, exibicao: fmtPPM(bruto), calculavel: true, motivo: null,
    memoria: {
      formula, numerador, denominador, resultado_bruto: bruto, resultado_exibido: fmtPPM(bruto),
      calculado_em: agora(ref),
      entradas: {
        'Quantidade de sucata': numerador, 'Peças fabricadas': denominador,
        'Peso total (kg)': soma(sucata, 'peso'), 'Valor total': soma(sucata, 'valor')
      },
      detalhe: agrupar(sucata, 'processo', 'quantidade')
    }
  };
}

/* ========================================================================== */
/* §19 — CUSTOS DA QUALIDADE                                                   */
/* ========================================================================== */

export function custoQualidade(custos = [], { limite = null, producao = [], ref } = {}) {
  const total = soma(custos, 'valor');
  const fabricadas = soma(producao, 'qtd_fabricada');
  const porCategoria = agrupar(custos, 'categoria', 'valor');
  const porCliente   = agrupar(custos, 'cliente', 'valor');
  const custoPorPeca = fabricadas ? total / fabricadas : null;

  return {
    valor: total, exibicao: fmtMoeda(total), calculavel: true, motivo: null,
    porCategoria, porCliente,
    custoPorPeca,
    limite,
    dentroDoLimite: limite == null ? null : total <= limite,
    memoria: {
      formula: 'soma dos lançamentos de custo da competência',
      numerador: total, denominador: fabricadas || null,
      resultado_bruto: total, resultado_exibido: fmtMoeda(total),
      calculado_em: agora(ref),
      entradas: {
        'Lançamentos considerados': (custos || []).filter(ativo).length,
        'Limite mensal': limite == null ? '—' : fmtMoeda(limite),
        'Peças fabricadas': fabricadas || '—',
        'Custo por peça produzida': custoPorPeca == null ? 'Sem base de produção' : fmtMoeda(custoPorPeca)
      },
      detalhe: porCategoria
    }
  };
}

/** Moeda em real (§37): "R$ 28.000,00". */
export function fmtMoeda(v, moeda = 'BRL') {
  if (v == null) return '—';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: moeda });
}

/* ========================================================================== */
/* §22 — CARE                                                                  */
/* ========================================================================== */

export function indicadoresCare(care = [], { ref } = {}) {
  const rows = (care || []).filter(ativo);
  const inspecionado = soma(rows, 'qtd_inspecionada');
  const ng = soma(rows, 'qtd_ng');
  const pct = inspecionado ? (ng / inspecionado) * 100 : null;

  const porDefeito = agrupar(rows, 'tipo_defeito', 'qtd_ng');
  const porPN = agrupar(rows, 'part_number', 'qtd_ng');
  /* §22 — o "principal problema" é CALCULADO pela maior quantidade, nunca
     digitado. Empate resolvido por reincidência (nº de registros). */
  const principal = porDefeito[0] || null;
  const pnReincidente = reincidencia(rows, 'part_number')[0] || null;

  return {
    inspecoes: rows.length,
    totalInspecionado: inspecionado,
    totalNG: ng,
    percentualNG: pct,
    exibicaoPercentual: pct == null ? 'Sem inspeções registradas' : fmtPercent(pct),
    principalProblema: principal ? principal.chave : null,
    principalProblemaQtd: principal ? principal.valor : null,
    partNumberReincidente: pnReincidente ? pnReincidente.chave : null,
    partNumberReincidenteQtd: pnReincidente ? pnReincidente.ocorrencias : null,
    rankingDefeitos: porDefeito,
    rankingPartNumbers: porPN,
    memoria: {
      formula: 'percentual NG = quantidade NG ÷ quantidade inspecionada × 100',
      numerador: ng, denominador: inspecionado || null,
      resultado_bruto: pct, resultado_exibido: pct == null ? 'Sem inspeções registradas' : fmtPercent(pct),
      calculado_em: agora(ref),
      entradas: {
        'Inspeções registradas': rows.length,
        'Total inspecionado': inspecionado,
        'Total NG': ng,
        'Principal problema (calculado)': principal ? `${principal.chave} (${principal.valor})` : '—'
      },
      detalhe: porDefeito
    }
  };
}

/* ========================================================================== */
/* §15 — RANKING DOS PRINCIPAIS PROBLEMAS                                      */
/* ========================================================================== */

/** Agrupa somando um campo numérico; devolve ordenado desc com percentual. */
export function agrupar(rows = [], chave, campoValor) {
  const mapa = new Map();
  for (const r of (rows || []).filter(ativo)) {
    const k = (r[chave] ?? '').toString().trim() || '(não informado)';
    const atual = mapa.get(k) || { chave: k, valor: 0, ocorrencias: 0 };
    atual.valor += num(r[campoValor]);
    atual.ocorrencias += 1;
    mapa.set(k, atual);
  }
  const lista = [...mapa.values()].sort((a, b) => b.valor - a.valor || b.ocorrencias - a.ocorrencias);
  const total = lista.reduce((t, i) => t + i.valor, 0);
  return lista.map((i, idx) => ({
    ...i, posicao: idx + 1,
    percentual: total ? (i.valor / total) * 100 : 0
  }));
}

/** Agrupa por CONTAGEM de registros (reincidência), não por soma. */
export function reincidencia(rows = [], chave) {
  const mapa = new Map();
  for (const r of (rows || []).filter(ativo)) {
    const k = (r[chave] ?? '').toString().trim() || '(não informado)';
    mapa.set(k, (mapa.get(k) || 0) + 1);
  }
  return [...mapa.entries()]
    .map(([chave, ocorrencias]) => ({ chave, ocorrencias }))
    .sort((a, b) => b.ocorrencias - a.ocorrencias);
}

/**
 * §15 — os cinco rankings oficiais, com posição no mês anterior e variação.
 * @param {object} atual    { ocorrencias, reclamacoes }
 * @param {object} anterior mesmo formato, da competência anterior (opcional)
 */
export function rankings(atual, anterior = null) {
  const def = (dados) => ({
    defeito:   agrupar(dados.ocorrencias, 'tipo_defeito', 'qtd_pecas'),
    partNumber: reincidencia(dados.ocorrencias, 'part_number'),
    linha:     agrupar(dados.ocorrencias, 'linha', 'qtd_pecas'),
    processo:  agrupar(dados.ocorrencias, 'processo', 'qtd_pecas'),
    cliente:   agrupar(dados.reclamacoes, 'cliente_oficial', 'qtd_reclamacoes')
  });
  const a = def(atual);
  const b = anterior ? def(anterior) : null;

  const comVariacao = (listaA, listaB, campo = 'valor') => listaA.map((item, idx) => {
    const antes = listaB ? listaB.findIndex(x => x.chave === item.chave) : -1;
    return {
      ...item,
      posicao: idx + 1,
      posicaoAnterior: antes >= 0 ? antes + 1 : null,
      variacaoPosicao: antes >= 0 ? (antes + 1) - (idx + 1) : null,
      valorAnterior: antes >= 0 ? listaB[antes][campo] : null,
      tendencia: antes < 0 ? 'novo'
        : (listaB[antes][campo] > item[campo] ? 'melhora'
          : listaB[antes][campo] < item[campo] ? 'piora' : 'estavel')
    };
  });

  return {
    defeito:    comVariacao(a.defeito, b?.defeito),
    partNumber: comVariacao(a.partNumber, b?.partNumber, 'ocorrencias'),
    linha:      comVariacao(a.linha, b?.linha),
    processo:   comVariacao(a.processo, b?.processo),
    cliente:    comVariacao(a.cliente, b?.cliente)
  };
}

/* ========================================================================== */
/* §16 — CRUZ DA QUALIDADE                                                     */
/* ========================================================================== */

/** Dias do mês como datas civis "AAAA-MM-DD" (§20: sem fuso). */
export function diasDoMes(mes, ano) {
  const total = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const mm = String(mes).padStart(2, '0');
  return Array.from({ length: total }, (_, i) => `${ano}-${mm}-${String(i + 1).padStart(2, '0')}`);
}

/**
 * §16 — status de cada dia. A REGRA é configurável (fm_config → cruz_regras):
 *   preto    → houve quebra no dia (se preto_quebra) ou peças NG ≥ preto_min_pecas
 *   vermelho → ocorrências ≥ vermelho_min_ocorrencias E peças ≥ vermelho_min_pecas
 *   amarelo  → ocorrências ≥ amarelo_min_ocorrencias
 *   verde    → dia com produção e sem ocorrência
 *   cinza    → sem produção / sem informação
 * Sobreposição manual (fm_cruz_dias.status_manual) sempre vence — com justificativa.
 */
export function cruzDaQualidade({ mes, ano, ocorrencias = [], quebras = [], producao = [], diasManuais = [] }, regras = {}) {
  const R = {
    amarelo_min_ocorrencias: 1, vermelho_min_ocorrencias: 1, vermelho_min_pecas: 10,
    preto_quebra: true, preto_min_pecas: 100, ...(regras || {})
  };
  const manualPorDia = new Map((diasManuais || []).map(d => [String(d.dia).slice(0, 10), d]));

  const dias = diasDoMes(mes, ano).map(dia => {
    const ocs = (ocorrencias || []).filter(o => ativo(o) && String(o.data || '').slice(0, 10) === dia);
    const qbs = (quebras || []).filter(q => ativo(q) && String(q.data_quebra || '').slice(0, 10) === dia);
    const prod = (producao || []).filter(p => ativo(p) && String(p.data || '').slice(0, 10) === dia);
    const pecasNG = soma(ocs, 'qtd_pecas');
    const manual = manualPorDia.get(dia);
    const temProducao = prod.length > 0 && soma(prod, 'qtd_fabricada') > 0;

    let status, motivo;
    if (manual?.status_manual) {
      status = manual.status_manual;
      motivo = manual.justificativa || 'Definido manualmente';
    } else if (manual?.sem_producao) {
      status = 'cinza'; motivo = 'Sem produção (marcado manualmente)';
    } else if ((R.preto_quebra && qbs.length) || (R.preto_min_pecas && pecasNG >= R.preto_min_pecas)) {
      status = 'preto';
      motivo = qbs.length ? `${qbs.length} quebra(s) no dia` : `${pecasNG} peças NG (≥ ${R.preto_min_pecas})`;
    } else if (ocs.length >= R.vermelho_min_ocorrencias && pecasNG >= R.vermelho_min_pecas) {
      status = 'vermelho'; motivo = `${ocs.length} ocorrência(s), ${pecasNG} peças NG`;
    } else if (ocs.length >= R.amarelo_min_ocorrencias) {
      status = 'amarelo'; motivo = `${ocs.length} ocorrência(s), ${pecasNG} peças NG`;
    } else if (temProducao) {
      status = 'verde'; motivo = 'Sem ocorrência';
    } else {
      status = 'cinza'; motivo = 'Sem produção ou sem informação';
    }

    return {
      dia, status, motivo,
      ocorrencias: ocs.length, pecasNG, quebras: qbs.length,
      partNumbers: [...new Set(ocs.map(o => o.part_number).filter(Boolean))],
      origens: [...new Set(ocs.map(o => o.origem_ocorrencia).filter(Boolean))],
      responsaveis: [...new Set(ocs.map(o => o.tratado_por || o.detectado_por).filter(Boolean))],
      registros: ocs, quebrasDoDia: qbs,
      observacao: manual?.observacao || null, anexo_url: manual?.anexo_url || null,
      manual: !!manual?.status_manual
    };
  });

  /* Estatísticas (§16). "Dias sem ocorrência" conta apenas dias verdes. */
  const verdes = dias.filter(d => d.status === 'verde').length;
  const amarelos = dias.filter(d => d.status === 'amarelo').length;
  const vermelhos = dias.filter(d => d.status === 'vermelho').length;
  const pretos = dias.filter(d => d.status === 'preto').length;
  const cinzas = dias.filter(d => d.status === 'cinza').length;
  const comInfo = dias.length - cinzas;

  let seq = 0, maiorSeq = 0;
  for (const d of dias) {
    if (d.status === 'verde') { seq++; maiorSeq = Math.max(maiorSeq, seq); }
    else if (d.status !== 'cinza') seq = 0;
  }

  return {
    dias,
    estatisticas: {
      diasSemOcorrencia: verdes,
      maiorSequencia: maiorSeq,
      amarelos, vermelhos, criticos: pretos, semProducao: cinzas,
      percentualConformes: comInfo ? (verdes / comInfo) * 100 : null,
      totalDias: dias.length
    }
  };
}

/* ========================================================================== */
/* §31 — AVALIAÇÃO CONTRA A META                                               */
/* ========================================================================== */

/**
 * Compara resultado × meta e devolve a cor + rótulo do status (§6).
 * `atencao` = faixa (em %) antes do limite que pinta de amarelo.
 */
export function avaliarMeta(valor, meta, { comparacao = '<=', valorMax = null, atencao = 0.9 } = {}) {
  if (valor == null) return { cor: 'cinza', texto: 'Sem dados', dentro: null };
  if (meta == null)  return { cor: 'azul',  texto: 'Sem meta cadastrada', dentro: null };

  const v = Number(valor), m = Number(meta);
  let dentro;
  switch (comparacao) {
    case '<':  dentro = v <  m; break;
    case '<=': dentro = v <= m; break;
    case '>':  dentro = v >  m; break;
    case '>=': dentro = v >= m; break;
    case '=':  dentro = v === m; break;
    case 'faixa': dentro = valorMax != null ? (v >= m && v <= Number(valorMax)) : v >= m; break;
    default:   dentro = v <= m;
  }
  if (!dentro) return { cor: 'vermelho', texto: 'Fora da meta', dentro: false };

  /* Zona de atenção: perto do limite, mas ainda dentro. */
  const menorEhMelhor = ['<', '<='].includes(comparacao);
  if (menorEhMelhor && m > 0 && v >= m * atencao) {
    return { cor: 'amarelo', texto: 'Próximo ao limite', dentro: true };
  }
  if (!menorEhMelhor && comparacao !== 'faixa' && m > 0 && v <= m / atencao && v < m * (2 - atencao)) {
    return { cor: 'amarelo', texto: 'Próximo ao limite', dentro: true };
  }
  return { cor: 'verde', texto: 'Dentro da meta', dentro: true };
}

/** Meta vigente para um indicador (§31): mais específica primeiro. */
export function metaVigente(metas = [], indicador, { planta = null, cliente = null, ano = null } = {}) {
  const cands = (metas || [])
    .filter(m => ativo(m) && m.indicador === indicador && m.status === 'Ativo')
    .filter(m => !m.planta  || m.planta === planta)
    .filter(m => !m.cliente || m.cliente === cliente)
    .filter(m => !m.ano     || Number(m.ano) === Number(ano));
  return cands.sort((a, b) =>
    ((b.cliente ? 2 : 0) + (b.planta ? 1 : 0)) - ((a.cliente ? 2 : 0) + (a.planta ? 1 : 0))
  )[0] || null;
}

/* ========================================================================== */
/* §34 — VARIAÇÃO E TENDÊNCIA                                                  */
/* ========================================================================== */

export function variacao(atual, anterior) {
  if (atual == null || anterior == null) {
    return { absoluta: null, percentual: null, tendencia: 'sem_base', exibicao: '—' };
  }
  const abs = atual - anterior;
  const pct = anterior === 0 ? null : (abs / Math.abs(anterior)) * 100;
  return {
    absoluta: abs,
    percentual: pct,
    tendencia: abs > 0 ? 'subiu' : abs < 0 ? 'caiu' : 'estavel',
    exibicao: pct == null
      ? `${abs > 0 ? '+' : ''}${fmtNumAgrupado(abs)}`
      : `${abs > 0 ? '+' : ''}${fmtNumAgrupado(abs)} (${fmtPercent(pct)})`
  };
}

/**
 * §29/§6 — acumulado anual de um indicador a partir das competências do ano.
 * Recebe pares { mes, valor } e devolve soma, média e a série mensal completa.
 */
export function acumuladoAnual(serie = [], { tipo = 'soma' } = {}) {
  const validos = serie.filter(s => s.valor != null);
  const soma_ = validos.reduce((t, s) => t + Number(s.valor), 0);
  const media = validos.length ? soma_ / validos.length : null;
  return {
    soma: validos.length ? soma_ : null,
    media,
    valor: tipo === 'media' ? media : (validos.length ? soma_ : null),
    meses: validos.length,
    serie: Array.from({ length: 12 }, (_, i) => {
      const achado = serie.find(s => Number(s.mes) === i + 1);
      return { mes: i + 1, valor: achado ? achado.valor : null };
    })
  };
}

/**
 * Acumulado anual de PPM não é soma de PPM (§29): é a razão dos totais
 * acumulados. Somar PPM de meses diferentes daria um número sem significado.
 */
export function ppmAcumulado(serie = []) {
  const num_ = serie.reduce((t, s) => t + Number(s.numerador || 0), 0);
  const den_ = serie.reduce((t, s) => t + Number(s.denominador || 0), 0);
  if (!den_) return { valor: null, exibicao: 'Sem base acumulada', numerador: num_, denominador: 0 };
  const v = (num_ / den_) * M;
  return { valor: v, exibicao: fmtPPM(v), numerador: num_, denominador: den_ };
}
