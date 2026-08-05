/* ==========================================================================
   RNA One — FECHAMENTO MENSAL · Dados semente (MODO DEMO)
   ---------------------------------------------------------------------------
   Espelha EXATAMENTE o seed de catálogos de database/fechamento_mensal.sql —
   metas, critério do PPM interno, configurações e template da apresentação.

   O que NÃO existe aqui: reclamação, ocorrência, produção, custo, CARE, quebra,
   competência ou qualquer RESULTADO. Nenhum indicador do módulo é alimentado
   por dado de demonstração (§1.11/§1.12): sem lançamento, o cálculo devolve
   "sem base" — nunca um número inventado.

   Consumido por services/db.js (baseSeed) para que o modo demo tenha as mesmas
   tabelas do Supabase.
   ========================================================================== */

const ANO = new Date().getFullYear();

/* Critério vigente do PPM interno (§13) — igual ao seed 23.1 do SQL. */
export const FM_CRITERIOS_DEFAULT = [{
  id: 'fmcrit-ppm-interno-v1',
  indicador: 'ppm_interno',
  nome: 'Critério padrão — PPM interno',
  descricao: 'Numerador: ocorrências internas detectadas na planta. Não inclui reclamações do cliente (que compõem o PPM externo).',
  vigencia_inicio: '2026-01-01', vigencia_fim: null, planta: null,
  fontes_incluidas: [
    'Auditoria de produto', 'Auditoria dimensional', 'Contenção interna', 'CARE',
    'Muro da Qualidade', 'Produção', 'Quebra interna', 'Sucata', 'Retrabalho'
  ],
  fontes_excluidas: ['Contenção no cliente', 'Devolução de cliente'],
  status: 'Ativo',
  aprovado_por: null, aprovado_em: null,
  justificativa: 'Critério inicial cadastrado na implantação do módulo.',
  versao: 1
}];

/* Metas iniciais (§31) — igual ao seed 23.2. Editáveis em Configurações → Metas. */
export const FM_METAS_DEFAULT = [
  ['ppm_externo_oficial',    50, 'PPM'],
  ['ppm_externo_real',       80, 'PPM'],
  ['ppm_interno',          1500, 'PPM'],
  ['reclamacoes',             2, 'un'],
  ['custo_qualidade',     28000, 'BRL'],
  ['care_percentual_ng',      1, '%'],
  ['seguranca_eventos',       0, 'un'],
  ['quebras_externas',        0, 'un'],
  ['quebras_internas',        0, 'un']
].map(([indicador, valor, unidade], i) => ({
  id: `fmmeta-${indicador}`,
  indicador, planta: null, cliente: null, ano: ANO,
  valor, valor_max: null, unidade, comparacao: '<=',
  data_inicial: `${ANO}-01-01`, data_final: `${ANO}-12-31`,
  status: 'Ativo', responsavel: 'Garantia da Qualidade'
}));

/* Configurações por planta (§16/§19/§20/§27) — igual ao seed 23.3. */
export const FM_CONFIG_DEFAULT = [
  {
    id: 'fmcfg-cruz', planta: null, chave: 'cruz_regras',
    valor: {
      amarelo_min_ocorrencias: 1,
      vermelho_min_ocorrencias: 1,
      vermelho_min_pecas: 10,
      preto_quebra: true,
      preto_min_pecas: 100
    },
    descricao: 'Regras de cor da Cruz da Qualidade (§16) — editáveis pelo administrador.'
  },
  {
    id: 'fmcfg-custo', planta: null, chave: 'custo_limite_mensal',
    valor: { valor: 28000, moeda: 'BRL' },
    descricao: 'Limite mensal do custo da qualidade (§19).'
  },
  {
    id: 'fmcfg-retr', planta: null, chave: 'retrabalho_modo',
    valor: { modo: 'ppm' },
    descricao: 'Índice de retrabalho apresentado em "ppm" ou "percentual" (§20).'
  },
  {
    id: 'fmcfg-imp', planta: null, chave: 'import_variacao_alerta',
    valor: { percentual: 10 },
    descricao: 'Percentual de variação entre versões de importação que gera alerta (§27).'
  }
];

