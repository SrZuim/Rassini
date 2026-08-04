/* ==========================================================================
   RNA One — SimulationEngine (Rel. Dimensionais de Produção)
   ÚNICA responsabilidade: TRANSFORMAR. Recebe o relatório oficial já carregado
   e devolve uma CÓPIA simulada — em memória, no formato exato que a tela de
   relatório espera.

   ------------------------------------------------------------ IMUTABILIDADE
   O objeto de entrada NUNCA é tocado. Cada característica e cada medição vira
   um objeto novo (spread), e nada aqui chama db.update/insert/remove: este
   arquivo não importa services/db.js de propósito. O relatório oficial, suas
   medições, anexos e histórico permanecem exatamente como estão no banco.

   -------------------------------------------------------------- RECÁLCULO
   Depois de trocar os valores reprovados, o resultado NÃO é "declarado
   aprovado": ele é RECALCULADO pelas mesmas funções do módulo oficial
   (derivarResultados → resultadoCaracteristica → resultadoGeral). Se por algum
   motivo um valor gerado não fosse conforme, o relatório simulado continuaria
   reprovado — e a tela avisaria. A simulação não tem um caminho para "mentir".

   ------------------------------------------------------------------ MARCAS
   Cada item transformado carrega a sua própria rastreabilidade:
     medição:        _simulado, _valorOriginal
     característica: _simulado, _medicoesAjustadas, _resultadoOriginal,
                     _simulacaoImpossivel, _motivoSimulacao
     relatório:      _simulado, _resultadoOriginal, _statusOriginal
   ========================================================================== */
import * as INSP from '../inspecao.js';
import { resultadoDaAmostra } from '../insp-amostras.js';
import { gerarValor } from './simulation-calculator.js';
import * as VALID from './simulation-validator.js';

/* Semente estável por medição: mesmo relatório + mesma cota + mesma peça ⇒
   sempre o mesmo valor simulado. Trocar de relatório, de cota ou de peça troca
   completamente o número — é o que evita a coluna inteira com o mesmo valor. */
const semente = (relId, car, amostra) =>
  `${relId}|${car.id ?? car.cota ?? ''}|${car.cota ?? ''}|${amostra}`;

/* ============================================================ CARACTERÍSTICA */
/** Simula UMA característica. Devolve sempre um objeto novo, com o resultado
    recalculado pelo motor oficial. */
export function simularCaracteristica(car, relId) {
  const original = { ...car, medicoes: (car.medicoes || []).map(m => ({ ...m })) };

  if (!VALID.caracteristicaPrecisaSimulacao(car)) {
    return INSP.derivarResultados({ ...original, _simulado: false });
  }

  const usados = [];
  let ajustadas = 0, impossivel = false, motivo = '';

  const medicoes = original.medicoes.map(m => {
    if (!VALID.medicaoPrecisaSimulacao(car, m)) return m;
    const g = gerarValor(car, {
      semente: semente(relId, car, m.amostra),
      valorOriginal: m.valor,
      usados
    });
    /* Cinto de segurança: o valor só entra se a REGRA OFICIAL o aprovar.
       Reprovado que não pôde ser corrigido continua reprovado e é denunciado. */
    if (!g.ok || !VALID.valorConforme(car, g.valor)) {
      impossivel = true;
      motivo = g.motivo || VALID.motivoImpossibilidade(car);
      return m;
    }
    if (g.escalonado != null) usados.push(g.escalonado);
    ajustadas++;
    return { ...m, valor: g.valor, _simulado: true, _valorOriginal: m.valor };
  });

  const simulada = INSP.derivarResultados({
    ...original, medicoes,
    _simulado: ajustadas > 0,
    _medicoesAjustadas: ajustadas,
    _resultadoOriginal: car.resultado,
    _simulacaoImpossivel: impossivel,
    _motivoSimulacao: motivo
  });
  /* A classe da NC acompanha o resultado: deixou de reprovar, deixou de ter
     classe. derivarResultados já faz isso — aqui só documentamos a intenção. */
  return simulada;
}

/* ================================================================ RELATÓRIO */
/**
 * Simula o relatório completo.
 * @param {{rel:object, caracteristicas:Array, acoes:Array, anexos:Array}} dados
 *        saída de INSP.carregarRelatorio() — NÃO é modificada.
 * @param {{amostras?:Array}} extras estado das peças (§M04), opcional.
 * @returns {{rel, caracteristicas, acoes, anexos, amostras, resumo, simulacao}}
 */
