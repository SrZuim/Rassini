-- =============================================================================
-- RNA One — FECHAMENTO MENSAL · CORREÇÃO: MÓDULO EXCLUSIVO DO ADMINISTRADOR
-- Rassini NHK Automotive
-- -----------------------------------------------------------------------------
-- O QUE ESTE ARQUIVO FAZ
--   1. Diagnostica o banco (tabelas fm_*, policies, perfil do usuário atual).
--   2. Reescreve fm_is_admin() para a estrutura REAL de `usuarios`.
--   3. Apaga TODA policy das tabelas fm_* e recria apenas as de administrador.
--   4. Cria fm_check_structure(), o verificador que o frontend consome.
--   5. Cria/ajusta o bucket privado `fechamento-mensal` no Storage.
--   6. Recarrega o cache do PostgREST e confere o resultado.
--
-- NÃO APAGA DADOS. Nenhum drop table, truncate, delete ou cascade.
-- IDEMPOTENTE: rodar duas vezes produz o mesmo estado.
--
-- PRÉ-REQUISITO: database/fechamento_mensal.sql já executado NESTE projeto.
--   Se as tabelas não existirem, o script para na seção 1 dizendo isso.
--
-- ORDEM: fechamento_mensal.sql  →  ESTE ARQUIVO.
--   (fechamento_mensal.sql já foi atualizado com estas mesmas regras; este
--    arquivo existe para bancos onde a versão ANTERIOR, permissiva, já rodou.)
--
-- COMO O PERFIL É GUARDADO DE VERDADE (verificado no projeto, não presumido):
--   tabela  public.usuarios
--   coluna  role   → enum perfil_tipo: 'admin' | 'supervisor' | 'auditor' | 'visitante'
--   coluna  status → enum status_usuario: 'pendente'|'aprovado'|'recusado'|'bloqueado'
--   coluna  ativo  → boolean
--   NÃO existe coluna `perfil`. O valor do administrador é 'admin' (minúsculo).
-- =============================================================================

-- ============================================================================
-- 1. DIAGNÓSTICO — o que existe HOJE neste banco
-- ============================================================================
do $$
declare
  v_faltando text[] := '{}';
  t text;
  obrigatorias text[] := array[
    'fm_competencias','fm_reclamacoes','fm_ocorrencias','fm_producao',
    'fm_fornecimento','fm_criterios','fm_metas','fm_pendencias','fm_memoria'];
begin
  raise notice '--- FECHAMENTO MENSAL · diagnóstico -------------------------';
  raise notice 'banco=%  schema=public', current_database();
  raise notice 'tabelas fm_* encontradas: %',
    (select coalesce(count(*),0) from pg_tables where schemaname='public' and tablename like 'fm\_%');
  raise notice 'policies fm_* encontradas: %',
    (select coalesce(count(*),0) from pg_policies where schemaname='public' and tablename like 'fm\_%');

  foreach t in array obrigatorias loop
    if to_regclass('public.' || t) is null then v_faltando := v_faltando || t; end if;
  end loop;

  if array_length(v_faltando, 1) > 0 then
    raise exception E'As tabelas % NÃO existem neste banco (%).\n'
      'Rode database/fechamento_mensal.sql PRIMEIRO, no MESMO projeto Supabase que o frontend usa '
      '(confira o project ref em services/config.js → SUPABASE.url).',
      v_faltando, current_database();
  end if;

  raise notice 'estrutura base presente — seguindo para a correção de permissões.';
end $$;

-- Fotografia das policies ANTES de mexer (fica no output do SQL Editor).
select tablename, policyname, cmd, roles::text as roles, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename like 'fm\_%'
 order by tablename, policyname;

-- ============================================================================
-- 2. AUTORIZAÇÃO — uma função, um perfil
-- ============================================================================
-- security definer: precisa ler `usuarios` com o RLS de `usuarios` ligado.
-- search_path fixo: impede desvio por schema plantado no caminho de busca.
-- stable: o planner avalia uma vez por consulta, não uma vez por linha.
create or replace function public.fm_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from usuarios u
     where (u.auth_id = auth.uid() or lower(u.email) = lower(auth.jwt() ->> 'email'))
       and lower(u.role::text) = 'admin'
       and coalesce(u.ativo, true) = true
       and lower(coalesce(u.status::text, 'aprovado')) in ('aprovado','approved')
  );
$$;

