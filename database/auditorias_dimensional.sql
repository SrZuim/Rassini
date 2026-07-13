-- =============================================================================
-- RNA One — Auditorias Dimensionais + Monitoramento Operacional
-- Rassini NHK Automotive · Esquema + RLS + seed (PostgreSQL / Supabase)
-- -----------------------------------------------------------------------------
-- Execute no SQL Editor do Supabase APÓS schema.sql, rls.sql e biblioteca_tecnica.sql
-- (usa os helpers current_perfil() / auth_email() de rls.sql). Idempotente.
-- Módulo "Minhas Auditorias" (inspeção dimensional) + eventos/monitoramento (§40-71).
-- Consome bib_pecas / bib_metricas (Biblioteca Técnica) como fonte das especificações.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------- TIPOS DE INSPEÇÃO (§3)
create table if not exists insp_tipos (
  id text primary key default gen_random_uuid()::text,
  slug text not null unique, nome text not null,
  is_dimensional boolean default true, ordem int default 0, ativo boolean default true,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

-- ---------------------------------------------- CLASSES DE DEFEITO (§13-15)
create table if not exists insp_classes (
  id text primary key default gen_random_uuid()::text,
  codigo text not null unique, nome text not null, ordem int default 0, ativo boolean default true,
  gravidade text, cor text, definicao text,
  criterios jsonb default '[]', acoes_imediatas jsonb default '[]', acoes_permanentes jsonb default '[]',
  obrig jsonb default '{}', gera_pendencia text default 'opcional'
);

-- --------------------------------------------------------- RELATÓRIOS (§33)
create table if not exists insp_relatorios (
  id text primary key default gen_random_uuid()::text,
  numero text not null unique,
  tipo_id text references insp_tipos(id), tipo_slug text, tipo_nome text, is_dimensional boolean default true,
  -- peça (snapshot da Biblioteca Técnica)
  peca_id text, peca_codigo text, peca_nome text, cliente text,
  revisao_desenho text, data_revisao_desenho text, numero_ad text, quadrante text,
  -- identificação
  quantidade int, lote text, op text, campos_opcionais jsonb default '{}',
  -- contexto operacional
  planta text, linha text, turno text, plantao_id text,
  -- auditor (sessão)
  auditor_id text, auditor_nome text, auditor_matricula text, auditor_email text, auditor_perfil text,
  -- estado / resultado calculado
  status text default 'rascunho', resultado text default 'pendente', etapa int default 0,
  started_iso timestamptz default now(), updated_iso timestamptz default now(),
  completed_iso timestamptz, duracao_seg int,
  created_at date default now()
);
create index if not exists insp_rel_auditor_idx on insp_relatorios (auditor_id);
create index if not exists insp_rel_peca_idx    on insp_relatorios (peca_id);
create index if not exists insp_rel_status_idx  on insp_relatorios (status);
create index if not exists insp_rel_lote_idx    on insp_relatorios (lote);
create index if not exists insp_rel_op_idx      on insp_relatorios (op);
create index if not exists insp_rel_plantao_idx on insp_relatorios (plantao_id);

-- ---------------------------------------------------- CARACTERÍSTICAS (§8)
create table if not exists insp_caracteristicas (
  id text primary key default gen_random_uuid()::text,
  relatorio_id text references insp_relatorios(id) on delete cascade,
  metrica_id text, cota text, quadrante text, caracteristica text, referencia text, unidade text,
  nominal numeric, minimo numeric, maximo numeric, equipamento text, observacao_tec text,
  tipo_campo text default 'numerico', opcoes jsonb,
  resultado text default 'pendente', classe_defeito text, observacao text, ordem int default 0
);
create index if not exists insp_car_rel_idx on insp_caracteristicas (relatorio_id);

-- ------------------------------------------------------- MEDIÇÕES (§8-9)
create table if not exists insp_medicoes (
  id text primary key default gen_random_uuid()::text,
  relatorio_id text references insp_relatorios(id) on delete cascade,
  caracteristica_id text references insp_caracteristicas(id) on delete cascade,
  amostra int not null, valor text, resultado text default 'pendente', medido_iso timestamptz default now(),
  unique (caracteristica_id, amostra)
);
create index if not exists insp_med_rel_idx on insp_medicoes (relatorio_id);
create index if not exists insp_med_car_idx on insp_medicoes (caracteristica_id);

-- ------------------------------------------------- AÇÕES / TRATAMENTO (§17)
create table if not exists insp_acoes (
  id text primary key default gen_random_uuid()::text,
  relatorio_id text references insp_relatorios(id) on delete cascade,
  caracteristica_id text references insp_caracteristicas(id) on delete cascade,
  defect_class text, observacao text, acao_imediata text, acao_permanente text,
  responsavel_id text, responsavel text, prazo date, status text default 'aberta',
  pendencia_id text, created_at date default now(), updated_iso timestamptz default now()
);
create index if not exists insp_acoes_rel_idx on insp_acoes (relatorio_id);

-- ------------------------------------------------------------ ANEXOS (§17)
create table if not exists insp_anexos (
  id text primary key default gen_random_uuid()::text,
  relatorio_id text references insp_relatorios(id) on delete cascade,
  caracteristica_id text, medicao_id text,
  nome text, tipo text, url text, tamanho text, uploaded_by text, created_at timestamptz default now()
);
create index if not exists insp_anexos_rel_idx on insp_anexos (relatorio_id);

-- --------------------------------------------------------- HISTÓRICO (§21)
create table if not exists insp_historico (
  id text primary key default gen_random_uuid()::text,
  relatorio_id text references insp_relatorios(id) on delete cascade,
  user_id text, user_nome text, acao text, campo text, antes text, depois text,
  justificativa text, quando timestamptz default now()
);
create index if not exists insp_hist_rel_idx on insp_historico (relatorio_id);

-- -------------------------------------------- STREAM DE EVENTOS (§66-67)
create table if not exists insp_eventos (
  id text primary key default gen_random_uuid()::text,
  relatorio_id text, auditor_id text, plantao_id text,
  tipo_evento text not null, entidade_tipo text, entidade_id text,
  amostra int, caracteristica_id text,
  quando timestamptz default now(), session_id text, metadata jsonb default '{}'
);
create index if not exists insp_ev_rel_idx     on insp_eventos (relatorio_id);
create index if not exists insp_ev_auditor_idx on insp_eventos (auditor_id);
create index if not exists insp_ev_tipo_idx    on insp_eventos (tipo_evento);
create index if not exists insp_ev_quando_idx  on insp_eventos (quando);

-- --------------------------------------------------------- PAUSAS (§46)
create table if not exists insp_pausas (
  id text primary key default gen_random_uuid()::text,
  relatorio_id text references insp_relatorios(id) on delete cascade,
  auditor_id text, motivo text, inicio_iso timestamptz default now(), fim_iso timestamptz, duracao_seg int
);

-- ----------------------------------------- SEQUENCIAL DO RELATÓRIO (§25)
create table if not exists insp_seq (
  id text primary key default gen_random_uuid()::text,
  chave text not null unique, valor int not null default 0
);

-- Sequencial atômico (evita duplicidade em acessos simultâneos).
create or replace function next_insp_seq(p_chave text)
returns int language plpgsql as $$
declare v int;
begin
  insert into insp_seq (chave, valor) values (p_chave, 1)
    on conflict (chave) do update set valor = insp_seq.valor + 1
    returning valor into v;
  return v;
end $$;

-- =============================================================================
-- RLS
-- =============================================================================
-- Catálogos (tipos/classes): leitura para autenticados; escrita para admin.
do $$
declare t text;
begin
  foreach t in array array['insp_tipos','insp_classes'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "insp_read_%1$s" on %1$s;', t);
    execute format('create policy "insp_read_%1$s" on %1$s for select to authenticated using (true);', t);
    execute format('drop policy if exists "insp_write_%1$s" on %1$s;', t);
    execute format($f$create policy "insp_write_%1$s" on %1$s for all to authenticated
      using (current_perfil() = 'admin') with check (current_perfil() = 'admin');$f$, t);
  end loop;
end $$;

-- Relatórios e filhos: o auditor gerencia os seus; admin/supervisor/gestor leem tudo.
-- Relatório FINALIZADO não pode ser alterado pelo auditor comum (§21) — só admin/supervisor.
do $$
declare t text;
begin
  foreach t in array array['insp_relatorios','insp_caracteristicas','insp_medicoes','insp_acoes','insp_anexos','insp_historico','insp_pausas'] loop
    execute format('alter table %I enable row level security;', t);
  end loop;

  drop policy if exists "insp_rel_read" on insp_relatorios;
  create policy "insp_rel_read" on insp_relatorios for select to authenticated using (true);

  drop policy if exists "insp_rel_own_write" on insp_relatorios;
  create policy "insp_rel_own_write" on insp_relatorios for all to authenticated
    using (
      (auditor_id in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email())
        and status not in ('finalizada_aprovada','finalizada_reprovada','revisada','arquivada'))
      or current_perfil() in ('admin','supervisor')
    )
    with check (
      auditor_id in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email())
      or current_perfil() in ('admin','supervisor')
    );

  -- Filhos: seguem o dono do relatório-pai (via subquery), admin/supervisor liberados.
  drop policy if exists "insp_car_read" on insp_caracteristicas;
  create policy "insp_car_read" on insp_caracteristicas for select to authenticated using (true);
  drop policy if exists "insp_car_write" on insp_caracteristicas;
  create policy "insp_car_write" on insp_caracteristicas for all to authenticated
    using (relatorio_id in (select id from insp_relatorios where auditor_id in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email()) and status not like 'finalizada%') or current_perfil() in ('admin','supervisor'))
    with check (relatorio_id in (select id from insp_relatorios where auditor_id in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email())) or current_perfil() in ('admin','supervisor'));

  drop policy if exists "insp_med_read" on insp_medicoes;
  create policy "insp_med_read" on insp_medicoes for select to authenticated using (true);
  drop policy if exists "insp_med_write" on insp_medicoes;
  create policy "insp_med_write" on insp_medicoes for all to authenticated
    using (relatorio_id in (select id from insp_relatorios where auditor_id in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email()) and status not like 'finalizada%') or current_perfil() in ('admin','supervisor'))
    with check (relatorio_id in (select id from insp_relatorios where auditor_id in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email())) or current_perfil() in ('admin','supervisor'));

  drop policy if exists "insp_acoes_rw" on insp_acoes;
  create policy "insp_acoes_rw" on insp_acoes for all to authenticated
    using (relatorio_id in (select id from insp_relatorios where auditor_id in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email())) or current_perfil() in ('admin','supervisor'))
    with check (relatorio_id in (select id from insp_relatorios where auditor_id in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email())) or current_perfil() in ('admin','supervisor'));

  drop policy if exists "insp_anexos_rw" on insp_anexos;
  create policy "insp_anexos_rw" on insp_anexos for all to authenticated
    using (relatorio_id in (select id from insp_relatorios where auditor_id in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email())) or current_perfil() in ('admin','supervisor'))
    with check (relatorio_id in (select id from insp_relatorios where auditor_id in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email())) or current_perfil() in ('admin','supervisor'));

  -- Histórico: leitura ampla, escrita append-only por qualquer autenticado (o serviço grava).
  drop policy if exists "insp_hist_read" on insp_historico;
  create policy "insp_hist_read" on insp_historico for select to authenticated using (true);
  drop policy if exists "insp_hist_insert" on insp_historico;
  create policy "insp_hist_insert" on insp_historico for insert to authenticated with check (true);

  drop policy if exists "insp_pausas_rw" on insp_pausas;
  create policy "insp_pausas_rw" on insp_pausas for all to authenticated
    using (relatorio_id in (select id from insp_relatorios where auditor_id in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email())) or current_perfil() in ('admin','supervisor'))
    with check (relatorio_id in (select id from insp_relatorios where auditor_id in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email())) or current_perfil() in ('admin','supervisor'));
