-- =============================================================================
-- RNA One — INSPEÇÃO DIMENSIONAL COLABORATIVA (§M04)
--
-- Antes: o relatório pertencia ao auditor que o criou; só ele media, do começo
-- ao fim. Uma peça com 5 amostras era trabalho de uma pessoa só.
--
-- Agora: o relatório EM ANDAMENTO é compartilhado e a AMOSTRA é a unidade de
-- trabalho. João mede P1, Maria P2, Carlos P3 — no mesmo relatório. Cada amostra
-- registra auditor responsável, início, fim, tempo gasto, observação e resultado.
--
-- BLOQUEIO: ao assumir uma amostra, ela trava para os demais (veem, não editam);
-- as outras seguem livres. A trava EXPIRA sozinha após LOCK_TTL_SEG (180 s) sem
-- sinal de vida — sem isso, fechar o navegador deixaria a peça presa para sempre.
--
-- Idempotente. Requisito: auditorias_dimensional.sql.
-- =============================================================================

-- --------------------------------------------------- 1) amostras do relatório
create table if not exists insp_amostras (
  id text primary key default gen_random_uuid()::text,
  relatorio_id text not null references insp_relatorios(id) on delete cascade,
  amostra int not null,

  -- ciclo de vida da amostra
  status text not null default 'pendente',          -- pendente | em_andamento | concluida
  resultado text not null default 'pendente',       -- aprovado | reprovado | registrado | pendente

  -- rastreabilidade exigida pelo requisito (§M04 "Registro obrigatório")
  auditor_id text, auditor_nome text,               -- quem assumiu primeiro
  concluido_por text, concluido_por_nome text,      -- quem concluiu (pode ser outro)
  inicio_iso timestamptz, fim_iso timestamptz,
  duracao_seg integer,                              -- tempo ACUMULADO (soma das sessões)
  observacao text default '',

  -- trava colaborativa com expiração
  bloqueado_por text, bloqueado_nome text,
  bloqueado_iso timestamptz,                        -- quando assumiu
  batida_iso timestamptz,                           -- último sinal de vida (heartbeat)

  unique (relatorio_id, amostra)                    -- uma linha por peça do relatório
);
create index if not exists insp_amostras_rel_idx  on insp_amostras (relatorio_id);
create index if not exists insp_amostras_lock_idx on insp_amostras (bloqueado_por) where bloqueado_por is not null;

comment on table  insp_amostras is 'Uma linha por peça/amostra do relatório dimensional. Base do trabalho colaborativo (§M04): posse, tempo, observação e resultado por amostra.';
comment on column insp_amostras.batida_iso is 'Último sinal de vida do navegador que detém a trava. Passados 180 s sem sinal, a trava é considerada abandonada e outro auditor pode assumir.';
comment on column insp_amostras.duracao_seg is 'Tempo acumulado de medição desta amostra, somando todas as sessões de edição (inclusive de auditores diferentes).';

-- ------------------------------------------- 2) autoria por medição ----------
-- Com vários auditores no mesmo relatório, "quem mediu o quê" vira rastreabilidade.
alter table insp_medicoes add column if not exists medido_por      text;
alter table insp_medicoes add column if not exists medido_por_nome text;
comment on column insp_medicoes.medido_por is 'Auditor que registrou este valor (§M04). Com medido_iso, forma a autoria completa: quem, quando.';

-- Histórico: as alterações de medição vão para insp_historico (trilha já
-- existente do relatório). Estas colunas permitem filtrar por peça/característica.
alter table insp_historico add column if not exists amostra           int;
alter table insp_historico add column if not exists caracteristica_id text;

-- ------------------------------------------------------------ 3) RLS ---------
-- MUDANÇA DE POLÍTICA (o ponto sensível desta melhoria):
-- as policies antigas restringiam a escrita ao auditor DONO do relatório
-- (`auditor_id = eu`). Isso torna a colaboração impossível — por isso são
-- substituídas por: "auditor autenticado pode escrever em relatório EM ANDAMENTO".
--
-- O que NÃO mudou (a segurança permanece):
--   • relatório FINALIZADO continua bloqueado para o auditor comum — só
--     admin/supervisor alteram (§21);
--   • segue exigindo usuário autenticado com perfil válido;
--   • RLS continua habilitado em todas as tabelas;
--   • a exclusão mútua por amostra é garantida pela trava da aplicação, não por
--     RLS — RLS controla QUEM pode escrever, não QUAL amostra.
alter table insp_amostras enable row level security;

