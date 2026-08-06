/* ==========================================================================
   RNA One — FECHAMENTO MENSAL · Núcleo (competências, status, auditoria)
   ---------------------------------------------------------------------------
   Responsabilidades:
     • criar/listar competências (§3) com a restrição planta+mês+ano
     • máquina de status (§4) e histórico (§42)
     • criação do próximo mês preservando o que é contínuo (§5)
     • fechamento, aprovação e reabertura formal (§46)
     • trilha de auditoria fm_logs (§45) — nunca derruba a operação que a gerou
     • guarda de edição: competência fechada é somente leitura (§15/§44.5)

   Em Supabase, as regras críticas (permissão, trava de fechada, reabertura)
   também existem no banco — este módulo NÃO é a única barreira (§44.9).
   ========================================================================== */
import { db } from '../db.js';
import { SUPABASE, PLANTAS } from '../config.js';
import { getSupabase, ehDesenvolvimento, projetoSupabase } from '../supabaseClient.js';
import { agoraISO, hojeBR } from '../datahora.js';
import {
  STATUS_COMPETENCIA, MESES, podeTransicionar, podeFechamento,
  SECOES, SECOES_PROGRESSO, colunaCompetencia
} from './fm-schema.js';

/* ------------------------------------------------------------------ erros */
/** Erro de negócio com mensagem pronta para o usuário (§49: nada de
    "Erro ao salvar" — a mensagem precisa dizer o que fazer). */
export class FmErro extends Error {
  constructor(mensagem, { causa = null, codigo = null } = {}) {
    super(mensagem);
    this.name = 'FmErro';
    this.causa = causa;
    this.codigo = codigo;
  }
}

/** Traduz falhas do PostgREST/Postgres em mensagens acionáveis. */
export function mensagemErro(e, contexto = '') {
  const msg = String(e?.message || e || '');
  const code = e?.code;
  if (code === '42P01' || /relation .* does not exist/i.test(msg)) {
    return `As tabelas do Fechamento Mensal não existem neste banco. Rode database/fechamento_mensal.sql no Supabase.${contexto ? ' (' + contexto + ')' : ''}`;
  }
  if (code === 'PGRST204' || /column .* does not exist/i.test(msg)) {
    return `O banco está atrás das migrations do módulo: ${msg}. Rode database/fechamento_mensal.sql novamente.`;
  }
  if (code === '42501' || /row-level security|violates row-level/i.test(msg)) {
    return 'Seu perfil não tem permissão para esta operação (bloqueio de segurança do banco).';
  }
  if (code === '23505' || /duplicate key/i.test(msg)) {
    return 'Já existe um registro com essa mesma chave. Verifique se não está duplicando o lançamento.';
  }
  if (/Competência fechada/i.test(msg)) {
    return 'Competência fechada: os registros estão em somente leitura. Reabra a competência para editar.';
  }
  return msg || 'Não foi possível concluir a operação.';
}

/* ----------------------------------------------------------------- helpers */
const ativo = r => !r.deleted_at;

/** Registro de auditoria (§45). Best-effort: a trilha NUNCA pode derrubar a
    operação de negócio que a originou (mesma decisão de db.log). */
export async function logar(entrada) {
  try {
    await db.insert('fm_logs', {
      quando: agoraISO(),
      dispositivo: typeof navigator !== 'undefined'
        ? `${navigator.platform || 'Web'} · ${location.hostname}` : 'servidor',
      ...entrada
    }, { returning: false });
    return { ok: true };
  } catch (e) {
    console.warn('[FM][LOG] trilha de auditoria não gravada', {
      acao: entrada?.acao, tabela: entrada?.tabela, message: e?.message, code: e?.code
    });
    return { ok: false, erro: e };
  }
}

/** Identidade do usuário para carimbar registros (§1.13). */
export function identidade(user) {
  return {
    id: user?.id || null,
    nome: user?.nome || user?.email || '—',
    perfil: user?.role || null
  };
}

/* ------------------------------------------------------- COMPETÊNCIAS (§3) */

