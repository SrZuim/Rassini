-- =============================================================================
-- RNA One — CORREÇÃO do cadastro público (erro "{}" + perfil não criado)
-- Rassini NHK Automotive
-- -----------------------------------------------------------------------------
-- CAUSA RAIZ:
--   O perfil em `usuarios` era criado SOMENTE pelo trigger
--   fn_usuario_signup (AFTER INSERT ON auth.users), que fazia RAISE EXCEPTION
--   (validação de domínio) e INSERT em notificacoes/usuarios_logs. Qualquer
--   falha ali faz o Supabase Auth abortar o signUp inteiro com HTTP 500
--   "Database error saving new user" — que chega ao cliente como o objeto
--   opaco "{}". Resultado: nenhum usuário no Auth e nenhum perfil criado.
--
-- SOLUÇÃO (não quebra login, não apaga dados):
--   1) Trigger passa a ser SOMENTE-VÍNCULO e À PROVA DE EXCEÇÃO (nunca aborta
--      o signUp).
--   2) A criação do perfil passa a ser EXPLÍCITA, via RPC SECURITY DEFINER
--      solicitar_acesso(...) chamada pelo cliente após o signUp — com erros
--      reais (message/details/hint/code) e status='pendente', ativo=false.
--   3) Política de INSERT de resguardo (o próprio usuário só cria perfil
--      pendente/inativo de auditor|visitante).
--
-- Onde colar: Supabase → SQL Editor → cole TUDO → Run. Idempotente.
-- Pré-requisito: database/modulo_usuarios.sql já aplicado.
-- =============================================================================

-- 0) Garantia das colunas (idempotente — nada é recriado nem apagado) ---------
do $$ begin
  create type status_usuario as enum ('pendente','aprovado','recusado','bloqueado');
exception when duplicate_object then null; end $$;

alter table usuarios add column if not exists status       status_usuario not null default 'pendente';
alter table usuarios add column if not exists planta       text;
alter table usuarios add column if not exists ultimo_login timestamptz;
alter table usuarios add column if not exists aprovado_por uuid references usuarios(id);
alter table usuarios add column if not exists aprovado_em  timestamptz;
alter table usuarios add column if not exists updated_at   timestamptz not null default now();

-- 1) TRIGGER À PROVA DE EXCEÇÃO — só vincula auth_id, NUNCA aborta o signUp ----
create or replace function fn_usuario_signup() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    -- Se já existe perfil com este e-mail, vincula o auth_id (login normal).
    update usuarios set auth_id = new.id
    where auth_id is null and lower(email) = lower(new.email);
  exception when others then
    -- Blindagem: qualquer erro aqui é ignorado para não travar o Auth.
    null;
  end;
  return new;
end $$;

drop trigger if exists trg_link_usuario_auth on auth.users;
drop trigger if exists trg_usuario_signup    on auth.users;
create trigger trg_usuario_signup
  after insert on auth.users
  for each row execute function fn_usuario_signup();

-- 2) RPC solicitar_acesso — cria o perfil pendente com ERRO REAL --------------
--    SECURITY DEFINER: roda como owner (postgres) e ignora RLS na inserção.
--    Usa auth.uid() quando há sessão (confirm-email OFF); senão, o p_auth_id
--    devolvido por data.user.id (confirm-email ON). Valida domínio no servidor.
create or replace function solicitar_acesso(
  p_nome   text,
  p_email  text,
  p_planta text default null,
  p_cargo  text default 'visitante',
  p_auth_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
  v_nome  text := trim(coalesce(p_nome, ''));
  v_cargo text := lower(coalesce(p_cargo, 'visitante'));
  v_auth  uuid := coalesce(auth.uid(), p_auth_id);
  v_exist usuarios%rowtype;
begin
  -- Validações → erros claros (viram error.message no cliente)
  if v_nome = '' then
    raise exception 'Informe seu nome completo.' using errcode = '23514';
  end if;
  if v_email !~ '@rassininhk\.com\.br$' then
    raise exception 'Utilize seu e-mail corporativo da Rassini NHK.' using errcode = '23514';
  end if;

  -- Clamp de segurança: só auditor/visitante (nunca admin/supervisor)
  if v_cargo not in ('auditor','visitante') then v_cargo := 'visitante'; end if;

  -- Já existe? Não sobrescreve; apenas vincula auth_id e devolve o status atual.
  select * into v_exist from usuarios where lower(email) = v_email limit 1;
  if v_exist.id is not null then
    update usuarios set auth_id = coalesce(auth_id, v_auth), updated_at = now()
    where id = v_exist.id;
    return jsonb_build_object('ok', true, 'ja_existe', true, 'status', v_exist.status::text);
  end if;

  -- Cria o perfil PENDENTE / INATIVO
  insert into usuarios (auth_id, nome, email, role, planta, status, ativo, created_at, updated_at)
  values (v_auth, v_nome, v_email, v_cargo::perfil_tipo, p_planta, 'pendente', false, now(), now());

  -- Log + notificação aos admins (best-effort; nunca derruba o cadastro)
  begin
    insert into usuarios_logs (afetado_nome, acao, detalhe, depois)
    values (v_nome, 'cadastro', 'Solicitação de acesso ('||v_cargo||')',
            jsonb_build_object('email', v_email, 'planta', p_planta, 'role', v_cargo));
  exception when others then null; end;

  begin
    insert into notificacoes (destinatario, tipo, titulo, texto)
    select id, 'info', 'Nova solicitação de acesso',
           v_nome || ' · ' || initcap(v_cargo) || coalesce(' · ' || p_planta, '')
    from usuarios where role = 'admin' and ativo = true;
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'status', 'pendente');
end $$;

grant execute on function solicitar_acesso(text,text,text,text,uuid) to anon, authenticated;

-- 3) Política de INSERT de resguardo (caso queira permitir insert direto) -----
--    O próprio usuário autenticado só pode criar o PRÓPRIO perfil, pendente,
--    inativo e como auditor|visitante. (A RPC acima já cobre o fluxo; isto é
--    uma malha de segurança adicional exigida pelo requisito #16.)
alter table usuarios enable row level security;
drop policy if exists "user_self_insert_pending" on usuarios;
create policy "user_self_insert_pending" on usuarios for insert to authenticated
  with check (
    auth_id = auth.uid()
    and status = 'pendente'
    and ativo = false
    and role in ('auditor','visitante')
  );

-- 4) DIAGNÓSTICO — rode após aplicar e após um cadastro de teste --------------
-- SELECT id, nome, email, role, status, ativo, auth_id, created_at
--   FROM usuarios ORDER BY created_at DESC LIMIT 10;
-- (o usuário recém-cadastrado deve aparecer com status='pendente', ativo=false)
