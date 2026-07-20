-- =============================================================================
-- RNA One — Característica de REFERÊNCIA mensurável + Quadrante nas Medições
--
-- Contexto: uma característica cadastrada na Biblioteca Técnica com tipo de
-- especificação "Referência" continua sendo MEDIDA e REGISTRADA na auditoria.
-- "Referência" significa apenas que a medição não possui limites de aprovação ou
-- reprovação — não que ela deixa de ser medida.
--
-- O QUE MUDA NO BANCO (mínimo e aditivo — nada é removido ou alterado):
--   • bib_metricas.obrigatorio        → marca a característica cujo registro é
--                                       obrigatório para finalizar a auditoria.
--   • insp_caracteristicas.obrigatorio→ snapshot dessa marcação no momento da
--                                       auditoria (o histórico fica imutável,
--                                       igual às demais colunas do snapshot).
--
-- NÃO é preciso criar colunas para o valor medido nem para o quadrante:
--   • as medições de referência usam a MESMA tabela insp_medicoes (uma linha por
--     amostra, com valor, resultado e medido_iso) — a única diferença é o
--     resultado 'registrado' (neutro), ao lado de aprovado/reprovado/pendente.
--     insp_medicoes.resultado é `text` sem CHECK, então nada precisa ser alterado.
--   • insp_caracteristicas.quadrante JÁ EXISTE (auditorias_dimensional.sql) e já
--     é preenchido a partir de bib_metricas.quadrante ao vincular a peça. A
--     Melhoria 02 apenas passa a EXIBIR essa coluna na tela e no relatório.
--
-- COMPATIBILIDADE: a coluna é opcional e nasce `false`. Bases que ainda não
-- rodaram esta migration continuam funcionando — services/inspecao.js lê
-- `obrigatorio` de forma tolerante (ausente = não obrigatória) e grava o snapshot
-- em modo best-effort, como já faz com tipo_especificacao/informativo.
--
-- Idempotente. Requisitos: auditorias_dimensional.sql e biblioteca_tecnica.sql.
-- =============================================================================

-- ------------------------------------------- 1) Biblioteca Técnica (cadastro) --
-- Marca a característica cujo valor medido é obrigatório para finalizar.
-- Obrigatório ≠ reprova: serve a registro e rastreabilidade.
alter table bib_metricas
  add column if not exists obrigatorio boolean not null default false;

comment on column bib_metricas.obrigatorio is
  'Exige o registro do valor medido antes de finalizar a auditoria. Não reprova a característica — vale para rastreabilidade. Usado principalmente em características de REFERENCIA.';

-- --------------------------------------- 2) Snapshot na auditoria (imutável) --
alter table insp_caracteristicas
  add column if not exists obrigatorio boolean not null default false;

comment on column insp_caracteristicas.obrigatorio is
  'Cópia de bib_metricas.obrigatorio no momento da auditoria. Congelada com o restante do snapshot da especificação.';

-- -------------------------------------------------------- 3) Documentação ----
comment on column insp_medicoes.resultado is
  'aprovado | reprovado | pendente | registrado. "registrado" = medição de característica de REFERENCIA: valor gravado sem comparação com tolerância. Nunca reprova e não entra no cálculo de conformidade.';

comment on column insp_caracteristicas.quadrante is
  'Localização da característica no desenho técnico (ex.: A4), copiada de bib_metricas.quadrante. Somente leitura para o auditor.';

-- =============================================================================
-- VERIFICAÇÃO
-- =============================================================================
-- 1) colunas criadas:
--    select table_name, column_name, data_type, column_default
--      from information_schema.columns
--     where column_name = 'obrigatorio'
--       and table_name in ('bib_metricas','insp_caracteristicas');
--
-- 2) marcar uma referência como obrigatória (exemplo):
--    update bib_metricas set obrigatorio = true
--     where tipo_especificacao = 'REFERENCIA' and cota = '9';
--
-- 3) fluxo real: Minhas Auditorias → nova inspeção → etapa Medições
--    -> a linha de Referência mostra o valor cadastrado (azul) E um campo
--       editável por peça; ao preencher, o status fica "Registrado — Referência";
--       a conformidade e o resultado geral NÃO se alteram.
-- =============================================================================
