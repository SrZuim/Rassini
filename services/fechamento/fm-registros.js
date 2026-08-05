/* ==========================================================================
   RNA One — FECHAMENTO MENSAL · CRUD genérico das seções
   ---------------------------------------------------------------------------
   Um único motor de gravação para as 12 seções de lançamento. Ele lê o SPEC
   (fm-schema.js) e, a partir dele:
     • valida obrigatórios com mensagem específica (§49 — nunca "Erro ao salvar")
     • normaliza tipos (número brasileiro, data civil, booleano)
     • carimba usuário/data/hora e a ORIGEM do dado (§1.13 / §30)
     • bloqueia escrita em competência fechada (§15)
     • grava a trilha campo a campo em fm_logs (§45)
     • aplica soft delete (§47) — nada é removido fisicamente pela interface

   Por que genérico: as seções são 12 cadastros com a mesma mecânica. Uma cópia
   por seção significaria 12 lugares para esquecer a auditoria ou a trava.
   ========================================================================== */
import { db } from '../db.js';
import { agoraISO } from '../datahora.js';
import { paraNumero } from '../formato.js';
import { SECOES, colunaCompetencia, camposObrigatorios, podeFechamento } from './fm-schema.js';
import { FmErro, identidade, logar, obterCompetencia, exigirEditavel, mensagemErro } from './fm-core.js';

const ativo = r => !r.deleted_at;

/* Tabelas que possuem a coluna `created_by_nome` (ver fechamento_mensal.sql). */
const COM_NOME_CRIADOR = new Set(['fm_reclamacoes', 'fm_ocorrencias']);

/* --------------------------------------------------------- normalização --- */

/** Data civil "AAAA-MM-DD" — nunca passa por new Date() (§20: sem ±1 dia). */
function normData(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return s.slice(0, 10);
}

function normBool(v) {
  if (typeof v === 'boolean') return v;
  if (v == null || v === '') return false;
  return ['true', '1', 'sim', 'on'].includes(String(v).toLowerCase());
}

/** Converte o valor do formulário para o tipo da coluna. */
export function normalizarCampo(campo, valor) {
  switch (campo.t) {
    case 'number':
    case 'money':
      return valor === '' || valor == null ? null : paraNumero(valor);
    case 'date':
      return normData(valor);
    case 'bool':
      return normBool(valor);
    case 'multiselect':
      return Array.isArray(valor) ? valor : (valor ? [valor] : []);
    case 'readonly':
      return valor ?? null;
    default: {
      const s = valor == null ? null : String(valor).trim();
      return s === '' ? null : s;
    }
  }
}

/* ----------------------------------------------------------- validação --- */

/**
 * Valida o registro contra o spec. Devolve a LISTA de problemas — a tela
 * mostra todos de uma vez em vez de um por vez.
 */
export function validar(secaoId, dados) {
  const spec = SECOES[secaoId];
  if (!spec) return [{ campo: null, mensagem: `Seção desconhecida: ${secaoId}.` }];
  const erros = [];

  for (const campo of spec.campos) {
    if (campo.showIf && !campo.showIf(dados)) continue;
    const v = dados[campo.k];

    if (campo.req) {
      const vazio = v == null || v === '' || (Array.isArray(v) && !v.length);
      if (vazio && campo.t !== 'bool') {
        erros.push({ campo: campo.k, mensagem: `Não foi possível salvar porque "${campo.l}" está vazio.` });
        continue;
      }
    }
    if (v == null || v === '') continue;

    if ((campo.t === 'number' || campo.t === 'money')) {
      const n = paraNumero(v);
      if (n == null) {
        erros.push({ campo: campo.k, mensagem: `"${campo.l}" precisa ser um número (use vírgula para decimais).` });
      } else {
        if (campo.min != null && n < campo.min) erros.push({ campo: campo.k, mensagem: `"${campo.l}" não pode ser menor que ${campo.min}.` });
        if (campo.max != null && n > campo.max) erros.push({ campo: campo.k, mensagem: `"${campo.l}" não pode ser maior que ${campo.max}.` });
      }
    }
    if (campo.t === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(normData(v) || '')) {
      erros.push({ campo: campo.k, mensagem: `"${campo.l}" não é uma data válida.` });
    }
    if (campo.t === 'select' && Array.isArray(campo.opts)) {
      const valores = campo.opts.map(o => Array.isArray(o) ? o[0] : o);
      if (!valores.includes(v)) {
        erros.push({ campo: campo.k, mensagem: `"${campo.l}": "${v}" não é uma opção válida.` });
      }
    }
  }

  /* Regras que cruzam campos — §7: peças afetadas nunca menor que reclamações. */
  if (secaoId === 'reclamacoes') {
    const nr = paraNumero(dados.qtd_reclamacoes), np = paraNumero(dados.qtd_pecas);
    if (nr != null && np != null && np < nr) {
      erros.push({ campo: 'qtd_pecas', mensagem: 'A quantidade de peças afetadas não pode ser menor que a quantidade de reclamações.' });
    }
    if (dados.demerito && !dados.oficial) {
      erros.push({ campo: 'demerito', mensagem: 'Só reclamação OFICIAL entra no demérito — desmarque o demérito ou marque a reclamação como oficial.' });
    }
  }
  if (secaoId === 'producao') {
    const fab = paraNumero(dados.qtd_fabricada), ap = paraNumero(dados.qtd_aprovada), ng = paraNumero(dados.qtd_ng);
    if (fab != null && ap != null && ng != null && (ap + ng) > fab) {
      erros.push({ campo: 'qtd_fabricada', mensagem: `Aprovadas (${ap}) + NG (${ng}) somam mais que a quantidade fabricada (${fab}).` });
    }
  }
  if (secaoId === 'care') {
    const insp = paraNumero(dados.qtd_inspecionada), ap = paraNumero(dados.qtd_aprovada), ng = paraNumero(dados.qtd_ng);
    if (insp != null && ng != null && ng > insp) {
      erros.push({ campo: 'qtd_ng', mensagem: `A quantidade NG (${ng}) não pode ser maior que a inspecionada (${insp}).` });
    }
    if (insp != null && ap != null && ng != null && (ap + ng) > insp) {
      erros.push({ campo: 'qtd_aprovada', mensagem: `Aprovadas (${ap}) + NG (${ng}) somam mais que a quantidade inspecionada (${insp}).` });
    }
  }
  if (secaoId === 'retrabalho') {
    const prod = paraNumero(dados.qtd_produzida), retr = paraNumero(dados.qtd_retrabalhada);
    if (prod != null && retr != null && retr > prod) {
      erros.push({ campo: 'qtd_retrabalhada', mensagem: `A quantidade retrabalhada (${retr}) não pode ser maior que a produzida (${prod}).` });
    }
  }
  if (secaoId === 'quebras' && dados.status === 'Concluída' && !dados.data_conclusao) {
    erros.push({ campo: 'data_conclusao', mensagem: 'Informe a data de conclusão para marcar a quebra como Concluída.' });
  }
  if (secaoId === 'acoes' && dados.status === 'Concluído' && !dados.evidencia_url) {
    erros.push({ campo: 'evidencia_url', mensagem: 'Anexe a evidência antes de concluir o plano de ação.' });
  }

  return erros;
}

