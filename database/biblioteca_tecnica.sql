-- =============================================================================
-- RNA One — Módulo Biblioteca Técnica
-- Rassini NHK Automotive · Esquema + RLS + seed (PostgreSQL / Supabase)
-- -----------------------------------------------------------------------------
-- Execute no SQL Editor do Supabase APÓS schema.sql e rls.sql
-- (depende do helper current_perfil() definido em rls.sql).
-- Depois, no painel Storage, crie um bucket público chamado "biblioteca".
-- =============================================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------- CATÁLOGOS -----
create table if not exists bib_clientes   ( id text primary key default gen_random_uuid()::text, nome text not null, ativo boolean default true );
create table if not exists bib_plantas    ( id text primary key default gen_random_uuid()::text, nome text not null, ativo boolean default true );
create table if not exists bib_familias   ( id text primary key default gen_random_uuid()::text, nome text not null, ativo boolean default true );
create table if not exists bib_categorias ( id text primary key default gen_random_uuid()::text, nome text not null, ativo boolean default true );
create table if not exists bib_processos  ( id text primary key default gen_random_uuid()::text, nome text not null, ativo boolean default true );
create table if not exists bib_tipos      ( id text primary key default gen_random_uuid()::text, nome text not null, ativo boolean default true );

-- --------------------------------------------------------------- PEÇAS -------
create table if not exists bib_pecas (
  id text primary key default gen_random_uuid()::text,
  codigo text not null,
  nome text not null,
  descricao text,
  cliente text, familia text, linha text, processo text, tipo text,
  aplicacao text, categoria text, peso text, material text, acabamento text, cor text,
  status text default 'Ativo',
  planta text, fornecedor text, norma text, especificacao text, responsavel text,
  data_revisao date,
  revisao int default 1,
  observacoes text,
  imagem text,
  galeria jsonb default '[]',
  ativo boolean default true,
  created_at date default now(),
  updated_at date default now(),
  created_by text
);
create unique index if not exists bib_pecas_codigo_uidx on bib_pecas (lower(codigo));
create index if not exists bib_pecas_cliente_idx on bib_pecas (cliente);
create index if not exists bib_pecas_familia_idx on bib_pecas (familia);
create index if not exists bib_pecas_status_idx  on bib_pecas (status);

-- ------------------------------------------------------------- MÉTRICAS ------
create table if not exists bib_metricas (
  id text primary key default gen_random_uuid()::text,
  peca_id text references bib_pecas(id) on delete cascade,
  nome text not null,
  nominal numeric, tol_min numeric, tol_max numeric,
  unidade text, metodo text, equipamento text, periodicidade text, observacao text,
  ordem int default 0
);
create index if not exists bib_metricas_peca_idx on bib_metricas (peca_id);

-- -------------------------------------------------------- PONTOS INSPEÇÃO -----
create table if not exists bib_pontos_inspecao (
  id text primary key default gen_random_uuid()::text,
  peca_id text references bib_pecas(id) on delete cascade,
  descricao text not null,
  criticidade text, metodo text, periodicidade text, equipamento text, foto text,
  ordem int default 0
);
create index if not exists bib_pontos_peca_idx on bib_pontos_inspecao (peca_id);

-- ------------------------------------------------------------ DOCUMENTOS -----
create table if not exists bib_documentos (
  id text primary key default gen_random_uuid()::text,
  peca_id text references bib_pecas(id) on delete cascade,
  nome text not null, categoria text, versao text, data date, responsavel text,
  descricao text, url text, tipo text, tamanho text
);
create index if not exists bib_documentos_peca_idx on bib_documentos (peca_id);

-- --------------------------------------------------- HISTÓRICO (append-only) --
create table if not exists bib_historico (
  id text primary key default gen_random_uuid()::text,
  peca_id text references bib_pecas(id) on delete cascade,
  usuario text, quando timestamptz default now(),
  acao text, campo text, antes text, depois text, revisao int
);
create index if not exists bib_historico_peca_idx on bib_historico (peca_id);

-- ---------------------------------------------------------- VERSÕES (snap) ---
create table if not exists bib_versoes (
  id text primary key default gen_random_uuid()::text,
  peca_id text references bib_pecas(id) on delete cascade,
  revisao int, snapshot jsonb, usuario text, quando timestamptz default now(), resumo text
);
create index if not exists bib_versoes_peca_idx on bib_versoes (peca_id);

-- -------------------------------------------------------------- FAVORITOS -----
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
-- (Reutiliza current_perfil() de rls.sql.)
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'bib_pecas','bib_metricas','bib_pontos_inspecao','bib_documentos',
    'bib_historico','bib_versoes','bib_favoritos',
    'bib_clientes','bib_plantas','bib_familias','bib_categorias','bib_processos','bib_tipos'] loop
    execute format('alter table %I enable row level security;', t);
    -- leitura: qualquer autenticado
    execute format('drop policy if exists "bib_read_%1$s" on %1$s;', t);
    execute format('create policy "bib_read_%1$s" on %1$s for select to authenticated using (true);', t);
  end loop;
end $$;

