/* ==========================================================================
   RNA One — FECHAMENTO MENSAL · Consolidação dos indicadores
   ---------------------------------------------------------------------------
   Camada entre o BANCO (db.js) e o MOTOR PURO de cálculo (fm-calc.js).
   Aqui acontece a leitura; lá acontece a matemática. Essa separação é o que
   permite testar todo o cálculo no Node sem navegador nem Supabase.

   Saída principal: consolidar(competencia) → o "painel completo" da competência,
   com valor, meta, mês anterior, variação, acumulado anual, tendência, status,
   origem do dado e memória de cálculo de cada indicador (§6).

   Nenhum número é inventado: sem lançamento, o indicador vem `calculavel:false`
   com o motivo ("Sem base de fornecimento", "Sem inspeções registradas"...).
   ========================================================================== */
import { db } from '../db.js';
import { agoraISO, hojeBR } from '../datahora.js';
import * as CALC from './fm-calc.js';
import { INDICADORES, SECOES, colunaCompetencia, ACAO_ABERTA } from './fm-schema.js';
import { obterCompetencia, listarCompetencias, config, identidade, logar, acoesVigentes, calcularProgresso } from './fm-core.js';

const ativo = r => !r?.deleted_at;

/* ------------------------------------------------------------- leitura --- */

/** Lê todos os lançamentos de uma competência, em paralelo. */
export async function carregarDados(competencia) {
  if (!competencia) return null;
  const id = competencia.id;

  const [reclamacoes, ocorrencias, producao, fornecimento, custos, retrabalho,
         sucata, care, quebras, seguranca, cruzDias, criterios, metas, pendencias] =
    await Promise.all([
      lerSecao('reclamacoes', id), lerSecao('ocorrencias', id), lerSecao('producao', id),
      lerSecao('fornecimento', id), lerSecao('custos', id), lerSecao('retrabalho', id),
      lerSecao('sucata', id), lerSecao('care', id), lerSecao('quebras', id),
      lerSecao('seguranca', id),
      db.list('fm_cruz_dias').then(r => r.filter(x => x.competencia_id === id)).catch(() => []),
      db.list('fm_criterios').then(r => r.filter(ativo)).catch(() => []),
      db.list('fm_metas').then(r => r.filter(ativo)).catch(() => []),
      db.list('fm_pendencias').then(r => r.filter(x => x.competencia_id === id)).catch(() => [])
    ]);

  const acoes = await acoesVigentes(competencia).catch(() => []);

  return {
    competencia, reclamacoes, ocorrencias, producao, fornecimento, custos,
    retrabalho, sucata, care, quebras, seguranca, cruzDias, criterios, metas,
    pendencias, acoes
  };
}

async function lerSecao(secaoId, competencia_id) {
  const spec = SECOES[secaoId];
  const col = colunaCompetencia(secaoId);
  try {
    const rows = await db.list(spec.tabela);
    return rows.filter(r => r[col] === competencia_id && ativo(r));
  } catch (e) {
    console.warn(`[FM] Falha ao ler ${spec.tabela}:`, e?.message);
    return [];
  }
}

/* ------------------------------------------------------- consolidação --- */

/**
 * Painel completo da competência (§6).
 * @param {object} competencia registro de fm_competencias
 * @param {object} opts.anterior dados da competência anterior (opcional; se
 *        não vier, é carregado automaticamente para permitir a comparação)
 */