/* --------------------------------------------------------------- leitura --- */

export async function listar(secaoId, competencia_id, { incluirExcluidos = false } = {}) {
  const spec = SECOES[secaoId];
  if (!spec) throw new FmErro(`Seção desconhecida: ${secaoId}.`);
  const col = colunaCompetencia(secaoId);
  let rows;
  try {
    rows = await db.list(spec.tabela);
  } catch (e) {
    throw new FmErro(mensagemErro(e, spec.label), { causa: e });
  }
  rows = rows.filter(r => r[col] === competencia_id && (incluirExcluidos || ativo(r)));
  const ord = spec.ordena;
  return rows.sort((a, b) => String(a[ord] ?? '').localeCompare(String(b[ord] ?? '')));
}

export async function obter(secaoId, id) {
  const spec = SECOES[secaoId];
  if (!spec) throw new FmErro(`Seção desconhecida: ${secaoId}.`);
  const r = await db.get(spec.tabela, id);
  return r && ativo(r) ? r : null;
}

/* -------------------------------------------------------------- gravação --- */

/**
 * Cria ou atualiza um registro da seção.
 * @param {object} opts.user       usuário da sessão (carimbo obrigatório)
 * @param {string} opts.justificativa  exigida ao CORRIGIR produção (§14)
 */
export async function salvar(secaoId, dados, { id = null, competencia, user, justificativa = '' } = {}) {
  const spec = SECOES[secaoId];
  if (!spec) throw new FmErro(`Seção desconhecida: ${secaoId}.`);
  if (!podeFechamento(user?.role, 'lancar')) {
    throw new FmErro('Seu perfil não pode lançar dados no fechamento.');
  }

  const comp = competencia?.id ? competencia : await obterCompetencia(competencia);
  exigirEditavel(comp);                                   // §15 — trava de fechada

  /* §14 — corrigir lançamento de produção exige justificativa. */
  if (id && secaoId === 'producao' && !String(justificativa || dados.justificativa || '').trim()) {
    throw new FmErro('Correções na base de produção exigem justificativa — descreva o motivo do ajuste.');
  }

  const registro = {};
  for (const campo of spec.campos) {
    if (campo.showIf && !campo.showIf(dados)) continue;
    if (!(campo.k in dados)) continue;
    registro[campo.k] = normalizarCampo(campo, dados[campo.k]);
  }

  const erros = validar(secaoId, { ...registro });
  if (erros.length) {
    const err = new FmErro(erros[0].mensagem);
    err.erros = erros;
    throw err;
  }

  const eu = identidade(user);
  const col = colunaCompetencia(secaoId);
  registro[col] = comp.id;
  if ('planta' in registro && !registro.planta) registro.planta = comp.planta;
  registro.origem = dados.origem || 'manual';
  registro.updated_at = agoraISO();
  registro.updated_by = eu.id;

  /* Vínculo com o registro de origem (§29) — preservado quando informado. */
  for (const k of ['source_module', 'source_record_id', 'source_type']) {
    if (dados[k] != null) registro[k] = dados[k];
  }

  let row, anterior = null;
  try {
    if (id) {
      anterior = await db.get(spec.tabela, id);
      row = await db.update(spec.tabela, id, registro);
    } else {
      registro.created_at = agoraISO();
      registro.created_by = eu.id;
      /* Só estas duas tabelas têm a coluna do NOME de quem lançou; gravá-la nas
         outras devolveria PGRST204 ("column does not exist") no Supabase. */
      if (COM_NOME_CRIADOR.has(spec.tabela)) registro.created_by_nome = eu.nome;
      if (secaoId === 'acoes') {
        registro.planta = comp.planta; registro.mes = comp.mes; registro.ano = comp.ano;
      }
      row = await db.insert(spec.tabela, registro);
    }
  } catch (e) {
    throw new FmErro(mensagemErro(e, spec.label), { causa: e });
  }

  await registrarAlteracoes({
    competencia_id: comp.id, tabela: spec.tabela, registro_id: row?.id || id,
    anterior, novo: registro, acao: id ? 'update' : 'insert',
    justificativa, eu
  });

  return row;
}

