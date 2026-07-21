-- =============================================================================
-- RNA One — Lote 1 de melhorias estruturais (M01, M02, M03, M05, M07)
--
-- Das cinco melhorias do lote, apenas a M02 exige alteração de schema. As demais
-- são de apresentação/consulta e não tocam o banco:
--   M01 (renomear menu) ....... só nomenclatura na UI; rotas, ids de módulo e
--                               RBAC permanecem idênticos (op_auditorias).
--   M03 (auditores atribuídos)  derivado de op_atribuicoes em tempo de leitura;
--                               nenhuma coluna nova, nenhum cache a invalidar.
--   M05 (clientes oficiais) ... migração PRÓPRIA em fix_clientes_oficiais.sql
--                               (rode-a também).
--   M07 (padrão 00,00) ........ formatação de exibição; os valores continuam
--                               numéricos no banco, sem conversão para texto.
--
-- Idempotente. Requisito: schema.sql / gestao_operacional.sql já aplicados.
-- =============================================================================

-- ------------------------------------- M02) tempo do plantão sem cronômetro ---
-- O cronômetro saiu da tela do auditor, MAS o registro de tempo continua — e
-- agora é mais completo. Antes só gravávamos inicio_iso e fim_iso; a duração
-- total passa a ser persistida no fechamento, servindo de insumo para
-- produtividade e tempo médio na Administração.
alter table plantoes
  add column if not exists duracao_seg integer;

comment on column plantoes.duracao_seg is
  'Duração total do plantão em segundos, calculada no fechamento (fim_iso - inicio_iso). Visível apenas na Administração — auditor e supervisor não veem métricas de tempo.';

-- Backfill dos plantões já encerrados que têm início e fim registrados.
update plantoes
   set duracao_seg = greatest(0, extract(epoch from (fim_iso::timestamptz - inicio_iso::timestamptz))::int)
 where duracao_seg is null
   and fim_iso is not null
   and inicio_iso is not null;

-- Índice para os relatórios de produtividade da Administração.
create index if not exists plantoes_duracao_idx on plantoes (duracao_seg)
  where duracao_seg is not null;

-- -----------------------------------------------------------------------------
-- NOTA DE SEGURANÇA (M02): a restrição de VISIBILIDADE das métricas de tempo é
-- de apresentação (config.podeVerMetricasTempo → só 'admin'). As policies RLS de
-- `plantoes` NÃO foram alteradas: o auditor continua precisando ler o próprio
-- plantão para operar (é assim que a tela sabe que há plantão ativo). Nenhuma
-- permissão foi ampliada nem removida por este lote.
-- =============================================================================

-- =============================================================================
-- VERIFICAÇÃO
-- =============================================================================
-- 1) coluna criada e backfill aplicado:
--    select count(*) filter (where duracao_seg is not null) as com_duracao,
--           count(*) filter (where duracao_seg is null)     as sem_duracao
--      from plantoes;
--
-- 2) plantões encerrados sem duração (esperado: 0, salvo registros sem inicio_iso):
--    select id, data, turno from plantoes
--     where status = 'Encerrado' and duracao_seg is null;
--
-- 3) fluxo real: iniciar e finalizar um plantão
--    -> a tela do auditor NÃO mostra cronômetro;
--    -> select duracao_seg from plantoes order by inicio_iso desc limit 1; devolve o tempo.
-- =============================================================================