export async function listarCompetencias({ planta = null, ano = null } = {}) {
  const rows = (await db.list('fm_competencias')).filter(ativo);
  return rows
    .filter(c => (!planta || c.planta === planta) && (!ano || Number(c.ano) === Number(ano)))
    .sort((a, b) => (b.ano - a.ano) || (b.mes - a.mes));
}

export async function obterCompetencia(id) {
  if (!id) return null;
  const c = await db.get('fm_competencias', id);
  return c && ativo(c) ? c : null;
}

export async function buscarCompetencia(planta, mes, ano) {
  const rows = await listarCompetencias({ planta });
  return rows.find(c => Number(c.mes) === Number(mes) && Number(c.ano) === Number(ano)) || null;
}

/** Rótulo "08/2026" — mesma regra da coluna gerada no banco. */
export const rotuloCompetencia = (mes, ano) => `${String(mes).padStart(2, '0')}/${ano}`;
export const rotuloExtenso = (mes, ano) => `${MESES[Number(mes) - 1] || '—'} ${ano}`;

/** Primeiro e último dia do mês, como data civil (sem fuso — §20). */
export function periodoCompetencia(mes, ano) {
  const m = String(mes).padStart(2, '0');
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return { inicio: `${ano}-${m}-01`, fim: `${ano}-${m}-${String(ultimo).padStart(2, '0')}` };
}

/**
 * §3 — cria a competência. Recusa duplicata (planta+mês+ano) antes de tentar
 * gravar, para dar uma mensagem clara em vez do erro cru de unique constraint.
 */
export async function criarCompetencia({ planta, mes, ano, responsavel, responsavel_id, observacoes }, user) {
  if (!podeFechamento(user?.role, 'revisar')) {
    throw new FmErro('Somente Administrador ou Gestor da Qualidade pode abrir uma competência.');
  }
  if (!PLANTAS.includes(planta)) throw new FmErro('Selecione uma planta válida.');
  mes = Number(mes); ano = Number(ano);
  if (!(mes >= 1 && mes <= 12)) throw new FmErro('Mês inválido.');
  if (!(ano >= 2000 && ano <= 2100)) throw new FmErro('Ano inválido.');

  const existente = await buscarCompetencia(planta, mes, ano);
  if (existente) {
    throw new FmErro(
      `A competência ${rotuloCompetencia(mes, ano)} da ${planta} já existe (status: ${existente.status}). ` +
      'Abra a competência existente em vez de criar outra.');
  }

  const { inicio, fim } = periodoCompetencia(mes, ano);
  const eu = identidade(user);
  const anterior = await buscarCompetencia(planta, mes === 1 ? 12 : mes - 1, mes === 1 ? ano - 1 : ano);

  const row = await db.insert('fm_competencias', {
    planta, mes, ano,
    competencia: rotuloCompetencia(mes, ano),   // no Supabase é coluna gerada; no demo é gravada
    data_inicial: inicio, data_final: fim,
    responsavel: responsavel || 'Garantia da Qualidade',
    responsavel_id: responsavel_id || null,
    status: 'Não iniciado', percentual: 0, versao: 'V0',
    observacoes: observacoes || null,
    criado_por_id: eu.id, criado_por: eu.nome,
    competencia_anterior_id: anterior?.id || null,
    created_at: agoraISO(), updated_at: agoraISO()
  });

  await criarSecoes(row.id, user);
  await registrarStatus(row.id, null, 'Não iniciado', 'criacao', 'Competência criada.', user);
  await logar({
    competencia_id: row.id, tabela: 'fm_competencias', registro_id: row.id, acao: 'insert',
    valor_novo: `${planta} · ${rotuloCompetencia(mes, ano)}`,
    usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });
  return row;
}

/** Cria as seções de progresso da competência (§2/§3). */
async function criarSecoes(competencia_id, user) {
  const eu = identidade(user);
  for (const secaoId of SECOES_PROGRESSO) {
    const spec = SECOES[secaoId];
    if (!spec) continue;
    await db.insert('fm_secoes', {
      competencia_id, secao: secaoId, status: 'Não iniciado', percentual: 0,
      responsavel: eu.nome, responsavel_id: eu.id, obrigatoria: true,
      created_at: agoraISO(), updated_at: agoraISO()
    });
  }
}

