/* ==========================================================================
   RNA One — Motor de Auditorias Dimensionais
   Regras de negócio da inspeção dimensional (§9-11, §20-25):
     • cálculo automático por medição, por característica e geral
     • numeração única do relatório (sequencial no "banco")
     • especificações vindas da Biblioteca Técnica (somente leitura)
     • autosave, finalização/bloqueio, histórico e stream de eventos
   Nenhum resultado é escolhido manualmente — tudo é derivado das medições.
   Persistência 100% via db.js (demo ou Supabase, sem alteração).
   ========================================================================== */
import { db } from './db.js';
import { ficha, catalogosEspec, ehInformativo, ehAtributo } from './biblioteca.js';
import { PLANTA_SIGLAS, INSP_STATUS } from './inspecao-data.js';

export function nowISO() { return new Date().toISOString(); }
export function hoje() { return new Date().toISOString().slice(0, 10); }
export function anoAtual() { return new Date().getFullYear(); }

/* Converte "10,25" → 10.25; vazio/nulo → null; não-número → null. */
export function num(v) {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return Number.isNaN(n) ? null : n;
}

/* ============================================================ CÁLCULO (§9-11)
   O auditor NUNCA define aprovado/reprovado — estas funções são a única fonte. */

/** Avalia atributo OK/NOK → aprovado/reprovado/pendente. */
export function avaliarAtributo(valor) {
  const s = String(valor ?? '').trim().toUpperCase();
  if (s === 'OK') return 'aprovado';
  if (s === 'NOK' || s === 'NOK.' || s === 'NÃO OK' || s === 'NAO OK') return 'reprovado';
  return 'pendente';
}

/** Uma medição: 'aprovado' | 'reprovado' | 'pendente' (limites inclusivos, §9).
    `tipo` opcional: 'ATRIBUTO' avalia OK/NOK; demais usam limites numéricos. */
export function avaliarMedicao(valor, minimo, maximo, tipo) {
  if (tipo === 'ATRIBUTO') return avaliarAtributo(valor);
  const v = num(valor);
  if (v == null) return 'pendente';
  const min = num(minimo), max = num(maximo);
  if (min != null && v < min) return 'reprovado';
  if (max != null && v > max) return 'reprovado';
  return 'aprovado';
}

/** Resultado da característica (linha): todas aprovadas → aprovado; qualquer
    reprovada → reprovado; senão pendente (§10). `medicoes` = ['aprovado',...]. */
export function resultadoCaracteristica(medicoes) {
  if (!medicoes.length) return 'pendente';
  if (medicoes.some(r => r === 'reprovado')) return 'reprovado';
  if (medicoes.every(r => r === 'aprovado')) return 'aprovado';
  return 'pendente';
}

/** Resultado geral do relatório (§11): uma reprovada reprova tudo. */
export function resultadoGeral(resultadosCaracteristicas) {
  if (!resultadosCaracteristicas.length) return 'pendente';
  if (resultadosCaracteristicas.some(r => r === 'reprovado')) return 'reprovado';
  if (resultadosCaracteristicas.every(r => r === 'aprovado')) return 'aprovado';
  return 'pendente';
}

/* ==================================================== NUMERAÇÃO ÚNICA (§25)
   Formato DIM-<PLANTA>-<ANO>-<SEQ 6 dígitos>. Sequencial "no banco":
   demo = tabela insp_seq; Supabase = RPC next_insp_seq (ver migration). */
export function plantaSigla(planta) {
  if (PLANTA_SIGLAS[planta]) return PLANTA_SIGLAS[planta];
  const t = String(planta || 'GEN').normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/^Planta\s+/i, '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return (t.slice(0, 3) || 'GEN');
}

/* Sequencial atômico por chave (reaproveitado pela numeração do relatório e da
   pendência). Supabase: RPC next_insp_seq; demo: contador em insp_seq. */
async function proximoSeq(chave) {
  if (db.mode === 'supabase') {
    try {
      const { getSupabase } = await import('./supabaseClient.js');
      const sb = await getSupabase();
      const { data, error } = await sb.rpc('next_insp_seq', { p_chave: chave });
      if (!error && data != null) return Number(data);
    } catch { /* cai no fallback abaixo */ }
  }
  const seqs = await db.list('insp_seq');
  const atual = seqs.find(s => s.chave === chave);
  let valor;
  if (atual) { valor = (atual.valor || 0) + 1; await db.update('insp_seq', atual.id, { valor }); }
  else { valor = 1; await db.insert('insp_seq', { chave, valor }); }
  return valor;
}

