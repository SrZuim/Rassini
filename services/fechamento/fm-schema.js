/* ==========================================================================
   RNA One — FECHAMENTO MENSAL · SCHEMA DECLARATIVO (fonte única)
   ---------------------------------------------------------------------------
   Este arquivo descreve o DOMÍNIO do módulo em dados, não em código:
   seções, campos, tipos, opções, obrigatoriedade, status e cores.

   Quem consome:
     • fm-registros.js  → CRUD genérico (valida e normaliza pelo spec)
     • fechamento-mensal.js → gera formulários e tabelas sem HTML duplicado
     • fm-pendencias.js → sabe quais campos são obrigatórios em cada seção
     • fm-apresentacao.js → rótulos e formatos dos slides

   REGRA: nenhuma constante de domínio pode nascer numa página. Se um campo,
   status ou cor precisa mudar, muda AQUI e todas as telas acompanham.

   Não importa nada do navegador — é puro, e por isso testável no Node.
   ========================================================================== */
import { PLANTAS, TURNOS } from '../config.js';

/* ----------------------------------------------------------------- status ---
   §4 — status da competência, na ordem do ciclo de vida. */
export const STATUS_COMPETENCIA = [
  'Não iniciado', 'Em preenchimento', 'Aguardando informações', 'Em revisão',
  'Devolvido para correção', 'Aguardando aprovação', 'Aprovado', 'Fechado',
  'Reaberto', 'Cancelado'
];

export const STATUS_COMPETENCIA_DESC = {
  'Não iniciado':            'Competência criada, mas ainda sem informações lançadas.',
  'Em preenchimento':        'Pelo menos uma seção foi iniciada.',
  'Aguardando informações':  'Existem dados obrigatórios pendentes.',
  'Em revisão':              'Enviada para o responsável da Garantia da Qualidade.',
  'Devolvido para correção': 'A revisão encontrou inconsistências.',
  'Aguardando aprovação':    'Revisão concluída, aguardando o gestor.',
  'Aprovado':                'O gestor aprovou os dados da competência.',
  'Fechado':                 'Versão final gerada — competência bloqueada para edição.',
  'Reaberto':                'Competência fechada que recebeu autorização formal de reabertura.',
  'Cancelado':               'Competência invalidada com justificativa.'
};

/* Cor/ícone de cada status (§6 — nunca só cor: sempre ícone + texto). */
export const STATUS_COMPETENCIA_UI = {
  'Não iniciado':            { cor: 'cinza',    icone: 'bi-circle' },
  'Em preenchimento':        { cor: 'azul',     icone: 'bi-pencil-square' },
  'Aguardando informações':  { cor: 'amarelo',  icone: 'bi-hourglass-split' },
  'Em revisão':              { cor: 'azul',     icone: 'bi-search' },
  'Devolvido para correção': { cor: 'vermelho', icone: 'bi-arrow-counterclockwise' },
  'Aguardando aprovação':    { cor: 'amarelo',  icone: 'bi-clock-history' },
  'Aprovado':                { cor: 'verde',    icone: 'bi-check2-circle' },
  'Fechado':                 { cor: 'verde',    icone: 'bi-lock-fill' },
  'Reaberto':                { cor: 'amarelo',  icone: 'bi-unlock' },
  'Cancelado':               { cor: 'cinza',    icone: 'bi-x-circle' }
};

/* Transições permitidas (§4/§42). O destino precisa estar na lista da origem.
   'Fechado' só sai por reabertura formal — por isso não lista destinos livres. */
export const TRANSICOES = {
  'Não iniciado':            ['Em preenchimento', 'Cancelado'],
  'Em preenchimento':        ['Aguardando informações', 'Em revisão', 'Cancelado'],
  'Aguardando informações':  ['Em preenchimento', 'Em revisão', 'Cancelado'],
  'Em revisão':              ['Devolvido para correção', 'Aguardando aprovação', 'Cancelado'],
  'Devolvido para correção': ['Em preenchimento', 'Em revisão', 'Cancelado'],
  'Aguardando aprovação':    ['Aprovado', 'Devolvido para correção', 'Cancelado'],
  'Aprovado':                ['Fechado', 'Devolvido para correção'],
  'Fechado':                 ['Reaberto'],
  'Reaberto':                ['Em preenchimento', 'Em revisão', 'Aguardando aprovação'],
  'Cancelado':               []
};

/** Uma transição é válida? Fonte única — front e serviço usam esta função. */
export function podeTransicionar(de, para) {
  if (de === para) return false;
  return (TRANSICOES[de] || []).includes(para);
}

/* Papéis do fechamento (§43) mapeados sobre os perfis REAIS do RNA One.
   Não criamos perfil novo: `supervisor` exerce o papel de Gestor da Qualidade. */
export const PAPEIS = {
  admin:      'Administrador',
  supervisor: 'Gestor da Qualidade',
  auditor:    'Auditor / Responsável de área',
  auditor_recebimento: 'Auditor / Responsável de área',
  eng_processos:       'Auditor / Responsável de área',
  laboratorio:         'Auditor / Responsável de área',
  visitante:  'Visitante'
};

