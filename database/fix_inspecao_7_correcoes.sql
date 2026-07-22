-- ==========================================================================
-- RNA One — INSPEÇÃO DIMENSIONAL · correção dos 7 erros
-- Rode UMA VEZ no SQL Editor do Supabase (idempotente: pode rodar de novo).
--
-- O QUE ESTE SCRIPT FAZ
--   §Erro 01  garante que limites e valores nominais sejam `numeric` (nunca
--             float8) — precisão decimal exata, sem 3.3499999999999996.
--   §Erro 02  normaliza os lotes já gravados para MAIÚSCULAS e passa a
--             normalizar automaticamente todo INSERT/UPDATE (trigger).
--   §Erro 03  valida a OP (somente dígitos) na gravação de valores NOVOS,
--             preservando zeros à esquerda (a coluna continua `text`).
--   §Erro 06  confirma que os carimbos de tempo são `timestamptz` (UTC no
--             banco, America/Sao_Paulo na tela) e que `started_iso` nunca é
--             sobrescrito depois de definido.
--   §Erro 07  reclassifica medições OK/NOK que ficaram gravadas como
--             'pendente' e recalcula as características afetadas.
--
-- NÃO APAGA DADOS. Nenhum valor medido é alterado — apenas o campo `resultado`
-- derivado e a caixa do lote. As OPs históricas fora do padrão são LISTADAS no
-- final para conferência manual, e não são reescritas automaticamente.
-- ==========================================================================

begin;

-- ---------------------------------------------------------------- §Erro 01
-- Precisão decimal: `numeric` guarda 3,350 exatamente; `float8`, não.
do $$
declare c record;
begin
  for c in
    select table_name, column_name
      from information_schema.columns
     where table_schema = 'public'
       and data_type in ('double precision', 'real')
       and (
         (table_name = 'insp_caracteristicas' and column_name in ('nominal','minimo','maximo'))
      or (table_name = 'bib_metricas'         and column_name in ('nominal','tol_min','tol_max','superior','inferior','tol_simetrica'))
       )
  loop
    execute format('alter table public.%I alter column %I type numeric using %I::numeric',
                   c.table_name, c.column_name, c.column_name);
    raise notice 'Coluna %.% convertida para numeric', c.table_name, c.column_name;
  end loop;
end $$;

-- ------------------------------------------------------------ §Erro 02 e 03
-- Normalização/validação na CAMADA DE PERSISTÊNCIA: o front já filtra a
-- digitação, mas nada entra fora do padrão mesmo vindo de outro caminho.
create or replace function public.insp_normaliza_identificacao()
returns trigger
language plpgsql
as $$
begin
  -- LOTE sempre em maiúsculas, sem espaços nas pontas (§Erro 02)
  if new.lote is not null then
    new.lote := upper(btrim(regexp_replace(new.lote, '\s+', ' ', 'g')));
  end if;

  -- OP somente dígitos (§Erro 03). Zeros à esquerda preservados: continua text.
  if new.op is not null then
    new.op := btrim(new.op);
    -- Só valida quando o valor MUDOU: registros históricos fora do padrão
    -- continuam podendo ser lidos e revisados sem travar a operação.
    if new.op <> '' and new.op !~ '^[0-9]+$'
       and (tg_op = 'INSERT' or new.op is distinct from old.op) then
      raise exception 'A OP deve conter somente números (recebido: %)', new.op
        using errcode = 'check_violation';
    end if;
  end if;

  -- §Erro 06 — o início real da inspeção nunca é reescrito depois de definido
  if tg_op = 'UPDATE' and old.started_iso is not null then
    new.started_iso := old.started_iso;
  end if;

  return new;
end $$;

drop trigger if exists insp_normaliza_identificacao_trg on public.insp_relatorios;
create trigger insp_normaliza_identificacao_trg
  before insert or update on public.insp_relatorios
  for each row execute function public.insp_normaliza_identificacao();

-- Backfill do que já está gravado: lote em maiúsculas (não destrói conteúdo).
update public.insp_relatorios
   set lote = upper(btrim(lote))
 where lote is not null and lote <> upper(btrim(lote));

