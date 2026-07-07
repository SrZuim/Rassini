/* ==========================================================================
   RNA One — Catálogo de Auditoria (derivado das planilhas)
   Fonte:
     • Tabela de rotinas auditores 2026.xlsx  → ROTINAS_DEFAULT
     • Agenda de tarefas auditores.xlsx        → CHECKLIST_DEFAULT (Grampo / Lâminas /
                                                  Helicoidal / Atividades Auditor)
   Estes são os valores SEMENTE. Em runtime, o catálogo é lido do db (editável
   no painel Admin) — alterar a planilha = atualizar pelo Admin, sem mexer no código.
   ========================================================================== */

/* ----------------------------------------------------- ROTINA OBRIGATÓRIA -- */
export const ROTINAS_DEFAULT = [
  { id:'rt01', nome:'Envio de óleo de têmpera para curva', horario:'10:00', frequencia:'Mensal', responsavel:'Nathália', ativo:true },
  { id:'rt02', nome:'Envio de lâminas para tensão residual', horario:'10:00', frequencia:'Mensal', responsavel:'Renato', ativo:true },
  { id:'rt03', nome:'Envio de lâminas salt spray', horario:'10:00', frequencia:'Mensal', responsavel:'Renato', ativo:true },
  { id:'rt04', nome:'Reunião de sucata', horario:'08:00', frequencia:'Diário', responsavel:'Renato', ativo:true },
  { id:'rt05', nome:'Gemba CEP', horario:'08:20', frequencia:'Diário', responsavel:'Renato', ativo:true },
  { id:'rt06', nome:'Divulgação diária dos resultados de SP/SSP', horario:'12:00', frequencia:'Diário', responsavel:'Auditor', ativo:true },
  { id:'rt07', nome:'Teste de processo SP01', horario:'08:00', frequencia:'Diário', responsavel:'Auditor', ativo:true },
  { id:'rt08', nome:'Teste de processo SSP02', horario:'08:00', frequencia:'Diário', responsavel:'Auditor', ativo:true },
  { id:'rt09', nome:'Teste de processo SP03', horario:'08:00', frequencia:'Diário', responsavel:'Auditor', ativo:true },
  { id:'rt10', nome:'Teste de processo SSP04', horario:'08:00', frequencia:'Diário', responsavel:'Auditor', ativo:true },
  { id:'rt11', nome:'Teste de processo SSP05', horario:'08:00', frequencia:'Diário', responsavel:'Auditor', ativo:true },
  { id:'rt12', nome:'Teste Magnaflux — 1º Turno', horario:'09:00', frequencia:'Diário', responsavel:'Auditor 1ºT', ativo:true },
  { id:'rt13', nome:'Teste Magnaflux — 2º Turno', horario:'16:00', frequencia:'Diário', responsavel:'Auditor 2ºT', ativo:true },
  { id:'rt14', nome:'Teste Magnaflux — 3º Turno', horario:'23:00', frequencia:'Diário', responsavel:'Auditor 3ºT', ativo:true },
  { id:'rt15', nome:'Verificação de temperatura e umidade — 1º T', horario:'09:00', frequencia:'Diário', responsavel:'Auditor 1ºT', ativo:true },
  { id:'rt16', nome:'Verificação de temperatura e umidade — 2º T', horario:'16:00', frequencia:'Diário', responsavel:'Auditor 2ºT', ativo:true },
  { id:'rt17', nome:'Verificação de temperatura e umidade — 3º T', horario:'23:00', frequencia:'Diário', responsavel:'Auditor 3ºT', ativo:true },
  { id:'rt18', nome:'Quantidade de feixes verificados — 1º T', horario:'09:00', frequencia:'Diário', responsavel:'Auditor 1ºT', ativo:true },
  { id:'rt19', nome:'Quantidade de feixes verificados — 2º T', horario:'16:00', frequencia:'Diário', responsavel:'Auditor 2ºT', ativo:true },
  { id:'rt20', nome:'Quantidade de feixes verificados — 3º T', horario:'23:00', frequencia:'Diário', responsavel:'Auditor 3ºT', ativo:true }
];

