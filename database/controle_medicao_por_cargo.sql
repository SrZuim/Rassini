-- ============================================================================
--  RNA One — CONTROLE DE MEDIÇÃO POR CARGO (Quem Mede → cargo)
--  Backend/Banco da regra implementada no frontend/serviço (services/quem-mede.js).
--
--  ⚠️  NÃO EXECUTADO AUTOMATICAMENTE. Revise e rode no Supabase (SQL Editor).
--  ⚠️  A SEÇÃO 1 (ALTER TYPE ... ADD VALUE) precisa ser COMMITADA ANTES das demais:
--      no PostgreSQL um novo valor de enum não pode ser USADO na mesma transação
--      em que foi criado. Rode a SEÇÃO 1 sozinha, confirme, e só então rode o resto.
--
--  Espelha EXATAMENTE o mapeamento de services/quem-mede.js:
--     G. Qualidade             -> auditor
--     Recebimento de Materiais -> auditor_recebimento
--     Eng. Processos           -> eng_processos
--     Laboratório              -> laboratorio
--  Admin sempre pode; Supervisor só se SUPERVISOR_PODE_MEDIR (aqui: FALSE);
--  Visitante nunca; "Quem Mede" sem responsável reconhecível => só admin.
-- ============================================================================


-- ============================================================================
-- SEÇÃO 1 — NOVOS CARGOS NO ENUM perfil_tipo  (RODAR SOZINHA E COMMITAR PRIMEIRO)
-- ============================================================================
alter type perfil_tipo add value if not exists 'auditor_recebimento';
alter type perfil_tipo add value if not exists 'eng_processos';
alter type perfil_tipo add value if not exists 'laboratorio';


-- ============================================================================
-- SEÇÃO 2 — COLUNAS DE RASTREABILIDADE
-- ============================================================================
-- Congela QUEM MEDE (rótulo da Biblioteca) no snapshot da característica: é o que
-- decide, por característica, qual cargo pode preencher.
alter table insp_caracteristicas add column if not exists quem_mede text;

-- Cargo de quem preencheu cada medição (§13 — rastreabilidade por medição).
alter table insp_medicoes add column if not exists medido_por_cargo text;

-- (Autoria por medição — caso ainda não exista de fix_amostras_colaborativas.sql)
alter table insp_medicoes add column if not exists medido_por      text;
alter table insp_medicoes add column if not exists medido_por_nome text;

create index if not exists idx_insp_car_quem_mede on insp_caracteristicas(quem_mede);


-- ============================================================================
-- SEÇÃO 3 — LISTA OFICIAL DE "QUEM MEDE" (§3)  (idempotente)
-- ============================================================================
-- Garante as 4 opções canônicas na tabela de catálogo (se a tabela existir).
do $$
begin
  if to_regclass('public.quem_mede') is not null then
    insert into quem_mede (nome, ativo)
    select v, true from (values
      ('G. Qualidade'), ('Recebimento de Materiais'), ('Eng. Processos'), ('Laboratório')
    ) as t(v)
    where not exists (select 1 from quem_mede q where lower(btrim(q.nome)) = lower(btrim(t.v)));
  end if;
end $$;


-- ============================================================================
-- SEÇÃO 4 — FUNÇÕES DA REGRA (fonte única no banco)
-- ============================================================================

