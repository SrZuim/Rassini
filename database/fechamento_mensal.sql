-- =============================================================================
-- RNA One — FECHAMENTO MENSAL (Qualidade · Planta RJ)
-- Rassini NHK Automotive · Esquema + RLS + funções + seed de catálogos
-- -----------------------------------------------------------------------------
-- Execute no SQL Editor do Supabase APÓS: schema.sql, rls.sql, fix_auth_usuarios.sql,
-- biblioteca_tecnica.sql e auditorias_dimensional.sql.
-- Usa os helpers current_perfil() / auth_email() já definidos em rls.sql.
-- IDEMPOTENTE: pode ser executado mais de uma vez sem perder dados.
--
-- NOMENCLATURA — o requisito sugere nomes em inglês (monthly_closings, ...).
-- Adotamos o prefixo `fm_` para seguir a convenção JÁ EXISTENTE do banco
-- (insp_*, op_*, bib_*). O mapeamento 1:1 com os nomes sugeridos é:
--
--   monthly_closings                → fm_competencias
--   monthly_closing_sections        → fm_secoes
--   monthly_closing_status_history  → fm_status_hist
--   quality_complaints              → fm_reclamacoes
--   quality_internal_occurrences    → fm_ocorrencias
--   quality_production              → fm_producao
--   quality_customer_supply         → fm_fornecimento
--   quality_indicator_criteria      → fm_criterios
--   quality_indicator_targets       → fm_metas
--   quality_indicator_results       → fm_resultados
--   quality_costs                   → fm_custos
--   quality_rework                  → fm_retrabalho
--   quality_scrap                   → fm_sucata
--   quality_care_inspections        → fm_care
--   quality_breaks                  → fm_quebras
--   quality_safety_events           → fm_seguranca
--   quality_action_plans            → fm_acoes
--   quality_action_updates          → fm_acao_updates
--   quality_pending_items           → fm_pendencias
--   quality_imports                 → fm_importacoes
--   quality_import_rows             → fm_import_linhas
--   quality_import_versions         → fm_import_versoes
--   quality_customer_aliases        → fm_clientes_alias
--   quality_presentation_templates  → fm_apres_templates
--   quality_presentation_sections   → fm_apres_secoes
--   quality_presentation_versions   → fm_apres_versoes
--   quality_generated_files         → fm_arquivos
--   quality_calculation_memory      → fm_memoria
--   quality_change_logs             → fm_logs
--
-- Tabelas adicionais exigidas pelo requisito e sem equivalente na lista:
--   fm_cruz_dias   (§16 Cruz da Qualidade — status/observação por dia)
--   fm_config      (§16/§19/§20/§36 — regras configuráveis por planta)
--   fm_ajustes     (§30 — solicitação de ajuste de campo calculado)
--
-- FUSO (§19-20): toda coluna de INSTANTE é `timestamptz` (gravada em UTC) e toda
-- coluna de DATA CIVIL é `date` (sem fuso — não sofre ±1 dia). Nunca use
-- `now()::date` para "hoje": use fm_hoje(), que resolve em America/Sao_Paulo.
-- =============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- 0. HELPERS
-- ============================================================================

-- Data civil de HOJE no fuso oficial da operação (§19).
create or replace function fm_hoje() returns date as $$
  select (now() at time zone 'America/Sao_Paulo')::date;
$$ language sql stable;

-- Competência canônica "MM/AAAA" a partir de mês/ano.
create or replace function fm_competencia_label(p_mes int, p_ano int) returns text as $$
  select lpad(p_mes::text, 2, '0') || '/' || p_ano::text;
$$ language sql immutable;

-- id do usuário autenticado na tabela `usuarios` (texto, para casar com as FKs).
create or replace function fm_user_id() returns text as $$
  select id::text from usuarios
  where auth_id = auth.uid() or lower(email) = auth_email()
  limit 1;
$$ language sql stable security definer;

-- Perfis que administram o módulo (configuram metas, critérios, slides, reabrem).
create or replace function fm_is_admin() returns boolean as $$
  select coalesce(current_perfil() = 'admin', false);
$$ language sql stable;

-- Gestor da Qualidade — no RBAC do RNA One corresponde ao perfil `supervisor`
-- (revisa, devolve, aprova e conclui o fechamento). Não criamos um perfil novo:
-- o requisito §43 é atendido mapeando papéis do fechamento sobre os perfis
-- existentes (admin / supervisor / auditor+cargos / visitante).
create or replace function fm_is_gestor() returns boolean as $$
  select coalesce(current_perfil() in ('admin','supervisor'), false);
$$ language sql stable;

-- Responsável de área / auditor — pode lançar dados nas seções operacionais.
create or replace function fm_is_operacional() returns boolean as $$
  select coalesce(current_perfil() in
    ('admin','supervisor','auditor','auditor_recebimento','eng_processos','laboratorio'), false);
$$ language sql stable;

-- §44.1 — Usuário só acessa plantas autorizadas.
-- Regra: admin e supervisor enxergam todas as plantas; os demais enxergam a
-- planta do próprio cadastro. Usuário sem planta definida NÃO é liberado para
-- tudo (fail-closed): fica restrito ao que não tem planta.
create or replace function fm_planta_autorizada(p_planta text) returns boolean as $$
  select case
    when fm_is_gestor() then true
    when p_planta is null then true
    else exists (
      select 1 from usuarios u
      where (u.auth_id = auth.uid() or lower(u.email) = auth_email())
        and u.planta is not distinct from p_planta)
  end;
$$ language sql stable security definer;

-- Toca updated_at em qualquer tabela do módulo.
create or replace function fm_touch() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end $$ language plpgsql;

