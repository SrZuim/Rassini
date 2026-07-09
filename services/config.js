/* ==========================================================================
   RNA One — Configuração central
   - Conexão Supabase (preencha para usar backend real; vazio = modo demo local)
   - Catálogo de módulos, perfis, RBAC, status e constantes de domínio
   ========================================================================== */

export const SUPABASE = {
  // Preencha com seu projeto Supabase para ativar backend real.
  // Enquanto vazio, a plataforma roda em MODO DEMO (localStorage + dados semente).
  url: 'https://xlpppgtgczrwzoxhnztl.supabase.co',
  anonKey: 'sb_publishable_prDLB2oXpUyu8BLJZSTh2g_vLGkPUwd',
  get enabled() { return Boolean(this.url && this.anonKey); }
};

export const BRAND = {
  name: 'RNA One',
  full: 'Plataforma Integrada de Operações Industriais',
  company: 'Rassini NHK Automotive',
  logo: 'assets/rassini/logo-rna.jpeg',
  banners: [
    'assets/rassini/banner-main.png',
    'assets/rassini/banner-molas.jpg',
    'assets/rassini/banner-1.jpeg',
    'assets/rassini/banner-2.jpg',
    'assets/rassini/banner-3.jpeg',
    'assets/rassini/banner-6.jpg'
  ],
  factory: 'assets/rassini/fabrica.jpeg',
  auditores: 'assets/rassini/auditores.png'
};

/* ----------------------------------------------------------------- perfis */
export const ROLES = {
  admin:      { id: 'admin',      label: 'Administrador', icon: 'bi-shield-lock',  color: 'red' },
  supervisor: { id: 'supervisor', label: 'Supervisor',    icon: 'bi-person-gear',  color: 'orange' },
  auditor:    { id: 'auditor',    label: 'Auditor',       icon: 'bi-clipboard-check', color: 'blue' },
  visitante:  { id: 'visitante',  label: 'Visitante',     icon: 'bi-person',       color: 'gray' }
};

