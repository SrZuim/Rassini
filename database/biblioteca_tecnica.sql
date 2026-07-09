-- =============================================================================
-- RNA One — Módulo Biblioteca Técnica (cadastro reestruturado — Características ML)
-- Rassini NHK Automotive · Esquema + RLS + seed (PostgreSQL / Supabase)
-- -----------------------------------------------------------------------------
-- Execute no SQL Editor do Supabase APÓS schema.sql e rls.sql
-- (depende do helper current_perfil() definido em rls.sql).
-- Depois, no painel Storage, crie um bucket público chamado "biblioteca".
-- Seguro para instalação nova E para quem já rodou a versão anterior deste
-- arquivo (usa create-if-not-exists + alter-if-not-exists).
-- =============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------- CATÁLOGOS DE PEÇA -----
create table if not exists bib_clientes    ( id text primary key default gen_random_uuid()::text, nome text not null, ativo boolean default true );
create table if not exists bib_plantas     ( id text primary key default gen_random_uuid()::text, nome text not null, ativo boolean default true );
create table if not exists bib_familias    ( id text primary key default gen_random_uuid()::text, nome text not null, ativo boolean default true );
create table if not exists bib_quadrantes  ( id text primary key default gen_random_uuid()::text, nome text not null unique, ativo boolean default true );

-- ------------------------------------ CATÁLOGOS DE ESPECIFICAÇÃO (novos) -----
create table if not exists caracteristicas_ml (
  id text primary key default gen_random_uuid()::text,
  nome text not null unique,
  ativo boolean default true,
  criado_em timestamptz default now()
);
create table if not exists equipamentos_medicao (
  id text primary key default gen_random_uuid()::text,
  nome text not null unique,
  ativo boolean default true
);
create table if not exists quem_mede (
  id text primary key default gen_random_uuid()::text,
  nome text not null unique,
  ativo boolean default true
);

-- --------------------------------------------------------------- PEÇAS -------
create table if not exists bib_pecas (
  id text primary key default gen_random_uuid()::text,
  codigo text not null,
  nome text not null,
  cliente text, familia text, quadrante text,
  peso text, material text, acabamento text, cor text,
  status text default 'Ativo', planta text, norma text, especificacao text,
  revisao_desenho int, data_revisao_desenho date, numero_ad text,
  revisao int default 1,
  observacoes text,
  imagem text,
  galeria jsonb default '[]',
  ativo boolean default true,
  created_at date default now(),
  updated_at date default now(),
  created_by text
);
-- Colunas novas para quem já tinha a versão anterior:
alter table bib_pecas add column if not exists quadrante text;
alter table bib_pecas add column if not exists revisao_desenho int;
alter table bib_pecas add column if not exists data_revisao_desenho date;
alter table bib_pecas add column if not exists numero_ad text;

create unique index if not exists bib_pecas_codigo_uidx on bib_pecas (lower(codigo));
create index if not exists bib_pecas_cliente_idx on bib_pecas (cliente);
create index if not exists bib_pecas_familia_idx on bib_pecas (familia);
create index if not exists bib_pecas_status_idx  on bib_pecas (status);

-- ------------------------------ ESPECIFICAÇÕES (antiga tabela de métricas) ---
create table if not exists bib_metricas (
  id text primary key default gen_random_uuid()::text,
  peca_id text references bib_pecas(id) on delete cascade,
  cota numeric,
  caracteristica_id text references caracteristicas_ml(id),
  referencia text,
  nominal numeric, tol_min numeric, tol_max numeric,
  unidade text,
  equipamento_id text references equipamentos_medicao(id),
  quem_mede_id text references quem_mede(id),
  observacao text,
  ordem int default 0
);
-- Migração de estrutura para quem já tinha a versão anterior:
alter table bib_metricas add column if not exists cota numeric;
alter table bib_metricas add column if not exists caracteristica_id text references caracteristicas_ml(id);
alter table bib_metricas add column if not exists referencia text;
alter table bib_metricas add column if not exists equipamento_id text references equipamentos_medicao(id);
alter table bib_metricas add column if not exists quem_mede_id text references quem_mede(id);
alter table bib_metricas drop column if exists metodo;
alter table bib_metricas drop column if exists periodicidade;
alter table bib_metricas drop column if exists nome;
create index if not exists bib_metricas_peca_idx on bib_metricas (peca_id);