/** §43/§44 — quem pode fazer o quê no fechamento. Espelha as funções SQL
    fm_is_admin / fm_is_gestor / fm_is_operacional: a interface nunca é a única
    barreira, mas também não deve oferecer o que o banco vai recusar. */
export const ACOES_FECHAMENTO = {
  configurar:   ['admin'],                                    // metas, critérios, slides, cruz
  importar:     ['admin', 'supervisor'],
  revisar:      ['admin', 'supervisor'],
  aprovar:      ['admin', 'supervisor'],
  fechar:       ['admin', 'supervisor'],
  reabrir:      ['admin'],
  excluir:      ['admin'],
  gerar:        ['admin', 'supervisor'],
  lancar:       ['admin', 'supervisor', 'auditor', 'auditor_recebimento', 'eng_processos', 'laboratorio'],
  ver:          ['admin', 'supervisor', 'auditor', 'auditor_recebimento', 'eng_processos', 'laboratorio', 'visitante']
};

export function podeFechamento(role, acao) {
  return (ACOES_FECHAMENTO[acao] || []).includes(role);
}

/* --------------------------------------------------------------- domínio --- */
export const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

export const ORIGENS_DADO = ['automatico', 'importado', 'manual', 'calculado'];
export const ORIGEM_DADO_LABEL = {
  automatico: 'Automático', importado: 'Importado', manual: 'Manual', calculado: 'Calculado'
};
export const ORIGEM_DADO_UI = {
  automatico: { icone: 'bi-lightning-charge', cor: 'azul' },
  importado:  { icone: 'bi-file-earmark-arrow-up', cor: 'azul' },
  manual:     { icone: 'bi-pencil', cor: 'cinza' },
  calculado:  { icone: 'bi-calculator', cor: 'verde' }
};

export const STATUS_RECLAMACAO = [
  'Aberta', 'Em contenção', 'Em análise', 'Em negociação', 'Aguardando cliente',
  'Aguardando evidência', 'Concluída', 'Cancelada'
];

export const ORIGENS_OCORRENCIA = [
  'Auditoria de produto', 'Auditoria dimensional', 'Contenção interna',
  'Contenção no cliente', 'CARE', 'Muro da Qualidade', 'Produção',
  'Devolução de cliente', 'Quebra interna', 'Sucata', 'Retrabalho', 'Outro'
];

export const FONTES_PRODUCAO = ['Importação', 'Integração', 'Lançamento manual', 'Cálculo'];

export const CATEGORIAS_CUSTO = [
  'Retrabalho', 'Sucata', 'Seleção', 'Contenção', 'Devolução', 'Frete', 'Garantia',
  'Laboratório', 'Reinspeção', 'Quebra', 'Concessão', 'Assistência ao cliente', 'Outro'
];

export const ETAPAS_PROCESSO = [
  'Operação anterior', 'Tratamento térmico', 'Operação posterior', 'Outro'
];

export const STATUS_QUEBRA = [
  'Aberta', 'Em contenção', 'Em análise', 'Aguardando RNC',
  'Plano de ação em andamento', 'Aguardando evidência', 'Concluída', 'Atrasada', 'Cancelada'
];

/* §18 — farol das quebras. Cor + rótulo + ícone (nunca só cor). */
export const FAROL_QUEBRA = {
  'Concluída':                    { cor: 'verde',    icone: 'bi-check-circle-fill', texto: 'Concluído' },
  'Em contenção':                 { cor: 'amarelo',  icone: 'bi-shield-exclamation', texto: 'Em andamento' },
  'Plano de ação em andamento':   { cor: 'amarelo',  icone: 'bi-diagram-3', texto: 'Em andamento' },
  'Aguardando evidência':         { cor: 'amarelo',  icone: 'bi-paperclip', texto: 'Em andamento' },
  'Atrasada':                     { cor: 'vermelho', icone: 'bi-exclamation-octagon-fill', texto: 'Atrasado' },
  'Em análise':                   { cor: 'azul',     icone: 'bi-search', texto: 'Aguardando análise' },
  'Aguardando RNC':               { cor: 'azul',     icone: 'bi-hourglass', texto: 'Aguardando análise' },
  'Aberta':                       { cor: 'azul',     icone: 'bi-circle', texto: 'Aguardando análise' },
  'Cancelada':                    { cor: 'cinza',    icone: 'bi-slash-circle', texto: 'Cancelado' }
};

export const CATEGORIAS_SEGURANCA = ['RNA', 'Cliente', 'Fornecedor'];

export const STATUS_ACAO = [
  'Não iniciado', 'Em andamento', 'Aguardando retorno', 'Aguardando evidência',
  'Concluído', 'Atrasado', 'Cancelado'
];
/** Ação "aberta" = ainda atravessa para o mês seguinte (§5/§23). */
export const ACAO_ABERTA = s => !['Concluído', 'Cancelado'].includes(s);

