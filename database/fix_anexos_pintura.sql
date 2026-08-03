-- =============================================================================
-- RNA One — CORREÇÃO: anexos da Inspeção Após Pintura não persistem
-- Rassini NHK Automotive · PostgreSQL / Supabase · IDEMPOTENTE (pode reexecutar)
-- -----------------------------------------------------------------------------
-- SINTOMA
--   Na etapa "Inspeção Após Pintura" o usuário escolhe o arquivo, mas ao
--   atualizar/reabrir o relatório o anexo sumiu. Vale para os DOIS anexos:
--     1) Evidência da característica visual (foto)  → insp_anexos
--     2) Relatório de Pintura (PDF/JPG/JPEG/PNG)    → insp_relatorios.relatorio_pintura
--
-- CAUSA RAIZ (verificada neste projeto em 2026-08-03)
--   O bucket de Storage `evidencias` NÃO EXISTE no projeto Supabase. A chamada
--   `storage.from('evidencias').upload(...)` devolve `Bucket not found`, então o
--   arquivo nunca chega ao Storage e, por consequência, nenhuma URL é gravada.
--   Confirmação (sem login):
--     GET https://<projeto>.supabase.co/storage/v1/object/public/evidencias/x
--     → {"error":"Bucket not found","code":"NoSuchBucket"}
--
-- CAUSAS SECUNDÁRIAS COBERTAS AQUI
--   b) `insp_relatorios.relatorio_pintura` pode não existir (migration
--      database/inspecao_apos_pintura.sql nunca rodada) — reaplicada abaixo.
--   c) `insp_anexos` continuava com a policy ANTIGA "só o auditor DONO escreve".
--      Depois de fix_amostras_colaborativas.sql (§M04) medições/características
--      liberaram a colaboração, mas insp_anexos ficou para trás: o auditor
--      colaborador (e os cargos auditor_recebimento / eng_processos /
--      laboratorio) não conseguia gravar a evidência. Corrigido abaixo com o
--      MESMO predicado das demais tabelas do relatório.
--
-- ORDEM: rode DEPOIS de auditorias_dimensional.sql e fix_amostras_colaborativas.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) COLUNA DO RELATÓRIO DE PINTURA (reaplica inspecao_apos_pintura.sql)
-- ---------------------------------------------------------------------------
alter table insp_relatorios
  add column if not exists relatorio_pintura jsonb;

comment on column insp_relatorios.relatorio_pintura is
  'Inspeção Após Pintura: anexo único do Relatório de Pintura (PDF/JPG/JPEG/PNG). '
  'Estrutura: {nome, tipo, url, path, tamanho, uploaded_by, uploaded_nome, created_at}. '
  'null quando ainda não anexado.';

-- ---------------------------------------------------------------------------
-- 2) TABELA DAS EVIDÊNCIAS (insp_anexos) — garante estrutura completa
--    `path` é novo: guarda o caminho do objeto no Storage, o que permite
--    remover o arquivo ao excluir o anexo (sem ele, remover deixava lixo).
-- ---------------------------------------------------------------------------
create table if not exists insp_anexos (
  id text primary key default gen_random_uuid()::text,
  relatorio_id text references insp_relatorios(id) on delete cascade,
  caracteristica_id text, medicao_id text,
  nome text, tipo text, url text, tamanho text, uploaded_by text,
  created_at timestamptz default now()
);

alter table insp_anexos add column if not exists caracteristica_id text;
alter table insp_anexos add column if not exists medicao_id        text;
alter table insp_anexos add column if not exists nome              text;
alter table insp_anexos add column if not exists tipo              text;
alter table insp_anexos add column if not exists url               text;
alter table insp_anexos add column if not exists tamanho           text;
alter table insp_anexos add column if not exists uploaded_by       text;
alter table insp_anexos add column if not exists uploaded_nome     text;
alter table insp_anexos add column if not exists path              text;
alter table insp_anexos add column if not exists created_at        timestamptz default now();

comment on column insp_anexos.path is
  'Caminho do objeto dentro do bucket "evidencias" (ex.: insp_visual/<rel>/<ts>_foto.jpg). '
  'Permite apagar o arquivo do Storage ao remover o anexo. null em anexos antigos.';

create index if not exists insp_anexos_rel_idx on insp_anexos (relatorio_id);
create index if not exists insp_anexos_car_idx on insp_anexos (caracteristica_id);

-- ---------------------------------------------------------------------------
-- 3) RLS de insp_anexos — alinhada à colaboração (§M04)
--    Antes: só o auditor DONO do relatório escrevia. Agora: qualquer usuário
--    autenticado escreve enquanto o relatório estiver ABERTO; relatório
--    finalizado/revisado continua bloqueado para o auditor comum (§21).
--    É exatamente o predicado já usado em insp_medicoes/insp_caracteristicas.
-- ---------------------------------------------------------------------------
alter table insp_anexos enable row level security;