export async function proximoNumero(planta) {
  const chave = `DIM-${plantaSigla(planta)}-${anoAtual()}`;
  return `${chave}-${String(await proximoSeq(chave)).padStart(6, '0')}`;
}

/* Numeração única da pendência (§Regra 4/7): PEND-<ANO>-<SEQ 6 dígitos>. */
export async function proximoNumeroPendencia() {
  const chave = `PEND-${anoAtual()}`;
  return `${chave}-${String(await proximoSeq(chave)).padStart(6, '0')}`;
}

/* ============================================================== CATÁLOGOS -- */
export async function tiposDisponiveis() {
  return (await db.list('insp_tipos')).filter(t => t.ativo !== false)
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
}
export async function classes() {
  return (await db.list('insp_classes')).filter(c => c.ativo !== false)
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
}
export async function classePorCodigo(codigo) {
  return (await db.list('insp_classes')).find(c => c.codigo === codigo) || null;
}

/* ========================================================= CRIAR RELATÓRIO
   Dados do auditor e do plantão vêm da sessão/servidor (§18) — nunca digitados. */
export async function criarRelatorio({ user, plantao, tipo }) {
  const planta = plantao?.planta || user.planta || '';
  const numero = await proximoNumero(planta);
  const rel = await db.insert('insp_relatorios', {
    numero,
    tipo_id: tipo.id, tipo_slug: tipo.slug, tipo_nome: tipo.nome, is_dimensional: tipo.is_dimensional !== false,
    // peça (preenchido na etapa de seleção)
    peca_id: null, peca_codigo: '', peca_nome: '', cliente: '',
    revisao_desenho: '', data_revisao_desenho: '', numero_ad: '', quadrante: '',
    // identificação
    quantidade: null, lote: '', op: '',
    campos_opcionais: {},                       // data_fabricacao, linha, turno, maquina, fornecedor...
    // contexto operacional
    planta, linha: '', turno: plantao?.turno || '',
    plantao_id: plantao?.id || null,
    // auditor (sessão)
    auditor_id: user.id, auditor_nome: user.nome, auditor_matricula: user.matricula || '', auditor_email: user.email || '',
    auditor_perfil: user.role || '',
    // estado
    status: 'rascunho', resultado: 'pendente', etapa: 0,
    started_iso: nowISO(), updated_iso: nowISO(), completed_iso: null, duracao_seg: null,
    created_at: hoje()
  });
  await registrarEvento({ relatorio: rel, tipo_evento: 'inspection_created', metadata: { numero, tipo: tipo.nome } });
  await registrarHistorico(rel.id, user, 'Criou', '—', '—', 'Inspeção criada');
  return rel;
}

/* Atualização genérica com carimbo de updated_iso + evento de auto-save. */
export async function patchRelatorio(relatorioId, patch, { evento } = {}) {
  const r = await db.update('insp_relatorios', relatorioId, { ...patch, updated_iso: nowISO() });
  if (evento) await registrarEvento({ relatorio: r, tipo_evento: evento });
  return r;
}

/* ============================================ ESPECIFICAÇÕES DA BIBLIOTECA (§5)
   Snapshot das características da peça em insp_caracteristicas (somente leitura
   durante a inspeção). Retorna a quantidade de características carregadas;
   0 = peça sem especificações → o chamador bloqueia o avanço (§5). */