export const PRIORIDADES = ['Baixa', 'Média', 'Alta', 'Crítica'];

export const COMPARACOES = {
  '<=': 'Menor ou igual', '<': 'Menor que', '>=': 'Maior ou igual',
  '>': 'Maior que', '=': 'Igual', 'faixa': 'Faixa'
};

/* Fontes que podem compor o numerador do PPM interno (§13). */
export const FONTES_PPM_INTERNO = [
  'Reclamações oficiais', 'Reclamações negociadas', 'Auditoria de produto',
  'Auditoria dimensional', 'CARE', 'Contenção interna', 'Contenção no cliente',
  'Produção', 'Quebra interna', 'Sucata', 'Retrabalho', 'Devolução de cliente', 'Outro'
];

/* Cores da Cruz da Qualidade (§16). */
export const CRUZ_CORES = {
  verde:    { hex: '#22a85a', label: 'Sem ocorrência',        icone: 'bi-check' },
  amarelo:  { hex: '#F4C20D', label: 'Ocorrência leve',       icone: 'bi-exclamation' },
  vermelho: { hex: '#e23b3b', label: 'Ocorrência relevante',  icone: 'bi-x' },
  preto:    { hex: '#1b1d21', label: 'Quebra / crítica',      icone: 'bi-x-octagon' },
  cinza:    { hex: '#c9ced4', label: 'Sem produção / sem informação', icone: 'bi-dash' }
};

/* Cores de status dos indicadores (§6). */
export const CORES_INDICADOR = {
  verde:    { hex: '#22a85a', icone: 'bi-check-circle-fill',        texto: 'Dentro da meta' },
  amarelo:  { hex: '#F4C20D', icone: 'bi-exclamation-triangle-fill', texto: 'Próximo ao limite' },
  vermelho: { hex: '#e23b3b', icone: 'bi-x-octagon-fill',            texto: 'Fora da meta' },
  azul:     { hex: '#2f74d0', icone: 'bi-info-circle-fill',          texto: 'Em andamento' },
  cinza:    { hex: '#6b7178', icone: 'bi-dash-circle',               texto: 'Sem dados' }
};

/* ================================================================= CAMPOS ===
   Cada seção declara seus campos. Tipos suportados pelo renderizador:
     text · textarea · number · money · date · select · multiselect · bool · readonly
   Propriedades: { k (coluna), l (rótulo), t (tipo), req, opts, col (1-4), hint }
   `req: true` alimenta tanto a validação do formulário quanto as pendências
   automáticas de "Campo obrigatório ausente" (§32).
   ========================================================================== */

const F = (k, l, t = 'text', extra = {}) => ({ k, l, t, col: 1, ...extra });