/* ----------------------------------------------------------------- módulos */
/* group: agrupamento na sidebar · roles: quem vê/acessa · actions definidas no RBAC */
export const MODULES = [
  { id:'dashboard',     label:'Dashboard',            short:'Indicadores',         page:'dashboard.html',     icon:'bi-grid-1x2',          group:'Operação',    color:'yellow', desc:'Indicadores e KPIs em tempo real do plantão.' },
  { id:'monitoramento', label:'Monitoramento',        short:'Gestão à Vista',      page:'monitoramento.html', icon:'bi-display',           group:'Operação',    color:'blue',   desc:'Painel Andon e gestão à vista das linhas.' },
  { id:'checkin',       label:'Check-in do Plantão',  short:'Plantão',             page:'checkin.html',       icon:'bi-box-arrow-in-right',group:'Operação',    color:'green',  desc:'Inicie o plantão e carregue suas rotinas.' },
  { id:'rotinas',       label:'Rotina Obrigatória',   short:'Rotina Obrig.',       page:'rotinas.html',       icon:'bi-list-check',        group:'Fluxo do Auditor', color:'yellow', desc:'Rotinas obrigatórias do dia (planilha 2026).' },
  { id:'checklist',     label:'Checklist Obrigatório',short:'Checklist',           page:'checklist.html',     icon:'bi-ui-checks',         group:'Fluxo do Auditor', color:'orange', desc:'Checklist por categoria (Grampo/Lâminas/Helicoidal).' },
  { id:'auditoria',     label:'Auditoria de Peças',   short:'Auditoria',           page:'auditoria.html',     icon:'bi-search',            group:'Fluxo do Auditor', color:'green',  desc:'Auditoria por peça com cálculo de tempo.' },
  /* [GESTÃO OPERACIONAL] Novo fluxo do auditor — atividades configuráveis atribuídas automaticamente. */
  { id:'op_plantao',    label:'Plantão',              short:'Plantão',             page:'op-plantao.html',    icon:'bi-broadcast',         group:'Operações',   color:'green',  desc:'Inicie o plantão e veja as atividades atribuídas a você.' },
  { id:'op_rotinas',    label:'Minhas Rotinas',       short:'Minhas Rotinas',      page:'op-minhas-rotinas.html', icon:'bi-list-check',    group:'Operações',   color:'yellow', desc:'Execute as rotinas atribuídas a você.' },
  { id:'op_checklists', label:'Meus Checklists',      short:'Meus Checklists',     page:'op-em-breve.html',   icon:'bi-ui-checks',         group:'Operações',   color:'orange', desc:'Checklists atribuídos (próxima fase).' },
  { id:'op_auditorias', label:'Minhas Auditorias',    short:'Minhas Auditorias',   page:'op-em-breve.html',   icon:'bi-search',            group:'Operações',   color:'blue',   desc:'Auditorias atribuídas (próxima fase).' },
  { id:'op_pendencias', label:'Pendências',           short:'Pendências',          page:'op-pendencias.html', icon:'bi-exclamation-circle',group:'Operações',   color:'red',    desc:'Suas pendências abertas.' },
  { id:'op_historico',  label:'Histórico',            short:'Histórico',           page:'op-historico.html',  icon:'bi-clock-history',     group:'Operações',   color:'gray',   desc:'Histórico das suas atividades.' },
  { id:'diario',        label:'Diário de Bordo',      short:'Diário',              page:'diario.html',        icon:'bi-journal-text',      group:'Operação',    color:'gray',   desc:'Registro cronológico das atividades.' },
  { id:'auditorias',    label:'Auditorias de Processo',short:'Aud. Processo',      page:'auditorias.html',    icon:'bi-clipboard-data',    group:'Qualidade',   color:'blue',   desc:'Auditorias de processo, 5S e LPA.' },
  { id:'biblioteca',    label:'Biblioteca Técnica',   short:'Biblioteca',          page:'biblioteca.html',    icon:'bi-journal-richtext',  group:'Qualidade',   color:'blue',   desc:'Fichas técnicas das peças: medidas, tolerâncias, normas e documentos.' },
  { id:'ocorrencias',   label:'Não Conformidades',    short:'Ocorrências',         page:'ocorrencias.html',   icon:'bi-exclamation-octagon',group:'Qualidade',  color:'red',    desc:'Abertura e tratativa de não conformidades.' },
  { id:'planos',        label:'Plano de Ação',        short:'Planos',              page:'planos-acao.html',   icon:'bi-diagram-3',         group:'Qualidade',   color:'yellow', desc:'Ações corretivas 5W2H vinculadas a NCs.' },
  { id:'powerbi',       label:'Power BI',             short:'Power BI',            page:'dashboard.html#bi',  icon:'bi-bar-chart-line',    group:'Gestão',      color:'orange', desc:'Relatórios corporativos embarcados.' },
  { id:'comunicados',   label:'Comunicados',          short:'Comunicados',         page:'documentos.html#comunicados', icon:'bi-megaphone',group:'Gestão',     color:'blue',   desc:'Avisos e comunicados da planta.' },
  { id:'documentos',    label:'Documentos',           short:'Documentos',          page:'documentos.html',    icon:'bi-folder2-open',      group:'Gestão',      color:'gray',   desc:'Procedimentos, normas e instruções.' },
  { id:'treinamentos',  label:'Treinamentos',         short:'Treinamentos',        page:'treinamentos.html',  icon:'bi-mortarboard',       group:'Gestão',      color:'green',  desc:'Trilhas e capacitações da equipe.' },
  { id:'admin',         label:'Administração',        short:'Admin',               page:'admin.html',         icon:'bi-sliders',           group:'Gestão',      color:'red',    desc:'Cadastros editáveis: rotinas, checklist, peças e listas.' },
  /* [GESTÃO OPERACIONAL] Cadastro configurável de atividades (rotinas/checklists/auditorias). */
  { id:'gestao_op',     label:'Gestão Operacional',   short:'Gestão Op.',          page:'gestao-operacional.html', icon:'bi-diagram-3-fill', group:'Administração', color:'red', desc:'Cadastre rotinas, checklists, auditorias, categorias, atribuições e agenda — sem código.' },
  /* [MÓDULO USUÁRIOS] Administração de Usuários — cadastro, aprovação e gestão (só admin). */
  { id:'usuarios',      label:'Administração de Usuários', short:'Usuários',        page:'admin-usuarios.html',icon:'bi-people',            group:'Administração', color:'red', desc:'Solicitações de acesso, aprovação, cargos e bloqueios.' },
  { id:'perfil',        label:'Meu Perfil',           short:'Perfil',              page:'perfil.html',        icon:'bi-person-circle',     group:'Gestão',      color:'gray',   desc:'Seus dados, plantões e produtividade.' }
];

/* ----------------------------------------------------------------- RBAC ---
   Matriz de permissões por perfil → módulo → ações.
   '*' = todas as ações; [] = sem acesso. Ações: view, create, edit, delete, approve, export */
