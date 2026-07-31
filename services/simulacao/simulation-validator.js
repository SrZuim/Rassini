/* ==========================================================================
   RNA One — SimulationValidator (Rel. Dimensionais Simulados)
   ÚNICA responsabilidade: DECIDIR. O que precisa ser simulado, o que precisa
   ficar intacto e se um valor gerado é realmente conforme.

   REGRA DE OURO: quem julga "aprovado" continua sendo services/medicao.js —
   o mesmo motor do módulo oficial. Este validador nunca reimplementa a
   comparação de limites; ele PERGUNTA ao motor. Se um dia a regra de tolerância
   mudar, a simulação acompanha sozinha.

   O validador também é o que impede o FALSO SUCESSO: quando não existe valor
   conforme possível (limites invertidos, cadastro sem tolerância), a medição é
   marcada como não simulável e a característica permanece reprovada — a tela
   avisa em vez de exibir um "aprovado" que a regra não sustenta.
   ========================================================================== */
import * as MED from '../medicao.js';
import { ehCaracteristicaReferencia, tipoDeAvaliacao } from '../inspecao.js';

/* ------------------------------------------------------- O QUE SIMULAR ----- */

/** Relatório que precisa de simulação. Aprovado e em andamento passam intactos:
    a simulação existe para responder "e se as reprovações estivessem conformes". */
export function relatorioPrecisaSimulacao(rel) {
  return rel?.resultado === 'reprovado';
}

/** Característica a ajustar: apenas as reprovadas e mensuráveis.
    REFERÊNCIA nunca reprova (não tem limites) — nada a ajustar nela. */
export function caracteristicaPrecisaSimulacao(car) {
  return car?.resultado === 'reprovado' && !ehCaracteristicaReferencia(car);
}

/** Medição a substituir: somente a que a REGRA considera reprovada — não o que
    está gravado na coluna `resultado` (que pode vir de uma versão antiga do
    sistema). Por isso a avaliação é refeita aqui. */
export function medicaoPrecisaSimulacao(car, med) {
  return avaliar(car, med?.valor).status === MED.STATUS.REPROVADO;
}

/* --------------------------------------------------- VALIDAÇÃO DO GERADO --- */

/** Avaliação oficial de um valor no contexto da característica. */
export function avaliar(car, valor) {
  return MED.avaliarMedicaoDetalhe(valor, car?.minimo, car?.maximo, tipoDeAvaliacao(car));
}

/** O valor gerado é aceitável? Precisa ser APROVADO pela regra oficial.
    `exigirFaixaSegura` cobra também o verde (visual 'ok'), sem o amarelo de
    "aprovado com atenção" — usado como preferência, não como bloqueio. */
export function valorConforme(car, valor, { exigirFaixaSegura = false } = {}) {
  const d = avaliar(car, valor);
  if (d.status !== MED.STATUS.APROVADO) return false;
  return exigirFaixaSegura ? d.visual === MED.VISUAL.OK : true;
}

/** Verificação final de uma característica já simulada: nenhuma medição pode
    ter sobrado reprovada. Devolve a lista de amostras ainda não conformes. */
export function amostrasNaoConformes(car) {
  return (car?.medicoes || [])
    .filter(m => avaliar(car, m.valor).status === MED.STATUS.REPROVADO)
    .map(m => m.amostra);
}

/** Diagnóstico legível de por que uma característica não pôde ser simulada.
    Sempre específico — "não foi possível" sem causa não ajuda ninguém. */
export function motivoImpossibilidade(car) {
  const temMin = MED.ehNumerico(car?.minimo), temMax = MED.ehNumerico(car?.maximo);
  if (!temMin && !temMax) return 'Característica reprovada sem limites cadastrados na Biblioteca Técnica.';
  if (temMin && temMax && MED.compararDecimal(car.minimo, car.maximo) >= 0)
    return `Limites inconsistentes na Biblioteca Técnica: mínimo ${car.minimo} não é menor que o máximo ${car.maximo}.`;
  return 'Não há valor conforme possível dentro dos limites cadastrados.';
}

/* --------------------------------------------------- ESTADO DA SIMULAÇÃO --- */

/** Consolida o estado de um relatório simulado.
    `completa` = toda reprovação virou valor conforme;
    `parcial`  = algo continuou fora de conformidade (medição não simulável ou
                 amostra nunca medida). Usado pela tela para avisar sem mentir. */
export function estadoDaSimulacao(caracteristicas = []) {
  const ajustadas = caracteristicas.filter(c => c._simulado);
  const impossiveis = caracteristicas.filter(c => c._simulacaoImpossivel);
  const pendentes = caracteristicas.filter(c => !c.informativo && c.resultado === 'pendente');
  const reprovadas = caracteristicas.filter(c => c.resultado === 'reprovado');
  return {
    caracteristicasAjustadas: ajustadas.length,
    medicoesAjustadas: ajustadas.reduce((s, c) => s + (c._medicoesAjustadas || 0), 0),
    impossiveis, pendentes, reprovadas,
    completa: !impossiveis.length && !reprovadas.length && !pendentes.length
  };
}