/** Grava a trilha CAMPO A CAMPO (§45): o que mudou, de que valor para qual. */
async function registrarAlteracoes({ competencia_id, tabela, registro_id, anterior, novo, acao, justificativa, eu }) {
  const base = { competencia_id, tabela, registro_id, acao, justificativa: justificativa || null,
                 usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil };
  if (acao === 'insert') {
    await logar({ ...base, valor_novo: resumo(novo) });
    return;
  }
  const IGNORAR = new Set(['updated_at', 'updated_by', 'created_at', 'created_by']);
  const mudancas = Object.keys(novo).filter(k =>
    !IGNORAR.has(k) && String(anterior?.[k] ?? '') !== String(novo[k] ?? ''));
  if (!mudancas.length) return;
  for (const campo of mudancas) {
    await logar({ ...base, campo,
      valor_anterior: anterior?.[campo] == null ? null : String(anterior[campo]),
      valor_novo: novo[campo] == null ? null : String(novo[campo]) });
  }
}

function resumo(row) {
  const partes = [];
  for (const k of ['data', 'data_reclamacao', 'data_quebra', 'part_number', 'cliente_oficial',
                   'categoria', 'tipo_defeito', 'problema', 'qtd_pecas', 'valor', 'quantidade']) {
    if (row[k] != null && row[k] !== '') partes.push(`${k}=${row[k]}`);
  }
  return partes.join(' · ') || 'registro criado';
}

/* -------------------------------------------------------------- exclusão --- */

/**
 * §47 — soft delete. O registro sai das listas e dos cálculos, mas continua no
 * banco com quem excluiu e quando. Exclusão física é privilégio do banco (admin
 * via SQL), nunca da interface.
 */
export async function excluir(secaoId, id, { competencia, user, motivo = '' } = {}) {
  const spec = SECOES[secaoId];
  if (!spec) throw new FmErro(`Seção desconhecida: ${secaoId}.`);
  if (!podeFechamento(user?.role, 'excluir')) {
    throw new FmErro('Somente o Administrador pode excluir lançamentos do fechamento.');
  }
  const comp = competencia?.id ? competencia : await obterCompetencia(competencia);
  exigirEditavel(comp);

  const anterior = await db.get(spec.tabela, id);
  if (!anterior) throw new FmErro('Registro não encontrado — talvez já tenha sido excluído.');

  const eu = identidade(user);
  const row = await db.update(spec.tabela, id, {
    deleted_at: agoraISO(), deleted_by: eu.id, updated_at: agoraISO()
  });
  await logar({
    competencia_id: comp.id, tabela: spec.tabela, registro_id: id, acao: 'delete',
    valor_anterior: resumo(anterior), justificativa: motivo,
    usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });
  return row;
}

/* ------------------------------------------------------ importação em lote */

/**
 * Insere vários registros já validados (usado pela importação e pelas
 * integrações). Devolve o que entrou e o que foi recusado, com o motivo —
 * nunca some com uma linha em silêncio.
 */
export async function inserirLote(secaoId, linhas, { competencia, user, origem = 'importado', source_module = null } = {}) {
  const comp = competencia?.id ? competencia : await obterCompetencia(competencia);
  exigirEditavel(comp);
  const ok = [], recusadas = [];
  for (const [i, linha] of linhas.entries()) {
    try {
      const row = await salvar(secaoId, { ...linha, origem, source_module }, { competencia: comp, user });
      ok.push(row);
    } catch (e) {
      recusadas.push({ indice: i, linha, motivo: e.message });
    }
  }
  return { inseridas: ok.length, recusadas, registros: ok };
}

/** Campos obrigatórios não preenchidos num registro (motor de pendências §32). */
export function faltantes(secaoId, registro) {
  return camposObrigatorios(secaoId)
    .filter(c => {
      if (c.showIf && !c.showIf(registro)) return false;
      const v = registro[c.k];
      return v == null || v === '' || (Array.isArray(v) && !v.length);
    })
    .map(c => c.l);
}
