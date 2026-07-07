-- =============================================================================
-- RNA One — CORREÇÃO do login "undefined · visitante"
-- Rassini NHK Automotive
-- -----------------------------------------------------------------------------
-- CAUSA: as políticas RLS de "usuarios" só liberavam a leitura quando
--        auth_id = auth.uid(). Quando o registro tem auth_id NULL (não vinculado
--        ao Supabase Auth), o SELECT era bloqueado → o app recebia perfil vazio
--        e caía para "visitante".
--
-- ESTE SCRIPT (idempotente — pode rodar várias vezes):
--   1. current_perfil() passa a casar por auth_id OU e-mail do JWT.
--   2. Política de leitura de "usuarios" ganha fallback por e-mail.
--   3. Vincula (backfill) auth_id dos registros existentes pelo e-mail.
--   4. Trigger mantém auth_id vinculado em novos cadastros do Auth.
--   5. Garante o registro admin de Jorge Lucas com role = admin.
--
-- Como aplicar: Supabase → SQL Editor → cole tudo → Run.
-- Depois: faça login novamente. O console mostrará [RNA-AUTH] 2) ... encontrado:true
-- =============================================================================

-- 0a) GRANTs: sem privilégio de tabela, o SELECT retorna ERRO ("permission denied
--     for table usuarios") — foi o que deixou a role = null. RLS ainda governa as linhas.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;

-- 0b) Helper: e-mail do usuário autenticado, extraído do JWT ---------------------
create or replace function auth_email() returns text as $$
  select nullif(lower(auth.jwt() ->> 'email'), '');
$$ language sql stable;

-- 1) current_perfil(): casa por auth_id OU por e-mail (security definer ignora RLS)
create or replace function current_perfil() returns text as $$
  select role::text
  from usuarios
  where auth_id = auth.uid()
     or lower(email) = auth_email()
  limit 1;
$$ language sql stable security definer;

-- 2) Leitura de "usuarios": próprio registro (por auth_id OU e-mail) ou admin ----
alter table usuarios enable row level security;

drop policy if exists "user_self_read" on usuarios;
create policy "user_self_read" on usuarios for select to authenticated
  using (
    auth_id = auth.uid()
    or lower(email) = auth_email()
    or current_perfil() = 'admin'
  );

-- Cada usuário pode atualizar o PRÓPRIO registro (permite auto-vínculo do auth_id).
drop policy if exists "user_self_update" on usuarios;
create policy "user_self_update" on usuarios for update to authenticated
  using (auth_id = auth.uid() or lower(email) = auth_email())
  with check (auth_id = auth.uid() or lower(email) = auth_email());

-- Admin gerencia todos (mantido).
drop policy if exists "user_admin_all" on usuarios;
create policy "user_admin_all" on usuarios for all to authenticated
  using (current_perfil() = 'admin') with check (current_perfil() = 'admin');

-- 3) Backfill: vincula auth_id dos registros existentes pelo e-mail --------------
update usuarios u
set auth_id = a.id
from auth.users a
where u.auth_id is null
  and lower(u.email) = lower(a.email);

-- 4) Trigger: ao criar/confirmar um usuário no Auth, vincula a linha em "usuarios"
create or replace function fn_link_usuario_auth() returns trigger as $$
begin
  update usuarios
  set auth_id = new.id
  where auth_id is null
    and lower(email) = lower(new.email);
  return new;
end $$ language plpgsql security definer;

drop trigger if exists trg_link_usuario_auth on auth.users;
create trigger trg_link_usuario_auth
  after insert or update of email, email_confirmed_at on auth.users
  for each row execute function fn_link_usuario_auth();

-- 5) Garante o admin (ajuste/adicione outros conforme necessário) ----------------
insert into usuarios (nome, email, role, matricula, area, planta)
values ('Jorge Lucas', 'jorgelucaszuim@gmail.com', 'admin', 'RNA-0001', 'Qualidade', 'Planta São Bernardo')
on conflict (email) do update
  set role = excluded.role,
      nome = coalesce(nullif(usuarios.nome, ''), excluded.nome);

-- 6) Diagnóstico rápido — confira o resultado após rodar ------------------------
-- SELECT id, nome, email, role, auth_id FROM usuarios ORDER BY role;
-- (auth_id NÃO deve estar NULL para quem já existe em auth.users)
