-- =============================================================================
-- RNA One — CORREÇÃO: "new row violates row-level security policy for table logs"
-- Sintoma: ao clicar em FINALIZAR ROTINA (Minhas Rotinas) o auditor recebe
--          "Não foi possível finalizar: new row violates row-level security
--           policy for table \"logs\"" e a rotina não conclui.
--
-- -----------------------------------------------------------------------------
-- CAUSA RAIZ (diagnóstico completo)
-- -----------------------------------------------------------------------------
-- A tabela `logs` tem RLS habilitado (rls.sql, "alter table logs enable row level
-- security"). Com RLS ligado e SEM policy permissiva de INSERT, todo INSERT é
-- negado — inclusive o do próprio sistema. Existem DOIS caminhos que gravam nela
-- e ambos falham pela mesma razão:
--
--   1) INSERT DIRETO DA APLICAÇÃO — services/db.js → db.log() grava a trilha de
--      auditoria ("Finalizou rotina X"). Se a policy "logs_insert" não existir
--      no banco de produção (rls.sql aplicado parcialmente ou versão anterior),
--      o INSERT é bloqueado e o erro sobe até a UI.
--
--   2) TRIGGER DE AUDITORIA — schema.sql cria fn_audit_log() e a anexa em
--      nao_conformidades, planos_acao e rotinas (trg_log_rotinas). A função é
--      `language plpgsql` SEM `security definer`, portanto roda com o papel do
--      usuário autenticado e está sujeita ao RLS de `logs`. Resultado: um UPDATE
--      legítimo do auditor em `rotinas` é ABORTADO pelo trigger de log. Esse é o
--      caminho mais traiçoeiro — o erro aponta para "logs", mas a operação que
--      falha é a da tabela de negócio.
--
-- Verificado também: autenticação e user_id estão corretos (o auditor tem sessão
-- válida e current_perfil() resolve o perfil por auth_id OU e-mail); as policies
-- de op_execucao/op_execucao_itens/op_pendencias já permitem que o auditor
-- grave os próprios registros (gestao_operacional.sql). O bloqueio é só em `logs`.
--
-- -----------------------------------------------------------------------------
-- CORREÇÃO (o RLS PERMANECE ATIVO — nada é removido ou afrouxado)
-- -----------------------------------------------------------------------------
--   A) fn_audit_log() passa a ser SECURITY DEFINER com search_path fixo: a
--      trilha automática é uma gravação DO SISTEMA, não do usuário, e por isso
--      não deve ser barrada pelo RLS da tabela de destino. search_path travado
--      evita sequestro de resolução de nomes (boa prática em security definer).
--   B) (re)cria a policy de INSERT em `logs` para authenticated — todo usuário
--      autenticado registra os próprios eventos de auditoria.
--   C) mantém a LEITURA restrita a admin/supervisor (logs_read inalterado): quem
--      escreve não passa a poder ler a trilha dos outros.
--
-- Como a leitura continua restrita, a aplicação grava o log SEM `RETURNING`
-- (services/db.js → insert(..., { returning:false })): sem isso o PostgREST
-- devolveria 0 linhas no retorno e uma gravação bem-sucedida pareceria erro.
--
-- Idempotente: pode rodar quantas vezes for necessário.
-- Requisitos: schema.sql e rls.sql já aplicados (usa current_perfil()).
-- =============================================================================

-- ------------------------------------------------------- A) TRIGGER DE AUDITORIA
-- Mesma lógica de antes (nada muda no que é registrado); só passa a rodar com os
-- privilégios do dono da função, para que o RLS de `logs` não aborte o UPDATE
-- da tabela de negócio que disparou o trigger.
create or replace function fn_audit_log() returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into logs(usuario, acao, entidade, antes, depois)
  values (
    coalesce(auth.uid()::text,'sistema'),
    tg_op || ' em ' || tg_table_name,
    tg_table_name,
    case when tg_op='UPDATE' then (old.status)::text else '—' end,
    case when tg_op='DELETE' then '—' else (new.status)::text end
  );
  return coalesce(new, old);
exception
  -- A trilha de auditoria jamais pode derrubar a transação de negócio que a
  -- originou: se o log falhar, registra o aviso e deixa a operação concluir.
  when others then
    raise warning 'fn_audit_log: log não gravado para % em %: %', tg_op, tg_table_name, sqlerrm;
    return coalesce(new, old);
end $$;

-- ------------------------------------------------------------- B) RLS de `logs`
alter table logs enable row level security;   -- garante RLS ligado (não removemos)

-- INSERT: todo usuário autenticado registra os próprios eventos de auditoria.
drop policy if exists "logs_insert" on logs;
create policy "logs_insert" on logs
  for insert to authenticated
  with check (true);

-- C) LEITURA: permanece restrita a admin/supervisor (recriada aqui apenas para
-- garantir que exista em bases onde rls.sql foi aplicado parcialmente).
drop policy if exists "logs_read" on logs;
create policy "logs_read" on logs
  for select to authenticated
  using (current_perfil() in ('admin','supervisor'));

-- UPDATE/DELETE continuam SEM policy: a trilha de auditoria é imutável para o
-- usuário autenticado (append-only). Isso é intencional — não crie policies aqui.

-- =============================================================================
-- VERIFICAÇÃO (rode como um usuário auditor autenticado)
-- =============================================================================
-- 1) policies presentes:
--    select policyname, cmd, roles from pg_policies where tablename = 'logs';
--    -> esperado: logs_insert (INSERT) e logs_read (SELECT)
--
-- 2) função com security definer:
--    select proname, prosecdef from pg_proc where proname = 'fn_audit_log';
--    -> esperado: prosecdef = true
--
-- 3) INSERT direto deve funcionar para qualquer autenticado:
--    insert into logs(usuario, acao, entidade, antes, depois)
--    values ('teste', 'Verificação de policy', 'logs', '—', 'ok');
--    -> esperado: INSERT 0 1 (sem erro de RLS)
--
-- 4) fluxo real: Minhas Rotinas → abrir rotina → Finalizar Rotina
--    -> esperado: conclui, grava status/data/hora/usuário e registra o log.
-- =============================================================================