end $$;

-- Eventos (§65): auditor pode INSERIR os seus; leitura SOMENTE admin (Monitoramento).
-- Supervisor/auditor NÃO leem eventos brutos — o painel é exclusivo da administração.
alter table insp_eventos enable row level security;
drop policy if exists "insp_ev_insert" on insp_eventos;
create policy "insp_ev_insert" on insp_eventos for insert to authenticated with check (true);
drop policy if exists "insp_ev_admin_read" on insp_eventos;
create policy "insp_ev_admin_read" on insp_eventos for select to authenticated using (current_perfil() = 'admin');
drop policy if exists "insp_ev_admin_all" on insp_eventos;
create policy "insp_ev_admin_all" on insp_eventos for all to authenticated
  using (current_perfil() = 'admin') with check (current_perfil() = 'admin');

-- Sequencial: leitura/uso por autenticados (a função next_insp_seq é SECURITY INVOKER).
alter table insp_seq enable row level security;
drop policy if exists "insp_seq_rw" on insp_seq;
create policy "insp_seq_rw" on insp_seq for all to authenticated using (true) with check (true);

-- =============================================================================
-- SEED (idempotente) — tipos de inspeção (§3) e classes de defeito (§13-15)
-- =============================================================================
insert into insp_tipos (slug, nome, is_dimensional, ordem) values
 ('vda65','Auditoria VDA 6.5', true, 1),
 ('layout','Inspeção de Layout', true, 2),
 ('final','Inspeção Final', true, 3),
 ('ppap','PPAP — Processo de Aprovação de Peça de Produção', true, 4),
 ('durabilidade','Relatório para Durabilidade', true, 5),
 ('ride','Relatório para Ride', true, 6),
 ('fisico_dim','Teste Físico e Dimensional', true, 7)