/* --------------------------------------------------- STATUS E FLUXO (§4/§42) */

async function registrarStatus(competencia_id, de, para, acao, comentario, user) {
  const eu = identidade(user);
  await db.insert('fm_status_hist', {
    competencia_id, status_anterior: de, status_novo: para, acao,
    comentario: comentario || null, usuario_id: eu.id, usuario: eu.nome, quando: agoraISO()
  });
}

/**
 * §4/§42 — muda o status respeitando as transições permitidas e o perfil.
 * Em Supabase delega à RPC fm_mudar_status (que revalida no banco); em demo
 * aplica a mesma regra localmente.
 */
export async function mudarStatus(competencia_id, novo, { comentario = '', user } = {}) {
  const c = await obterCompetencia(competencia_id);
  if (!c) throw new FmErro('Competência não encontrada.');
  if (!STATUS_COMPETENCIA.includes(novo)) throw new FmErro(`Status inválido: ${novo}.`);

  if (!podeTransicionar(c.status, novo)) {
    throw new FmErro(
      `Não é possível ir de "${c.status}" para "${novo}". ` +
      (c.status === 'Fechado'
        ? 'Competência fechada só sai por reabertura formal.'
        : `Transições possíveis: ${(await transicoesDe(c.status)).join(', ') || 'nenhuma'}.`));
  }
  if (['Aprovado', 'Fechado'].includes(novo) && !podeFechamento(user?.role, 'aprovar')) {
    throw new FmErro('Somente Administrador ou Gestor da Qualidade pode aprovar ou fechar a competência.');
  }
  if (['Em revisão', 'Aguardando aprovação'].includes(novo) && !comentario && novo === 'Devolvido para correção') {
    throw new FmErro('Informe o motivo da devolução.');
  }

  if (SUPABASE.enabled) {
    try {
      const sb = await getSupabase();
      const { error } = await sb.rpc('fm_mudar_status', {
        p_comp_id: competencia_id, p_novo: novo, p_comentario: comentario || null
      });
      if (error) throw error;
      return await obterCompetencia(competencia_id);
    } catch (e) {
      throw new FmErro(mensagemErro(e, 'mudança de status'), { causa: e });
    }
  }

  const eu = identidade(user);
  const patch = { status: novo, updated_at: agoraISO() };
  if (novo === 'Aprovado') Object.assign(patch, { aprovado_por: eu.nome, aprovado_por_id: eu.id, aprovado_em: agoraISO() });
  if (novo === 'Fechado')  Object.assign(patch, { fechado_por: eu.nome, fechado_por_id: eu.id, fechado_em: agoraISO() });
  const row = await db.update('fm_competencias', competencia_id, patch);
  await registrarStatus(competencia_id, c.status, novo, 'status', comentario, user);
  await logar({
    competencia_id, tabela: 'fm_competencias', registro_id: competencia_id, acao: 'status',
    valor_anterior: c.status, valor_novo: novo, justificativa: comentario,
    usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });
  return row;
}

export async function transicoesDe(status) {
  const { TRANSICOES } = await import('./fm-schema.js');
  return TRANSICOES[status] || [];
}

/** Histórico de status da competência (§42/§45). */
export async function historicoStatus(competencia_id) {
  const rows = await db.list('fm_status_hist', { filter: { competencia_id } });
  return rows.sort((a, b) => String(b.quando).localeCompare(String(a.quando)));
}

/** Trilha completa de auditoria da competência (§45). */
export async function trilha(competencia_id, { limite = 500 } = {}) {
  const rows = (await db.list('fm_logs')).filter(l => l.competencia_id === competencia_id);
  return rows.sort((a, b) => String(b.quando).localeCompare(String(a.quando))).slice(0, limite);
}

/* -------------------------------------------------------- REABERTURA (§46) */