-- Escrita (insert/update/delete) para admin e supervisor nas tabelas de conteúdo
do $$
declare t text;
begin
  foreach t in array array[
    'bib_pecas','bib_metricas','bib_pontos_inspecao','bib_documentos',
    'bib_clientes','bib_plantas','bib_familias','bib_categorias','bib_processos','bib_tipos'] loop
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

-- Favoritos: cada usuário gerencia os seus (usuario = id do próprio na tabela usuarios)
drop policy if exists "bib_fav_own" on bib_favoritos;
create policy "bib_fav_own" on bib_favoritos for all to authenticated
  using (usuario in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email()))
  with check (usuario in (select id::text from usuarios where auth_id = auth.uid() or lower(email) = auth_email()));

-- =============================================================================
-- SEED — catálogos e peças de exemplo (idempotente por código/nome)
-- =============================================================================
insert into bib_clientes (nome) values ('Volvo'),('Scania'),('Mercedes-Benz'),('Volkswagen'),('Ford'),('Randon'),('DAF'),('Iveco')
  on conflict do nothing;
insert into bib_plantas (nome) values ('Planta Jarinu'),('Planta Rio Nova Iguaçu'),('Planta SP 01'),('Planta SP 02')
  on conflict do nothing;
insert into bib_familias (nome) values ('Feixe de Molas'),('Mola Parabólica'),('Mola Helicoidal'),('Lâmina'),('Grampo'),('Barra Estabilizadora'),('Tirante')
  on conflict do nothing;
insert into bib_categorias (nome) values ('Suspensão'),('Estrutural'),('Fixação'),('Funcional') on conflict do nothing;
insert into bib_processos (nome) values ('Estampagem'),('Tratamento Térmico'),('Usinagem'),('Montagem'),('Pintura'),('Jateamento (Shot Peening)') on conflict do nothing;
insert into bib_tipos (nome) values ('Componente'),('Conjunto'),('Submontagem') on conflict do nothing;

-- Peça exemplo com métrica FORA de tolerância (Flecha livre) para demonstrar o alerta.
insert into bib_pecas (id, codigo, nome, descricao, cliente, familia, linha, processo, tipo, aplicacao, categoria,
  peso, material, acabamento, cor, status, planta, fornecedor, norma, especificacao, responsavel, data_revisao, revisao, observacoes, ativo)
values
 ('bp01','RCE-001','Feixe de Mola Traseiro','Feixe de molas parabólico traseiro, 3 lâminas, olhal fechado.','Volvo','Feixe de Molas','Linha 02 — Feixes','Montagem','Conjunto','Eixo traseiro — Volvo FH','Suspensão','62,4 kg','SAE 5160H','Pintura eletrostática','Preto','Ativo','Planta Jarinu','Aço Villares','ABNT NBR 6329','ET-RCE-001 Rev.C','Ana Beatriz','2026-05-18',3,'Conferir torque dos grampos em U conforme PC-001.',true),
 ('bp02','RCE-014','Mola Parabólica Dianteira','Mola parabólica dianteira de 2 lâminas.','Scania','Mola Parabólica','Linha 02 — Feixes','Tratamento Térmico','Componente','Eixo dianteiro — Scania R450','Suspensão','28,1 kg','SAE 51B60','Shot peening + pintura','Cinza grafite','Ativo','Planta Jarinu','Gerdau','DIN 17221','ET-RCE-014 Rev.B','Carlos Mendes','2026-04-30',2,'Dureza pós-têmpera crítica.',true),
 ('bp03','LM-206','Lâmina Principal 2ª','Lâmina principal (2ª posição) do feixe traseiro.','Mercedes-Benz','Lâmina','Linha 01 — Molas','Estampagem','Componente','Feixe traseiro — MB Axor','Estrutural','11,7 kg','SAE 5160','Jateado','Natural','Em revisão','Planta Rio Nova Iguaçu','ArcelorMittal','ABNT NBR 6329','ET-LM-206 Rev.A','Ana Beatriz','2026-06-22',1,'Validar novo raio de dobra.',true),
 ('bp04','GR-330','Grampo em U M20','Grampo em U rosca M20 com porcas e arruelas.','Randon','Grampo','Linha 04 — Usinagem CNC','Usinagem','Submontagem','Fixação de feixe — Randon','Fixação','3,2 kg','SAE 1045','Zincado','Prata','Ativo','Planta SP 01','Ciser','ISO 898-1','ET-GR-330 Rev.D','Carlos Mendes','2026-03-14',4,'Torque 320 N·m ±5%.',true),
 ('bp05','HC-118','Mola Helicoidal Traseira','Mola helicoidal de compressão traseira.','Volkswagen','Mola Helicoidal','Linha 03 — Têmpera','Tratamento Térmico','Componente','Suspensão traseira — VW Delivery','Suspensão','4,8 kg','SAE 9254','Pintura epóxi','Preto fosco','Ativo','Planta SP 02','Gerdau','SAE J157','ET-HC-118 Rev.A','Ana Beatriz','2026-02-05',1,'',true),
 ('bp06','BE-402','Barra Estabilizadora Dianteira','Barra estabilizadora tubular dianteira.','Ford','Barra Estabilizadora','Linha 04 — Usinagem CNC','Usinagem','Conjunto','Eixo dianteiro — Ford Cargo','Estrutural','9,6 kg','SAE 26MnB5','Fosfatizado + pintura','Preto','Arquivado','Planta Jarinu','Vallourec','ASTM A513','ET-BE-402 Rev.B','Carlos Mendes','2025-10-19',2,'Substituída pela BE-410.',false)
