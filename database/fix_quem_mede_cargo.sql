-- ============================================================================
--  RNA One — CORREÇÃO "Quem Mede" × CARGO  (Auditor bloqueado em G. Qualidade)
--
--  ⚠️  NÃO EXECUTADO AUTOMATICAMENTE. Rode no Supabase (SQL Editor), na ordem.
--  Complementa database/controle_medicao_por_cargo.sql (que já criou as colunas
--  e as policies). Aqui estão as três coisas que faltavam:
--
--    A) REIDRATAR o snapshot: insp_caracteristicas.quem_mede vazio em relatórios
--       criados antes do controle por cargo. Campo vazio = NINGUÉM mede (fail
--       closed) → é a causa de "Sem responsável" + cadeado em todas as linhas.
--    B) ALIASES no banco iguais aos de services/quem-mede.js ("Gestão da
--       Qualidade", "Auditor", acento/caixa/pontuação) — a regra do banco não
--       pode ser mais estreita que a do frontend, senão a UI libera e a RLS nega.
--    C) LEITURA garantida do catálogo `quem_mede` e das métricas para quem mede:
--       sem SELECT nessas tabelas o rótulo nunca chega à tela.
--
--  Mapeamento oficial (idêntico ao frontend):
--     G. Qualidade             -> auditor
--     Recebimento de Materiais -> auditor_recebimento
--     Eng. Processos           -> eng_processos
--     Laboratório              -> laboratorio
-- ============================================================================


-- ============================================================================
-- 0) DIAGNÓSTICO — rode ANTES e guarde o resultado
-- ============================================================================
-- 0a) Quantas características de inspeção estão sem responsável?
--     (o número alto aqui confirma a causa do bloqueio)
select count(*) filter (where coalesce(quem_mede,'') = '') as sem_quem_mede,
       count(*)                                            as total
  from insp_caracteristicas;

-- 0b) Cargos existentes na base de usuários (confere se 'auditor' é o id gravado)
select role::text as cargo, count(*) from usuarios group by 1 order by 2 desc;

-- 0c) Valores de "Quem Mede" cadastrados na Biblioteca
select q.nome, count(m.id) as metricas
  from quem_mede q left join bib_metricas m on m.quem_mede_id = q.id
 group by 1 order by 2 desc;


-- ============================================================================
-- B) NORMALIZAÇÃO E MAPEAMENTO — espelho exato de services/quem-mede.js
-- ============================================================================