export async function reabrirCompetencia(competencia_id, { motivo, autorizador, user } = {}) {
  const c = await obterCompetencia(competencia_id);
  if (!c) throw new FmErro('Competência não encontrada.');
  if (c.status !== 'Fechado') throw new FmErro(`Só é possível reabrir competência FECHADA (atual: ${c.status}).`);
  if (!String(motivo || '').trim()) throw new FmErro('Informe o motivo da reabertura.');
  if (!podeFechamento(user?.role, 'reabrir')) {
    throw new FmErro('Somente o Administrador pode reabrir uma competência fechada.');
  }

  if (SUPABASE.enabled) {
    try {
      const sb = await getSupabase();
      const { error } = await sb.rpc('fm_reabrir_competencia', {
        p_comp_id: competencia_id, p_motivo: motivo, p_autorizador: autorizador || null
      });
      if (error) throw error;
      return await obterCompetencia(competencia_id);
    } catch (e) {
      throw new FmErro(mensagemErro(e, 'reabertura'), { causa: e });
    }
  }

  const eu = identidade(user);
  const row = await db.update('fm_competencias', competencia_id, {
    status: 'Reaberto', reaberto_em: agoraISO(), reaberto_motivo: motivo, updated_at: agoraISO()
  });
  await registrarStatus(competencia_id, c.status, 'Reaberto', 'reabertura',
    `${motivo}${autorizador ? ' · Autorizado por: ' + autorizador : ''}`, user);
  await logar({
    competencia_id, tabela: 'fm_competencias', registro_id: competencia_id, acao: 'reabertura',
    valor_anterior: c.status, valor_novo: 'Reaberto', justificativa: motivo,
    usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });
  return row;
}

/* --------------------------------------------------- PRÓXIMA COMPETÊNCIA (§5) */

/**
 * §5 — abre o mês seguinte. Zera os dados mensais (simplesmente não os copia)
 * e mantém o que é contínuo por REFERÊNCIA, não por cópia:
 *   • ações 5W2H abertas continuam apontando para a competência de origem e
 *     aparecem no mês novo via consulta (acoesVigentes) — nada é duplicado;
 *   • metas, critérios e aliases são catálogos globais, já valem para o mês novo;
 *   • acumulados anuais são recalculados a partir do histórico.
 */
export async function criarProximaCompetencia(competencia_id, user) {
  const c = await obterCompetencia(competencia_id);
  if (!c) throw new FmErro('Competência não encontrada.');
  if (!podeFechamento(user?.role, 'revisar')) {
    throw new FmErro('Somente Administrador ou Gestor da Qualidade pode abrir a próxima competência.');
  }

  const mes = c.mes === 12 ? 1 : c.mes + 1;
  const ano = c.mes === 12 ? c.ano + 1 : c.ano;

  const jaExiste = await buscarCompetencia(c.planta, mes, ano);
  if (jaExiste) return { competencia: jaExiste, jaExistia: true };

  if (SUPABASE.enabled) {
    try {
      const sb = await getSupabase();
      const { data, error } = await sb.rpc('fm_criar_proxima_competencia', { p_comp_id: competencia_id });
      if (error) throw error;
      const nova = await obterCompetencia(data);
      return { competencia: nova, jaExistia: false };
    } catch (e) {
      throw new FmErro(mensagemErro(e, 'criação do próximo mês'), { causa: e });
    }
  }

  const nova = await criarCompetencia({
    planta: c.planta, mes, ano,
    responsavel: c.responsavel, responsavel_id: c.responsavel_id
  }, user);
  await db.update('fm_competencias', nova.id, { competencia_anterior_id: c.id });
  return { competencia: nova, jaExistia: false };
}

/**
 * §5/§23 — ações que devem aparecer NESTA competência: as nascidas nela mais
 * todas as que continuam abertas de meses anteriores. Nenhuma é duplicada.
 */
