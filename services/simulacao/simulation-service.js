/* ==========================================================================
   RNA One — SimulationService (Rel. Dimensionais Simulados)
   ÚNICA responsabilidade: ser a PORTA de entrada do módulo simulado. A tela
   fala só com este arquivo; ele lê o relatório oficial (services/inspecao.js),
   entrega ao SimulationEngine e devolve o objeto simulado.

   ------------------------------------------------------------ SEM 2ª BASE
   Não existe tabela de relatórios simulados. Nada é inserido, atualizado ou
   removido — este módulo é ESTRITAMENTE de leitura. A simulação nasce e morre
   na memória da consulta; fechar a tela não deixa rastro no banco.
   Anexos, imagens e histórico não são copiados: o relatório simulado aponta
   para os mesmos registros oficiais, em modo leitura.

   ---------------------------------------------------------------- LEITURAS
   Listagem  → INSP.consultarRelatorios (mesmos filtros e o mesmo escopo por
               perfil do módulo oficial) + uma varredura de características
               para saber quais reprovações são simuláveis.
   Abertura  → INSP.carregarRelatorio + estado das peças, uma vez, sob demanda.
   Nenhuma medição é lida na listagem: o custo por linha continua o do módulo
   oficial.
   ========================================================================== */
import { db } from '../db.js';
import * as INSP from '../inspecao.js';
import * as MED from '../medicao.js';
import * as AMOSTRAS from '../insp-amostras.js';
import { simularRelatorio, statusSimulado } from './simulation-engine.js';
import * as VALID from './simulation-validator.js';

export const SELO = 'SIMULADO';
export const AVISO_TOPO = 'Dados gerados automaticamente para fins de simulação. Não substitui o relatório oficial.';

/* ============================================================== LISTAGEM ====
   O resultado exibido é o SIMULADO, então o filtro "Resultado" precisa ser
   aplicado DEPOIS da simulação — filtrar por "Aprovado" no banco traria só os
   que já eram aprovados e esconderia justamente os reprovados que a simulação
   aprova. Os demais filtros (cliente, PN, período, classe...) continuam valendo
   sobre o dado oficial, que é o que identifica o relatório. */
export async function consultarSimulados(filtros = {}, escopo = {}) {
  const { resultado: filtroResultado, status: filtroStatus, ...demais } = filtros || {};
  const rows = await INSP.consultarRelatorios(demais, escopo);
  const simulavel = await mapaDeSimulabilidade();
  return rows
    .map(r => linhaSimulada(r, simulavel))
    .filter(r => !filtroResultado || r.resultado === filtroResultado)
    .filter(r => !filtroStatus || r.status === filtroStatus);
}

/** Converte UMA linha da consulta oficial na sua versão simulada.
    Reprovado vira aprovado, some a contagem de reprovações e a classe — porque
    é isso que o relatório simulado mostra quando aberto. Aprovado e em
    andamento passam intactos (requisito: "mostrar exatamente como está"). */
export function linhaSimulada(r, simulavel = null) {
  if (!VALID.relatorioPrecisaSimulacao(r)) return { ...r, _simulado: false };
  /* Se alguma reprovação NÃO for simulável (cadastro sem limites, limites
     invertidos), a linha continua reprovada — a listagem nunca promete um
     "Aprovado" que a tela do relatório não vai confirmar. */
  const pendencia = simulavel ? simulavel.get(r.id) : null;
  if (pendencia?.length) {
    return { ...r, _simulado: true, _simulacaoParcial: true, _cotasNaoSimulaveis: pendencia };
  }
  return {
    ...r,
    resultado: 'aprovado',
    status: statusSimulado(r.status, 'aprovado'),
    _reprovacoes: 0, _maiorClasse: null,
    _simulado: true, _resultadoOriginal: r.resultado, _statusOriginal: r.status,
    _reprovacoesOriginais: r._reprovacoes, _maiorClasseOriginal: r._maiorClasse
  };
}

/* Varredura única de insp_caracteristicas: para cada relatório, quais cotas
   reprovadas NÃO têm como receber um valor conforme. Depende apenas dos limites
   cadastrados — por isso não precisa ler nenhuma medição.
   Falha na leitura não derruba a consulta: sem o mapa, a listagem segue o
   caminho otimista e a tela do relatório continua sendo a fonte da verdade. */
async function mapaDeSimulabilidade() {
  try {
    const cars = await db.list('insp_caracteristicas');
    const mapa = new Map();
    cars.forEach(raw => {
      const c = INSP.normalizarCaracteristica(raw);
      if (c.resultado !== 'reprovado' || c.informativo) return;
      if (simulavel(c)) return;
      const lista = mapa.get(c.relatorio_id) || [];
      lista.push(c.cota ?? '—');
      mapa.set(c.relatorio_id, lista);
    });
    return mapa;
  } catch (e) {
    console.warn('[SIMULACAO] Varredura de características indisponível:', e?.message || e);
    return null;
  }
}

/** Existe algum desfecho conforme para esta característica? Decisão tomada SEM
    ler medições — só com o que está cadastrado.

    Um único caso é realmente insolúvel: os dois limites presentes com o mínimo
    maior ou igual ao máximo — não existe número que satisfaça os dois.

    Atenção ao caso "sem limites nenhum": ele parece insimulável, mas NÃO é.
    O motor oficial (medicao.js) não reprova o que não tem limite — uma cota
    assim aparece como reprovada apenas quando o `resultado` GRAVADO ficou de
    uma regra antiga, e a leitura derivada (derivarResultados, §Erro 01) já a
    devolve aprovada. Marcá-la aqui faria a listagem exibir "simulação parcial"
    para um relatório que abre 100% aprovado. */
function simulavel(c) {
  if (c.tipo_especificacao === 'ATRIBUTO' || (Array.isArray(c.opcoes) && c.opcoes.length)) return true;
  const temMin = MED.ehNumerico(c.minimo), temMax = MED.ehNumerico(c.maximo);
  if (temMin && temMax) return MED.compararDecimal(c.minimo, c.maximo) < 0;
  return true;
}

/* ======================================================== ABRIR RELATÓRIO ==
   Carrega o relatório OFICIAL e devolve a versão simulada. O objeto oficial não
   é alterado nem regravado: `reparar` fica desligado de propósito, para que
   abrir a simulação jamais dispare uma correção de dados na base real. */
export async function carregarSimulado(relatorioId) {
  const dados = await INSP.carregarRelatorio(relatorioId, { reparar: false });
  if (!dados) return null;
  const amostras = await AMOSTRAS.estadoAmostras(relatorioId, dados.rel.quantidade).catch(() => []);
  return simularRelatorio(dados, { amostras });
}

/** Histórico oficial do relatório (somente leitura, exibido como registro do
    original). Isolado aqui para a tela não precisar conhecer o inspecao.js. */
export async function historicoOficial(relatorioId) {
  return INSP.historicoDe(relatorioId).catch(() => []);
}

export { VALID as validador };