-- ------------------------------------------- demais tabelas (inalteradas) ----
create table if not exists bib_pontos_inspecao (
  id text primary key default gen_random_uuid()::text,
  peca_id text references bib_pecas(id) on delete cascade,
  descricao text not null,
  criticidade text, metodo text, periodicidade text, equipamento text, foto text,
  ordem int default 0
);
create index if not exists bib_pontos_peca_idx on bib_pontos_inspecao (peca_id);

create table if not exists bib_documentos (
  id text primary key default gen_random_uuid()::text,
  peca_id text references bib_pecas(id) on delete cascade,
  nome text not null, categoria text, versao text, data date, responsavel text,
  descricao text, url text, tipo text, tamanho text
);
create index if not exists bib_documentos_peca_idx on bib_documentos (peca_id);

create table if not exists bib_historico (
  id text primary key default gen_random_uuid()::text,
  peca_id text references bib_pecas(id) on delete cascade,
  usuario text, quando timestamptz default now(),
  acao text, campo text, antes text, depois text, revisao int
);
create index if not exists bib_historico_peca_idx on bib_historico (peca_id);

create table if not exists bib_versoes (
  id text primary key default gen_random_uuid()::text,
  peca_id text references bib_pecas(id) on delete cascade,
  revisao int, snapshot jsonb, usuario text, quando timestamptz default now(), resumo text
);
create index if not exists bib_versoes_peca_idx on bib_versoes (peca_id);

create table if not exists bib_favoritos (
  id text primary key default gen_random_uuid()::text,
  peca_id text references bib_pecas(id) on delete cascade,
  usuario text not null,
  quando timestamptz default now(),
  unique (peca_id, usuario)
);

-- =============================================================================
-- RLS — leitura para autenticados; escrita para admin/supervisor;
--        histórico/versões nunca deletados; favoritos são do próprio usuário.
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'bib_pecas','bib_metricas','bib_pontos_inspecao','bib_documentos',
    'bib_historico','bib_versoes','bib_favoritos',
    'bib_clientes','bib_plantas','bib_familias','bib_quadrantes',
    'caracteristicas_ml','equipamentos_medicao','quem_mede'] loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "bib_read_%1$s" on %1$s;', t);
    execute format('create policy "bib_read_%1$s" on %1$s for select to authenticated using (true);', t);
  end loop;
end $$;

-- Escrita (all) para admin e supervisor nas tabelas de conteúdo e catálogos.
-- (Característica/Equipamento/Quem Mede também podem ser criados na tela — mesma regra.)
do $$
declare t text;
begin
  foreach t in array array[
    'bib_pecas','bib_metricas','bib_pontos_inspecao','bib_documentos',
    'bib_clientes','bib_plantas','bib_familias','bib_quadrantes',
    'caracteristicas_ml','equipamentos_medicao','quem_mede'] loop
    execute format('drop policy if exists "bib_write_%1$s" on %1$s;', t);
    execute format($f$create policy "bib_write_%1$s" on %1$s for all to authenticated
      using (current_perfil() in ('admin','supervisor'))
      with check (current_perfil() in ('admin','supervisor'));$f$, t);
  end loop;
end $$;

-- Histórico e versões: qualquer autenticado insere; NINGUÉM deleta (append-only).
do $$
declare t text;
begin
  foreach t in array array['bib_historico','bib_versoes'] loop
    execute format('drop policy if exists "bib_append_%1$s" on %1$s;', t);
    execute format('create policy "bib_append_%1$s" on %1$s for insert to authenticated with check (true);', t);
  end loop;
end $$;

drop policy if exists "bib_fav_own" on bib_favoritos;
create policy "bib_fav_own" on bib_favoritos for all to authenticated
  using (usuario in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email()))
  with check (usuario in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email()));

