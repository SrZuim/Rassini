/* ==========================================================================
   RNA One — FECHAMENTO MENSAL · Cadastro unificado de clientes (§25)
   ---------------------------------------------------------------------------
   O mesmo cliente aparece com nomes diferentes em cada sistema:
     "MAN Latin América" · "Volkswagen" · "VW"  →  Volkswagen Caminhões e Ônibus
   Sem essa unificação, o PPM externo divide o denominador entre três "clientes"
   e o número fica errado sem que ninguém perceba.

   A CLASSIFICAÇÃO (§25) é deliberadamente conservadora:
     reconhecido    → casamento exato (nome oficial ou apelido cadastrado)
     possivel       → casamento aproximado — EXIGE confirmação humana
     nao_cadastrado → nenhuma semelhança encontrada
     duplicidade    → o mesmo nome do arquivo casa com dois clientes oficiais

   "possivel" NUNCA é importado automaticamente (§25 última regra): sugerir é
   ajudar, decidir sozinho é falsificar dado.
   ========================================================================== */
import { db } from '../db.js';
import { agoraISO } from '../datahora.js';
import { identidade, logar, FmErro } from './fm-core.js';
import { podeFechamento } from './fm-schema.js';

/* ------------------------------------------------------- normalização --- */

/** Reduz o nome a uma forma comparável: sem acento, sem pontuação, sem sufixo
    societário e sem espaços duplicados. "VOLKSWAGEN CAMINHÕES E ÔNIBUS LTDA."
    e "volkswagen caminhoes e onibus" viram a mesma chave. */
