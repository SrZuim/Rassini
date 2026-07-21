-- =============================================================================
-- RNA One — Vínculo PEÇA × TIPOS DE INSPEÇÃO
--
-- Cada peça da Biblioteca Técnica passa a declarar em QUAIS tipos de inspeção
-- ela pode ser auditada. Em Minhas Auditorias, o auditor só enxerga as peças
-- aplicáveis ao tipo escolhido — elimina a seleção de peça incompatível.
--
-- FONTE ÚNICA DA VERDADE (§12): o catálogo de tipos JÁ EXISTIA na tabela
-- `insp_tipos` (semente INSP_TIPOS_DEFAULT em services/inspecao-data.js), com
-- slug estável por tipo. Esta migration NÃO cria uma segunda lista: apenas passa
-- a referenciar aqueles slugs. Slugs canônicos (não renomear — já estão
-- gravados em insp_relatorios.tipo_slug de auditorias concluídas):
--
--   vda65        Auditoria VDA 6.5
--   layout       Inspeção de Layout
--   final        Inspeção Final
--   ppap         PPAP — Processo de Aprovação de Peça de Produção
--   durabilidade Relatório para Durabilidade
--   ride         Relatório para Ride
--   fisico_dim   Teste Físico e Dimensional
--
-- MODELO ESCOLHIDO: coluna `text[]` em bib_pecas.
--   • O vínculo é um atributo simples da peça (sem dados próprios da relação);
--   • uma tabela associativa exigiria join em toda busca do auditor, que é o
--     caminho quente da tela de auditoria;
--   • `text[]` + índice GIN dá filtro rápido (`@>`) e cabe no padrão do projeto,
--     que já usa jsonb/array em outras tabelas.
-- Se um dia o vínculo precisar de atributos próprios (validade, responsável),
-- migra-se para tabela associativa sem perder estes dados.
--
-- COMPATIBILIDADE (§5): a coluna nasce NULL/vazia. Peça sem configuração NÃO é
-- apagada nem bloqueada: a Biblioteca a marca como "Tipo de inspeção não
-- configurado" e ela fica FORA de todas as auditorias até ser configurada —
-- de propósito, porque deixá-la aparecer em todas manteria o risco de seleção
-- errada que esta melhoria elimina. A seção 4 traz o backfill assistido.
--
-- Idempotente. Requisitos: biblioteca_tecnica.sql e auditorias_dimensional.sql.
-- =============================================================================

-- ------------------------------------------------- 1) Vínculo na peça --------
alter table bib_pecas
  add column if not exists tipos_inspecao text[] not null default '{}';

comment on column bib_pecas.tipos_inspecao is
  'Slugs de insp_tipos em que esta peça pode ser auditada (ex.: {layout,final,ppap}). Vazio = não configurada: a peça não aparece em nenhuma auditoria.';

-- Filtro por tipo (usado pela busca do auditor e pelo filtro da Biblioteca).
create index if not exists bib_pecas_tipos_idx on bib_pecas using gin (tipos_inspecao);

-- Integridade: só slugs conhecidos. NOT VALID para não rejeitar linhas legadas
-- já existentes; vale para toda gravação nova. Valide depois do backfill com:
--   alter table bib_pecas validate constraint bib_pecas_tipos_chk;
do $$
begin
  alter table bib_pecas drop constraint if exists bib_pecas_tipos_chk;
  alter table bib_pecas add constraint bib_pecas_tipos_chk
    check (tipos_inspecao <@ array['vda65','layout','final','ppap','durabilidade','ride','fisico_dim']::text[])
    not valid;
end $$;

-- --------------------------------- 2) Snapshot do vínculo na auditoria (§14) --
-- Congela QUAIS tipos a peça atendia no momento da auditoria. Se a Biblioteca
-- mudar depois, o relatório antigo continua provando o vínculo que existia.
alter table insp_relatorios
  add column if not exists peca_tipos_inspecao text[];

comment on column insp_relatorios.peca_tipos_inspecao is
  'Cópia histórica de bib_pecas.tipos_inspecao no instante do vínculo. Nunca reescrita — garante que relatório concluído não mude se a peça for reconfigurada.';