export async function consolidar(competencia, { comAnterior = true, comAnual = true } = {}) {
  if (!competencia) return null;
  const dados = await carregarDados(competencia);
  const dataRef = referenciaDaCompetencia(competencia);

  /* Critério vigente NA ÉPOCA da competência (§13) — nunca o critério novo. */
  const criterio = CALC.criterioVigente(dados.criterios, dataRef, {
    planta: competencia.planta, indicador: 'ppm_interno'
  });

  /* Histórico de reclamações oficiais (dias sem reclamação olha além do mês). */
  const historicoReclamacoes = await todasReclamacoes(competencia.planta);

  /* Progresso é RECALCULADO aqui, não lido de fm_competencias.percentual: a
     coluna é atualizada depois, e ler dela mostrava o valor do render anterior
     (o cartão dizia 0% enquanto o cabeçalho já mostrava 78%). */
  const progresso = await calcularProgresso(competencia.id);

  const limiteCusto = (await config('custo_limite_mensal', competencia.planta, { valor: null }))?.valor ?? null;
  const modoRetrabalho = (await config('retrabalho_modo', competencia.planta, { modo: 'ppm' }))?.modo || 'ppm';
  const regrasCruz = await config('cruz_regras', competencia.planta, {});

  /* ------------------------------------------------ cálculos do mês */
  const ppmOficial = CALC.ppmExternoOficial(dados.reclamacoes, dados.fornecimento);
  const ppmReal    = CALC.ppmExternoReal(dados.reclamacoes, dados.fornecimento);
  const ppmInt     = CALC.ppmInterno(dados, criterio);
  const diasSemRec = CALC.diasSemReclamacao(historicoReclamacoes, dataRef);
  const retr       = CALC.indiceRetrabalho(dados.retrabalho, { modo: modoRetrabalho });
  const sucataPPM  = CALC.ppmSucata(dados.sucata, dados.producao);
  const custo      = CALC.custoQualidade(dados.custos, { limite: limiteCusto, producao: dados.producao });
  const care       = CALC.indicadoresCare(dados.care);
  const cruz       = CALC.cruzDaQualidade({
    mes: competencia.mes, ano: competencia.ano,
    ocorrencias: dados.ocorrencias, quebras: dados.quebras,
    producao: dados.producao, diasManuais: dados.cruzDias
  }, regrasCruz);

  const brutos = {
    reclamacoes:            CALC.soma(dados.reclamacoes.filter(r => r.oficial), 'qtd_reclamacoes'),
    reclamacoes_negociadas: CALC.soma(dados.reclamacoes.filter(r => r.negociada), 'qtd_reclamacoes'),
    ppm_externo_oficial:    ppmOficial.valor,
    ppm_externo_real:       ppmReal.valor,
    ocorrencias:            dados.ocorrencias.length,
    ppm_interno:            ppmInt.valor,
    dias_sem_reclamacao:    diasSemRec.valor,
    quebras_externas:       dados.quebras.filter(q => q.tipo === 'externa').length,
    quebras_internas:       dados.quebras.filter(q => q.tipo === 'interna').length,
    custo_qualidade:        custo.valor,
    care_inspecoes:         care.inspecoes,
    care_percentual_ng:     care.percentualNG,
    planos_atrasados:       dados.acoes.filter(a => a.status === 'Atrasado').length,
    pendencias:             dados.pendencias.filter(p => p.status === 'Aberta').length,
    progresso:              progresso.percentual,
    seguranca_eventos:      CALC.soma(dados.seguranca, 'quantidade'),
    retrabalho:             retr.valor,
    sucata_ppm:             sucataPPM.valor
  };

  /* ------------------------------------------------ mês anterior (§6) */
  let anterior = null, brutosAnteriores = {};
  if (comAnterior) {
    const compAnterior = await competenciaAnterior(competencia);
    if (compAnterior) {
      anterior = await consolidar(compAnterior, { comAnterior: false, comAnual: false });
      brutosAnteriores = anterior?.brutos || {};
    }
  }

  /* ------------------------------------------------ acumulado anual (§6) */
  let anual = {};
  if (comAnual) anual = await acumuladosDoAno(competencia);

  /* ------------------------------------------------ montagem dos cards */
  const memorias = {
    ppm_externo_oficial: ppmOficial.memoria,
    ppm_externo_real:    ppmReal.memoria,
    ppm_interno:         ppmInt.memoria,
    dias_sem_reclamacao: diasSemRec.memoria,
    custo_qualidade:     custo.memoria,
    care_percentual_ng:  care.memoria,
    retrabalho:          retr.memoria,
    sucata_ppm:          sucataPPM.memoria
  };
  const CALCULADOS = new Set(Object.keys(memorias));
  const NAO_CALCULAVEIS = {
    ppm_externo_oficial: ppmOficial, ppm_externo_real: ppmReal, ppm_interno: ppmInt,
    dias_sem_reclamacao: diasSemRec, retrabalho: retr, sucata_ppm: sucataPPM
  };

  const cards = {};
  for (const [chave, spec] of Object.entries(INDICADORES)) {
    const valor = brutos[chave] ?? null;
    const meta = CALC.metaVigente(dados.metas, chave, {
      planta: competencia.planta, ano: competencia.ano
    });
    const naoCalc = NAO_CALCULAVEIS[chave];
    const status = naoCalc && !naoCalc.calculavel
      ? { cor: 'cinza', texto: naoCalc.motivo, dentro: null }
      : CALC.avaliarMeta(valor, meta?.valor, {
          comparacao: meta?.comparacao || (spec.melhor === 'maior' ? '>=' : '<='),
          valorMax: meta?.valor_max
        });

    cards[chave] = {
      chave, label: spec.label, unidade: spec.unidade, icone: spec.icone, melhor: spec.melhor,
      valor,
      exibicao: exibir(chave, valor, naoCalc, spec),
      calculavel: naoCalc ? naoCalc.calculavel : valor != null,
      motivo: naoCalc?.motivo || null,
      meta: meta?.valor ?? null,
      metaUnidade: meta?.unidade || spec.unidade,
      comparacao: meta?.comparacao || null,
      anterior: brutosAnteriores[chave] ?? null,
      variacao: CALC.variacao(valor, brutosAnteriores[chave] ?? null),
      acumulado: anual[chave] || null,
      status,
      origem: CALCULADOS.has(chave) ? 'calculado' : origemDoIndicador(chave),
      memoria: memorias[chave] || null,
      atualizadoEm: competencia.updated_at || competencia.created_at || null
    };
  }

  /* Tendência: melhora/piora considerando o SENTIDO do indicador (§6). */
  for (const card of Object.values(cards)) {
    const v = card.variacao;
    if (v.absoluta == null || v.absoluta === 0) { card.tendencia = 'estavel'; continue; }
    const subiu = v.absoluta > 0;
    card.tendencia = (card.melhor === 'menor') === subiu ? 'piora' : 'melhora';
  }

  return {
    competencia, dados, criterio, dataRef, brutos, cards, anual,
    anteriorCompetencia: anterior?.competencia || null,
    detalhes: {
      ppmOficial, ppmReal, ppmInterno: ppmInt, diasSemReclamacao: diasSemRec,
      retrabalho: retr, sucata: sucataPPM, custo, care, cruz,
      comparativoPPM: CALC.comparativoPPM(ppmOficial, ppmReal),
      rankings: CALC.rankings(dados, anterior?.dados || null)
    },
    calculadoEm: agoraISO()
  };
}