/* Template da apresentação (§36) — 18 seções na ordem oficial (seed 23.4). */
export const FM_APRES_TEMPLATE_DEFAULT = [{
  id: 'fmtpl-padrao',
  nome: 'Apresentação Qualidade — Planta RJ',
  planta: 'Planta RJ - Lâminas',
  descricao: 'Modelo estrutural derivado da apresentação de julho/2026.',
  ativo: true, padrao: true
}];

export const FM_APRES_SECOES_DEFAULT = [
  ['capa',             'Capa',                                    1,  'capa'],
  ['reclamacoes_ppm',  'Reclamações Externas e PPM Externo',      2,  'grafico'],
  ['negociadas_ppm',   'Reclamações Negociadas e PPM Real',       3,  'grafico'],
  ['negociadas_det',   'Detalhamento das Reclamações Negociadas', 4,  'tabela'],
  ['comparativo_recl', 'Comparativo de Reclamações',              5,  'grafico'],
  ['criterios_ppm',    'Critérios do PPM Interno',                6,  'texto'],
  ['ocorrencias_ppm',  'Ocorrências e PPM Interno',               7,  'grafico'],
  ['principais_probl', 'Principais Problemas Internos',           8,  'ranking'],
  ['cruz_qualidade',   'Cruz da Qualidade',                       9,  'cruz'],
  ['seguranca',        'Segurança do Trabalho',                   10, 'tabela'],
  ['quebras_externas', 'Farol de Quebras Externas',               11, 'farol'],
  ['quebras_internas', 'Farol de Quebras Internas',               12, 'farol'],
  ['custos',           'Custos da Qualidade',                     13, 'grafico'],
  ['melhoria_continua','Projetos de Melhoria Contínua',           14, 'tabela'],
  ['care_mensal',      'Inspeção CARE — Mensal',                  15, 'grafico'],
  ['care_acumulada',   'Inspeção CARE — Acumulada',               16, 'grafico'],
  ['plano_5w2h',       'Plano de Ação 5W2H',                      17, 'tabela'],
  ['pendencias',       'Pendências e Próximos Passos',            18, 'tabela']
].map(([slug, titulo, ordem, tipo]) => ({
  id: `fmsec-${slug}`, template_id: 'fmtpl-padrao', slug, titulo, ordem, tipo,
  ativo: true, obrigatorio: true, config: {}
}));

/* Aliases de clientes (§25).
   Em produção o seed vem de bib_clientes (lista oficial já mantida pela
   Biblioteca Técnica). No modo demo a tabela nasce VAZIA e é populada em tempo
   de execução por fm-clientes.js a partir da mesma fonte — não duplicamos a
   lista de 54 clientes aqui para não criar uma segunda fonte de verdade. */
export const FM_CLIENTES_ALIAS_DEFAULT = [];

/* ------------------------------------------------------------------------ */
/* Conjunto completo de tabelas do módulo para o modo demo.
   Tabelas de LANÇAMENTO nascem vazias — é o que garante que o dashboard
   mostre "sem dados" em vez de números falsos até alguém lançar. */
export const FECHAMENTO = {
  fm_competencias:    [],
  fm_secoes:          [],
  fm_status_hist:     [],
  fm_reclamacoes:     [],
  fm_ocorrencias:     [],
  fm_producao:        [],
  fm_fornecimento:    [],
  fm_criterios:       FM_CRITERIOS_DEFAULT,
  fm_metas:           FM_METAS_DEFAULT,
  fm_resultados:      [],
  fm_custos:          [],
  fm_retrabalho:      [],
  fm_sucata:          [],
  fm_care:            [],
  fm_quebras:         [],
  fm_seguranca:       [],
  fm_acoes:           [],
  fm_acao_updates:    [],
  fm_cruz_dias:       [],
  fm_pendencias:      [],
  fm_importacoes:     [],
  fm_import_linhas:   [],
  fm_import_versoes:  [],
  fm_clientes_alias:  FM_CLIENTES_ALIAS_DEFAULT,
  fm_apres_templates: FM_APRES_TEMPLATE_DEFAULT,
  fm_apres_secoes:    FM_APRES_SECOES_DEFAULT,
  fm_apres_versoes:   [],
  fm_arquivos:        [],
  fm_memoria:         [],
  fm_ajustes:         [],
  fm_config:          FM_CONFIG_DEFAULT,
  fm_logs:            []
};
