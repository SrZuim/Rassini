-- =============================================================================
-- RNA One — Gestão Operacional (Fase 1: Rotinas configuráveis)
-- Rassini NHK Automotive · Esquema + RLS + seed (PostgreSQL / Supabase)
-- -----------------------------------------------------------------------------
-- Execute no SQL Editor do Supabase APÓS schema.sql e rls.sql
-- (usa o helper current_perfil() de rls.sql). Idempotente.
-- Nenhuma rotina/checklist fica fixa no código — tudo vem destas tabelas.
-- =============================================================================

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------- TIPOS -------
create table if not exists op_tipos_atividade (
  id text primary key default gen_random_uuid()::text,
  slug text not null unique, nome text not null, cor text, icone text, ativo boolean default true
);
create table if not exists op_categorias (
  id text primary key default gen_random_uuid()::text,
  nome text not null, tipo_slug text, ativo boolean default true
);

-- ---------------------------------------------------------- ATIVIDADES -------
create table if not exists op_atividades (
  id text primary key default gen_random_uuid()::text,
  tipo_slug text not null default 'rotina',
  nome text not null, codigo text, descricao text, categoria text,
  planta text, setor text, linha text, processo text, maquina text, cargo text, turno text,
  frequencia text, data_inicio date, data_fim date, horario text, tempo_estimado numeric,
  obrigatoria boolean default true, prioridade text, status text default 'rascunho',
  is_template boolean default false, anexos jsonb default '[]',
  created_by text, created_at date default now(), updated_at date default now()
);
create index if not exists op_atividades_tipo_idx   on op_atividades (tipo_slug);
create index if not exists op_atividades_status_idx on op_atividades (status);

create table if not exists op_atividade_itens (
  id text primary key default gen_random_uuid()::text,
  atividade_id text references op_atividades(id) on delete cascade,
  ordem int default 0, nome text not null, descricao text,
  tipo_resposta text default 'checkbox',
  opcoes jsonb default '[]', resposta_esperada text,
  abrir_pendencia boolean default false, comentario_obrigatorio boolean default false,
  foto_obrigatoria boolean default false, obs_obrigatoria boolean default false, valor_numerico boolean default false,
  limite_min numeric, limite_max numeric, unidade text, peso numeric default 1,
  qrcode text, codigo_barras text
);
-- Colunas da Fase 2 (checklists) para quem já rodou a Fase 1:
alter table op_atividade_itens add column if not exists opcoes jsonb default '[]';
alter table op_atividade_itens add column if not exists resposta_esperada text;
alter table op_atividade_itens add column if not exists abrir_pendencia boolean default false;
alter table op_atividade_itens add column if not exists comentario_obrigatorio boolean default false;
create index if not exists op_itens_ativ_idx on op_atividade_itens (atividade_id);

create table if not exists op_atribuicoes (
  id text primary key default gen_random_uuid()::text,
  atividade_id text references op_atividades(id) on delete cascade,
  alvo_tipo text not null,            -- usuario | cargo | planta_turno | (futuros: setor,linha,maquina,processo,equipe)
  alvo_valor text, planta text, turno text, prioridade int default 1
);
create index if not exists op_atr_ativ_idx on op_atribuicoes (atividade_id);

create table if not exists op_agenda (
  id text primary key default gen_random_uuid()::text,
  atividade_id text references op_atividades(id) on delete cascade,
  tipo text default 'diaria',         -- diaria|dia_semana|semanal|mensal|por_turno|sob_demanda|a_cada_x_horas
  dias jsonb default '[]', intervalo_horas numeric, ref text
);
create index if not exists op_agenda_ativ_idx on op_agenda (atividade_id);

-- ----------------------------------------------------------- EXECUÇÃO --------
create table if not exists op_execucao (
  id text primary key default gen_random_uuid()::text,
  plantao_id text, atividade_id text references op_atividades(id) on delete cascade,
  tipo_slug text, usuario text,
  status text default 'pendente',     -- pendente|em_andamento|concluida|nao_aplicavel
  obrigatoria boolean default false, iniciado_iso timestamptz, concluido_iso timestamptz, obs text
);
create index if not exists op_exec_plantao_idx on op_execucao (plantao_id);
create index if not exists op_exec_usuario_idx on op_execucao (usuario);

create table if not exists op_execucao_itens (
  id text primary key default gen_random_uuid()::text,
  execucao_id text references op_execucao(id) on delete cascade,
  item_id text, valor text, foto text, obs text, ok boolean, status text
);
create index if not exists op_exec_itens_idx on op_execucao_itens (execucao_id);

