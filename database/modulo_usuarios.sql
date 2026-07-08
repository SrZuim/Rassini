-- =============================================================================
-- RNA One — MÓDULO CORPORATIVO DE USUÁRIOS (cadastro · aprovação · gestão)
-- Rassini NHK Automotive
-- -----------------------------------------------------------------------------
-- Fase 1 de 7 — Camada de banco de dados.
-- 100% INCREMENTAL e IDEMPOTENTE: só adiciona colunas/objetos, nunca recria
-- tabelas nem apaga dados. Pode rodar quantas vezes quiser.
--
-- Como aplicar: Supabase → SQL Editor → cole tudo → Run.
-- Pré-requisito: schema.sql, rls.sql e fix_auth_usuarios.sql já aplicados.
-- Rollback:     database/rollback_modulo_usuarios.sql
--
-- DECISÕES DO PROJETO (confirmadas):
--   • Trava de domínio @rassininhk.com.br vale só para CADASTROS NOVOS;
--     contas existentes (admin@rassini.com, gmail do admin) são preservadas.
--   • Role de auto-cadastro é FORÇADA no servidor para 'auditor'/'visitante'.
--     Ninguém nasce admin/supervisor — nem via Postman/RPC/SQL (requisito #14).
-- =============================================================================

-- ------------------------------------------------------------------ ENUM ----
-- Status corporativo do usuário no fluxo de aprovação.
do $$ begin
  create type status_usuario as enum ('pendente','aprovado','recusado','bloqueado');
exception when duplicate_object then null; end $$;

-- --------------------------------------------------- 1) COLUNAS NOVAS --------
-- Adição incremental à tabela usuarios (preserva id, auth_id, nome, email,
-- role, matricula, area, planta, avatar, ativo, created_at já existentes).
alter table usuarios add column if not exists status       status_usuario not null default 'pendente';
alter table usuarios add column if not exists telefone     text;
alter table usuarios add column if not exists ultimo_login timestamptz;
alter table usuarios add column if not exists aprovado_por uuid references usuarios(id);
alter table usuarios add column if not exists aprovado_em  timestamptz;
alter table usuarios add column if not exists recusado_motivo text;
alter table usuarios add column if not exists updated_at   timestamptz not null default now();

create index if not exists idx_usuarios_status on usuarios(status);
create index if not exists idx_usuarios_role   on usuarios(role);
create index if not exists idx_usuarios_email  on usuarios(lower(email));

-- --------------------------------------------------- 2) BACKFILL -------------
-- Usuários que já existiam ANTES deste módulo continuam logando sem interrupção:
-- passam a 'aprovado' + ativo. (Novos cadastros nascem 'pendente'/inativo.)
update usuarios
set status = 'aprovado', ativo = true
where status is null or status = 'pendente';   -- só toca em quem não passou pelo fluxo novo

-- --------------------------------------------------- 3) usuarios_logs --------
-- Trilha de auditoria dedicada (separada da tabela genérica `logs`).
create table if not exists usuarios_logs (
  id            uuid primary key default gen_random_uuid(),
  executor_id   uuid references usuarios(id),
  executor_nome text,
  afetado_id    uuid references usuarios(id),
  afetado_nome  text,
  acao          text not null,   -- cadastro|aprovacao|recusa|promocao|rebaixamento|bloqueio|desbloqueio|exclusao|alteracao_dados
  detalhe       text,
  antes         jsonb,
  depois        jsonb,
  ip            inet,
  created_at    timestamptz not null default now()
);
create index if not exists idx_usuarios_logs_afetado on usuarios_logs(afetado_id);
create index if not exists idx_usuarios_logs_quando  on usuarios_logs(created_at desc);

-- --------------------------------------------------- 4) updated_at -----------
create or replace function fn_touch_updated_at() returns trigger as $$
begin new.updated_at := now(); return new; end $$ language plpgsql;

drop trigger if exists trg_usuarios_touch on usuarios;
create trigger trg_usuarios_touch before update on usuarios
  for each row execute function fn_touch_updated_at();

