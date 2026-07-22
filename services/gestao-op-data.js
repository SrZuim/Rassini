/* ==========================================================================
   RNA One — Gestão Operacional · Dados semente (modo demo)
   Espelham as tabelas op_* do Supabase. Em produção, o db.js busca do backend
   (rode database/gestao_operacional.sql). NADA de rotina/checklist fica fixo no
   código de fluxo — tudo é configurável e vem destas tabelas.
   ========================================================================== */
import { MODELOS_ATIVIDADES, MODELOS_ITENS } from './rotinas-modelos.js';

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

/* ------------------------------------------------ SUBSTÂNCIAS (§M06) -------
   Catálogo editável, usado como contexto do plantão e nas regras condicionais.
   Os dois primeiros são os banhos reais já citados no modelo Magnaflux
   (services/rotinas-modelos.js) — antes eram dois ITENS da mesma rotina; com as
   regras, cada substância passa a ter a sua rotina e só a que está em uso
   aparece no plantão. */
export const OP_SUBSTANCIAS = [
  { id: 'sub-1', nome: 'Magnaflux ML-500WB',  ativo: true },
  { id: 'sub-2', nome: 'Metalcheck CLY-2000', ativo: true },
  { id: 'sub-3', nome: 'Magnaglo 14HF',       ativo: true }
];

