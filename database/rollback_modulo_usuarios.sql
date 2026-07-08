-- =============================================================================
-- RNA One — ROLLBACK do Módulo de Usuários (Fase 1 · banco)
-- Rassini NHK Automotive
-- -----------------------------------------------------------------------------
-- Reverte os objetos criados por database/modulo_usuarios.sql SEM apagar os
-- dados da tabela `usuarios`. Restaura o comportamento anterior de vínculo de
-- auth_id (trg_link_usuario_auth do fix_auth_usuarios.sql).
--
-- SEGURANÇA DOS DADOS:
--   • As COLUNAS novas (status, telefone, ultimo_login, aprovado_por,
--     aprovado_em, recusado_motivo, updated_at) são MANTIDAS por padrão —
--     dropá-las é opcional e destrói informação. Descomente o bloco final
--     apenas se tiver certeza absoluta.
--   • A tabela usuarios_logs é DROPADA (trilha de auditoria do módulo).
--
-- Como aplicar: Supabase → SQL Editor → cole tudo → Run.
-- =============================================================================

-- 1) Remove triggers e funções do módulo -------------------------------------
drop trigger  if exists trg_usuario_signup        on auth.users;
drop trigger  if exists trg_guard_usuarios_update on usuarios;
drop trigger  if exists trg_usuarios_touch        on usuarios;

drop function if exists fn_usuario_signup()        cascade;
drop function if exists fn_guard_usuarios_update() cascade;
drop function if exists fn_touch_updated_at()      cascade;

-- 2) Remove RPCs administrativas ---------------------------------------------
drop function if exists fn_aprovar_usuario(uuid)          cascade;
drop function if exists fn_recusar_usuario(uuid,text)     cascade;
drop function if exists fn_bloquear_usuario(uuid,boolean) cascade;
drop function if exists fn_alterar_cargo(uuid,text)       cascade;
drop function if exists fn_rank_role(text)                cascade;
drop function if exists fn_excluir_usuario(uuid)          cascade;
drop function if exists fn_registrar_login()              cascade;

-- 3) Restaura o gatilho ORIGINAL de vínculo de auth_id (fix_auth_usuarios.sql)
create or replace function fn_link_usuario_auth() returns trigger as $$
begin
  update usuarios set auth_id = new.id
  where auth_id is null and lower(email) = lower(new.email);
  return new;
end $$ language plpgsql security definer;

drop trigger if exists trg_link_usuario_auth on auth.users;
create trigger trg_link_usuario_auth
  after insert or update of email, email_confirmed_at on auth.users
  for each row execute function fn_link_usuario_auth();

-- 4) Remove a trilha de auditoria do módulo ----------------------------------
drop table if exists usuarios_logs cascade;

-- 5) Remove índices auxiliares -----------------------------------------------
drop index if exists idx_usuarios_status;
drop index if exists idx_usuarios_role;
drop index if exists idx_usuarios_email;

-- 6) (OPCIONAL / DESTRUTIVO) Remover as colunas novas e o enum ----------------
-- Descomente SOMENTE se quiser eliminar por completo os campos do módulo.
-- Isso APAGA os dados de status/aprovação/último login dos usuários.
--
-- alter table usuarios drop column if exists status;
-- alter table usuarios drop column if exists telefone;
-- alter table usuarios drop column if exists ultimo_login;
-- alter table usuarios drop column if exists aprovado_por;
-- alter table usuarios drop column if exists aprovado_em;
-- alter table usuarios drop column if exists recusado_motivo;
-- alter table usuarios drop column if exists updated_at;
-- drop type if exists status_usuario;