-- Normaliza para comparação: minúsculo, sem acento, pontuação virando espaço,
-- espaços colapsados. 'G. Qualidade', 'g  qualidade' e 'G.QUALIDADE' se igualam.
create or replace function qm_norm(p text) returns text as $$
  select btrim(regexp_replace(
           regexp_replace(
             translate(lower(btrim(coalesce(p,''))),
                       'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                       'aaaaaeeeeiiiiooooouuuucaaaaaeeeeiiiiooooouuuuc'),
             '[._/\-]+', ' ', 'g'),
           '\s+', ' ', 'g'));
$$ language sql immutable;

-- Forma "dura": sem conectivos (da/de/do/das/dos/e). 2ª tentativa do mapeamento.
create or replace function qm_chave(p text) returns text as $$
  select btrim(regexp_replace(
           regexp_replace(qm_norm(p), '\y(da|de|do|das|dos|e)\y', ' ', 'g'),
           '\s+', ' ', 'g'));
$$ language sql immutable;

-- Mapeia "Quem Mede" (rótulo/legado/alias) -> cargo. NULL = sem responsável.
-- ATENÇÃO: manter em sincronia com ALIASES_QUEM_MEDE de services/quem-mede.js.
create or replace function quem_mede_para_cargo(p_quem_mede text) returns text as $$
  select case
    -- ---------------- G. Qualidade -> Auditor
    when qm_norm(p_quem_mede) in (
      'g qualidade', 'qualidade', 'gq',
      'gestao da qualidade', 'gerencia da qualidade', 'garantia da qualidade',
      'auditor', 'auditor da qualidade')                       then 'auditor'
    when qm_chave(p_quem_mede) in (
      'g qualidade', 'gestao qualidade', 'gerencia qualidade',
      'garantia qualidade', 'auditor qualidade')               then 'auditor'
    -- ---------------- Recebimento de Materiais -> Auditor de Recebimento
    when qm_norm(p_quem_mede) in (
      'recebimento', 'recebimento de materiais',
      'auditor de recebimento', 'inspecao de recebimento')      then 'auditor_recebimento'
    when qm_chave(p_quem_mede) in (
      'recebimento materiais', 'auditor recebimento',
      'inspecao recebimento')                                   then 'auditor_recebimento'
    -- ---------------- Eng. Processos -> Eng. Processos
    when qm_norm(p_quem_mede) in (
      'eng processos', 'eng de processos', 'processos',
      'engenharia de processos', 'engenharia processos')         then 'eng_processos'
    when qm_chave(p_quem_mede) in (
      'eng processos', 'engenharia processos')                   then 'eng_processos'
    -- ---------------- Laboratório -> Laboratório
    when qm_norm(p_quem_mede) in (
      'laboratorio', 'lab', 'laboratorio de ensaios')            then 'laboratorio'
    when qm_chave(p_quem_mede) in ('laboratorio ensaios')        then 'laboratorio'
    -- 'Metrologia' e demais desconhecidos ficam NULL de propósito: só admin mede,
    -- até o cadastro ser corrigido na Biblioteca Técnica.
    else null
  end;
$$ language sql immutable;

-- Confere o mapeamento antes de seguir:
--   select quem_mede_para_cargo('G. Qualidade');          -- auditor
--   select quem_mede_para_cargo('Gestão da Qualidade');   -- auditor
--   select quem_mede_para_cargo('  g. QUALIDADE ');       -- auditor
--   select quem_mede_para_cargo('Laboratório');           -- laboratorio
--   select quem_mede_para_cargo('Metrologia');            -- NULL


-- ============================================================================
-- A) REIDRATAÇÃO DO SNAPSHOT  (a correção que destrava os relatórios existentes)
-- ============================================================================
-- Preenche insp_caracteristicas.quem_mede a partir da métrica de origem da
-- Biblioteca. Só toca no que está VAZIO — nunca reescreve um snapshot válido
-- (o congelamento histórico é preservado).
--
-- Prévia (rode primeiro e confira a contagem):
select count(*) as vao_ser_preenchidas
  from insp_caracteristicas ic
  join bib_metricas m on m.id = ic.metrica_id
  join quem_mede    q on q.id = m.quem_mede_id
 where coalesce(ic.quem_mede,'') = '';

-- Aplicação:
update insp_caracteristicas ic
   set quem_mede = q.nome
  from bib_metricas m
  join quem_mede q on q.id = m.quem_mede_id
 where ic.metrica_id = m.id
   and coalesce(ic.quem_mede,'') = '';

-- Sobrou algo sem responsável? Estas são cadastro incompleto na Biblioteca
-- (métrica sem "Quem Mede") e continuam bloqueadas até o cadastro ser corrigido:
select ic.relatorio_id, ic.cota, ic.caracteristica
  from insp_caracteristicas ic
 where coalesce(ic.quem_mede,'') = ''
 order by ic.relatorio_id, ic.cota;

-- Cadastros da Biblioteca cujo "Quem Mede" não mapeia para nenhum cargo
-- (ex.: "Metrologia", "Eng. Produto"): corrigir na tela da Biblioteca Técnica.
select distinct q.nome
  from bib_metricas m join quem_mede q on q.id = m.quem_mede_id
 where quem_mede_para_cargo(q.nome) is null;


-- ============================================================================
-- C) LEITURA GARANTIDA (item 13 — o Auditor precisa ENXERGAR o que o autoriza)
-- ============================================================================
-- Catálogo "Quem Mede" e métricas são LEITURA de referência: sem SELECT aqui o
-- rótulo não chega à tela e toda característica vira "Sem responsável".
grant select on public.quem_mede            to authenticated;
grant select on public.bib_metricas         to authenticated;
grant select on public.bib_pecas            to authenticated;
grant select on public.caracteristicas_ml   to authenticated;
grant select on public.equipamentos_medicao to authenticated;
grant select on public.insp_caracteristicas to authenticated;

alter table quem_mede    enable row level security;
alter table bib_metricas enable row level security;

drop policy if exists quem_mede_select on quem_mede;
create policy quem_mede_select on quem_mede
  for select to authenticated using (true);

drop policy if exists bib_metricas_select on bib_metricas;
create policy bib_metricas_select on bib_metricas
  for select to authenticated using (true);

