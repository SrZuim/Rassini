-- =============================================================================
-- RNA One — Cadastro OFICIAL de clientes (§M05)
-- Fonte: "novo_relatrio_16-07-2026.xlsx" (16/07/2026). Esta lista passa a ser a
-- oficial em todos os módulos (Biblioteca, Peças, Relatórios, filtros,
-- formulários, Administração, impressões e exportações — todos leem bib_clientes).
--
-- -----------------------------------------------------------------------------
-- LIMPEZA APLICADA (regra do requisito)
-- -----------------------------------------------------------------------------
-- A planilha tem 57 linhas de dados. Foram descartados:
--   • 1 registro com NOME VAZIO (código 1012943928);
--   • 1 registro "GTS Equipamentos" com status Concluído — a versão ATIVA
--     "Gts Equipamentos" permanece (eram duplicata por diferença de caixa).
--   • "FRUM " → espaço final removido.
-- Restam 55 clientes ativos. Não havia rascunhos na planilha.
--
-- -----------------------------------------------------------------------------
-- COMPATIBILIDADE COM PEÇAS JÁ CADASTRADAS (o ponto crítico)
-- -----------------------------------------------------------------------------
-- bib_pecas.cliente guarda o NOME (texto), não um id. Trocar o catálogo sem
-- cuidado deixaria peças apontando para cliente inexistente. Comparando o
-- cadastro antigo com a lista nova:
--
--   Volvo, Scania, Ford, DAF, Iveco ....... idênticos, nada a fazer
--   "Mercedes-Benz" ....................... na lista nova é "Mercedes Benz"
--   "Volkswagen" .......................... na lista nova é "Volkswagen TB"
--   "Randon" .............................. NÃO existe na lista nova
--
-- Tratamento (seção 2): os dois primeiros são RENOMEADOS nas peças — é o mesmo
-- cliente, apenas grafado de outro jeito. "Randon" é mantido no catálogo como
-- INATIVO: some dos formulários e filtros de novos cadastros, mas a peça que o
-- referencia continua íntegra e rastreável. A tela de edição da peça mostra o
-- valor legado como opção selecionada, para não apagá-lo ao salvar.
--
-- insp_relatorios.cliente NÃO é alterado: é cópia histórica do momento da
-- auditoria (§14 de melhorias anteriores). Um relatório concluído deve continuar
-- mostrando exatamente o que foi auditado.
--
-- Idempotente. Requisito: biblioteca_tecnica.sql.
-- =============================================================================

-- -------------------------------------------------- 0) unicidade por nome ----
-- Necessário para os ON CONFLICT abaixo e para impedir duplicatas futuras.
create unique index if not exists bib_clientes_nome_uidx on bib_clientes (nome);

-- ------------------------------------------ 1) lista oficial (55 clientes) ---
insert into bib_clientes (nome, ativo) values
  ('ADR Eixos',true),('BMB',true),('Boero',true),('BPW',true),('BYD',true),
  ('CAOA Montadora',true),('Combat Armor',true),('DAF',true),('DEVA Veículos',true),
  ('FACCHINI',true),('Ford',true),('FOTON',true),('Freios Farj',true),('FRUM',true),
  ('General Motors',true),('Grunner',true),('Grupo Traton',true),('Gts Equipamentos',true),
  ('GUERRA',true),('GWM Motors',true),('Haldex',true),('Hiero',true),('Hitachi',true),
  ('Honda',true),('Hyundai',true),('Iveco',true),('Kia Motors',true),('KLL',true),
  ('Knorr Bremse',true),('Librepar',true),('Marcopolo',true),('Marelli',true),
  ('Master',true),('Mercedes Benz',true),('Mercedes Benz AR',true),('Mitsubishi',true),
  ('Muller',true),('NHK',true),('NIJU',true),('Nissan',true),('Rassini México',true),
  ('Reposição',true),('RUMO',true),('Scania',true),('Schomacker',true),('Stellantis',true),
  ('Suspensys',true),('Suzuki',true),('Tenneco',true),('Toyota',true),('VK',true),
  ('Volkswagen Automóveis',true),('Volkswagen TB',true),('Volvo',true),('ZF Group',true)
on conflict (nome) do update set ativo = true;

-- ------------------------- 2) renomear os clientes equivalentes nas peças ----
-- Mesmo cliente, grafia diferente. Roda ANTES de desativar os antigos.
update bib_pecas set cliente = 'Mercedes Benz'  where cliente = 'Mercedes-Benz';
update bib_pecas set cliente = 'Volkswagen TB'  where cliente = 'Volkswagen';

-- Remove as entradas antigas do catálogo (já substituídas acima).
delete from bib_clientes where nome in ('Mercedes-Benz','Volkswagen');

-- --------------------- 3) clientes fora da lista oficial → INATIVOS ----------
-- Nada é apagado: o que não está na lista nova apenas deixa de ser oferecido.
-- Assim uma peça antiga (ex.: Randon) nunca fica órfã.
update bib_clientes set ativo = false
 where nome not in (
  'ADR Eixos','BMB','Boero','BPW','BYD','CAOA Montadora','Combat Armor','DAF',
  'DEVA Veículos','FACCHINI','Ford','FOTON','Freios Farj','FRUM','General Motors',
  'Grunner','Grupo Traton','Gts Equipamentos','GUERRA','GWM Motors','Haldex','Hiero',
  'Hitachi','Honda','Hyundai','Iveco','Kia Motors','KLL','Knorr Bremse','Librepar',
  'Marcopolo','Marelli','Master','Mercedes Benz','Mercedes Benz AR','Mitsubishi',
  'Muller','NHK','NIJU','Nissan','Rassini México','Reposição','RUMO','Scania',
  'Schomacker','Stellantis','Suspensys','Suzuki','Tenneco','Toyota','VK',
  'Volkswagen Automóveis','Volkswagen TB','Volvo','ZF Group');

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
-- 1) devem ser 55 ativos:
--    select count(*) from bib_clientes where ativo;
--
-- 2) NENHUMA peça pode ficar com cliente fora do catálogo (esperado: 0 linhas):
--    select p.codigo, p.cliente from bib_pecas p
--     where coalesce(p.cliente,'') <> ''
--       and not exists (select 1 from bib_clientes c where c.nome = p.cliente);
--
-- 3) quais peças usam cliente legado/inativo (para regularizar quando quiser):
--    select p.codigo, p.nome, p.cliente from bib_pecas p
--      join bib_clientes c on c.nome = p.cliente
--     where c.ativo = false order by p.cliente, p.codigo;
--
-- 4) conferir que nenhum relatório concluído mudou:
--    select numero, cliente from insp_relatorios order by started_iso desc limit 10;
-- =============================================================================