/* ----------------------------------------------------- CATEGORIAS ---------- */
export const CHECKLIST_CATEGORIAS_DEFAULT = [
  { id:'cat_grampo',     nome:'Grampo',            tipo:'peça',     ativo:true },
  { id:'cat_laminas',    nome:'Lâminas',           tipo:'peça',     ativo:true },
  { id:'cat_helicoidal', nome:'Helicoidal',        tipo:'peça',     ativo:true },
  { id:'cat_auditor',    nome:'Atividades Auditor', tipo:'comum',   ativo:true }
];

/* ----------------------------------------------------- CHECKLIST ----------- */
/* status default Pendente; resposta OK / NOK / N/A */
const ck = (categoria, nome, frequencia='Diário') => ({ id:'ck_'+Math.random().toString(36).slice(2,8), categoria, nome, frequencia, ativo:true });

export const CHECKLIST_DEFAULT = [
  // ---- Grampo ----
  ck('Grampo','Devolução'), ck('Grampo','Amostras'), ck('Grampo','Registro de Não-Conforme'),
  ck('Grampo','Rondas na Fábrica'), ck('Grampo','Liberação SAP'), ck('Grampo','Liberação Matéria-prima'),
  ck('Grampo','Repasse de Alertas'), ck('Grampo','Salt-Spray','Mensal'), ck('Grampo','Auditoria'),
  ck('Grampo','Granulometria','Semanal'), ck('Grampo','Teste Almen e Cobertura'), ck('Grampo','Tensão Residual','Mensal'),
  ck('Grampo','Torpedo'), ck('Grampo','Rugosidade'),

  // ---- Lâminas ----
  ck('Lâminas','Liberação Setup'), ck('Lâminas','Camada e Viscosidade'), ck('Lâminas','Rugosidade'),
  ck('Lâminas','Amostras'), ck('Lâminas','Registro de Não-Conforme'), ck('Lâminas','Teste Almen e Cobertura'),
  ck('Lâminas','Rondas na Fábrica'), ck('Lâminas','Torpedo'), ck('Lâminas','Liberação SAP'),
  ck('Lâminas','Liberação Matéria-prima'), ck('Lâminas','Carga de Retirada','Mensal'), ck('Lâminas','Granulometria','Semanal'),
  ck('Lâminas','Repasse de Alertas'), ck('Lâminas','Salt-Spray','Mensal'), ck('Lâminas','Lâminas de Reposição'),
  ck('Lâminas','Devolução'), ck('Lâminas','Tensão Residual','Mensal'),

  // ---- Helicoidal ----
  ck('Helicoidal','Fadiga Setup'), ck('Helicoidal','Modelo de carga'), ck('Helicoidal','Modelos de Reposição'),
  ck('Helicoidal','Garantia'), ck('Helicoidal','Amostras'), ck('Helicoidal','Registro de Não-Conforme'),
  ck('Helicoidal','Teste Almen e Cobertura'), ck('Helicoidal','Rondas na Fábrica'), ck('Helicoidal','Envelope'),
  ck('Helicoidal','Liberação SAP'), ck('Helicoidal','Liberação Matéria-prima'), ck('Helicoidal','Granulometria','Semanal'),
  ck('Helicoidal','Repasse de Alertas'), ck('Helicoidal','Dureza'), ck('Helicoidal','Auditoria'),
  ck('Helicoidal','Devolução'), ck('Helicoidal','Tensão Residual','Mensal'),

  // ---- Atividades Auditor (Planilha3) ----
  ck('Atividades Auditor','Auditar peças de Produção','1 pç por OP'),
  ck('Atividades Auditor','Auditar peças de Produção-Reposição','1 pç/dia c/ produção'),
  ck('Atividades Auditor','Teste de Carga de retirada','Mensal'),
  ck('Atividades Auditor','Auditoria de produto final — Reposição (Montagem)','1 OP/dia'),
  ck('Atividades Auditor','Auditoria de produto final — Produção (Montagem)','1 feixe/OP'),
  ck('Atividades Auditor','Pré-Inspeção','1 pç/produto'),
  ck('Atividades Auditor','Auditoria de produto final — Feixe de molas','1 pç/OP/Lote'),
  ck('Atividades Auditor','Ensaio Funcional','Anual'),
  ck('Atividades Auditor','Inspeção de Cobertura','1x dia / 5x semana'),
  ck('Atividades Auditor','Inspeção de Granulometria','Semanal'),
  ck('Atividades Auditor','Inspeção de Arco Almen','1x dia / 5x semana'),
  ck('Atividades Auditor','Camada e viscosidade da Tinta','Diário'),
  ck('Atividades Auditor','Rugosidade e Torpedo','1 pç/OP/Lote'),
  ck('Atividades Auditor','SAP — Liberação e Movimentação','Quando solicitado'),
  ck('Atividades Auditor','Registro de Não-Conforme','Quando rejeitado'),
  ck('Atividades Auditor','Rondas na Fábrica','Diário'),
  ck('Atividades Auditor','Repasse de Alertas','Semanal')
];