export async function carregarEspecs(relatorioId, pecaId) {
  const [f, cat] = await Promise.all([ficha(pecaId), catalogosEspec()]);
  if (!f) return 0;
  const p = f.peca;
  // grava dados da peça no relatório
  await patchRelatorio(relatorioId, {
    peca_id: p.id, peca_codigo: p.codigo, peca_nome: p.nome, cliente: p.cliente || '',
    revisao_desenho: p.revisao_desenho ?? '', data_revisao_desenho: p.data_revisao_desenho || '',
    numero_ad: p.numero_ad || '', quadrante: p.quadrante || ''
  });
  // remove características antigas (troca de peça)
  const antigas = await db.list('insp_caracteristicas', { filter: { relatorio_id: relatorioId } });
  for (const c of antigas) {
    const meds = await db.list('insp_medicoes', { filter: { caracteristica_id: c.id } });
    for (const m of meds) await db.remove('insp_medicoes', m.id);
    await db.remove('insp_caracteristicas', c.id);
  }
  // snapshot das métricas (bib_metricas) — congela limites (§21, auditor não altera).
  // Carrega o tipo da especificação: ATRIBUTO vira OK/NOK; REFERENCIA é informativa
  // (não recebe medição nem entra na conformidade).
  let ordem = 0;
  for (const m of f.metricas) {
    ordem++;
    const tipo = m.tipo_especificacao || 'TOLERANCIA';
    const informativo = ehInformativo(tipo);
    const atributo = ehAtributo(tipo);
    await db.insert('insp_caracteristicas', {
      relatorio_id: relatorioId, metrica_id: m.id,
      cota: m.cota ?? ordem, quadrante: m.quadrante || p.quadrante || '',
      caracteristica: cat.carMap[m.caracteristica_id] || m.caracteristica || '—',
      referencia: m.referencia || '',
      unidade: m.unidade || '',
      nominal: (informativo || atributo) ? null : (m.nominal ?? null),
      minimo: (informativo || atributo) ? null : (m.tol_min ?? null),
      maximo: (informativo || atributo) ? null : (m.tol_max ?? null),
      equipamento: cat.eqMap[m.equipamento_id] || m.equipamento || '',
      observacao_tec: m.observacao || '',
      tipo_especificacao: tipo,
      tipo_campo: atributo ? 'atributo' : 'numerico',
      informativo,
      opcoes: atributo ? ['OK', 'NOK'] : null,
      // informativas já nascem "aprovadas" para não travar a finalização, mas são
      // excluídas de todos os cálculos/indicadores (ver resumo/resultadoGeral).
      resultado: informativo ? 'aprovado' : 'pendente', classe_defeito: null, observacao: '', ordem
    });
  }
  await registrarEvento({ relatorio: { id: relatorioId, auditor_id: null }, tipo_evento: 'part_selected', metadata: { peca: p.codigo, caracteristicas: f.metricas.length } });
  return f.metricas.length;
}

/* ============================================================ MEDIÇÕES (§8-9)
   Autosave: grava a medição, recalcula a característica e o resultado geral. */
export async function salvarMedicao(relatorioId, caracteristicaId, amostra, valor) {
  const car = await db.get('insp_caracteristicas', caracteristicaId);
  if (!car) return null;
  if (car.informativo) return null;                        // REFERENCIA não recebe medição
  const resultado = avaliarMedicao(valor, car.minimo, car.maximo, car.tipo_especificacao);
  const existentes = await db.list('insp_medicoes', { filter: { caracteristica_id: caracteristicaId } });
  const ex = existentes.find(m => m.amostra === amostra);
  const payload = { relatorio_id: relatorioId, caracteristica_id: caracteristicaId, amostra, valor: (valor ?? ''), resultado, medido_iso: nowISO() };
  let novo;
  if (ex) { novo = await db.update('insp_medicoes', ex.id, payload); }
  else { novo = await db.insert('insp_medicoes', payload); }
  await recalcularCaracteristica(caracteristicaId);
  await recalcularRelatorio(relatorioId);
  // evento p/ o Monitoramento
  const evTipo = ex ? 'measurement_updated' : 'measurement_created';
  await registrarEvento({ relatorio: { id: relatorioId, auditor_id: car.relatorio_id }, tipo_evento: evTipo, caracteristica_id: caracteristicaId, amostra, metadata: { valor, resultado } });
  if (resultado === 'reprovado') await registrarEvento({ relatorio: { id: relatorioId }, tipo_evento: 'measurement_rejected', caracteristica_id: caracteristicaId, amostra, metadata: { valor } });
  return novo;
}

export async function recalcularCaracteristica(caracteristicaId) {
  const car = await db.get('insp_caracteristicas', caracteristicaId);
  if (!car) return;
  const meds = await db.list('insp_medicoes', { filter: { caracteristica_id: caracteristicaId } });
  const resultado = resultadoCaracteristica(meds.map(m => m.resultado));
  const patch = { resultado };
  // se voltou a aprovada/pendente, limpa a classe de defeito
  if (resultado !== 'reprovado' && car.classe_defeito) patch.classe_defeito = null;
  await db.update('insp_caracteristicas', caracteristicaId, patch);
  return resultado;
}