function exibir(chave, valor, naoCalc, spec) {
  if (naoCalc && !naoCalc.calculavel) return naoCalc.motivo;
  if (valor == null) return 'Sem dados';
  if (naoCalc) return naoCalc.exibicao;
  if (spec.unidade === 'BRL') return CALC.fmtMoeda(valor);
  if (spec.unidade === '%') return `${Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  return Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
}

/** §30 — de onde veio o número exibido no card. */
function origemDoIndicador(chave) {
  if (['reclamacoes', 'reclamacoes_negociadas', 'ocorrencias', 'quebras_externas',
       'quebras_internas', 'seguranca_eventos', 'care_inspecoes'].includes(chave)) return 'manual';
  if (['pendencias', 'planos_atrasados', 'progresso'].includes(chave)) return 'automatico';
  return 'calculado';
}

/* ------------------------------------------------------------ contexto --- */

/** Data de referência do cálculo: o último dia da competência, ou HOJE quando
    a competência é a do mês corrente (§10 — dias sem reclamação até agora). */
export function referenciaDaCompetencia(competencia) {
  const hoje = hojeBR();
  const fim = competencia.data_final ||
    `${competencia.ano}-${String(competencia.mes).padStart(2, '0')}-${new Date(Date.UTC(competencia.ano, competencia.mes, 0)).getUTCDate()}`;
  return hoje < fim ? hoje : fim;
}

export async function competenciaAnterior(competencia) {
  if (competencia.competencia_anterior_id) {
    const c = await obterCompetencia(competencia.competencia_anterior_id);
    if (c) return c;
  }
  const mes = competencia.mes === 1 ? 12 : competencia.mes - 1;
  const ano = competencia.mes === 1 ? competencia.ano - 1 : competencia.ano;
  const todas = await listarCompetencias({ planta: competencia.planta });
  return todas.find(c => Number(c.mes) === mes && Number(c.ano) === ano) || null;
}

/**
 * §29 — acumulados anuais. Recalcula cada mês FECHADO ou aberto do ano com o
 * critério vigente na época. PPM é acumulado pela razão dos totais, não pela
 * soma dos PPM (que não tem significado).
 */
export async function acumuladosDoAno(competencia) {
  const todas = (await listarCompetencias({ planta: competencia.planta, ano: competencia.ano }))
    .filter(c => Number(c.mes) <= Number(competencia.mes))
    .sort((a, b) => a.mes - b.mes);

  const series = {};
  const somaSerie = {};
  const ppmSeries = { ppm_externo_oficial: [], ppm_externo_real: [], ppm_interno: [] };

  for (const c of todas) {
    const dados = await carregarDados(c);
    const criterio = CALC.criterioVigente(dados.criterios, referenciaDaCompetencia(c),
      { planta: c.planta, indicador: 'ppm_interno' });

    const ofi = CALC.ppmExternoOficial(dados.reclamacoes, dados.fornecimento);
    const rea = CALC.ppmExternoReal(dados.reclamacoes, dados.fornecimento);
    const int = CALC.ppmInterno(dados, criterio);

    ppmSeries.ppm_externo_oficial.push({ mes: c.mes, numerador: ofi.memoria.numerador, denominador: ofi.memoria.denominador });
    ppmSeries.ppm_externo_real.push({ mes: c.mes, numerador: rea.memoria.numerador, denominador: rea.memoria.denominador });
    ppmSeries.ppm_interno.push({ mes: c.mes, numerador: int.memoria.numerador, denominador: int.memoria.denominador });

    const mensais = {
      reclamacoes:            CALC.soma(dados.reclamacoes.filter(r => r.oficial), 'qtd_reclamacoes'),
      reclamacoes_negociadas: CALC.soma(dados.reclamacoes.filter(r => r.negociada), 'qtd_reclamacoes'),
      ocorrencias:            dados.ocorrencias.length,
      quebras_externas:       dados.quebras.filter(q => q.tipo === 'externa').length,
      quebras_internas:       dados.quebras.filter(q => q.tipo === 'interna').length,
      custo_qualidade:        CALC.soma(dados.custos, 'valor'),
      care_inspecoes:         dados.care.length,
      seguranca_eventos:      CALC.soma(dados.seguranca, 'quantidade'),
      pecas_fornecidas:       CALC.soma(dados.fornecimento, 'qtd_fornecida'),
      pecas_fabricadas:       CALC.soma(dados.producao, 'qtd_fabricada'),
      ppm_externo_oficial:    ofi.valor,
      ppm_externo_real:       rea.valor,
      ppm_interno:            int.valor
    };
    for (const [k, v] of Object.entries(mensais)) {
      (series[k] = series[k] || []).push({ mes: c.mes, valor: v });
    }
  }

  for (const [k, serie] of Object.entries(series)) {
    somaSerie[k] = CALC.acumuladoAnual(serie);
  }
  /* PPM acumulado corrigido — sobrepõe a soma ingênua. */
  for (const [k, serie] of Object.entries(ppmSeries)) {
    const acc = CALC.ppmAcumulado(serie);
    somaSerie[k] = { ...(somaSerie[k] || {}), valor: acc.valor, exibicao: acc.exibicao,
                     numerador: acc.numerador, denominador: acc.denominador };
  }
  return somaSerie;
}

/** Reclamações da planta em TODO o histórico (dias sem reclamação, §10). */
async function todasReclamacoes(planta) {
  const comps = await listarCompetencias({ planta });
  const ids = new Set(comps.map(c => c.id));
  const rows = await db.list('fm_reclamacoes').catch(() => []);
  return rows.filter(r => ativo(r) && ids.has(r.competencia_id));
}

/* ------------------------------------------------- MEMÓRIA PERSISTIDA (§8) */

/**
 * Grava a memória de cálculo no banco (fm_memoria). É o que torna o número
 * auditável meses depois: fórmula, entradas, critério e resultado sem
 * arredondamento, com data do cálculo.
 */
export async function persistirMemoria(painel, user) {
  if (!painel) return { gravadas: 0 };
  const eu = identidade(user);
  const comp = painel.competencia;
  let gravadas = 0;

  const existentes = await db.list('fm_memoria').catch(() => []);
  for (const [indicador, card] of Object.entries(painel.cards)) {
    if (!card.memoria) continue;
    const m = card.memoria;
    const linha = {
      competencia_id: comp.id, indicador,
      formula: m.formula, numerador: m.numerador, denominador: m.denominador,
      resultado_bruto: m.resultado_bruto, resultado_exibido: m.resultado_exibido,
      criterio_id: m.criterio_id || null, criterio_nome: m.criterio_nome || null,
      criterio_versao: m.criterio_versao || null,
      entradas: m.entradas || {}, detalhe: m.detalhe || [],
      calculado_em: m.calculado_em || agoraISO(), calculado_por: eu.nome
    };
    const atual = existentes.find(x => x.competencia_id === comp.id && x.indicador === indicador);
    try {
      if (atual) await db.update('fm_memoria', atual.id, linha);
      else await db.insert('fm_memoria', linha);
      gravadas++;
    } catch (e) {
      console.warn('[FM] memória de cálculo não gravada:', indicador, e?.message);
    }
  }
  await logar({
    competencia_id: comp.id, tabela: 'fm_memoria', acao: 'calculo',
    valor_novo: `${gravadas} indicadores recalculados`,
    usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });
  return { gravadas };
}

/* --------------------------------------------------- §34 COMPARATIVO ------ */

/** Compara duas competências indicador a indicador (§34). */
export async function compararCompetencias(compA, compB) {
  const [a, b] = await Promise.all([
    consolidar(compA, { comAnterior: false, comAnual: false }),
    consolidar(compB, { comAnterior: false, comAnual: false })
  ]);
  const linhas = Object.keys(INDICADORES).map(chave => {
    const va = a.brutos[chave] ?? null, vb = b.brutos[chave] ?? null;
    const v = CALC.variacao(vb, va);
    return {
      chave, label: INDICADORES[chave].label, unidade: INDICADORES[chave].unidade,
      anterior: va, atual: vb,
      variacaoAbsoluta: v.absoluta, variacaoPercentual: v.percentual,
      status: b.cards[chave].status,
      melhorou: v.absoluta == null ? null
        : (INDICADORES[chave].melhor === 'menor' ? v.absoluta < 0 : v.absoluta > 0)
    };
  });
  return { de: a, para: b, linhas };
}

/* -------------------------------------------- §33 RESUMO DAS ATUALIZAÇÕES -- */

/**
 * Gera o resumo textual comparando com a competência anterior.
 * REGRA (§33): descreve APENAS o que os dados mostram. Não infere causa, não
 * justifica, não opina — quem interpreta é o apresentador, que pode editar o
 * texto antes de levá-lo para a apresentação.
 */
export function gerarResumo(painel) {
  if (!painel) return [];
  const frases = [];
  const c = painel.cards;
  const nf = n => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

  const ocorr = c.ocorrencias;
  if (ocorr.anterior != null && ocorr.valor !== ocorr.anterior) {
    const d = ocorr.valor - ocorr.anterior;
    frases.push(d > 0
      ? `Foram registradas ${nf(Math.abs(d))} ${Math.abs(d) === 1 ? 'nova ocorrência interna' : 'novas ocorrências internas'}.`
      : `As ocorrências internas caíram de ${nf(ocorr.anterior)} para ${nf(ocorr.valor)}.`);
  }

  for (const chave of ['ppm_interno', 'ppm_externo_oficial', 'ppm_externo_real']) {
    const card = c[chave];
    if (card.valor != null && card.anterior != null && Math.round(card.valor) !== Math.round(card.anterior)) {
      frases.push(`O ${card.label} passou de ${nf(card.anterior)} para ${nf(card.valor)}.`);
    }
  }

  const custo = c.custo_qualidade;
  if (custo.valor != null && custo.anterior != null && custo.valor !== custo.anterior) {
    const d = custo.valor - custo.anterior;
    frases.push(`O custo da qualidade ${d > 0 ? 'aumentou' : 'reduziu'} ${CALC.fmtMoeda(Math.abs(d))}.`);
  }

  const atrasados = c.planos_atrasados;
  if (atrasados.valor > 0) {
    frases.push(`${nf(atrasados.valor)} ${atrasados.valor === 1 ? 'plano de ação está atrasado' : 'planos de ação estão atrasados'}.`);
  }

  const rk = painel.detalhes.rankings.defeito?.[0];
  if (rk) {
    frases.push(rk.posicaoAnterior === 1
      ? `O principal problema continua sendo ${rk.chave}.`
      : `O principal problema passou a ser ${rk.chave}.`);
  }
  const pn = painel.detalhes.rankings.partNumber?.[0];
  if (pn && pn.posicaoAnterior !== 1) {
    frases.push(`O Part Number ${pn.chave} assumiu a maior reincidência.`);
  }

  const dias = c.dias_sem_reclamacao;
  if (dias.calculavel && painel.detalhes.diasSemReclamacao.recorde) {
    const r = painel.detalhes.diasSemReclamacao;
    if (r.diferencaRecorde === 0) frases.push(`A planta atingiu o recorde de ${nf(r.recorde)} dias sem reclamação.`);
  }

  const pend = c.pendencias;
  if (pend.valor > 0) frases.push(`Existem ${nf(pend.valor)} ${pend.valor === 1 ? 'pendência aberta' : 'pendências abertas'} no fechamento.`);

  return frases;
}
