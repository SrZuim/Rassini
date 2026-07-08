-- =============================================================================
-- RNA One — EXCLUSÃO SEGURA de usuários (soft delete / exclusão lógica)
-- Rassini NHK Automotive
-- -----------------------------------------------------------------------------
-- PROBLEMA: DELETE em `usuarios` viola a FK notificacoes_destinatario_fkey
--   (e potencialmente usuarios_logs), pois há registros vinculados ao usuário.
-- SOLUÇÃO (padrão corporativo): NÃO deletar fisicamente. Marcar como excluído:
--   status='excluido', ativo=false, deleted_at, deleted_by, motivo_exclusao.
--   O usuário some da lista principal, mas o histórico é 100% preservado e a
--   FK nunca é violada.
--
-- Onde colar: Supabase → SQL Editor → cole TUDO → Run. Idempotente. Não apaga
-- dados nem mexe nos administradores.
-- Pré-requisito: database/modulo_usuarios.sql já aplicado.
-- =============================================================================

-- Evita erro "unsafe use of new value" ao criar função que referencia o novo
-- valor de enum na mesma execução (a validação do corpo é adiada).
set check_function_bodies = off;

-- 1) Novo valor de status + colunas de auditoria da exclusão ------------------
alter type status_usuario add value if not exists 'excluido';

alter table usuarios add column if not exists deleted_at      timestamptz;
alter table usuarios add column if not exists deleted_by      uuid references usuarios(id);
alter table usuarios add column if not exists motivo_exclusao text;

create index if not exists idx_usuarios_deleted_at on usuarios(deleted_at);

-- 2) RPC de exclusão → passa a ser SOFT DELETE (substitui a versão física) ----
--    Mantém as travas: só admin; nunca a si mesmo. Registra em usuarios_logs.
drop function if exists fn_excluir_usuario(uuid);
create or replace function fn_excluir_usuario(p_alvo uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_adm usuarios; v_alvo usuarios;
begin
  select * into v_adm from usuarios where auth_id = auth.uid() or lower(email) = auth_email() limit 1;
  if coalesce(v_adm.role::text,'') <> 'admin' then raise exception 'Apenas administradores.'; end if;
  if p_alvo = v_adm.id then raise exception 'Você não pode excluir a si mesmo.'; end if;
  select * into v_alvo from usuarios where id = p_alvo;
  if v_alvo.id is null then raise exception 'Usuário não encontrado.'; end if;

  update usuarios
     set status = 'excluido', ativo = false,
         deleted_at = now(), deleted_by = v_adm.id,
         motivo_exclusao = p_motivo, updated_at = now()
   where id = p_alvo;

  insert into usuarios_logs(executor_id,executor_nome,afetado_id,afetado_nome,acao,detalhe,antes,depois)
  values(v_adm.id, v_adm.nome, v_alvo.id, v_alvo.nome, 'exclusao',
         coalesce(p_motivo, 'Exclusão lógica (soft delete)'),
         jsonb_build_object('status', v_alvo.status, 'ativo', v_alvo.ativo),
         '{"status":"excluido","ativo":false}'::jsonb);
end $$;

grant execute on function fn_excluir_usuario(uuid, text) to authenticated;

-- (Opcional) Restaurar um usuário excluído por engano ------------------------
create or replace function fn_restaurar_usuario(p_alvo uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_adm usuarios; v_alvo usuarios;
begin
  select * into v_adm from usuarios where auth_id = auth.uid() or lower(email) = auth_email() limit 1;
  if coalesce(v_adm.role::text,'') <> 'admin' then raise exception 'Apenas administradores.'; end if;
  select * into v_alvo from usuarios where id = p_alvo;
  if v_alvo.id is null then raise exception 'Usuário não encontrado.'; end if;

  update usuarios
     set status = 'aprovado', ativo = true,
         deleted_at = null, deleted_by = null, motivo_exclusao = null, updated_at = now()
   where id = p_alvo;

  insert into usuarios_logs(executor_id,executor_nome,afetado_id,afetado_nome,acao,detalhe)
  values(v_adm.id, v_adm.nome, v_alvo.id, v_alvo.nome, 'alteracao_dados', 'Usuário restaurado');
end $$;
grant execute on function fn_restaurar_usuario(uuid) to authenticated;

-- ===========================================================================
-- OPCIONAL — SOMENTE se um dia precisar EXCLUIR FISICAMENTE de verdade.
-- Não aplicado por padrão. Descomente e rode manualmente com muito cuidado.
-- ---------------------------------------------------------------------------
-- create or replace function fn_excluir_usuario_fisico(p_alvo uuid)
-- returns void language plpgsql security definer set search_path = public as $$
-- declare v_adm usuarios;
-- begin
--   select * into v_adm from usuarios where auth_id=auth.uid() or lower(email)=auth_email() limit 1;
--   if coalesce(v_adm.role::text,'')<>'admin' then raise exception 'Apenas administradores.'; end if;
--   if p_alvo = v_adm.id then raise exception 'Você não pode excluir a si mesmo.'; end if;
--   -- 1) desvincula/apaga dependências primeiro (evita violação de FK)
--   delete from notificacoes  where destinatario = p_alvo;
--   delete from usuarios_logs  where afetado_id  = p_alvo or executor_id = p_alvo;
--   -- 2) só então remove o usuário
--   delete from usuarios where id = p_alvo;
--   -- 3) A conta no Supabase Auth NÃO é removida por aqui. Faça manualmente em
--   --    Authentication → Users, ou via Admin API (service_role) numa Edge Function.
-- end $$;
-- grant execute on function fn_excluir_usuario_fisico(uuid) to authenticated;

-- Diagnóstico:
-- SELECT nome,email,status,ativo,deleted_at,deleted_by,motivo_exclusao
--   FROM usuarios WHERE status='excluido' ORDER BY deleted_at DESC;
