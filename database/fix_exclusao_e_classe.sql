-- ==========================================================================
-- RNA One — §Erro 09 (exclusão de relatório) e §Erro 10 (classe automática)
-- Rode UMA VEZ no SQL Editor do Supabase. Idempotente.
--
--   §Erro 09  RPC `insp_excluir_relatorio` — exclusão PERMANENTE de um
--             relatório dimensional e de tudo que dependia dele, numa única
--             TRANSAÇÃO, com o perfil de administrador revalidado no servidor.
--   §Erro 10  coluna `classe_nc` na Biblioteca Técnica (bib_metricas) e no
--             snapshot da auditoria (insp_caracteristicas): a classe da não
--             conformidade passa a pertencer à CARACTERÍSTICA.
--
-- Nada é apagado por este script. A classe começa nula ("não cadastrada"), que
-- é diferente de "não se aplica" — o sistema nunca assume A, B ou C sozinho.
-- ==========================================================================

begin;

-- ---------------------------------------------------------------- §Erro 10
alter table public.bib_metricas         add column if not exists classe_nc text;
alter table public.insp_caracteristicas add column if not exists classe_nc text;

-- Valores aceitos: A, B, C, NA (não se aplica) ou nulo (não cadastrada).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'bib_metricas_classe_nc_chk') then
    alter table public.bib_metricas
      add constraint bib_metricas_classe_nc_chk check (classe_nc is null or classe_nc in ('A','B','C','NA'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'insp_caracteristicas_classe_nc_chk') then
    alter table public.insp_caracteristicas
      add constraint insp_caracteristicas_classe_nc_chk check (classe_nc is null or classe_nc in ('A','B','C','NA'));
  end if;
end $$;

comment on column public.bib_metricas.classe_nc is
  'Classe da Não Conformidade (§Erro 10): A/B/C, NA = não se aplica, NULL = não cadastrada. '
  'Aplicada automaticamente pela inspeção quando a característica reprova.';
comment on column public.insp_caracteristicas.classe_nc is
  'Snapshot da classe cadastrada na Biblioteca no momento da auditoria — congela o histórico.';

-- Snapshot retroativo: auditorias em ANDAMENTO passam a enxergar a classe da
-- métrica de origem. Relatório finalizado NÃO é tocado (documento fechado).
update public.insp_caracteristicas c
   set classe_nc = m.classe_nc
  from public.bib_metricas m, public.insp_relatorios r
 where c.metrica_id = m.id
   and r.id = c.relatorio_id
   and r.status not in ('finalizada_aprovada','finalizada_reprovada','revisada')
   and c.classe_nc is distinct from m.classe_nc;

-- A classe passa a ser derivada: some de quem não está reprovado e passa a ser
-- a cadastrada em quem está (apenas relatórios abertos).
update public.insp_caracteristicas c
   set classe_defeito = case
         when c.resultado = 'reprovado' and c.classe_nc in ('A','B','C') then c.classe_nc
         else null end
  from public.insp_relatorios r
 where r.id = c.relatorio_id
   and r.status not in ('finalizada_aprovada','finalizada_reprovada','revisada')
   and c.classe_defeito is distinct from (case
         when c.resultado = 'reprovado' and c.classe_nc in ('A','B','C') then c.classe_nc
         else null end);

-- ---------------------------------------------------------------- §Erro 09
-- Exclusão transacional. SECURITY DEFINER para conseguir apagar as linhas
-- dependentes, mas com o perfil do CHAMADOR revalidado logo na entrada: sem
-- isso, "definer" viraria uma porta aberta para qualquer usuário autenticado.
create or replace function public.insp_excluir_relatorio(p_relatorio_id text, p_motivo text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role   text;
  v_numero text;
  v_out    jsonb := '{}'::jsonb;
  v_n      int;
begin
  -- 1) autenticação + perfil (a mesma regra da interface, agora no servidor)
  select u.role into v_role from public.usuarios u where u.id = auth.uid()::text;
  if v_role is distinct from 'admin' then
    raise exception 'Acesso negado.' using errcode = 'insufficient_privilege';
  end if;

  -- 2) o relatório precisa existir
  select numero into v_numero from public.insp_relatorios where id = p_relatorio_id;
  if v_numero is null then
    raise exception 'Relatório não encontrado.' using errcode = 'no_data_found';
  end if;

  -- 3) folhas → raiz, tudo na MESMA transação (a função é atômica por natureza:
  --    qualquer erro aqui desfaz todos os deletes anteriores).
  delete from public.op_pendencias
   where relatorio_id = p_relatorio_id and origem = 'inspecao_dimensional';
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('op_pendencias', v_n);

  delete from public.insp_medicoes       where relatorio_id = p_relatorio_id;
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('insp_medicoes', v_n);
  delete from public.insp_amostras       where relatorio_id = p_relatorio_id;
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('insp_amostras', v_n);
  delete from public.insp_acoes          where relatorio_id = p_relatorio_id;
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('insp_acoes', v_n);
  delete from public.insp_anexos         where relatorio_id = p_relatorio_id;
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('insp_anexos', v_n);
  delete from public.insp_caracteristicas where relatorio_id = p_relatorio_id;
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('insp_caracteristicas', v_n);
  delete from public.insp_historico      where relatorio_id = p_relatorio_id;
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('insp_historico', v_n);
  delete from public.insp_eventos        where relatorio_id = p_relatorio_id;
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('insp_eventos', v_n);
  delete from public.insp_pausas         where relatorio_id = p_relatorio_id;
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('insp_pausas', v_n);

  delete from public.insp_relatorios     where id = p_relatorio_id;
  get diagnostics v_n = row_count; v_out := v_out || jsonb_build_object('insp_relatorios', v_n);

  -- 4) trilha que SOBREVIVE ao relatório apagado (o cliente também registra;
  --    aqui garantimos o registro mesmo se o navegador cair no meio).
  insert into public.logs (usuario, acao, entidade, antes, depois)
  values (coalesce((select nome from public.usuarios where id = auth.uid()::text), auth.uid()::text),
          'Excluiu relatório dimensional ' || v_numero, 'insp_relatorios',
          v_numero, coalesce('Excluído — motivo: ' || p_motivo, 'Excluído — motivo não informado'));

  return v_out || jsonb_build_object('numero', v_numero);
end $$;

revoke all on function public.insp_excluir_relatorio(text, text) from public, anon;
grant execute on function public.insp_excluir_relatorio(text, text) to authenticated;

comment on function public.insp_excluir_relatorio(text, text) is
  'Exclusão permanente e transacional de um relatório dimensional (§Erro 09). '
  'Somente perfil admin; registra no log administrativo antes de retornar.';

commit;

-- ======================================================== CONFERÊNCIA MANUAL
-- Características que podem reprovar e ainda não têm classe cadastrada.
-- Use esta lista para completar o cadastro na Biblioteca Técnica.
select p.codigo as pn, p.nome as peca, m.cota, m.classe_nc
  from public.bib_metricas m
  join public.bib_pecas p on p.id = m.peca_id
 where m.classe_nc is null
   and coalesce(m.tipo_especificacao,'TOLERANCIA') <> 'REFERENCIA'
 order by p.codigo, m.cota;