export const SECOES = {

  /* --------------------------------------------------- §7 externos */
  reclamacoes: {
    id: 'reclamacoes', tabela: 'fm_reclamacoes',
    label: 'Reclamações Externas', icone: 'bi-megaphone', area: 'Indicadores Externos',
    ordena: 'data_reclamacao',
    colunas: ['data_reclamacao', 'cliente_oficial', 'codigo', 'part_number', 'qtd_reclamacoes', 'qtd_pecas', 'tipo_defeito', 'status'],
    campos: [
      F('data_reclamacao', 'Data da reclamação', 'date', { req: true }),
      F('cliente_oficial', 'Cliente', 'select', { req: true, opts: 'clientes' }),
      F('codigo', 'Código da reclamação'),
      F('part_number', 'Part Number', 'text', { req: true }),
      F('produto', 'Produto'),
      F('tipo_produto', 'Tipo de produto'),
      F('qtd_reclamacoes', 'Qtd. de reclamações', 'number', { req: true, min: 0, hint: 'Uma reclamação com três peças conta como 1 reclamação e 3 peças.' }),
      F('qtd_pecas', 'Qtd. de peças afetadas', 'number', { req: true, min: 0 }),
      F('descricao', 'Descrição da reclamação', 'textarea', { col: 4 }),
      F('tipo_defeito', 'Tipo de defeito', 'text', { req: true }),
      F('classificacao', 'Classificação'),
      F('origem_reclamacao', 'Origem'),
      F('responsavel', 'Responsável interno'),
      F('data_abertura', 'Data de abertura', 'date'),
      F('data_encerramento', 'Data de encerramento', 'date'),
      F('status', 'Status', 'select', { req: true, opts: STATUS_RECLAMACAO }),
      F('demerito', 'Entrou no demérito?', 'bool', { hint: 'Só peças com demérito entram no PPM externo oficial.' }),
      F('oficial', 'Reclamação oficial?', 'bool'),
      F('negociada', 'Reclamação negociada?', 'bool'),
      F('cliente_reposicao', 'Cliente de reposição?', 'bool'),
      F('motivo_negociacao', 'Motivo da negociação', 'textarea', { col: 2, showIf: r => r.negociada }),
      F('negociado_por', 'Responsável pela negociação', 'text', { showIf: r => r.negociada }),
      F('data_negociacao', 'Data da negociação', 'date', { showIf: r => r.negociada }),
      F('observacoes', 'Observações', 'textarea', { col: 4 }),
      F('evidencia_url', 'Anexo / evidência (URL)', 'text', { col: 2 })
    ]
  },

  /* -------------------------------------------------- §12 internos */
  ocorrencias: {
    id: 'ocorrencias', tabela: 'fm_ocorrencias',
    label: 'Ocorrências Internas', icone: 'bi-exclamation-diamond', area: 'Indicadores Internos',
    ordena: 'data',
    colunas: ['data', 'origem_ocorrencia', 'setor', 'linha', 'part_number', 'tipo_defeito', 'qtd_pecas', 'status'],
    campos: [
      F('data', 'Data', 'date', { req: true }),
      F('planta', 'Planta', 'select', { opts: PLANTAS }),
      F('setor', 'Setor'),
      F('linha', 'Linha'),
      F('processo', 'Processo'),
      F('turno', 'Turno', 'select', { opts: TURNOS }),
      F('origem_ocorrencia', 'Origem da ocorrência', 'select', { req: true, opts: ORIGENS_OCORRENCIA }),
      F('cliente', 'Cliente', 'select', { opts: 'clientes' }),
      F('part_number', 'Part Number', 'text', { req: true }),
      F('produto', 'Produto'),
      F('tipo_produto', 'Tipo de produto'),
      F('tipo_defeito', 'Tipo de defeito', 'text', { req: true }),
      F('descricao', 'Descrição detalhada', 'textarea', { col: 4 }),
      F('qtd_pecas', 'Quantidade de peças', 'number', { req: true, min: 0 }),
      F('peso', 'Peso (kg)', 'number'),
      F('valor_estimado', 'Valor estimado', 'money'),
      F('ordem_producao', 'Ordem de produção'),
      F('lote', 'Lote'),
      F('detectado_por', 'Responsável pela detecção'),
      F('tratado_por', 'Responsável pela tratativa'),
      F('classificacao', 'Classificação'),
      F('rnc_id', 'RNC vinculada'),
      F('acao_id', 'Plano 5W2H vinculado', 'select', { opts: 'acoes' }),
      F('status', 'Status', 'select', { opts: ['Aberta', 'Em análise', 'Em andamento', 'Resolvida', 'Encerrada'] }),
      F('observacoes', 'Observações', 'textarea', { col: 4 }),
      F('evidencia_url', 'Anexo / evidência (URL)', 'text', { col: 2 })
    ]
  },

  /* ------------------------------------------------- §14 produção */
  producao: {
    id: 'producao', tabela: 'fm_producao',
    label: 'Produção', icone: 'bi-gear-wide-connected', area: 'Indicadores Internos',
    ordena: 'data',
    colunas: ['data', 'linha', 'turno', 'part_number', 'qtd_fabricada', 'qtd_aprovada', 'qtd_ng', 'fonte'],
    campos: [
      F('data', 'Data', 'date', { req: true }),
      F('planta', 'Planta', 'select', { opts: PLANTAS, req: true }),
      F('linha', 'Linha', 'text', { req: true }),
      F('processo', 'Processo'),
      F('turno', 'Turno', 'select', { opts: TURNOS, req: true }),
      F('part_number', 'Part Number', 'text', { req: true }),
      F('cliente', 'Cliente', 'select', { opts: 'clientes' }),
      F('qtd_fabricada', 'Quantidade fabricada', 'number', { req: true, min: 0 }),
      F('qtd_aprovada', 'Quantidade aprovada', 'number', { min: 0 }),
      F('qtd_ng', 'Quantidade NG', 'number', { min: 0 }),
      F('fonte', 'Fonte', 'select', { req: true, opts: FONTES_PRODUCAO }),
      F('arquivo_origem', 'Arquivo de origem', 'readonly'),
      F('observacao', 'Observação', 'textarea', { col: 2 }),
      F('justificativa', 'Justificativa da correção', 'textarea', { col: 2, hint: 'Obrigatória ao corrigir um lançamento já salvo (§14).' })
    ]
  },

  /* ------------------------------------ §8/§24 peças fornecidas */
  fornecimento: {
    id: 'fornecimento', tabela: 'fm_fornecimento',
    label: 'Peças Fornecidas', icone: 'bi-truck', area: 'Indicadores Externos',
    ordena: 'cliente_oficial',
    colunas: ['cliente_oficial', 'part_number', 'qtd_fornecida', 'faturamento_real', 'toneladas', 'fonte'],
    campos: [
      F('cliente_oficial', 'Cliente', 'select', { req: true, opts: 'clientes' }),
      F('part_number', 'Part Number'),
      F('qtd_fornecida', 'Qtd. de peças fornecidas', 'number', { req: true, min: 0 }),
      F('faturamento_real', 'Faturamento real', 'money'),
      F('faturamento_orcado', 'Faturamento orçado', 'money'),
      F('variacao', 'Variação', 'money'),
      F('toneladas', 'Toneladas', 'number'),
      F('preco_medio_kg', 'Preço médio por quilo', 'money'),
      F('preco_medio_peca', 'Preço médio por peça', 'money'),
      F('acumulado_ano', 'Acumulado anual', 'money'),
      F('fonte', 'Fonte', 'select', { opts: ['Importação', 'Lançamento manual'] })
    ]
  },

  /* ------------------------------------------------- §19 custos */
  custos: {
    id: 'custos', tabela: 'fm_custos',
    label: 'Custos da Qualidade', icone: 'bi-cash-coin', area: 'Custos da Qualidade',
    ordena: 'data',
    colunas: ['data', 'categoria', 'descricao', 'part_number', 'quantidade', 'valor', 'documento_fiscal'],
    campos: [
      F('data', 'Data', 'date', { req: true }),
      F('planta', 'Planta', 'select', { opts: PLANTAS }),
      F('centro_custo', 'Centro de custo'),
      F('categoria', 'Categoria', 'select', { req: true, opts: CATEGORIAS_CUSTO }),
      F('descricao', 'Descrição', 'textarea', { col: 2, req: true }),
      F('fornecedor', 'Fornecedor'),
      F('cliente', 'Cliente', 'select', { opts: 'clientes' }),
      F('part_number', 'Part Number'),
      F('quantidade', 'Quantidade', 'number'),
      F('valor', 'Valor', 'money', { req: true }),
      F('moeda', 'Moeda', 'select', { opts: ['BRL', 'USD', 'EUR'] }),
      F('responsavel', 'Responsável'),
      F('documento_fiscal', 'Documento fiscal', 'text', { hint: 'Custo sem documento gera pendência (§32).' }),
      F('ocorrencia_id', 'Ocorrência vinculada', 'select', { opts: 'ocorrencias' }),
      F('quebra_id', 'Quebra vinculada', 'select', { opts: 'quebras' }),
      F('rnc_id', 'RNC vinculada'),
      F('observacao', 'Observação', 'textarea', { col: 4 }),
      F('anexo_url', 'Anexo (URL)', 'text', { col: 2 })
    ]
  },

  /* --------------------------------------------- §20 retrabalho */
  retrabalho: {
    id: 'retrabalho', tabela: 'fm_retrabalho',
    label: 'Retrabalho', icone: 'bi-arrow-repeat', area: 'Custos da Qualidade',
    ordena: 'etapa',
    colunas: ['etapa', 'processo', 'part_number', 'qtd_produzida', 'qtd_retrabalhada', 'custo', 'status'],
    campos: [
      F('etapa', 'Etapa', 'select', { req: true, opts: ETAPAS_PROCESSO }),
      F('processo', 'Processo'),
      F('setor', 'Setor'),
      F('part_number', 'Part Number', 'text', { req: true }),
      F('qtd_produzida', 'Quantidade produzida', 'number', { req: true, min: 0 }),
      F('qtd_retrabalhada', 'Quantidade retrabalhada', 'number', { req: true, min: 0 }),
      F('tipo_retrabalho', 'Tipo de retrabalho'),
      F('motivo', 'Motivo', 'textarea', { col: 2 }),
      F('responsavel', 'Responsável'),
      F('custo', 'Custo', 'money'),
      F('status', 'Status', 'select', { opts: ['Aberto', 'Em andamento', 'Concluído'] }),
      F('observacao', 'Observação', 'textarea', { col: 4 })
    ]
  },

  /* ------------------------------------------------- §21 sucata */
  sucata: {
    id: 'sucata', tabela: 'fm_sucata',
    label: 'Sucata', icone: 'bi-trash3', area: 'Custos da Qualidade',
    ordena: 'etapa',
    colunas: ['etapa', 'processo', 'part_number', 'quantidade', 'peso', 'valor', 'tipo_defeito'],
    campos: [
      F('etapa', 'Etapa', 'select', { req: true, opts: ETAPAS_PROCESSO }),
      F('processo', 'Processo'),
      F('part_number', 'Part Number', 'text', { req: true }),
      F('quantidade', 'Quantidade', 'number', { req: true, min: 0 }),
      F('peso', 'Peso (kg)', 'number'),
      F('valor', 'Valor', 'money'),
      F('tipo_defeito', 'Tipo de defeito', 'text', { req: true }),
      F('motivo', 'Motivo', 'textarea', { col: 2 }),
      F('responsavel', 'Responsável'),
      F('ocorrencia_id', 'Ocorrência vinculada', 'select', { opts: 'ocorrencias' }),
      F('observacao', 'Observação', 'textarea', { col: 4 })
    ]
  },

  /* --------------------------------------------------- §22 CARE */
  care: {
    id: 'care', tabela: 'fm_care',
    label: 'Inspeção CARE', icone: 'bi-clipboard-check', area: 'Inspeção CARE',
    ordena: 'data',
    colunas: ['data', 'part_number', 'tipo_defeito', 'qtd_inspecionada', 'qtd_aprovada', 'qtd_ng', 'linha', 'auditor'],
    campos: [
      F('data', 'Data', 'date', { req: true }),
      F('planta', 'Planta', 'select', { opts: PLANTAS }),
      F('part_number', 'Part Number', 'text', { req: true }),
      F('produto', 'Produto'),
      F('tipo_defeito', 'Tipo de defeito', 'text', { req: true }),
      F('qtd_inspecionada', 'Quantidade inspecionada', 'number', { req: true, min: 0 }),
      F('qtd_aprovada', 'Quantidade aprovada', 'number', { min: 0 }),
      F('qtd_ng', 'Quantidade NG', 'number', { req: true, min: 0 }),
      F('linha', 'Linha'),
      F('turno', 'Turno', 'select', { opts: TURNOS }),
      F('auditor', 'Auditor'),
      F('responsavel_area', 'Responsável da área'),
      F('ocorrencia_id', 'Ocorrência vinculada', 'select', { opts: 'ocorrencias' }),
      F('acao_id', 'Plano de ação vinculado', 'select', { opts: 'acoes' }),
      F('observacoes', 'Observações', 'textarea', { col: 4 }),
      F('evidencia_url', 'Evidência (URL)', 'text', { col: 2 })
    ]
  },

  /* ------------------------------------------------ §18 quebras */
  quebras: {
    id: 'quebras', tabela: 'fm_quebras',
    label: 'Farol de Quebras', icone: 'bi-cone-striped', area: 'Farol de Quebras',
    ordena: 'data_quebra',
    colunas: ['data_quebra', 'tipo', 'part_number', 'cliente', 'quantidade', 'responsavel', 'prazo', 'status'],
    campos: [
      F('tipo', 'Tipo de quebra', 'select', { req: true, opts: [['externa', 'Externa'], ['interna', 'Interna']] }),
      F('produto', 'Produto'),
      F('part_number', 'Part Number', 'text', { req: true }),
      F('tipo_produto', 'Tipo de produto'),
      F('quantidade', 'Quantidade', 'number', { req: true, min: 0 }),
      F('data_quebra', 'Data da quebra', 'date', { req: true }),
      F('local_quebra', 'Local'),
      F('cliente', 'Cliente', 'select', { opts: 'clientes' }),
      F('lote', 'Lote'),
      F('ordem_producao', 'Ordem de produção'),
      F('descricao', 'Descrição da quebra', 'textarea', { col: 4, req: true }),
      F('contencao', 'Ação de contenção inicial', 'textarea', { col: 2 }),
      F('possivel_causa', 'Possível causa', 'textarea', { col: 2 }),
      F('causa_raiz', 'Causa raiz confirmada', 'textarea', { col: 2 }),
      F('acao_corretiva', 'Ação corretiva', 'textarea', { col: 2 }),
      F('responsavel', 'Responsável', 'text', { req: true }),
      F('prazo', 'Prazo', 'date', { req: true }),
      F('status', 'Status', 'select', { req: true, opts: STATUS_QUEBRA }),
      F('rnc_id', 'RNC vinculada', 'text', { hint: 'Quebra sem RNC gera pendência (§32).' }),
      F('acao_id', 'Plano de ação vinculado', 'select', { opts: 'acoes' }),
      F('evidencia_url', 'Evidências (URL)', 'text', { col: 2 }),
      F('data_conclusao', 'Data da conclusão', 'date')
    ]
  },

  /* ---------------------------------------------- §17 segurança */
  seguranca: {
    id: 'seguranca', tabela: 'fm_seguranca',
    label: 'Segurança do Trabalho', icone: 'bi-shield-check', area: 'Segurança do Trabalho',
    ordena: 'data',
    colunas: ['data', 'categoria', 'local_evento', 'descricao', 'quantidade', 'responsavel', 'status'],
    campos: [
      F('data', 'Data', 'date', { req: true }),
      F('categoria', 'Categoria', 'select', { req: true, opts: CATEGORIAS_SEGURANCA }),
      F('local_evento', 'Local'),
      F('descricao', 'Descrição', 'textarea', { col: 4, req: true }),
      F('quantidade', 'Quantidade', 'number', { req: true, min: 0 }),
      F('responsavel', 'Responsável'),
      F('acao_tomada', 'Ação tomada', 'textarea', { col: 2 }),
      F('status', 'Status', 'select', { opts: ['Aberto', 'Em andamento', 'Concluído'] }),
      F('observacoes', 'Observações', 'textarea', { col: 4 }),
      F('anexo_url', 'Anexo (URL)', 'text', { col: 2 })
    ]
  },

  /* --------------------------------------------- §23 planos 5W2H */
  acoes: {
    id: 'acoes', tabela: 'fm_acoes',
    label: 'Planos de Ação 5W2H', icone: 'bi-diagram-3', area: 'Planos de Ação 5W2H',
    ordena: 'when_', compCol: 'competencia_origem_id',
    colunas: ['problema', 'what', 'who', 'when_', 'percentual', 'status'],
    campos: [
      F('data_reuniao', 'Data da reunião', 'date'),
      F('problema', 'Problema principal', 'textarea', { col: 2, req: true }),
      F('part_number', 'Part Number relacionado'),
      F('what', 'What — O que será feito?', 'textarea', { col: 4, req: true }),
      F('why', 'Why — Por que será feito?', 'textarea', { col: 2 }),
      F('where_', 'Where — Onde será feito?', 'text'),
      F('when_', 'When — Prazo', 'date', { req: true, hint: 'Plano sem prazo gera pendência (§32).' }),
      F('who', 'Who — Responsável', 'text', { req: true }),
      F('how', 'How — Como será feito?', 'textarea', { col: 4 }),
      F('how_much', 'How much — Custo previsto', 'money'),
      F('causa_raiz', 'Causa raiz', 'textarea', { col: 2, req: true }),
      F('status', 'Status', 'select', { req: true, opts: STATUS_ACAO }),
      F('percentual', 'Percentual de conclusão', 'number', { min: 0, max: 100 }),
      F('evidencia_url', 'Evidências (URL)', 'text', { col: 2,
        hint: 'Obrigatória para marcar o plano como Concluído (§23).' }),
      F('observacoes', 'Observações', 'textarea', { col: 4 })
    ]
  },

  /* -------------------------------- §28 outros indicadores */
  resultados: {
    id: 'resultados', tabela: 'fm_resultados',
    label: 'Outros Indicadores', icone: 'bi-graph-up', area: 'Configurações',
    ordena: 'indicador',
    colunas: ['indicador', 'cliente', 'resultado', 'meta', 'unidade', 'fonte'],
    campos: [
      F('indicador', 'Indicador', 'select', { req: true, opts: [
        'Desempenho de entrega', 'Satisfação do cliente', 'Índice de auditoria',
        'Parada de linha', 'Outro'] }),
      F('cliente', 'Cliente', 'select', { opts: 'clientes' }),
      F('resultado', 'Resultado', 'number', { req: true }),
      F('meta', 'Meta', 'number'),
      F('unidade', 'Unidade'),
      F('fonte', 'Fonte'),
      F('responsavel', 'Responsável'),
      F('comentario', 'Comentário', 'textarea', { col: 4 }),
      F('evidencia_url', 'Evidência (URL)', 'text')
    ]
  }
};