/* Processos — contexto do plantão (§M06). Editável como os demais catálogos. */
export const OP_PROCESSOS = [
  { id: 'prc-1', nome: 'Estamparia',           ativo: true },
  { id: 'prc-2', nome: 'Tratamento Térmico',   ativo: true },
  { id: 'prc-3', nome: 'Montagem',             ativo: true },
  { id: 'prc-4', nome: 'Usinagem',             ativo: true },
  { id: 'prc-5', nome: 'Ensaio Não Destrutivo',ativo: true }
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
  /* ---------------------------------------------------------------- §M06
     Exemplos REAIS de regras condicionais, com os dois padrões do requisito.

     (a) GRUPO "velocidade_esteira" — duas rotinas mutuamente exclusivas.
         Cliente Scania → só a ROT-010. Qualquer outro cliente → só a ROT-011.
         A ROT-011 é a genérica (fallback) e por isso tem prioridade menor: se
         ambas casassem, a mais específica vence. */
  {
    id: 'ativ-rot-010', tipo_slug: 'rotina', nome: 'Velocidade da Esteira — Scania', codigo: 'ROT-010',
    descricao: 'Parâmetro de esteira específico dos produtos Scania.', categoria: 'Processo',
    planta: '', setor: '', turno: '', responsavel: 'todos', cargo: 'auditor',
    frequencia: 'Diária', horario: '07:30',
    exec_observacao: 'opcional', exec_foto: 'nao', permite_na: false,
    obrigatoria: true, status: 'publicada', is_template: false, anexos: [],
    grupo_regra: 'velocidade_esteira', exclusivo_por_grupo: true, prioridade_regra: 100,
    condicoes: [{ campo: 'cliente', operador: 'igual', valor: 'Scania' }],
    created_by: 'u1', created_at: '2026-07-20', updated_at: '2026-07-20'
  },
  {
    id: 'ativ-rot-011', tipo_slug: 'rotina', nome: 'Velocidade da Esteira — Demais Clientes', codigo: 'ROT-011',
    descricao: 'Parâmetro de esteira padrão dos demais clientes.', categoria: 'Processo',
    planta: '', setor: '', turno: '', responsavel: 'todos', cargo: 'auditor',
    frequencia: 'Diária', horario: '07:30',
    exec_observacao: 'opcional', exec_foto: 'nao', permite_na: false,
    obrigatoria: true, status: 'publicada', is_template: false, anexos: [],
    grupo_regra: 'velocidade_esteira', exclusivo_por_grupo: true, prioridade_regra: 10,
    condicoes: [{ campo: 'cliente', operador: 'diferente', valor: 'Scania' }],
    created_by: 'u1', created_at: '2026-07-20', updated_at: '2026-07-20'
  },
  /* (b) GRUPO "magnaflux" — uma rotina por substância; só a que está em uso
         no plantão aparece. Mesma prioridade: o que decide é a condição. */
  {
    id: 'ativ-rot-020', tipo_slug: 'rotina', nome: 'Magnaflux — ML-500WB', codigo: 'ROT-020',
    descricao: 'Concentração do banho de partícula magnética ML-500WB.', categoria: 'Qualidade',
    planta: '', setor: '', turno: '', responsavel: 'todos', cargo: 'auditor',
    frequencia: 'Diária', horario: '09:00',
    exec_observacao: 'opcional', exec_foto: 'nao', permite_na: false,
    obrigatoria: true, status: 'publicada', is_template: false, anexos: [],
    grupo_regra: 'magnaflux', exclusivo_por_grupo: true, prioridade_regra: 50,
    condicoes: [{ campo: 'substancia', operador: 'igual', valor: 'Magnaflux ML-500WB' }],
    created_by: 'u1', created_at: '2026-07-20', updated_at: '2026-07-20'
  },
  {
    id: 'ativ-rot-021', tipo_slug: 'rotina', nome: 'Magnaflux — Metalcheck CLY-2000', codigo: 'ROT-021',
    descricao: 'Concentração do banho de partícula magnética CLY-2000.', categoria: 'Qualidade',
    planta: '', setor: '', turno: '', responsavel: 'todos', cargo: 'auditor',
    frequencia: 'Diária', horario: '09:00',
    exec_observacao: 'opcional', exec_foto: 'nao', permite_na: false,
    obrigatoria: true, status: 'publicada', is_template: false, anexos: [],
    grupo_regra: 'magnaflux', exclusivo_por_grupo: true, prioridade_regra: 50,
    condicoes: [{ campo: 'substancia', operador: 'igual', valor: 'Metalcheck CLY-2000' }],
    created_by: 'u1', created_at: '2026-07-20', updated_at: '2026-07-20'
  },
  {
    id: 'ativ-rot-022', tipo_slug: 'rotina', nome: 'Magnaflux — Magnaglo 14HF', codigo: 'ROT-022',
    descricao: 'Concentração do banho de partícula magnética Magnaglo 14HF.', categoria: 'Qualidade',
    planta: '', setor: '', turno: '', responsavel: 'todos', cargo: 'auditor',
    frequencia: 'Diária', horario: '09:00',
    exec_observacao: 'opcional', exec_foto: 'nao', permite_na: false,
    obrigatoria: true, status: 'publicada', is_template: false, anexos: [],
    grupo_regra: 'magnaflux', exclusivo_por_grupo: true, prioridade_regra: 50,
    condicoes: [{ campo: 'substancia', operador: 'igual', valor: 'Magnaglo 14HF' }],
    created_by: 'u1', created_at: '2026-07-20', updated_at: '2026-07-20'
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
  { id: 'atr-chk-1', atividade_id: 'ativ-chk-001', alvo_tipo: 'cargo',    alvo_valor: 'auditor', planta: '', turno: '', prioridade: 50 },
  /* §M06 — as rotinas condicionais são atribuídas ao cargo normalmente; o que
     decide se entram no plantão são as CONDIÇÕES da atividade, não a atribuição. */
  { id: 'atr-10',  atividade_id: 'ativ-rot-010', alvo_tipo: 'cargo', alvo_valor: 'auditor', planta: '', turno: '', prioridade: 50 },
  { id: 'atr-11',  atividade_id: 'ativ-rot-011', alvo_tipo: 'cargo', alvo_valor: 'auditor', planta: '', turno: '', prioridade: 50 },
  { id: 'atr-20',  atividade_id: 'ativ-rot-020', alvo_tipo: 'cargo', alvo_valor: 'auditor', planta: '', turno: '', prioridade: 50 },
  { id: 'atr-21',  atividade_id: 'ativ-rot-021', alvo_tipo: 'cargo', alvo_valor: 'auditor', planta: '', turno: '', prioridade: 50 },
  { id: 'atr-22',  atividade_id: 'ativ-rot-022', alvo_tipo: 'cargo', alvo_valor: 'auditor', planta: '', turno: '', prioridade: 50 }
];

export const OP_AGENDA = [
  { id: 'ag-1', atividade_id: 'ativ-rot-001', tipo: 'diaria', dias: [], intervalo_horas: null, ref: '' },
  { id: 'ag-2', atividade_id: 'ativ-rot-002', tipo: 'diaria', dias: [], intervalo_horas: null, ref: '' },
  { id: 'ag-3', atividade_id: 'ativ-rot-003', tipo: 'diaria', dias: [], intervalo_horas: null, ref: '' },
  { id: 'ag-chk-1', atividade_id: 'ativ-chk-001', tipo: 'diaria', dias: [], intervalo_horas: null, ref: '' },
  { id: 'ag-10', atividade_id: 'ativ-rot-010', tipo: 'diaria', dias: [], intervalo_horas: null, ref: '' },
  { id: 'ag-11', atividade_id: 'ativ-rot-011', tipo: 'diaria', dias: [], intervalo_horas: null, ref: '' },
  { id: 'ag-20', atividade_id: 'ativ-rot-020', tipo: 'diaria', dias: [], intervalo_horas: null, ref: '' },
  { id: 'ag-21', atividade_id: 'ativ-rot-021', tipo: 'diaria', dias: [], intervalo_horas: null, ref: '' },
  { id: 'ag-22', atividade_id: 'ativ-rot-022', tipo: 'diaria', dias: [], intervalo_horas: null, ref: '' }
];

/* Mapa nome→default para o seeding/reset (estilo CATALOGOS).
   Os modelos padrão de rotina (SP1..SP5, Magnaflux, Temperatura e Umidade) vêm
   de rotinas-modelos.js — mesma fonte usada pelo instalador do Supabase, para
   demo e produção nunca divergirem. */
export const GESTAO_OP = {
  op_tipos_atividade:  OP_TIPOS_ATIVIDADE,
  op_categorias:       OP_CATEGORIAS,
  op_atividades:       [...OP_ATIVIDADES, ...MODELOS_ATIVIDADES],
  op_atividade_itens:  [...OP_ATIVIDADE_ITENS, ...MODELOS_ITENS],
  op_atribuicoes:      OP_ATRIBUICOES,
  op_agenda:           OP_AGENDA,
  op_execucao:         [],
  op_execucao_itens:   [],
  op_pendencias:       [],
  /* §M06 — catálogos de contexto das regras condicionais */
  op_substancias:      OP_SUBSTANCIAS,
  op_processos:        OP_PROCESSOS
};