export async function acoesVigentes(competencia) {
  if (!competencia) return [];
  const todas = (await db.list('fm_acoes')).filter(ativo);
  const corte = Number(competencia.ano) * 100 + Number(competencia.mes);
  const comps = await db.list('fm_competencias');
  const chaveDe = id => {
    const c = comps.find(x => x.id === id);
    return c ? Number(c.ano) * 100 + Number(c.mes) : 0;
  };
  return todas.filter(a => {
    const origem = chaveDe(a.competencia_origem_id);
    if (origem > corte) return false;                      // nasceu depois: não aparece
    if (origem === corte) return true;                     // nasceu nesta competência
    return !['Concluído', 'Cancelado'].includes(a.status); // veio de trás e continua aberta
  });
}

/* ------------------------------------------------------ GUARDA DE EDIÇÃO */

/** §15/§44.5 — a competência aceita escrita? */
export function competenciaEditavel(c) {
  return !!c && !['Fechado', 'Cancelado'].includes(c.status);
}

/** Lança com mensagem clara quando a competência está travada. */
export function exigirEditavel(c) {
  if (!c) throw new FmErro('Selecione uma competência.');
  if (c.status === 'Fechado') {
    throw new FmErro(`A competência ${c.competencia || rotuloCompetencia(c.mes, c.ano)} está FECHADA — somente leitura. Peça a reabertura ao administrador.`);
  }
  if (c.status === 'Cancelado') {
    throw new FmErro('A competência está cancelada e não aceita lançamentos.');
  }
}

/* ---------------------------------------------------- PROGRESSO (§3/§6) */

/**
 * Percentual de conclusão da competência: proporção de seções obrigatórias com
 * pelo menos um lançamento. É um indicador de PREENCHIMENTO, não de qualidade —
 * a completude real é medida pelas pendências (§32/§41).
 */
export async function calcularProgresso(competencia_id) {
  const detalhe = [];
  for (const secaoId of SECOES_PROGRESSO) {
    const spec = SECOES[secaoId];
    if (!spec) continue;
    const col = colunaCompetencia(secaoId);
    const rows = (await db.list(spec.tabela)).filter(r => ativo(r) && r[col] === competencia_id);
    detalhe.push({ secao: secaoId, label: spec.label, registros: rows.length, iniciada: rows.length > 0 });
  }
  const iniciadas = detalhe.filter(d => d.iniciada).length;
  const percentual = detalhe.length ? Math.round((iniciadas / detalhe.length) * 100) : 0;
  return { percentual, iniciadas, total: detalhe.length, detalhe };
}

/**
 * Sincroniza o percentual e o status automático da competência (§4):
 *   sem nenhuma seção iniciada  → "Não iniciado"
 *   alguma seção iniciada       → "Em preenchimento"
 *   pendência crítica em aberto → "Aguardando informações"
 * Só atua nos estados iniciais: nunca reverte uma competência que já foi para
 * revisão/aprovação/fechamento.
 */
export async function sincronizarProgresso(competencia_id, user) {
  const c = await obterCompetencia(competencia_id);
  if (!c) return null;
  const { percentual } = await calcularProgresso(competencia_id);

  const AUTOMATICOS = ['Não iniciado', 'Em preenchimento', 'Aguardando informações'];
  let status = c.status;
  if (AUTOMATICOS.includes(c.status)) {
    const pend = (await db.list('fm_pendencias'))
      .filter(p => p.competencia_id === competencia_id && p.status === 'Aberta' && p.bloqueia_final);
    status = percentual === 0 ? 'Não iniciado' : (pend.length ? 'Aguardando informações' : 'Em preenchimento');
  }

  if (Number(c.percentual) !== percentual || status !== c.status) {
    await db.update('fm_competencias', competencia_id, {
      percentual, status, updated_at: agoraISO()
    });
    if (status !== c.status) await registrarStatus(competencia_id, c.status, status, 'automatico', 'Ajuste automático pelo preenchimento.', user);
  }
  return { percentual, status };
}

/* ------------------------------------------------------- CONFIGURAÇÕES */

/** Lê uma configuração (§16/§19/§20/§27) com fallback para a global. */
export async function config(chave, planta = null, padrao = null) {
  const rows = await db.list('fm_config');
  const daPlanta = rows.find(r => r.chave === chave && r.planta === planta);
  const global = rows.find(r => r.chave === chave && !r.planta);
  const achado = daPlanta || global;
  return achado ? achado.valor : padrao;
}

