-- =============================================================================
-- RNA One — Cadastro OFICIAL de clientes (§M05 · atualização lista 54)
-- Esta lista passa a ser a oficial em todos os módulos (Biblioteca, Peças,
-- Relatórios, filtros, formulários, Administração, impressões e exportações —
-- todos leem bib_clientes, fonte única).
--
-- -----------------------------------------------------------------------------
-- ATUALIZAÇÃO DESTA VERSÃO (lista oficial de 54 clientes)
-- -----------------------------------------------------------------------------
--   • Duplicata por caixa unificada: "Gts Equipamentos" → "GTS Equipamentos"
--     (grafia oficial em maiúsculas). As peças ligadas são migradas.
--   • "Rassini México" REMOVIDO da base — deixa de ser cliente oficial.
--   • "FRUM " → espaço final removido (já tratado).
-- Restam 54 clientes ativos.
--
-- -----------------------------------------------------------------------------
-- COMPATIBILIDADE COM PEÇAS JÁ CADASTRADAS (o ponto crítico)
-- -----------------------------------------------------------------------------
-- bib_pecas.cliente guarda o NOME (texto), não um id. Trocar o catálogo sem
-- cuidado deixaria peças apontando para cliente inexistente. Tratamento:
--   • Renomeações (mesmo cliente, grafia diferente) são aplicadas NAS PEÇAS
--     antes de mexer no catálogo: "Mercedes-Benz"→"Mercedes Benz",
--     "Volkswagen"→"Volkswagen TB", "Gts Equipamentos"→"GTS Equipamentos".
--   • Clientes fora da lista (ex.: "Randon", "Rassini México") que AINDA tenham
--     peça vinculada ficam no catálogo como INATIVOS — somem dos formulários e
--     filtros de novos cadastros, mas a peça continua íntegra e rastreável.
--   • Clientes fora da lista SEM nenhuma peça vinculada são removidos do catálogo.
--
-- insp_relatorios.cliente NÃO é alterado: é cópia histórica do momento da
-- auditoria. Um relatório concluído deve continuar mostrando o que foi auditado.
--
-- Idempotente. Requisito: biblioteca_tecnica.sql.
-- =============================================================================

-- ------------------------------------------ 0) DEDUP + unicidade por nome ----
-- O banco de produção pode JÁ ter linhas duplicadas (ex.: duas linhas "Volvo"),
-- o que faz o "create unique index" falhar com 23505. Removemos as duplicatas
-- EXATAS de nome mantendo UMA linha por nome. É seguro: bib_pecas referencia o
-- cliente pelo NOME (texto), então apagar a linha-catálogo duplicada não desfaz
-- vínculo algum (o nome continua existindo uma vez).
delete from bib_clientes a
 using bib_clientes b
 where a.ctid < b.ctid
   and a.nome = b.nome;

-- Agora sim: índice único (necessário para os ON CONFLICT abaixo e para impedir
-- duplicatas futuras).
create unique index if not exists bib_clientes_nome_uidx on bib_clientes (nome);

-- --------------------- 1) renomear os clientes equivalentes nas peças --------
-- Mesmo cliente, grafia diferente. Roda ANTES de mexer no catálogo.
update bib_pecas set cliente = 'Mercedes Benz'    where cliente = 'Mercedes-Benz';
update bib_pecas set cliente = 'Volkswagen TB'    where cliente = 'Volkswagen';
update bib_pecas set cliente = 'GTS Equipamentos' where cliente = 'Gts Equipamentos';

-- Remove as entradas antigas/duplicadas do catálogo (já substituídas acima).
delete from bib_clientes where nome in ('Mercedes-Benz','Volkswagen','Gts Equipamentos');

-- ------------------------------------------ 2) lista oficial (54 clientes) ---
insert into bib_clientes (nome, ativo) values
  ('ADR Eixos',true),('BMB',true),('Boero',true),('BPW',true),('BYD',true),
  ('CAOA Montadora',true),('Combat Armor',true),('DAF',true),('DEVA Veículos',true),
  ('FACCHINI',true),('Ford',true),('FOTON',true),('Freios Farj',true),('FRUM',true),
  ('General Motors',true),('Grunner',true),('Grupo Traton',true),('GTS Equipamentos',true),
  ('GUERRA',true),('GWM Motors',true),('Haldex',true),('Hiero',true),('Hitachi',true),
  ('Honda',true),('Hyundai',true),('Iveco',true),('Kia Motors',true),('KLL',true),
  ('Knorr Bremse',true),('Librepar',true),('Marcopolo',true),('Marelli',true),
  ('Master',true),('Mercedes Benz',true),('Mercedes Benz AR',true),('Mitsubishi',true),
  ('Muller',true),('NHK',true),('NIJU',true),('Nissan',true),
  ('Reposição',true),('RUMO',true),('Scania',true),('Schomacker',true),('Stellantis',true),
  ('Suspensys',true),('Suzuki',true),('Tenneco',true),('Toyota',true),('VK',true),
  ('Volkswagen Automóveis',true),('Volkswagen TB',true),('Volvo',true),('ZF Group',true)