export async function recalcularRelatorio(relatorioId) {
  const todas = await db.list('insp_caracteristicas', { filter: { relatorio_id: relatorioId } });
  const cars = todas.filter(c => !c.informativo);          // REFERENCIA não entra no resultado
  const geral = resultadoGeral(cars.map(c => c.resultado));
  const rel = await db.get('insp_relatorios', relatorioId);
  const status = (rel && String(rel.status).startsWith('finalizada')) ? rel.status
    : (cars.some(c => c.resultado !== 'pendente') ? 'em_andamento' : (rel?.status || 'rascunho'));
  await db.update('insp_relatorios', relatorioId, { resultado: geral, status, updated_iso: nowISO() });
  return geral;
}

/* Classe de defeito e observação da característica reprovada (§12). Não altera cálculo. */
export async function salvarClasse(caracteristicaId, classeCodigo) {
  return db.update('insp_caracteristicas', caracteristicaId, { classe_defeito: classeCodigo || null });
}
export async function salvarObservacao(caracteristicaId, observacao) {
  return db.update('insp_caracteristicas', caracteristicaId, { observacao: observacao ?? '' });
}

/* ============================================ QUANTIDADE DE AMOSTRAS (§6)
   Ao reduzir a quantidade, retorna as medições que SERÃO removidas para o
   chamador confirmar (nunca apaga silenciosamente). */
export async function medicoesAcimaDe(relatorioId, quantidade) {
  const meds = await db.list('insp_medicoes', { filter: { relatorio_id: relatorioId } });
  return meds.filter(m => m.amostra > quantidade && String(m.valor ?? '') !== '');
}
export async function aplicarQuantidade(relatorioId, quantidade) {
  const meds = await db.list('insp_medicoes', { filter: { relatorio_id: relatorioId } });
  const afetadas = new Set();
  for (const m of meds) if (m.amostra > quantidade) { await db.remove('insp_medicoes', m.id); afetadas.add(m.caracteristica_id); }
  await patchRelatorio(relatorioId, { quantidade });
  for (const cid of afetadas) await recalcularCaracteristica(cid);
  await recalcularRelatorio(relatorioId);
}

/* ================================================================ CARREGAR
   Relatório completo (cabeçalho + características + medições indexadas). */
export async function carregarRelatorio(relatorioId) {
  const rel = await db.get('insp_relatorios', relatorioId);
  if (!rel) return null;
  const [cars, meds, acoes, anexos] = await Promise.all([
    db.list('insp_caracteristicas', { filter: { relatorio_id: relatorioId } }),
    db.list('insp_medicoes',        { filter: { relatorio_id: relatorioId } }),
    db.list('insp_acoes',           { filter: { relatorio_id: relatorioId } }),
    db.list('insp_anexos',          { filter: { relatorio_id: relatorioId } })
  ]);
  const medBy = {};
  meds.forEach(m => (medBy[m.caracteristica_id] = medBy[m.caracteristica_id] || []).push(m));
  const caracteristicas = cars.sort((a, b) => (a.ordem || 0) - (b.ordem || 0))
    .map(c => ({ ...c, medicoes: (medBy[c.id] || []).sort((a, b) => a.amostra - b.amostra) }));
  return { rel, caracteristicas, acoes, anexos };
}

/* Lista os relatórios do auditor (Minhas Auditorias, §26). */
export async function meusRelatorios(userId) {
  return (await db.list('insp_relatorios')).filter(r => r.auditor_id === userId)
    .sort((a, b) => String(b.started_iso).localeCompare(String(a.started_iso)));
}

/* ============================================ CONSULTA CORPORATIVA (§27-30)
   Filtros combináveis. `escopo` limita por perfil/planta quando aplicável. */