export async function salvarConfig(chave, valor, { planta = null, user } = {}) {
  if (!podeFechamento(user?.role, 'configurar')) {
    throw new FmErro('Somente o Administrador pode alterar as configurações do fechamento.');
  }
  const rows = await db.list('fm_config');
  const atual = rows.find(r => r.chave === chave && r.planta === planta);
  const eu = identidade(user);
  const anterior = atual ? JSON.stringify(atual.valor) : null;

  const row = atual
    ? await db.update('fm_config', atual.id, { valor, updated_at: agoraISO(), updated_by: eu.id })
    : await db.insert('fm_config', { chave, planta, valor, updated_at: agoraISO(), updated_by: eu.id });

  await logar({
    tabela: 'fm_config', registro_id: row.id, campo: chave, acao: 'config',
    valor_anterior: anterior, valor_novo: JSON.stringify(valor),
    usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });
  return row;
}

/* ------------------------------------------------------------ AJUSTES (§30) */

/** Campo calculado não é editado direto: abre-se uma solicitação de ajuste. */
export async function solicitarAjuste({ competencia_id, indicador, tabela, registro_id, campo,
  valor_anterior, valor_novo, justificativa, evidencia_url }, user) {
  if (!String(justificativa || '').trim()) {
    throw new FmErro('A justificativa é obrigatória para solicitar o ajuste de um valor calculado.');
  }
  const eu = identidade(user);
  const row = await db.insert('fm_ajustes', {
    competencia_id, indicador, tabela, registro_id, campo,
    valor_anterior: valor_anterior == null ? null : String(valor_anterior),
    valor_novo: valor_novo == null ? null : String(valor_novo),
    justificativa, evidencia_url: evidencia_url || null,
    solicitante_id: eu.id, solicitante: eu.nome, solicitado_em: agoraISO(),
    status: 'Pendente'
  });
  await logar({
    competencia_id, tabela: 'fm_ajustes', registro_id: row.id, campo, acao: 'ajuste_solicitado',
    valor_anterior: String(valor_anterior ?? ''), valor_novo: String(valor_novo ?? ''),
    justificativa, usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });
  return row;
}

export async function decidirAjuste(ajuste_id, aprovado, { parecer = '', user } = {}) {
  if (!podeFechamento(user?.role, 'aprovar')) {
    throw new FmErro('Somente Administrador ou Gestor da Qualidade decide solicitações de ajuste.');
  }
  const eu = identidade(user);
  const row = await db.update('fm_ajustes', ajuste_id, {
    status: aprovado ? 'Aprovado' : 'Recusado',
    aprovador_id: eu.id, aprovador: eu.nome, decidido_em: agoraISO(), parecer
  });
  await logar({
    competencia_id: row?.competencia_id, tabela: 'fm_ajustes', registro_id: ajuste_id,
    acao: aprovado ? 'ajuste_aprovado' : 'ajuste_recusado', justificativa: parecer,
    usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });
  return row;
}

/* ========================================================================== */
/* DIAGNÓSTICO DA ESTRUTURA                                                    */
/* ========================================================================== */
/* Antes, QUALQUER falha ao ler uma tabela virava "estrutura ausente no banco" —
   inclusive RLS negando, sessão expirada e queda de rede. Isso mandava o
   administrador rodar de novo uma migration que já estava aplicada, escondendo
   o problema real. Agora o erro é CLASSIFICADO e cada caso tem sua conduta. */

/** Tabelas mínimas que o módulo exige para abrir. */
export const TABELAS_OBRIGATORIAS = [
  'fm_competencias', 'fm_reclamacoes', 'fm_ocorrencias', 'fm_producao',
  'fm_fornecimento', 'fm_criterios', 'fm_metas', 'fm_pendencias', 'fm_memoria'
];

export const DIAG = {
  OK: 'ok',
  SEM_ESTRUTURA: 'sem_estrutura',
  SEM_PERMISSAO: 'sem_permissao',
  SESSAO: 'sessao',
  CONEXAO: 'conexao',
  CACHE: 'cache',
  DESCONHECIDO: 'desconhecido'
};