-- ------------------------------------ 5) GUARD ANTI-ESCALADA (requisito #14) -
-- Verdade de servidor: quem NÃO é admin não consegue mudar role/status/ativo/
-- aprovação/e-mail do próprio registro, mesmo via Postman/RPC/SQL/DevTools.
-- (RLS with_check não enxerga OLD → a garantia real vem deste BEFORE UPDATE.)
create or replace function fn_guard_usuarios_update() returns trigger as $$
begin
  if coalesce(current_perfil(), '') <> 'admin' then
    new.role         := old.role;
    new.status       := old.status;
    new.ativo        := old.ativo;
    new.aprovado_por := old.aprovado_por;
    new.aprovado_em  := old.aprovado_em;
    new.email        := old.email;        -- impede troca de identidade
    new.planta       := old.planta;       -- planta é gerida pelo admin (requisito #13)
    new.recusado_motivo := old.recusado_motivo;
    -- Campos que o próprio usuário PODE alterar: avatar, telefone, nome.
  end if;
  return new;
end $$ language plpgsql security definer;

drop trigger if exists trg_guard_usuarios_update on usuarios;
create trigger trg_guard_usuarios_update before update on usuarios
  for each row execute function fn_guard_usuarios_update();

-- ------------------------------------ 6) SIGNUP: cria perfil com role travada
-- Substitui o antigo trg_link_usuario_auth: além de vincular auth_id, cria o
-- perfil em `usuarios` quando é um auto-cadastro novo — com domínio validado e
-- role CLAMPADA no servidor. Roda como SECURITY DEFINER (ignora RLS na criação).
create or replace function fn_usuario_signup() returns trigger as $$
declare
  v_nome  text := nullif(new.raw_user_meta_data->>'nome','');
  v_cargo text := lower(coalesce(new.raw_user_meta_data->>'cargo_desejado','visitante'));
  v_plt   text := new.raw_user_meta_data->>'planta';
begin
  -- (a) Já existe perfil para este e-mail (conta pré-existente ou criada pelo
  --     admin) → apenas vincula o auth_id e sai. NÃO aplica trava de domínio,
  --     preservando admin@rassini.com, gmail do admin, etc.
  if exists (select 1 from usuarios where lower(email) = lower(new.email)) then
    update usuarios set auth_id = new.id
    where lower(email) = lower(new.email) and auth_id is null;
    return new;
  end if;

  -- (b) Auto-cadastro NOVO → trava de domínio corporativo (back-end).
  if lower(new.email) not like '%@rassininhk.com.br' then
    raise exception 'Utilize seu e-mail corporativo da Rassini NHK.'
      using errcode = 'check_violation';
  end if;

  -- (c) Clamp de segurança: só 'auditor' ou 'visitante'. Qualquer outra
  --     tentativa (admin/supervisor/lixo) vira 'visitante'.
  if v_cargo not in ('auditor','visitante') then v_cargo := 'visitante'; end if;

  insert into usuarios (auth_id, nome, email, role, planta, status, ativo)
  values (
    new.id,
    coalesce(v_nome, split_part(new.email,'@',1)),
    lower(new.email),
    v_cargo::perfil_tipo,
    v_plt,
    'pendente',
    false
  );

  -- (d) Log + notificação para todos os admins (alimenta a central em tempo real)
  insert into usuarios_logs (afetado_nome, acao, detalhe, depois)
  values (coalesce(v_nome, new.email), 'cadastro',
          'Solicitação de acesso ('||v_cargo||')',
          jsonb_build_object('email', lower(new.email), 'planta', v_plt, 'role', v_cargo));

  insert into notificacoes (destinatario, tipo, titulo, texto)
  select id, 'info', 'Nova solicitação de acesso',
         coalesce(v_nome, new.email)||' · '||initcap(v_cargo)||coalesce(' · '||v_plt,'')
  from usuarios where role = 'admin' and ativo = true;

  return new;
end $$ language plpgsql security definer;

-- Troca o gatilho antigo (só-vínculo) pelo novo (vínculo + criação + domínio).
drop trigger if exists trg_link_usuario_auth on auth.users;
drop trigger if exists trg_usuario_signup    on auth.users;
create trigger trg_usuario_signup
  after insert on auth.users
  for each row execute function fn_usuario_signup();

-- ------------------------------------ 7) RPCs ADMIN (atômicas + logadas) -----
-- Todas exigem current_perfil()='admin'; centralizam regra de negócio e log.

