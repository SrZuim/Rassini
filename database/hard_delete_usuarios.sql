-- =============================================================================
-- RNA One — EXCLUSÃO FÍSICA de usuários (DELETE real, com limpeza de vínculos)
-- Rassini NHK Automotive
-- -----------------------------------------------------------------------------
-- Troca o soft delete por DELETE físico de verdade em `usuarios`, removendo
-- antes as dependências que violariam foreign keys.
--
-- ESTRATÉGIA:
--   • notificacoes / usuarios_logs do usuário → APAGADOS (dados transitórios).
--   • Vínculos operacionais (rotinas, plantões, auditorias, NCs, etc.) e as
--     auto-referências (aprovado_por/deleted_by) → ANULADOS (SET NULL), para
--     PRESERVAR os registros de qualidade/operação. NÃO apagamos esses dados.
--   • Só então: DELETE FROM usuarios.
--
-- Onde colar: Supabase → SQL Editor → cole TUDO → Run. Idempotente.
-- =============================================================================

-- 0) DIAGNÓSTICO — todas as tabelas/colunas que apontam para usuarios.id ------
--    (rode isoladamente para conferir a estrutura real antes/depois)
-- SELECT tc.table_name, kcu.column_name, tc.constraint_name, rc.delete_rule
-- FROM information_schema.table_constraints tc
-- JOIN information_schema.key_column_usage kcu
--   ON tc.constraint_name = kcu.constraint_name
-- JOIN information_schema.constraint_column_usage ccu
--   ON ccu.constraint_name = tc.constraint_name
-- JOIN information_schema.referential_constraints rc
--   ON rc.constraint_name = tc.constraint_name
-- WHERE tc.constraint_type = 'FOREIGN KEY' AND ccu.table_name = 'usuarios'
-- ORDER BY tc.table_name;

-- 1) notificacoes → ON DELETE CASCADE (coluna real é "destinatario") ----------
alter table notificacoes drop constraint if exists notificacoes_destinatario_fkey;
alter table notificacoes
  add constraint notificacoes_destinatario_fkey
  foreign key (destinatario) references usuarios(id) on delete cascade;

-- 2) usuarios_logs → ON DELETE SET NULL (preserva o texto do log) -------------
alter table usuarios_logs drop constraint if exists usuarios_logs_executor_id_fkey;
alter table usuarios_logs
  add constraint usuarios_logs_executor_id_fkey
  foreign key (executor_id) references usuarios(id) on delete set null;
alter table usuarios_logs drop constraint if exists usuarios_logs_afetado_id_fkey;
alter table usuarios_logs
  add constraint usuarios_logs_afetado_id_fkey
  foreign key (afetado_id) references usuarios(id) on delete set null;

-- 3) RPC de exclusão FÍSICA (substitui a versão soft delete) ------------------
--    Mantém as travas: só admin; nunca a si mesmo. Registra a exclusão.
create or replace function fn_excluir_usuario(p_alvo uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_adm usuarios; v_alvo usuarios;
begin
  select * into v_adm from usuarios where auth_id = auth.uid() or lower(email) = auth_email() limit 1;
  if coalesce(v_adm.role::text,'') <> 'admin' then raise exception 'Apenas administradores.'; end if;
  if p_alvo = v_adm.id then raise exception 'Você não pode excluir a si mesmo.'; end if;
  select * into v_alvo from usuarios where id = p_alvo;
  if v_alvo.id is null then raise exception 'Usuário não encontrado.'; end if;

  -- Registro de auditoria da exclusão (afetado_id nulo → sobrevive à limpeza)
  insert into usuarios_logs(executor_id, executor_nome, afetado_id, afetado_nome, acao, detalhe, antes)
  values (v_adm.id, v_adm.nome, null, v_alvo.nome, 'exclusao',
          coalesce(p_motivo, 'Exclusão física do banco de dados'), to_jsonb(v_alvo));

  -- (a) dependências transitórias → apagar
  delete from notificacoes where destinatario = p_alvo;
  delete from usuarios_logs  where afetado_id = p_alvo or executor_id = p_alvo;

  -- (b) auto-referências em usuarios → anular (não apaga outros usuários!)
  update usuarios set aprovado_por = null where aprovado_por = p_alvo;
  update usuarios set deleted_by   = null where deleted_by   = p_alvo;

  -- (c) vínculos operacionais → anular (preserva os registros de qualidade)
  update rotinas           set auditor     = null where auditor     = p_alvo;
  update plantoes          set usuario     = null where usuario     = p_alvo;
  update atividades        set auditor     = null where auditor     = p_alvo;
  update auditorias        set auditor     = null where auditor     = p_alvo;
  update checklist         set auditor     = null where auditor     = p_alvo;
  update nao_conformidades set responsavel = null where responsavel = p_alvo;
  update planos_acao       set responsavel = null where responsavel = p_alvo;
  update evidencias        set created_by  = null where created_by  = p_alvo;
  update rotina_exec       set auditor     = null where auditor     = p_alvo;
  update checklist_exec    set auditor     = null where auditor     = p_alvo;
  update auditorias_peca   set auditor     = null where auditor     = p_alvo;
  -- supervisores/auditores já são ON DELETE CASCADE (removidos automaticamente)

  -- (d) finalmente, apaga o usuário
  delete from usuarios where id = p_alvo;
end $$;

grant execute on function fn_excluir_usuario(uuid, text) to authenticated;

-- 4) Remove a função de restaurar (não faz sentido com exclusão física) -------
drop function if exists fn_restaurar_usuario(uuid);

-- Diagnóstico pós-exclusão:
-- SELECT count(*) FROM usuarios;                     -- deve diminuir
-- SELECT * FROM usuarios WHERE id = '<uuid excluído>'; -- deve retornar 0 linhas
