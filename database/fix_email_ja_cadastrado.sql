-- =============================================================================
-- RNA One — CORREÇÃO DEFINITIVA do erro "E-mail já cadastrado"
-- Rassini NHK Automotive · Módulo de Usuários
-- -----------------------------------------------------------------------------
-- CAUSA RAIZ (confirmada no código):
--   A exclusão de usuário (fn_excluir_usuario) apagava SOMENTE public.usuarios,
--   deixando a conta viva em auth.users. Ao recadastrar o mesmo e-mail, o
--   sb.auth.signUp() retornava "User already registered", que o front traduzia
--   como "E-mail já cadastrado" — sem qualquer recuperação. Órfão clássico:
--   existe em auth.users, ausente em public.usuarios (Caso 4 → Caso 1).
--
-- O QUE ESTE SCRIPT FAZ (idempotente, não apaga dados, não quebra login):
--   1) fn_excluir_usuario: passa a remover TAMBÉM de auth.users (best-effort,
--      SECURITY DEFINER roda como owner/postgres — não precisa de service_role
--      no front nem de Edge Function). Evita novos órfãos.
--   2) fn_diagnostico_email(text): visão completa dos dois lados (admin-only).
--      Alimenta o painel administrativo (ETAPA 8) e o resultado esperado.
--   3) fn_status_email(text): pré-checagem enxuta para o cadastro dar a mensagem
--      certa (pendente / ativo / recusado / órfão) em vez da genérica.
--   4) fn_recuperar_perfil_orfao(...): recria o perfil pendente a partir da conta
--      já existente em auth.users, curando o órfão SEM duplicar e SEM tocar na
--      senha original (Caso 1/4). Chamável por anon durante o recadastro.
--   5) Índice único normalizado em lower(trim(email)) (com checagem prévia).
--
-- IMPORTANTE: NÃO apaga automaticamente thais.silva@rassininhk.com.br.
--   A seção final (ETAPA 1/diagnóstico e cura assistida) é comentada — rode
--   manualmente após inspecionar o diagnóstico.
--
-- Onde colar: Supabase → SQL Editor → cole TUDO → Run.
-- Pré-requisitos: modulo_usuarios.sql, fix_cadastro_usuarios.sql,
--                 hard_delete_usuarios.sql já aplicados.
-- =============================================================================

-- 0) Garantias idempotentes -------------------------------------------------
do $$ begin
  create type status_usuario as enum ('pendente','aprovado','recusado','bloqueado');
exception when duplicate_object then null; end $$;

alter table usuarios add column if not exists status       status_usuario not null default 'pendente';
alter table usuarios add column if not exists updated_at   timestamptz not null default now();