export async function consultarRelatorios(filtros = {}, escopo = {}) {
  let rows = await db.list('insp_relatorios');
  // escopo por perfil: auditor vê os seus; supervisor/gestor/admin veem conforme planta
  if (escopo.somenteAuditor) rows = rows.filter(r => r.auditor_id === escopo.somenteAuditor);
  else if (escopo.plantas?.length) rows = rows.filter(r => !r.planta || escopo.plantas.includes(r.planta));

  const norm = s => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const like = (v, q) => norm(v).includes(norm(q));
  /* revisão tolerante a formato: "01" ≡ "1" ≡ "Rev. 01" ≡ "REV01" */
  const normRev = v => { const s = String(v ?? '').trim().replace(/^rev\.?\s*/i, ''); return /^\d+$/.test(s) ? String(parseInt(s, 10)) : norm(s).trim(); };
  const f = filtros;
  rows = rows.filter(r => {
    if (f.cliente && !like(r.cliente, f.cliente)) return false;
    if (f.pn && !like(r.peca_codigo, f.pn)) return false;
    if (f.auditor && !like(r.auditor_nome, f.auditor)) return false;
    if (f.lote && !like(r.lote, f.lote)) return false;
    if (f.op && !like(r.op, f.op)) return false;
    if (f.revisao && normRev(r.revisao_desenho) !== normRev(f.revisao)) return false;
    if (f.numero && !like(r.numero, f.numero)) return false;
    if (f.tipo && r.tipo_id !== f.tipo) return false;
    if (f.planta && r.planta !== f.planta) return false;
    if (f.turno && r.turno !== f.turno) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.resultado && r.resultado !== f.resultado) return false;
    if (f.de && String(r.started_iso).slice(0, 10) < f.de) return false;
    if (f.ate && String(r.started_iso).slice(0, 10) > f.ate) return false;
    return true;
  });
  // criticidade máxima (Classe A > B > C) para exibição/filtro
  const cars = await db.list('insp_caracteristicas');
  const carsBy = {};
  cars.forEach(c => (carsBy[c.relatorio_id] = carsBy[c.relatorio_id] || []).push(c));
  rows = rows.map(r => {
    const cs = (carsBy[r.id] || []).filter(c => c.resultado === 'reprovado');
    const classes = new Set(cs.map(c => c.classe_defeito).filter(Boolean));
    const maior = classes.has('A') ? 'A' : classes.has('B') ? 'B' : classes.has('C') ? 'C' : null;
    return { ...r, _reprovacoes: cs.length, _maiorClasse: maior };
  });
  if (f.classe) rows = rows.filter(r => r._maiorClasse === f.classe);
  if (f.comReprovacao) rows = rows.filter(r => r._reprovacoes > 0);
  return rows.sort((a, b) => String(b.started_iso).localeCompare(String(a.started_iso)));
}

/* Formata segundos → "1h 12m 03s" / "12m 03s". */
export function fmtDuracao(seg) {
  if (seg == null) return '—';
  const h = Math.floor(seg / 3600), m = Math.floor(seg % 3600 / 60), s = seg % 60;
  return (h ? `${h}h ` : '') + (h || m ? `${String(m).padStart(2, '0')}m ` : '') + `${String(s).padStart(2, '0')}s`;
}

/* ================================================================ RESUMO (§22) */
export async function resumoRelatorio(relatorioId) {
  const { rel, caracteristicas: todas } = await carregarRelatorio(relatorioId);
  const caracteristicas = todas.filter(c => !c.informativo);   // informativas fora dos indicadores
  const totalCar = caracteristicas.length;
  const carAprov = caracteristicas.filter(c => c.resultado === 'aprovado').length;
  const carReprov = caracteristicas.filter(c => c.resultado === 'reprovado').length;
  const meds = caracteristicas.flatMap(c => c.medicoes);
  const medAprov = meds.filter(m => m.resultado === 'aprovado').length;
  const medReprov = meds.filter(m => m.resultado === 'reprovado').length;
  const classe = cod => caracteristicas.filter(c => c.resultado === 'reprovado' && c.classe_defeito === cod).length;
  const conformidade = totalCar ? Math.round(carAprov / totalCar * 100) : 0;
  return {
    totalCaracteristicas: totalCar, caracteristicasAprovadas: carAprov, caracteristicasReprovadas: carReprov,
    totalMedicoes: meds.length, medicoesAprovadas: medAprov, medicoesReprovadas: medReprov,
    amostras: rel.quantidade || 0, conformidade,
    classeA: classe('A'), classeB: classe('B'), classeC: classe('C'),
    resultado: rel.resultado, duracaoSeg: rel.duracao_seg
  };
}

/* ============================================================ FINALIZAÇÃO (§20)
   Retorna { ok, faltas:[...] }. Bloqueia enquanto houver campo obrigatório. */
