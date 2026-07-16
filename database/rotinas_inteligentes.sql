-- =============================================================================
-- RNA One — Rotinas Inteligentes (Gestão Operacional + Minhas Rotinas)
-- Rassini NHK Automotive
-- -----------------------------------------------------------------------------
-- 100% ADITIVO e IDEMPOTENTE. Só ADICIONA colunas/índices.
-- NÃO cria tabelas duplicadas, NÃO remove colunas, NÃO apaga dados.
--
-- DECISÃO DE MODELAGEM (reuso, conforme "se já existir estrutura equivalente,
-- reutilize-a"). As entidades pedidas já têm equivalente no projeto:
--   routine_templates       → op_atividades (tipo_slug='rotina', is_template=true)
--   routine_template_items  → op_atividade_itens
--   routine_assignments     → op_atribuicoes + op_agenda
--   routine_executions      → op_execucao
--   routine_execution_items → op_execucao_itens
-- Criar tabelas novas duplicaria o motor de atribuição/plantão já em produção.
--
-- Pré-requisito: database/gestao_operacional.sql.
-- Onde rodar: Supabase → SQL Editor → cole TUDO → Run.
-- Os 7 modelos padrão (SP1..SP5, Magnaflux, Temperatura e Umidade) NÃO são
-- inseridos aqui: são instalados pela própria Gestão Operacional (botão
-- "Instalar modelos padrão"), que confere o código antes de inserir e respeita
-- o RLS do administrador. Assim o seed nunca duplica a cada boot (§29).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) op_atividades — modelo de rotina (versão) e vínculo rotina → modelo
-- ---------------------------------------------------------------------------
alter table op_atividades add column if not exists versao        int  default 1;
alter table op_atividades add column if not exists modelo_id     text;   -- rotina → modelo usado
alter table op_atividades add column if not exists modelo_versao int;    -- versão do modelo na criação
alter table op_atividades add column if not exists updated_by    text;

update op_atividades set versao = coalesce(versao, 1) where versao is null;

-- Vínculo formal rotina → modelo (ambos vivem em op_atividades).
-- NOT VALID: passa a valer para gravações novas sem reprovar linhas legadas.
do $$
declare orfaos int;
begin
  alter table op_atividades drop constraint if exists op_atividades_modelo_id_fkey;
  alter table op_atividades add constraint op_atividades_modelo_id_fkey
    foreign key (modelo_id) references op_atividades(id)
    on update cascade on delete restrict not valid;

  select count(*) into orfaos from op_atividades a
   where a.modelo_id is not null
     and not exists (select 1 from op_atividades m where m.id = a.modelo_id);
  if orfaos = 0 then
    alter table op_atividades validate constraint op_atividades_modelo_id_fkey;
    raise notice 'FK op_atividades.modelo_id criada e VALIDADA.';
  else
    raise warning 'FK modelo_id criada como NOT VALID: % rotina(s) apontam para modelo inexistente.', orfaos;
  end if;
exception when others then
  raise warning 'Nao foi possivel criar a FK op_atividades.modelo_id: %', sqlerrm;
end $$;

create index if not exists op_atividades_modelo_idx on op_atividades (modelo_id);
-- Código do modelo é único ENTRE MODELOS (rotinas comuns podem repetir/ficar nulas).
create unique index if not exists op_atividades_modelo_codigo_uidx
  on op_atividades (upper(codigo)) where is_template = true and tipo_slug = 'rotina' and codigo is not null;

-- ---------------------------------------------------------------------------
-- 2) op_atividade_itens — cadastro inteligente do item (§13, §14, §15, §18, §19)
--    limite_min / limite_max / unidade / opcoes / ordem JÁ EXISTEM: reutilizados
--    como minimum_value / maximum_value / unit_name / options / order_index.
-- ---------------------------------------------------------------------------
alter table op_atividade_itens add column if not exists unidade_simbolo     text;
alter table op_atividade_itens add column if not exists tipo_validacao      text default 'sem_validacao';
alter table op_atividade_itens add column if not exists valor_nominal       numeric;
alter table op_atividade_itens add column if not exists valor_esperado      text;
alter table op_atividade_itens add column if not exists especificacao_texto text;
alter table op_atividade_itens add column if not exists frequencia_item     text default 'diario';
alter table op_atividade_itens add column if not exists obrigatorio         boolean default true;
alter table op_atividade_itens add column if not exists permite_obs         boolean default true;
alter table op_atividade_itens add column if not exists permite_foto        boolean default true;
alter table op_atividade_itens add column if not exists exige_foto_nc       boolean default false;
alter table op_atividade_itens add column if not exists regra_condicional   jsonb;
alter table op_atividade_itens add column if not exists contexto_chave      text;
alter table op_atividade_itens add column if not exists ativo               boolean default true;
alter table op_atividade_itens add column if not exists created_at          timestamptz default now();
alter table op_atividade_itens add column if not exists updated_at          timestamptz default now();

-- Restringe aos valores válidos do motor (services/rotinas.js).
do $$ begin
  alter table op_atividade_itens drop constraint if exists op_itens_validacao_chk;
  alter table op_atividade_itens add constraint op_itens_validacao_chk
    check (tipo_validacao in ('intervalo','minimo','maximo','exato','texto','conforme_nc','sem_validacao'));
exception when others then
  raise warning 'Constraint op_itens_validacao_chk nao aplicada (dados legados?): %', sqlerrm;
end $$;