-- =============================================================================
-- 1) EXCLUSÃO COMPLETA — remove de public.usuarios E de auth.users
-- -----------------------------------------------------------------------------
--   Mantém todas as travas (só admin; nunca a si mesmo) e a limpeza de vínculos
--   já existente. A remoção em auth.users é BEST-EFFORT: se o papel executor não
--   tiver privilégio no schema auth, o bloco é ignorado e a exclusão pública
--   segue normalmente (nesse caso, use a Edge Function do appendix ou o painel
--   Authentication do Supabase para remover a conta órfã).
-- =============================================================================
create or replace function fn_excluir_usuario(p_alvo uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_adm usuarios; v_alvo usuarios;
begin
  select * into v_adm from usuarios where auth_id = auth.uid() or lower(email) = auth_email() limit 1;
  if coalesce(v_adm.role::text,'') <> 'admin' then raise exception 'Apenas administradores.'; end if;
  if p_alvo = v_adm.id then raise exception 'Você não pode excluir a si mesmo.'; end if;
  select * into v_alvo from usuarios where id = p_alvo;
  if v_alvo.id is null then raise exception 'Usuário não encontrado.'; end if;

  -- Registro de auditoria (afetado_id nulo → sobrevive à limpeza)
  insert into usuarios_logs(executor_id, executor_nome, afetado_id, afetado_nome, acao, detalhe, antes)
  values (v_adm.id, v_adm.nome, null, v_alvo.nome, 'exclusao',
          coalesce(p_motivo, 'Exclusão física (public + auth)'), to_jsonb(v_alvo));

  -- (a) dependências transitórias
  delete from notificacoes where destinatario = p_alvo;
  delete from usuarios_logs  where afetado_id = p_alvo or executor_id = p_alvo;

  -- (b) auto-referências
  update usuarios set aprovado_por = null where aprovado_por = p_alvo;

  -- (c) vínculos operacionais → anular (preserva registros de qualidade).
  --     Cada UPDATE é blindado: tabelas/colunas ausentes não abortam a exclusão.
  begin update rotinas           set auditor     = null where auditor     = p_alvo; exception when others then null; end;
  begin update plantoes          set usuario     = null where usuario     = p_alvo; exception when others then null; end;
  begin update atividades        set auditor     = null where auditor     = p_alvo; exception when others then null; end;
  begin update auditorias        set auditor     = null where auditor     = p_alvo; exception when others then null; end;
  begin update checklist         set auditor     = null where auditor     = p_alvo; exception when others then null; end;
  begin update nao_conformidades set responsavel = null where responsavel = p_alvo; exception when others then null; end;
  begin update planos_acao       set responsavel = null where responsavel = p_alvo; exception when others then null; end;
  begin update evidencias        set created_by  = null where created_by  = p_alvo; exception when others then null; end;
  begin update rotina_exec       set auditor     = null where auditor     = p_alvo; exception when others then null; end;
  begin update checklist_exec    set auditor     = null where auditor     = p_alvo; exception when others then null; end;
  begin update auditorias_peca   set auditor     = null where auditor     = p_alvo; exception when others then null; end;

  -- (d) apaga o perfil público
  delete from usuarios where id = p_alvo;

  -- (e) apaga a conta no Supabase Authentication (best-effort).
  --     SECURITY DEFINER roda como owner; se não houver privilégio, ignora.
  if v_alvo.auth_id is not null then
    begin
      delete from auth.users where id = v_alvo.auth_id;
    exception when others then
      -- Não foi possível remover do Auth aqui (privilégio). Registra aviso.
      begin
        insert into usuarios_logs(executor_id, executor_nome, afetado_nome, acao, detalhe)
        values (v_adm.id, v_adm.nome, v_alvo.nome, 'exclusao',
                'ATENÇÃO: conta permaneceu em auth.users (sem privilégio p/ remover). '
                || 'Remova pelo painel Authentication ou pela Edge Function delete-user. '
                || 'auth_id=' || v_alvo.auth_id::text);
      exception when others then null; end;
    end;
  end if;
end $$;

grant execute on function fn_excluir_usuario(uuid, text) to authenticated;

-- =============================================================================
-- 2) DIAGNÓSTICO ADMINISTRATIVO — visão dos dois lados (ETAPA 1/2/8)
-- -----------------------------------------------------------------------------
--   Admin-only. Retorna jsonb com existência, UUIDs, status, perfil, datas,
--   a "situação encontrada" e a "ação recomendada".
-- =============================================================================
create or replace function fn_diagnostico_email(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_adm      usuarios;
  v_email    text := lower(trim(p_email));
  v_pub      usuarios%rowtype;
  v_auth_id  uuid;
  v_auth_em  text;
  v_auth_at  timestamptz;
  v_auth_conf timestamptz;
  v_auth_last timestamptz;
  v_situacao text;
  v_acao     text;
begin
  select * into v_adm from usuarios where auth_id = auth.uid() or lower(email) = auth_email() limit 1;
  if coalesce(v_adm.role::text,'') <> 'admin' then
    raise exception 'Apenas administradores podem executar o diagnóstico.';
  end if;

  select * into v_pub from usuarios where lower(trim(email)) = v_email limit 1;

  select id, email, created_at, email_confirmed_at, last_sign_in_at
    into v_auth_id, v_auth_em, v_auth_at, v_auth_conf, v_auth_last
  from auth.users where lower(trim(email)) = v_email limit 1;

  -- Classifica a situação e sugere a ação
  if v_auth_id is not null and v_pub.id is null then
    v_situacao := 'Existe em auth.users, mas NÃO existe em usuarios (órfão do Authentication).';
    v_acao     := 'restaurar_perfil';                       -- recria o perfil pendente
  elsif v_auth_id is null and v_pub.id is not null then
    v_situacao := 'Existe em usuarios, mas NÃO existe em auth.users (perfil sem conta de login).';
    v_acao     := 'recriar_conta_auth';                     -- precisa recriar a conta (signUp/convite)
  elsif v_auth_id is not null and v_pub.id is not null then
    v_situacao := 'Existe nos DOIS locais. Status atual: ' || coalesce(v_pub.status::text,'—') || '.';
    v_acao     := case v_pub.status::text
                    when 'pendente'  then 'aguardar_aprovacao'
                    when 'aprovado'  then 'usar_login'
                    when 'recusado'  then 'reativar_ou_contatar_admin'
                    when 'bloqueado' then 'desbloquear_ou_contatar_admin'
                    else 'revisar_manual' end;
    if v_pub.auth_id is distinct from v_auth_id then
      v_situacao := v_situacao || ' [VÍNCULO INCORRETO: usuarios.auth_id ≠ auth.users.id]';
      v_acao     := 'corrigir_vinculo_ids';
    end if;
  else
    v_situacao := 'Não existe em nenhum dos locais — e-mail livre para cadastro.';
    v_acao     := 'cadastrar';
  end if;

  return jsonb_build_object(
    'email',            v_email,
    'existe_auth',      (v_auth_id is not null),
    'existe_usuarios',  (v_pub.id is not null),
    'auth_uuid',        v_auth_id,
    'auth_email',       v_auth_em,
    'auth_criado_em',   v_auth_at,
    'auth_confirmado',  (v_auth_conf is not null),
    'auth_ultimo_login',v_auth_last,
    'usuarios_uuid',    v_pub.id,
    'usuarios_auth_id', v_pub.auth_id,
    'nome',             v_pub.nome,
    'status',           v_pub.status::text,
    'role',             v_pub.role::text,
    'ativo',            v_pub.ativo,
    'usuarios_criado_em', v_pub.created_at,
    'situacao',         v_situacao,
    'acao_recomendada', v_acao
  );
end $$;

grant execute on function fn_diagnostico_email(text) to authenticated;

-- =============================================================================
-- 3) STATUS DO E-MAIL (pré-checagem do cadastro) — anon
-- -----------------------------------------------------------------------------
--   Enxuto de propósito: só o necessário para o cadastro exibir a mensagem
--   correta. NÃO devolve nome/planta/telefone. Chamável antes do signUp.
-- =============================================================================
create or replace function fn_status_email(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
  v_pub   usuarios%rowtype;
  v_auth  boolean;
begin
  if v_email !~ '@rassininhk\.com\.br$' then
    return jsonb_build_object('ok', false, 'motivo', 'dominio');
  end if;
  select * into v_pub from usuarios where lower(trim(email)) = v_email limit 1;
  select exists(select 1 from auth.users where lower(trim(email)) = v_email) into v_auth;

  return jsonb_build_object(
    'ok', true,
    'existe_usuarios', (v_pub.id is not null),
    'existe_auth', v_auth,
    'status', v_pub.status::text,        -- null quando não há perfil público
    'orfao_auth', (v_auth and v_pub.id is null)
  );
end $$;

grant execute on function fn_status_email(text) to anon, authenticated;

-- =============================================================================
-- 4) RECUPERAR PERFIL ÓRFÃO — cura Caso 1/4 sem duplicar, sem tocar na senha
-- -----------------------------------------------------------------------------
--   Se o e-mail existe em auth.users mas não em usuarios, recria o perfil
--   PENDENTE/INATIVO vinculado ao auth_id existente. A senha original em
--   auth.users é preservada (o usuário loga com ela após aprovação, ou usa
--   "Esqueci minha senha"). Chamável por anon durante o recadastro.
--   NUNCA cria acesso: sempre pendente + inativo + auditor|visitante.
-- =============================================================================
create or replace function fn_recuperar_perfil_orfao(
  p_email  text,
  p_nome   text default null,
  p_planta text default null,
  p_cargo  text default 'visitante'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text := lower(trim(p_email));
  v_nome  text := nullif(trim(coalesce(p_nome,'')), '');
  v_cargo text := lower(coalesce(p_cargo,'visitante'));
  v_auth  auth.users%rowtype;
  v_pub   usuarios%rowtype;
begin
  if v_email !~ '@rassininhk\.com\.br$' then
    raise exception 'Utilize seu e-mail corporativo da Rassini NHK.' using errcode = '23514';
  end if;

  select * into v_pub from usuarios where lower(trim(email)) = v_email limit 1;
  if v_pub.id is not null then
    -- Já existe perfil: nada a recuperar; devolve o status atual (Caso 3).
    return jsonb_build_object('ok', true, 'recuperado', false, 'ja_existe', true,
                              'status', v_pub.status::text);
  end if;

  select * into v_auth from auth.users where lower(trim(email)) = v_email limit 1;
  if v_auth.id is null then
    -- Não há conta em auth → não é órfão; deixa o fluxo normal de signUp seguir.
    return jsonb_build_object('ok', true, 'recuperado', false, 'existe_auth', false);
  end if;

  if v_cargo not in ('auditor','visitante') then v_cargo := 'visitante'; end if;

  insert into usuarios (auth_id, nome, email, role, planta, status, ativo, created_at, updated_at)
  values (
    v_auth.id,
    coalesce(v_nome, nullif(v_auth.raw_user_meta_data->>'nome',''), split_part(v_email,'@',1)),
    v_email,
    v_cargo::perfil_tipo,
    coalesce(p_planta, v_auth.raw_user_meta_data->>'planta'),
    'pendente',
    false,
    now(), now()
  );

  begin
    insert into usuarios_logs (afetado_nome, acao, detalhe, depois)
    values (coalesce(v_nome, v_email), 'cadastro',
            'Perfil recuperado (conta órfã em auth.users)',
            jsonb_build_object('email', v_email, 'role', v_cargo, 'origem', 'recuperacao_orfao'));
  exception when others then null; end;

  begin
    insert into notificacoes (destinatario, tipo, titulo, texto)
    select id, 'info', 'Solicitação de acesso recuperada',
           coalesce(v_nome, v_email) || ' · ' || initcap(v_cargo)
    from usuarios where role = 'admin' and ativo = true;
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'recuperado', true, 'status', 'pendente');
end $$;

