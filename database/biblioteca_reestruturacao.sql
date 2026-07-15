-- =============================================================================
-- RNA One — Biblioteca Técnica · REESTRUTURAÇÃO + Cadastro Inteligente de Especs
-- Rassini NHK Automotive
-- -----------------------------------------------------------------------------
-- 100% INCREMENTAL e IDEMPOTENTE. Só ADICIONA colunas/catálogos e faz BACKFILL.
-- NÃO remove colunas nem apaga dados (retrocompatibilidade total — os módulos
-- antigos continuam usando bib_metricas.tol_min/tol_max normalmente).
--
-- Resumo das mudanças:
--   • bib_pecas.revisao_cadastro  → separa "Revisão do Cadastro" (RNA One) da
--     "Revisão do Desenho" (Engenharia, já existente em revisao_desenho).
--   • bib_metricas: quadrante (por especificação), tipo_especificacao (6 tipos)
--     e os campos do cálculo inteligente (superior, inferior, tol_simetrica).
--   • insp_caracteristicas: tipo_especificacao + informativo (para a Auditoria
--     tratar ATRIBUTO OK/NOK e ignorar REFERENCIA nos cálculos).
--   • Catálogos fixos: Planta (2 opções) e Quem Mede (6 opções).
--
-- Onde colar: Supabase → SQL Editor → cole TUDO → Run.
-- Pré-requisito: database/biblioteca_tecnica.sql e auditorias_dimensional.sql.
-- =============================================================================

-- ------------------------------------------------- 1) bib_pecas -------------
-- Revisão do Cadastro (independente da Revisão do Desenho). Backfill = revisao.
alter table bib_pecas add column if not exists revisao_cadastro int;
update bib_pecas set revisao_cadastro = coalesce(revisao_cadastro, revisao, 1)
  where revisao_cadastro is null;
alter table bib_pecas alter column revisao_cadastro set default 1;

-- OBS.: material, acabamento, cor, peso, norma, especificacao, observacoes,
-- quadrante permanecem NA TABELA (preserva dados antigos) mas deixam de ser
-- usados/exibidos pela aplicação. Não são removidos para não perder histórico.

-- --------------------------------------- 2) bib_metricas (especificações) ---
alter table bib_metricas add column if not exists quadrante          text;
alter table bib_metricas add column if not exists tipo_especificacao text not null default 'TOLERANCIA';
alter table bib_metricas add column if not exists superior           numeric;   -- desvio superior (ex.: +2)
alter table bib_metricas add column if not exists inferior           numeric;   -- desvio inferior (ex.: -1)
alter table bib_metricas add column if not exists tol_simetrica      numeric;   -- valor do ± (ex.: 1)

-- Restringe tipo_especificacao aos 6 valores válidos (idempotente).
do $$ begin
  alter table bib_metricas drop constraint if exists bib_metricas_tipo_chk;
  alter table bib_metricas add constraint bib_metricas_tipo_chk
    check (tipo_especificacao in ('MAX_MIN','ATRIBUTO','UNID_MAX','UNID_MIN','REFERENCIA','TOLERANCIA'));
exception when others then null; end $$;

-- Backfill dos registros antigos → preserva o comportamento:
--   • tinham nominal + min + max  → 'TOLERANCIA' (deriva superior/inferior).
--   • tinham só min/max           → 'MAX_MIN'.
--   • nada dimensional            → 'MAX_MIN' (neutro; auditoria já ignora nulos).
update bib_metricas set
  tipo_especificacao = case
    when nominal is not null and (tol_min is not null or tol_max is not null) then 'TOLERANCIA'
    else 'MAX_MIN' end
  where tipo_especificacao is null or tipo_especificacao = 'TOLERANCIA';   -- só toca no default

update bib_metricas set
  superior = coalesce(superior, tol_max - nominal),
  inferior = coalesce(inferior, tol_min - nominal)
  where tipo_especificacao = 'TOLERANCIA' and nominal is not null
    and (superior is null or inferior is null);

-- ---------------------------- 3) insp_caracteristicas (snapshot da auditoria)
-- Congela o tipo da especificação e se é informativa (REFERENCIA), para o motor
-- de inspeção tratar OK/NOK e ignorar informativas nos cálculos/conformidade.
alter table insp_caracteristicas add column if not exists tipo_especificacao text default 'TOLERANCIA';
alter table insp_caracteristicas add column if not exists informativo boolean default false;
-- tipo_campo já existe ('numerico' | 'atributo'); mantido.

-- --------------------------------------------- 4) Catálogo PLANTA (2 fixas) --
-- Novas plantas canônicas; as antigas são desativadas (não apagadas) para não
-- quebrar peças legadas que ainda referenciam o texto antigo.
update bib_plantas set ativo = false
  where nome not in ('Rio de Janeiro – Nova Iguaçu','São Paulo – São Bernardo do Campo');
insert into bib_plantas (nome, ativo) values
  ('Rio de Janeiro – Nova Iguaçu', true),
  ('São Paulo – São Bernardo do Campo', true)
on conflict do nothing;

-- ------------------------------------------- 5) Catálogo QUEM MEDE (6 fixos) -
insert into quem_mede (nome) values
  ('G. Qualidade'), ('Eng. Processos'), ('Eng. Produto'),
  ('Laboratório'), ('Recebimento de Materiais'), ('Metrologia')
on conflict (nome) do nothing;
-- Valores antigos (G. DA QUALIDADE, etc.) permanecem para exibir specs legadas;
-- a tela de edição oferece apenas os 6 canônicos.

-- ------------------------------------------------------------- Diagnóstico ---
-- SELECT tipo_especificacao, count(*) FROM bib_metricas GROUP BY 1;
-- SELECT nome, ativo FROM bib_plantas ORDER BY ativo DESC, nome;