/* ----------------------------------------------------- PEÇAS + TEMPO MÉDIO - */
/* tempo_medio em minutos — editável no Admin */
export const PECAS_DEFAULT = [
  { id:'pc01', nome:'Feixe de molas',           codigo:'FM',  tempo_medio:50, ativo:true },
  { id:'pc02', nome:'Lâmina',                    codigo:'LM',  tempo_medio:30, ativo:true },
  { id:'pc03', nome:'Grampo',                    codigo:'GR',  tempo_medio:20, ativo:true },
  { id:'pc04', nome:'Mola Helicoidal',           codigo:'HC',  tempo_medio:35, ativo:true },
  { id:'pc05', nome:'Produto Final (Montagem)',  codigo:'PF',  tempo_medio:45, ativo:true },
  { id:'pc06', nome:'Pré-Inspeção',              codigo:'PI',  tempo_medio:25, ativo:true },
  { id:'pc07', nome:'Ensaio Funcional',          codigo:'EF',  tempo_medio:60, ativo:true }
];

/* ----------------------------------------------------- LISTAS DE APOIO ----- */
export const TIPOS_AUDITORIA_DEFAULT = [
  { id:'ta1', nome:'Produção', ativo:true },
  { id:'ta2', nome:'Produção-Reposição', ativo:true },
  { id:'ta3', nome:'Produto Final', ativo:true },
  { id:'ta4', nome:'Pré-Inspeção', ativo:true },
  { id:'ta5', nome:'Feixe de Molas', ativo:true },
  { id:'ta6', nome:'Ensaio Funcional', ativo:true },
  { id:'ta7', nome:'Pintura', ativo:true },
  { id:'ta8', nome:'Dimensional', ativo:true }
];

export const MOTIVOS_ATRASO_DEFAULT = [
  { id:'ma1', nome:'Problema na peça', ativo:true },
  { id:'ma2', nome:'Falta de documentação', ativo:true },
  { id:'ma3', nome:'Aguardando produção', ativo:true },
  { id:'ma4', nome:'Peça com não conformidade', ativo:true },
  { id:'ma5', nome:'Dúvida técnica', ativo:true },
  { id:'ma6', nome:'Reinspeção necessária', ativo:true },
  { id:'ma7', nome:'Falha no sistema', ativo:true },
  { id:'ma8', nome:'Outro motivo', ativo:true }
];

export const MOTIVOS_NC_DEFAULT = [
  { id:'mn1', nome:'Dimensional fora de especificação', ativo:true },
  { id:'mn2', nome:'Defeito visual', ativo:true },
  { id:'mn3', nome:'Falha funcional', ativo:true },
  { id:'mn4', nome:'Documentação incorreta', ativo:true },
  { id:'mn5', nome:'Material não conforme', ativo:true },
  { id:'mn6', nome:'Pintura / cobertura', ativo:true },
  { id:'mn7', nome:'Outro', ativo:true }
];

/* Mapa nome→default para o seeding/reset do catálogo */
export const CATALOGOS = {
  cat_rotinas:        ROTINAS_DEFAULT,
  cat_categorias:     CHECKLIST_CATEGORIAS_DEFAULT,
  cat_checklist:      CHECKLIST_DEFAULT,
  cat_pecas:          PECAS_DEFAULT,
  cat_tipos_auditoria:TIPOS_AUDITORIA_DEFAULT,
  cat_motivos_atraso: MOTIVOS_ATRASO_DEFAULT,
  cat_motivos_nc:     MOTIVOS_NC_DEFAULT
};