-- ------------------------------------------------------- 3) Tipos ativos -----
-- Garante que os 7 tipos canônicos existam (não sobrescreve nome/ordem de quem
-- já customizou pelo Admin — só insere o que estiver faltando).
--
-- ATENÇÃO (corrigido em 21/07/2026): a versão anterior usava
-- `on conflict (id) do nothing`, que só cobre a PK. Como o banco de produção já
-- tinha os 7 tipos com ids PRÓPRIOS (gerados pela aplicação, não 'it1'..'it7'),
-- o id não conflitava mas o slug sim, e a UNIQUE `insp_tipos_slug_key` abortava
-- a migration inteira com 23505 — derrubando junto os ALTER TABLE da seção 1,
-- porque o SQL Editor roda tudo em UMA transação. Resultado: parecia que a
-- migration havia rodado, e nenhuma coluna era criada.
--
-- Agora o filtro é por NOT EXISTS em slug E em id: idempotente sejam quais forem
-- os ids que a produção usa, e sem depender de qual constraint existe.
insert into insp_tipos (id, slug, nome, is_dimensional, ordem, ativo)
select v.id, v.slug, v.nome, v.is_dimensional, v.ordem, true
  from (values
    ('it1','vda65',       'Auditoria VDA 6.5',                               true, 1),
    ('it2','layout',      'Inspeção de Layout',                              true, 2),
    ('it3','final',       'Inspeção Final',                                  true, 3),
    ('it4','ppap',        'PPAP — Processo de Aprovação de Peça de Produção', true, 4),
    ('it5','durabilidade','Relatório para Durabilidade',                     true, 5),
    ('it6','ride',        'Relatório para Ride',                             true, 6),
    ('it7','fisico_dim',  'Teste Físico e Dimensional',                      true, 7)
  ) as v(id, slug, nome, is_dimensional, ordem)
 where not exists (select 1 from insp_tipos t where t.slug = v.slug)
   and not exists (select 1 from insp_tipos t where t.id   = v.id);

-- =============================================================================
-- 4) BACKFILL ASSISTIDO dos cadastros legados (§5) — REVISE ANTES DE RODAR
-- =============================================================================
-- NÃO habilitado por padrão: atribuir tipos automaticamente a todas as peças
-- recriaria exatamente o risco que a melhoria elimina. O caminho recomendado é
-- o administrador configurar peça a peça pela tela (a Biblioteca tem o filtro
-- "Tipo de inspeção não configurado" para listar as pendentes).
--
-- (a) Quantas peças faltam configurar:
--     select count(*) from bib_pecas where coalesce(array_length(tipos_inspecao,1),0) = 0;
--
-- (b) Listar as pendentes:
--     select codigo, nome, cliente, familia, status
--       from bib_pecas where coalesce(array_length(tipos_inspecao,1),0) = 0
--      order by codigo;
--
-- (c) Configurar em lote UM conjunto conhecido (exemplo — ajuste a lista!):
--     update bib_pecas
--        set tipos_inspecao = array['layout','final','ppap']::text[]
--      where codigo in ('RCE-001','RCE-014');
--
-- (d) Só depois de zerar as pendentes, valide a constraint:
--     alter table bib_pecas validate constraint bib_pecas_tipos_chk;

-- =============================================================================
-- 5) RLS — nada muda (§11)
-- =============================================================================
-- `tipos_inspecao` é coluna de bib_pecas e herda as policies já existentes de
-- biblioteca_tecnica.sql: leitura para autenticados, escrita conforme o perfil.
-- Nenhuma policy é criada, alterada ou removida aqui. Quem não podia editar a
-- peça continua sem poder editar o vínculo.

-- =============================================================================
-- VERIFICAÇÃO
-- =============================================================================
-- 1) coluna e índice:
--    select column_name, data_type from information_schema.columns
--     where table_name='bib_pecas' and column_name='tipos_inspecao';
--    select indexname from pg_indexes where tablename='bib_pecas' and indexname='bib_pecas_tipos_idx';
--
-- 2) peças aplicáveis a um tipo (mesma consulta que o auditor enxerga):
--    select codigo, nome from bib_pecas
--     where tipos_inspecao @> array['layout']::text[]
--       and status not in ('Arquivado','Obsoleto');
--
-- 3) fluxo real: Minhas Auditorias → nova inspeção "Inspeção de Layout"
--    -> só peças com 'layout' aparecem na busca;
--    -> trocar o tipo para "Relatório para Ride" remove a peça incompatível.
-- =============================================================================