/** Campos obrigatórios de uma seção (usado pelo motor de pendências). */
export function camposObrigatorios(secaoId) {
  return (SECOES[secaoId]?.campos || []).filter(c => c.req);
}

/** Coluna que liga o registro à competência (fm_acoes usa outro nome). */
export function colunaCompetencia(secaoId) {
  return SECOES[secaoId]?.compCol || 'competencia_id';
}

/* ==================================================== ÁREAS DO MÓDULO (§2) */
export const AREAS = [
  { id: 'dashboard',    label: 'Dashboard',              icone: 'bi-speedometer2' },
  { id: 'competencias', label: 'Competências',           icone: 'bi-calendar3' },
  { id: 'externos',     label: 'Indicadores Externos',   icone: 'bi-megaphone' },
  { id: 'internos',     label: 'Indicadores Internos',   icone: 'bi-exclamation-diamond' },
  { id: 'cruz',         label: 'Cruz da Qualidade',      icone: 'bi-plus-square' },
  { id: 'seguranca',    label: 'Segurança do Trabalho',  icone: 'bi-shield-check' },
  { id: 'quebras',      label: 'Farol de Quebras',       icone: 'bi-cone-striped' },
  { id: 'custos',       label: 'Custos da Qualidade',    icone: 'bi-cash-coin' },
  { id: 'care',         label: 'Inspeção CARE',          icone: 'bi-clipboard-check' },
  { id: 'planos',       label: 'Planos de Ação 5W2H',    icone: 'bi-diagram-3' },
  { id: 'importacoes',  label: 'Importações',            icone: 'bi-file-earmark-arrow-up' },
  { id: 'pendencias',   label: 'Pendências',             icone: 'bi-exclamation-circle' },
  { id: 'previa',       label: 'Prévia da Apresentação', icone: 'bi-easel' },
  { id: 'aprovacao',    label: 'Aprovação',              icone: 'bi-check2-square' },
  { id: 'geradas',      label: 'Apresentações Geradas',  icone: 'bi-collection' },
  { id: 'historico',    label: 'Histórico',              icone: 'bi-clock-history' },
  { id: 'config',       label: 'Configurações',          icone: 'bi-sliders' }
];