-- =============================================================================
-- SEED — catálogos + peças + especificações de exemplo (idempotente)
-- =============================================================================
insert into bib_clientes (nome) values ('Volvo'),('Scania'),('Mercedes-Benz'),('Volkswagen'),('Ford'),('Randon'),('DAF'),('Iveco') on conflict do nothing;
insert into bib_plantas (nome) values ('Planta Jarinu'),('Planta Rio Nova Iguaçu'),('Planta SP 01'),('Planta SP 02') on conflict do nothing;
insert into bib_familias (nome) values ('Feixe de Molas'),('Mola Parabólica'),('Mola Helicoidal'),('Lâmina'),('Grampo'),('Barra Estabilizadora'),('Tirante') on conflict do nothing;

-- QUEM MEDE (inicial)
insert into quem_mede (nome) values ('G. DA QUALIDADE'),('ENG. DE PROCESSO'),('LABORATÓRIO'),('TODOS') on conflict (nome) do nothing;

-- EQUIPAMENTO DE MEDIÇÃO (do documento de referência)
insert into equipamentos_medicao (nome)
select unnest(array['Visual','Paquímetro','Micrômetro','Trena','Traçador de Altura','Máquina de Carga','Braço Faro',
  'Durômetro','Rugosímetro','Goniômetro','Torquímetro','Espectrômetro (certificado)','Laboratório / Certificado',
  'Certificado','Marcação','Gravação a quente','Embuchadeira','Calibrador de Raio','Calibrador de Folga','OK/NOK'])
on conflict (nome) do nothing;

-- CARACTERÍSTICAS ML (lista base do documento de referência)
insert into caracteristicas_ml (nome)
select unnest(array[
  'Abertura','Altura','Altura Livre','Altura Livre Feixe Principal','Altura Livre Feixe Auxiliar','Altura da braçadeira',
  'Altura da cabeça do espigão','Altura da carga de Checagem','Altura do Gancho','Altura do Pacote','Altura do Pacote do Feixe Principal',
  'Altura do Pacote do Feixe Auxiliar','Altura do contra feixe (feixe auxiliar)','Altura do contra feixe Lado Y','Altura do Ressalto',
  'Altura do Rebaixo','Altura na Carga de GVW (normal)','Altura na Carga de Vazio','Ângulo','Carbono (C)','Carga de extração da Bucha',
  'Carga na altura de Checagem','Carga na altura de Design (carga normal ou GVW)','Carga na altura de Jounce','Carga na altura de Rebound',
  'Circularidade','Classe do Material','Cobertura (Shot Peening)','Código do fornecedor','Composição Química','Comprimento',
  'Comprimento Total nos apoios','Comprimento da parte plana','Comprimento do Chanfro','Comprimento do Laminado','Comprimento sobre carga',
  'Comprimento do Ressalto','Comprimento do Rebaixo','Concentricidade','Descarbonetação','Descarbonetação Parcial','Descarbonetação Total',
  'Desfolhamento','Deslocamento','Detalhe do Chanfro (desponte)','Detalhe do Laminado','Detalhe do Olhete','Distância','Distância entre Centro',
  'Distância até o centro do olhete','Dureza','Espalhamento lateral','Espessura','Espessura da ponta','Esquadro','Esquadro e Torção',
  'Forma e posição','Fósforo (P)','Gráfico e Tabela de Cargas e Alturas','Identificação','Identificação de altura','Identificação part number',
  'Identificação logo marca do cliente','Identificação logo marca do fabricante','Largura','Largura da lâmina','Largura da Bucha',
  'Largura do chanfro','Largura do Olhete','Largura do cordão de solda','Logomarca','Manganês (Mn)','Matéria Prima',
  'Microestrutura - Martensita temperada','Mínima redução de área','Mínimo alongamento após fratura','Montagem','Névoa salina',
  'Oblongo (altura)','Oblongo (comprimento)','Observações','ØDiâmetro do furo','ØDiâmetro da cabeça do espigão','ØDiâmetro interno da bucha',
  'ØDiâmetro externo da bucha','ØDiâmetro interno do olhete','ØDiâmetro externo do olhete','Paralelismo','Paralelo','Perpendicularidade',
  'Pintar após montagem','Planicidade','Processo de Soldagem','Propriedades Mecânicas','Proteção Superficial','Raio','Rate K1','Rate K2',
  'Rate Kt','Resistência a corrosão com Salt Spray 5%','Retilineidade','Revisão de desenho','Rugosidade','Semi-comprimento',
  'Semi-comprimento sobre carga','Silício (Si)','Simetria','Enxofre (S)','Tabela de Carga/Altura/Rate','Tamanho de Grão',
  'Tensão mínima de escoamento','Tensão mínima de tração (ruptura)','Tensão Residual','Teste Almen (Shot Peening)','Teste de Fadiga',
  'Torção','Torque','Tratamento superficial','Vanádio (V)','Vista'])