-- Normaliza um rótulo de "Quem Mede" (sem acento, minúsculo) para comparação.
create or replace function qm_norm(p text) returns text as $$
  select regexp_replace(
           translate(lower(btrim(coalesce(p,''))),
                     'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                     'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'),
           '[._/\-]+', ' ', 'g');
$$ language sql immutable;

-- Mapeia "Quem Mede" (rótulo/legado) -> cargo (role id). NULL = sem responsável.
create or replace function quem_mede_para_cargo(p_quem_mede text) returns text as $$
  select case qm_norm(p_quem_mede)
    when 'g qualidade'              then 'auditor'
    when 'qualidade'               then 'auditor'
    when 'garantia da qualidade'   then 'auditor'
    when 'recebimento de materiais' then 'auditor_recebimento'
    when 'recebimento'             then 'auditor_recebimento'
    when 'eng processos'           then 'eng_processos'
    when 'engenharia de processos' then 'eng_processos'
    when 'processos'               then 'eng_processos'
    when 'laboratorio'             then 'laboratorio'
    when 'lab'                     then 'laboratorio'
    else null
  end;
$$ language sql immutable;

-- Constante de política: o Supervisor pode medir? (espelha SUPERVISOR_PODE_MEDIR).
create or replace function supervisor_pode_medir() returns boolean as $$
  select false;
$$ language sql immutable;

-- REGRA CENTRAL (§12): o usuário pode editar a medição desta característica?
--  admin -> sempre; supervisor -> só se supervisor_pode_medir(); visitante -> não;
--  demais -> cargo do usuário = cargo responsável pelo "Quem Mede" da característica.
--  "Quem Mede" sem responsável reconhecível -> só admin.
-- NOTA DE TIPOS: usuarios.id é UUID; insp_caracteristicas.id (e portanto
-- insp_medicoes.caracteristica_id) é TEXT nesta base. Os parâmetros seguem isso.
create or replace function pode_editar_medicao(p_usuario_id uuid, p_caracteristica_id text)
returns boolean as $$
declare
  v_cargo text;
  v_quem  text;
  v_resp  text;
begin
  select role::text into v_cargo from usuarios where id = p_usuario_id;
  if v_cargo is null then return false; end if;
  if v_cargo = 'admin' then return true; end if;
  if v_cargo = 'visitante' then return false; end if;

  select quem_mede into v_quem from insp_caracteristicas where id = p_caracteristica_id;
  v_resp := quem_mede_para_cargo(v_quem);

  if v_cargo = 'supervisor' then return supervisor_pode_medir(); end if;
  if v_resp is null then return false; end if;   -- sem responsável => só admin
  return v_cargo = v_resp;
end;
$$ language plpgsql stable security definer;

-- Versão que resolve o usuário pela sessão (para uso direto nas policies).
create or replace function pode_editar_medicao_atual(p_caracteristica_id text)
returns boolean as $$
  select pode_editar_medicao(
    (select id from usuarios where auth_id = auth.uid() or lower(email) = auth_email() limit 1),
    p_caracteristica_id);
$$ language sql stable security definer;


-- ============================================================================
-- SEÇÃO 5 — RLS EM insp_medicoes  (§12/§24 — a regra vale no banco, não só na UI)
-- ============================================================================
-- Estas policies SUBSTITUEM as de escrita criadas em auditorias_dimensional.sql,
-- ADICIONANDO a dimensão de cargo. Mantêm o vínculo com relatório aberto e o
-- bypass do admin. Ajuste os nomes se as suas policies tiverem outro identificador.

alter table insp_medicoes enable row level security;

drop policy if exists insp_medicoes_insert on insp_medicoes;
create policy insp_medicoes_insert on insp_medicoes for insert to authenticated
with check (
  -- relatório precisa existir e estar EM ANDAMENTO (não finalizado)
  exists (select 1 from insp_relatorios r
          where r.id = insp_medicoes.relatorio_id
            and coalesce(r.status,'') not like 'finalizada%'
            and coalesce(r.status,'') <> 'revisada')
  -- e o usuário tem de poder medir ESTA característica (cargo x Quem Mede)
  and pode_editar_medicao_atual(insp_medicoes.caracteristica_id)
);

drop policy if exists insp_medicoes_update on insp_medicoes;
create policy insp_medicoes_update on insp_medicoes for update to authenticated
using (
  exists (select 1 from insp_relatorios r
          where r.id = insp_medicoes.relatorio_id
            and coalesce(r.status,'') not like 'finalizada%'
            and coalesce(r.status,'') <> 'revisada')
  and pode_editar_medicao_atual(insp_medicoes.caracteristica_id)
)
with check (
  pode_editar_medicao_atual(insp_medicoes.caracteristica_id)
);

-- SELECT/visualização permanece aberta a quem já enxerga o relatório (acompanhamento
-- por todos os setores, §7/§9) — NÃO restrinja o SELECT por cargo.


-- ============================================================================
-- SEÇÃO 6 — CADASTRO/ALTERAÇÃO DE CARGO ACEITA OS NOVOS VALORES (§2/§19)
-- ============================================================================
-- Amplia a lista aceita por fn_alterar_cargo (antes: só 4 cargos).
create or replace function fn_alterar_cargo(p_alvo uuid, p_role text) returns void as $$
declare v_adm usuarios; v_alvo usuarios;
begin
  select * into v_adm from usuarios where auth_id = auth.uid() or lower(email) = auth_email() limit 1;
  if coalesce(v_adm.role::text,'') <> 'admin' then raise exception 'Apenas administradores.'; end if;
  if p_role not in ('visitante','auditor','auditor_recebimento','eng_processos','laboratorio','supervisor','admin')
    then raise exception 'Cargo inválido.'; end if;
  select * into v_alvo from usuarios where id = p_alvo;
  update usuarios set role = p_role::perfil_tipo where id = p_alvo;
  -- (mantém o mesmo registro em log_admin do fn_alterar_cargo original, se houver)
end;
$$ language plpgsql security definer;


-- ============================================================================
-- SEÇÃO 7 — NORMALIZAÇÃO DE DADOS ANTIGOS (§18/§19)  — REVISAR ANTES DE RODAR
-- ============================================================================
-- 7a) Cargos legados de usuários (execute só se houver valores fora do padrão).
--     Os 4 ids antigos (admin/supervisor/auditor/visitante) já são canônicos.
-- update usuarios set role = 'auditor_recebimento'::perfil_tipo where lower(role::text) in ('recebimento','auditor de recebimento');
-- update usuarios set role = 'eng_processos'::perfil_tipo       where lower(role::text) in ('engenharia de processos','eng. processos');
-- update usuarios set role = 'laboratorio'::perfil_tipo         where lower(role::text) in ('lab','laboratorio');

