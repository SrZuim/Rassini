-- =============================================================================
-- RNA One — Buckets de Storage ausentes (Biblioteca Técnica, Documentos, Comunicados)
-- Rassini NHK Automotive · PostgreSQL / Supabase · IDEMPOTENTE (pode reexecutar)
-- -----------------------------------------------------------------------------
-- CAUSA RAIZ (verificada em 2026-08-04, sem login, pela API pública do Storage)
--   Dos quatro buckets que o sistema usa, só `evidencias` existia (criado por
--   fix_anexos_pintura.sql). Os outros TRÊS nunca foram criados:
--
--     GET /storage/v1/object/public/biblioteca/x   → {"code":"NoSuchBucket"}
--     GET /storage/v1/object/public/documentos/x   → {"code":"NoSuchBucket"}
--     GET /storage/v1/object/public/comunicados/x  → {"code":"NoSuchBucket"}
--
--   Consequência: TODO upload da Biblioteca Técnica (desenho, PDF, DWG, planilha)
--   falhava no primeiro passo — o arquivo nunca chegava ao Storage, então nenhuma
--   URL era gravada e o anexo "sumia" ao recarregar. É o mesmo defeito de
--   ambiente que derrubava os anexos da Inspeção Após Pintura.
--
--   `biblioteca` passa a ser também o destino da IMAGEM PRINCIPAL da peça, que
--   antes ia para o bucket `evidencias` (pasta certa, bucket errado). Imagens já
--   salvas continuam funcionando: o banco guarda a URL completa, então os
--   registros antigos seguem apontando para `evidencias` sem migração.
--
-- Rode no SQL Editor do Supabase. Ver também: database/fix_anexos_pintura.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) BUCKETS
--    public = true → getPublicUrl devolve link que abre direto (é o que as
--    fichas, o catálogo e o PDF usam para exibir).
--    Limites: imagens até 10 MB e documentos técnicos até 20 MB (regra da
--    aplicação em services/biblioteca-midia.js); 25 MB dá folga ao envelope.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('biblioteca', 'biblioteca', true, 26214400, array[
     'image/jpeg','image/jpg','image/png','image/webp',
     'application/pdf',
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.ms-excel',
     'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/msword',
     'application/zip','application/x-zip-compressed',
     'application/acad','image/vnd.dwg','image/vnd.dxf','application/dxf','application/octet-stream'
   ]),
  ('documentos', 'documentos', true, 26214400, null),
  ('comunicados','comunicados', true, 26214400, array['image/jpeg','image/jpg','image/png','image/webp'])
on conflict (id) do update
  set public          = true,
      file_size_limit = greatest(coalesce(storage.buckets.file_size_limit, 0), 26214400),
      allowed_mime_types = excluded.allowed_mime_types;

-- NOTA sobre 'application/octet-stream' em `biblioteca`: DWG/DXF não têm MIME
-- padronizado e o navegador manda octet-stream para eles. Sem esse item na
-- lista, anexar um desenho DWG seria recusado com "mime type not supported".

-- ---------------------------------------------------------------------------
-- 2) POLICIES — leitura pública, escrita/remoção por autenticado
--    Mesma forma usada no bucket `evidencias`. Protegido por EXCEPTION porque
--    em alguns projetos o SQL Editor não é dono de storage.objects; nesse caso
--    o aviso ensina o caminho pelo painel em vez de abortar a migration.
-- ---------------------------------------------------------------------------
do $$
declare b text;
begin
  foreach b in array array['biblioteca','documentos','comunicados'] loop
    begin
      execute format('drop policy if exists %I on storage.objects', b || '_read_public');
      execute format('drop policy if exists %I on storage.objects', b || '_insert_auth');
      execute format('drop policy if exists %I on storage.objects', b || '_update_auth');
      execute format('drop policy if exists %I on storage.objects', b || '_delete_auth');

      execute format('create policy %I on storage.objects for select to public using (bucket_id = %L)',
                     b || '_read_public', b);
      execute format('create policy %I on storage.objects for insert to authenticated with check (bucket_id = %L)',
                     b || '_insert_auth', b);
      execute format('create policy %I on storage.objects for update to authenticated using (bucket_id = %L) with check (bucket_id = %L)',
                     b || '_update_auth', b, b);
      execute format('create policy %I on storage.objects for delete to authenticated using (bucket_id = %L)',
                     b || '_delete_auth', b);

      raise notice 'Policies do bucket "%" criadas.', b;
    exception when others then
      raise warning 'CREATE POLICY recusado para o bucket "%" (%). Crie no painel: '
                    'Storage > % > Policies — SELECT public, INSERT/UPDATE/DELETE authenticated.',
                    b, sqlerrm, b;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3) VERIFICAÇÃO — uma grade só (o SQL Editor exibe apenas a última consulta)
-- ---------------------------------------------------------------------------
select b.id as bucket,
       case when b.public then 'OK (publico)' else 'EXISTE, MAS PRIVADO' end as situacao,
       (select count(*) from pg_policies p
         where p.schemaname = 'storage' and p.tablename = 'objects'
           and p.policyname like b.id || '\_%') as policies_esperado_4
  from storage.buckets b
 where b.id in ('evidencias','biblioteca','documentos','comunicados')
union all
select faltante, 'FALTANDO', 0
  from unnest(array['evidencias','biblioteca','documentos','comunicados']) as faltante
 where faltante not in (select id from storage.buckets)
 order by 1;
