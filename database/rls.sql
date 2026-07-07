-- =============================================================================
-- RNA One — Row Level Security (RLS) e políticas por perfil
-- Execute após schema.sql
-- Estratégia: helper current_role() lê o perfil do usuário autenticado.
-- =============================================================================

-- Função utilitária: retorna o perfil (role) do usuário autenticado
create or replace function current_perfil() returns text as $$
  select role::text from usuarios where auth_id = auth.uid();
$$ language sql stable security definer;

-- Habilita RLS nas tabelas
alter table usuarios            enable row level security;
alter table rotinas             enable row level security;
alter table plantoes            enable row level security;
alter table atividades          enable row level security;
alter table auditorias          enable row level security;
alter table checklist           enable row level security;
alter table checklist_itens     enable row level security;
alter table nao_conformidades   enable row level security;
alter table planos_acao         enable row level security;
alter table evidencias          enable row level security;
alter table comunicados         enable row level security;
alter table documentos          enable row level security;
alter table treinamentos        enable row level security;
alter table logs                enable row level security;
alter table notificacoes        enable row level security;

-- ----------------------------------------------------------- LEITURA --------
-- Todos os autenticados podem LER os módulos operacionais/qualidade/gestão
do $$
declare t text;
begin
  foreach t in array array['rotinas','plantoes','atividades','auditorias','checklist',
    'checklist_itens','nao_conformidades','planos_acao','evidencias','comunicados',
    'documentos','treinamentos'] loop
    execute format('drop policy if exists "read_auth_%1$s" on %1$s;', t);
    execute format('create policy "read_auth_%1$s" on %1$s for select to authenticated using (true);', t);
  end loop;
end $$;

-- ----------------------------------------------------------- ESCRITA --------
-- Auditor/Supervisor/Admin podem inserir e atualizar registros operacionais
do $$
declare t text;
begin
  foreach t in array array['rotinas','plantoes','atividades','auditorias','checklist',
    'checklist_itens','nao_conformidades','planos_acao','evidencias'] loop
    execute format('drop policy if exists "write_oper_%1$s" on %1$s;', t);
    execute format($f$create policy "write_oper_%1$s" on %1$s for insert to authenticated
      with check (current_perfil() in ('admin','supervisor','auditor'));$f$, t);
    execute format('drop policy if exists "update_oper_%1$s" on %1$s;', t);
    execute format($f$create policy "update_oper_%1$s" on %1$s for update to authenticated
      using (current_perfil() in ('admin','supervisor','auditor'));$f$, t);
  end loop;
end $$;

-- Comunicados/Documentos/Treinamentos: somente admin e supervisor escrevem
do $$
declare t text;
begin
  foreach t in array array['comunicados','documentos','treinamentos'] loop
    execute format('drop policy if exists "write_gestao_%1$s" on %1$s;', t);
    execute format($f$create policy "write_gestao_%1$s" on %1$s for all to authenticated
      using (current_perfil() in ('admin','supervisor'))
      with check (current_perfil() in ('admin','supervisor'));$f$, t);
  end loop;
end $$;

-- Aprovação/exclusão de NC e Plano: admin e supervisor
drop policy if exists "delete_nc" on nao_conformidades;
create policy "delete_nc" on nao_conformidades for delete to authenticated
  using (current_perfil() in ('admin','supervisor'));

-- Usuários: cada um lê o próprio; admin lê/gerencia todos
drop policy if exists "user_self_read" on usuarios;
create policy "user_self_read" on usuarios for select to authenticated
  using (auth_id = auth.uid() or current_perfil() = 'admin');
drop policy if exists "user_admin_all" on usuarios;
create policy "user_admin_all" on usuarios for all to authenticated
  using (current_perfil() = 'admin') with check (current_perfil() = 'admin');

-- Notificações: o destinatário lê/atualiza as suas
drop policy if exists "notif_own" on notificacoes;
create policy "notif_own" on notificacoes for all to authenticated
  using (destinatario in (select id from usuarios where auth_id = auth.uid()));

-- Logs: leitura para admin/supervisor; inserção pelo sistema
drop policy if exists "logs_read" on logs;
create policy "logs_read" on logs for select to authenticated
  using (current_perfil() in ('admin','supervisor'));
drop policy if exists "logs_insert" on logs;
create policy "logs_insert" on logs for insert to authenticated with check (true);
