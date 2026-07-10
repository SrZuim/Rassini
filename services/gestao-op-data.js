/* ==========================================================================
   RNA One — Gestão Operacional · Dados semente (modo demo)
   Espelham as tabelas op_* do Supabase. Em produção, o db.js busca do backend
   (rode database/gestao_operacional.sql). NADA de rotina/checklist fica fixo no
   código de fluxo — tudo é configurável e vem destas tabelas.
   ========================================================================== */

/* Tipos de atividade — expansível sem programação (basta inserir novo registro). */
export const OP_TIPOS_ATIVIDADE = [
  { id: 't-rot', slug: 'rotina',       nome: 'Rotina',        cor: 'yellow', icone: 'bi-list-check',          ativo: true },
  { id: 't-chk', slug: 'checklist',    nome: 'Checklist',     cor: 'orange', icone: 'bi-ui-checks',           ativo: true },
  { id: 't-aud', slug: 'auditoria',    nome: 'Auditoria',     cor: 'green',  icone: 'bi-search',              ativo: true },
  { id: 't-ins', slug: 'inspecao',     nome: 'Inspeção',      cor: 'blue',   icone: 'bi-clipboard-check',     ativo: true },
  { id: 't-seg', slug: 'seguranca',    nome: 'Segurança',     cor: 'red',    icone: 'bi-shield-check',        ativo: true },
  { id: 't-qua', slug: 'qualidade',    nome: 'Qualidade',     cor: 'blue',   icone: 'bi-patch-check',         ativo: true },
  { id: 't-pro', slug: 'processo',     nome: 'Processo',      cor: 'gray',   icone: 'bi-gear-wide-connected', ativo: true },
  { id: 't-man', slug: 'manutencao',   nome: 'Manutenção',    cor: 'orange', icone: 'bi-wrench-adjustable',   ativo: true },
  { id: 't-5s',  slug: 'cinco_s',      nome: '5S',            cor: 'green',  icone: 'bi-grid-3x3-gap',        ativo: true },
  { id: 't-amb', slug: 'meio_ambiente',nome: 'Meio Ambiente', cor: 'green',  icone: 'bi-tree',                ativo: true },
  { id: 't-out', slug: 'outro',        nome: 'Outro',         cor: 'gray',   icone: 'bi-three-dots',          ativo: true }
];

export const OP_CATEGORIAS = [
  { id: 'c1', nome: 'Inspeção Final', tipo_slug: 'rotina', ativo: true },
  { id: 'c2', nome: 'Lubrificação',   tipo_slug: 'rotina', ativo: true },
  { id: 'c3', nome: 'Setup',          tipo_slug: 'rotina', ativo: true },
  { id: 'c4', nome: 'Segurança',      tipo_slug: 'rotina', ativo: true },
  { id: 'c5', nome: '5S',             tipo_slug: 'rotina', ativo: true },
  { id: 'c6', nome: 'Qualidade',      tipo_slug: 'rotina', ativo: true },
  { id: 'c7', nome: 'Segurança',      tipo_slug: 'checklist', ativo: true },
  { id: 'c8', nome: 'Qualidade',      tipo_slug: 'checklist', ativo: true },
  { id: 'c9', nome: 'Processo',       tipo_slug: 'checklist', ativo: true },
  { id: 'c10', nome: '5S',            tipo_slug: 'checklist', ativo: true }
];

/* Config de execução (Construtor Visual). */
export const OP_EXEC_OPCOES = [
  { slug: 'nao', nome: 'Não permitir' },
  { slug: 'opcional', nome: 'Opcional' },
  { slug: 'obrigatoria', nome: 'Obrigatória' }
];
export const OP_RESPOSTAS = ['OK', 'NOK', 'N/A'];

/* Tipos de resposta dos itens (legado Fase 2 — mantido internamente). */
export const OP_TIPOS_RESPOSTA = [
  { slug: 'checkbox',      nome: 'Concluído (check)' },
  { slug: 'sim_nao',       nome: 'Sim / Não' },
  { slug: 'numero',        nome: 'Número' },
  { slug: 'texto',         nome: 'Texto' },
  { slug: 'foto',          nome: 'Foto' },
  { slug: 'assinatura',    nome: 'Assinatura' },
  { slug: 'lista',         nome: 'Lista suspensa' },
  { slug: 'multipla',      nome: 'Múltipla escolha' },
  { slug: 'qrcode',        nome: 'QR Code' },
  { slug: 'codigo_barras', nome: 'Código de barras' }
];

