-- =============================================================================
-- RNA One — FIX: Integração "Minhas Auditorias" ↔ "Biblioteca Técnica"
-- Rassini NHK Automotive
-- -----------------------------------------------------------------------------
-- CAUSA RAIZ
--   A aplicação grava colunas que NÃO EXISTEM no banco de produção. As migrations
--   biblioteca_reestruturacao.sql (e as colunas adicionadas depois em
--   auditorias_dimensional.sql / gestao_operacional.sql) nunca foram executadas.
--   Ao selecionar a peça, INSP.carregarEspecs() insere em insp_caracteristicas
--   as colunas `tipo_especificacao` e `informativo` → o PostgREST devolve
--   PGRST204 ("Could not find the 'informativo' column ... in the schema cache")
--   → o autosave capturava QUALQUER erro e exibia "Não foi possível salvar.
--   Verifique sua conexão." (mensagem genérica, sem relação com a causa real).
--
--   Diagnóstico confirmado na API do projeto (2026-07-16):
--     bib_pecas.revisao_cadastro ................. 42703 does not exist
--     bib_metricas.tipo_especificacao ............ 42703 does not exist
--     bib_metricas.quadrante/superior/inferior/tol_simetrica ... does not exist
--     insp_caracteristicas.tipo_especificacao .... 42703 does not exist  ← BLOQUEIA A SELEÇÃO DA PEÇA
--     insp_caracteristicas.informativo ........... 42703 does not exist  ← BLOQUEIA A SELEÇÃO DA PEÇA
--     insp_relatorios.rastreio/pendencia_id/pendencia_numero ... does not exist
--     op_pendencias.numero/relatorio_id/relatorio_numero/origem/dados ... does not exist
--
-- O QUE ESTE ARQUIVO FAZ
--   • Só ADICIONA colunas e índices (add column if not exists). Não remove nada,
--     não apaga dados, não recria tabelas, não duplica registros.
--   • Cria o vínculo formal (FK) insp_relatorios.peca_id → bib_pecas(id).
--   • Recarrega o cache de schema do PostgREST no final.
--   É IDEMPOTENTE: pode rodar quantas vezes quiser.
--
-- ONDE RODAR: Supabase → SQL Editor → cole TUDO → Run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) insp_caracteristicas — CAUSA RAIZ da falha ao selecionar a peça
--    Snapshot da especificação: congela o tipo e se a característica é
--    informativa (REFERENCIA), para o motor tratar OK/NOK e excluir as
--    informativas do cálculo de aprovação/reprovação.
-- ---------------------------------------------------------------------------
alter table insp_caracteristicas add column if not exists tipo_especificacao text default 'TOLERANCIA';
alter table insp_caracteristicas add column if not exists informativo        boolean default false;

-- Backfill das auditorias já existentes (não deixa característica antiga nula).
update insp_caracteristicas
   set tipo_especificacao = coalesce(tipo_especificacao, case when tipo_campo = 'atributo' then 'ATRIBUTO' else 'TOLERANCIA' end),
       informativo        = coalesce(informativo, tipo_campo = 'informativo')
 where tipo_especificacao is null or informativo is null;

-- ---------------------------------------------------------------------------
-- 2) bib_metricas — cadastro inteligente de especificações (Biblioteca Técnica)
-- ---------------------------------------------------------------------------
alter table bib_metricas add column if not exists quadrante          text;
alter table bib_metricas add column if not exists tipo_especificacao text not null default 'TOLERANCIA';
alter table bib_metricas add column if not exists superior           numeric;   -- desvio superior (ex.: +2)
alter table bib_metricas add column if not exists inferior           numeric;   -- desvio inferior (ex.: -1)
alter table bib_metricas add column if not exists tol_simetrica      numeric;   -- valor do ± (ex.: 1)

do $$ begin
  alter table bib_metricas drop constraint if exists bib_metricas_tipo_chk;
  alter table bib_metricas add constraint bib_metricas_tipo_chk
    check (tipo_especificacao in ('MAX_MIN','ATRIBUTO','UNID_MAX','UNID_MIN','REFERENCIA','TOLERANCIA'));
exception when others then null; end $$;

-- Backfill preservando o comportamento atual das specs já cadastradas.
update bib_metricas set
  tipo_especificacao = case
    when nominal is not null and (tol_min is not null or tol_max is not null) then 'TOLERANCIA'
    else 'MAX_MIN' end
  where tipo_especificacao is null or tipo_especificacao = 'TOLERANCIA';