/**
 * Classifica UM erro do PostgREST/Supabase/fetch.
 * A ordem importa: 'schema cache' aparece tanto em tabela ausente (PGRST205)
 * quanto em coluna/função fora do cache (PGRST202/PGRST204) — por isso o código
 * é consultado antes do texto.
 */
export function classificarErro(e) {
  if (!e) return DIAG.OK;
  const code = String(e.code ?? e.status ?? '');
  const msg  = String(e.message ?? e ?? '');
  const nome = String(e.name ?? '');

  /* Rede: o fetch nem chegou ao PostgREST — não há código nenhum. */
  if (nome === 'TypeError' && /fetch/i.test(msg)) return DIAG.CONEXAO;
  if (/failed to fetch|networkerror|network request failed|load failed|timeout|abort/i.test(msg)
      && !code) return DIAG.CONEXAO;

  /* Sessão. */
  if (code === '401' || code === 'PGRST301' ||
      /jwt (expired|invalid)|invalid (jwt|token)|session (missing|not found)|no api key/i.test(msg)) {
    return DIAG.SESSAO;
  }

  /* Tabela/função inexistente. PGRST202 = função (RPC) fora do schema cache —
     na prática, a migration não rodou neste banco. */
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202' ||
      /relation .* does not exist|could not find the table|could not find the function/i.test(msg)) {
    return DIAG.SEM_ESTRUTURA;
  }

  /* Permissão / RLS. */
  if (code === '42501' || code === '403' ||
      /permission denied|row-level security|violates row-level|not authorized|acesso não autorizado/i.test(msg)) {
    return DIAG.SEM_PERMISSAO;
  }

  /* Estrutura existe, mas a API ainda não recarregou o schema. */
  if (code === 'PGRST204' || /schema cache/i.test(msg)) return DIAG.CACHE;

  return DIAG.DESCONHECIDO;
}

const TITULOS = {
  [DIAG.SEM_ESTRUTURA]: 'Estrutura do Fechamento Mensal não instalada.',
  [DIAG.SEM_PERMISSAO]: 'Acesso restrito.',
  [DIAG.SESSAO]:        'Sessão expirada.',
  [DIAG.CONEXAO]:       'Falha de conexão com o banco.',
  [DIAG.CACHE]:         'Estrutura existe, mas a API não atualizou o schema.',
  [DIAG.DESCONHECIDO]:  'Não foi possível verificar a estrutura do módulo.'
};

const MENSAGENS = {
  [DIAG.SEM_ESTRUTURA]: 'As tabelas necessárias ainda não estão disponíveis no banco configurado para este ambiente.',
  [DIAG.SEM_PERMISSAO]: 'Este módulo está disponível exclusivamente para administradores.',
  [DIAG.SESSAO]:        'Sua sessão expirou. Entre novamente.',
  [DIAG.CONEXAO]:       'Não foi possível consultar o Supabase. Verifique a conexão e tente novamente.',
  [DIAG.CACHE]:         'A estrutura existe, mas a API ainda não atualizou o schema. Recarregue o cache do Supabase (notify pgrst, \'reload schema\').',
  [DIAG.DESCONHECIDO]:  'O banco respondeu com um erro que não corresponde a nenhum caso conhecido.'
};

/** Identificação do projeto Supabase em uso — sem expor chave alguma. */
export function ambiente() {
  const { host, ref } = projetoSupabase();
  return { modo: db.mode, projeto: ref, host, schema: 'public' };
}

/**
 * Verifica se o módulo está apto a funcionar no banco atual.
 *
 * Estratégia: primeiro a RPC `fm_check_structure()` — uma única ida ao servidor
 * que responde pela EXISTÊNCIA das tabelas sem se misturar com RLS (a função é
 * security definer e valida administrador por dentro). Se a RPC não existir
 * (banco anterior a esta correção), cai para a sondagem tabela a tabela, agora
 * com os erros classificados.
 */