/* Recorrências e status (usados nos selects do admin). */
export const OP_FREQUENCIAS = ['Diária', 'Semanal', 'Mensal', 'Por turno', 'Sob demanda', 'A cada X horas'];
export const OP_AGENDA_TIPOS = ['diaria', 'dia_semana', 'semanal', 'mensal', 'por_turno', 'sob_demanda', 'a_cada_x_horas'];
export const OP_STATUS = ['rascunho', 'publicada', 'arquivada'];
export const OP_PRIORIDADES = ['Baixa', 'Média', 'Alta', 'Crítica'];
export const OP_DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const OP_ALVO_TIPOS = [
  { slug: 'usuario',      nome: 'Usuário específico' },
  { slug: 'cargo',        nome: 'Cargo' },
  { slug: 'planta_turno', nome: 'Planta + Turno' }
  // Futuros (arquitetura pronta): setor, linha, maquina, processo, equipe
];

/* Rotinas = AÇÃO ÚNICA (config de Concluir). Colunas técnicas antigas continuam
   nas tabelas (compatibilidade), mas não são usadas pela interface do construtor. */
export const OP_ATIVIDADES = [
  {
    id: 'ativ-rot-001', tipo_slug: 'rotina', nome: 'Inspeção de Início de Turno', codigo: 'ROT-001',
    descricao: 'Verificações obrigatórias na abertura do turno.', categoria: 'Inspeção Final',
    planta: 'Planta Rio Nova Iguaçu', setor: 'Estamparia', turno: '', responsavel: 'todos',
    frequencia: 'Diária', horario: '06:30',
    exec_observacao: 'obrigatoria', exec_foto: 'opcional', permite_na: true,
    obrigatoria: true, status: 'publicada', is_template: false, anexos: [],
    created_by: 'u1', created_at: '2026-01-05', updated_at: '2026-01-05'
  },
  {
    id: 'ativ-rot-002', tipo_slug: 'rotina', nome: 'Lubrificação de Prensas', codigo: 'ROT-002',
    descricao: 'Rotina diária de lubrificação das prensas da estamparia.', categoria: 'Lubrificação',
    planta: '', setor: 'Estamparia', turno: '', responsavel: 'todos', cargo: 'auditor',
    frequencia: 'Diária', horario: '07:00',
    exec_observacao: 'opcional', exec_foto: 'obrigatoria', permite_na: true,
    obrigatoria: true, status: 'publicada', is_template: false, anexos: [],
    created_by: 'u1', created_at: '2026-01-05', updated_at: '2026-01-05'
  },
  {
    id: 'ativ-rot-003', tipo_slug: 'rotina', nome: 'Reunião de Sucata', codigo: 'ROT-003',
    descricao: 'Alinhamento diário sobre índices de sucata da célula.', categoria: '5S',
    planta: '', setor: '', turno: '', responsavel: 'u3',
    frequencia: 'Diária', horario: '08:00',
    exec_observacao: 'opcional', exec_foto: 'nao', permite_na: true,
    obrigatoria: false, status: 'publicada', is_template: false, anexos: [],
    created_by: 'u1', created_at: '2026-01-05', updated_at: '2026-01-05'
  },
  {
    id: 'ativ-chk-001', tipo_slug: 'checklist', nome: 'Checklist de Segurança da Linha', codigo: 'CHK-001',
    descricao: 'Verificações de segurança na abertura do turno.', categoria: 'Segurança',
    planta: '', setor: '', turno: '', responsavel: 'todos', cargo: 'auditor',
    frequencia: 'Diária', horario: '06:45',
    obrigatoria: true, status: 'publicada', is_template: false, anexos: [],
    created_by: 'u1', created_at: '2026-01-05', updated_at: '2026-01-05'
  },
  {
    id: 'tpl-rot-setup', tipo_slug: 'rotina', nome: 'Template — Setup de Máquina', codigo: 'TPL-SETUP',
    descricao: 'Modelo reutilizável de rotina de setup.', categoria: 'Setup',
    planta: '', setor: '', turno: '', responsavel: 'todos',
    frequencia: 'Sob demanda', horario: '',
    exec_observacao: 'opcional', exec_foto: 'opcional', permite_na: true,
    obrigatoria: false, status: 'publicada', is_template: true, anexos: [],
    created_by: 'u1', created_at: '2026-01-05', updated_at: '2026-01-05'
  }
];

