-- =============================================================================
-- RNA One — Plataforma Integrada de Operações Industriais
-- Rassini NHK Automotive · Esquema de banco (PostgreSQL / Supabase)
-- Execute no SQL Editor do Supabase (ordem: schema → rls → seed)
-- =============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------- ENUMS ----
do $$ begin
  create type perfil_tipo      as enum ('admin','supervisor','auditor','visitante');
  create type status_rotina    as enum ('Pendente','Em andamento','Concluída','Postergada','Não executada');
  create type status_nc        as enum ('Aberta','Em análise','Em andamento','Resolvida','Encerrada');
  create type status_plano     as enum ('Aberto','Em andamento','Aguardando','Concluído','Atrasado');
  create type severidade_tipo  as enum ('Baixa','Média','Alta','Crítica');
  create type criticidade_tipo as enum ('Baixa','Média','Alta');
  create type check_status     as enum ('OK','Atenção','Crítico','Não se aplica');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------- DIMENSÕES ------
create table if not exists perfis (
  id text primary key,                       -- admin / supervisor / auditor / visitante
  label text not null,
  permissoes jsonb not null default '{}'
);

create table if not exists usuarios (
  id uuid primary key default gen_random_uuid(),
  auth_id uuid unique,                        -- referência a auth.users
  nome text not null,
  email text unique not null,
  role perfil_tipo not null default 'visitante',
  matricula text,
  area text,
  planta text,
  avatar text,
  ativo boolean default true,
  created_at timestamptz default now()
);

create table if not exists supervisores (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references usuarios(id) on delete cascade,
  area text, planta text
);

create table if not exists auditores (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid references usuarios(id) on delete cascade,
  turno text, area text, certificacoes jsonb default '[]'
);

create table if not exists areas (
  id uuid primary key default gen_random_uuid(),
  nome text not null, responsavel text, planta text
);

create table if not exists linhas (
  id uuid primary key default gen_random_uuid(),
  nome text not null, area_id uuid references areas(id), maquinas int default 0
);

create table if not exists maquinas (
  id uuid primary key default gen_random_uuid(),
  tag text unique not null, nome text not null,
  linha_id uuid references linhas(id), area text,
  criticidade criticidade_tipo default 'Média',
  status text default 'Operando', oee int default 0
);

-- ----------------------------------------------------------- OPERAÇÃO -------
create table if not exists rotinas (
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null, nome text not null, descricao text,
  area text, linha text, maquina text, turno text,
  horario text, tempo_padrao int, criticidade criticidade_tipo default 'Média',
  obrigatoria boolean default true, foto_obrigatoria boolean default false,
  obs_obrigatoria boolean default false,
  status status_rotina default 'Pendente',
  auditor uuid references usuarios(id),
  created_at timestamptz default now()
);

create table if not exists plantoes (
  id uuid primary key default gen_random_uuid(),
  usuario uuid references usuarios(id), usuario_nome text,
  data date, hora text, turno text, area text, linha text, setor text,
  planta text, supervisor text, dispositivo text,
  status text default 'Aberto', created_at timestamptz default now()
);

create table if not exists atividades (
  id uuid primary key default gen_random_uuid(),
  plantao_id uuid references plantoes(id),
  rotina text, maquina text, peca text, quantidade int default 0,
  inicio text, fim text, tempo int, tempo_padrao int,
  resultado text, obs text, justificativa text,
  fotos jsonb default '[]', auditor uuid references usuarios(id),
  created_at timestamptz default now()
);

create table if not exists auditorias (
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null, tipo text, area text, linha text,
  auditor uuid references usuarios(id), data date,
  conformidade int default 0, ncs int default 0, status text default 'Em andamento'
);

create table if not exists checklist (
  id uuid primary key default gen_random_uuid(),
  maquina text, linha text, auditor uuid references usuarios(id),
  data date, turno text, resultado text, criticos int default 0,
  status text default 'Em andamento', created_at timestamptz default now()
);

create table if not exists checklist_itens (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid references checklist(id) on delete cascade,
  item text not null, status check_status default 'OK',
  observacao text, foto text
);

-- ----------------------------------------------------------- QUALIDADE ------
create table if not exists nao_conformidades (
  id uuid primary key default gen_random_uuid(),
  codigo text unique not null, tipo text, categoria text, origem text,
  maquina text, linha text, area text, descricao text not null,
  severidade severidade_tipo default 'Média',
  responsavel uuid references usuarios(id), prazo date,
  status status_nc default 'Aberta', abertura date default now(),
  created_at timestamptz default now()
);

create table if not exists planos_acao (
  id uuid primary key default gen_random_uuid(),
  nc text references nao_conformidades(codigo),
  codigo text unique, responsavel uuid references usuarios(id),
  prazo date, acao text, evidencias jsonb default '[]', comentarios jsonb default '[]',
  status status_plano default 'Aberto', progresso int default 0,
  abertura date default now()
);

create table if not exists evidencias (
  id uuid primary key default gen_random_uuid(),
  entidade text,                 -- rotina | checklist | auditoria | ocorrencia | plano
  entidade_id text,              -- id do registro vinculado
  nome text, url text, tipo text,
  usuario text, "dataHora" timestamptz default now(),
  created_by uuid references usuarios(id), created_at timestamptz default now()
);