do $$
begin
  drop policy if exists "insp_anexos_rw"   on insp_anexos;
  drop policy if exists "insp_anexos_read" on insp_anexos;
  drop policy if exists "insp_anexos_write" on insp_anexos;

  -- Leitura ampla: o relatório é consultado por outros usuários (consulta
  -- corporativa, PDF, monitoramento). Sem isso o anexo "some" para terceiros.
  create policy "insp_anexos_read" on insp_anexos
    for select to authenticated using (true);

  create policy "insp_anexos_write" on insp_anexos
    for all to authenticated
    using (
      relatorio_id in (select id from insp_relatorios where status not like 'finalizada%' and status <> 'revisada')
      or current_perfil() in ('admin','supervisor')
    )
    with check (
      relatorio_id in (select id from insp_relatorios where status not like 'finalizada%' and status <> 'revisada')
      or current_perfil() in ('admin','supervisor')
    );
end $$;

-- ---------------------------------------------------------------------------
-- 4) TABELA LEGADA `evidencias` — libera os cargos de medição
--    O componente de upload espelha a evidência nesta tabela (histórico geral).
--    A policy antiga só aceitava admin/supervisor/auditor, então os cargos
--    criados depois (auditor_recebimento, eng_processos, laboratorio) tomavam
--    42501 ao salvar. O espelho passou a ser best-effort no código, mas liberar
--    aqui é o certo: o registro precisa existir para os três cargos.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.evidencias') is not null then
    drop policy if exists "write_oper_evidencias"  on evidencias;
    drop policy if exists "update_oper_evidencias" on evidencias;

    create policy "write_oper_evidencias" on evidencias
      for insert to authenticated
      with check (current_perfil() in ('admin','supervisor','auditor',
                                       'auditor_recebimento','eng_processos','laboratorio'));

    create policy "update_oper_evidencias" on evidencias
      for update to authenticated
      using (current_perfil() in ('admin','supervisor','auditor',
                                  'auditor_recebimento','eng_processos','laboratorio'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5) STORAGE — bucket `evidencias`  ◀━━ ESTA É A CAUSA RAIZ
--    Sem o bucket, TODO upload falha antes de tocar o banco.
--    public = true → a URL pública devolvida por getPublicUrl abre direto no
--    navegador (é o que as telas e o PDF usam para exibir/baixar).
--    25 MB cobre com folga os limites da aplicação (15 MB por arquivo).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'evidencias', 'evidencias', true, 26214400,
  array['image/jpeg','image/jpg','image/png','image/webp','application/pdf']
)
on conflict (id) do update
  set public             = true,
      file_size_limit    = greatest(coalesce(storage.buckets.file_size_limit, 0), 26214400),
      allowed_mime_types = array['image/jpeg','image/jpg','image/png','image/webp','application/pdf'];

-- ---------------------------------------------------------------------------
-- 6) POLICIES DO STORAGE
--    Leitura pública (o bucket é public), escrita/remoção por autenticado.
--    A remoção é necessária para o rollback: quando o arquivo sobe mas a
--    gravação no banco falha, a aplicação apaga o objeto para não deixar órfão.
--
--    NOTA: em alguns projetos o SQL Editor não é dono de storage.objects e o
--    CREATE POLICY falha. Por isso este bloco captura a exceção e emite um
--    aviso em vez de abortar a migration — as policies podem então ser criadas
--    pelo painel (Storage → evidencias → Policies).
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    drop policy if exists "evidencias_read_public"  on storage.objects;
    drop policy if exists "evidencias_insert_auth"  on storage.objects;
    drop policy if exists "evidencias_update_auth"  on storage.objects;
    drop policy if exists "evidencias_delete_auth"  on storage.objects;

    create policy "evidencias_read_public" on storage.objects
      for select to public using (bucket_id = 'evidencias');

    create policy "evidencias_insert_auth" on storage.objects
      for insert to authenticated with check (bucket_id = 'evidencias');

    create policy "evidencias_update_auth" on storage.objects
      for update to authenticated using (bucket_id = 'evidencias')
      with check (bucket_id = 'evidencias');

    create policy "evidencias_delete_auth" on storage.objects
      for delete to authenticated using (bucket_id = 'evidencias');

    raise notice 'Policies do bucket "evidencias" criadas.';
  exception when insufficient_privilege or others then
    raise warning 'Nao foi possivel criar as policies de storage.objects (%). '
                  'Crie no painel: Storage > evidencias > Policies — SELECT public, '
                  'INSERT/UPDATE/DELETE authenticated, todas com bucket_id = ''evidencias''.',
                  sqlerrm;
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 7) VERIFICAÇÃO — rode e confira o resultado
-- ---------------------------------------------------------------------------
-- a) A coluna do Relatório de Pintura existe?
select 'relatorio_pintura' as item,
       case when exists (
         select 1 from information_schema.columns
          where table_name = 'insp_relatorios' and column_name = 'relatorio_pintura'
       ) then 'OK' else 'FALTANDO' end as situacao;

-- b) O bucket existe e é público?
select 'bucket evidencias' as item,
       coalesce((select case when public then 'OK (publico)' else 'EXISTE, MAS PRIVADO' end
                   from storage.buckets where id = 'evidencias'), 'FALTANDO') as situacao;

-- c) Policies do bucket (esperado: 4 linhas).
select policyname, cmd from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
   and policyname like 'evidencias_%'
 order by policyname;

-- d) Policies de insp_anexos (esperado: insp_anexos_read + insp_anexos_write).
select policyname, cmd from pg_policies
 where tablename = 'insp_anexos' order by policyname;
