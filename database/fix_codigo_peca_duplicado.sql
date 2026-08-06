-- =============================================================================
-- RNA One — Biblioteca Técnica: CÓDIGO DA PEÇA (normalização e unicidade)
--
-- SINTOMA CORRIGIDO
--   Ao cadastrar uma peça ou acrescentar cotas a uma peça existente, a tela
--   mostrava o erro cru do PostgreSQL:
--     duplicate key value violates unique constraint "bib_pecas_codigo_uidx"
--
-- CAUSA (duas, independentes)
--   1) Aplicação: depois de um cadastro PARCIAL (peça criada, gravação das cotas
--      falhando em seguida), o formulário continuava em modo "nova peça" e a
--      tentativa seguinte INSERIA a mesma peça de novo. Corrigido no código
--      (services/biblioteca.js + assets/js/pages/biblioteca.js): assim que a
--      peça nasce, o formulário vira EDIÇÃO do id existente.
--   2) Dados: códigos gravados com espaços nas pontas ou caixa diferente. O
--      índice atual é sobre `lower(codigo)` — ele NÃO enxerga espaço. Então
--      'ABC ' e 'ABC' convivem no banco e são a MESMA peça para o usuário.
--
-- O QUE ESTE SCRIPT FAZ
--   1) Relata os códigos duplicados por forma normalizada (nada é apagado).
--   2) Normaliza os códigos existentes (upper + trim + espaços internos
--      colapsados) — pulando os que colidiriam com outra peça.
--   3) Cria o índice único sobre a forma normalizada, SEM derrubar o índice
--      atual (§8: a restrição existente continua valendo).
--   4) Confere o resultado.
--
-- IMPORTANTE: nenhuma peça é apagada nem mesclada por este script. Se sobrar
-- duplicidade real (duas peças diferentes com o mesmo código), a seção 4
-- lista os casos para decisão humana — o índice novo não é criado enquanto
-- houver conflito, e o sistema continua funcionando com o índice atual.
--
-- Idempotente. Requisito: database/biblioteca_tecnica.sql.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 0) Função de normalização — MESMA regra de services/biblioteca-codigo.js
--    (caixa alta, sem espaços nas pontas, espaços internos colapsados).
--    IMMUTABLE porque será usada em índice.
-- ---------------------------------------------------------------------------
create or replace function bib_codigo_normalizado(txt text)
returns text
language sql
immutable
as $$
  select upper(btrim(regexp_replace(coalesce(txt, ''), '\s+', ' ', 'g')));
$$;

-- ---------------------------------------------------------------------------
-- 1) DIAGNÓSTICO — quais códigos colidem depois de normalizados?
--    Rode e leia ANTES de seguir. Resultado vazio = nada a resolver à mão.
-- ---------------------------------------------------------------------------
select bib_codigo_normalizado(codigo) as codigo_normalizado,
       count(*)                       as qtd,
       array_agg(id order by created_at nulls last, id)     as ids,
       array_agg(codigo order by created_at nulls last, id) as codigos_como_estao,
       array_agg(nome order by created_at nulls last, id)   as nomes
  from bib_pecas
 group by 1
having count(*) > 1
 order by 2 desc, 1;

-- ---------------------------------------------------------------------------
-- 2) NORMALIZAÇÃO DOS CÓDIGOS EXISTENTES
--    Só atualiza a linha quando o valor normalizado NÃO é ocupado por outra
--    peça — normalizar às cegas transformaria "espaço sobrando" em violação de
--    chave e derrubaria a migration inteira.
-- ---------------------------------------------------------------------------
do $$
declare
  v_alterados int;
  v_pulados   int;
begin
  with alvo as (
    select p.id,
           p.codigo as antes,
           bib_codigo_normalizado(p.codigo) as depois
      from bib_pecas p
     where p.codigo is distinct from bib_codigo_normalizado(p.codigo)
  ),
  livres as (
    select a.*
      from alvo a
     where not exists (
             select 1 from bib_pecas o
              where o.id <> a.id
                and bib_codigo_normalizado(o.codigo) = a.depois
           )
  ),
  atualizadas as (
    update bib_pecas p
       set codigo = l.depois
      from livres l
     where p.id = l.id
    returning p.id
  )
  select (select count(*) from atualizadas),
         (select count(*) from alvo) - (select count(*) from livres)
    into v_alterados, v_pulados;

  raise notice 'Códigos normalizados: %', v_alterados;
  if v_pulados > 0 then
    raise notice 'Códigos NÃO normalizados por colidirem com outra peça: % (ver a consulta da seção 1)', v_pulados;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) ÍNDICE ÚNICO SOBRE A FORMA NORMALIZADA
--    `bib_pecas_codigo_uidx` (lower(codigo)) CONTINUA existindo — §8. Este
--    acrescenta o que faltava: espaço e caixa deixam de criar peça duplicada.
--    Falha controlada: se ainda houver duplicidade real, o índice não é criado
--    e o script AVISA em vez de abortar tudo.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_indexes
              where schemaname = 'public' and indexname = 'bib_pecas_codigo_norm_uidx') then
    raise notice 'Índice bib_pecas_codigo_norm_uidx já existe.';
    return;
  end if;

  begin
    execute 'create unique index bib_pecas_codigo_norm_uidx
               on bib_pecas (bib_codigo_normalizado(codigo))';
    raise notice 'Índice bib_pecas_codigo_norm_uidx criado.';
  exception when unique_violation then
    raise warning 'Índice NÃO criado: ainda existem peças com o mesmo código normalizado. '
                  'Rode a consulta da seção 1, decida o que fazer com cada caso '
                  '(renomear ou excluir a peça errada) e rode este script de novo. '
                  'O índice bib_pecas_codigo_uidx continua protegendo o cadastro.';
  end;
end $$;

-- ---------------------------------------------------------------------------
-- 4) VERIFICAÇÃO — o que ficou
-- ---------------------------------------------------------------------------
select indexname, indexdef
  from pg_indexes
 where schemaname = 'public' and tablename = 'bib_pecas' and indexdef ilike '%codigo%'
 order by indexname;

select count(*) filter (where codigo <> bib_codigo_normalizado(codigo)) as fora_do_padrao,
       count(*)                                                          as total_pecas
  from bib_pecas;