grant execute on function fn_recuperar_perfil_orfao(text,text,text,text) to anon, authenticated;

-- =============================================================================
-- 5) CORRIGIR VÍNCULO DE IDs — admin (para o Caso "vínculo incorreto")
-- -----------------------------------------------------------------------------
--   Alinha usuarios.auth_id ao auth.users.id correto (mesmo e-mail).
-- =============================================================================
create or replace function fn_corrigir_vinculo_email(p_email text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_adm usuarios; v_email text := lower(trim(p_email));
  v_auth_id uuid; v_pub_id uuid;
begin
  select * into v_adm from usuarios where auth_id = auth.uid() or lower(email) = auth_email() limit 1;
  if coalesce(v_adm.role::text,'') <> 'admin' then raise exception 'Apenas administradores.'; end if;

  select id into v_auth_id from auth.users where lower(trim(email)) = v_email limit 1;
  select id into v_pub_id  from usuarios  where lower(trim(email)) = v_email limit 1;
  if v_auth_id is null or v_pub_id is null then
    raise exception 'Vínculo impossível: e-mail não existe nos dois locais.';
  end if;

  update usuarios set auth_id = v_auth_id, updated_at = now() where id = v_pub_id;
  return jsonb_build_object('ok', true, 'usuarios_uuid', v_pub_id, 'auth_uuid', v_auth_id);
end $$;

grant execute on function fn_corrigir_vinculo_email(text) to authenticated;

-- 5.1) Redefinir status para 'pendente' (reabre a solicitação) — admin --------
create or replace function fn_redefinir_pendente(p_alvo uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_adm usuarios; v_alvo usuarios;
begin
  select * into v_adm from usuarios where auth_id = auth.uid() or lower(email) = auth_email() limit 1;
  if coalesce(v_adm.role::text,'') <> 'admin' then raise exception 'Apenas administradores.'; end if;
  select * into v_alvo from usuarios where id = p_alvo;
  if v_alvo.id is null then raise exception 'Usuário não encontrado.'; end if;

  update usuarios set status='pendente', ativo=false, recusado_motivo=null, updated_at=now()
  where id = p_alvo;

  insert into usuarios_logs(executor_id,executor_nome,afetado_id,afetado_nome,acao,detalhe,antes,depois)
  values(v_adm.id,v_adm.nome,v_alvo.id,v_alvo.nome,'alteracao_dados','Status redefinido para pendente',
         jsonb_build_object('status',v_alvo.status),'{"status":"pendente"}'::jsonb);
end $$;

grant execute on function fn_redefinir_pendente(uuid) to authenticated;

-- =============================================================================
-- 6) UNICIDADE NORMALIZADA — impede duplicidade por caixa/espaços
-- -----------------------------------------------------------------------------
--   Antes de criar o índice, verifique duplicidades e consolide manualmente:
--     SELECT lower(trim(email)) e, count(*) FROM usuarios
--     GROUP BY 1 HAVING count(*) > 1;
--   O índice abaixo só é criado se não houver duplicidade (senão dá erro e você
--   consolida antes de rodar de novo). NÃO apaga nada automaticamente.
-- =============================================================================
create unique index if not exists usuarios_email_norm_uidx
  on usuarios (lower(trim(email)));

