-- =============================================================================
-- RNA One — ROLLBACK do módulo FECHAMENTO MENSAL
-- -----------------------------------------------------------------------------
-- Remove TODAS as tabelas, funções e políticas criadas por fechamento_mensal.sql.
-- NÃO toca em nenhuma tabela pré-existente do RNA One.
--
-- ATENÇÃO: `drop table ... cascade` APAGA OS DADOS do fechamento (competências,
-- reclamações, ocorrências, custos, importações, apresentações e a trilha de
-- auditoria fm_logs). Faça backup antes:
--
--   -- no SQL Editor, antes do rollback:
--   create schema if not exists fm_backup;
--   do $$ declare t text; begin
--     foreach t in array array['fm_competencias','fm_secoes','fm_status_hist',
--       'fm_reclamacoes','fm_ocorrencias','fm_producao','fm_fornecimento',
--       'fm_criterios','fm_metas','fm_resultados','fm_custos','fm_retrabalho',
--       'fm_sucata','fm_care','fm_quebras','fm_seguranca','fm_acoes',
--       'fm_acao_updates','fm_cruz_dias','fm_pendencias','fm_importacoes',
--       'fm_import_linhas','fm_import_versoes','fm_clientes_alias',
--       'fm_apres_templates','fm_apres_secoes','fm_apres_versoes','fm_arquivos',
--       'fm_memoria','fm_ajustes','fm_config','fm_logs'] loop
--       execute format('create table fm_backup.%1$s as table public.%1$s;', t);
--     end loop; end $$;
--
-- Para desativar o módulo SEM apagar dados, prefira remover a entrada
-- `fechamento` de MODULES em services/config.js — a interface some e o banco
-- permanece intacto.
-- =============================================================================

-- 1. Triggers (removidos junto com as tabelas, mas explícito para clareza)
do $$
declare t text;
  tabelas text[] := array[
    'fm_reclamacoes','fm_ocorrencias','fm_producao','fm_fornecimento','fm_resultados',
    'fm_custos','fm_retrabalho','fm_sucata','fm_care','fm_quebras','fm_seguranca',
    'fm_cruz_dias','fm_importacoes','fm_competencias','fm_secoes'];
begin
  foreach t in array tabelas loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists %1$s_touch on %1$s;', t);
      execute format('drop trigger if exists %1$s_guard on %1$s;', t);
    end if;
  end loop;
  if to_regclass('public.fm_competencias') is not null then
    drop trigger if exists fm_comp_touch on fm_competencias;
  end if;
  if to_regclass('public.fm_secoes') is not null then
    drop trigger if exists fm_secoes_touch on fm_secoes;
  end if;
end $$;

-- 2. Tabelas (ordem irrelevante por causa do CASCADE)
drop table if exists fm_logs            cascade;
drop table if exists fm_ajustes         cascade;
drop table if exists fm_memoria         cascade;
drop table if exists fm_arquivos        cascade;
drop table if exists fm_apres_versoes   cascade;
drop table if exists fm_apres_secoes    cascade;
drop table if exists fm_apres_templates cascade;
drop table if exists fm_clientes_alias  cascade;
drop table if exists fm_import_versoes  cascade;
drop table if exists fm_import_linhas   cascade;
drop table if exists fm_importacoes     cascade;
drop table if exists fm_pendencias      cascade;
drop table if exists fm_cruz_dias       cascade;
drop table if exists fm_acao_updates    cascade;
drop table if exists fm_acoes           cascade;
drop table if exists fm_seguranca       cascade;
drop table if exists fm_quebras         cascade;
drop table if exists fm_care            cascade;
drop table if exists fm_sucata          cascade;
drop table if exists fm_retrabalho      cascade;
drop table if exists fm_custos          cascade;
drop table if exists fm_resultados      cascade;
drop table if exists fm_metas           cascade;
drop table if exists fm_criterios       cascade;
drop table if exists fm_fornecimento    cascade;
drop table if exists fm_producao        cascade;
drop table if exists fm_ocorrencias     cascade;
drop table if exists fm_reclamacoes     cascade;
drop table if exists fm_status_hist     cascade;
drop table if exists fm_secoes          cascade;
drop table if exists fm_competencias    cascade;
drop table if exists fm_config          cascade;

-- 3. Funções do módulo
drop function if exists fm_check_structure();
drop function if exists fm_criar_proxima_competencia(text);
drop function if exists fm_reabrir_competencia(text, text, text);
drop function if exists fm_mudar_status(text, text, text);
drop function if exists fm_atualizar_quebras_atrasadas();
drop function if exists fm_atualizar_acoes_atrasadas();
drop function if exists fm_guard_fechada();
drop function if exists fm_competencia_editavel(text);
drop function if exists fm_planta_autorizada(text);
drop function if exists fm_is_operacional();
drop function if exists fm_is_gestor();
drop function if exists fm_is_admin();
drop function if exists fm_user_id();
drop function if exists fm_competencia_label(int, int);
drop function if exists fm_touch();
drop function if exists fm_hoje();

-- 4. Storage (opcional — apaga também os arquivos do bucket!)
--    Deixado COMENTADO de propósito: `delete from storage.objects` é
--    irreversível e o rollback do módulo não deveria destruir evidências.
-- drop policy if exists "fm_storage_select" on storage.objects;
-- drop policy if exists "fm_storage_insert" on storage.objects;
-- drop policy if exists "fm_storage_update" on storage.objects;
-- drop policy if exists "fm_storage_delete" on storage.objects;
-- delete from storage.objects where bucket_id = 'fechamento-mensal';
-- delete from storage.buckets where id = 'fechamento-mensal';

-- =============================================================================
-- Rollback do FRONTEND (opcional, se quiser remover o módulo por completo):
--   1. services/config.js  → apagar a entrada { id:'fechamento', ... } de MODULES
--                            e as chaves `fechamento:` de cada perfil no RBAC.
--   2. apagar fechamento-mensal.html
--   3. apagar assets/js/pages/fechamento-mensal.js
--   4. apagar assets/js/fechamento/  assets/css/fechamento.css
--   5. apagar services/fechamento/   tests/fechamento/
-- Nenhum arquivo pré-existente precisa ser revertido além de services/config.js.
-- =============================================================================