-- Compatibilidade: policies, triggers e RPCs antigos ainda chamam estas duas.
-- Em vez de caçar cada referência (e deixar passar uma), as duas passam a
-- responder exatamente como fm_is_admin().
create or replace function public.fm_is_gestor() returns boolean
language sql stable as $$ select public.fm_is_admin(); $$;

create or replace function public.fm_is_operacional() returns boolean
language sql stable as $$ select public.fm_is_admin(); $$;

revoke all on function public.fm_is_admin()       from public;
revoke all on function public.fm_is_gestor()      from public;
revoke all on function public.fm_is_operacional() from public;
grant execute on function public.fm_is_admin()       to authenticated;
grant execute on function public.fm_is_gestor()      to authenticated;
grant execute on function public.fm_is_operacional() to authenticated;

-- ============================================================================
-- 3. RLS — apaga tudo o que havia e recria só o do administrador
-- ============================================================================
-- Policies concorrentes em RLS combinam com OR, não com AND: uma única sobra
-- permissiva ("fm_read_... using (current_perfil() <> 'visitante')") anularia
-- todo o resto. Por isso a limpeza é total dentro de fm_* — e SOMENTE dentro
-- de fm_*: nenhuma tabela de outro módulo é tocada.
do $$
declare r record;
begin
  for r in select tablename from pg_tables
            where schemaname = 'public' and tablename like 'fm\_%' loop
    execute format('alter table public.%I enable row level security;', r.tablename);
  end loop;

  for r in select tablename, policyname from pg_policies
            where schemaname = 'public' and tablename like 'fm\_%' loop
    execute format('drop policy if exists %I on public.%I;', r.policyname, r.tablename);
    raise notice 'policy removida: %.%', r.tablename, r.policyname;
  end loop;
end $$;

-- 3.1 Regra padrão: administrador faz tudo; qualquer outro perfil não vê nada.
do $$
declare r record;
begin
  for r in select tablename from pg_tables
            where schemaname = 'public' and tablename like 'fm\_%'
              and tablename <> 'fm_logs' loop
    execute format($f$create policy "fm_admin_select_%1$s" on public.%1$I
      for select to authenticated using (fm_is_admin());$f$, r.tablename);
    execute format($f$create policy "fm_admin_insert_%1$s" on public.%1$I
      for insert to authenticated with check (fm_is_admin());$f$, r.tablename);
    execute format($f$create policy "fm_admin_update_%1$s" on public.%1$I
      for update to authenticated using (fm_is_admin()) with check (fm_is_admin());$f$, r.tablename);
    execute format($f$create policy "fm_admin_delete_%1$s" on public.%1$I
      for delete to authenticated using (fm_is_admin());$f$, r.tablename);
  end loop;
end $$;

-- 3.2 Competência FECHADA é somente leitura — inclusive para o administrador.
--     Isto não é permissão, é regra de negócio (§15/§46): reabrir é um ato
--     formal, registrado na trilha.
do $$
declare t text;
  tabelas text[] := array[
    'fm_secoes','fm_reclamacoes','fm_ocorrencias','fm_producao','fm_fornecimento',
    'fm_resultados','fm_custos','fm_retrabalho','fm_sucata','fm_care','fm_quebras',
    'fm_seguranca','fm_cruz_dias','fm_pendencias','fm_memoria'];
begin
  if to_regproc('public.fm_competencia_editavel') is null then
    raise warning 'fm_competencia_editavel() não existe — a trava de competência fechada NÃO foi aplicada. Rode database/fechamento_mensal.sql.';
    return;
  end if;
  foreach t in array tabelas loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop policy if exists "fm_admin_insert_%1$s" on public.%1$I;', t);
    execute format($f$create policy "fm_admin_insert_%1$s" on public.%1$I for insert to authenticated
      with check (fm_is_admin() and fm_competencia_editavel(competencia_id));$f$, t);
    execute format('drop policy if exists "fm_admin_update_%1$s" on public.%1$I;', t);
    execute format($f$create policy "fm_admin_update_%1$s" on public.%1$I for update to authenticated
      using (fm_is_admin() and fm_competencia_editavel(competencia_id))
      with check (fm_is_admin() and fm_competencia_editavel(competencia_id));$f$, t);
  end loop;

  -- fm_acoes: a ação 5W2H atravessa meses. O INSERT respeita a competência de
  -- origem; o UPDATE não — senão fechar o mês congelaria o acompanhamento das
  -- ações que continuam abertas.
  if to_regclass('public.fm_acoes') is not null then
    drop policy if exists "fm_admin_insert_fm_acoes" on public.fm_acoes;
    create policy "fm_admin_insert_fm_acoes" on public.fm_acoes for insert to authenticated
      with check (fm_is_admin() and fm_competencia_editavel(competencia_origem_id));
  end if;