-- =============================================================================
-- ETAPA 1 (thais.silva) — DIAGNÓSTICO E CURA ASSISTIDA (rodar manualmente)
-- -----------------------------------------------------------------------------
-- Passo 1 — Diagnóstico (não altera nada):
--   SELECT fn_diagnostico_email('thais.silva@rassininhk.com.br');
--
--   Ou consultas cruas:
--   SELECT id, email, created_at, email_confirmed_at, last_sign_in_at
--     FROM auth.users WHERE lower(trim(email)) = 'thais.silva@rassininhk.com.br';
--   SELECT id, auth_id, email, nome, status, role, ativo, created_at
--     FROM public.usuarios WHERE lower(trim(email)) = 'thais.silva@rassininhk.com.br';
--
-- Passo 2 — Cura conforme o resultado:
--   • Se "existe_auth=true, existe_usuarios=false" (órfão / Caso 1/4):
--       SELECT fn_recuperar_perfil_orfao('thais.silva@rassininhk.com.br','Thais Silva',null,'auditor');
--       → cria o perfil PENDENTE; aprove no painel. Login com a senha original
--         ou "Esqueci minha senha". (Se preferir zerar tudo, remova a conta no
--         painel Authentication e recadastre — agora fn_excluir_usuario já limpa
--         os dois lados.)
--   • Se "existe nos dois, status=pendente": não é erro — já há solicitação em
--     análise. O cadastro agora mostra essa mensagem em vez de "já cadastrado".
--   • Se "vínculo incorreto":
--       SELECT fn_corrigir_vinculo_email('thais.silva@rassininhk.com.br');
-- =============================================================================
