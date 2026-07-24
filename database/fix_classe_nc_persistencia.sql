-- ==========================================================================
-- RNA One — PERSISTÊNCIA DA CLASSE DA NÃO CONFORMIDADE (§Erro 12)
--
-- SINTOMA: na Biblioteca Técnica o usuário escolhe a "Classe da NC", salva e vê
-- "sucesso", mas ao reabrir o campo volta vazio; relatórios/PDF mostram
-- "Não cadastrada".
--
-- CAUSA RAIZ: a coluna `classe_nc` não existe no banco (a migration
-- fix_exclusao_e_classe.sql nunca rodou nesta instância). O front, tolerante a
-- banco atrás das migrations, regravava a linha SEM a coluna — e antes anunciava
-- sucesso mesmo assim. O front já foi corrigido para DENUNCIAR a degradação
-- (toast "Salvo sem a Classe da NC"); este script cria a coluna que faltava.
--
-- Idempotente e seguro (só ADICIONA coluna/constraint; não apaga nada).
-- Se você já rodou database/fix_exclusao_e_classe.sql por inteiro, esta coluna
-- já existe e este script apenas confirma — pode rodar mesmo assim.
-- ==========================================================================

-- ---------------------------------------------------------------- PASSO 1
-- Coluna na Biblioteca (característica) e no snapshot da auditoria.
alter table public.bib_metricas          add column if not exists classe_nc text;
alter table public.insp_caracteristicas  add column if not exists classe_nc text;

-- ---------------------------------------------------------------- PASSO 2
-- Domínio permitido: A | B | C | NA (não se aplica) — ou nulo (não cadastrada).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bib_metricas_classe_nc_chk') then
    alter table public.bib_metricas
      add constraint bib_metricas_classe_nc_chk check (classe_nc is null or classe_nc in ('A','B','C','NA'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'insp_caracteristicas_classe_nc_chk') then
    alter table public.insp_caracteristicas
      add constraint insp_caracteristicas_classe_nc_chk check (classe_nc is null or classe_nc in ('A','B','C','NA'));
  end if;
end $$;

comment on column public.bib_metricas.classe_nc is
  'Classe da não conformidade (A/B/C/NA) da característica. Aplicada à auditoria quando a característica reprova. §Erro 10/12.';

-- ---------------------------------------------------------------- PASSO 3
-- VALIDAÇÃO: confirma que a coluna existe e mostra a distribuição atual.
select coalesce(classe_nc, 'NÃO CADASTRADA') as classe, count(*) as especificacoes
  from public.bib_metricas
 where coalesce(tipo_especificacao,'TOLERANCIA') <> 'REFERENCIA'
 group by 1
 order by 1;

-- Depois de criar a coluna, o cadastro em massa (opcional) fica em
-- database/classe_nc_preenchimento.sql — a decisão de classe é da Qualidade.