-- 7b) "Quem Mede" legado nas MÉTRICAS da Biblioteca (bib_metricas via quem_mede).
--     Apenas relata o que NÃO mapeia para um cargo (ex.: "Metrologia","Eng. Produto"):
--     essas características ficarão bloqueadas (só admin) até correção no cadastro (§18).
-- select m.id, q.nome as quem_mede
--   from bib_metricas m join quem_mede q on q.id = m.quem_mede_id
--  where quem_mede_para_cargo(q.nome) is null;

-- 7c) Snapshots ANTIGOS (insp_caracteristicas) não têm quem_mede: ficam "sem
--     responsável" (só admin edita), conforme §18. Para reidratar a partir da
--     métrica de origem, se você guardar metrica_id no snapshot:
-- update insp_caracteristicas ic
--    set quem_mede = q.nome
--   from bib_metricas m join quem_mede q on q.id = m.quem_mede_id
--  where ic.metrica_id = m.id and coalesce(ic.quem_mede,'') = '';


-- ============================================================================
-- VERIFICAÇÃO (rode após aplicar)
-- ============================================================================
-- select unnest(enum_range(null::perfil_tipo));                 -- deve listar os 7 cargos
-- select quem_mede_para_cargo('G. Qualidade');                  -- 'auditor'
-- select quem_mede_para_cargo('Laboratório');                   -- 'laboratorio'
-- select quem_mede_para_cargo('Metrologia');                    -- NULL (bloqueado)
-- select polname from pg_policies where tablename = 'insp_medicoes';