-- O usuário precisa ler o PRÓPRIO perfil (é de onde sai o cargo). Sem isto o
-- sistema não resolve o cargo e bloqueia tudo com "sem cargo identificado".
drop policy if exists usuarios_select_self on usuarios;
create policy usuarios_select_self on usuarios
  for select to authenticated
  using (auth_id = auth.uid() or lower(email) = auth_email());

-- A reidratação do snapshot também acontece pelo app (services/inspecao.js).
-- Para ela persistir, quem mede precisa poder atualizar a característica do
-- relatório em que atua. É um UPDATE restrito: só o campo de responsável em
-- relatório NÃO finalizado. Se preferir manter a escrita só pelo SQL acima,
-- pule este bloco — o app continua corrigindo a exibição em memória.
drop policy if exists insp_car_update_quem_mede on insp_caracteristicas;
create policy insp_car_update_quem_mede on insp_caracteristicas
  for update to authenticated
  using (exists (select 1 from insp_relatorios r
                  where r.id = insp_caracteristicas.relatorio_id
                    and coalesce(r.status,'') not like 'finalizada%'
                    and coalesce(r.status,'') <> 'revisada'))
  with check (true);


-- ============================================================================
-- D) A REGRA NO BANCO (revalida o que a UI já decidiu — item 14)
-- ============================================================================
-- pode_editar_medicao / pode_editar_medicao_atual e as policies de
-- insp_medicoes já vêm de controle_medicao_por_cargo.sql (SEÇÕES 4 e 5) e
-- passam a usar automaticamente o quem_mede_para_cargo corrigido acima.
-- Confirme que estão no ar:
select proname from pg_proc
 where proname in ('quem_mede_para_cargo','pode_editar_medicao','pode_editar_medicao_atual','supervisor_pode_medir');

select policyname, cmd from pg_policies
 where tablename in ('insp_medicoes','insp_caracteristicas','quem_mede','usuarios')
 order by tablename, policyname;


-- ============================================================================
-- E) POLICY "ALL" ANULANDO A REGRA DE CARGO   ⚠️  VERIFICAR ANTES DE APLICAR
-- ----------------------------------------------------------------------------
-- Policies PERMISSIVAS do mesmo comando são combinadas com OR. `insp_med_write`
-- é ALL, logo também vale para INSERT e UPDATE: o banco aceita a escrita se
-- `insp_med_write` OU `insp_medicoes_insert` passar. Se `insp_med_write` for
-- permissiva e ampla, a checagem de cargo de `insp_medicoes_insert/update` NÃO
-- está valendo — a regra existiria só na UI, que é justamente o que não se quer.
--
-- E1) Diagnóstico — olhe `permissive`, `qual` e `with_check`:
select policyname, cmd, permissive, roles, qual, with_check
  from pg_policies
 where tablename = 'insp_medicoes'
 order by policyname;

-- E1-RESULTADO (verificado em produção em 05/08/2026):
--   insp_med_write | ALL | PERMISSIVE | authenticated
--   qual/with_check = "relatório aberto OR current_perfil() in (admin,supervisor)"
--   → NÃO cita pode_editar_medicao_atual. Confirmado: a regra de cargo NÃO está
--     valendo no banco; qualquer autenticado grava medição de qualquer área.
--     Aplicar E2.
--
-- ⚠️  PRÉ-REQUISITOS — nesta ordem, sem pular:
--   (1) o backfill da seção A já rodou e a query abaixo devolve 0. Enquanto
--       houver característica sem quem_mede, a policy restritiva NEGA a escrita
--       dela no banco mesmo com a tela liberada (o app reidrata em memória, e a
--       persistência pode não ter alcançado tudo). Aplicar E2 antes disso troca
--       o cadeado da UI por um erro de gravação — pior para o auditor.
--         select count(*) from insp_caracteristicas
--          where coalesce(quem_mede,'') = '' and metrica_id is not null;
--   (2) a query E4 devolve 1 linha com o cargo certo (logada como o Auditor).
--
-- ⚠️  MUDANÇA DE COMPORTAMENTO: hoje `insp_med_write` deixa SUPERVISOR gravar
--     medição (inclusive em relatório finalizado). Com E2 o supervisor deixa de
--     gravar — que é a regra oficial (SUPERVISOR_PODE_MEDIR = false, espelhada em
--     supervisor_pode_medir()). Se você quiser manter o supervisor medindo, troque
--     a função para `select true` ANTES de aplicar, e ajuste a constante em
--     services/quem-mede.js para as duas pontas continuarem iguais.
--
-- E2) Bloco de correção.
--
--     A correção usa policies RESTRICTIVE: elas são combinadas com AND por cima
--     do OR das permissivas. Assim `insp_med_write` continua existindo (nada é
--     removido, nenhum fluxo atual quebra) e, ainda assim, NENHUMA escrita passa
--     sem o cargo correto. Admin continua liberado porque
--     pode_editar_medicao_atual() devolve true para ele.
--
--     Rode as duas juntas — uma sem a outra deixa metade do caminho aberto.