/* Itens de CHECKLIST = OK / NOK / N-A com config por resposta (obs/foto/pendência).
   Rotinas não têm itens (ação única). Campos técnicos antigos ficam nas colunas. */
const _cfg = (obs, foto, pend) => ({ observacao: obs, foto, criar_pendencia: !!pend });
export const OP_ATIVIDADE_ITENS = [
  { id: 'itc-001', atividade_id: 'ativ-chk-001', ordem: 1, nome: 'EPIs completos e em bom estado?', respostas: ['OK', 'NOK', 'N/A'], cfg_ok: _cfg('nao', 'nao', false), cfg_nok: _cfg('obrigatoria', 'opcional', true), cfg_na: _cfg('opcional', 'nao', false), peso: 2 },
  { id: 'itc-002', atividade_id: 'ativ-chk-001', ordem: 2, nome: 'Temperatura do óleo dentro do padrão?', respostas: ['OK', 'NOK', 'N/A'], cfg_ok: _cfg('nao', 'nao', false), cfg_nok: _cfg('opcional', 'nao', true), cfg_na: _cfg('opcional', 'nao', false), peso: 1 },
  { id: 'itc-003', atividade_id: 'ativ-chk-001', ordem: 3, nome: 'Limpeza e organização (5S) da célula', respostas: ['OK', 'NOK', 'N/A'], cfg_ok: _cfg('nao', 'nao', false), cfg_nok: _cfg('nao', 'obrigatoria', true), cfg_na: _cfg('opcional', 'nao', false), peso: 1 },
  { id: 'itc-004', atividade_id: 'ativ-chk-001', ordem: 4, nome: 'Registro de não-conforme atualizado?', respostas: ['OK', 'NOK', 'N/A'], cfg_ok: _cfg('nao', 'nao', false), cfg_nok: _cfg('obrigatoria', 'opcional', true), cfg_na: _cfg('opcional', 'nao', false), peso: 1 }
];

/* Atribuições — demonstram a hierarquia (usuário → cargo → planta+turno). */
export const OP_ATRIBUICOES = [
  { id: 'atr-1', atividade_id: 'ativ-rot-001', alvo_tipo: 'planta_turno', alvo_valor: '', planta: 'Planta Rio Nova Iguaçu', turno: '', prioridade: 10 },
  { id: 'atr-2', atividade_id: 'ativ-rot-002', alvo_tipo: 'cargo',        alvo_valor: 'auditor', planta: '', turno: '', prioridade: 50 },
  { id: 'atr-3', atividade_id: 'ativ-rot-003', alvo_tipo: 'usuario',      alvo_valor: 'u3', planta: '', turno: '', prioridade: 100 },
  { id: 'atr-chk-1', atividade_id: 'ativ-chk-001', alvo_tipo: 'cargo',    alvo_valor: 'auditor', planta: '', turno: '', prioridade: 50 }
];

export const OP_AGENDA = [
  { id: 'ag-1', atividade_id: 'ativ-rot-001', tipo: 'diaria', dias: [], intervalo_horas: null, ref: '' },
  { id: 'ag-2', atividade_id: 'ativ-rot-002', tipo: 'diaria', dias: [], intervalo_horas: null, ref: '' },
  { id: 'ag-3', atividade_id: 'ativ-rot-003', tipo: 'diaria', dias: [], intervalo_horas: null, ref: '' },
  { id: 'ag-chk-1', atividade_id: 'ativ-chk-001', tipo: 'diaria', dias: [], intervalo_horas: null, ref: '' }
];

/* Mapa nome→default para o seeding/reset (estilo CATALOGOS). */
export const GESTAO_OP = {
  op_tipos_atividade:  OP_TIPOS_ATIVIDADE,
  op_categorias:       OP_CATEGORIAS,
  op_atividades:       OP_ATIVIDADES,
  op_atividade_itens:  OP_ATIVIDADE_ITENS,
  op_atribuicoes:      OP_ATRIBUICOES,
  op_agenda:           OP_AGENDA,
  op_execucao:         [],
  op_execucao_itens:   [],
  op_pendencias:       []
};
