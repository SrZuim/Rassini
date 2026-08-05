/* ==========================================================================
   RNA One — FECHAMENTO MENSAL · Apresentação da Qualidade (§35 a §41)
   ---------------------------------------------------------------------------
   Gera "Apresentação Qualidade Planta RJ — <Mês> <Ano>" a partir dos dados
   reais da competência. A estrutura de julho/2026 é o MODELO (18 seções, ordem
   configurável em fm_apres_secoes) — todo mês seguinte reusa a mesma forma com
   os números do período.

   Divisão de responsabilidades:
     montarSlides()  → modelo de dados de cada slide (puro, testável)
     validar()       → checklist ✓/⚠/✕ antes de gerar (§41)
     gerarPPTX()     → PowerPoint editável via PptxGenJS (CDN)
     gerarXLSX()     → memória de cálculo via SheetJS (CDN)
     gerarPDF()      → impressão do documento HTML da prévia (padrão do RNA One)

   §38 — nenhum gráfico é imagem estática: as séries saem do banco a cada
   geração. §37 — vírgula decimal, separador de milhar e moeda em real.
   ========================================================================== */
import { db } from '../db.js';
import { agoraISO, formatarDataHoraBrasil } from '../datahora.js';
import { MESES, podeFechamento, CRUZ_CORES, FAROL_QUEBRA } from './fm-schema.js';
import { FmErro, identidade, logar, obterCompetencia, config } from './fm-core.js';
import { consolidar, gerarResumo } from './fm-indicadores.js';
import * as PEND from './fm-pendencias.js';
import * as CALC from './fm-calc.js';

/* ---------------------------------------------------------------- estilo --- */
/* §37 — identidade visual Rassini NHK, igual à do resto do RNA One. */
export const TEMA = {
  grafite: '1B1D21', amarelo: 'F4C20D', aco: '3A3F45', cinza: '6B7178',
  branco: 'FFFFFF', claro: 'F4F6F8', borda: 'E3E7EB',
  verde: '22A85A', vermelho: 'E23B3B', azul: '2F74D0', laranja: 'FF7A00'
};

const nf = (v, casas = 0) => v == null ? '—'
  : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
