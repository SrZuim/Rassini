-- =============================================================================
-- RNA One — Anexos da Inspeção Após Pintura (parte 2)
-- Rassini NHK Automotive · PostgreSQL / Supabase · IDEMPOTENTE
-- -----------------------------------------------------------------------------
-- Rode DEPOIS de database/fix_anexos_pintura.sql.
--
-- POR QUE ESTE SEGUNDO SCRIPT
--   Na parte 1, o bloco que cria as policies de `storage.objects` está protegido
--   por EXCEPTION: em muitos projetos o SQL Editor não é dono dessa tabela e o
--   CREATE POLICY vira WARNING — a migration segue, mas o bucket fica SEM
--   permissão de INSERT/DELETE. O sintoma disso no navegador é cruel: a resposta
--   de recusa vem sem cabeçalho CORS, o browser reporta "Failed to fetch" e o
--   sistema exibia "falha de conexão" com a rede perfeita.
--
--   Este script (1) diagnostica isso de forma explícita e (2) acrescenta a
--   coluna `peca_id` em insp_anexos para rastreabilidade completa do anexo.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) RASTREABILIDADE — peça do anexo
--    O vínculo auditoria×peça é `insp_relatorios.peca_id` (não há tabela de
--    ligação). Copiar a peça no anexo evita depender de join para saber a que
--    peça a evidência pertence, inclusive se a peça do relatório for trocada.
-- ---------------------------------------------------------------------------
alter table insp_anexos add column if not exists peca_id text;

comment on column insp_anexos.peca_id is
  'Peça (bib_pecas.id) vigente no relatório quando o anexo foi criado. '
  'Cópia histórica para rastreabilidade — o vínculo oficial é insp_relatorios.peca_id.';

create index if not exists insp_anexos_peca_idx on insp_anexos (peca_id);

-- Backfill dos anexos já existentes, a partir do relatório.
update insp_anexos a
   set peca_id = r.peca_id
  from insp_relatorios r
 where a.relatorio_id = r.id
   and a.peca_id is null
   and r.peca_id is not null;

-- ---------------------------------------------------------------------------
-- 2) DIAGNÓSTICO DAS POLICIES DE STORAGE — o item que ficou sem confirmação
--    Se o resultado for FALTANDO, o upload continua falhando com "Failed to
--    fetch" no navegador por mais correta que esteja a aplicação.
-- ---------------------------------------------------------------------------
do $$
declare n int;
begin
  select count(*) into n
    from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname like 'evidencias_%';

  if n >= 4 then
    raise notice 'Policies do bucket "evidencias": OK (% encontradas).', n;
  else
    raise warning
      'ATENCAO: apenas % policy(ies) do bucket "evidencias" existem (esperado 4). '
      'Enquanto isso, ENVIAR e REMOVER arquivo falha e o navegador mostra "Failed to fetch". '
      'Crie no painel: Storage > evidencias > Policies, todas com bucket_id = ''evidencias'' — '
      'SELECT para public, INSERT/UPDATE/DELETE para authenticated.', n;
  end if;
end $$;

-- Nova tentativa de criar as policies (caso a parte 1 tenha caído no WARNING).
do $$
begin
  begin
    drop policy if exists "evidencias_read_public" on storage.objects;
    drop policy if exists "evidencias_insert_auth" on storage.objects;
    drop policy if exists "evidencias_update_auth" on storage.objects;
    drop policy if exists "evidencias_delete_auth" on storage.objects;

    create policy "evidencias_read_public" on storage.objects
      for select to public using (bucket_id = 'evidencias');
    create policy "evidencias_insert_auth" on storage.objects
      for insert to authenticated with check (bucket_id = 'evidencias');
    create policy "evidencias_update_auth" on storage.objects
      for update to authenticated using (bucket_id = 'evidencias') with check (bucket_id = 'evidencias');
    create policy "evidencias_delete_auth" on storage.objects
      for delete to authenticated using (bucket_id = 'evidencias');

    raise notice 'Policies do bucket "evidencias" (re)criadas com sucesso.';
  exception when others then
    raise warning 'CREATE POLICY em storage.objects recusado (%). Use o painel: '
                  'Storage > evidencias > Policies.', sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 3) VERIFICAÇÃO ÚNICA — tudo numa grade só
--    (o SQL Editor mostra apenas o resultado da ÚLTIMA consulta)
-- ---------------------------------------------------------------------------
select 'coluna relatorio_pintura' as item,
       case when exists (select 1 from information_schema.columns
                          where table_name = 'insp_relatorios' and column_name = 'relatorio_pintura')
            then 'OK' else 'FALTANDO' end as situacao
union all
select 'colunas path/uploaded_nome/peca_id (insp_anexos)',
       case when (select count(*) from information_schema.columns
                   where table_name = 'insp_anexos'
                     and column_name in ('path','uploaded_nome','peca_id')) = 3
            then 'OK' else 'FALTANDO' end
union all
select 'bucket evidencias',
       coalesce((select case when public then 'OK (publico)' else 'EXISTE, MAS PRIVADO' end
                   from storage.buckets where id = 'evidencias'), 'FALTANDO')
union all
select 'MIME aceitos no bucket',
       coalesce((select coalesce(array_to_string(allowed_mime_types, ', '), 'todos')
                   from storage.buckets where id = 'evidencias'), 'FALTANDO')
union all
select 'policies do bucket (esperado 4)',
       (select count(*)::text from pg_policies
         where schemaname = 'storage' and tablename = 'objects' and policyname like 'evidencias_%')
union all
select 'policies insp_anexos (esperado 2)',
       (select count(*)::text from pg_policies where tablename = 'insp_anexos')
order by 1;
