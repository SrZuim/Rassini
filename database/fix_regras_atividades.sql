-- =============================================================================
-- RNA One — REGRAS CONDICIONAIS DE ATIVIDADES (§M06)
--
-- Problema: op_atribuicoes define QUEM executa uma rotina, mas nada define
-- QUANDO ela se aplica. O auditor de uma linha que roda Scania recebia também a
-- rotina dos demais clientes, e as três variações de Magnaflux apareciam juntas
-- mesmo com só uma substância em uso.
--
-- Solução (aditiva): a atividade ganha CONDIÇÕES e GRUPO EXCLUSIVO; o plantão
-- ganha um CONTEXTO. O motor (services/regras-atividades.js) cruza os dois antes
-- de gerar as execuções.
--
--   op_atribuicoes  → QUEM faz          (inalterado)
--   op_atividades   → QUANDO se aplica  (colunas novas abaixo)
--   plantoes        → CONTEXTO do turno (coluna nova abaixo)
--
-- COMPATIBILIDADE: todas as colunas são opcionais e nascem vazias. Atividade sem
-- condições e sem grupo aplica-se sempre — exatamente o comportamento atual.
-- Nenhum cadastro existente muda de comportamento ao rodar esta migration.
--
-- Idempotente. Requisito: gestao_operacional.sql.
-- =============================================================================

-- ------------------------------------------- 1) condições e grupo exclusivo --
-- condicoes: array JSON de { campo, operador, valor }.
--   campo    ∈ cliente | processo | maquina | linha | tipo_inspecao | substancia
--   operador ∈ igual | diferente | em | nao_em
-- Todas as condições precisam passar (E lógico). Array vazio = sem restrição.
alter table op_atividades
  add column if not exists condicoes jsonb not null default '[]'::jsonb;

-- Atividades do mesmo grupo são mutuamente exclusivas: entre as que atendem ao
-- contexto, só a de maior prioridade entra no plantão ("nunca as duas").
alter table op_atividades
  add column if not exists grupo_regra text;
alter table op_atividades
  add column if not exists prioridade_regra integer not null default 0;
alter table op_atividades
  add column if not exists exclusivo_por_grupo boolean not null default true;

comment on column op_atividades.condicoes is
  'Condições de aplicação (E lógico): [{campo,operador,valor}]. Vazio = aplica-se sempre. Avaliadas contra plantoes.contexto antes de gerar o plantão.';
comment on column op_atividades.grupo_regra is
  'Grupo de exclusividade mútua. Entre as atividades do mesmo grupo que atendem ao contexto, apenas a de maior prioridade_regra entra no plantão.';
comment on column op_atividades.prioridade_regra is
  'Desempate dentro do grupo exclusivo — maior vence. Empate resolve por especificidade (nº de condições) e depois por código.';

-- Índice para as consultas por grupo (pré-visualização e diagnóstico).
create index if not exists op_ativ_grupo_regra_idx on op_atividades (grupo_regra)
  where grupo_regra is not null;

-- --------------------------------------------- 2) contexto do plantão --------
-- Informado na abertura do plantão: { cliente, processo, maquina, linha,
-- tipo_inspecao, substancia }. Campos em branco não restringem.
alter table plantoes
  add column if not exists contexto jsonb not null default '{}'::jsonb;

comment on column plantoes.contexto is
  'Contexto operacional do turno usado pelas regras condicionais (§M06): cliente, processo, maquina, linha, tipo_inspecao, substancia. Congelado na abertura — o plantão registra sob quais condições as rotinas foram geradas.';

-- ------------------------------------- 3) catálogos de contexto (editáveis) --
create table if not exists op_substancias (
  id text primary key default gen_random_uuid()::text,
  nome text not null unique,
  ativo boolean not null default true
);
create table if not exists op_processos (
  id text primary key default gen_random_uuid()::text,
  nome text not null unique,
  ativo boolean not null default true
);

-- Substâncias reais dos banhos de partícula magnética (antes eram dois ITENS da
-- mesma rotina Magnaflux; agora cada uma tem a sua rotina condicional).
insert into op_substancias (nome, ativo) values
  ('Magnaflux ML-500WB', true), ('Metalcheck CLY-2000', true), ('Magnaglo 14HF', true)
on conflict (nome) do nothing;

insert into op_processos (nome, ativo) values
  ('Estamparia', true), ('Tratamento Térmico', true), ('Montagem', true),
  ('Usinagem', true), ('Ensaio Não Destrutivo', true)
on conflict (nome) do nothing;

-- ------------------------------------------------------------ 4) RLS ---------
-- Mesmo padrão dos demais catálogos op_*: todos os autenticados leem; só
-- admin/supervisor escrevem. Nenhuma política existente é removida ou afrouxada.
do $$
declare t text;
begin
  foreach t in array array['op_substancias','op_processos'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "op_read_%1$s" on %1$s;', t);
    execute format('create policy "op_read_%1$s" on %1$s for select to authenticated using (true);', t);
    execute format('drop policy if exists "op_write_%1$s" on %1$s;', t);
    execute format($f$create policy "op_write_%1$s" on %1$s for all to authenticated
      using (current_perfil() in ('admin','supervisor'))
      with check (current_perfil() in ('admin','supervisor'));$f$, t);
  end loop;
end $$;

-- =============================================================================
-- VERIFICAÇÃO
-- =============================================================================
-- 1) colunas criadas:
--    select column_name, data_type, column_default from information_schema.columns
--     where table_name='op_atividades' and column_name in
--       ('condicoes','grupo_regra','prioridade_regra','exclusivo_por_grupo');
--
-- 2) nada mudou para o cadastro atual (todas sem condição e sem grupo):
--    select count(*) from op_atividades where condicoes = '[]'::jsonb and grupo_regra is null;
--
-- 3) exemplo — rotina exclusiva de Scania:
--    update op_atividades
--       set condicoes = '[{"campo":"cliente","operador":"igual","valor":"Scania"}]'::jsonb,
--           grupo_regra = 'velocidade_esteira', prioridade_regra = 100
--     where codigo = 'ROT-010';
--    update op_atividades
--       set condicoes = '[{"campo":"cliente","operador":"diferente","valor":"Scania"}]'::jsonb,
--           grupo_regra = 'velocidade_esteira', prioridade_regra = 10
--     where codigo = 'ROT-011';
--
-- 4) fluxo real: abrir plantão escolhendo Cliente = Scania
--    -> só a ROT-010 entra; escolhendo Volvo, só a ROT-011. Nunca as duas.
-- =============================================================================