const moeda = v => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = v => v == null ? '—' : `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

export function tituloApresentacao(competencia, versao = 'V0') {
  return `Apresentação Qualidade ${plantaCurta(competencia.planta)} - ${MESES[competencia.mes - 1]} ${competencia.ano} ${versao}`;
}
export function nomeArquivo(competencia, versao, ext) {
  return `${tituloApresentacao(competencia, versao)}.${ext}`;
}
export function nomeMemoria(competencia) {
  return `Memória de Cálculo Qualidade ${plantaCurta(competencia.planta)} - ${MESES[competencia.mes - 1]} ${competencia.ano}.xlsx`;
}
/** "Planta RJ - Lâminas" → "Planta RJ" (§39 usa o nome curto no arquivo). */
function plantaCurta(planta) {
  const m = String(planta || '').match(/^(Planta\s+\w+)/);
  return m ? m[1] : String(planta || 'Planta');
}

/* ========================================================================== */
/* 1. MODELO DOS SLIDES (§36) — puro                                           */
/* ========================================================================== */

/** Ordem oficial e configurável. Vem do banco; cai no padrão se ausente. */
export async function ordemSlides(planta) {
  try {
    const templates = await db.list('fm_apres_templates');
    const tpl = templates.find(t => t.padrao && t.ativo && (!t.planta || t.planta === planta))
             || templates.find(t => t.padrao) || templates[0];
    if (!tpl) return ORDEM_PADRAO;
    const secoes = (await db.list('fm_apres_secoes'))
      .filter(s => s.template_id === tpl.id && s.ativo !== false)
      .sort((a, b) => Number(a.ordem) - Number(b.ordem));
    return secoes.length ? secoes.map(s => ({ slug: s.slug, titulo: s.titulo, tipo: s.tipo })) : ORDEM_PADRAO;
  } catch {
    return ORDEM_PADRAO;
  }
}

export const ORDEM_PADRAO = [
  { slug: 'capa',              titulo: 'Capa',                                    tipo: 'capa' },
  { slug: 'reclamacoes_ppm',   titulo: 'Reclamações Externas e PPM Externo',      tipo: 'grafico' },
  { slug: 'negociadas_ppm',    titulo: 'Reclamações Negociadas e PPM Real',       tipo: 'grafico' },
  { slug: 'negociadas_det',    titulo: 'Detalhamento das Reclamações Negociadas', tipo: 'tabela' },
  { slug: 'comparativo_recl',  titulo: 'Comparativo de Reclamações',              tipo: 'grafico' },
  { slug: 'criterios_ppm',     titulo: 'Critérios do PPM Interno',                tipo: 'texto' },
  { slug: 'ocorrencias_ppm',   titulo: 'Ocorrências e PPM Interno',               tipo: 'grafico' },
  { slug: 'principais_probl',  titulo: 'Principais Problemas Internos',           tipo: 'ranking' },
  { slug: 'cruz_qualidade',    titulo: 'Cruz da Qualidade',                       tipo: 'cruz' },
  { slug: 'seguranca',         titulo: 'Segurança do Trabalho',                   tipo: 'tabela' },
  { slug: 'quebras_externas',  titulo: 'Farol de Quebras Externas',               tipo: 'farol' },
  { slug: 'quebras_internas',  titulo: 'Farol de Quebras Internas',               tipo: 'farol' },
  { slug: 'custos',            titulo: 'Custos da Qualidade',                     tipo: 'grafico' },
  { slug: 'melhoria_continua', titulo: 'Projetos de Melhoria Contínua',           tipo: 'tabela' },
  { slug: 'care_mensal',       titulo: 'Inspeção CARE — Mensal',                  tipo: 'grafico' },
  { slug: 'care_acumulada',    titulo: 'Inspeção CARE — Acumulada',               tipo: 'grafico' },
  { slug: 'plano_5w2h',        titulo: 'Plano de Ação 5W2H',                      tipo: 'tabela' },
  { slug: 'pendencias',        titulo: 'Pendências e Próximos Passos',            tipo: 'tabela' }
];

/**
 * Constrói o conteúdo de cada slide a partir do painel consolidado.
 * FUNÇÃO PURA — recebe painel + ordem, devolve os slides. É o que a prévia
 * mostra e o que o PPTX escreve: uma única fonte, sem divergência entre eles.
 */
export function montarSlides(painel, ordem = ORDEM_PADRAO, { resumo = null, observacoes = {} } = {}) {
  const c = painel.competencia;
  const d = painel.detalhes;
  const cards = painel.cards;
  const anual = painel.anual || {};
  const rodape = `${c.planta} · ${MESES[c.mes - 1]} ${c.ano} · Garantia da Qualidade`;

  const construtores = {

    capa: () => ({
      subtitulo: `${MESES[c.mes - 1]} ${c.ano}`,
      linhas: [
        ['Planta', c.planta],
        ['Competência', c.competencia || `${String(c.mes).padStart(2, '0')}/${c.ano}`],
        ['Área', 'Garantia da Qualidade'],
        ['Responsável', c.responsavel || '—'],
        ['Status', c.status]
      ],
      estado: 'atualizado'
    }),

    reclamacoes_ppm: () => ({
      indicadores: [
        card(cards.reclamacoes), card(cards.ppm_externo_oficial)
      ],
      grafico: {
        tipo: 'colunas+linha',
        titulo: 'Reclamações oficiais e PPM externo oficial por mês',
        labels: MESES.map(m => m.slice(0, 3)),
        series: [
          { nome: 'Reclamações oficiais', tipo: 'coluna', dados: serie(anual.reclamacoes) },
          { nome: 'PPM externo oficial',  tipo: 'linha',  dados: serie(anual.ppm_externo_oficial), eixo: 'direito' }
        ],
        meta: cards.ppm_externo_oficial.meta
      },
      memoria: cards.ppm_externo_oficial.memoria,
      estado: estadoPor(cards.ppm_externo_oficial)
    }),

    negociadas_ppm: () => ({
      indicadores: [card(cards.reclamacoes_negociadas), card(cards.ppm_externo_real)],
      comparativo: [
        ['PPM oficial', cards.ppm_externo_oficial.exibicao],
        ['PPM real', cards.ppm_externo_real.exibicao],
        ['Diferença absoluta', d.comparativoPPM.diferenca == null ? '—' : `${nf(d.comparativoPPM.diferenca)} PPM`],
        ['Diferença percentual', d.comparativoPPM.diferencaPercentual == null ? '—' : pct(d.comparativoPPM.diferencaPercentual)],
        ['Meta', cards.ppm_externo_real.meta == null ? 'Sem meta cadastrada' : `${nf(cards.ppm_externo_real.meta)} PPM`],
        ['Mês anterior', cards.ppm_externo_real.anterior == null ? '—' : nf(cards.ppm_externo_real.anterior)],
        ['Acumulado anual', anual.ppm_externo_real?.exibicao || '—']
      ],
      grafico: {
        tipo: 'colunas', titulo: 'PPM oficial × PPM real por mês',
        labels: MESES.map(m => m.slice(0, 3)),
        series: [
          { nome: 'PPM oficial', dados: serie(anual.ppm_externo_oficial) },
          { nome: 'PPM real',    dados: serie(anual.ppm_externo_real) }
        ]
      },
      memoria: cards.ppm_externo_real.memoria,
      estado: estadoPor(cards.ppm_externo_real)
    }),

    negociadas_det: () => {
      const linhas = painel.dados.reclamacoes.filter(r => r.negociada).map(r => [
        r.data_reclamacao ? br(r.data_reclamacao) : '—',
        r.cliente_oficial || r.cliente || '—',
        r.part_number || '—',
        nf(r.qtd_pecas),
        r.motivo_negociacao || '—',
        r.negociado_por || '—'
      ]);
      return {
        tabela: { cabecalho: ['Data', 'Cliente', 'Part Number', 'Peças', 'Motivo da negociação', 'Responsável'], linhas },
        vazio: 'Nenhuma reclamação negociada nesta competência.',
        estado: linhas.length ? 'atualizado' : 'sem_dados'
      };
    },

    comparativo_recl: () => ({
      grafico: {
        tipo: 'colunas', titulo: 'Comparativo mensal de reclamações',
        labels: MESES.map(m => m.slice(0, 3)),
        series: [
          { nome: 'Oficiais',   dados: serie(anual.reclamacoes) },
          { nome: 'Negociadas', dados: serie(anual.reclamacoes_negociadas) }
        ]
      },
      rankings: [
        { titulo: 'Por cliente', itens: d.rankings.cliente.slice(0, 5) }
      ],
      auxiliares: [
        ['Peças fornecidas no mês', nf(cards.ppm_externo_oficial.memoria?.denominador)],
        ['Peças fornecidas no ano', nf(anual.pecas_fornecidas?.soma)],
        ['Dias sem reclamação', cards.dias_sem_reclamacao.exibicao],
        ['Recorde histórico', d.diasSemReclamacao.recorde == null ? '—' : `${nf(d.diasSemReclamacao.recorde)} dias`]
      ],
      estado: 'atualizado'
    }),

    criterios_ppm: () => {
      const cr = painel.criterio;
      return {
        texto: cr ? [
          ['Critério vigente', cr.nome],
          ['Vigência', `${br(cr.vigencia_inicio)} a ${cr.vigencia_fim ? br(cr.vigencia_fim) : 'em aberto'}`],
          ['Versão', String(cr.versao || 1)],
          ['Fontes incluídas', (cr.fontes_incluidas || []).join(' · ') || '—'],
          ['Fontes excluídas', (cr.fontes_excluidas || []).join(' · ') || '—'],
          ['Fórmula', 'PPM interno = peças NG consideradas ÷ peças fabricadas × 1.000.000'],
          ['Descrição', cr.descricao || '—']
        ] : [['Critério vigente', 'Nenhum critério cadastrado para esta competência.']],
        estado: cr ? 'atualizado' : 'alerta'
      };
    },

    ocorrencias_ppm: () => ({
      indicadores: [card(cards.ocorrencias), card(cards.ppm_interno)],
      grafico: {
        tipo: 'colunas+linha', titulo: 'Ocorrências internas e PPM interno por mês',
        labels: MESES.map(m => m.slice(0, 3)),
        series: [
          { nome: 'Ocorrências', tipo: 'coluna', dados: serie(anual.ocorrencias) },
          { nome: 'PPM interno', tipo: 'linha',  dados: serie(anual.ppm_interno), eixo: 'direito' }
        ],
        meta: cards.ppm_interno.meta
      },
      auxiliares: [
        ['Peças fabricadas no mês', nf(cards.ppm_interno.memoria?.denominador)],
        ['Peças NG consideradas', nf(cards.ppm_interno.memoria?.numerador)],
        ['PPM interno acumulado', anual.ppm_interno?.exibicao || '—']
      ],
      memoria: cards.ppm_interno.memoria,
      estado: estadoPor(cards.ppm_interno)
    }),

    principais_probl: () => ({
      rankings: [
        { titulo: 'Tipo de defeito (peças NG)', itens: d.rankings.defeito.slice(0, 5) },
        { titulo: 'Part Number (reincidência)', itens: d.rankings.partNumber.slice(0, 5), campo: 'ocorrencias' },
        { titulo: 'Linha (peças NG)',           itens: d.rankings.linha.slice(0, 5) },
        { titulo: 'Processo (peças NG)',        itens: d.rankings.processo.slice(0, 5) }
      ],
      pareto: {
        titulo: 'Pareto dos defeitos',
        labels: d.rankings.defeito.slice(0, 8).map(x => x.chave),
        dados: d.rankings.defeito.slice(0, 8).map(x => x.valor)
      },
      vazio: 'Nenhuma ocorrência interna registrada nesta competência.',
      estado: d.rankings.defeito.length ? 'atualizado' : 'sem_dados'
    }),

    cruz_qualidade: () => ({
      cruz: {
        mes: c.mes, ano: c.ano,
        dias: d.cruz.dias.map(x => ({ dia: x.dia, status: x.status, motivo: x.motivo,
                                      ocorrencias: x.ocorrencias, pecasNG: x.pecasNG })),
        legenda: Object.entries(CRUZ_CORES).map(([k, v]) => ({ status: k, label: v.label }))
      },
      auxiliares: [
        ['Dias sem ocorrência', nf(d.cruz.estatisticas.diasSemOcorrencia)],
        ['Maior sequência sem ocorrência', `${nf(d.cruz.estatisticas.maiorSequencia)} dias`],
        ['Dias amarelos', nf(d.cruz.estatisticas.amarelos)],
        ['Dias vermelhos', nf(d.cruz.estatisticas.vermelhos)],
        ['Dias críticos', nf(d.cruz.estatisticas.criticos)],
        ['Dias sem produção', nf(d.cruz.estatisticas.semProducao)],
        ['Percentual de dias conformes', pct(d.cruz.estatisticas.percentualConformes)]
      ],
      estado: 'atualizado'
    }),

    seguranca: () => {
      const porCategoria = ['RNA', 'Cliente', 'Fornecedor'].map(cat => {
        const rows = painel.dados.seguranca.filter(s => s.categoria === cat);
        return [cat, nf(CALC.soma(rows, 'quantidade')), String(rows.length)];
      });
      return {
        tabela: { cabecalho: ['Categoria', 'Ocorrências', 'Registros'], linhas: porCategoria },
        auxiliares: [
          ['Total no mês', nf(cards.seguranca_eventos.valor)],
          ['Acumulado do ano', nf(anual.seguranca_eventos?.soma)],
          ['Mês anterior', cards.seguranca_eventos.anterior == null ? '—' : nf(cards.seguranca_eventos.anterior)],
          ['Meta', cards.seguranca_eventos.meta == null ? 'Sem meta cadastrada' : nf(cards.seguranca_eventos.meta)]
        ],
        detalhe: painel.dados.seguranca.map(s => [
          br(s.data), s.categoria, s.local_evento || '—', s.descricao || '—',
          nf(s.quantidade), s.responsavel || '—', s.status || '—'
        ]),
        estado: painel.dados.seguranca.length ? 'atualizado' : 'sem_dados'
      };
    },

    quebras_externas: () => farolSlide(painel, 'externa'),
    quebras_internas: () => farolSlide(painel, 'interna'),

    custos: () => ({
      indicadores: [card(cards.custo_qualidade)],
      grafico: {
        tipo: 'colunas', titulo: 'Custo da qualidade por mês',
        labels: MESES.map(m => m.slice(0, 3)),
        series: [{ nome: 'Custo mensal', dados: serie(anual.custo_qualidade) }],
        meta: d.custo.limite
      },
      rosca: {
        titulo: 'Custo por categoria',
        labels: d.custo.porCategoria.map(x => x.chave),
        dados: d.custo.porCategoria.map(x => x.valor)
      },
      auxiliares: [
        ['Custo no mês', moeda(d.custo.valor)],
        ['Limite mensal', d.custo.limite == null ? 'Sem limite configurado' : moeda(d.custo.limite)],
        ['Acumulado do ano', moeda(anual.custo_qualidade?.soma)],
        ['Custo por peça produzida', d.custo.custoPorPeca == null ? 'Sem base de produção' : moeda(d.custo.custoPorPeca)],
        ['Projeção anual', projecaoAnual(anual.custo_qualidade, c.mes)]
      ],
      memoria: cards.custo_qualidade.memoria,
      estado: estadoPor(cards.custo_qualidade)
    }),

    melhoria_continua: () => {
      const concluidos = painel.dados.acoes.filter(a => a.status === 'Concluído');
      return {
        tabela: {
          cabecalho: ['Projeto / Ação', 'Responsável', 'Conclusão', 'Ganho previsto'],
          linhas: concluidos.map(a => [
            corta(a.what || a.problema, 60), a.who || '—', br(a.when_), a.how_much == null ? '—' : moeda(a.how_much)
          ])
        },
        vazio: 'Nenhum projeto de melhoria concluído nesta competência.',
        estado: concluidos.length ? 'atualizado' : 'sem_dados'
      };
    },

    care_mensal: () => ({
      indicadores: [card(cards.care_inspecoes), card(cards.care_percentual_ng)],
      auxiliares: [
        ['Total inspecionado', nf(d.care.totalInspecionado)],
        ['Total NG', nf(d.care.totalNG)],
        ['Percentual de NG', d.care.exibicaoPercentual],
        ['Principal problema', d.care.principalProblema || '—'],
        ['Part Number com maior reincidência', d.care.partNumberReincidente || '—']
      ],
      grafico: {
        tipo: 'barras', titulo: 'Ranking de defeitos — CARE',
        labels: d.care.rankingDefeitos.slice(0, 8).map(x => x.chave),
        series: [{ nome: 'Peças NG', dados: d.care.rankingDefeitos.slice(0, 8).map(x => x.valor) }]
      },
      memoria: cards.care_percentual_ng.memoria,
      vazio: 'Nenhuma inspeção CARE registrada nesta competência.',
      estado: d.care.inspecoes ? 'atualizado' : 'sem_dados'
    }),

    care_acumulada: () => ({
      grafico: {
        tipo: 'colunas+linha', titulo: 'CARE acumulado no ano',
        labels: MESES.map(m => m.slice(0, 3)),
        series: [{ nome: 'Inspeções', tipo: 'coluna', dados: serie(anual.care_inspecoes) }]
      },
      auxiliares: [
        ['Inspeções no ano', nf(anual.care_inspecoes?.soma)],
        ['Meses com registro', nf(anual.care_inspecoes?.meses)]
      ],
      estado: (anual.care_inspecoes?.soma || 0) ? 'atualizado' : 'sem_dados'
    }),

    plano_5w2h: () => {
      const abertas = painel.dados.acoes.filter(a => !['Concluído', 'Cancelado'].includes(a.status));
      return {
        tabela: {
          cabecalho: ['What', 'Why', 'Where', 'When', 'Who', 'How', 'How much', 'Status', '%'],
          linhas: painel.dados.acoes.map(a => [
            corta(a.what, 45), corta(a.why, 30), a.where_ || '—', br(a.when_),
            a.who || '—', corta(a.how, 30), a.how_much == null ? '—' : moeda(a.how_much),
            a.status, `${a.percentual || 0}%`
          ])
        },
        auxiliares: [
          ['Planos abertos', nf(abertas.length)],
          ['Planos atrasados', nf(cards.planos_atrasados.valor)],
          ['Vindos de meses anteriores', nf(painel.dados.acoes.filter(a =>
            a.competencia_origem_id && a.competencia_origem_id !== c.id).length)]
        ],
        vazio: 'Nenhum plano de ação registrado.',
        estado: painel.dados.acoes.length ? 'atualizado' : 'sem_dados'
      };
    },

    pendencias: () => {
      const abertas = painel.dados.pendencias.filter(p => p.status === 'Aberta');
      return {
        tabela: {
          cabecalho: ['Prioridade', 'Pendência', 'Módulo', 'Responsável', 'Prazo'],
          linhas: abertas.map(p => [
            p.prioridade, corta(p.titulo, 45), p.modulo || '—', p.responsavel || '—', p.prazo ? br(p.prazo) : '—'
          ])
        },
        resumo: resumo || gerarResumo(painel),
        vazio: 'Nenhuma pendência aberta — competência pronta para aprovação.',
        estado: abertas.length ? 'alerta' : 'atualizado'
      };
    }
  };

  return ordem.map((s, i) => {
    const construtor = construtores[s.slug];
    const conteudo = construtor ? construtor() : { estado: 'sem_dados', vazio: 'Seção sem construtor definido.' };
    return {
      numero: i + 1, slug: s.slug, titulo: s.titulo, tipo: s.tipo,
      planta: c.planta, mes: c.mes, ano: c.ano,
      periodo: `${MESES[c.mes - 1]} ${c.ano}`,
      area: 'Garantia da Qualidade',
      rodape,
      observacaoApresentador: observacoes[s.slug] || '',
      fonte: fontesDoSlide(s.slug),
      atualizadoEm: c.updated_at || c.created_at,
      ...conteudo
    };
  });
}

/* ---------------------------------------------------- auxiliares do modelo */

function card(c) {
  return {
    chave: c.chave, label: c.label, valor: c.exibicao, unidade: c.unidade,
    meta: c.meta == null ? null : nf(c.meta),
    anterior: c.anterior == null ? null : nf(c.anterior),
    variacao: c.variacao?.exibicao || '—',
    acumulado: c.acumulado?.exibicao || (c.acumulado?.soma != null ? nf(c.acumulado.soma) : '—'),
    status: c.status, tendencia: c.tendencia, origem: c.origem
  };
}

function estadoPor(c) {
  if (!c.calculavel) return 'sem_dados';
  if (c.status?.cor === 'vermelho') return 'alerta';
  return 'atualizado';
}

function serie(acumulado) {
  if (!acumulado?.serie) return Array(12).fill(null);
  return acumulado.serie.map(s => s.valor);
}

function farolSlide(painel, tipo) {
  const quebras = painel.dados.quebras.filter(q => q.tipo === tipo);
  return {
    tabela: {
      cabecalho: ['Part Number', 'Cliente', 'Qtd.', 'Data', 'Causa raiz', 'Responsável', 'Prazo', 'Farol'],
      linhas: quebras.map(q => [
        q.part_number || '—', q.cliente || '—', nf(q.quantidade), br(q.data_quebra),
        corta(q.causa_raiz || q.possivel_causa, 35), q.responsavel || '—', br(q.prazo),
        FAROL_QUEBRA[q.status]?.texto || q.status
      ])
    },
    farol: quebras.map(q => ({
      id: q.id, part_number: q.part_number, status: q.status,
      cor: FAROL_QUEBRA[q.status]?.cor || 'cinza',
      texto: FAROL_QUEBRA[q.status]?.texto || q.status
    })),
    auxiliares: [
      ['Total de quebras', nf(quebras.length)],
      ['Concluídas', nf(quebras.filter(q => q.status === 'Concluída').length)],
      ['Atrasadas', nf(quebras.filter(q => q.status === 'Atrasada').length)],
      ['Em análise', nf(quebras.filter(q => ['Em análise', 'Aguardando RNC', 'Aberta'].includes(q.status)).length)]
    ],
    vazio: `Nenhuma quebra ${tipo} registrada nesta competência.`,
    estado: quebras.length ? (quebras.some(q => q.status === 'Atrasada') ? 'alerta' : 'atualizado') : 'sem_dados'
  };
}

/** §37 — fonte dos dados, exibida de forma discreta no rodapé do slide. */
function fontesDoSlide(slug) {
  const M = {
    reclamacoes_ppm: 'RNA One · Fechamento Mensal → Indicadores Externos',
    negociadas_ppm: 'RNA One · Fechamento Mensal → Indicadores Externos',
    negociadas_det: 'RNA One · Fechamento Mensal → Indicadores Externos',
    comparativo_recl: 'RNA One · Fechamento Mensal → Indicadores Externos + Importação de Faturamento',
    criterios_ppm: 'RNA One · Configurações → Critérios do PPM Interno',
    ocorrencias_ppm: 'RNA One · Fechamento Mensal → Indicadores Internos',
    principais_probl: 'RNA One · Fechamento Mensal → Indicadores Internos',
    cruz_qualidade: 'RNA One · Fechamento Mensal → Cruz da Qualidade',
    seguranca: 'RNA One · Fechamento Mensal → Segurança do Trabalho',
    quebras_externas: 'RNA One · Fechamento Mensal → Farol de Quebras',
    quebras_internas: 'RNA One · Fechamento Mensal → Farol de Quebras',
    custos: 'RNA One · Fechamento Mensal → Custos da Qualidade',
    melhoria_continua: 'RNA One · Fechamento Mensal → Planos de Ação 5W2H',
    care_mensal: 'RNA One · Fechamento Mensal → Inspeção CARE',
    care_acumulada: 'RNA One · Fechamento Mensal → Inspeção CARE',
    plano_5w2h: 'RNA One · Fechamento Mensal → Planos de Ação 5W2H',
    pendencias: 'RNA One · Fechamento Mensal → Pendências'
  };
  return M[slug] || 'RNA One · Fechamento Mensal';
}

function projecaoAnual(acumulado, mesAtual) {
  if (!acumulado?.soma || !mesAtual) return '—';
  return moeda((acumulado.soma / mesAtual) * 12);
}

const br = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—';
const corta = (s, n) => {
  const t = String(s || '—');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

/* ========================================================================== */
/* 2. VALIDAÇÃO ANTES DA GERAÇÃO (§41)                                         */
/* ========================================================================== */

/**
 * Checklist ✓ Completo / ⚠ Alerta / ✕ Bloqueio.
 * Bloqueio impede APENAS a versão FINAL — a preliminar existe justamente para
 * circular enquanto as pendências são resolvidas (§41).
 */
export async function validar(competencia, painel = null) {
  const p = painel || await consolidar(competencia);
  const d = p.dados;
  const itens = [];
  const add = (nome, estado, detalhe) => itens.push({ nome, estado, detalhe });

  add('Indicadores externos completos',
    d.reclamacoes.length ? 'ok' : 'alerta',
    d.reclamacoes.length ? `${d.reclamacoes.length} reclamação(ões) registrada(s).`
                         : 'Nenhuma reclamação lançada — confirme se o mês foi realmente sem reclamações.');

  add('Indicadores internos completos',
    d.ocorrencias.length ? 'ok' : 'alerta',
    d.ocorrencias.length ? `${d.ocorrencias.length} ocorrência(s) registrada(s).`
                         : 'Nenhuma ocorrência interna lançada.');

  const fabricadas = CALC.soma(d.producao, 'qtd_fabricada');
  add('Quantidade produzida informada', fabricadas ? 'ok' : 'bloqueio',
    fabricadas ? `${nf(fabricadas)} peças fabricadas.` : 'Sem base de produção: o PPM interno não pode ser calculado.');

  const fornecidas = CALC.soma(d.fornecimento, 'qtd_fornecida');
  add('Quantidade fornecida informada', fornecidas ? 'ok' : 'bloqueio',
    fornecidas ? `${nf(fornecidas)} peças fornecidas.` : 'Sem base de fornecimento: o PPM externo não pode ser calculado.');

  add('Custos preenchidos', d.custos.length ? 'ok' : 'alerta',
    d.custos.length ? `${d.custos.length} lançamento(s) · ${moeda(CALC.soma(d.custos, 'valor'))}.`
                    : 'Nenhum custo da qualidade lançado no mês.');

  add('CARE atualizado', d.care.length ? 'ok' : 'alerta',
    d.care.length ? `${d.care.length} inspeção(ões).` : 'Nenhuma inspeção CARE registrada.');

  const quebrasPendentes = d.quebras.filter(q => !['Concluída', 'Cancelada'].includes(q.status));
  add('Quebras atualizadas', quebrasPendentes.length ? 'alerta' : 'ok',
    quebrasPendentes.length ? `${quebrasPendentes.length} quebra(s) ainda em tratativa.` : 'Nenhuma quebra pendente.');

  const planosSemPrazo = d.acoes.filter(a => !['Concluído', 'Cancelado'].includes(a.status) && !a.when_);
  add('Planos de ação atualizados', planosSemPrazo.length ? 'alerta' : 'ok',
    planosSemPrazo.length ? `${planosSemPrazo.length} plano(s) sem prazo definido.`
                          : `${d.acoes.length} plano(s) no acompanhamento.`);

  const semCliente = d.fornecimento.filter(f => !f.cliente_oficial);
  add('Clientes associados', semCliente.length ? 'bloqueio' : 'ok',
    semCliente.length ? `${semCliente.length} registro(s) de fornecimento sem cliente oficial associado.`
                      : 'Todos os registros estão associados ao cadastro oficial.');

  const importacoes = (await db.list('fm_importacoes').catch(() => []))
    .filter(i => i.competencia_id === competencia.id && !i.deleted_at);
  const comErro = importacoes.filter(i => i.status === 'Com erros');
  add('Importações validadas',
    comErro.length ? 'bloqueio' : (importacoes.length ? 'ok' : 'alerta'),
    comErro.length ? `${comErro.length} importação(ões) com erro não resolvido.`
      : importacoes.length ? `${importacoes.length} importação(ões), última na versão V${importacoes[0]?.versao}.`
      : 'Nenhuma importação de faturamento nesta competência.');

  const semMeta = ['ppm_externo_oficial', 'ppm_externo_real', 'ppm_interno', 'custo_qualidade']
    .filter(ind => !CALC.metaVigente(d.metas, ind, { planta: competencia.planta, ano: competencia.ano }));
  add('Metas cadastradas', semMeta.length ? 'alerta' : 'ok',
    semMeta.length ? `Sem meta vigente para: ${semMeta.join(', ')}.` : 'Todas as metas principais estão cadastradas.');

  const bloqueios = await PEND.bloqueios(competencia.id);
  add('Pendências críticas resolvidas', bloqueios.length ? 'bloqueio' : 'ok',
    bloqueios.length ? `${bloqueios.length} pendência(s) bloqueante(s): ${bloqueios.slice(0, 3).map(b => b.titulo).join('; ')}${bloqueios.length > 3 ? '…' : ''}`
                     : 'Nenhuma pendência bloqueante em aberto.');

  const nBloqueios = itens.filter(i => i.estado === 'bloqueio').length;
  const nAlertas = itens.filter(i => i.estado === 'alerta').length;

  return {
    itens, bloqueios: nBloqueios, alertas: nAlertas,
    completos: itens.filter(i => i.estado === 'ok').length,
    podeGerarPreliminar: true,                    // §41 — preliminar nunca é bloqueada
    podeGerarFinal: nBloqueios === 0,
    motivoBloqueio: nBloqueios
      ? `Existem ${nBloqueios} bloqueio(s) que impedem a versão FINAL. A versão preliminar continua disponível.`
      : null
  };
}

/* ========================================================================== */
/* 3. VERSÕES (§40)                                                            */
/* ========================================================================== */

export const VERSOES = {
  V0: { label: 'V0 — Preliminar', preliminar: true },
  V1: { label: 'V1 — Revisada', preliminar: true },
  V2: { label: 'V2 — Revisada novamente', preliminar: true },
  FINAL: { label: 'FINAL — Aprovada e fechada', preliminar: false }
};
export const MARCA_PRELIMINAR = 'VERSÃO PRELIMINAR';

/** Próxima versão sugerida: V0 → V1 → V2 → V3… e FINAL só após aprovação. */
export async function proximaVersao(competencia_id, { final = false } = {}) {
  if (final) return 'FINAL';
  const rows = (await db.list('fm_apres_versoes').catch(() => []))
    .filter(v => v.competencia_id === competencia_id);
  const numeros = rows.map(v => Number(String(v.versao).replace(/\D/g, ''))).filter(Number.isFinite);
  const max = numeros.length ? Math.max(...numeros) : -1;
  return `V${max + 1}`;
}

export async function listarVersoes(competencia_id) {
  const rows = (await db.list('fm_apres_versoes').catch(() => []))
    .filter(v => v.competencia_id === competencia_id);
  const arquivos = (await db.list('fm_arquivos').catch(() => []))
    .filter(a => a.competencia_id === competencia_id);
  return rows
    .map(v => ({ ...v, arquivos: arquivos.filter(a => a.versao_id === v.id) }))
    .sort((a, b) => String(b.gerado_em).localeCompare(String(a.gerado_em)));
}

/* ========================================================================== */
/* 4. GERAÇÃO (§39)                                                            */
/* ========================================================================== */

/**
 * Gera a apresentação. Registra a versão, os arquivos e a trilha de auditoria.
 * @param {object} opts.formatos ex.: ['pptx','xlsx'] — 'pdf' abre a impressão
 */
export async function gerar(competencia, { versao = null, formatos = ['pptx'], observacoes = '', user, painel = null, observacoesSlides = {} } = {}) {
  if (!podeFechamento(user?.role, 'gerar')) {
    throw new FmErro('Somente Administrador ou Gestor da Qualidade pode gerar a apresentação.');
  }
  const comp = competencia?.id ? competencia : await obterCompetencia(competencia);
  if (!comp) throw new FmErro('Selecione uma competência.');

  const p = painel || await consolidar(comp);
  const check = await validar(comp, p);
  const v = versao || await proximaVersao(comp.id);
  const ehFinal = v === 'FINAL';

  if (ehFinal && !check.podeGerarFinal) {
    throw new FmErro(check.motivoBloqueio + ' Resolva os bloqueios em Pendências ou gere uma versão preliminar.');
  }
  if (ehFinal && !['Aprovado', 'Fechado'].includes(comp.status)) {
    throw new FmErro(`A versão FINAL só pode ser gerada após a aprovação (status atual: ${comp.status}).`);
  }

  const ordem = await ordemSlides(comp.planta);
  const slides = montarSlides(p, ordem, { resumo: gerarResumo(p), observacoes: observacoesSlides });
  const eu = identidade(user);

  const registro = await db.insert('fm_apres_versoes', {
    competencia_id: comp.id, versao: v, preliminar: !ehFinal,
    status: 'Gerada', observacoes: observacoes || null,
    resumo: { slides: slides.length, bloqueios: check.bloqueios, alertas: check.alertas },
    gerado_por_id: eu.id, gerado_por: eu.nome, gerado_em: agoraISO(),
    created_at: agoraISO()
  });

  const arquivos = [];
  for (const formato of formatos) {
    try {
      let info = null;
      if (formato === 'pptx') info = await gerarPPTX(comp, slides, v, { preliminar: !ehFinal });
      else if (formato === 'xlsx') info = await gerarXLSX(comp, p);
      else if (formato === 'pdf') info = { nome: nomeArquivo(comp, v, 'pdf'), via: 'impressao' };
      if (!info) continue;

      const arq = await db.insert('fm_arquivos', {
        competencia_id: comp.id, versao_id: registro.id, formato,
        nome: info.nome, url: null, path: null,
        tamanho: info.tamanho || null, hash: info.hash || null,
        gerado_por_id: eu.id, gerado_por: eu.nome, created_at: agoraISO()
      });
      arquivos.push({ ...arq, ...info });
    } catch (e) {
      console.error(`[FM] Falha ao gerar ${formato}:`, e);
      throw new FmErro(`A apresentação foi registrada, mas o arquivo ${formato.toUpperCase()} não pôde ser gerado: ${e.message}`, { causa: e });
    }
  }

  await logar({
    competencia_id: comp.id, tabela: 'fm_apres_versoes', registro_id: registro.id,
    acao: 'geracao', valor_novo: `${v} · ${formatos.join(', ')} · ${slides.length} slides`,
    justificativa: observacoes,
    usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });

  return { versao: registro, slides, arquivos, validacao: check };
}

/* ------------------------------------------------------------- PowerPoint */

/** §39 — PowerPoint EDITÁVEL (texto e tabelas reais, não imagem). */
export async function gerarPPTX(competencia, slides, versao, { preliminar = true } = {}) {
  const Pptx = globalThis.PptxGenJS;
  if (!Pptx) {
    throw new FmErro('A biblioteca de geração de PowerPoint (PptxGenJS) não carregou. Recarregue a página e tente novamente; se o problema persistir, gere o PDF.');
  }
  const pptx = new Pptx();
  pptx.layout = 'LAYOUT_WIDE';                 // 13,33 × 7,5 pol
  pptx.author = 'RNA One · Rassini NHK Automotive';
  pptx.company = 'Rassini NHK Automotive';
  pptx.title = tituloApresentacao(competencia, versao);

  const L = { x: 0.45, w: 12.43, topo: 1.05, base: 6.95 };

  for (const s of slides) {
    const slide = pptx.addSlide();
    slide.background = { color: TEMA.branco };

    if (s.slug === 'capa') {
      slide.background = { color: TEMA.grafite };
      slide.addText('Apresentação da Qualidade', {
        x: L.x, y: 2.0, w: L.w, h: 0.8, fontSize: 40, bold: true, color: TEMA.branco, align: 'center' });
      slide.addText(`${s.planta} · ${s.periodo}`, {
        x: L.x, y: 2.9, w: L.w, h: 0.5, fontSize: 22, color: TEMA.amarelo, align: 'center' });
      slide.addTable(
        (s.linhas || []).map(([k, v]) => [
          { text: k, options: { bold: true, color: TEMA.amarelo } },
          { text: String(v), options: { color: TEMA.branco } }
        ]),
        { x: 4.2, y: 3.9, w: 5.0, fontSize: 12, border: { type: 'none' }, fill: { color: TEMA.grafite } });
      slide.addText('Rassini NHK Automotive · RNA One', {
        x: L.x, y: 6.6, w: L.w, h: 0.3, fontSize: 10, color: TEMA.cinza, align: 'center' });
      if (preliminar) marcaDagua(slide, L);
      continue;
    }

    /* Cabeçalho padronizado (§37) */
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.33, h: 0.75, fill: { color: TEMA.grafite } });
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.75, w: 13.33, h: 0.06, fill: { color: TEMA.amarelo } });
    slide.addText(s.titulo, { x: L.x, y: 0.1, w: 8.6, h: 0.55, fontSize: 20, bold: true, color: TEMA.branco, valign: 'middle' });
    slide.addText(`${s.planta}  ·  ${s.periodo}  ·  ${s.area}`, {
      x: 9.1, y: 0.1, w: 3.8, h: 0.55, fontSize: 10.5, color: TEMA.amarelo, align: 'right', valign: 'middle' });

    let y = L.topo;

    /* Cartões de indicador */
    if (s.indicadores?.length) {
      const larg = Math.min(3.9, (L.w - (s.indicadores.length - 1) * 0.25) / s.indicadores.length);
      s.indicadores.forEach((ind, i) => {
        const x = L.x + i * (larg + 0.25);
        slide.addShape(pptx.ShapeType.roundRect, {
          x, y, w: larg, h: 1.25, fill: { color: TEMA.claro },
          line: { color: corDoStatus(ind.status?.cor), width: 2 }, rectRadius: 0.08 });
        slide.addText(ind.label, { x: x + 0.15, y: y + 0.08, w: larg - 0.3, h: 0.3, fontSize: 10, color: TEMA.cinza });
        slide.addText(String(ind.valor), { x: x + 0.15, y: y + 0.35, w: larg - 0.3, h: 0.5, fontSize: 24, bold: true, color: TEMA.grafite });
        slide.addText(
          `Meta: ${ind.meta ?? '—'}   ·   Mês anterior: ${ind.anterior ?? '—'}   ·   ${ind.status?.texto || ''}`,
          { x: x + 0.15, y: y + 0.88, w: larg - 0.3, h: 0.3, fontSize: 8.5, color: TEMA.cinza });
      });
      y += 1.5;
    }

    /* Gráfico nativo do PowerPoint — editável, não imagem (§38) */
    if (s.grafico && temSerie(s.grafico)) {
      const alturaGraf = s.auxiliares?.length ? 3.1 : 4.6;
      const dados = s.grafico.series.map(se => ({
        name: se.nome, labels: s.grafico.labels, values: (se.dados || []).map(v => v ?? 0)
      }));
      try {
        slide.addChart(tipoChart(pptx, s.grafico.tipo), dados, {
          x: L.x, y, w: s.rosca ? 8.2 : L.w, h: alturaGraf,
          showLegend: true, legendPos: 'b', showTitle: !!s.grafico.titulo, title: s.grafico.titulo || '',
          titleFontSize: 12, chartColors: [TEMA.amarelo, TEMA.azul, TEMA.verde, TEMA.laranja],
          catAxisLabelFontSize: 9, valAxisLabelFontSize: 9, dataLabelFontSize: 9,
          barGapWidthPct: 60
        });
        if (s.rosca && s.rosca.dados?.length) {
          slide.addChart(pptx.ChartType.doughnut,
            [{ name: s.rosca.titulo, labels: s.rosca.labels, values: s.rosca.dados }],
            { x: 8.8, y, w: 4.1, h: alturaGraf, showLegend: true, legendPos: 'b',
              holeSize: 55, showTitle: true, title: s.rosca.titulo, titleFontSize: 11,
              chartColors: [TEMA.amarelo, TEMA.azul, TEMA.verde, TEMA.laranja, TEMA.vermelho, TEMA.cinza] });
        }
        y += alturaGraf + 0.18;
      } catch (e) {
        console.warn('[FM] gráfico não pôde ser inserido:', e?.message);
      }
    }

    /* Cruz da Qualidade — grade dos dias com a cor do dia */
    if (s.cruz) {
      const cols = 16, cel = 0.42;
      s.cruz.dias.forEach((dia, i) => {
        const lin = Math.floor(i / cols), col = i % cols;
        slide.addShape(pptx.ShapeType.rect, {
          x: L.x + col * (cel + 0.04), y: y + lin * (cel + 0.04), w: cel, h: cel,
          fill: { color: corCruz(dia.status) }, line: { color: TEMA.borda, width: 0.5 } });
        slide.addText(String(Number(dia.dia.slice(8, 10))), {
          x: L.x + col * (cel + 0.04), y: y + lin * (cel + 0.04), w: cel, h: cel,
          fontSize: 9, align: 'center', valign: 'middle',
          color: ['preto', 'vermelho'].includes(dia.status) ? TEMA.branco : TEMA.grafite });
      });
      y += Math.ceil(s.cruz.dias.length / cols) * (cel + 0.04) + 0.15;
      slide.addText(
        s.cruz.legenda.map(l => `${simboloCruz(l.status)} ${l.label}`).join('    '),
        { x: L.x, y, w: L.w, h: 0.28, fontSize: 9, color: TEMA.cinza });
      y += 0.4;
    }

    /* Tabelas */
    const tabela = s.tabela;
    if (tabela?.linhas?.length) {
      const maxLinhas = Math.max(2, Math.floor((L.base - y - 0.4) / 0.26));
      const visiveis = tabela.linhas.slice(0, maxLinhas);
      slide.addTable([
        tabela.cabecalho.map(h => ({ text: h, options: { bold: true, color: TEMA.branco, fill: { color: TEMA.aco } } })),
        ...visiveis.map(l => l.map(c => ({ text: String(c ?? '—') })))
      ], {
        x: L.x, y, w: L.w, fontSize: 9.5, border: { type: 'solid', color: TEMA.borda, pt: 0.5 },
        autoPage: false, valign: 'middle', rowH: 0.24
      });
      y += (visiveis.length + 1) * 0.26 + 0.12;
      if (tabela.linhas.length > maxLinhas) {
        /* §37 "não cortar textos": em vez de truncar em silêncio, avisamos e o
           restante vai íntegro na memória de cálculo (XLSX). */
        slide.addText(`+ ${tabela.linhas.length - maxLinhas} linha(s) — lista completa na Memória de Cálculo (.xlsx)`,
          { x: L.x, y, w: L.w, h: 0.25, fontSize: 8.5, italic: true, color: TEMA.cinza });
        y += 0.3;
      }
    } else if (s.vazio && !s.indicadores?.length && !s.rankings?.length && !s.texto && !s.cruz) {
      slide.addText(s.vazio, { x: L.x, y: y + 0.6, w: L.w, h: 0.5, fontSize: 13, italic: true, color: TEMA.cinza, align: 'center' });
      y += 1.2;
    }

    /* Rankings */
    if (s.rankings?.length) {
      const larg = (L.w - (s.rankings.length - 1) * 0.2) / s.rankings.length;
      s.rankings.forEach((rk, i) => {
        const x = L.x + i * (larg + 0.2);
        slide.addText(rk.titulo, { x, y, w: larg, h: 0.28, fontSize: 11, bold: true, color: TEMA.grafite });
        const campo = rk.campo || 'valor';
        const linhas = rk.itens.length
          ? rk.itens.map(it => [
              { text: `${it.posicao}. ${corta(it.chave, 24)}` },
              { text: nf(it[campo]), options: { align: 'right' } }])
          : [[{ text: 'Sem registros', options: { italic: true, color: TEMA.cinza } }, { text: '' }]];
        slide.addTable(linhas, { x, y: y + 0.32, w: larg, fontSize: 9, border: { type: 'none' }, rowH: 0.22 });
      });
      y += 0.35 + Math.max(...s.rankings.map(r => Math.max(r.itens.length, 1))) * 0.22 + 0.2;
    }

    /* Blocos de texto/auxiliares (chave → valor) */
    const kv = s.texto || s.comparativo || s.auxiliares;
    if (kv?.length && y < L.base - 0.5) {
      slide.addTable(
        kv.map(([k, v]) => [
          { text: String(k), options: { bold: true, color: TEMA.aco } },
          { text: String(v), options: { color: TEMA.grafite } }]),
        { x: L.x, y, w: L.w, fontSize: 10, border: { type: 'none' }, rowH: 0.24 });
      y += kv.length * 0.25 + 0.1;
    }

    /* Resumo das atualizações (§33) */
    if (s.resumo?.length && y < L.base - 0.6) {
      slide.addText(s.resumo.map(t => `• ${t}`).join('\n'),
        { x: L.x, y, w: L.w, h: Math.min(1.4, s.resumo.length * 0.24), fontSize: 10, color: TEMA.grafite });
      y += Math.min(1.4, s.resumo.length * 0.24) + 0.1;
    }

    /* Observação do apresentador vai para as NOTAS, não para o slide */
    if (s.observacaoApresentador) slide.addNotes(s.observacaoApresentador);

    /* Rodapé: fonte discreta + número do slide (§37) */
    slide.addText(s.fonte, { x: L.x, y: 7.02, w: 9.0, h: 0.25, fontSize: 7.5, color: TEMA.cinza });
    slide.addText(`${s.rodape}  ·  ${s.numero}`, {
      x: 9.4, y: 7.02, w: 3.5, h: 0.25, fontSize: 7.5, color: TEMA.cinza, align: 'right' });

    if (preliminar) marcaDagua(slide, L);
  }

  const nome = nomeArquivo(competencia, versao, 'pptx');
  await pptx.writeFile({ fileName: nome });
  return { nome, formato: 'pptx' };
}

/** §40 — marca "VERSÃO PRELIMINAR"; a FINAL não recebe marca d'água. */
function marcaDagua(slide, L) {
  slide.addText(MARCA_PRELIMINAR, {
    x: L.x, y: 3.0, w: L.w, h: 1.2, fontSize: 54, bold: true,
    color: 'BFBFBF', align: 'center', rotate: 315, transparency: 78
  });
}

function tipoChart(pptx, tipo) {
  if (tipo === 'barras') return pptx.ChartType.bar;
  if (tipo === 'linha') return pptx.ChartType.line;
  return pptx.ChartType.bar;
}
function temSerie(g) {
  return g?.series?.some(s => (s.dados || []).some(v => v != null && v !== 0));
}
function corDoStatus(cor) {
  return { verde: TEMA.verde, amarelo: TEMA.amarelo, vermelho: TEMA.vermelho, azul: TEMA.azul, cinza: TEMA.borda }[cor] || TEMA.borda;
}
function corCruz(status) {
  return { verde: '22A85A', amarelo: 'F4C20D', vermelho: 'E23B3B', preto: '1B1D21', cinza: 'C9CED4' }[status] || 'C9CED4';
}
function simboloCruz(status) {
  return { verde: '■', amarelo: '■', vermelho: '■', preto: '■', cinza: '■' }[status] || '■';
}

/* -------------------------------------------------------- Memória (XLSX) */

/** §39 — Excel com a memória de cálculo de todos os indicadores. */
export async function gerarXLSX(competencia, painel) {
  const XLSXlib = globalThis.XLSX;
  if (!XLSXlib) {
    throw new FmErro('A biblioteca de planilhas (SheetJS) não carregou. Recarregue a página e tente novamente.');
  }
  const wb = XLSXlib.utils.book_new();

  /* Aba 1 — resumo dos indicadores */
  const resumo = [
    ['Apresentação Qualidade', `${competencia.planta} — ${MESES[competencia.mes - 1]} ${competencia.ano}`],
    ['Competência', competencia.competencia || `${String(competencia.mes).padStart(2, '0')}/${competencia.ano}`],
    ['Status', competencia.status],
    ['Gerado em', formatarDataHoraBrasil(agoraISO())],
    [],
    ['Indicador', 'Resultado', 'Meta', 'Mês anterior', 'Variação', 'Acumulado anual', 'Status', 'Origem']
  ];
  for (const c of Object.values(painel.cards)) {
    resumo.push([
      c.label, c.exibicao, c.meta ?? '—', c.anterior ?? '—',
      c.variacao?.exibicao || '—',
      c.acumulado?.exibicao || (c.acumulado?.soma != null ? c.acumulado.soma : '—'),
      c.status?.texto || '—', c.origem
    ]);
  }
  XLSXlib.utils.book_append_sheet(wb, XLSXlib.utils.aoa_to_sheet(resumo), 'Indicadores');

  /* Aba 2 — memória de cálculo detalhada */
  const mem = [['Indicador', 'Fórmula', 'Numerador', 'Denominador',
                'Resultado sem arredondamento', 'Resultado exibido',
                'Critério', 'Versão do critério', 'Data do cálculo']];
  const entradas = [['Indicador', 'Entrada', 'Valor']];
  for (const [chave, c] of Object.entries(painel.cards)) {
    if (!c.memoria) continue;
    const m = c.memoria;
    mem.push([c.label, m.formula, m.numerador ?? '—', m.denominador ?? '—',
              m.resultado_bruto ?? '—', m.resultado_exibido,
              m.criterio_nome || '—', m.criterio_versao || '—',
              formatarDataHoraBrasil(m.calculado_em)]);
    for (const [k, v] of Object.entries(m.entradas || {})) entradas.push([c.label, k, v]);
  }
  XLSXlib.utils.book_append_sheet(wb, XLSXlib.utils.aoa_to_sheet(mem), 'Memória de Cálculo');
  XLSXlib.utils.book_append_sheet(wb, XLSXlib.utils.aoa_to_sheet(entradas), 'Entradas');

  /* Abas 3+ — dados brutos que alimentaram cada cálculo */
  const abas = [
    ['Reclamações', painel.dados.reclamacoes], ['Ocorrências', painel.dados.ocorrencias],
    ['Produção', painel.dados.producao], ['Fornecimento', painel.dados.fornecimento],
    ['Custos', painel.dados.custos], ['CARE', painel.dados.care],
    ['Quebras', painel.dados.quebras], ['Segurança', painel.dados.seguranca],
    ['Retrabalho', painel.dados.retrabalho], ['Sucata', painel.dados.sucata],
    ['Planos 5W2H', painel.dados.acoes], ['Pendências', painel.dados.pendencias]
  ];
  for (const [nome, rows] of abas) {
    if (!rows?.length) continue;
    XLSXlib.utils.book_append_sheet(wb, XLSXlib.utils.json_to_sheet(rows), nome.slice(0, 31));
  }

  const nome = nomeMemoria(competencia);
  XLSXlib.writeFile(wb, nome);
  return { nome, formato: 'xlsx' };
}

/* ------------------------------------------------------------------- PDF */

/**
 * §39 — PDF pela impressão do documento HTML da prévia, que é o padrão já
 * usado nos relatórios do RNA One (consulta-dimensional, biblioteca). Mantém
 * uma única fonte visual entre o que se vê e o que se imprime.
 */
export function gerarPDF() {
  if (typeof window === 'undefined') throw new FmErro('A geração de PDF só está disponível no navegador.');
  window.print();
  return { via: 'impressao' };
}

/** Marca a versão como aprovada (§40). */
export async function aprovarVersao(versao_id, { user, observacoes = '' } = {}) {
  if (!podeFechamento(user?.role, 'aprovar')) {
    throw new FmErro('Somente Administrador ou Gestor da Qualidade pode aprovar a apresentação.');
  }
  const eu = identidade(user);
  const row = await db.update('fm_apres_versoes', versao_id, {
    status: 'Aprovada', aprovado_por: eu.nome, aprovado_em: agoraISO(),
    observacoes: observacoes || undefined
  });
  await logar({
    competencia_id: row?.competencia_id, tabela: 'fm_apres_versoes', registro_id: versao_id,
    acao: 'aprovacao_apresentacao', valor_novo: row?.versao, justificativa: observacoes,
    usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });
  return row;
}
