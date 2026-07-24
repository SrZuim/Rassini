-- ==========================================================================
-- RNA One — PADRONIZAÇÃO DAS PLANTAS OFICIAIS (§Erro 14)
--
-- Lista fechada oficial (fonte única no código: services/config.js → PLANTAS):
--   'Planta RJ - Lâminas'
--   'Planta SP - Lâminas'
--   'Planta SP - Helicoidal'
--   'Planta SP - Grampo'
--
-- LEIA ANTES DE RODAR:
--   Os nomes antigos são GEOGRÁFICOS ('Planta SP 01', 'São Paulo – São Bernardo
--   do Campo', 'Planta Rio Nova Iguaçu'…) e os oficiais são por LINHA DE PRODUTO
--   (Lâminas / Helicoidal / Grampo). Converter um no outro NÃO é automático: uma
--   peça de "Planta SP 01" pode pertencer a Lâminas, Helicoidal ou Grampo.
--   Por isso este script:
--     1) DIAGNOSTICA (passos 1-2) — rode e leve à Qualidade/Engenharia;
--     2) atualiza o CATÁLOGO de opções (passo 3) — seguro, idempotente;
--     3) deixa o UPDATE dos dados como TEMPLATE (passo 4) para ser preenchido
--        com a decisão humana — nada de dado é remapeado às cegas.
--   Faça backup antes do passo 4. Tudo é reversível enquanto o passo 4 não roda.
-- ==========================================================================

-- ---------------------------------------------------------------- PASSO 1
-- Quais valores de planta existem hoje, e quantos registros dependem de cada um.
-- (União de todas as tabelas que guardam planta como texto.)
select origem, planta, quantidade from (
  select 'bib_pecas'       as origem, planta, count(*) as quantidade from public.bib_pecas        group by planta
  union all
  select 'usuarios',            planta, count(*) from public.usuarios          group by planta
  union all
  select 'insp_relatorios',     planta, count(*) from public.insp_relatorios   group by planta
  union all
  select 'op_atividades',       planta, count(*) from public.op_atividades     group by planta
  union all
  select 'op_atribuicoes',      planta, count(*) from public.op_atribuicoes    group by planta
) t
order by origem, quantidade desc;

-- ---------------------------------------------------------------- PASSO 2
-- Catálogo atual de plantas (opções oferecidas nos formulários da Biblioteca).
select id, nome, ativo from public.bib_plantas order by nome;

-- ---------------------------------------------------------------- PASSO 3
-- CATÁLOGO OFICIAL (idempotente e seguro): garante as 4 opções oficiais e
-- DESATIVA as antigas, sem apagá-las (peças legadas continuam exibindo o valor
-- antigo até o passo 4 ser aplicado — o front trata o valor legado como opção
-- extra e não perde o dado).
-- Obs.: bib_plantas.nome NÃO tem constraint UNIQUE, então usamos "where not
-- exists" (em vez de ON CONFLICT) para não depender de índice único nem
-- duplicar linhas ao rodar novamente.
insert into public.bib_plantas (nome, ativo)
select v.nome, true
  from (values
    ('Planta RJ - Lâminas'),
    ('Planta SP - Lâminas'),
    ('Planta SP - Helicoidal'),
    ('Planta SP - Grampo')
  ) as v(nome)
 where not exists (select 1 from public.bib_plantas b where b.nome = v.nome);

update public.bib_plantas set ativo = true
 where nome in ('Planta RJ - Lâminas','Planta SP - Lâminas','Planta SP - Helicoidal','Planta SP - Grampo');

update public.bib_plantas set ativo = false
 where nome not in ('Planta RJ - Lâminas','Planta SP - Lâminas','Planta SP - Helicoidal','Planta SP - Grampo');

-- ---------------------------------------------------------------- PASSO 4
-- MIGRAÇÃO DOS DADOS — TEMPLATE. Preencha o mapeamento com a Qualidade e rode
-- um bloco por vez. Confira o "quantidade" retornado com o esperado do passo 1.
--
-- 4a) Caso UNÂMBÍGUO por linha de produto (a família define a planta):
--     ex.: toda peça da família 'Grampo' vai para 'Planta SP - Grampo'.
/*
update public.bib_pecas set planta = 'Planta SP - Grampo'
 where familia = 'Grampo' and planta is distinct from 'Planta SP - Grampo';

update public.bib_pecas set planta = 'Planta SP - Helicoidal'
 where familia = 'Mola Helicoidal' and planta is distinct from 'Planta SP - Helicoidal';

-- Lâminas existem no RJ e no SP — decida pela planta geográfica atual:
update public.bib_pecas set planta = 'Planta RJ - Lâminas'
 where familia in ('Lâmina','Feixe de Molas','Mola Parabólica')
   and planta ilike '%rio%';
update public.bib_pecas set planta = 'Planta SP - Lâminas'
 where familia in ('Lâmina','Feixe de Molas','Mola Parabólica')
   and planta ilike '%s%o paulo%' or planta ilike '%sp%';
*/
--
-- 4b) usuarios / insp_relatorios / op_*: revise caso a caso. Os relatórios
--     FINALIZADOS são documento fechado — pondere antes de reescrever a planta
--     de um relatório já emitido (o snapshot deve refletir o que valia à época).
/*
update public.usuarios     set planta = '<oficial>' where planta = '<antigo>';
update public.op_atividades  set planta = '<oficial>' where planta = '<antigo>';
update public.op_atribuicoes set planta = '<oficial>' where planta = '<antigo>';
*/

-- ---------------------------------------------------------------- PASSO 5
-- VALIDAÇÃO — rode depois do passo 4. Deve retornar ZERO linhas fora da lista.
select 'bib_pecas' as origem, planta, count(*)
  from public.bib_pecas
 where coalesce(planta,'') <> ''
   and planta not in ('Planta RJ - Lâminas','Planta SP - Lâminas','Planta SP - Helicoidal','Planta SP - Grampo')
 group by planta
union all
select 'usuarios', planta, count(*)
  from public.usuarios
 where coalesce(planta,'') <> ''
   and planta not in ('Planta RJ - Lâminas','Planta SP - Lâminas','Planta SP - Helicoidal','Planta SP - Grampo')
 group by planta;

-- NÃO FAÇA: `update bib_pecas set planta = 'Planta SP - Lâminas'` em massa sem
-- filtro. Isso destrói a distinção entre as quatro plantas e mistura dados de
-- linhas de produto diferentes — pior do que manter o nome antigo visível.