on conflict (slug) do nothing;

insert into insp_classes (codigo, nome, ordem, gravidade, cor, definicao, gera_pendencia, obrig) values
 ('A','Classe A',1,'Não conformidade grave','red','Não conformidade grave, pois a ocorrência pode levar a uma não conformidade no cliente.','obrigatoria','{"observacao":true,"acao_imediata":true,"responsavel":true,"prazo":true,"evidencia":true}'),
 ('B','Classe B',2,'Não conformidade moderada','orange','Não conformidade moderada, pois pode gerar aborrecimentos ou reclamações do cliente.','justificar','{"observacao":true,"acao_imediata":true,"responsavel":true}'),
 ('C','Classe C',3,'Não conformidade leve','yellow','Não conformidade leve, pois nem todos os clientes conseguem perceber ou notar o problema.','opcional','{"observacao":true,"segregacao":true}')
on conflict (codigo) do nothing;

-- =============================================================================
-- MONITORAMENTO OPERACIONAL (§64-66) — EXCLUSIVO ADMIN
-- =============================================================================
-- Log de acessos ao painel (§64): consulta/exportação/abertura de perfil/config.
create table if not exists insp_monitor_logs (
  id text primary key default gen_random_uuid()::text,
  administrator_id text, administrator_nome text,
  action text not null, target_type text, target_id text, filter_data jsonb,
  occurred_at timestamptz default now()
);
create index if not exists insp_monlog_adm_idx on insp_monitor_logs (administrator_id);