export async function validarFinalizacao(relatorioId) {
  const { rel, caracteristicas } = await carregarRelatorio(relatorioId);
  const faltas = [];
  if (!rel.tipo_id) faltas.push({ etapa:'Tipo e peça', msg:'Selecione o tipo de inspeção' });
  if (!rel.peca_id) faltas.push({ etapa:'Tipo e peça', msg:'Selecione a peça' });
  if (!rel.quantidade) faltas.push({ etapa:'Amostras', msg:'Selecione a quantidade de peças' });
  if (!String(rel.lote || '').trim()) faltas.push({ etapa:'Identificação', msg:'Informe o lote' });
  if (!String(rel.op || '').trim()) faltas.push({ etapa:'Identificação', msg:'Informe a OP' });
  // medições obrigatórias — a inspeção só finaliza com todas as amostras medidas
  const qtd = rel.quantidade || 0;
  let semMedicao = 0;
  caracteristicas.filter(c => !c.informativo).forEach(c => {   // informativas não exigem medição
    for (let a = 1; a <= qtd; a++) {
      const m = c.medicoes.find(x => x.amostra === a);
      if (!m || String(m.valor ?? '') === '') semMedicao++;
    }
  });
  if (semMedicao) faltas.push({ etapa:'Medições', msg:`${semMedicao} medição(ões) não preenchida(s)` });
  /* NOVO FLUXO (§Regra 3): a reprovação NÃO bloqueia a finalização. A inspeção
     sempre conclui e gera relatório; havendo reprovação, o tratamento (classe,
     observação, ações) é opcional e a pendência é criada automaticamente ao
     finalizar (ver finalizar → criarPendenciaDoRelatorio). */
  return { ok: faltas.length === 0, faltas };
}

export async function finalizar(relatorioId, user) {
  const val = await validarFinalizacao(relatorioId);
  if (!val.ok) return { ok: false, faltas: val.faltas };
  const rel = await db.get('insp_relatorios', relatorioId);
  const geral = await recalcularRelatorio(relatorioId);
  const status = geral === 'reprovado' ? 'finalizada_reprovada' : 'finalizada_aprovada';
  const dur = Math.max(0, Math.round((Date.now() - new Date(rel.started_iso || Date.now()).getTime()) / 1000));
  // rastreabilidade completa (§Regra 8) — congelada no relatório ao finalizar
  const s = await resumoRelatorio(relatorioId);
  const rastreio = {
    medicoes: s.totalMedicoes,
    caracteristicas: s.totalCaracteristicas,
    aprovadas: s.caracteristicasAprovadas,
    reprovadas: s.caracteristicasReprovadas,
    pct_aprovacao: s.conformidade,
    pct_reprovacao: s.totalCaracteristicas ? Math.round(s.caracteristicasReprovadas / s.totalCaracteristicas * 100) : 0
  };
  /* PASSO 1 — atualizar auditoria → FINALIZADA. O núcleo (status/resultado) é
     garantido; `rastreio` é best-effort: se a coluna ainda não existe no Supabase
     (migração não rodada), regrava só o núcleo em vez de falhar silenciosamente. */
  const nucleo = { status, resultado: geral, completed_iso: nowISO(), duracao_seg: dur, updated_iso: nowISO() };
  let atualizado;
  try {
    atualizado = await db.update('insp_relatorios', relatorioId, { ...nucleo, rastreio });
  } catch (e) {
    console.warn('[INSP] Não gravou "rastreio" (coluna ausente?). Regravando o núcleo. Detalhe:', e?.message || e);
    atualizado = await db.update('insp_relatorios', relatorioId, nucleo);   // se ISTO falhar, propaga (erro real do PASSO 1)
  }
  // PASSO 2 — relatório gerado. Telemetria/histórico não podem derrubar a finalização.
  try {
    await registrarEvento({ relatorio: atualizado, tipo_evento: 'inspection_completed', metadata: { resultado: geral } });
    await registrarEvento({ relatorio: atualizado, tipo_evento: 'report_generated' });
    await registrarHistorico(relatorioId, user, 'Finalizou', 'status', 'em andamento', INSP_STATUS[status].label);
  } catch (e) { console.warn('[INSP] Evento/histórico da finalização não gravado:', e?.message || e); }
  // PASSO 3 — reprovação gera pendência automática. Falha aqui NÃO desfaz a
  // finalização: retorna pendenciaErro para a UI avisar (backfill tenta depois).
  let pendencia = null, pendenciaErro = null;
  if (geral === 'reprovado') {
    try { pendencia = await criarPendenciaDoRelatorio(atualizado, user); }
    catch (e) { console.error('[INSP] Falha ao criar pendência:', e); pendenciaErro = e?.message || 'Erro ao criar pendência'; }
  }
  return { ok: true, relatorio: atualizado, pendencia, pendenciaErro };
}