export function normalizar(nome) {
  return String(nome ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // remove acentos
    .toUpperCase()
    .replace(/[.,;:/\\'"()\-–—]/g, ' ')
    .replace(/\b(LTDA|S\s?A|SA|EIRELI|ME|EPP|INDUSTRIA|INDUSTRIAS|COMERCIO|DO BRASIL|BRASIL)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Similaridade 0..1 por distância de Levenshtein normalizada. */
export function similaridade(a, b) {
  const s = normalizar(a), t = normalizar(b);
  if (!s || !t) return 0;
  if (s === t) return 1;
  const m = s.length, n = t.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1, d[i][j - 1] + 1,
        d[i - 1][j - 1] + (s[i - 1] === t[j - 1] ? 0 : 1));
    }
  }
  return 1 - d[m][n] / Math.max(m, n);
}

const LIMIAR_SUGESTAO = 0.72;   // abaixo disso não vale nem sugerir

/* ------------------------------------------------------------- matching --- */

/**
 * Classifica um nome vindo do arquivo contra o cadastro de aliases.
 * FUNÇÃO PURA — testável sem banco.
 * @returns {{classificacao, oficial, candidatos, similaridade}}
 */
export function classificarCliente(nomeArquivo, aliases = []) {
  const alvo = normalizar(nomeArquivo);
  if (!alvo) {
    return { classificacao: 'nao_cadastrado', oficial: null, candidatos: [], similaridade: 0 };
  }

  const ativos = aliases.filter(a => a.ativo !== false);

  /* 1) casamento EXATO — nome oficial, apelidos ou nomes por sistema */
  const exatos = ativos.filter(a => {
    const formas = [a.nome_oficial, a.nome_faturamento, a.nome_indicadores, a.nome_outros,
                    ...(Array.isArray(a.apelidos) ? a.apelidos : [])];
    return formas.filter(Boolean).some(f => normalizar(f) === alvo);
  });

  if (exatos.length === 1) {
    return { classificacao: 'reconhecido', oficial: exatos[0].nome_oficial, candidatos: exatos, similaridade: 1 };
  }
  if (exatos.length > 1) {
    /* O mesmo apelido cadastrado em dois clientes: só uma pessoa resolve. */
    return { classificacao: 'duplicidade', oficial: null, candidatos: exatos, similaridade: 1 };
  }

  /* 2) casamento APROXIMADO — sugere, nunca decide */
  const pontuados = ativos.map(a => {
    const formas = [a.nome_oficial, a.nome_faturamento, a.nome_indicadores, a.nome_outros,
                    ...(Array.isArray(a.apelidos) ? a.apelidos : [])].filter(Boolean);
    const melhor = Math.max(...formas.map(f => similaridade(alvo, f)), 0);
    /* Contenção também vale: "VW CAMINHOES" dentro de "VOLKSWAGEN CAMINHOES..." */
    const contem = formas.some(f => {
      const nf = normalizar(f);
      return nf && (nf.includes(alvo) || alvo.includes(nf)) && Math.min(nf.length, alvo.length) >= 3;
    });
    return { alias: a, score: contem ? Math.max(melhor, 0.85) : melhor };
  }).filter(x => x.score >= LIMIAR_SUGESTAO)
    .sort((a, b) => b.score - a.score);

  if (!pontuados.length) {
    return { classificacao: 'nao_cadastrado', oficial: null, candidatos: [], similaridade: 0 };
  }
  return {
    classificacao: 'possivel',
    oficial: null,                            // deliberadamente vazio: exige confirmação
    candidatos: pontuados.slice(0, 5).map(x => x.alias),
    similaridade: pontuados[0].score,
    sugestao: pontuados[0].alias.nome_oficial
  };
}

/* ---------------------------------------------------------------- CRUD --- */

export async function listar({ incluirInativos = false } = {}) {
  const rows = await db.list('fm_clientes_alias').catch(() => []);
  return rows
    .filter(a => incluirInativos || a.ativo !== false)
    .sort((a, b) => String(a.nome_oficial).localeCompare(String(b.nome_oficial), 'pt-BR'));
}

/**
 * Semeia o cadastro a partir da lista OFICIAL já mantida pela Biblioteca
 * Técnica (bib_clientes). Não duplicamos a lista de clientes num segundo lugar
 * — a fonte única continua sendo a Biblioteca; aqui ficam apenas os APELIDOS.
 */
export async function semearDaBiblioteca(user) {
  const existentes = await listar({ incluirInativos: true });
  const jaTem = new Set(existentes.map(a => normalizar(a.nome_oficial)));

  let base = [];
  try {
    base = await db.list('bib_clientes');
  } catch {
    return { criados: 0, motivo: 'A Biblioteca Técnica (bib_clientes) não está disponível neste banco.' };
  }

  const eu = identidade(user);
  let criados = 0;
  for (const c of base) {
    const nome = c.nome || c.cliente;
    if (!nome || jaTem.has(normalizar(nome))) continue;
    await db.insert('fm_clientes_alias', {
      nome_oficial: nome, codigo: c.codigo || null, grupo_economico: null,
      apelidos: [], nome_faturamento: null, nome_indicadores: null, nome_outros: null,
      ativo: c.ativo !== false,
      created_at: agoraISO(), created_by: eu.id, updated_at: agoraISO()
    });
    criados++;
  }
  if (criados) {
    await logar({
      tabela: 'fm_clientes_alias', acao: 'seed',
      valor_novo: `${criados} clientes importados da Biblioteca Técnica`,
      usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
    });
  }
  return { criados };
}

export async function salvar(dados, { id = null, user } = {}) {
  if (!podeFechamento(user?.role, 'configurar')) {
    throw new FmErro('Somente o Administrador mantém o cadastro unificado de clientes.');
  }
  if (!String(dados.nome_oficial || '').trim()) {
    throw new FmErro('Não foi possível salvar porque o "Nome oficial" está vazio.');
  }

  const apelidos = Array.isArray(dados.apelidos)
    ? dados.apelidos
    : String(dados.apelidos || '').split(/[\n;,]/).map(s => s.trim()).filter(Boolean);

  /* Um apelido não pode pertencer a dois clientes — isso geraria "duplicidade"
     em toda importação futura. Barramos na origem, com a mensagem do conflito. */
  const outros = (await listar({ incluirInativos: true })).filter(a => a.id !== id);
  for (const ap of apelidos) {
    const conflito = outros.find(o =>
      [o.nome_oficial, o.nome_faturamento, o.nome_indicadores, o.nome_outros,
       ...(Array.isArray(o.apelidos) ? o.apelidos : [])]
        .filter(Boolean).some(f => normalizar(f) === normalizar(ap)));
    if (conflito) {
      throw new FmErro(`O apelido "${ap}" já pertence a "${conflito.nome_oficial}". Um apelido só pode apontar para um cliente.`);
    }
  }

  const eu = identidade(user);
  const row = {
    nome_oficial: String(dados.nome_oficial).trim(),
    codigo: dados.codigo || null,
    grupo_economico: dados.grupo_economico || null,
    apelidos,
    nome_faturamento: dados.nome_faturamento || null,
    nome_indicadores: dados.nome_indicadores || null,
    nome_outros: dados.nome_outros || null,
    ativo: dados.ativo !== false,
    updated_at: agoraISO(), updated_by: eu.id
  };

  const salvo = id
    ? await db.update('fm_clientes_alias', id, row)
    : await db.insert('fm_clientes_alias', { ...row, created_at: agoraISO(), created_by: eu.id });

  await logar({
    tabela: 'fm_clientes_alias', registro_id: salvo.id, acao: id ? 'update' : 'insert',
    valor_novo: `${row.nome_oficial} · apelidos: ${apelidos.join(', ') || '—'}`,
    usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });
  return salvo;
}

/** Adiciona um apelido ao cliente — usado ao confirmar uma associação
    "possível" na tela de validação da importação (§26). Assim o mesmo arquivo
    é reconhecido sozinho no mês seguinte. */
export async function aprenderApelido(clienteOficial, apelido, user) {
  const todos = await listar({ incluirInativos: true });
  const alvo = todos.find(a => normalizar(a.nome_oficial) === normalizar(clienteOficial));
  if (!alvo) throw new FmErro(`Cliente oficial "${clienteOficial}" não encontrado no cadastro.`);

  const atuais = Array.isArray(alvo.apelidos) ? alvo.apelidos : [];
  if (atuais.some(a => normalizar(a) === normalizar(apelido))) return alvo;

  const eu = identidade(user);
  const row = await db.update('fm_clientes_alias', alvo.id, {
    apelidos: [...atuais, apelido], updated_at: agoraISO(), updated_by: eu.id
  });
  await logar({
    tabela: 'fm_clientes_alias', registro_id: alvo.id, campo: 'apelidos', acao: 'update',
    valor_anterior: atuais.join(', '), valor_novo: [...atuais, apelido].join(', '),
    justificativa: 'Apelido aprendido na validação de uma importação.',
    usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });
  return row;
}

/** Resolve o nome oficial de um cliente (usado pelos lançamentos manuais). */
export async function resolver(nome) {
  const aliases = await listar();
  return classificarCliente(nome, aliases);
}