-- Alertas operacionais (§53) — persistíveis quando o admin quiser tratar/arquivar.
create table if not exists insp_alertas (
  id text primary key default gen_random_uuid()::text,
  relatorio_id text, auditor_id text, alert_type text, severity text,
  title text, description text, status text default 'aberto',
  detected_at timestamptz default now(), reviewed_by text, reviewed_at timestamptz, review_note text
);
create index if not exists insp_alertas_status_idx on insp_alertas (status);

-- RLS: SOMENTE admin lê/gera (auditor e supervisor NÃO acessam — §65).
do $$
declare t text;
begin
  foreach t in array array['insp_monitor_logs','insp_alertas'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "insp_mon_%1$s" on %1$s;', t);
    execute format($f$create policy "insp_mon_%1$s" on %1$s for all to authenticated
      using (current_perfil() = 'admin') with check (current_perfil() = 'admin');$f$, t);
  end loop;
end $$;

-- =============================================================================
-- FIM — Os eventos brutos (insp_eventos) sustentam todos os cálculos de tempo,
-- atividades ao vivo, alertas e perfis do painel administrativo (services/inspecao-monitor.js).
-- Tabelas de snapshot agregado (§66 auditor_performance_snapshots) são opcionais:
-- os indicadores são calculados on-the-fly a partir dos eventos; adicione snapshots
-- apenas se precisar de histórico materializado para períodos fechados.
-- =============================================================================
