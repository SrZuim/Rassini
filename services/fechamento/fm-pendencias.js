/* ==========================================================================
   RNA One — FECHAMENTO MENSAL · Motor de pendências automáticas (§32)
   ---------------------------------------------------------------------------
   Varre a competência e materializa as pendências previstas no requisito.

   Duas decisões que evitam ruído:
   1) IDEMPOTÊNCIA por `chave` (tipo + registro). Rodar o motor dez vezes não
      cria dez pendências iguais — atualiza a que já existe.
   2) AUTOCURA: a pendência que deixou de existir (o campo foi preenchido) é
      fechada automaticamente com status "Concluída" e resolução registrada.
      Sem isso, a lista viraria um cemitério de itens já resolvidos.

   `bloqueia_final: true` impede a geração da versão FINAL da apresentação
   (§41) — mas nunca a versão preliminar, que existe justamente para circular
   enquanto as pendências são resolvidas.
   ========================================================================== */
import { db } from '../db.js';
import { agoraISO, hojeBR } from '../datahora.js';
import { TIPOS_PENDENCIA, SECOES, ACAO_ABERTA } from './fm-schema.js';
import { faltantes } from './fm-registros.js';
import { identidade, logar } from './fm-core.js';
import { carregarDados } from './fm-indicadores.js';

const ativo = r => !r?.deleted_at;

/* Status terminais em qualquer seção — registros nestes estados saem do radar
   das cobranças de preenchimento. */
const ENCERRADOS = new Set(['Concluída', 'Concluído', 'Cancelada', 'Cancelado', 'Encerrada']);

/** Constrói a pendência a partir do catálogo de tipos (§32). */
function pendencia(tipo, { chave, titulo, descricao, modulo, tabela, registro_id, responsavel, prazo }) {
  const spec = TIPOS_PENDENCIA[tipo] || { titulo: tipo, prioridade: 'Média', bloqueia: false };
  return {
    chave, tipo,
    titulo: titulo || spec.titulo,
    descricao, modulo, registro_tabela: tabela || null, registro_id: registro_id || null,
    responsavel: responsavel || null,
    prioridade: spec.prioridade,
    bloqueia_final: spec.bloqueia,
    prazo: prazo || null,
    status: 'Aberta'
  };
}

/* ========================================================================== */
/* DETECÇÃO — função PURA: recebe os dados, devolve a lista de pendências       */
/* ========================================================================== */