/* ============================================ PENDÊNCIA AUTOMÁTICA (§Regra 4-7)
   Uma pendência consolidada por relatório reprovado, com número próprio e
   vínculo bidirecional (relatório ↔ pendência). Idempotente: não duplica. */
export async function pendenciaDoRelatorio(relatorioId) {
  const list = await db.list('op_pendencias').catch(() => []);
  return list.find(p => p.relatorio_id === relatorioId) || null;
}

export async function criarPendenciaDoRelatorio(rel, user) {
  const existente = await pendenciaDoRelatorio(rel.id);
  if (existente) return existente;                      // não gera duas vezes
  const { caracteristicas, anexos } = await carregarRelatorio(rel.id);
  const reprovadas = caracteristicas.filter(c => c.resultado === 'reprovado');
  if (!reprovadas.length) return null;
  const o = rel.campos_opcionais || {};
  const numero = await proximoNumeroPendencia();
  const ref = rel.completed_iso || rel.started_iso || nowISO();
  const dataBR = ref.slice(0, 10).split('-').reverse().join('/');
  const horaBR = ref.slice(11, 16);
  const val = v => (v == null || v === '') ? '—' : String(v).replace('.', ',');
  const detalhes = reprovadas.map(c => ({
    caracteristica: c.caracteristica, cota: c.cota ?? '—', classe: c.classe_defeito || null,
    limite: `${val(c.minimo)} a ${val(c.maximo)} ${c.unidade || ''}`.trim(),
    amostras: c.medicoes.filter(m => m.resultado === 'reprovado').map(m => `#${m.amostra}=${val(m.valor)}`).join(', '),
    observacao: c.observacao || ''
  }));
  const descricao = `Reprovação dimensional no relatório ${rel.numero}: ${reprovadas.length} característica(s) reprovada(s) — ` +
    `${detalhes.map(d => d.caracteristica).join(', ')}. Cliente ${rel.cliente || '—'} · PN ${rel.peca_codigo || '—'} · ` +
    `Lote ${rel.lote || '—'} · OP ${rel.op || '—'}.`;
  const dados = {
    cliente: rel.cliente || '', part_number: rel.peca_codigo || '', revisao: rel.revisao_desenho ?? '',
    lote: rel.lote || '', op: rel.op || '', auditor: rel.auditor_nome || '', data: dataBR, hora: horaBR,
    planta: rel.planta || '', maquina: o.maquina || '', operacao: o.operacao || rel.linha || o.linha || '',
    caracteristicas_reprovadas: detalhes, qtd_reprovadas: reprovadas.length,
    fotos: anexos.length, observacoes: reprovadas.map(c => c.observacao).filter(Boolean).join(' | ')
  };
  const pend = await db.insert('op_pendencias', {
    numero, relatorio_id: rel.id, relatorio_numero: rel.numero, origem: 'inspecao_dimensional',
    atividade_id: null, execucao_id: null, plantao_id: rel.plantao_id || null,
    descricao, dados, status: 'aberta', aberta_por: rel.auditor_id || user?.id || null,
    responsavel: null, quando: nowISO()
  });
  // vínculo relatório→pendência é best-effort (colunas podem não existir ainda)
  try { await patchRelatorio(rel.id, { pendencia_id: pend.id, pendencia_numero: numero }); }
  catch (e) { console.warn('[INSP] Vínculo relatório→pendência não gravado (coluna ausente?):', e?.message || e); }
  try {
    await registrarEvento({ relatorio: rel, tipo_evento: 'corrective_action_created', metadata: { pendencia: numero } });
    await registrarHistorico(rel.id, user, 'Gerou pendência', 'pendencia', '—', numero, 'Pendência automática por reprovação');
  } catch (e) { console.warn('[INSP] Evento/histórico da pendência não gravado:', e?.message || e); }
  return pend;
}

/* Garante a pendência de um relatório reprovado (backfill de relatórios legados). */
export async function garantirPendencia(rel, user) {
  if (rel.status !== 'finalizada_reprovada' && rel.resultado !== 'reprovado') return null;
  return (await pendenciaDoRelatorio(rel.id)) || criarPendenciaDoRelatorio(rel, user);
}