export async function diagnostico() {
  const env = ambiente();
  const base = { ...env, faltando: [], detalhe: null };

  if (!SUPABASE.enabled) {
    return { ...base, ok: true, tipo: DIAG.OK, titulo: null,
      mensagem: 'Modo demonstração: as tabelas do módulo vivem no navegador.' };
  }

  /* ---- 1) caminho preferencial: RPC ---- */
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.rpc('fm_check_structure');
    if (error) throw error;
    if (data && typeof data === 'object') {
      const tabelas = data.tabelas || data;
      const faltando = Object.entries(tabelas)
        .filter(([, existe]) => existe === false).map(([t]) => t);
      return faltando.length
        ? { ...base, ok: false, tipo: DIAG.SEM_ESTRUTURA, faltando,
            titulo: TITULOS[DIAG.SEM_ESTRUTURA], mensagem: MENSAGENS[DIAG.SEM_ESTRUTURA],
            detalhe: `Ausentes: ${faltando.join(', ')}.` }
        : { ...base, ok: true, tipo: DIAG.OK, titulo: null,
            mensagem: 'Estrutura do Fechamento Mensal disponível.', via: 'rpc' };
    }
  } catch (e) {
    const tipo = classificarErro(e);
    /* PGRST202 (função ausente) NÃO é veredito: pode ser só esta correção que
       ainda não foi aplicada, com as tabelas todas no lugar. Cai para a
       sondagem. Os demais tipos são conclusivos e param aqui. */
    if (tipo !== DIAG.SEM_ESTRUTURA) {
      return { ...base, ok: false, tipo, titulo: TITULOS[tipo], mensagem: MENSAGENS[tipo],
        detalhe: e?.message || null };
    }
  }

  /* ---- 2) sondagem tabela a tabela ---- */
  /* Em paralelo: em sequência seriam 9 idas ao servidor e a tela ficaria vários
     segundos em branco só para descobrir se o módulo está instalado. */
  const achados = await Promise.all(TABELAS_OBRIGATORIAS.map(async t => {
    try { await db.list(t); return { t, tipo: DIAG.OK }; }
    catch (e) { return { t, tipo: classificarErro(e), erro: e }; }
  }));

  /* Prioridade do veredito: um 403 em UMA tabela é acesso negado ao módulo —
     jamais "tabela ausente". Foi exatamente essa confusão que mandava rodar a
     migration de novo quando o problema era permissão. */
  for (const tipo of [DIAG.SESSAO, DIAG.SEM_PERMISSAO, DIAG.CONEXAO, DIAG.CACHE, DIAG.DESCONHECIDO]) {
    const hit = achados.find(a => a.tipo === tipo);
    if (hit) {
      return { ...base, ok: false, tipo, titulo: TITULOS[tipo], mensagem: MENSAGENS[tipo],
        detalhe: `${hit.t}: ${hit.erro?.message || 'sem detalhe'}` };
    }
  }

  const faltando = achados.filter(a => a.tipo === DIAG.SEM_ESTRUTURA).map(a => a.t);
  return faltando.length
    ? { ...base, ok: false, tipo: DIAG.SEM_ESTRUTURA, faltando,
        titulo: TITULOS[DIAG.SEM_ESTRUTURA], mensagem: MENSAGENS[DIAG.SEM_ESTRUTURA],
        detalhe: `Ausentes: ${faltando.join(', ')}.` }
    : { ...base, ok: true, tipo: DIAG.OK, titulo: null,
        mensagem: 'Estrutura do Fechamento Mensal disponível.', via: 'sondagem' };
}

/** Renova a sessão antes de reverificar (§20 do requisito de correção). */
export async function renovarSessao() {
  if (!SUPABASE.enabled) return true;
  try {
    const sb = await getSupabase();
    const { data, error } = await sb.auth.refreshSession();
    if (error) throw error;
    return Boolean(data?.session);
  } catch (e) {
    console.warn('[FM] sessão não renovada:', e?.message);
    return false;
  }
}

export { hojeBR, ehDesenvolvimento, projetoSupabase };