export function detectar(dados, { dataRef = hojeBR() } = {}) {
  const p = [];
  const { competencia } = dados;

  /* --- §32 quantidade produzida / fornecida ausentes ---------------------- */
  const fabricadas = (dados.producao || []).reduce((t, r) => t + Number(r.qtd_fabricada || 0), 0);
  if (!fabricadas) {
    p.push(pendencia('producao_ausente', {
      chave: 'producao_ausente',
      descricao: 'Nenhuma quantidade fabricada lançada na competência. Sem esse dado o PPM interno não pode ser calculado.',
      modulo: 'Indicadores Internos', tabela: 'fm_producao'
    }));
  }
  const fornecidas = (dados.fornecimento || []).reduce((t, r) => t + Number(r.qtd_fornecida || 0), 0);
  if (!fornecidas) {
    p.push(pendencia('fornecimento_ausente', {
      chave: 'fornecimento_ausente',
      descricao: 'Nenhuma quantidade fornecida lançada ou importada. Sem esse dado o PPM externo (oficial e real) não pode ser calculado.',
      modulo: 'Indicadores Externos', tabela: 'fm_fornecimento'
    }));
  }

  /* --- §32 campos obrigatórios ausentes nos lançamentos ------------------- */
  const SECOES_VARRER = ['reclamacoes', 'ocorrencias', 'producao', 'custos', 'care', 'quebras', 'seguranca', 'acoes'];
  const porSecao = {
    reclamacoes: dados.reclamacoes, ocorrencias: dados.ocorrencias, producao: dados.producao,
    custos: dados.custos, care: dados.care, quebras: dados.quebras,
    seguranca: dados.seguranca, acoes: dados.acoes
  };
  for (const secaoId of SECOES_VARRER) {
    const spec = SECOES[secaoId];
    for (const r of (porSecao[secaoId] || []).filter(ativo)) {
      /* Registro já encerrado não é cobrado: exigir "causa raiz" de um plano
         concluído em março só enche a lista de ruído que ninguém vai tratar.
         A cobrança existe para o que ainda está em curso. */
      if (ENCERRADOS.has(String(r.status || ''))) continue;
      const falta = faltantes(secaoId, r);
      if (!falta.length) continue;
      p.push(pendencia('campo_obrigatorio', {
        chave: `campo_obrigatorio:${spec.tabela}:${r.id}`,
        titulo: `Campo obrigatório ausente — ${spec.label}`,
        descricao: `O registro está sem: ${falta.join(', ')}.`,
        modulo: spec.area, tabela: spec.tabela, registro_id: r.id
      }));
    }
  }

  /* --- §32 planos 5W2H ---------------------------------------------------- */
  for (const a of (dados.acoes || []).filter(ativo)) {
    if (!ACAO_ABERTA(a.status)) continue;
    if (!a.who)        p.push(pendencia('plano_sem_resp',  { chave: `plano_sem_resp:${a.id}`,  descricao: `Plano "${corta(a.what || a.problema)}" sem responsável (Who).`, modulo: 'Planos de Ação 5W2H', tabela: 'fm_acoes', registro_id: a.id }));
    if (!a.when_)      p.push(pendencia('plano_sem_prazo', { chave: `plano_sem_prazo:${a.id}`, descricao: `Plano "${corta(a.what || a.problema)}" sem prazo (When).`, modulo: 'Planos de Ação 5W2H', tabela: 'fm_acoes', registro_id: a.id, responsavel: a.who }));
    if (!a.causa_raiz) p.push(pendencia('plano_sem_causa', { chave: `plano_sem_causa:${a.id}`, descricao: `Plano "${corta(a.what || a.problema)}" sem causa raiz identificada.`, modulo: 'Planos de Ação 5W2H', tabela: 'fm_acoes', registro_id: a.id, responsavel: a.who }));
    if (a.when_ && a.when_ < dataRef) {
      p.push(pendencia('acao_vencida', {
        chave: `acao_vencida:${a.id}`,
        descricao: `O prazo do plano "${corta(a.what || a.problema)}" venceu em ${brDate(a.when_)} e a ação não está concluída.`,
        modulo: 'Planos de Ação 5W2H', tabela: 'fm_acoes', registro_id: a.id,
        responsavel: a.who, prazo: a.when_
      }));
    }
    if (a.status === 'Aguardando evidência' && !a.evidencia_url) {
      p.push(pendencia('campo_obrigatorio', {
        chave: `plano_sem_evidencia:${a.id}`, titulo: 'Plano aguardando evidência',
        descricao: `O plano "${corta(a.what || a.problema)}" está aguardando evidência e nenhum anexo foi enviado.`,
        modulo: 'Planos de Ação 5W2H', tabela: 'fm_acoes', registro_id: a.id, responsavel: a.who
      }));
    }
    if (a.status === 'Aguardando retorno') {
      p.push(pendencia('campo_obrigatorio', {
        chave: `plano_sem_retorno:${a.id}`, titulo: 'Plano aguardando retorno',
        descricao: `O plano "${corta(a.what || a.problema)}" aguarda retorno do responsável.`,
        modulo: 'Planos de Ação 5W2H', tabela: 'fm_acoes', registro_id: a.id, responsavel: a.who
      }));
    }
  }

  /* --- §32 reclamação sem evidência --------------------------------------- */
  for (const r of (dados.reclamacoes || []).filter(ativo)) {
    const encerrada = ['Concluída', 'Cancelada'].includes(r.status);
    if (!encerrada && !r.descricao) {
      p.push(pendencia('recl_sem_evidencia', {
        chave: `recl_sem_evidencia:${r.id}`,
        descricao: `A reclamação ${r.codigo || r.part_number || ''} não tem descrição/evidência registrada.`,
        modulo: 'Indicadores Externos', tabela: 'fm_reclamacoes', registro_id: r.id,
        responsavel: r.responsavel
      }));
    }
  }

  /* --- §32 quebra sem RNC -------------------------------------------------- */
  for (const q of (dados.quebras || []).filter(ativo)) {
    if (['Concluída', 'Cancelada'].includes(q.status)) continue;
    if (!q.rnc_id) {
      p.push(pendencia('quebra_sem_rnc', {
        chave: `quebra_sem_rnc:${q.id}`,
        descricao: `A quebra ${q.tipo} do Part Number ${q.part_number || '—'} não tem RNC vinculada.`,
        modulo: 'Farol de Quebras', tabela: 'fm_quebras', registro_id: q.id,
        responsavel: q.responsavel, prazo: q.prazo
      }));
    }
  }

  /* --- §32 CARE sem tratativa ---------------------------------------------- */
  for (const c of (dados.care || []).filter(ativo)) {
    if (Number(c.qtd_ng || 0) > 0 && !c.ocorrencia_id && !c.acao_id) {
      p.push(pendencia('care_sem_tratativa', {
        chave: `care_sem_tratativa:${c.id}`,
        descricao: `A inspeção CARE de ${brDate(c.data)} (Part Number ${c.part_number || '—'}) registrou ${c.qtd_ng} peças NG sem ocorrência ou plano vinculado.`,
        modulo: 'Inspeção CARE', tabela: 'fm_care', registro_id: c.id,
        responsavel: c.responsavel_area || c.auditor
      }));
    }
  }

  /* --- §32 custo sem documento --------------------------------------------- */
  for (const c of (dados.custos || []).filter(ativo)) {
    if (!c.documento_fiscal) {
      p.push(pendencia('custo_sem_doc', {
        chave: `custo_sem_doc:${c.id}`,
        descricao: `O lançamento de custo "${corta(c.descricao)}" (${moeda(c.valor)}) não tem documento fiscal informado.`,
        modulo: 'Custos da Qualidade', tabela: 'fm_custos', registro_id: c.id,
        responsavel: c.responsavel
      }));
    }
  }

  /* --- §32 indicador sem meta ---------------------------------------------- */
  const METAS_ESPERADAS = ['ppm_externo_oficial', 'ppm_externo_real', 'ppm_interno', 'custo_qualidade'];
  for (const ind of METAS_ESPERADAS) {
    const tem = (dados.metas || []).some(m => ativo(m) && m.indicador === ind && m.status === 'Ativo' &&
      (!m.ano || Number(m.ano) === Number(competencia.ano)) && (!m.planta || m.planta === competencia.planta));
    if (!tem) {
      p.push(pendencia('indicador_sem_meta', {
        chave: `indicador_sem_meta:${ind}`,
        descricao: `Não há meta vigente para "${ind}" em ${competencia.ano}. Cadastre em Configurações → Metas.`,
        modulo: 'Configurações', tabela: 'fm_metas'
      }));
    }
  }

  /* --- §32 cliente não associado / importação com erro --------------------- */
  for (const f of (dados.fornecimento || []).filter(ativo)) {
    if (!f.cliente_oficial) {
      p.push(pendencia('cliente_nao_assoc', {
        chave: `cliente_nao_assoc:${f.id}`,
        descricao: `O registro de fornecimento de "${f.cliente || '—'}" não está associado a um cliente oficial. Sem a associação ele não entra no PPM externo.`,
        modulo: 'Importações', tabela: 'fm_fornecimento', registro_id: f.id
      }));
    }
  }

  return p;
}