/* ============================================ INDICADORES (§Regra 9)
   Consolidado da tela de Minhas Auditorias a partir da lista já carregada. */
export async function indicadoresAuditorias(rels) {
  const aprov = rels.filter(r => r.status === 'finalizada_aprovada').length;
  const reprov = rels.filter(r => r.status === 'finalizada_reprovada').length;
  const finalizadas = aprov + reprov;
  const tempos = rels.filter(r => r.duracao_seg != null).map(r => r.duracao_seg);
  const tempoMedio = tempos.length ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length) : null;
  const relIds = new Set(rels.map(r => r.id));
  const pend = (await db.list('op_pendencias').catch(() => []))
    .filter(p => p.origem === 'inspecao_dimensional' && relIds.has(p.relatorio_id)).length;
  return {
    total: rels.length, aprovadas: aprov, reprovadas: reprov, finalizadas, pendencias: pend, tempoMedio,
    taxaAprovacao: finalizadas ? Math.round(aprov / finalizadas * 100) : 0,
    taxaReprovacao: finalizadas ? Math.round(reprov / finalizadas * 100) : 0
  };
}

/* ============================================= REVISÃO PÓS-FINALIZAÇÃO (§21)
   Só supervisor/admin. Exige justificativa e mantém histórico (valor anterior). */
export async function revisarCampo(relatorioId, user, campo, novoValor, justificativa) {
  const rel = await db.get('insp_relatorios', relatorioId);
  const antes = rel?.[campo];
  const atualizado = await db.update('insp_relatorios', relatorioId, { [campo]: novoValor, status: 'revisada', updated_iso: nowISO() });
  await registrarHistorico(relatorioId, user, 'Revisou', campo, String(antes ?? '—'), String(novoValor ?? '—'), justificativa);
  await registrarEvento({ relatorio: atualizado, tipo_evento: 'report_corrected', metadata: { campo, justificativa } });
  return atualizado;
}

/* ================================================================ HISTÓRICO */
export async function registrarHistorico(relatorioId, user, acao, campo, antes, depois, justificativa = '') {
  return db.insert('insp_historico', {
    relatorio_id: relatorioId, user_id: user?.id || null, user_nome: user?.nome || 'Sistema',
    acao, campo, antes, depois, justificativa, quando: nowISO()
  });
}
export async function historicoDe(relatorioId) {
  return (await db.list('insp_historico', { filter: { relatorio_id: relatorioId } }))
    .sort((a, b) => String(a.quando).localeCompare(String(b.quando)));
}

/* =================================================== STREAM DE EVENTOS (§67)
   Base do Monitoramento Operacional. Horário confiável do servidor/ISO. */
export async function registrarEvento({ relatorio, tipo_evento, entidade_tipo = null, entidade_id = null, amostra = null, caracteristica_id = null, metadata = {} }) {
  try {
    await db.insert('insp_eventos', {
      relatorio_id: relatorio?.id || null,
      auditor_id: relatorio?.auditor_id || null,
      plantao_id: relatorio?.plantao_id || null,
      tipo_evento, entidade_tipo, entidade_id, amostra, caracteristica_id,
      quando: nowISO(), session_id: sessionId(), metadata
    });
  } catch { /* telemetria não deve quebrar o fluxo */ }
}
function sessionId() {
  try {
    let s = sessionStorage.getItem('rna_insp_session');
    if (!s) { s = 'sess-' + Math.random().toString(36).slice(2, 10); sessionStorage.setItem('rna_insp_session', s); }
    return s;
  } catch { return 'sess-anon'; }
}

/* ================================================================ AÇÕES/TRATAMENTO (§17) */
export async function salvarAcao(relatorioId, caracteristicaId, dados) {
  const list = await db.list('insp_acoes', { filter: { relatorio_id: relatorioId } });
  const ex = list.find(a => a.caracteristica_id === caracteristicaId);
  const payload = { relatorio_id: relatorioId, caracteristica_id: caracteristicaId, updated_iso: nowISO(), ...dados };
  return ex ? db.update('insp_acoes', ex.id, payload) : db.insert('insp_acoes', { ...payload, created_at: hoje(), status: dados.status || 'aberta' });
}
export async function acaoDaCaracteristica(relatorioId, caracteristicaId) {
  const list = await db.list('insp_acoes', { filter: { relatorio_id: relatorioId } });
  return list.find(a => a.caracteristica_id === caracteristicaId) || null;
}