on conflict (id) do nothing;

insert into bib_metricas (peca_id, nome, nominal, tol_min, tol_max, unidade, metodo, equipamento, periodicidade, ordem) values
 ('bp01','Comprimento total',1520,1518,1522,'mm','Medição direta','Trena calibrada','Amostral',1),
 ('bp01','Largura da lâmina',90,89.5,90.5,'mm','Medição direta','Paquímetro','Por peça',2),
 ('bp01','Espessura da lâmina',16,15.8,16.2,'mm','Medição direta','Micrômetro','Por peça',3),
 ('bp01','Flecha livre',205,206,210,'mm','Dispositivo','Gabarito de flecha','Amostral',4),
 ('bp01','Dureza',44,42,48,'HRC','Ensaio','Durômetro Rockwell','Amostral',5),
 ('bp02','Comprimento total',1360,1357,1363,'mm','Medição direta','Trena calibrada','Amostral',1),
 ('bp02','Espessura no centro',22,21.7,22.3,'mm','Medição direta','Micrômetro','Por peça',2),
 ('bp02','Dureza pós-têmpera',46,44,50,'HRC','Ensaio','Durômetro Rockwell','Por hora',3),
 ('bp03','Comprimento',1180,1178,1182,'mm','Medição direta','Trena calibrada','Amostral',1),
 ('bp03','Largura',90,89.5,90.5,'mm','Medição direta','Paquímetro','Por peça',2),
 ('bp03','Diâmetro do furo',16,16,16.2,'mm','Medição direta','Pino passa/não-passa','Por peça',3),
 ('bp04','Rosca',20,19.8,20,'mm','Calibrador','Calibrador de rosca','Setup',1),
 ('bp04','Abertura interna',104,103,105,'mm','Medição direta','Paquímetro','Por peça',2),
 ('bp05','Diâmetro do fio',12.5,12.3,12.7,'mm','Medição direta','Micrômetro','Por peça',1),
 ('bp05','Altura livre',385,382,388,'mm','Dispositivo','Gabarito','Amostral',2),
 ('bp05','Constante elástica',34,32,36,'N/mm','Ensaio','Máquina universal','Amostral',3),
 ('bp06','Diâmetro externo',32,31.7,32.3,'mm','Medição direta','Paquímetro','Por peça',1),
 ('bp06','Comprimento',1240,1237,1243,'mm','Medição direta','Trena calibrada','Amostral',2);

insert into bib_pontos_inspecao (peca_id, descricao, criticidade, metodo, periodicidade, equipamento, ordem) values
 ('bp01','Verificar trincas nas lâminas','100%','Partícula magnética','Por peça','Yoke magnético',1),
 ('bp01','Verificar pintura e cobertura','Visual','Inspeção visual','Por peça','—',2),
 ('bp01','Verificar empenamento','Alta','Régua / gabarito','Amostral','Régua de aço',3),
 ('bp02','Verificar dureza superficial','Crítico','Durômetro','Por hora','Durômetro',1),
 ('bp02','Verificar descarbonetação','Alta','Metalografia','Amostral','Microscópio',2),
 ('bp03','Verificar raio de dobra','Alta','Gabarito','Por peça','Gabarito de raio',1),
 ('bp04','Verificar rosca (passa/não-passa)','100%','Calibrador','Por peça','Calibrador de rosca',1),
 ('bp05','Verificar acamamento (sag)','Média','Ensaio de carga','Amostral','Máquina universal',1),
 ('bp06','Verificar solda das abraçadeiras','Alta','Inspeção visual + LP','Por peça','Líquido penetrante',1);

insert into bib_documentos (peca_id, nome, categoria, versao, data, responsavel, descricao, tipo, tamanho) values
 ('bp01','Desenho RCE-001 Rev.C','Desenho','C','2026-05-18','Ana Beatriz','Desenho técnico do feixe traseiro.','pdf','820 KB'),
 ('bp01','Plano de Controle PC-001','Plano de Controle','2','2026-05-18','Carlos Mendes','Plano de controle dimensional.','xlsx','44 KB'),
 ('bp02','Especificação ET-RCE-014','Especificação','B','2026-04-30','Carlos Mendes','Especificação de material e têmpera.','pdf','610 KB'),
 ('bp04','Norma ISO 898-1','Norma','—','2025-09-01','Ana Beatriz','Propriedades mecânicas de fixadores.','pdf','1,2 MB');

-- =============================================================================
-- Storage: crie manualmente no painel um bucket público "biblioteca".
-- Política sugerida (leitura pública, escrita autenticada):
--   insert into storage.buckets (id, name, public) values ('biblioteca','biblioteca', true) on conflict do nothing;
-- =============================================================================