update bib_metricas set
  superior = coalesce(superior, tol_max - nominal),
  inferior = coalesce(inferior, tol_min - nominal)
  where tipo_especificacao = 'TOLERANCIA' and nominal is not null
    and (superior is null or inferior is null);

-- ---------------------------------------------------------------------------
-- 3) bib_pecas — Revisão do Cadastro (≠ Revisão do Desenho)
-- ---------------------------------------------------------------------------
alter table bib_pecas add column if not exists revisao_cadastro int;
update bib_pecas set revisao_cadastro = coalesce(revisao_cadastro, revisao, 1) where revisao_cadastro is null;
alter table bib_pecas alter column revisao_cadastro set default 1;

-- ---------------------------------------------------------------------------
-- 4) insp_relatorios — rastreabilidade da finalização + vínculo com a pendência
-- ---------------------------------------------------------------------------
alter table insp_relatorios add column if not exists rastreio          jsonb;
alter table insp_relatorios add column if not exists pendencia_id      text;
alter table insp_relatorios add column if not exists pendencia_numero  text;

-- ---------------------------------------------------------------------------
-- 5) op_pendencias — pendência automática gerada pela reprovação dimensional
-- ---------------------------------------------------------------------------
alter table op_pendencias add column if not exists numero           text;
alter table op_pendencias add column if not exists relatorio_id     text;
alter table op_pendencias add column if not exists relatorio_numero text;
alter table op_pendencias add column if not exists origem           text;
alter table op_pendencias add column if not exists dados            jsonb;
create index if not exists op_pend_rel_idx on op_pendencias (relatorio_id);

-- ---------------------------------------------------------------------------
-- 6) VÍNCULO OFICIAL auditoria → peça da Biblioteca Técnica
--    O relacionamento é pelo ID da peça (insp_relatorios.peca_id → bib_pecas.id),
--    NUNCA pelo Part Number (bib_pecas.codigo), que pode mudar/duplicar.
--    peca_codigo/peca_nome/cliente/revisao_desenho seguem no relatório apenas
--    como CÓPIA HISTÓRICA (snapshot do momento da auditoria).
--
--    A FK entra como NOT VALID: passa a valer para toda gravação NOVA sem
--    reprovar linhas legadas (ex.: relatórios criados no modo demo, com ids
--    que não existem em bib_pecas). O validate abaixo é tentado em seguida;
--    se houver órfãos, a constraint continua ativa para os dados novos.
-- ---------------------------------------------------------------------------
do $$
declare orfaos int;
begin
  alter table insp_relatorios drop constraint if exists insp_relatorios_peca_id_fkey;
  alter table insp_relatorios add constraint insp_relatorios_peca_id_fkey
    foreign key (peca_id) references bib_pecas(id)
    on update cascade on delete restrict not valid;

  select count(*) into orfaos
    from insp_relatorios r
   where r.peca_id is not null
     and not exists (select 1 from bib_pecas p where p.id = r.peca_id);

  if orfaos = 0 then
    alter table insp_relatorios validate constraint insp_relatorios_peca_id_fkey;
    raise notice 'FK insp_relatorios.peca_id -> bib_pecas.id criada e VALIDADA.';
  else
    raise warning 'FK criada como NOT VALID: % relatorio(s) apontam para peca inexistente. Vale para gravacoes novas; para validar depois, corrija os orfaos e rode: alter table insp_relatorios validate constraint insp_relatorios_peca_id_fkey;', orfaos;
  end if;
exception when others then
  raise warning 'Nao foi possivel criar a FK insp_relatorios.peca_id: %', sqlerrm;
end $$;

create index if not exists insp_rel_peca_idx on insp_relatorios (peca_id);

-- ---------------------------------------------------------------------------
-- 7) Recarrega o cache de schema do PostgREST (senão as colunas novas seguem
--    invisíveis para a API por alguns minutos e o erro PGRST204 continua).
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- =============================================================================
-- DIAGNÓSTICO — rode para confirmar que ficou tudo certo (esperado: 13 linhas)
-- =============================================================================
-- select table_name, column_name from information_schema.columns
--  where (table_name = 'insp_caracteristicas' and column_name in ('tipo_especificacao','informativo'))
--     or (table_name = 'bib_metricas'         and column_name in ('tipo_especificacao','superior','inferior','tol_simetrica','quadrante'))
--     or (table_name = 'bib_pecas'            and column_name = 'revisao_cadastro')
--     or (table_name = 'insp_relatorios'      and column_name in ('rastreio','pendencia_id','pendencia_numero'))
--  order by table_name, column_name;
-- =============================================================================