on conflict (nome) do update set ativo = true;

-- --------------------- 3) clientes fora da lista oficial → INATIVOS ----------
-- Nada é apagado aqui: o que não está na lista nova apenas deixa de ser
-- oferecido. Assim uma peça antiga (ex.: Randon) nunca fica órfã.
update bib_clientes set ativo = false
 where nome not in (
  'ADR Eixos','BMB','Boero','BPW','BYD','CAOA Montadora','Combat Armor','DAF',
  'DEVA Veículos','FACCHINI','Ford','FOTON','Freios Farj','FRUM','General Motors',
  'Grunner','Grupo Traton','GTS Equipamentos','GUERRA','GWM Motors','Haldex','Hiero',
  'Hitachi','Honda','Hyundai','Iveco','Kia Motors','KLL','Knorr Bremse','Librepar',
  'Marcopolo','Marelli','Master','Mercedes Benz','Mercedes Benz AR','Mitsubishi',
  'Muller','NHK','NIJU','Nissan','Reposição','RUMO','Scania',
  'Schomacker','Stellantis','Suspensys','Suzuki','Tenneco','Toyota','VK',
  'Volkswagen Automóveis','Volkswagen TB','Volvo','ZF Group');

-- --------- 4) remoção SEGURA dos legados sem vínculo (ex.: Rassini México) ---
-- Remove do catálogo os clientes fora da lista oficial que NÃO têm peça
-- vinculada. Os que ainda têm peça permanecem inativos (seção 3), nunca órfãos.
delete from bib_clientes c
 where c.nome not in (
  'ADR Eixos','BMB','Boero','BPW','BYD','CAOA Montadora','Combat Armor','DAF',
  'DEVA Veículos','FACCHINI','Ford','FOTON','Freios Farj','FRUM','General Motors',
  'Grunner','Grupo Traton','GTS Equipamentos','GUERRA','GWM Motors','Haldex','Hiero',
  'Hitachi','Honda','Hyundai','Iveco','Kia Motors','KLL','Knorr Bremse','Librepar',
  'Marcopolo','Marelli','Master','Mercedes Benz','Mercedes Benz AR','Mitsubishi',
  'Muller','NHK','NIJU','Nissan','Reposição','RUMO','Scania',
  'Schomacker','Stellantis','Suspensys','Suzuki','Tenneco','Toyota','VK',
  'Volkswagen Automóveis','Volkswagen TB','Volvo','ZF Group')
   and not exists (select 1 from bib_pecas p where p.cliente = c.nome);

-- Garante que um cliente legado AINDA REFERENCIADO por peça exista no catálogo
-- (inativo), mesmo que nunca tenha sido cadastrado como registro próprio.
insert into bib_clientes (nome, ativo)
select distinct p.cliente, false
  from bib_pecas p
 where coalesce(p.cliente,'') <> ''
   and not exists (select 1 from bib_clientes c where c.nome = p.cliente)
on conflict (nome) do nothing;

-- =============================================================================
-- VERIFICAÇÃO
-- =============================================================================
-- 1) devem ser 54 ativos:
--    select count(*) from bib_clientes where ativo;
--
-- 2) NENHUMA peça pode ficar com cliente fora do catálogo (esperado: 0 linhas):
--    select p.codigo, p.cliente from bib_pecas p
--     where coalesce(p.cliente,'') <> ''
--       and not exists (select 1 from bib_clientes c where c.nome = p.cliente);
--
-- 3) não pode restar duplicata por caixa "Gts"/"Rassini" (esperado: 0 linhas):
--    select nome from bib_clientes where nome in ('Gts Equipamentos','Rassini México');
--
-- 4) quais peças usam cliente legado/inativo (para regularizar quando quiser):
--    select p.codigo, p.nome, p.cliente from bib_pecas p
--      join bib_clientes c on c.nome = p.cliente
--     where c.ativo = false order by p.cliente, p.codigo;
--
-- 5) conferir que nenhum relatório concluído mudou:
--    select numero, cliente from insp_relatorios order by started_iso desc limit 10;
-- =============================================================================