create table if not exists op_pendencias (
  id text primary key default gen_random_uuid()::text,
  atividade_id text, execucao_id text, plantao_id text,
  descricao text, status text default 'aberta', aberta_por text, responsavel text, quando timestamptz default now()
);
create index if not exists op_pend_user_idx on op_pendencias (aberta_por);

-- =============================================================================
-- RLS
-- =============================================================================
-- Configuração (tipos/categorias/atividades/itens/atribuições/agenda):
--   leitura para autenticados; escrita para admin.
do $$
declare t text;
begin
  foreach t in array array['op_tipos_atividade','op_categorias','op_atividades','op_atividade_itens','op_atribuicoes','op_agenda'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "op_read_%1$s" on %1$s;', t);
    execute format('create policy "op_read_%1$s" on %1$s for select to authenticated using (true);', t);
    execute format('drop policy if exists "op_write_%1$s" on %1$s;', t);
    execute format($f$create policy "op_write_%1$s" on %1$s for all to authenticated
      using (current_perfil() = 'admin') with check (current_perfil() = 'admin');$f$, t);
  end loop;
end $$;

-- Execução e pendências: o usuário gerencia as suas; admin/supervisor leem tudo.
do $$
declare t text; col text;
begin
  foreach t in array array['op_execucao','op_execucao_itens','op_pendencias'] loop
    execute format('alter table %I enable row level security;', t);
  end loop;

  -- op_execucao (coluna usuario)
  drop policy if exists "op_exec_own" on op_execucao;
  create policy "op_exec_own" on op_execucao for all to authenticated
    using (usuario in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email()) or current_perfil() in ('admin','supervisor'))
    with check (usuario in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email()));

  -- op_execucao_itens (via execução do próprio usuário)
  drop policy if exists "op_exec_itens_own" on op_execucao_itens;
  create policy "op_exec_itens_own" on op_execucao_itens for all to authenticated
    using (execucao_id in (select id from op_execucao where usuario in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email())) or current_perfil() in ('admin','supervisor'))
    with check (execucao_id in (select id from op_execucao where usuario in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email())));

  -- op_pendencias (aberta_por)
  drop policy if exists "op_pend_own" on op_pendencias;
  create policy "op_pend_own" on op_pendencias for all to authenticated
    using (aberta_por in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email()) or current_perfil() in ('admin','supervisor'))
    with check (aberta_por in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email()));
end $$;

-- =============================================================================
-- SEED (idempotente)
-- =============================================================================
insert into op_tipos_atividade (slug, nome, cor, icone) values
 ('rotina','Rotina','yellow','bi-list-check'),('checklist','Checklist','orange','bi-ui-checks'),
 ('auditoria','Auditoria','green','bi-search'),('inspecao','Inspeção','blue','bi-clipboard-check'),
 ('seguranca','Segurança','red','bi-shield-check'),('qualidade','Qualidade','blue','bi-patch-check'),
 ('processo','Processo','gray','bi-gear-wide-connected'),('manutencao','Manutenção','orange','bi-wrench-adjustable'),
 ('cinco_s','5S','green','bi-grid-3x3-gap'),('meio_ambiente','Meio Ambiente','green','bi-tree'),('outro','Outro','gray','bi-three-dots')
on conflict (slug) do nothing;

insert into op_categorias (nome, tipo_slug) values
 ('Inspeção Final','rotina'),('Lubrificação','rotina'),('Setup','rotina'),('Segurança','rotina'),('5S','rotina'),('Qualidade','rotina'),
 ('Segurança','checklist'),('Qualidade','checklist'),('Processo','checklist'),('5S','checklist')
on conflict do nothing;

insert into op_atividades (id, tipo_slug, nome, codigo, descricao, categoria, planta, cargo, frequencia, horario, tempo_estimado, obrigatoria, prioridade, status, is_template) values
 ('ativ-rot-001','rotina','Inspeção de Início de Turno','ROT-001','Verificações obrigatórias na abertura do turno.','Inspeção Final','Planta Rio Nova Iguaçu','','Diária','06:30',15,true,'Alta','publicada',false),
 ('ativ-rot-002','rotina','Lubrificação de Prensas','ROT-002','Rotina diária de lubrificação das prensas.','Lubrificação','','auditor','Diária','07:00',20,true,'Média','publicada',false),
 ('ativ-rot-003','rotina','Rotina 5S da Célula','ROT-003','Organização e limpeza 5S do posto.','5S','','','Diária','',10,false,'Baixa','publicada',false),
 ('tpl-rot-setup','rotina','Template — Setup de Máquina','TPL-SETUP','Modelo reutilizável de rotina de setup.','Setup','','','Sob demanda','',30,false,'Média','publicada',true)