on conflict (nome) do nothing;

-- PEÇAS de exemplo
insert into bib_pecas (id, codigo, nome, cliente, familia, quadrante, peso, material, acabamento, cor, status, planta, norma, especificacao,
  revisao_desenho, data_revisao_desenho, numero_ad, revisao, observacoes, ativo)
values
 ('bp01','RCE-001','Feixe de Mola Traseiro','Volvo','Feixe de Molas',null,'62,4 kg','SAE 5160H','Pintura eletrostática','Preto','Ativo','Planta Jarinu','ABNT NBR 6329','ET-RCE-001 Rev.C',3,'2026-05-18','AD-2026-0158',3,'Conferir torque dos grampos em U conforme PC-001.',true),
 ('bp02','RCE-014','Mola Parabólica Dianteira','Scania','Mola Parabólica',null,'28,1 kg','SAE 51B60','Shot peening + pintura','Cinza grafite','Ativo','Planta Jarinu','DIN 17221','ET-RCE-014 Rev.B',2,'2026-04-30','AD-2026-0092',2,'Dureza pós-têmpera crítica.',true),
 ('bp03','LM-206','Lâmina Principal 2ª','Mercedes-Benz','Lâmina',null,'11,7 kg','SAE 5160','Jateado','Natural','Em revisão','Planta Rio Nova Iguaçu','ABNT NBR 6329','ET-LM-206 Rev.A',1,'2026-06-22','AD-2026-0203',1,'Validar novo raio de dobra.',true),
 ('bp04','GR-330','Grampo em U M20','Randon','Grampo',null,'3,2 kg','SAE 1045','Zincado','Prata','Ativo','Planta SP 01','ISO 898-1','ET-GR-330 Rev.D',4,'2026-03-14','AD-2025-0451',4,'Torque 320 N·m ±5%.',true),
 ('bp05','HC-118','Mola Helicoidal Traseira','Volkswagen','Mola Helicoidal',null,'4,8 kg','SAE 9254','Pintura epóxi','Preto fosco','Ativo','Planta SP 02','SAE J157','ET-HC-118 Rev.A',1,'2026-02-05','AD-2026-0031',1,'',true),
 ('bp06','BE-402','Barra Estabilizadora Dianteira','Ford','Barra Estabilizadora',null,'9,6 kg','SAE 26MnB5','Fosfatizado + pintura','Preto','Arquivado','Planta Jarinu','ASTM A513','ET-BE-402 Rev.B',2,'2025-10-19','AD-2025-0288',2,'Substituída pela BE-410.',false)
on conflict (id) do nothing;