const ALL = ['view','create','edit','delete','approve','export','execute'];
const RO  = ['view','export'];   // somente consulta (supervisor)
export const RBAC = {
  /* Administrador: acesso completo a todos os módulos */
  admin: Object.fromEntries(MODULES.map(m => [m.id, ALL])),

  /* Supervisor: apenas consulta (ver + exportar). Não cria, edita, aprova ou exclui. */
  supervisor: {
    dashboard:RO, monitoramento:['view'], checkin:[],
    rotinas:['view'], diario:['view'], auditoria:RO, auditorias:RO,
    biblioteca:['view','create','edit','export'],
    gestao_op:['view'], op_plantao:[], op_rotinas:[], op_checklists:[], op_auditorias:[], op_pendencias:['view'], op_historico:['view'],
    checklist:['view'], ocorrencias:RO, planos:['view','export'],
    powerbi:['view'], comunicados:['view'], documentos:['view','export'],
    treinamentos:['view'], admin:[], usuarios:[], perfil:['view','edit']
  },

  /* Auditor: apenas operação — plantão, rotina, checklist, auditoria, diário. */
  auditor: {
    dashboard:[], monitoramento:[], checkin:['view','create'],
    rotinas:['view','edit'], diario:['view','create','edit'],
    auditoria:['view','create','edit'], auditorias:[],
    biblioteca:['view','export'],
    gestao_op:[], op_plantao:['view','create','execute'], op_rotinas:['view','execute'], op_checklists:['view'], op_auditorias:['view'], op_pendencias:['view','create'], op_historico:['view'],
    checklist:['view','create','edit'], ocorrencias:[], planos:[],
    powerbi:[], comunicados:[], documentos:[], treinamentos:[], admin:[], usuarios:[], perfil:['view','edit']
  },

  /* Visitante: somente a tela institucional (home.html). Sem acesso à plataforma. */
  visitante: {
    dashboard:[], monitoramento:[], checkin:[], rotinas:[], diario:[], auditoria:[],
    auditorias:[], biblioteca:[], checklist:[], ocorrencias:[], planos:[], powerbi:[], comunicados:[],
    documentos:[], treinamentos:[], admin:[], usuarios:[], perfil:['view']
  }
};

export function can(role, moduleId, action='view') {
  const perms = (RBAC[role] || {})[moduleId];
  return Array.isArray(perms) && perms.includes(action);
}

/* ----------------------------------------------------------------- domínio */
export const TURNOS = ['1º Turno (06:00–14:20)', '2º Turno (14:20–22:40)', '3º Turno (22:40–06:00)', 'Administrativo'];
export const PLANTAS = ['Planta Rio Nova Iguaçu', 'Planta SP 01', 'Planta SP 02'];

export const STATUS_ROTINA   = ['Pendente','Em andamento','Concluída','Postergada','Não executada'];
export const STATUS_NC       = ['Aberta','Em análise','Em andamento','Resolvida','Encerrada'];
export const STATUS_PLANO    = ['Aberto','Em andamento','Aguardando','Concluído','Atrasado'];
export const SEVERIDADES     = ['Baixa','Média','Alta','Crítica'];
export const CRITICIDADES    = ['Baixa','Média','Alta'];
export const CHECK_STATUS    = ['OK','Atenção','Crítico','Não se aplica'];

export const CHECKLIST_ITENS = [
  'Proteções','Lubrificação','Vazamentos','Ruídos','Temperatura','Pressão',
  'Segurança','Ferramentas','Limpeza','Condição operacional','Produto conforme','Documentação'
];

export const NC_TIPOS     = ['Processo','Produto','Segurança','Máquina','Documentação','Ambiental'];
export const NC_CATEGORIAS= ['Dimensional','Visual','Funcional','5S','EPI','Setup','Manutenção'];
export const NC_ORIGENS   = ['Auditoria','Checklist','Rotina','Reclamação','Inspeção','Linha'];

/* SLA por severidade (horas) — usado para alertas e timers de plano de ação */
export const SLA_HORAS = { 'Baixa':120, 'Média':72, 'Alta':24, 'Crítica':8 };

export function statusClass(status) {
  const m = {
    'Concluída':'badge-ok','Resolvida':'badge-ok','Encerrada':'badge-na','Concluído':'badge-ok','OK':'badge-ok','Ativo':'badge-ok',
    'Em andamento':'badge-info','Em análise':'badge-info','Aberta':'badge-crit','Aberto':'badge-warn','Atenção':'badge-warn',
    'Pendente':'badge-pend','Postergada':'badge-warn','Aguardando':'badge-pend',
    'Não executada':'badge-crit','Crítico':'badge-crit','Atrasado':'badge-crit',
    'Não se aplica':'badge-na'
  };
  return m[status] || 'badge-na';
}
export function sevColor(sev) {
  return { 'Baixa':'var(--sev-baixa)','Média':'var(--sev-media)','Alta':'var(--sev-alta)','Crítica':'var(--sev-critica)' }[sev] || 'var(--rna-gray)';
}
