-- =============================================================================
-- RNA One — Dados iniciais (seed) para Supabase
-- Execute após schema.sql e rls.sql
-- Obs.: crie os usuários no Supabase Auth e vincule auth_id depois.
-- =============================================================================

insert into perfis (id, label, permissoes) values
  ('admin','Administrador','{"all":true}'),
  ('supervisor','Supervisor','{"auditorias":["view","create","edit","approve"]}'),
  ('auditor','Auditor','{"rotinas":["view","edit"],"diario":["view","create","edit"]}'),
  ('visitante','Visitante','{"*":["view"]}')
on conflict (id) do nothing;

insert into usuarios (nome, email, role, matricula, area, planta) values
  ('Jorge Lucas','jorgelucaszuim@gmail.com','admin','RNA-0001','Qualidade','Planta São Bernardo'),
  ('Marcos Oliveira','marcos@rassini.com','supervisor','RNA-0102','Estamparia','Planta São Bernardo'),
  ('Ana Beatriz','ana@rassini.com','auditor','RNA-0233','Montagem','Planta São Bernardo'),
  ('Carlos Mendes','carlos@rassini.com','auditor','RNA-0234','Tratamento','Planta São Bernardo'),
  ('Visitante','visita@rassini.com','visitante','—','—','Planta São Bernardo')
on conflict (email) do nothing;

insert into areas (nome, responsavel, planta) values
  ('Estamparia','Marcos Oliveira','Planta São Bernardo'),
  ('Montagem','Ana Beatriz','Planta São Bernardo'),
  ('Tratamento Térmico','Carlos Mendes','Planta São Bernardo'),
  ('Usinagem','Marcos Oliveira','Planta São Bernardo')
on conflict do nothing;

insert into maquinas (tag, nome, area, criticidade, status, oee) values
  ('PR-1450','Prensa Hidráulica 1450T','Estamparia','Alta','Operando',87),
  ('PR-0800','Prensa Excêntrica 800T','Estamparia','Média','Operando',79),
  ('FN-0204','Forno de Têmpera 204','Tratamento Térmico','Alta','Atenção',71),
  ('CN-0312','Centro Usinagem CNC 312','Usinagem','Média','Operando',91),
  ('MT-0501','Montadora de Feixes 501','Montagem','Alta','Parada',0),
  ('GR-0118','Granalhadora 118','Tratamento Térmico','Baixa','Operando',83)
on conflict (tag) do nothing;

insert into configuracoes (chave, valor, descricao) values
  ('sla_horas','{"Baixa":120,"Média":72,"Alta":24,"Crítica":8}','SLA por severidade (horas)'),
  ('powerbi','{"reportId":"","workspaceId":""}','Configuração de embed do Power BI'),
  ('pipefy','{"pipeId":"","token":""}','Integração com Pipefy'),
  ('turnos','["1º Turno","2º Turno","3º Turno","Administrativo"]','Turnos de trabalho')
on conflict (chave) do nothing;

-- Comunicados / Documentos / Treinamentos de exemplo
insert into comunicados (titulo, resumo, autor, tag, img, fixado) values
  ('SIPAT 2026','Semana Interna de Prevenção de Acidentes — 06 a 10/07.','RH / SESMT','Segurança','assets/rassini/banner-3.jpeg',true),
  ('Novo procedimento SMED','Atualização do PO-ES-014 com tempos-alvo de setup.','Engenharia','Processo','assets/rassini/banner-1.jpeg',false)
on conflict do nothing;