export function simularRelatorio(dados, { amostras = [] } = {}) {
  const { rel, caracteristicas = [], acoes = [], anexos = [] } = dados || {};
  const precisa = VALID.relatorioPrecisaSimulacao(rel);

  const cars = caracteristicas.map(c => precisa
    ? simularCaracteristica(c, rel.id)
    : INSP.derivarResultados({ ...c, medicoes: (c.medicoes || []).map(m => ({ ...m })), _simulado: false }));

  /* Resultado geral pelo motor oficial (referências ficam de fora, §11). */
  const avaliaveis = cars.filter(c => !c.informativo);
  const resultado = INSP.resultadoGeral(avaliaveis.map(c => c.resultado));

  const relSim = {
    ...rel,
    resultado,
    status: statusSimulado(rel.status, resultado),
    _simulado: precisa,
    _resultadoOriginal: rel.resultado,
    _statusOriginal: rel.status
  };

  return {
    rel: relSim,
    caracteristicas: cars,
    acoes: acoes.map(a => ({ ...a })),
    anexos: anexos.map(a => ({ ...a })),      // referência apenas: nada é copiado no Storage
    amostras: simularAmostras(amostras, cars),
    resumo: resumoSimulado(relSim, cars),
    simulacao: VALID.estadoDaSimulacao(cars)
  };
}

/** Status coerente com o novo resultado, preservando a família do original:
    um relatório finalizado continua finalizado; um em andamento não "finaliza"
    por causa da simulação — só o desfecho (aprovada/reprovada) acompanha. */
export function statusSimulado(status, resultado) {
  if (status === 'finalizada_reprovada' && resultado === 'aprovado') return 'finalizada_aprovada';
  if (status === 'finalizada_aprovada' && resultado === 'reprovado') return 'finalizada_reprovada';
  return status;
}

/* =================================================== MEDIÇÃO POR PEÇA (§M04)
   O quadro de rastreabilidade por peça mostra o resultado de cada amostra.
   Com os valores simulados, esse resultado também muda — recalculado pela mesma
   função do módulo oficial (insp-amostras.resultadoDaAmostra), nunca gravado. */
export function simularAmostras(amostras = [], caracteristicas = []) {
  if (!amostras.length) return [];
  const porAmostra = {};
  caracteristicas.forEach(c => {
    if (c.informativo) return;
    (c.medicoes || []).forEach(m => (porAmostra[m.amostra] = porAmostra[m.amostra] || []).push(m));
  });
  return amostras.map(a => {
    const meds = porAmostra[a.amostra] || [];
    if (!meds.length) return { ...a };
    const novo = resultadoDaAmostra(meds);
    return { ...a, resultado: novo, _simulado: novo !== a.resultado, _resultadoOriginal: a.resultado };
  });
}

/* ==================================================================== RESUMO
   Mesmos indicadores de INSP.resumoRelatorio, porém calculados SOBRE O OBJETO
   SIMULADO. Não dá para reaproveitar aquela função aqui: ela relê tudo do banco
   e devolveria os números oficiais — que é justamente o que não queremos. */
export function resumoSimulado(rel, todas = []) {
  const cars = todas.filter(c => !c.informativo);
  const totalCar = cars.length;
  const carAprov = cars.filter(c => c.resultado === 'aprovado').length;
  const carReprov = cars.filter(c => c.resultado === 'reprovado').length;
  const meds = cars.flatMap(c => c.medicoes || []);
  const classe = cod => cars.filter(c => c.resultado === 'reprovado' && c.classe_defeito === cod).length;
  const refs = todas.filter(c => c.informativo);
  return {
    totalCaracteristicas: totalCar,
    caracteristicasAprovadas: carAprov,
    caracteristicasReprovadas: carReprov,
    totalMedicoes: meds.length,
    medicoesAprovadas: meds.filter(m => m.resultado === 'aprovado').length,
    medicoesReprovadas: meds.filter(m => m.resultado === 'reprovado').length,
    caracteristicasReferencia: refs.length,
    medicoesReferencia: refs.flatMap(c => c.medicoes || []).filter(m => String(m.valor ?? '') !== '').length,
    amostras: rel.quantidade || 0,
    conformidade: totalCar ? Math.round(carAprov / totalCar * 100) : 0,
    classeA: classe('A'), classeB: classe('B'), classeC: classe('C'),
    classeNaoAplica: cars.filter(c => c.resultado === 'reprovado' && INSP.classeCadastrada(c) === 'NA').length,
    classeNaoCadastrada: INSP.caracteristicasSemClasse(cars).length,
    resultado: rel.resultado, duracaoSeg: rel.duracao_seg
  };
}