/* Seções que compõem o percentual de conclusão da competência (§3).
   Uma seção conta como "iniciada" quando tem pelo menos um registro. */
export const SECOES_PROGRESSO = [
  'reclamacoes', 'fornecimento', 'ocorrencias', 'producao',
  'custos', 'care', 'quebras', 'seguranca', 'acoes'
];

/* Indicadores calculados — rótulo, unidade e sentido da meta (§31).
   `melhor: 'menor'` significa que o valor menor é melhor (PPM, custo). */
export const INDICADORES = {
  reclamacoes:          { label: 'Reclamações externas',   unidade: 'un',  melhor: 'menor', icone: 'bi-megaphone' },
  reclamacoes_negociadas:{ label: 'Reclamações negociadas',unidade: 'un',  melhor: 'menor', icone: 'bi-handshake' },
  ppm_externo_oficial:  { label: 'PPM externo oficial',    unidade: 'PPM', melhor: 'menor', icone: 'bi-bullseye' },
  ppm_externo_real:     { label: 'PPM externo real',       unidade: 'PPM', melhor: 'menor', icone: 'bi-bullseye' },
  ocorrencias:          { label: 'Ocorrências internas',   unidade: 'un',  melhor: 'menor', icone: 'bi-exclamation-diamond' },
  ppm_interno:          { label: 'PPM interno',            unidade: 'PPM', melhor: 'menor', icone: 'bi-diagram-2' },
  dias_sem_reclamacao:  { label: 'Dias sem reclamação',    unidade: 'dias', melhor: 'maior', icone: 'bi-calendar-check' },
  quebras_externas:     { label: 'Quebras externas',       unidade: 'un',  melhor: 'menor', icone: 'bi-cone-striped' },
  quebras_internas:     { label: 'Quebras internas',       unidade: 'un',  melhor: 'menor', icone: 'bi-cone' },
  custo_qualidade:      { label: 'Custo mensal da qualidade', unidade: 'BRL', melhor: 'menor', icone: 'bi-cash-coin' },
  care_inspecoes:       { label: 'Inspeções CARE',         unidade: 'un',  melhor: 'maior', icone: 'bi-clipboard-check' },
  care_percentual_ng:   { label: 'CARE — % NG',            unidade: '%',   melhor: 'menor', icone: 'bi-percent' },
  planos_atrasados:     { label: 'Planos atrasados',       unidade: 'un',  melhor: 'menor', icone: 'bi-alarm' },
  pendencias:           { label: 'Pendências',             unidade: 'un',  melhor: 'menor', icone: 'bi-exclamation-circle' },
  progresso:            { label: 'Progresso do fechamento', unidade: '%',  melhor: 'maior', icone: 'bi-bar-chart-steps' },
  seguranca_eventos:    { label: 'Eventos de segurança',   unidade: 'un',  melhor: 'menor', icone: 'bi-shield-check' },
  retrabalho:           { label: 'Índice de retrabalho',   unidade: 'PPM', melhor: 'menor', icone: 'bi-arrow-repeat' },
  sucata_ppm:           { label: 'PPM de sucata',          unidade: 'PPM', melhor: 'menor', icone: 'bi-trash3' }
};

