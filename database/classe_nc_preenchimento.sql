-- ==========================================================================
-- RNA One — PREENCHIMENTO DA CLASSE DA NÃO CONFORMIDADE (§Erro 10)
-- Apoio ao cadastro em massa depois de rodar fix_exclusao_e_classe.sql.
--
-- LEIA ANTES: a classe é uma decisão de ENGENHARIA DA QUALIDADE, não de TI.
-- Este arquivo NÃO decide nada sozinho — ele agrupa o trabalho para que a
-- decisão seja tomada uma vez por CARACTERÍSTICA, e não 683 vezes por linha.
-- Rode o passo 1, leve a lista para a Qualidade, e só então rode o passo 3.
-- ==========================================================================

-- ---------------------------------------------------------------- PASSO 1
-- Quanto trabalho existe de verdade: uma linha por NOME de característica,
-- com quantas especificações dependem daquela decisão.
select coalesce(cm.nome, '(sem catálogo)') as caracteristica,
       count(*)                            as especificacoes_sem_classe,
       count(distinct m.peca_id)           as pecas_afetadas
  from public.bib_metricas m
  left join public.caracteristicas_ml cm on cm.id = m.caracteristica_id
 where m.classe_nc is null
   and coalesce(m.tipo_especificacao, 'TOLERANCIA') <> 'REFERENCIA'
 group by 1
 order by 2 desc;

-- ---------------------------------------------------------------- PASSO 2
-- Conferência do que já está cadastrado (para revisar decisões anteriores).
select coalesce(m.classe_nc, 'NÃO CADASTRADA') as classe, count(*) as especificacoes
  from public.bib_metricas m
 where coalesce(m.tipo_especificacao, 'TOLERANCIA') <> 'REFERENCIA'
 group by 1
 order by 1;

-- ---------------------------------------------------------------- PASSO 3
-- Aplicação da decisão, uma característica por vez. Duplique o bloco e troque
-- o nome e a classe. Só preenche o que está vazio (`classe_nc is null`), então
-- rodar de novo NÃO desfaz nada que a Qualidade já tenha ajustado à mão.
--
-- Valores aceitos: 'A' | 'B' | 'C' | 'NA' (não se aplica).
/*
update public.bib_metricas m
   set classe_nc = 'A'                              -- <<< classe decidida
  from public.caracteristicas_ml cm
 where cm.id = m.caracteristica_id
   and cm.nome = 'Dureza'                           -- <<< característica
   and m.classe_nc is null
   and coalesce(m.tipo_especificacao,'TOLERANCIA') <> 'REFERENCIA';
*/

-- Variante por PEÇA (quando a criticidade depende do part number):
/*
update public.bib_metricas m
   set classe_nc = 'B'
  from public.bib_pecas p
 where p.id = m.peca_id
   and p.codigo = 'CH52183684'
   and m.classe_nc is null
   and coalesce(m.tipo_especificacao,'TOLERANCIA') <> 'REFERENCIA';
*/

-- ---------------------------------------------------------------- PASSO 4
-- Propaga o cadastro para as auditorias EM ANDAMENTO (as finalizadas são
-- documento fechado e não são tocadas). Rode depois de cada rodada do passo 3.
/*
update public.insp_caracteristicas c
   set classe_nc = m.classe_nc
  from public.bib_metricas m, public.insp_relatorios r
 where c.metrica_id = m.id
   and r.id = c.relatorio_id
   and r.status not in ('finalizada_aprovada','finalizada_reprovada','revisada')
   and c.classe_nc is distinct from m.classe_nc;

update public.insp_caracteristicas c
   set classe_defeito = case
         when c.resultado = 'reprovado' and c.classe_nc in ('A','B','C') then c.classe_nc
         else null end
  from public.insp_relatorios r
 where r.id = c.relatorio_id
   and r.status not in ('finalizada_aprovada','finalizada_reprovada','revisada')
   and c.classe_defeito is distinct from (case
         when c.resultado = 'reprovado' and c.classe_nc in ('A','B','C') then c.classe_nc
         else null end);
*/

-- NÃO FAÇA: `update bib_metricas set classe_nc = 'A' where classe_nc is null`.
-- Classificar tudo como A destrói a distinção entre grave, moderado e leve —
-- é pior do que deixar em branco, porque parece cadastrado e não é.