-- Aprovar
create or replace function fn_aprovar_usuario(p_alvo uuid) returns void as $$
declare v_adm usuarios; v_alvo usuarios;
begin
  select * into v_adm  from usuarios where auth_id = auth.uid() or lower(email)=auth_email() limit 1;
  if coalesce(v_adm.role::text,'') <> 'admin' then raise exception 'Apenas administradores.'; end if;
  select * into v_alvo from usuarios where id = p_alvo;
  if v_alvo.id is null then raise exception 'Usuário não encontrado.'; end if;

  update usuarios set status='aprovado', ativo=true, aprovado_por=v_adm.id, aprovado_em=now(),
         recusado_motivo=null
  where id = p_alvo;

  insert into usuarios_logs(executor_id,executor_nome,afetado_id,afetado_nome,acao,detalhe,antes,depois)
  values(v_adm.id,v_adm.nome,v_alvo.id,v_alvo.nome,'aprovacao','Acesso aprovado',
         jsonb_build_object('status',v_alvo.status),'{"status":"aprovado"}'::jsonb);
end $$ language plpgsql security definer;

-- Recusar
create or replace function fn_recusar_usuario(p_alvo uuid, p_motivo text default null) returns void as $$
declare v_adm usuarios; v_alvo usuarios;
begin
  select * into v_adm from usuarios where auth_id = auth.uid() or lower(email)=auth_email() limit 1;
  if coalesce(v_adm.role::text,'') <> 'admin' then raise exception 'Apenas administradores.'; end if;
  select * into v_alvo from usuarios where id = p_alvo;
  if v_alvo.id is null then raise exception 'Usuário não encontrado.'; end if;

  update usuarios set status='recusado', ativo=false, recusado_motivo=p_motivo where id = p_alvo;

  insert into usuarios_logs(executor_id,executor_nome,afetado_id,afetado_nome,acao,detalhe,antes,depois)
  values(v_adm.id,v_adm.nome,v_alvo.id,v_alvo.nome,'recusa',coalesce(p_motivo,'Acesso recusado'),
         jsonb_build_object('status',v_alvo.status),'{"status":"recusado"}'::jsonb);
end $$ language plpgsql security definer;

-- Bloquear / Desbloquear
create or replace function fn_bloquear_usuario(p_alvo uuid, p_bloquear boolean) returns void as $$
declare v_adm usuarios; v_alvo usuarios;
begin
  select * into v_adm from usuarios where auth_id = auth.uid() or lower(email)=auth_email() limit 1;
  if coalesce(v_adm.role::text,'') <> 'admin' then raise exception 'Apenas administradores.'; end if;
  if p_alvo = v_adm.id then raise exception 'Você não pode bloquear a si mesmo.'; end if;
  select * into v_alvo from usuarios where id = p_alvo;
  if v_alvo.id is null then raise exception 'Usuário não encontrado.'; end if;

  if p_bloquear then
    update usuarios set status='bloqueado', ativo=false where id=p_alvo;
  else
    update usuarios set status='aprovado', ativo=true where id=p_alvo;
  end if;

  insert into usuarios_logs(executor_id,executor_nome,afetado_id,afetado_nome,acao,detalhe,antes,depois)
  values(v_adm.id,v_adm.nome,v_alvo.id,v_alvo.nome,
         case when p_bloquear then 'bloqueio' else 'desbloqueio' end,
         case when p_bloquear then 'Usuário bloqueado' else 'Usuário desbloqueado' end,
         jsonb_build_object('status',v_alvo.status),
         jsonb_build_object('status', case when p_bloquear then 'bloqueado' else 'aprovado' end));
end $$ language plpgsql security definer;