-- ----------------------------------------------------------- GESTÃO ---------
create table if not exists comunicados (
  id uuid primary key default gen_random_uuid(),
  titulo text not null, resumo text, conteudo text, autor text,
  data date default now(), tag text, img text, fixado boolean default false
);

create table if not exists documentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null, tipo text, area text, versao text,
  data date default now(), tamanho text, url text
);

create table if not exists treinamentos (
  id uuid primary key default gen_random_uuid(),
  nome text not null, carga text, categoria text,
  progresso int default 0, status text default 'Não iniciado', img text
);

-- ----------------------------------------------------------- SISTEMA --------
create table if not exists logs (
  id uuid primary key default gen_random_uuid(),
  usuario text, acao text, entidade text,
  antes text, depois text, quando timestamptz default now(),
  dispositivo text, ip inet
);

create table if not exists configuracoes (
  id uuid primary key default gen_random_uuid(),
  chave text unique not null, valor jsonb, descricao text
);

create table if not exists notificacoes (
  id uuid primary key default gen_random_uuid(),
  destinatario uuid references usuarios(id),
  tipo text, titulo text, texto text,
  lida boolean default false, created_at timestamptz default now()
);

-- ===========================================================================
-- FLUXO DO AUDITOR (derivado das planilhas) — catálogos editáveis + execução
-- ===========================================================================
create table if not exists cat_rotinas (
  id text primary key, nome text not null, horario text, frequencia text,
  responsavel text, ativo boolean default true
);
create table if not exists cat_categorias (
  id text primary key, nome text not null, tipo text, ativo boolean default true
);
create table if not exists cat_checklist (
  id text primary key, categoria text not null, nome text not null,
  frequencia text, ativo boolean default true
);
create table if not exists cat_pecas (
  id text primary key, nome text not null, codigo text,
  tempo_medio int default 60, ativo boolean default true
);
-- cadastro central de funcionários (auditor / supervisor / equipe)
create table if not exists funcionarios (
  id text primary key, matricula text unique, nome text not null,
  area text, planta text, ativo boolean default true
);

create table if not exists cat_tipos_auditoria  ( id text primary key, nome text not null, ativo boolean default true );
create table if not exists cat_motivos_atraso    ( id text primary key, nome text not null, ativo boolean default true );
create table if not exists cat_motivos_nc        ( id text primary key, nome text not null, ativo boolean default true );

-- execução: cada item respondido no plantão
create table if not exists rotina_exec (
  id uuid primary key default gen_random_uuid(),
  plantao_id uuid references plantoes(id) on delete cascade,
  rotina_id text, status text default 'Pendente', hora text, obs text,
  evidencia text, auditor uuid references usuarios(id), created_at timestamptz default now()
);
create table if not exists checklist_exec (
  id uuid primary key default gen_random_uuid(),
  plantao_id uuid references plantoes(id) on delete cascade,
  item_id text, categoria text, status text default 'Pendente', hora text,
  justificativa text, foto text, auditor uuid references usuarios(id), created_at timestamptz default now()
);
create table if not exists auditorias_peca (
  id uuid primary key default gen_random_uuid(),
  plantao_id uuid references plantoes(id) on delete cascade,
  auditor uuid references usuarios(id), auditor_nome text,
  peca text, peca_id text, codigo text, op_lote text, tipo text,
  inicio_iso timestamptz, inicio text, fim_iso timestamptz, fim text,
  tempo_total int, tempo_medio int, status text default 'Em andamento',
  excedeu boolean default false, motivo_atraso text, justificativa text, obs text,
  created_at timestamptz default now()
);
-- categoria escolhida do checklist no plantão
alter table plantoes add column if not exists categoria_checklist text;
alter table plantoes add column if not exists inicio_iso timestamptz;
alter table plantoes add column if not exists fim_iso timestamptz;

-- ----------------------------------------------------------- ÍNDICES --------
create index if not exists idx_rotinaexec_plantao on rotina_exec(plantao_id);
create index if not exists idx_chkexec_plantao on checklist_exec(plantao_id);
create index if not exists idx_auditpeca_plantao on auditorias_peca(plantao_id);
create index if not exists idx_rotinas_status on rotinas(status);
create index if not exists idx_nc_status      on nao_conformidades(status);
create index if not exists idx_nc_sev         on nao_conformidades(severidade);
create index if not exists idx_planos_status  on planos_acao(status);
create index if not exists idx_logs_quando    on logs(quando desc);

-- ----------------------------------------------------------- TRIGGER LOG ----
-- Registra antes/depois automaticamente em tabelas críticas
create or replace function fn_audit_log() returns trigger as $$
begin
  insert into logs(usuario, acao, entidade, antes, depois)
  values (
    coalesce(auth.uid()::text,'sistema'),
    tg_op || ' em ' || tg_table_name,
    tg_table_name,
    case when tg_op='UPDATE' then (old.status)::text else '—' end,
    case when tg_op='DELETE' then '—' else (new.status)::text end
  );
  return coalesce(new, old);
end $$ language plpgsql;

do $$ begin
  create trigger trg_log_nc      after update on nao_conformidades for each row execute function fn_audit_log();
  create trigger trg_log_planos  after update on planos_acao       for each row execute function fn_audit_log();
  create trigger trg_log_rotinas after update on rotinas           for each row execute function fn_audit_log();
exception when duplicate_object then null; end $$;