-- Integridade: intervalo/mínimo/máximo exigem os limites; mín <= máx (§26).
do $$ begin
  alter table op_atividade_itens drop constraint if exists op_itens_limites_chk;
  alter table op_atividade_itens add constraint op_itens_limites_chk check (
    (tipo_validacao <> 'intervalo' or (limite_min is not null and limite_max is not null))
    and (tipo_validacao <> 'minimo' or limite_min is not null)
    and (tipo_validacao <> 'maximo' or limite_max is not null)
    and (limite_min is null or limite_max is null or limite_min <= limite_max)
  );
exception when others then
  raise warning 'Constraint op_itens_limites_chk nao aplicada (dados legados?): %', sqlerrm;
end $$;

-- Backfill dos itens de checklist já existentes: preserva o comportamento atual
-- (valor_numerico + limites → intervalo/mín/máx; senão continua informativo).
update op_atividade_itens set
  tipo_validacao = case
    when tipo_validacao is not null and tipo_validacao <> 'sem_validacao' then tipo_validacao
    when valor_numerico and limite_min is not null and limite_max is not null then 'intervalo'
    when valor_numerico and limite_min is not null then 'minimo'
    when valor_numerico and limite_max is not null then 'maximo'
    when resposta_esperada is not null and resposta_esperada <> '' then 'exato'
    else 'sem_validacao' end,
  valor_esperado  = coalesce(valor_esperado, resposta_esperada),
  frequencia_item = coalesce(frequencia_item, 'diario'),
  obrigatorio     = coalesce(obrigatorio, true),
  permite_obs     = coalesce(permite_obs, true),
  permite_foto    = coalesce(permite_foto, true),
  ativo           = coalesce(ativo, true)
where tipo_validacao is null or frequencia_item is null or ativo is null;

create index if not exists op_itens_ordem_idx on op_atividade_itens (atividade_id, ordem);

-- ---------------------------------------------------------------------------
-- 3) op_execucao — versão do modelo, contexto e contadores (§21, §23)
-- ---------------------------------------------------------------------------
alter table op_execucao add column if not exists modelo_id             text;
alter table op_execucao add column if not exists modelo_versao         int;
alter table op_execucao add column if not exists contexto              jsonb default '{}';   -- tipo_cliente, produto, lote...
alter table op_execucao add column if not exists obs_geral             text;
alter table op_execucao add column if not exists total_itens           int;
alter table op_execucao add column if not exists itens_conformes       int;
alter table op_execucao add column if not exists itens_nao_conformes   int;
alter table op_execucao add column if not exists itens_nao_aplicaveis  int;
alter table op_execucao add column if not exists atualizado_iso        timestamptz;

-- status ganha: rascunho | aguardando | concluida_nc | cancelada (§21)
-- (coluna text sem enum — nada a migrar; os antigos continuam válidos).

create index if not exists op_exec_modelo_idx on op_execucao (modelo_id);
create index if not exists op_exec_status_idx on op_execucao (status);

-- ---------------------------------------------------------------------------
-- 4) op_execucao_itens — SNAPSHOT da configuração no momento da execução (§23)
--    É isto que impede que alterar o modelo mude o histórico.
-- ---------------------------------------------------------------------------
alter table op_execucao_itens add column if not exists nome_snapshot          text;
alter table op_execucao_itens add column if not exists unidade_snapshot       text;
alter table op_execucao_itens add column if not exists especificacao_snapshot text;
alter table op_execucao_itens add column if not exists minimo_snapshot        numeric;
alter table op_execucao_itens add column if not exists maximo_snapshot        numeric;
alter table op_execucao_itens add column if not exists validacao_snapshot     text;
alter table op_execucao_itens add column if not exists frequencia_snapshot    text;
alter table op_execucao_itens add column if not exists resultado              text;   -- conforme|nao_conforme|nao_aplicavel|sem_validacao|pendente
alter table op_execucao_itens add column if not exists valor_texto            text;
alter table op_execucao_itens add column if not exists ordem                  int;
alter table op_execucao_itens add column if not exists concluido_em           timestamptz;
alter table op_execucao_itens add column if not exists concluido_por          text;

-- Backfill do histórico já existente: ok=true → conforme; status 'fora' → NC.
update op_execucao_itens set resultado = case
  when resultado is not null then resultado
  when status = 'fora' then 'nao_conforme'
  when ok is true  then 'conforme'
  when ok is false then 'nao_conforme'
  else 'sem_validacao' end
where resultado is null;

create index if not exists op_exec_itens_item_idx on op_execucao_itens (item_id);
-- Um resultado por item em cada execução (evita duplicidade em clique duplo, §26).
create unique index if not exists op_exec_itens_uidx on op_execucao_itens (execucao_id, item_id);

-- ---------------------------------------------------------------------------
-- 5) Recarrega o cache de schema do PostgREST (senão as colunas novas ficam
--    invisíveis para a API e o app recebe PGRST204).
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- =============================================================================
-- DIAGNÓSTICO — confirma as colunas novas (esperado: 28 linhas)
-- =============================================================================
-- select table_name, column_name from information_schema.columns
--  where (table_name='op_atividades'      and column_name in ('versao','modelo_id','modelo_versao','updated_by'))
--     or (table_name='op_atividade_itens' and column_name in ('unidade_simbolo','tipo_validacao','valor_nominal','valor_esperado','especificacao_texto','frequencia_item','obrigatorio','permite_obs','permite_foto','exige_foto_nc','regra_condicional','contexto_chave','ativo'))
--     or (table_name='op_execucao'        and column_name in ('modelo_id','modelo_versao','contexto','obs_geral','total_itens','itens_conformes','itens_nao_conformes','itens_nao_aplicaveis'))
--     or (table_name='op_execucao_itens'  and column_name in ('nome_snapshot','especificacao_snapshot','resultado','valor_texto'))
--  order by table_name, column_name;
-- =============================================================================