on conflict (id) do nothing;

insert into op_atividade_itens (id, atividade_id, ordem, nome, descricao, tipo_resposta, foto_obrigatoria, obs_obrigatoria, valor_numerico, limite_min, limite_max, unidade, peso) values
 ('it-101','ativ-rot-001',1,'Verificar uso de EPIs da equipe','','checkbox',false,true,false,null,null,'',1),
 ('it-102','ativ-rot-001',2,'Pressão da linha de ar','Manômetro do painel central','numero',false,false,true,4,6,'bar',2),
 ('it-103','ativ-rot-001',3,'Foto do painel de indicadores','','foto',true,false,false,null,null,'',1),
 ('it-201','ativ-rot-002',1,'Nível de óleo do reservatório','','numero',false,false,true,20,80,'%',2),
 ('it-202','ativ-rot-002',2,'Aplicar graxa nos pontos marcados','','checkbox',false,false,false,null,null,'',1),
 ('it-203','ativ-rot-002',3,'Foto do reservatório após lubrificação','','foto',true,false,false,null,null,'',1),
 ('it-301','ativ-rot-003',1,'Seiri — descarte do desnecessário','','checkbox',false,false,false,null,null,'',1),
 ('it-302','ativ-rot-003',2,'Seiton — organização do posto','','checkbox',false,false,false,null,null,'',1),
 ('it-303','ativ-rot-003',3,'Seiso — limpeza geral','','checkbox',false,false,false,null,null,'',1)
on conflict (id) do nothing;

insert into op_atribuicoes (id, atividade_id, alvo_tipo, alvo_valor, planta, turno, prioridade) values
 ('atr-1','ativ-rot-001','planta_turno','','Planta Rio Nova Iguaçu','',10),
 ('atr-2','ativ-rot-002','cargo','auditor','','',50),
 ('atr-3','ativ-rot-003','usuario',(select id::text from usuarios where lower(email)='ana@rassini.com' limit 1),'','',100)
on conflict (id) do nothing;

insert into op_agenda (id, atividade_id, tipo, dias) values
 ('ag-1','ativ-rot-001','diaria','[]'),('ag-2','ativ-rot-002','diaria','[]'),('ag-3','ativ-rot-003','diaria','[]')
on conflict (id) do nothing;

-- ---- Fase 2: Checklist de exemplo (CHK-001) ----
insert into op_atividades (id, tipo_slug, nome, codigo, descricao, categoria, cargo, frequencia, horario, tempo_estimado, obrigatoria, prioridade, status, is_template) values
 ('ativ-chk-001','checklist','Checklist de Segurança da Linha','CHK-001','Verificações de segurança na abertura do turno.','Segurança','auditor','Diária','06:45',12,true,'Alta','publicada',false)
on conflict (id) do nothing;

insert into op_atividade_itens (id, atividade_id, ordem, nome, tipo_resposta, opcoes, resposta_esperada, abrir_pendencia, comentario_obrigatorio, foto_obrigatoria, valor_numerico, limite_min, limite_max, unidade, peso) values
 ('itc-001','ativ-chk-001',1,'EPIs completos e em bom estado?','sim_nao','[]','Sim',true,false,false,false,null,null,'',2),
 ('itc-002','ativ-chk-001',2,'Temperatura do óleo hidráulico','numero','[]','',true,false,false,true,35,60,'°C',1),
 ('itc-003','ativ-chk-001',3,'Condição geral da célula','lista','["Bom","Regular","Ruim"]','Bom',false,false,false,false,null,null,'',1),
 ('itc-004','ativ-chk-001',4,'Riscos identificados (marque todos)','multipla','["Vazamento","Ruído anormal","Piso escorregadio","Nenhum"]','',false,true,false,false,null,null,'',1),
 ('itc-005','ativ-chk-001',5,'Foto do quadro de gestão à vista','foto','[]','',false,false,true,false,null,null,'',1),
 ('itc-006','ativ-chk-001',6,'Assinatura do responsável','assinatura','[]','',false,false,false,false,null,null,'',1)
on conflict (id) do nothing;

insert into op_atribuicoes (id, atividade_id, alvo_tipo, alvo_valor, prioridade) values
 ('atr-chk-1','ativ-chk-001','cargo','auditor',50)
on conflict (id) do nothing;

insert into op_agenda (id, atividade_id, tipo, dias) values
 ('ag-chk-1','ativ-chk-001','diaria','[]')
on conflict (id) do nothing;