-- Alterar cargo (hierarquia visitante→auditor→supervisor→admin; nunca em si mesmo)
create or replace function fn_rank_role(p text) returns int as $$
  select case p when 'visitante' then 1 when 'auditor' then 2
                when 'supervisor' then 3 when 'admin' then 4 else 0 end;
$$ language sql immutable;

create or replace function fn_alterar_cargo(p_alvo uuid, p_role text) returns void as $$
declare v_adm usuarios; v_alvo usuarios;
begin
  select * into v_adm from usuarios where auth_id = auth.uid() or lower(email)=auth_email() limit 1;
  if coalesce(v_adm.role::text,'') <> 'admin' then raise exception 'Apenas administradores.'; end if;
  if p_alvo = v_adm.id then raise exception 'Você não pode alterar o seu próprio cargo.'; end if;
  if p_role not in ('visitante','auditor','supervisor','admin') then raise exception 'Cargo inválido.'; end if;
  select * into v_alvo from usuarios where id = p_alvo;
  if v_alvo.id is null then raise exception 'Usuário não encontrado.'; end if;

  update usuarios set role = p_role::perfil_tipo where id = p_alvo;

  insert into usuarios_logs(executor_id,executor_nome,afetado_id,afetado_nome,acao,detalhe,antes,depois)
  values(v_adm.id,v_adm.nome,v_alvo.id,v_alvo.nome,
         case when fn_rank_role(p_role) > fn_rank_role(v_alvo.role::text) then 'promocao' else 'rebaixamento' end,
         'Cargo alterado para '||p_role,
         jsonb_build_object('role',v_alvo.role),jsonb_build_object('role',p_role));
end $$ language plpgsql security definer;

-- Excluir (remove perfil; a conta em auth.users deve ser removida à parte se desejado)
create or replace function fn_excluir_usuario(p_alvo uuid) returns void as $$
declare v_adm usuarios; v_alvo usuarios;
begin
  select * into v_adm from usuarios where auth_id = auth.uid() or lower(email)=auth_email() limit 1;
  if coalesce(v_adm.role::text,'') <> 'admin' then raise exception 'Apenas administradores.'; end if;
  if p_alvo = v_adm.id then raise exception 'Você não pode excluir a si mesmo.'; end if;
  select * into v_alvo from usuarios where id = p_alvo;
  if v_alvo.id is null then raise exception 'Usuário não encontrado.'; end if;

  insert into usuarios_logs(executor_id,executor_nome,afetado_id,afetado_nome,acao,detalhe,antes)
  values(v_adm.id,v_adm.nome,null,v_alvo.nome,'exclusao','Usuário excluído',to_jsonb(v_alvo));

  delete from usuarios where id = p_alvo;
end $$ language plpgsql security definer;

-- Registrar último login (chamada pelo front após autenticar)
create or replace function fn_registrar_login() returns void as $$
begin
  update usuarios set ultimo_login = now()
  where auth_id = auth.uid() or lower(email) = auth_email();
end $$ language plpgsql security definer;

-- ------------------------------------ 8) RLS: usuarios_logs ------------------
alter table usuarios_logs enable row level security;
drop policy if exists "logs_usuarios_read" on usuarios_logs;
create policy "logs_usuarios_read" on usuarios_logs for select to authenticated
  using (current_perfil() = 'admin');
-- Escrita ocorre apenas via funções security definer (não expõe insert direto).

-- ------------------------------------ 9) GRANTS das RPCs --------------------
grant execute on function fn_aprovar_usuario(uuid)            to authenticated;
grant execute on function fn_recusar_usuario(uuid,text)       to authenticated;
grant execute on function fn_bloquear_usuario(uuid,boolean)   to authenticated;
grant execute on function fn_alterar_cargo(uuid,text)         to authenticated;
grant execute on function fn_excluir_usuario(uuid)            to authenticated;
grant execute on function fn_registrar_login()                to authenticated;

-- ------------------------------------ 10) DIAGNÓSTICO -----------------------
-- SELECT id,nome,email,role,status,ativo,ultimo_login FROM usuarios ORDER BY status,role;
-- SELECT * FROM usuarios_logs ORDER BY created_at DESC LIMIT 20;