-- drop policy if exists insp_med_cargo_insert on insp_medicoes;
-- create policy insp_med_cargo_insert on insp_medicoes
--   as restrictive for insert to authenticated
--   with check (pode_editar_medicao_atual(insp_medicoes.caracteristica_id));
--
-- drop policy if exists insp_med_cargo_update on insp_medicoes;
-- create policy insp_med_cargo_update on insp_medicoes
--   as restrictive for update to authenticated
--   using       (pode_editar_medicao_atual(insp_medicoes.caracteristica_id))
--   with check  (pode_editar_medicao_atual(insp_medicoes.caracteristica_id));

-- NOTA — DELETE fica de fora de propósito: a troca de peça no relatório apaga as
-- medições antigas (services/inspecao.js), e uma restritiva de DELETE por cargo
-- quebraria esse fluxo. `insp_med_write` continua respondendo pelo DELETE.

-- E3) TESTE OBRIGATÓRIO depois de aplicar (logado como o Auditor, pelo app):
--     · gravar uma medição de "G. Qualidade"        -> deve SALVAR
--     · gravar uma medição de "Recebimento"          -> deve ser NEGADA pelo banco
--     Se a primeira falhar, remova as duas policies restritivas e me avise: é
--     sinal de que pode_editar_medicao_atual() não está resolvendo o usuário
--     (ver E4) — e nesse caso o Auditor fica sem conseguir medir NADA.

-- E4) pode_editar_medicao_atual() localiza o usuário por auth_id/email.
--     ATENÇÃO: NÃO tente validar isto pelo SQL Editor — lá a sessão é `postgres`,
--     auth.uid() é NULL e auth_email() não resolve; a query voltaria vazia mesmo
--     com tudo correto. Use E4a/E4b, que não dependem de sessão.

-- E4a) A REGRA em si, sem depender de login: a variante que recebe o usuário.
--      Troque os dois ids. Deve voltar TRUE para uma característica de
--      G. Qualidade e FALSE para uma de Recebimento/Laboratório.
--        select ic.id, ic.cota, ic.caracteristica, ic.quem_mede,
--               quem_mede_para_cargo(ic.quem_mede)               as cargo_responsavel,
--               pode_editar_medicao('<uuid_do_auditor>', ic.id)  as auditor_pode
--          from insp_caracteristicas ic
--         where ic.relatorio_id = '<id_do_relatorio>'
--         order by ic.cota;

-- E4b) O VÍNCULO da sessão: a linha de `usuarios` precisa ter auth_id igual ao
--      id em auth.users, OU o mesmo e-mail (é o outro braço do OR da função).
--        select u.id, u.nome, u.role::text as cargo, u.auth_id,
--               a.id as auth_users_id,
--               (u.auth_id = a.id) as vinculo_por_auth_id,
--               (lower(u.email) = lower(a.email)) as vinculo_por_email
--          from usuarios u
--          left join auth.users a on lower(a.email) = lower(u.email)
--         where lower(u.email) = lower('<email_do_auditor>');
--      Se as DUAS colunas de vínculo vierem false/null, pode_editar_medicao_atual()
--      devolve false para tudo e o E2 bloquearia o auditor inteiro. Corrija o
--      auth_id antes (update usuarios set auth_id = '<id_em_auth.users>' where ...).


-- ============================================================================
-- VERIFICAÇÃO FINAL (rode como o usuário Auditor logado, se possível)
-- ============================================================================
-- Deve voltar 0:
-- select count(*) from insp_caracteristicas
--  where coalesce(quem_mede,'') = '' and metrica_id is not null;
--
-- Deve voltar true para uma característica de G. Qualidade:
-- select pode_editar_medicao_atual('<id_da_caracteristica>');