/* ========================================================================== */
/* SINCRONIZAÇÃO com o banco                                                   */
/* ========================================================================== */

/**
 * Roda o motor e reconcilia com o que está gravado:
 *   • pendência nova            → INSERT
 *   • pendência que persiste    → mantém (não reescreve, para preservar o
 *                                 responsável designado e o histórico)
 *   • pendência que sumiu       → fecha como "Concluída" (autocura)
 * As pendências criadas MANUALMENTE (sem `tipo` do catálogo) nunca são tocadas.
 */
export async function sincronizar(competencia, { user, dados = null } = {}) {
  if (!competencia) return { criadas: 0, fechadas: 0, abertas: 0 };
  const d = dados || await carregarDados(competencia);
  const detectadas = detectar(d);
  const chavesDetectadas = new Set(detectadas.map(x => x.chave));

  const todas = await db.list('fm_pendencias').catch(() => []);
  const atuais = todas.filter(x => x.competencia_id === competencia.id);
  const porChave = new Map(atuais.map(x => [x.chave, x]));
  const eu = identidade(user);

  let criadas = 0, fechadas = 0;

  for (const nova of detectadas) {
    const existente = porChave.get(nova.chave);
    if (!existente) {
      await db.insert('fm_pendencias', {
        ...nova, competencia_id: competencia.id,
        created_at: agoraISO(), updated_at: agoraISO()
      });
      criadas++;
    } else if (existente.status === 'Concluída') {
      /* Voltou a ocorrer: reabre em vez de duplicar. */
      await db.update('fm_pendencias', existente.id, {
        status: 'Aberta', concluida_em: null, concluida_por: null,
        resolucao: null, updated_at: agoraISO()
      });
      criadas++;
    }
  }

  for (const atual of atuais) {
    const automatica = !!TIPOS_PENDENCIA[atual.tipo];
    if (!automatica) continue;                       // pendência manual: não mexe
    if (atual.status === 'Concluída' || atual.status === 'Cancelada') continue;
    if (chavesDetectadas.has(atual.chave)) continue; // ainda vale
    await db.update('fm_pendencias', atual.id, {
      status: 'Concluída', concluida_em: agoraISO(),
      concluida_por: 'Sistema (automático)',
      resolucao: 'A condição que gerou a pendência deixou de existir.',
      updated_at: agoraISO()
    });
    fechadas++;
  }

  if (criadas || fechadas) {
    await logar({
      competencia_id: competencia.id, tabela: 'fm_pendencias', acao: 'pendencias',
      valor_novo: `${criadas} aberta(s), ${fechadas} fechada(s) automaticamente`,
      usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
    });
  }

  const abertas = detectadas.length;
  return { criadas, fechadas, abertas, detectadas };
}