-- ESPECIFICAÇÕES — remove as de exemplo e reinsere no novo formato (não afeta peças reais)
delete from bib_metricas where peca_id in ('bp01','bp02','bp03','bp04','bp05','bp06');
insert into bib_metricas (peca_id, cota, caracteristica_id, referencia, nominal, tol_min, tol_max, unidade, equipamento_id, quem_mede_id, observacao, ordem)
values
 ('bp01',1,(select id from caracteristicas_ml where nome='Comprimento Total nos apoios'),'Vista A',1520,1518,1522,'mm',(select id from equipamentos_medicao where nome='Trena'),(select id from quem_mede where nome='G. DA QUALIDADE'),'',1),
 ('bp01',2,(select id from caracteristicas_ml where nome='Largura da lâmina'),'Vista B',90,89.5,90.5,'mm',(select id from equipamentos_medicao where nome='Paquímetro'),(select id from quem_mede where nome='G. DA QUALIDADE'),'',2),
 ('bp01',3,(select id from caracteristicas_ml where nome='Espessura'),'Detalhe A',16,15.8,16.2,'mm',(select id from equipamentos_medicao where nome='Micrômetro'),(select id from quem_mede where nome='G. DA QUALIDADE'),'',3),
 ('bp01',4,(select id from caracteristicas_ml where nome='Altura Livre'),'Vista C',205,206,210,'mm',(select id from equipamentos_medicao where nome='Trena'),(select id from quem_mede where nome='ENG. DE PROCESSO'),'Sob carga zero',4),
 ('bp01',5,(select id from caracteristicas_ml where nome='Dureza'),'—',44,42,48,'HRC',(select id from equipamentos_medicao where nome='Durômetro'),(select id from quem_mede where nome='LABORATÓRIO'),'',5),
 ('bp02',1,(select id from caracteristicas_ml where nome='Comprimento'),'Vista A',1360,1357,1363,'mm',(select id from equipamentos_medicao where nome='Trena'),(select id from quem_mede where nome='G. DA QUALIDADE'),'',1),
 ('bp02',2,(select id from caracteristicas_ml where nome='Espessura'),'Vista B',22,21.7,22.3,'mm',(select id from equipamentos_medicao where nome='Micrômetro'),(select id from quem_mede where nome='G. DA QUALIDADE'),'',2),
 ('bp02',3,(select id from caracteristicas_ml where nome='Dureza'),'—',46,44,50,'HRC',(select id from equipamentos_medicao where nome='Durômetro'),(select id from quem_mede where nome='LABORATÓRIO'),'Característica crítica',3),
 ('bp03',1,(select id from caracteristicas_ml where nome='Comprimento'),'Vista A',1180,1178,1182,'mm',(select id from equipamentos_medicao where nome='Trena'),(select id from quem_mede where nome='G. DA QUALIDADE'),'',1),
 ('bp03',2,(select id from caracteristicas_ml where nome='Largura'),'Vista B',90,89.5,90.5,'mm',(select id from equipamentos_medicao where nome='Paquímetro'),(select id from quem_mede where nome='G. DA QUALIDADE'),'',2),
 ('bp03',3,(select id from caracteristicas_ml where nome='ØDiâmetro do furo'),'Detalhe A',16,16,16.2,'mm',(select id from equipamentos_medicao where nome='Micrômetro'),(select id from quem_mede where nome='G. DA QUALIDADE'),'',3),
 ('bp04',1,(select id from caracteristicas_ml where nome='Comprimento'),'Vista A',104,103,105,'mm',(select id from equipamentos_medicao where nome='Paquímetro'),(select id from quem_mede where nome='G. DA QUALIDADE'),'Abertura interna',1),
 ('bp04',2,(select id from caracteristicas_ml where nome='Ângulo'),'Vista B',90,89,91,'°',(select id from equipamentos_medicao where nome='Goniômetro'),(select id from quem_mede where nome='ENG. DE PROCESSO'),'',2),
 ('bp05',1,(select id from caracteristicas_ml where nome='Altura Livre'),'Vista A',385,382,388,'mm',(select id from equipamentos_medicao where nome='Trena'),(select id from quem_mede where nome='ENG. DE PROCESSO'),'',1),
 ('bp05',2,(select id from caracteristicas_ml where nome='Rate K1'),'—',34,32,36,'N/mm',(select id from equipamentos_medicao where nome='Máquina de Carga'),(select id from quem_mede where nome='ENG. DE PROCESSO'),'',2),
 ('bp06',1,(select id from caracteristicas_ml where nome='Comprimento'),'Vista A',1240,1237,1243,'mm',(select id from equipamentos_medicao where nome='Trena'),(select id from quem_mede where nome='G. DA QUALIDADE'),'',1);

-- =============================================================================
-- Storage: crie manualmente no painel um bucket público "biblioteca".
--   insert into storage.buckets (id, name, public) values ('biblioteca','biblioteca', true) on conflict do nothing;
-- =============================================================================