do $$
begin
  -- Amostras: leitura para autenticados; escrita enquanto o relatório estiver aberto.
  drop policy if exists "insp_amostras_read" on insp_amostras;
  create policy "insp_amostras_read" on insp_amostras
    for select to authenticated using (true);

  drop policy if exists "insp_amostras_write" on insp_amostras;
  create policy "insp_amostras_write" on insp_amostras
    for all to authenticated
    using (
      relatorio_id in (select id from insp_relatorios where status not like 'finalizada%' and status <> 'revisada')
      or current_perfil() in ('admin','supervisor')
    )
    with check (
      relatorio_id in (select id from insp_relatorios where status not like 'finalizada%' and status <> 'revisada')
      or current_perfil() in ('admin','supervisor')
    );

  -- Medições: qualquer auditor autenticado mede em relatório aberto (colaboração).
  drop policy if exists "insp_med_write" on insp_medicoes;
  create policy "insp_med_write" on insp_medicoes
    for all to authenticated
    using (
      relatorio_id in (select id from insp_relatorios where status not like 'finalizada%' and status <> 'revisada')
      or current_perfil() in ('admin','supervisor')
    )
    with check (
      relatorio_id in (select id from insp_relatorios where status not like 'finalizada%' and status <> 'revisada')
      or current_perfil() in ('admin','supervisor')
    );

  -- Características: idem (o snapshot é reescrito ao trocar a peça).
  drop policy if exists "insp_car_write" on insp_caracteristicas;
  create policy "insp_car_write" on insp_caracteristicas
    for all to authenticated
    using (
      relatorio_id in (select id from insp_relatorios where status not like 'finalizada%' and status <> 'revisada')
      or current_perfil() in ('admin','supervisor')
    )
    with check (
      relatorio_id in (select id from insp_relatorios where status not like 'finalizada%' and status <> 'revisada')
      or current_perfil() in ('admin','supervisor')
    );

  -- Relatório: o colaborador precisa atualizar resultado/status ao medir. O
  -- FINALIZADO segue fora do alcance do auditor comum (regra preservada).
  drop policy if exists "insp_rel_own_write" on insp_relatorios;
  create policy "insp_rel_own_write" on insp_relatorios
    for all to authenticated
    using (
      status not in ('finalizada_aprovada','finalizada_reprovada','revisada','arquivada')
      or current_perfil() in ('admin','supervisor')
    )
    with check (
      status not in ('revisada','arquivada')
      or current_perfil() in ('admin','supervisor')
    );

  -- Histórico: append-only para autenticados (a trilha das medições vive aqui).
  drop policy if exists "insp_hist_write" on insp_historico;
  create policy "insp_hist_write" on insp_historico
    for insert to authenticated with check (true);
end $$;

-- ------------------------------------------- 4) backfill dos relatórios ------
-- Relatórios abertos que já têm quantidade definida ganham as suas amostras,
-- para não abrirem com a tabela colaborativa vazia.
insert into insp_amostras (relatorio_id, amostra, status, auditor_id, auditor_nome)
select r.id, g.n, 'pendente', r.auditor_id, r.auditor_nome
  from insp_relatorios r
  cross join lateral generate_series(1, coalesce(r.quantidade, 0)) as g(n)
 where coalesce(r.quantidade, 0) > 0
on conflict (relatorio_id, amostra) do nothing;

-- Amostras de relatórios JÁ FINALIZADOS entram como concluídas — não faria
-- sentido um relatório fechado exibir peças "pendentes".
update insp_amostras a
   set status = 'concluida'
  from insp_relatorios r
 where a.relatorio_id = r.id
   and a.status <> 'concluida'
   and (r.status like 'finalizada%' or r.status = 'revisada');

-- =============================================================================
-- NOTA SOBRE CONCORRÊNCIA
-- =============================================================================
-- A tomada de posse na aplicação é OTIMISTA (grava e relê para confirmar), pois
-- db.js não oferece UPDATE condicional. Para exclusão mútua forte no servidor,
-- criar a RPC abaixo e chamá-la em assumirAmostra:
--
--   create or replace function assumir_amostra(p_rel text, p_amostra int, p_user text, p_nome text)
--   returns insp_amostras language sql security invoker as $f$
--     update insp_amostras set bloqueado_por = p_user, bloqueado_nome = p_nome,
--            bloqueado_iso = now(), batida_iso = now(), status = 'em_andamento',
--            auditor_id = coalesce(auditor_id, p_user),
--            auditor_nome = coalesce(nullif(auditor_nome,''), p_nome),
--            inicio_iso = coalesce(inicio_iso, now())
--      where relatorio_id = p_rel and amostra = p_amostra and status <> 'concluida'
--        and (bloqueado_por is null or bloqueado_por = p_user
--             or batida_iso < now() - interval '180 seconds')
--     returning *;
--   $f$;
--
-- O UPDATE ... WHERE torna a checagem e a escrita atômicas: dois auditores
-- clicando no mesmo instante, só um recebe linha de volta.
-- =============================================================================

-- =============================================================================
-- VERIFICAÇÃO
-- =============================================================================
-- 1) tabela e backfill:
--    select relatorio_id, count(*) from insp_amostras group by 1 limit 5;
--
-- 2) policies atualizadas:
--    select policyname, cmd from pg_policies
--     where tablename in ('insp_amostras','insp_medicoes','insp_relatorios');
--
-- 3) relatório finalizado continua protegido para auditor comum (esperado: 0):
--    -- autenticado como auditor não-admin:
--    update insp_relatorios set lote = 'X' where status = 'finalizada_aprovada';
--
-- 4) fluxo real: dois navegadores, dois auditores, mesmo relatório em andamento
--    -> A assume a Peça 1; B vê "em edição por A" e não consegue digitar nela;
--    -> B assume a Peça 2 e mede normalmente;
--    -> a finalização só libera com todas as peças concluídas e nenhuma travada.
-- =============================================================================