-- ---------------------------------------------------------------- §Erro 06
-- Carimbos de tempo com fuso (o banco guarda UTC; a interface converte para
-- America/Sao_Paulo). Converte apenas se ainda estiver sem fuso.
do $$
declare c record;
begin
  for c in
    select table_name, column_name
      from information_schema.columns
     where table_schema = 'public'
       and data_type = 'timestamp without time zone'
       and column_name in ('started_iso','updated_iso','completed_iso','medido_iso','quando',
                           'inicio_iso','fim_iso','bloqueado_iso','batida_iso')
  loop
    -- assume que o valor gravado sem fuso estava em UTC (é o que nowISO() grava)
    execute format('alter table public.%I alter column %I type timestamptz using %I at time zone ''UTC''',
                   c.table_name, c.column_name, c.column_name);
    raise notice 'Coluna %.% convertida para timestamptz', c.table_name, c.column_name;
  end loop;
end $$;

-- ---------------------------------------------------------------- §Erro 07
-- OK/NOK que ficou como 'pendente' passa a valer Aprovado/Reprovado.
-- Só o campo derivado `resultado` é tocado; o valor medido permanece intacto.
update public.insp_medicoes m
   set resultado = case
         when upper(btrim(m.valor)) in ('OK','O.K.','CONFORME','APROVADO')            then 'aprovado'
         when upper(btrim(m.valor)) in ('NOK','NOK.','N.O.K.','NÃO OK','NAO OK',
                                        'NÃO CONFORME','NAO CONFORME','REPROVADO')    then 'reprovado'
       end
 where m.valor is not null
   and upper(btrim(m.valor)) in ('OK','O.K.','CONFORME','APROVADO','NOK','NOK.','N.O.K.',
                                 'NÃO OK','NAO OK','NÃO CONFORME','NAO CONFORME','REPROVADO')
   and m.resultado is distinct from case
         when upper(btrim(m.valor)) in ('OK','O.K.','CONFORME','APROVADO') then 'aprovado'
         else 'reprovado' end;

-- ---------------------------------------------------------------- §Erro 01
-- Medição EXATAMENTE no limite (ou dentro dele) que ficou gravada como
-- reprovada por comparação em ponto flutuante volta a ser aprovada.
update public.insp_medicoes m
   set resultado = 'aprovado'
  from public.insp_caracteristicas c
 where m.caracteristica_id = c.id
   and m.resultado = 'reprovado'
   and coalesce(c.tipo_campo,'numerico') = 'numerico'
   and m.valor ~ '^\s*-?[0-9]+([.,][0-9]+)?\s*$'
   and (c.minimo is null or replace(btrim(m.valor), ',', '.')::numeric >= c.minimo)
   and (c.maximo is null or replace(btrim(m.valor), ',', '.')::numeric <= c.maximo);

-- Recalcula o resultado das características e dos relatórios NÃO finalizados
-- (relatório finalizado é documento fechado: não se reescreve).
update public.insp_caracteristicas c
   set resultado = sub.res
  from (
    select c2.id,
           case
             when bool_or(m.resultado = 'reprovado')                       then 'reprovado'
             when count(m.id) = 0                                          then 'pendente'
             when bool_and(m.resultado in ('aprovado','registrado'))        then 'aprovado'
             else 'pendente'
           end as res
      from public.insp_caracteristicas c2
      join public.insp_relatorios r on r.id = c2.relatorio_id
      left join public.insp_medicoes m on m.caracteristica_id = c2.id
     where r.status not in ('finalizada_aprovada','finalizada_reprovada','revisada')
       and coalesce(c2.tipo_campo,'numerico') <> 'informativo'
     group by c2.id
  ) sub
 where c.id = sub.id and c.resultado is distinct from sub.res;

update public.insp_relatorios r
   set resultado = sub.res
  from (
    select r2.id,
           case
             when bool_or(c.resultado = 'reprovado')  then 'reprovado'
             when count(c.id) = 0                     then 'pendente'
             when bool_and(c.resultado = 'aprovado')  then 'aprovado'
             else 'pendente'
           end as res
      from public.insp_relatorios r2
      left join public.insp_caracteristicas c
             on c.relatorio_id = r2.id and coalesce(c.tipo_campo,'numerico') <> 'informativo'
     where r2.status not in ('finalizada_aprovada','finalizada_reprovada','revisada')
     group by r2.id
  ) sub
 where r.id = sub.id and r.resultado is distinct from sub.res;

commit;

-- ======================================================== CONFERÊNCIA MANUAL
-- OPs históricas fora do padrão (não foram alteradas — decida caso a caso).
select numero, op, lote, auditor_nome, started_iso
  from public.insp_relatorios
 where op is not null and op <> '' and op !~ '^[0-9]+$'
 order by started_iso desc;