end $$;

-- 3.3 Trilha de auditoria: append-only, leitura só do administrador.
--     O INSERT fica liberado a propósito — a trilha precisa registrar também a
--     tentativa de quem não é admin. Sem policy de UPDATE/DELETE, nenhuma linha
--     pode ser alterada nem apagada, por ninguém.
do $$
begin
  if to_regclass('public.fm_logs') is null then return; end if;
  execute 'alter table public.fm_logs enable row level security';
  execute 'drop policy if exists "fm_logs_insert" on public.fm_logs';
  execute 'create policy "fm_logs_insert" on public.fm_logs for insert to authenticated with check (true)';
  execute 'drop policy if exists "fm_logs_read" on public.fm_logs';
  execute 'create policy "fm_logs_read" on public.fm_logs for select to authenticated using (fm_is_admin())';
end $$;

-- ============================================================================
-- 4. VERIFICADOR DE ESTRUTURA (o que o frontend chama)
-- ============================================================================
-- Responde SÓ pela existência das tabelas (to_regclass não passa por RLS) e
-- separa "não é administrador" num erro 42501 identificável. É isso que permite
-- ao front distinguir estrutura ausente de acesso negado, em vez de acusar
-- "tabela ausente" para todo erro.
create or replace function public.fm_check_structure()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_tabelas jsonb := '{}'::jsonb;
  t text;
  obrigatorias text[] := array[
    'fm_competencias','fm_reclamacoes','fm_ocorrencias','fm_producao',
    'fm_fornecimento','fm_criterios','fm_metas','fm_pendencias','fm_memoria'];
begin
  if not fm_is_admin() then
    raise exception 'Acesso não autorizado. Esta área está disponível exclusivamente para administradores.'
      using errcode = '42501';
  end if;

  foreach t in array obrigatorias loop
    v_tabelas := v_tabelas || jsonb_build_object(t, to_regclass('public.' || t) is not null);
  end loop;

  return jsonb_build_object(
    'tabelas', v_tabelas,
    'schema',  'public',
    'banco',   current_database(),
    'total_fm', (select count(*) from pg_tables
                  where schemaname = 'public' and tablename like 'fm\_%'),
    'verificado_em', now()
  );
end $$;

revoke all on function public.fm_check_structure() from public;
grant execute on function public.fm_check_structure() to authenticated;

-- ============================================================================
-- 5. STORAGE PRIVADO — bucket `fechamento-mensal`
-- ============================================================================
-- Pastas (convenção de path, não objetos do Postgres):
--   importacoes/  evidencias/  apresentacoes/  pdf/  powerpoint/  memorias-calculo/
-- Privado: nenhuma URL pública. O download acontece por URL ASSINADA temporária
-- (createSignedUrl), emitida só depois de o RLS confirmar o administrador.
--
-- Em alguns projetos o papel do SQL Editor não é dono de storage.objects. Se
-- for o caso, o bloco AVISA em vez de derrubar a migration inteira — e diz o
-- que fazer pelo painel.
do $$
begin
  if to_regclass('storage.buckets') is null then
    raise warning 'Extensão de Storage ausente neste projeto — bucket não criado.';
    return;
  end if;

  insert into storage.buckets (id, name, public)
  values ('fechamento-mensal', 'fechamento-mensal', false)
  on conflict (id) do update set public = false;   -- nunca deixa virar público

  raise notice 'bucket fechamento-mensal: privado.';
exception when others then
  -- Falta de privilégio sobre storage.* é comum e NÃO pode derrubar a correção
  -- de RLS que já passou. Vira aviso com a instrução manual.
  raise warning 'Bucket não criado (%). Crie "fechamento-mensal" pelo painel: Storage → New bucket, Public = OFF.', sqlerrm;
end $$;