/* Tipos de pendência automática (§32) — título e prioridade padrão. */
export const TIPOS_PENDENCIA = {
  campo_obrigatorio:   { titulo: 'Campo obrigatório ausente',      prioridade: 'Alta',    bloqueia: true },
  producao_ausente:    { titulo: 'Quantidade produzida ausente',   prioridade: 'Crítica', bloqueia: true },
  fornecimento_ausente:{ titulo: 'Quantidade fornecida ausente',   prioridade: 'Crítica', bloqueia: true },
  cliente_nao_assoc:   { titulo: 'Cliente não associado',          prioridade: 'Alta',    bloqueia: true },
  plano_sem_resp:      { titulo: 'Plano sem responsável',          prioridade: 'Alta',    bloqueia: false },
  plano_sem_prazo:     { titulo: 'Plano sem prazo',                prioridade: 'Alta',    bloqueia: false },
  plano_sem_causa:     { titulo: 'Plano sem causa raiz',           prioridade: 'Média',   bloqueia: false },
  acao_vencida:        { titulo: 'Ação vencida',                   prioridade: 'Crítica', bloqueia: false },
  recl_sem_evidencia:  { titulo: 'Reclamação sem evidência',       prioridade: 'Média',   bloqueia: false },
  quebra_sem_rnc:      { titulo: 'Quebra sem RNC',                 prioridade: 'Alta',    bloqueia: false },
  care_sem_tratativa:  { titulo: 'CARE sem tratativa',             prioridade: 'Média',   bloqueia: false },
  custo_sem_doc:       { titulo: 'Custo sem documento',            prioridade: 'Baixa',   bloqueia: false },
  indicador_sem_meta:  { titulo: 'Indicador sem meta',             prioridade: 'Média',   bloqueia: false },
  importacao_com_erro: { titulo: 'Importação com erro',            prioridade: 'Crítica', bloqueia: true }
};