export async function listar(competencia_id, { status = null } = {}) {
  const rows = (await db.list('fm_pendencias').catch(() => []))
    .filter(p => p.competencia_id === competencia_id)
    .filter(p => !status || p.status === status);
  const ORDEM = { 'Crítica': 0, 'Alta': 1, 'Média': 2, 'Baixa': 3 };
  return rows.sort((a, b) =>
    (ORDEM[a.prioridade] ?? 9) - (ORDEM[b.prioridade] ?? 9) ||
    String(a.titulo).localeCompare(String(b.titulo)));
}

/** Pendências que impedem a versão FINAL (§41). */
export async function bloqueios(competencia_id) {
  const abertas = await listar(competencia_id, { status: 'Aberta' });
  return abertas.filter(p => p.bloqueia_final);
}

export async function concluir(pendencia_id, { resolucao = '', user } = {}) {
  const eu = identidade(user);
  const row = await db.update('fm_pendencias', pendencia_id, {
    status: 'Concluída', concluida_em: agoraISO(), concluida_por: eu.nome,
    resolucao, updated_at: agoraISO()
  });
  await logar({
    competencia_id: row?.competencia_id, tabela: 'fm_pendencias', registro_id: pendencia_id,
    acao: 'pendencia_concluida', justificativa: resolucao,
    usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });
  return row;
}

/** Pendência criada à mão pela Qualidade (§32 permite acompanhar o que o motor
    não detecta — ex.: "cobrar relatório 8D do cliente"). */
export async function criarManual({ competencia_id, titulo, descricao, modulo, responsavel, prioridade = 'Média', prazo }, user) {
  const eu = identidade(user);
  const row = await db.insert('fm_pendencias', {
    competencia_id, chave: `manual:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`,
    tipo: 'manual', titulo, descricao, modulo, responsavel, prioridade,
    prazo: prazo || null, status: 'Aberta', bloqueia_final: prioridade === 'Crítica',
    created_at: agoraISO(), updated_at: agoraISO()
  });
  await logar({
    competencia_id, tabela: 'fm_pendencias', registro_id: row.id, acao: 'insert',
    valor_novo: titulo, usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });
  return row;
}

/* ------------------------------------------------------------- helpers --- */
const corta = (s, n = 60) => {
  const t = String(s || '—');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};
const brDate = d => d ? String(d).slice(0, 10).split('-').reverse().join('/') : '—';
const moeda = v => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