-- ============================================================================
-- 1. COMPETÊNCIAS (§3, §4)
-- ============================================================================
create table if not exists fm_competencias (
  id            text primary key default gen_random_uuid()::text,
  planta        text not null,
  mes           int  not null check (mes between 1 and 12),
  ano           int  not null check (ano between 2000 and 2100),
  competencia   text generated always as (lpad(mes::text,2,'0') || '/' || ano::text) stored,
  data_inicial  date,
  data_final    date,
  responsavel_id   text,
  responsavel      text,
  status        text not null default 'Não iniciado',
  percentual    numeric(5,2) not null default 0,
  versao        text not null default 'V0',
  observacoes   text,
  -- ciclo de vida
  criado_por_id text, criado_por text,
  aprovado_por_id text, aprovado_por text, aprovado_em timestamptz,
  fechado_por_id  text, fechado_por  text, fechado_em  timestamptz,
  reaberto_em   timestamptz, reaberto_motivo text,
  cancelado_em  timestamptz, cancelado_motivo text,
  competencia_anterior_id text references fm_competencias(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz, deleted_by text,
  constraint fm_comp_status_ck check (status in (
    'Não iniciado','Em preenchimento','Aguardando informações','Em revisão',
    'Devolvido para correção','Aguardando aprovação','Aprovado','Fechado',
    'Reaberto','Cancelado'))
);
-- §3 — impede competência duplicada para a mesma planta.
create unique index if not exists fm_comp_unica_idx
  on fm_competencias (planta, mes, ano) where deleted_at is null;
create index if not exists fm_comp_status_idx on fm_competencias (status);
create index if not exists fm_comp_ano_idx    on fm_competencias (ano, mes);

drop trigger if exists fm_comp_touch on fm_competencias;
create trigger fm_comp_touch before update on fm_competencias
  for each row execute function fm_touch();

-- Seções da competência (§2) — progresso e responsável por área.
create table if not exists fm_secoes (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  secao   text not null,
  status  text not null default 'Não iniciado',
  percentual numeric(5,2) not null default 0,
  responsavel_id text, responsavel text,
  obrigatoria boolean not null default true,
  iniciada_em timestamptz, concluida_em timestamptz,
  observacao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (competencia_id, secao)
);
drop trigger if exists fm_secoes_touch on fm_secoes;
create trigger fm_secoes_touch before update on fm_secoes
  for each row execute function fm_touch();

-- Histórico de status (§42, §45)
create table if not exists fm_status_hist (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  status_anterior text, status_novo text not null,
  acao text, comentario text,
  usuario_id text, usuario text,
  quando timestamptz not null default now()
);
create index if not exists fm_status_hist_comp_idx on fm_status_hist (competencia_id, quando desc);

-- ============================================================================
-- 2. TRAVA DE COMPETÊNCIA FECHADA (§15, §44.5)
--    Aplicada por TRIGGER — não depende da interface nem do serviço JS.
-- ============================================================================
create or replace function fm_competencia_editavel(p_comp_id text) returns boolean as $$
  select coalesce(
    (select status not in ('Fechado','Cancelado') from fm_competencias where id = p_comp_id),
    true);   -- registro sem competência (catálogos) não é bloqueado aqui
$$ language sql stable security definer;

create or replace function fm_guard_fechada() returns trigger as $$
declare v_comp text; v_ret record;
begin
  -- NEW/OLD só existem conforme a operação: referenciar o outro levanta
  -- "record is not assigned yet". Por isso o ramo explícito por TG_OP.
  if tg_op = 'DELETE' then v_comp := old.competencia_id; v_ret := old;
  else                     v_comp := new.competencia_id; v_ret := new;
  end if;

  if v_comp is not null and not fm_competencia_editavel(v_comp) then
    -- admin pode corrigir competência fechada, mas o log registra (§46).
    if not fm_is_admin() then
      raise exception 'Competência fechada: registro somente leitura (%). Reabra a competência para editar.', v_comp
        using errcode = 'check_violation';
    end if;
  end if;
  return v_ret;
end $$ language plpgsql security definer;

-- ============================================================================
-- 3. INDICADORES EXTERNOS — RECLAMAÇÕES (§7)
-- ============================================================================
create table if not exists fm_reclamacoes (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  planta text,
  data_reclamacao date,
  cliente text, cliente_oficial text,
  codigo text,
  part_number text, produto text, tipo_produto text,
  qtd_reclamacoes int not null default 1 check (qtd_reclamacoes >= 0),
  qtd_pecas int not null default 0 check (qtd_pecas >= 0),
  descricao text, tipo_defeito text, classificacao text, origem_reclamacao text,
  responsavel_id text, responsavel text,
  data_abertura date, data_encerramento date,
  status text not null default 'Aberta',
  demerito boolean not null default true,
  oficial  boolean not null default true,
  negociada boolean not null default false,
  cliente_reposicao boolean not null default false,
  motivo_negociacao text, negociado_por text, data_negociacao date,
  observacoes text, evidencia_url text,
  -- §29 vínculo com o registro de origem
  source_module text, source_record_id text, source_type text,
  origem text not null default 'manual',
  created_at timestamptz not null default now(), created_by text, created_by_nome text,
  updated_at timestamptz not null default now(), updated_by text,
  deleted_at timestamptz, deleted_by text,
  constraint fm_recl_status_ck check (status in (
    'Aberta','Em contenção','Em análise','Em negociação','Aguardando cliente',
    'Aguardando evidência','Concluída','Cancelada')),
  constraint fm_recl_origem_ck check (origem in ('manual','importado','automatico','calculado'))
);
create index if not exists fm_recl_comp_idx    on fm_reclamacoes (competencia_id);
create index if not exists fm_recl_data_idx    on fm_reclamacoes (data_reclamacao);
create index if not exists fm_recl_cliente_idx on fm_reclamacoes (cliente_oficial);
create index if not exists fm_recl_pn_idx      on fm_reclamacoes (part_number);
create unique index if not exists fm_recl_codigo_idx
  on fm_reclamacoes (competencia_id, codigo) where codigo is not null and deleted_at is null;

-- ============================================================================
-- 4. INDICADORES INTERNOS — OCORRÊNCIAS (§12)
-- ============================================================================
create table if not exists fm_ocorrencias (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  data date, planta text, setor text, linha text, processo text, turno text,
  origem_ocorrencia text,
  cliente text, part_number text, produto text, tipo_produto text,
  tipo_defeito text, descricao text,
  qtd_pecas int not null default 0 check (qtd_pecas >= 0),
  peso numeric(14,3), valor_estimado numeric(14,2),
  ordem_producao text, lote text,
  detectado_por text, tratado_por text, classificacao text,
  rnc_id text, acao_id text,
  status text not null default 'Aberta',
  observacoes text, evidencia_url text,
  source_module text, source_record_id text, source_type text,
  origem text not null default 'manual',
  created_at timestamptz not null default now(), created_by text, created_by_nome text,
  updated_at timestamptz not null default now(), updated_by text,
  deleted_at timestamptz, deleted_by text,
  constraint fm_ocor_origem_ck check (origem in ('manual','importado','automatico','calculado'))
);
create index if not exists fm_ocor_comp_idx on fm_ocorrencias (competencia_id);
create index if not exists fm_ocor_data_idx on fm_ocorrencias (data);
create index if not exists fm_ocor_orig_idx on fm_ocorrencias (origem_ocorrencia);
create index if not exists fm_ocor_pn_idx   on fm_ocorrencias (part_number);
-- §29 — evita importar duas vezes o mesmo registro de origem.
create unique index if not exists fm_ocor_source_idx
  on fm_ocorrencias (source_module, source_record_id)
  where source_record_id is not null and deleted_at is null;

-- ============================================================================
-- 5. PRODUÇÃO (§14) e FORNECIMENTO (§8/§24)
-- ============================================================================
create table if not exists fm_producao (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  planta text, data date, linha text, processo text, turno text,
  part_number text, cliente text,
  qtd_fabricada int not null default 0 check (qtd_fabricada >= 0),
  qtd_aprovada  int not null default 0 check (qtd_aprovada  >= 0),
  qtd_ng        int not null default 0 check (qtd_ng        >= 0),
  fonte text not null default 'Lançamento manual',
  arquivo_origem text, importacao_id text,
  usuario_id text, usuario text, importado_em timestamptz,
  observacao text, justificativa text,
  origem text not null default 'manual',
  created_at timestamptz not null default now(), created_by text,
  updated_at timestamptz not null default now(), updated_by text,
  deleted_at timestamptz, deleted_by text,
  constraint fm_prod_fonte_ck check (fonte in ('Importação','Integração','Lançamento manual','Cálculo'))
);
-- §14 — chave anti-duplicidade.
create unique index if not exists fm_prod_unica_idx on fm_producao
  (competencia_id, planta, data, linha, turno, part_number, fonte)
  where deleted_at is null;
create index if not exists fm_prod_comp_idx on fm_producao (competencia_id);

-- Peças fornecidas por cliente (denominador do PPM externo) — §8.3
create table if not exists fm_fornecimento (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  planta text, cliente text, cliente_oficial text, part_number text,
  qtd_fornecida bigint not null default 0 check (qtd_fornecida >= 0),
  faturamento_real numeric(16,2), faturamento_orcado numeric(16,2),
  variacao numeric(16,2), toneladas numeric(16,3),
  preco_medio_kg numeric(16,4), preco_medio_peca numeric(16,4),
  acumulado_ano numeric(18,2),
  fonte text not null default 'Importação', importacao_id text, versao int default 1,
  origem text not null default 'importado',
  created_at timestamptz not null default now(), created_by text,
  updated_at timestamptz not null default now(), updated_by text,
  deleted_at timestamptz, deleted_by text
);
create unique index if not exists fm_forn_unica_idx on fm_fornecimento
  (competencia_id, cliente_oficial, coalesce(part_number,'—')) where deleted_at is null;
create index if not exists fm_forn_comp_idx on fm_fornecimento (competencia_id);

-- ============================================================================
-- 6. CRITÉRIOS, METAS, RESULTADOS (§13, §28, §31)
-- ============================================================================
create table if not exists fm_criterios (
  id text primary key default gen_random_uuid()::text,
  indicador text not null default 'ppm_interno',
  nome text not null, descricao text,
  vigencia_inicio date not null, vigencia_fim date,
  planta text,
  fontes_incluidas jsonb not null default '[]',
  fontes_excluidas jsonb not null default '[]',
  status text not null default 'Ativo',
  aprovado_por text, aprovado_em date, justificativa text,
  versao int not null default 1,
  created_at timestamptz not null default now(), created_by text,
  updated_at timestamptz not null default now(), updated_by text,
  deleted_at timestamptz, deleted_by text,
  constraint fm_crit_status_ck check (status in ('Ativo','Inativo','Rascunho'))
);
create index if not exists fm_crit_vig_idx on fm_criterios (indicador, planta, vigencia_inicio);

create table if not exists fm_metas (
  id text primary key default gen_random_uuid()::text,
  indicador text not null, planta text, cliente text, ano int,
  valor numeric(18,4), valor_max numeric(18,4),      -- valor_max: comparação "Faixa"
  unidade text, comparacao text not null default '<=',
  data_inicial date, data_final date,
  status text not null default 'Ativo', responsavel text,
  created_at timestamptz not null default now(), created_by text,
  updated_at timestamptz not null default now(), updated_by text,
  deleted_at timestamptz, deleted_by text,
  constraint fm_meta_comp_ck check (comparacao in ('<=','<','>=','>','=','faixa'))
);
create unique index if not exists fm_meta_unica_idx on fm_metas
  (indicador, coalesce(planta,'*'), coalesce(cliente,'*'), coalesce(ano,0))
  where deleted_at is null;

-- §28 — "Outros indicadores" (desempenho de entrega, satisfação, auditoria...).
create table if not exists fm_resultados (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  indicador text not null, cliente text,
  resultado numeric(18,4), meta numeric(18,4), unidade text,
  fonte text, responsavel text, comentario text, evidencia_url text,
  origem text not null default 'manual',
  created_at timestamptz not null default now(), created_by text,
  updated_at timestamptz not null default now(), updated_by text,
  deleted_at timestamptz, deleted_by text
);
create index if not exists fm_result_comp_idx on fm_resultados (competencia_id, indicador);

-- ============================================================================
-- 7. CUSTOS, RETRABALHO, SUCATA (§19, §20, §21)
-- ============================================================================
create table if not exists fm_custos (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  data date, planta text, centro_custo text, categoria text, descricao text,
  fornecedor text, cliente text, part_number text,
  quantidade numeric(16,3), valor numeric(16,2) not null default 0,
  moeda text not null default 'BRL', responsavel text, documento_fiscal text,
  ocorrencia_id text references fm_ocorrencias(id) on delete set null,
  quebra_id text, rnc_id text,
  observacao text, anexo_url text,
  origem text not null default 'manual',
  created_at timestamptz not null default now(), created_by text,
  updated_at timestamptz not null default now(), updated_by text,
  deleted_at timestamptz, deleted_by text
);
create index if not exists fm_custos_comp_idx on fm_custos (competencia_id, categoria);

create table if not exists fm_retrabalho (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  etapa text not null default 'Outro',
  processo text, setor text, part_number text,
  qtd_produzida int not null default 0 check (qtd_produzida >= 0),
  qtd_retrabalhada int not null default 0 check (qtd_retrabalhada >= 0),
  tipo_retrabalho text, motivo text, responsavel text,
  custo numeric(16,2), status text default 'Aberto', observacao text,
  origem text not null default 'manual',
  created_at timestamptz not null default now(), created_by text,
  updated_at timestamptz not null default now(), updated_by text,
  deleted_at timestamptz, deleted_by text,
  constraint fm_retr_etapa_ck check (etapa in
    ('Operação anterior','Tratamento térmico','Operação posterior','Outro'))
);
create index if not exists fm_retr_comp_idx on fm_retrabalho (competencia_id);

create table if not exists fm_sucata (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  etapa text not null default 'Outro',
  processo text, part_number text,
  quantidade int not null default 0 check (quantidade >= 0),
  peso numeric(14,3), valor numeric(16,2),
  tipo_defeito text, motivo text, responsavel text,
  ocorrencia_id text references fm_ocorrencias(id) on delete set null,
  observacao text,
  origem text not null default 'manual',
  created_at timestamptz not null default now(), created_by text,
  updated_at timestamptz not null default now(), updated_by text,
  deleted_at timestamptz, deleted_by text,
  constraint fm_suc_etapa_ck check (etapa in
    ('Operação anterior','Tratamento térmico','Operação posterior','Outro'))
);
create index if not exists fm_suc_comp_idx on fm_sucata (competencia_id);

-- ============================================================================
-- 8. INSPEÇÃO CARE (§22)
-- ============================================================================
create table if not exists fm_care (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  data date, ano int, planta text,
  part_number text, produto text, tipo_defeito text,
  qtd_inspecionada int not null default 0 check (qtd_inspecionada >= 0),
  qtd_aprovada int not null default 0 check (qtd_aprovada >= 0),
  qtd_ng int not null default 0 check (qtd_ng >= 0),
  linha text, turno text, auditor text, responsavel_area text,
  ocorrencia_id text references fm_ocorrencias(id) on delete set null,
  acao_id text, observacoes text, evidencia_url text,
  source_module text, source_record_id text, source_type text,
  origem text not null default 'manual',
  created_at timestamptz not null default now(), created_by text,
  updated_at timestamptz not null default now(), updated_by text,
  deleted_at timestamptz, deleted_by text
);
create index if not exists fm_care_comp_idx on fm_care (competencia_id);
create index if not exists fm_care_pn_idx   on fm_care (part_number);

-- ============================================================================
-- 9. FAROL DE QUEBRAS (§18)
-- ============================================================================
create table if not exists fm_quebras (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  tipo text not null default 'interna',            -- 'externa' | 'interna'
  produto text, part_number text, tipo_produto text,
  quantidade int not null default 0 check (quantidade >= 0),
  data_quebra date, local_quebra text, cliente text, lote text, ordem_producao text,
  descricao text, contencao text, possivel_causa text, causa_raiz text, acao_corretiva text,
  responsavel text, prazo date,
  status text not null default 'Aberta',
  rnc_id text, acao_id text, evidencia_url text, data_conclusao date,
  source_module text, source_record_id text, source_type text,
  origem text not null default 'manual',
  created_at timestamptz not null default now(), created_by text,
  updated_at timestamptz not null default now(), updated_by text,
  deleted_at timestamptz, deleted_by text,
  constraint fm_queb_tipo_ck check (tipo in ('externa','interna')),
  constraint fm_queb_status_ck check (status in (
    'Aberta','Em contenção','Em análise','Aguardando RNC','Plano de ação em andamento',
    'Aguardando evidência','Concluída','Atrasada','Cancelada'))
);
create index if not exists fm_queb_comp_idx on fm_quebras (competencia_id, tipo);

-- §18 — marca automaticamente como Atrasada quando o prazo venceu.
-- Executada sob demanda pelo serviço (e agendável por cron do Supabase).
create or replace function fm_atualizar_quebras_atrasadas() returns int as $$
declare n int;
begin
  update fm_quebras
     set status = 'Atrasada', updated_at = now()
   where deleted_at is null
     and prazo is not null and prazo < fm_hoje()
     and status not in ('Concluída','Cancelada','Atrasada');
  get diagnostics n = row_count;
  return n;
end $$ language plpgsql security definer;

-- ============================================================================
-- 10. SEGURANÇA DO TRABALHO (§17)
-- ============================================================================
create table if not exists fm_seguranca (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  data date, categoria text not null default 'RNA',
  local_evento text, descricao text,
  quantidade int not null default 1 check (quantidade >= 0),
  responsavel text, acao_tomada text, status text default 'Aberto',
  observacoes text, anexo_url text,
  origem text not null default 'manual',
  created_at timestamptz not null default now(), created_by text,
  updated_at timestamptz not null default now(), updated_by text,
  deleted_at timestamptz, deleted_by text,
  constraint fm_seg_cat_ck check (categoria in ('RNA','Cliente','Fornecedor'))
);
create index if not exists fm_seg_comp_idx on fm_seguranca (competencia_id);

-- ============================================================================
-- 11. PLANOS DE AÇÃO 5W2H (§23)
--     A ação NÃO é duplicada a cada mês: nasce numa competência de origem e
--     permanece visível nos meses seguintes enquanto estiver aberta (§5).
-- ============================================================================
create table if not exists fm_acoes (
  id text primary key default gen_random_uuid()::text,
  competencia_origem_id text references fm_competencias(id) on delete set null,
  competencia_conclusao_id text references fm_competencias(id) on delete set null,
  planta text, mes int, ano int, data_reuniao date,
  problema text, part_number text,
  what text, why text, where_ text, when_ date, who text, who_id text,
  how text, how_much numeric(16,2),
  causa_raiz text,
  status text not null default 'Não iniciado',
  percentual int not null default 0 check (percentual between 0 and 100),
  evidencia_url text, observacoes text,
  origem_registro text, source_module text, source_record_id text,
  origem text not null default 'manual',
  created_at timestamptz not null default now(), created_by text,
  updated_at timestamptz not null default now(), updated_by text,
  deleted_at timestamptz, deleted_by text,
  constraint fm_acao_status_ck check (status in (
    'Não iniciado','Em andamento','Aguardando retorno','Aguardando evidência',
    'Concluído','Atrasado','Cancelado'))
);
create index if not exists fm_acao_comp_idx   on fm_acoes (competencia_origem_id);
create index if not exists fm_acao_status_idx on fm_acoes (status);

create table if not exists fm_acao_updates (
  id text primary key default gen_random_uuid()::text,
  acao_id text not null references fm_acoes(id) on delete cascade,
  competencia_id text references fm_competencias(id) on delete set null,
  status_anterior text, status_novo text,
  percentual int, comentario text, evidencia_url text,
  usuario_id text, usuario text,
  quando timestamptz not null default now()
);
create index if not exists fm_acao_upd_idx on fm_acao_updates (acao_id, quando desc);

create or replace function fm_atualizar_acoes_atrasadas() returns int as $$
declare n int;
begin
  update fm_acoes
     set status = 'Atrasado', updated_at = now()
   where deleted_at is null
     and when_ is not null and when_ < fm_hoje()
     and status not in ('Concluído','Cancelado','Atrasado');
  get diagnostics n = row_count;
  return n;
end $$ language plpgsql security definer;

-- ============================================================================
-- 12. CRUZ DA QUALIDADE (§16)
--     A cor é DERIVADA das ocorrências/quebras do dia pelo motor de regras.
--     Esta tabela guarda apenas o que é do usuário: observação, anexo e
--     eventual sobreposição manual justificada (ex.: dia sem produção).
-- ============================================================================
create table if not exists fm_cruz_dias (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  dia date not null,
  status_manual text, justificativa text,
  sem_producao boolean not null default false,
  observacao text, anexo_url text,
  origem text not null default 'manual',
  created_at timestamptz not null default now(), created_by text,
  updated_at timestamptz not null default now(), updated_by text,
  unique (competencia_id, dia),
  constraint fm_cruz_st_ck check (status_manual is null or status_manual in
    ('verde','amarelo','vermelho','preto','cinza'))
);

-- ============================================================================
-- 13. PENDÊNCIAS AUTOMÁTICAS (§32)
-- ============================================================================
create table if not exists fm_pendencias (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  chave text not null,                  -- idempotência: tipo + registro
  tipo text not null, titulo text not null, descricao text,
  modulo text, registro_tabela text, registro_id text,
  responsavel_id text, responsavel text,
  prioridade text not null default 'Média',
  prazo date, status text not null default 'Aberta',
  bloqueia_final boolean not null default false,
  concluida_em timestamptz, concluida_por text, resolucao text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (competencia_id, chave),
  constraint fm_pend_prio_ck check (prioridade in ('Baixa','Média','Alta','Crítica')),
  constraint fm_pend_status_ck check (status in ('Aberta','Em tratativa','Concluída','Cancelada'))
);
create index if not exists fm_pend_comp_idx on fm_pendencias (competencia_id, status);

-- ============================================================================
-- 14. IMPORTAÇÕES (§24, §26, §27)
-- ============================================================================
create table if not exists fm_importacoes (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  tipo text not null default 'faturamento',
  planta text, arquivo_nome text, arquivo_url text, arquivo_hash text,
  versao int not null default 1,
  status text not null default 'Rascunho',
  qtd_registros int default 0, qtd_erros int default 0, qtd_alertas int default 0,
  mapeamento jsonb default '{}',
  observacoes text,
  usuario_id text, usuario text,
  importado_em timestamptz not null default now(),
  aprovada_em timestamptz, aprovada_por text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz, deleted_by text,
  unique (competencia_id, tipo, versao),
  constraint fm_imp_status_ck check (status in
    ('Rascunho','Validando','Com erros','Validada','Confirmada','Aprovada','Cancelada'))
);
create index if not exists fm_imp_comp_idx on fm_importacoes (competencia_id, tipo);

create table if not exists fm_import_linhas (
  id text primary key default gen_random_uuid()::text,
  importacao_id text not null references fm_importacoes(id) on delete cascade,
  linha_num int,
  bruto jsonb not null default '{}',
  dados jsonb not null default '{}',
  cliente_arquivo text, cliente_oficial text,
  classificacao_cliente text,        -- reconhecido | possivel | nao_cadastrado | duplicidade
  status text not null default 'valido',   -- valido | invalido | alerta | ignorado
  erros jsonb default '[]', alertas jsonb default '[]',
  ignorada boolean not null default false, justificativa_ignorar text,
  created_at timestamptz not null default now()
);
create index if not exists fm_impl_imp_idx on fm_import_linhas (importacao_id, status);

-- Comparação entre versões (§27) — o que mudou da versão anterior para esta.
create table if not exists fm_import_versoes (
  id text primary key default gen_random_uuid()::text,
  importacao_id text not null references fm_importacoes(id) on delete cascade,
  versao_anterior int, versao_atual int not null,
  alterados int default 0, adicionados int default 0, removidos int default 0,
  variacao_alta int default 0,          -- clientes com variação > limite
  detalhe jsonb default '[]',
  usuario text, quando timestamptz not null default now()
);
create index if not exists fm_impv_imp_idx on fm_import_versoes (importacao_id);

-- ============================================================================
-- 15. CADASTRO UNIFICADO DE CLIENTES (§25)
-- ============================================================================
create table if not exists fm_clientes_alias (
  id text primary key default gen_random_uuid()::text,
  nome_oficial text not null,
  codigo text, grupo_economico text,
  apelidos jsonb not null default '[]',
  nome_faturamento text, nome_indicadores text, nome_outros text,
  ativo boolean not null default true,
  created_at timestamptz not null default now(), created_by text,
  updated_at timestamptz not null default now(), updated_by text
);
create unique index if not exists fm_alias_oficial_idx on fm_clientes_alias (lower(nome_oficial));

-- ============================================================================
-- 16. APRESENTAÇÃO (§35-40)
-- ============================================================================
create table if not exists fm_apres_templates (
  id text primary key default gen_random_uuid()::text,
  nome text not null, planta text, descricao text,
  ativo boolean not null default true, padrao boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists fm_apres_secoes (
  id text primary key default gen_random_uuid()::text,
  template_id text not null references fm_apres_templates(id) on delete cascade,
  slug text not null, titulo text not null, ordem int not null default 0,
  ativo boolean not null default true, obrigatorio boolean not null default true,
  tipo text default 'grafico', config jsonb default '{}',
  unique (template_id, slug)
);

create table if not exists fm_apres_versoes (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  versao text not null,                       -- V0 | V1 | V2 | FINAL
  preliminar boolean not null default true,
  status text not null default 'Gerada',
  observacoes text, resumo jsonb default '{}',
  gerado_por_id text, gerado_por text, gerado_em timestamptz not null default now(),
  aprovado_por text, aprovado_em timestamptz,
  created_at timestamptz not null default now(),
  unique (competencia_id, versao)
);
create index if not exists fm_apresv_comp_idx on fm_apres_versoes (competencia_id);

create table if not exists fm_arquivos (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  versao_id text references fm_apres_versoes(id) on delete cascade,
  formato text not null,                      -- pptx | pdf | xlsx | link
  nome text not null, url text, path text, tamanho text, hash text,
  gerado_por_id text, gerado_por text,
  created_at timestamptz not null default now()
);
create index if not exists fm_arq_comp_idx on fm_arquivos (competencia_id);

-- ============================================================================
-- 17. MEMÓRIA DE CÁLCULO (§8, §14) e AJUSTES (§30)
-- ============================================================================
create table if not exists fm_memoria (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  indicador text not null,
  formula text, numerador numeric(20,6), denominador numeric(20,6),
  resultado_bruto numeric(20,10), resultado_exibido text,
  criterio_id text references fm_criterios(id), criterio_nome text, criterio_versao int,
  entradas jsonb default '{}', detalhe jsonb default '[]',
  calculado_em timestamptz not null default now(), calculado_por text,
  unique (competencia_id, indicador)
);
create index if not exists fm_mem_comp_idx on fm_memoria (competencia_id);

create table if not exists fm_ajustes (
  id text primary key default gen_random_uuid()::text,
  competencia_id text not null references fm_competencias(id) on delete cascade,
  indicador text, tabela text, registro_id text, campo text,
  valor_anterior text, valor_novo text,
  justificativa text not null, evidencia_url text,
  solicitante_id text, solicitante text, solicitado_em timestamptz not null default now(),
  status text not null default 'Pendente',
  aprovador_id text, aprovador text, decidido_em timestamptz, parecer text,
  constraint fm_aj_status_ck check (status in ('Pendente','Aprovado','Recusado'))
);
create index if not exists fm_aj_comp_idx on fm_ajustes (competencia_id, status);

-- ============================================================================
-- 18. CONFIGURAÇÕES POR PLANTA (§16 regras da cruz, §19 limite, §20 modo)
-- ============================================================================
create table if not exists fm_config (
  id text primary key default gen_random_uuid()::text,
  planta text, chave text not null, valor jsonb not null default '{}',
  descricao text,
  updated_at timestamptz not null default now(), updated_by text
);
-- Expressão só é aceita em índice único (não em constraint de tabela).
create unique index if not exists fm_config_chave_idx
  on fm_config (coalesce(planta, '*'), chave);

-- ============================================================================
-- 19. TRILHA DE AUDITORIA (§45)
-- ============================================================================
create table if not exists fm_logs (
  id text primary key default gen_random_uuid()::text,
  competencia_id text references fm_competencias(id) on delete set null,
  tabela text, registro_id text, campo text,
  acao text not null,                        -- insert | update | delete | status | import | export | reabertura | meta | criterio
  valor_anterior text, valor_novo text,
  justificativa text,
  usuario_id text, usuario text, perfil text,
  sessao text, dispositivo text,
  quando timestamptz not null default now()
);
create index if not exists fm_logs_comp_idx  on fm_logs (competencia_id, quando desc);
create index if not exists fm_logs_tab_idx   on fm_logs (tabela, registro_id);

-- Compatibilidade: bases que rodaram uma versão anterior desta migration não
-- têm as colunas de anexo/evidência (§7/§12/§22). Sem elas, salvar o campo
-- devolveria PGRST204 e a interface acusaria "banco atrás das migrations".
alter table fm_reclamacoes add column if not exists evidencia_url text;
alter table fm_ocorrencias add column if not exists evidencia_url text;
alter table fm_care        add column if not exists evidencia_url text;

-- ============================================================================
-- 20. TRIGGERS: updated_at + trava de competência fechada
-- ============================================================================
do $$
declare t text;
  tabelas text[] := array[
    'fm_reclamacoes','fm_ocorrencias','fm_producao','fm_fornecimento','fm_resultados',
    'fm_custos','fm_retrabalho','fm_sucata','fm_care','fm_quebras','fm_seguranca',
    'fm_cruz_dias','fm_importacoes'];
begin
  foreach t in array tabelas loop
    execute format('drop trigger if exists %1$s_touch on %1$s;', t);
    execute format('create trigger %1$s_touch before update on %1$s for each row execute function fm_touch();', t);
    execute format('drop trigger if exists %1$s_guard on %1$s;', t);
    execute format('create trigger %1$s_guard before insert or update or delete on %1$s
                    for each row execute function fm_guard_fechada();', t);
  end loop;
end $$;

-- ============================================================================
-- 21. FUNÇÕES DE NEGÓCIO
-- ============================================================================

-- §3/§5 — cria a competência seguinte preservando o que é contínuo.
-- NÃO copia lançamentos mensais (reclamações, produção, custos, CARE, cruz...):
-- eles nascem zerados. As ações 5W2H abertas NÃO são duplicadas — continuam
-- apontando para a competência de origem e aparecem no mês novo por consulta.
create or replace function fm_criar_proxima_competencia(p_comp_id text)
returns text language plpgsql security definer as $$
declare
  c fm_competencias%rowtype;
  v_mes int; v_ano int; v_novo text; v_user text; v_nome text;
begin
  select * into c from fm_competencias where id = p_comp_id;
  if not found then raise exception 'Competência % não encontrada', p_comp_id; end if;
  if not fm_is_gestor() then
    raise exception 'Somente Administrador ou Gestor da Qualidade pode abrir a próxima competência'
      using errcode = 'insufficient_privilege';
  end if;

  v_mes := case when c.mes = 12 then 1 else c.mes + 1 end;
  v_ano := case when c.mes = 12 then c.ano + 1 else c.ano end;

  select id::text, nome into v_user, v_nome from usuarios
   where auth_id = auth.uid() or lower(email) = auth_email() limit 1;

  insert into fm_competencias (planta, mes, ano, data_inicial, data_final,
      responsavel_id, responsavel, status, versao, criado_por_id, criado_por,
      competencia_anterior_id)
  values (c.planta, v_mes, v_ano,
      make_date(v_ano, v_mes, 1),
      (make_date(v_ano, v_mes, 1) + interval '1 month - 1 day')::date,
      c.responsavel_id, c.responsavel, 'Não iniciado', 'V0', v_user, v_nome, c.id)
  on conflict do nothing
  returning id into v_novo;

  if v_novo is null then
    select id into v_novo from fm_competencias
     where planta = c.planta and mes = v_mes and ano = v_ano and deleted_at is null;
    return v_novo;   -- já existia: devolve a existente em vez de falhar
  end if;

  -- Seções da nova competência (mesma estrutura, zeradas).
  insert into fm_secoes (competencia_id, secao, responsavel_id, responsavel, obrigatoria)
  select v_novo, s.secao, s.responsavel_id, s.responsavel, s.obrigatoria
    from fm_secoes s where s.competencia_id = c.id;

  insert into fm_logs (competencia_id, tabela, registro_id, acao, valor_novo, usuario_id, usuario, perfil)
  values (v_novo, 'fm_competencias', v_novo, 'insert',
          'Criada a partir de ' || c.competencia, v_user, v_nome, current_perfil());
  return v_novo;
end $$;

-- §46 — reabertura controlada. Preserva a versão final e os arquivos gerados.
create or replace function fm_reabrir_competencia(
  p_comp_id text, p_motivo text, p_autorizador text default null)
returns void language plpgsql security definer as $$
declare c fm_competencias%rowtype; v_user text; v_nome text;
begin
  select * into c from fm_competencias where id = p_comp_id;
  if not found then raise exception 'Competência não encontrada'; end if;
  if not fm_is_admin() then
    raise exception 'Somente o Administrador pode reabrir uma competência fechada'
      using errcode = 'insufficient_privilege';
  end if;
  if c.status <> 'Fechado' then
    raise exception 'Só é possível reabrir competência FECHADA (atual: %)', c.status;
  end if;
  if coalesce(trim(p_motivo),'') = '' then
    raise exception 'Informe o motivo da reabertura';
  end if;

  select id::text, nome into v_user, v_nome from usuarios
   where auth_id = auth.uid() or lower(email) = auth_email() limit 1;

  update fm_competencias
     set status = 'Reaberto', reaberto_em = now(),
         reaberto_motivo = p_motivo, updated_at = now()
   where id = p_comp_id;

  insert into fm_status_hist (competencia_id, status_anterior, status_novo, acao, comentario, usuario_id, usuario)
  values (p_comp_id, c.status, 'Reaberto', 'reabertura',
          p_motivo || coalesce(' · Autorizado por: ' || p_autorizador, ''), v_user, v_nome);

  insert into fm_logs (competencia_id, tabela, registro_id, acao, valor_anterior, valor_novo, justificativa, usuario_id, usuario, perfil)
  values (p_comp_id, 'fm_competencias', p_comp_id, 'reabertura', c.status, 'Reaberto', p_motivo, v_user, v_nome, current_perfil());
end $$;

-- §42 — transição de status com registro obrigatório no histórico.
create or replace function fm_mudar_status(
  p_comp_id text, p_novo text, p_comentario text default null)
returns void language plpgsql security definer as $$
declare c fm_competencias%rowtype; v_user text; v_nome text;
begin
  select * into c from fm_competencias where id = p_comp_id;
  if not found then raise exception 'Competência não encontrada'; end if;

  -- §44.3 — auditor não aprova / não fecha.
  if p_novo in ('Aprovado','Fechado') and not fm_is_gestor() then
    raise exception 'Perfil sem permissão para %', p_novo using errcode = 'insufficient_privilege';
  end if;
  if c.status = 'Fechado' and p_novo <> 'Reaberto' then
    raise exception 'Competência fechada — use a reabertura formal';
  end if;

  select id::text, nome into v_user, v_nome from usuarios
   where auth_id = auth.uid() or lower(email) = auth_email() limit 1;

  update fm_competencias set
      status = p_novo,
      aprovado_por_id = case when p_novo = 'Aprovado' then v_user else aprovado_por_id end,
      aprovado_por    = case when p_novo = 'Aprovado' then v_nome else aprovado_por end,
      aprovado_em     = case when p_novo = 'Aprovado' then now()  else aprovado_em end,
      fechado_por_id  = case when p_novo = 'Fechado'  then v_user else fechado_por_id end,
      fechado_por     = case when p_novo = 'Fechado'  then v_nome else fechado_por end,
      fechado_em      = case when p_novo = 'Fechado'  then now()  else fechado_em end,
      updated_at = now()
   where id = p_comp_id;

  insert into fm_status_hist (competencia_id, status_anterior, status_novo, acao, comentario, usuario_id, usuario)
  values (p_comp_id, c.status, p_novo, 'status', p_comentario, v_user, v_nome);

  insert into fm_logs (competencia_id, tabela, registro_id, acao, valor_anterior, valor_novo, justificativa, usuario_id, usuario, perfil)
  values (p_comp_id, 'fm_competencias', p_comp_id, 'status', c.status, p_novo, p_comentario, v_user, v_nome, current_perfil());
end $$;

-- ============================================================================
-- 22. RLS (§44)
-- ============================================================================

-- 22.1 Competências, seções e histórico
alter table fm_competencias enable row level security;
alter table fm_secoes       enable row level security;
alter table fm_status_hist  enable row level security;

drop policy if exists "fm_comp_read" on fm_competencias;
-- §43 Visitante: só competências FECHADAS. Demais perfis: plantas autorizadas.
create policy "fm_comp_read" on fm_competencias for select to authenticated
  using (
    case when current_perfil() = 'visitante' then status = 'Fechado'
         else fm_planta_autorizada(planta) end
  );

drop policy if exists "fm_comp_insert" on fm_competencias;
create policy "fm_comp_insert" on fm_competencias for insert to authenticated
  with check (fm_is_gestor() and fm_planta_autorizada(planta));

drop policy if exists "fm_comp_update" on fm_competencias;
create policy "fm_comp_update" on fm_competencias for update to authenticated
  using (fm_is_gestor() and fm_planta_autorizada(planta))
  with check (fm_is_gestor() and fm_planta_autorizada(planta));

drop policy if exists "fm_comp_delete" on fm_competencias;
create policy "fm_comp_delete" on fm_competencias for delete to authenticated
  using (fm_is_admin());

drop policy if exists "fm_secoes_read" on fm_secoes;
create policy "fm_secoes_read" on fm_secoes for select to authenticated using (true);
drop policy if exists "fm_secoes_write" on fm_secoes;
create policy "fm_secoes_write" on fm_secoes for all to authenticated
  using (fm_is_operacional() and fm_competencia_editavel(competencia_id))
  with check (fm_is_operacional() and fm_competencia_editavel(competencia_id));

drop policy if exists "fm_hist_read" on fm_status_hist;
create policy "fm_hist_read" on fm_status_hist for select to authenticated using (true);
drop policy if exists "fm_hist_insert" on fm_status_hist;
create policy "fm_hist_insert" on fm_status_hist for insert to authenticated with check (true);

-- 22.2 Tabelas de lançamento — leitura para autenticados (menos visitante em
--      competência aberta), escrita para operacionais em competência editável,
--      exclusão apenas para administrador (§44.7).
do $$
declare t text;
  -- fm_acoes / fm_acao_updates ficam FORA do laço: a coluna de competência tem
  -- outro nome (competencia_origem_id) e as policies delas vêm logo abaixo.
  tabelas text[] := array[
    'fm_reclamacoes','fm_ocorrencias','fm_producao','fm_fornecimento','fm_resultados',
    'fm_custos','fm_retrabalho','fm_sucata','fm_care','fm_quebras','fm_seguranca',
    'fm_cruz_dias','fm_pendencias','fm_memoria'];
begin
  foreach t in array tabelas loop
    execute format('alter table %I enable row level security;', t);

    execute format('drop policy if exists "fm_read_%1$s" on %1$s;', t);
    execute format($f$create policy "fm_read_%1$s" on %1$s for select to authenticated
      using (current_perfil() <> 'visitante' or exists (
        select 1 from fm_competencias c where c.id = %1$s.competencia_id and c.status = 'Fechado'));$f$, t);

    execute format('drop policy if exists "fm_ins_%1$s" on %1$s;', t);
    execute format($f$create policy "fm_ins_%1$s" on %1$s for insert to authenticated
      with check (fm_is_operacional() and fm_competencia_editavel(competencia_id));$f$, t);

    execute format('drop policy if exists "fm_upd_%1$s" on %1$s;', t);
    execute format($f$create policy "fm_upd_%1$s" on %1$s for update to authenticated
      using (fm_is_operacional() and fm_competencia_editavel(competencia_id))
      with check (fm_is_operacional() and fm_competencia_editavel(competencia_id));$f$, t);

    execute format('drop policy if exists "fm_del_%1$s" on %1$s;', t);
    execute format($f$create policy "fm_del_%1$s" on %1$s for delete to authenticated
      using (fm_is_admin());$f$, t);
  end loop;
end $$;

-- fm_acoes / fm_acao_updates — policies próprias (§23: a ação atravessa meses,
-- por isso o UPDATE não é travado pela competência de origem; o que trava é o
-- status da própria ação).
alter table fm_acoes        enable row level security;
alter table fm_acao_updates enable row level security;

drop policy if exists "fm_del_fm_acoes" on fm_acoes;
create policy "fm_del_fm_acoes" on fm_acoes for delete to authenticated using (fm_is_admin());
drop policy if exists "fm_del_fm_acao_updates" on fm_acao_updates;
create policy "fm_del_fm_acao_updates" on fm_acao_updates for delete to authenticated using (fm_is_admin());

drop policy if exists "fm_ins_fm_acoes" on fm_acoes;
create policy "fm_ins_fm_acoes" on fm_acoes for insert to authenticated
  with check (fm_is_operacional() and fm_competencia_editavel(competencia_origem_id));
drop policy if exists "fm_upd_fm_acoes" on fm_acoes;
create policy "fm_upd_fm_acoes" on fm_acoes for update to authenticated
  using (fm_is_operacional()) with check (fm_is_operacional());
drop policy if exists "fm_read_fm_acoes" on fm_acoes;
create policy "fm_read_fm_acoes" on fm_acoes for select to authenticated
  using (current_perfil() <> 'visitante');

drop policy if exists "fm_ins_fm_acao_updates" on fm_acao_updates;
create policy "fm_ins_fm_acao_updates" on fm_acao_updates for insert to authenticated
  with check (fm_is_operacional());
drop policy if exists "fm_upd_fm_acao_updates" on fm_acao_updates;
create policy "fm_upd_fm_acao_updates" on fm_acao_updates for update to authenticated
  using (fm_is_gestor()) with check (fm_is_gestor());
drop policy if exists "fm_read_fm_acao_updates" on fm_acao_updates;
create policy "fm_read_fm_acao_updates" on fm_acao_updates for select to authenticated
  using (current_perfil() <> 'visitante');

-- 22.3 Configuração (metas, critérios, aliases, templates, slides, config):
--      leitura para autenticados; escrita SOMENTE admin (§43).
do $$
declare t text;
  tabelas text[] := array['fm_criterios','fm_metas','fm_clientes_alias',
    'fm_apres_templates','fm_apres_secoes','fm_config'];
begin
  foreach t in array tabelas loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "fm_cfg_read_%1$s" on %1$s;', t);
    execute format('create policy "fm_cfg_read_%1$s" on %1$s for select to authenticated using (true);', t);
    execute format('drop policy if exists "fm_cfg_write_%1$s" on %1$s;', t);
    execute format($f$create policy "fm_cfg_write_%1$s" on %1$s for all to authenticated
      using (fm_is_admin()) with check (fm_is_admin());$f$, t);
  end loop;
end $$;

-- 22.4 Importações — só gestor/admin importam (§43).
do $$
declare t text;
  tabelas text[] := array['fm_importacoes','fm_import_linhas','fm_import_versoes'];
begin
  foreach t in array tabelas loop
    execute format('alter table %I enable row level security;', t);
    execute format('drop policy if exists "fm_imp_read_%1$s" on %1$s;', t);
    execute format($f$create policy "fm_imp_read_%1$s" on %1$s for select to authenticated
      using (current_perfil() <> 'visitante');$f$, t);
    execute format('drop policy if exists "fm_imp_write_%1$s" on %1$s;', t);
    execute format($f$create policy "fm_imp_write_%1$s" on %1$s for all to authenticated
      using (fm_is_gestor()) with check (fm_is_gestor());$f$, t);
  end loop;
end $$;

-- 22.5 Apresentação gerada e arquivos — geração por gestor; leitura ampla
--      (visitante lê apenas o que pertence a competência fechada, §43).
alter table fm_apres_versoes enable row level security;
alter table fm_arquivos      enable row level security;

drop policy if exists "fm_apresv_read" on fm_apres_versoes;
create policy "fm_apresv_read" on fm_apres_versoes for select to authenticated
  using (current_perfil() <> 'visitante' or exists (
    select 1 from fm_competencias c where c.id = competencia_id and c.status = 'Fechado'));
drop policy if exists "fm_apresv_write" on fm_apres_versoes;
create policy "fm_apresv_write" on fm_apres_versoes for all to authenticated
  using (fm_is_gestor()) with check (fm_is_gestor());

drop policy if exists "fm_arq_read" on fm_arquivos;
create policy "fm_arq_read" on fm_arquivos for select to authenticated
  using (current_perfil() <> 'visitante' or exists (
    select 1 from fm_competencias c where c.id = competencia_id and c.status = 'Fechado'));
drop policy if exists "fm_arq_write" on fm_arquivos;
create policy "fm_arq_write" on fm_arquivos for all to authenticated
  using (fm_is_gestor()) with check (fm_is_gestor());

-- 22.6 Ajustes de campo calculado (§30): qualquer operacional SOLICITA;
--      somente gestor DECIDE.
alter table fm_ajustes enable row level security;
drop policy if exists "fm_aj_read" on fm_ajustes;
create policy "fm_aj_read" on fm_ajustes for select to authenticated
  using (current_perfil() <> 'visitante');
drop policy if exists "fm_aj_insert" on fm_ajustes;
create policy "fm_aj_insert" on fm_ajustes for insert to authenticated
  with check (fm_is_operacional() and status = 'Pendente');
drop policy if exists "fm_aj_update" on fm_ajustes;
create policy "fm_aj_update" on fm_ajustes for update to authenticated
  using (fm_is_gestor()) with check (fm_is_gestor());

-- 22.7 Trilha de auditoria: append-only. Leitura restrita a admin/gestor.
alter table fm_logs enable row level security;
drop policy if exists "fm_logs_insert" on fm_logs;
create policy "fm_logs_insert" on fm_logs for insert to authenticated with check (true);
drop policy if exists "fm_logs_read" on fm_logs;
create policy "fm_logs_read" on fm_logs for select to authenticated using (fm_is_gestor());
-- Sem policy de UPDATE/DELETE: a trilha não pode ser alterada nem apagada.

-- ============================================================================
-- 23. SEED DE CATÁLOGOS (configuração — nunca dados de resultado)
-- ============================================================================

-- 23.1 Critério padrão do PPM interno (§13). Vigência aberta a partir de 2026.
insert into fm_criterios (indicador, nome, descricao, vigencia_inicio, planta,
  fontes_incluidas, fontes_excluidas, status, justificativa, versao)
select 'ppm_interno', 'Critério padrão — PPM interno',
  'Numerador: ocorrências internas detectadas na planta. Não inclui reclamações do cliente (que compõem o PPM externo).',
  date '2026-01-01', null,
  '["Auditoria de produto","Auditoria dimensional","Contenção interna","CARE","Muro da Qualidade","Produção","Quebra interna","Sucata","Retrabalho"]'::jsonb,
  '["Contenção no cliente","Devolução de cliente"]'::jsonb,
  'Ativo', 'Critério inicial cadastrado na implantação do módulo.', 1
where not exists (select 1 from fm_criterios where indicador = 'ppm_interno');

-- 23.2 Metas iniciais (§31). Valores editáveis em Configurações → Metas.
insert into fm_metas (indicador, planta, ano, valor, unidade, comparacao, status, responsavel)
select v.indicador, null, extract(year from fm_hoje())::int, v.valor, v.unidade, v.comparacao, 'Ativo', 'Garantia da Qualidade'
from (values
  ('ppm_externo_oficial', 50,     'PPM',  '<='),
  ('ppm_externo_real',    80,     'PPM',  '<='),
  ('ppm_interno',       1500,     'PPM',  '<='),
  ('reclamacoes',          2,     'un',   '<='),
  ('custo_qualidade',  28000,     'BRL',  '<='),
  ('care_percentual_ng',   1,     '%',    '<='),
  ('seguranca_eventos',    0,     'un',   '<='),
  ('quebras_externas',     0,     'un',   '<='),
  ('quebras_internas',     0,     'un',   '<=')
) as v(indicador, valor, unidade, comparacao)
where not exists (
  select 1 from fm_metas m where m.indicador = v.indicador and m.planta is null
    and m.ano = extract(year from fm_hoje())::int);

-- 23.3 Configurações por planta (§16 cruz, §19 limite, §20 modo do retrabalho).
insert into fm_config (planta, chave, valor, descricao)
select null, 'cruz_regras',
  '{"amarelo_min_ocorrencias":1,"vermelho_min_ocorrencias":1,"vermelho_min_pecas":10,"preto_quebra":true,"preto_min_pecas":100}'::jsonb,
  'Regras de cor da Cruz da Qualidade (§16) — editáveis pelo administrador.'
where not exists (select 1 from fm_config where chave = 'cruz_regras' and planta is null);

insert into fm_config (planta, chave, valor, descricao)
select null, 'custo_limite_mensal', '{"valor":28000,"moeda":"BRL"}'::jsonb,
  'Limite mensal do custo da qualidade (§19).'
where not exists (select 1 from fm_config where chave = 'custo_limite_mensal' and planta is null);

insert into fm_config (planta, chave, valor, descricao)
select null, 'retrabalho_modo', '{"modo":"ppm"}'::jsonb,
  'Índice de retrabalho apresentado em "ppm" ou "percentual" (§20).'
where not exists (select 1 from fm_config where chave = 'retrabalho_modo' and planta is null);

insert into fm_config (planta, chave, valor, descricao)
select null, 'import_variacao_alerta', '{"percentual":10}'::jsonb,
  'Percentual de variação entre versões de importação que gera alerta (§27).'
where not exists (select 1 from fm_config where chave = 'import_variacao_alerta' and planta is null);

-- 23.4 Template padrão da apresentação (§36) — 18 seções na ordem oficial.
insert into fm_apres_templates (id, nome, planta, descricao, ativo, padrao)
select 'fmtpl-padrao', 'Apresentação Qualidade — Planta RJ', 'Planta RJ - Lâminas',
  'Modelo estrutural derivado da apresentação de julho/2026.', true, true
where not exists (select 1 from fm_apres_templates where id = 'fmtpl-padrao');

insert into fm_apres_secoes (template_id, slug, titulo, ordem, tipo)
select 'fmtpl-padrao', s.slug, s.titulo, s.ordem, s.tipo
from (values
  ('capa',              'Capa',                                   1,  'capa'),
  ('reclamacoes_ppm',   'Reclamações Externas e PPM Externo',     2,  'grafico'),
  ('negociadas_ppm',    'Reclamações Negociadas e PPM Real',      3,  'grafico'),
  ('negociadas_det',    'Detalhamento das Reclamações Negociadas',4,  'tabela'),
  ('comparativo_recl',  'Comparativo de Reclamações',             5,  'grafico'),
  ('criterios_ppm',     'Critérios do PPM Interno',               6,  'texto'),
  ('ocorrencias_ppm',   'Ocorrências e PPM Interno',              7,  'grafico'),
  ('principais_probl',  'Principais Problemas Internos',          8,  'ranking'),
  ('cruz_qualidade',    'Cruz da Qualidade',                      9,  'cruz'),
  ('seguranca',         'Segurança do Trabalho',                  10, 'tabela'),
  ('quebras_externas',  'Farol de Quebras Externas',              11, 'farol'),
  ('quebras_internas',  'Farol de Quebras Internas',              12, 'farol'),
  ('custos',            'Custos da Qualidade',                    13, 'grafico'),
  ('melhoria_continua', 'Projetos de Melhoria Contínua',          14, 'tabela'),
  ('care_mensal',       'Inspeção CARE — Mensal',                 15, 'grafico'),
  ('care_acumulada',    'Inspeção CARE — Acumulada',              16, 'grafico'),
  ('plano_5w2h',        'Plano de Ação 5W2H',                     17, 'tabela'),
  ('pendencias',        'Pendências e Próximos Passos',           18, 'tabela')
) as s(slug, titulo, ordem, tipo)
where not exists (
  select 1 from fm_apres_secoes a where a.template_id = 'fmtpl-padrao' and a.slug = s.slug);

-- 23.5 Aliases de clientes (§25) — semeados a partir da lista oficial já
--      existente na Biblioteca Técnica, quando disponível. Sem inventar nomes.
do $$
begin
  if to_regclass('public.bib_clientes') is not null then
    insert into fm_clientes_alias (nome_oficial, apelidos, ativo)
    select c.nome, '[]'::jsonb, coalesce(c.ativo, true)
      from bib_clientes c
     where not exists (
       select 1 from fm_clientes_alias a where lower(a.nome_oficial) = lower(c.nome));
  end if;
end $$;

-- =============================================================================
-- FIM. Rollback: database/rollback_fechamento_mensal.sql
-- =============================================================================