do $$
begin
  if to_regclass('storage.objects') is null then return; end if;

  execute 'drop policy if exists "fm_storage_select" on storage.objects';
  execute 'drop policy if exists "fm_storage_insert" on storage.objects';
  execute 'drop policy if exists "fm_storage_update" on storage.objects';
  execute 'drop policy if exists "fm_storage_delete" on storage.objects';

  execute $p$create policy "fm_storage_select" on storage.objects for select to authenticated
    using (bucket_id = 'fechamento-mensal' and public.fm_is_admin())$p$;
  execute $p$create policy "fm_storage_insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'fechamento-mensal' and public.fm_is_admin())$p$;
  execute $p$create policy "fm_storage_update" on storage.objects for update to authenticated
    using (bucket_id = 'fechamento-mensal' and public.fm_is_admin())
    with check (bucket_id = 'fechamento-mensal' and public.fm_is_admin())$p$;
  execute $p$create policy "fm_storage_delete" on storage.objects for delete to authenticated
    using (bucket_id = 'fechamento-mensal' and public.fm_is_admin())$p$;

  raise notice 'policies de storage do fechamento: apenas administrador.';
exception when others then
  raise warning 'Policies de storage não criadas (%). Crie-as pelo painel (Storage → Policies) com a condição: bucket_id = ''fechamento-mensal'' and public.fm_is_admin().', sqlerrm;
end $$;

-- ============================================================================
-- 6. CACHE DO POSTGREST
-- ============================================================================
-- Depois de criar/alterar tabelas, funções e policies o PostgREST continua
-- servindo o schema antigo — e responde PGRST205 ("could not find the table in
-- the schema cache") para o que já existe. Isto resolve SEM recriar nada.
notify pgrst, 'reload schema';

-- ============================================================================
-- 7. CONFERÊNCIA FINAL
-- ============================================================================
do $$
declare
  v_sem_rls    text[];
  v_permissiva int;
begin
  select coalesce(array_agg(c.relname order by c.relname), '{}')
    into v_sem_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relname like 'fm\_%' and c.relrowsecurity = false;

  if array_length(v_sem_rls, 1) > 0 then
    raise exception 'Tabelas fm_* sem RLS: %', v_sem_rls;
  end if;

  -- Qualquer policy que não mencione fm_is_admin é uma porta aberta.
  -- Exceção deliberada: fm_logs_insert (trilha append-only, ver 3.3).
  select count(*) into v_permissiva
    from pg_policies
   where schemaname = 'public' and tablename like 'fm\_%'
     and policyname <> 'fm_logs_insert'
     and coalesce(qual, '') || coalesce(with_check, '') not like '%fm_is_admin%';

  if v_permissiva > 0 then
    raise exception 'Ainda existem % policies fm_* sem fm_is_admin(). Rode este arquivo novamente.', v_permissiva;
  end if;

  raise notice '--- OK -------------------------------------------------------';
  raise notice 'tabelas fm_*: %  |  policies fm_*: %  |  todas exigem fm_is_admin()',
    (select count(*) from pg_tables   where schemaname='public' and tablename like 'fm\_%'),
    (select count(*) from pg_policies where schemaname='public' and tablename like 'fm\_%');
end $$;

-- Estado final das policies — confira no output.
select tablename, policyname, cmd, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename like 'fm\_%'
 order by tablename, policyname;

-- -----------------------------------------------------------------------------
-- DIAGNÓSTICO MANUAL (rode separado, logado como o usuário em questão)
--
--   -- 1) Meu perfil, do jeito que o banco vê:
--   select id, nome, email, role::text, status::text, ativo
--     from public.usuarios
--    where auth_id = auth.uid() or lower(email) = lower(auth.jwt() ->> 'email');
--
--   -- 2) Sou administrador para o módulo?
--   select public.fm_is_admin();
--
--   -- 3) A estrutura está completa?
--   select public.fm_check_structure();
--
--   -- 4) Todas as tabelas fm_* estão no schema public?
--   select schemaname, tablename from pg_tables
--    where tablename like 'fm\_%' order by schemaname, tablename;
-- -----------------------------------------------------------------------------

-- =============================================================================
-- ROLLBACK (só das permissões — não devolve dado nenhum, porque nada é apagado)
--   As policies antigas por perfil estão na versão anterior de
--   database/fechamento_mensal.sql, no histórico do git:
--     git show HEAD~1:database/fechamento_mensal.sql > /tmp/fm_antigo.sql
--   e rode a seção "22. RLS (§44)" daquele arquivo.
--   Para remover o módulo inteiro: database/rollback_fechamento_mensal.sql.
-- =============================================================================
