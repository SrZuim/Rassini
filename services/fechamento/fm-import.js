/* ==========================================================================
   RNA One — FECHAMENTO MENSAL · Importação do faturamento (§24 a §27)
   ---------------------------------------------------------------------------
   Fluxo obrigatório do requisito, sem atalhos:
     selecionar → ler → identificar cabeçalhos → prévia → validar clientes →
     validar números → duplicidades → comparar com a versão anterior → confirmar

   NADA é gravado em fm_fornecimento antes da confirmação (§24). Enquanto isso,
   as linhas vivem em fm_import_linhas com seus erros e alertas — o que também
   deixa a importação auditável depois.

   Toda a parte de PARSE e VALIDAÇÃO é pura (sem db, sem DOM) para poder ser
   testada no Node. A leitura de .xlsx usa SheetJS, carregado por CDN na página.
   ========================================================================== */
import { db } from '../db.js';
import { agoraISO } from '../datahora.js';
import { identidade, logar, FmErro, obterCompetencia, exigirEditavel, config, mensagemErro } from './fm-core.js';
import { podeFechamento } from './fm-schema.js';
import { classificarCliente, normalizar } from './fm-clientes.js';

/* ========================================================================== */
/* 1. CAMPOS ESPERADOS (§24) e sinônimos de cabeçalho                          */
/* ========================================================================== */

export const CAMPOS_FATURAMENTO = [
  { k: 'cliente',            l: 'Cliente',                    tipo: 'texto',  req: true,
    sin: ['cliente', 'clientes', 'nome do cliente', 'razao social', 'customer'] },
  { k: 'faturamento_real',   l: 'Faturamento real',           tipo: 'numero',
    sin: ['faturamento real', 'faturamento', 'real', 'valor faturado', 'fat real'] },
  { k: 'faturamento_orcado', l: 'Faturamento orçado',         tipo: 'numero',
    sin: ['faturamento orcado', 'orcado', 'orcamento', 'budget', 'fat orcado', 'previsto'] },
  { k: 'variacao',           l: 'Variação',                   tipo: 'numero',
    sin: ['variacao', 'var', 'diferenca', 'delta'] },
  { k: 'toneladas',          l: 'Toneladas',                  tipo: 'numero',
    sin: ['toneladas', 'ton', 'tonelagem', 'peso ton'] },
  { k: 'qtd_fornecida',      l: 'Qtd. de peças fornecidas',   tipo: 'inteiro', req: true,
    sin: ['quantidade de pecas fornecidas', 'pecas fornecidas', 'qtd pecas', 'quantidade',
          'qtde', 'pecas', 'volume', 'qtd fornecida'] },
  { k: 'preco_medio_kg',     l: 'Preço médio por quilo',      tipo: 'numero',
    sin: ['preco medio por quilo', 'preco medio kg', 'preco kg', 'r$/kg'] },
  { k: 'preco_medio_peca',   l: 'Preço médio por peça',       tipo: 'numero',
    sin: ['preco medio por peca', 'preco medio peca', 'preco peca', 'r$/peca'] },
  { k: 'acumulado_ano',      l: 'Acumulado anual',            tipo: 'numero',
    sin: ['acumulado anual', 'acumulado', 'ytd', 'acumulado ano'] },
  { k: 'part_number',        l: 'Part Number',                tipo: 'texto',
    sin: ['part number', 'pn', 'codigo da peca', 'item'] }
];

/* ========================================================================== */
/* 2. PARSE (puro)                                                             */
/* ========================================================================== */

/**
 * Número em formato BRASILEIRO (§50 "número em formato brasileiro").
 *   "1.234,56" → 1234.56      "1,5"   → 1.5
 *   "1234.56"  → 1234.56      "(500)" → -500   (contabilidade)
 *   "R$ 1.234,56" → 1234.56   ""      → null
 * Regra do separador: se existe vírgula, o ponto é MILHAR. Sem vírgula, o ponto
 * é decimal — a menos que apareça em grupos de 3 ("1.234.567").
 */
export function parseNumeroBR(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;

  let s = String(v).trim();
  if (!s) return null;

  let negativo = false;
  if (/^\(.*\)$/.test(s)) { negativo = true; s = s.slice(1, -1); }
  s = s.replace(/[R$\s ]/gi, '').replace(/%/g, '');
  if (s.startsWith('-')) { negativo = true; s = s.slice(1); }
  if (!s) return null;

  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '');                 // 1.234.567 = milhar, não decimal
  }

  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return negativo ? -n : n;
}

/** Divide uma linha de CSV respeitando aspas e o separador detectado. */
export function parseLinhaCSV(linha, sep) {
  const out = [];
  let atual = '', dentroAspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (ch === '"') {
      if (dentroAspas && linha[i + 1] === '"') { atual += '"'; i++; }
      else dentroAspas = !dentroAspas;
    } else if (ch === sep && !dentroAspas) {
      out.push(atual); atual = '';
    } else atual += ch;
  }
  out.push(atual);
  return out.map(c => c.trim());
}

/** Detecta o separador do CSV (vírgula, ponto e vírgula ou tab). */
export function detectarSeparador(texto) {
  const primeira = String(texto).split(/\r?\n/).find(l => l.trim()) || '';
  const cont = s => (primeira.match(new RegExp(`\\${s}`, 'g')) || []).length;
  const candidatos = [[';', cont(';')], [',', cont(',')], ['\t', cont('\t')]];
  candidatos.sort((a, b) => b[1] - a[1]);
  return candidatos[0][1] > 0 ? candidatos[0][0] : ';';
}

/** CSV → matriz de células (puro). */
export function parseCSV(texto) {
  const sep = detectarSeparador(texto);
  return String(texto)
    .split(/\r?\n/)
    .filter(l => l.trim() !== '')
    .map(l => parseLinhaCSV(l, sep));
}

/**
 * Acha a linha de cabeçalho na matriz. Planilhas de faturamento costumam ter
 * título e logotipo nas primeiras linhas — assumir "linha 1" quebraria (§24:
 * "não depender apenas da posição fixa da coluna").
 * Critério: a linha que casa com o maior número de campos conhecidos.
 */
export function acharCabecalho(matriz) {
  let melhor = { indice: 0, acertos: -1 };
  const limite = Math.min(matriz.length, 15);
  for (let i = 0; i < limite; i++) {
    const acertos = matriz[i].filter(cel => !!identificarCampo(cel)).length;
    if (acertos > melhor.acertos) melhor = { indice: i, acertos };
  }
  return melhor.acertos > 0 ? melhor.indice : 0;
}

/** Qual campo do RNA On corresponde a este texto de cabeçalho? */
export function identificarCampo(textoColuna) {
  const alvo = normalizarCabecalho(textoColuna);
  if (!alvo) return null;
  for (const campo of CAMPOS_FATURAMENTO) {
    if (campo.sin.some(s => normalizarCabecalho(s) === alvo)) return campo.k;
  }
  for (const campo of CAMPOS_FATURAMENTO) {
    if (campo.sin.some(s => alvo.includes(normalizarCabecalho(s)))) return campo.k;
  }
  return null;
}

function normalizarCabecalho(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9$/ ]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Mapeamento automático coluna → campo (§24). O usuário pode sobrescrever na
 * tela; por isso devolvemos também as colunas não reconhecidas.
 */
export function mapearColunas(cabecalho) {
  const mapa = {}, naoReconhecidas = [];
  cabecalho.forEach((titulo, idx) => {
    const campo = identificarCampo(titulo);
    if (campo && !(campo in mapa)) mapa[campo] = idx;
    else if (String(titulo || '').trim()) naoReconhecidas.push({ indice: idx, titulo });
  });
  const faltando = CAMPOS_FATURAMENTO.filter(c => c.req && !(c.k in mapa)).map(c => c.l);
  return { mapa, naoReconhecidas, faltando };
}

/** Aplica o mapeamento às linhas de dados (puro). */
export function extrairLinhas(matriz, indiceCabecalho, mapa) {
  const linhas = [];
  for (let i = indiceCabecalho + 1; i < matriz.length; i++) {
    const celulas = matriz[i];
    if (!celulas.some(c => String(c ?? '').trim() !== '')) continue;   // linha vazia
    const bruto = {}, dados = {};
    for (const [campo, idx] of Object.entries(mapa)) {
      const cru = celulas[idx];
      bruto[campo] = cru ?? null;
      const spec = CAMPOS_FATURAMENTO.find(c => c.k === campo);
      dados[campo] = spec?.tipo === 'texto'
        ? (String(cru ?? '').trim() || null)
        : parseNumeroBR(cru);
      if (spec?.tipo === 'inteiro' && dados[campo] != null) dados[campo] = Math.round(dados[campo]);
    }
    linhas.push({ linha_num: i + 1, bruto, dados });
  }
  return linhas;
}

/* ========================================================================== */
/* 3. VALIDAÇÃO (§26) — pura                                                   */
/* ========================================================================== */

/**
 * Valida as linhas e classifica os clientes.
 * @returns {{linhas, resumo}} — linhas com status/erros/alertas e o resumo da tela.
 */
export function validarLinhas(linhas, aliases = [], { anterior = [], limiteVariacao = 10 } = {}) {
  const vistos = new Map();          // cliente normalizado → primeira linha
  const anteriorPorCliente = new Map(
    (anterior || []).map(a => [normalizar(a.cliente_oficial || a.cliente), a]));

  const processadas = linhas.map(l => {
    const erros = [], alertas = [];
    const d = l.dados;

    /* --- obrigatórios (§26 "campos obrigatórios ausentes") --- */
    for (const campo of CAMPOS_FATURAMENTO.filter(c => c.req)) {
      const v = d[campo.k];
      if (v == null || v === '') erros.push(`"${campo.l}" está vazio.`);
    }

    /* --- tipos numéricos (§24) --- */
    for (const campo of CAMPOS_FATURAMENTO.filter(c => c.tipo !== 'texto')) {
      const cru = l.bruto[campo.k];
      if (cru != null && String(cru).trim() !== '' && d[campo.k] == null) {
        erros.push(`"${campo.l}": "${cru}" não é um número válido.`);
      }
    }

    /* --- valores negativos (§26) --- */
    for (const campo of ['qtd_fornecida', 'toneladas', 'faturamento_real']) {
      if (d[campo] != null && d[campo] < 0) {
        alertas.push(`"${CAMPOS_FATURAMENTO.find(c => c.k === campo).l}" está negativo (${d[campo]}).`);
      }
    }
    if (d.qtd_fornecida === 0) alertas.push('Quantidade fornecida igual a zero.');

    /* --- cliente (§25) --- */
    const cls = classificarCliente(d.cliente, aliases);
    if (cls.classificacao === 'nao_cadastrado') {
      erros.push(`Cliente "${d.cliente}" não está cadastrado. Associe-o antes de importar.`);
    } else if (cls.classificacao === 'possivel') {
      alertas.push(`Cliente "${d.cliente}" parece ser "${cls.sugestao}" — confirme a associação.`);
    } else if (cls.classificacao === 'duplicidade') {
      erros.push(`Cliente "${d.cliente}" casa com mais de um cliente oficial: ${cls.candidatos.map(c => c.nome_oficial).join(', ')}.`);
    }

    /* --- duplicidade de linhas (§26) --- */
    const chave = `${normalizar(cls.oficial || d.cliente)}|${normalizar(d.part_number || '')}`;
    if (vistos.has(chave)) {
      erros.push(`Linha duplicada: o mesmo cliente já aparece na linha ${vistos.get(chave)}.`);
    } else {
      vistos.set(chave, l.linha_num);
    }

    /* --- comparação com a versão anterior (§27) --- */
    let diff = null;
    if (cls.oficial) {
      const ant = anteriorPorCliente.get(normalizar(cls.oficial));
      if (ant) {
        const antes = Number(ant.qtd_fornecida || 0), agora = Number(d.qtd_fornecida || 0);
        const varPct = antes === 0 ? null : ((agora - antes) / Math.abs(antes)) * 100;
        diff = { tipo: 'alterado', antes, agora, variacao: varPct };
        if (varPct != null && Math.abs(varPct) > limiteVariacao) {
          alertas.push(`Variação de ${varPct.toFixed(1)}% na quantidade fornecida em relação à versão anterior.`);
        }
        if (antes === agora) diff.tipo = 'inalterado';
      } else {
        diff = { tipo: 'adicionado', antes: null, agora: Number(d.qtd_fornecida || 0), variacao: null };
      }
    }

    return {
      ...l,
      cliente_arquivo: d.cliente,
      cliente_oficial: cls.oficial,
      classificacao_cliente: cls.classificacao,
      sugestao_cliente: cls.sugestao || null,
      candidatos: cls.candidatos?.map(c => c.nome_oficial) || [],
      erros, alertas, diff,
      status: erros.length ? 'invalido' : (alertas.length ? 'alerta' : 'valido')
    };
  });

  /* Removidos: estavam na versão anterior e sumiram nesta (§27). */
  const oficiaisAgora = new Set(processadas.map(l => normalizar(l.cliente_oficial)).filter(Boolean));
  const removidos = (anterior || [])
    .filter(a => !oficiaisAgora.has(normalizar(a.cliente_oficial || a.cliente)))
    .map(a => ({ cliente: a.cliente_oficial || a.cliente, antes: Number(a.qtd_fornecida || 0) }));

  const resumo = {
    total: processadas.length,
    validos: processadas.filter(l => l.status === 'valido').length,
    alertas: processadas.filter(l => l.status === 'alerta').length,
    invalidos: processadas.filter(l => l.status === 'invalido').length,
    clientesNaoReconhecidos: processadas.filter(l => l.classificacao_cliente === 'nao_cadastrado').length,
    clientesPossiveis: processadas.filter(l => l.classificacao_cliente === 'possivel').length,
    duplicados: processadas.filter(l => l.erros.some(e => e.startsWith('Linha duplicada'))).length,
    valoresVazios: processadas.filter(l => l.erros.some(e => e.includes('está vazio'))).length,
    valoresNegativos: processadas.filter(l => l.alertas.some(a => a.includes('negativo'))).length,
    alterados: processadas.filter(l => l.diff?.tipo === 'alterado').length,
    adicionados: processadas.filter(l => l.diff?.tipo === 'adicionado').length,
    removidos: removidos.length,
    variacaoAlta: processadas.filter(l => l.alertas.some(a => a.startsWith('Variação de'))).length,
    listaRemovidos: removidos
  };
  resumo.podeConfirmar = resumo.invalidos === 0 && resumo.total > 0;
  resumo.motivoBloqueio = resumo.total === 0
    ? 'O arquivo não tem nenhuma linha de dados.'
    : (resumo.invalidos > 0
        ? `Existem ${resumo.invalidos} linha(s) com erro crítico. Corrija ou marque para ignorar antes de confirmar.`
        : null);

  return { linhas: processadas, resumo };
}

/* ========================================================================== */
/* 4. LEITURA DO ARQUIVO (usa SheetJS quando .xlsx/.xls)                       */
/* ========================================================================== */

export const EXTENSOES_ACEITAS = ['.xlsx', '.xls', '.csv'];

/** Lê o arquivo e devolve a matriz de células. */
export async function lerArquivo(file) {
  const nome = String(file?.name || '');
  const ext = nome.slice(nome.lastIndexOf('.')).toLowerCase();
  if (!EXTENSOES_ACEITAS.includes(ext)) {
    throw new FmErro(`Formato não aceito: "${ext}". Envie um arquivo ${EXTENSOES_ACEITAS.join(', ')}.`);
  }

  if (ext === '.csv') {
    const texto = await lerTexto(file);
    return { matriz: parseCSV(texto), planilha: null };
  }

  if (typeof XLSX === 'undefined') {
    throw new FmErro('A biblioteca de leitura de planilhas (SheetJS) não carregou. Recarregue a página; se persistir, salve o arquivo como .csv e importe novamente.');
  }
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false, raw: false });
  const nomePlanilha = wb.SheetNames[0];
  const ws = wb.Sheets[nomePlanilha];
  const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: false });
  return { matriz: matriz.map(l => l.map(c => String(c ?? '').trim())), planilha: nomePlanilha, planilhas: wb.SheetNames };
}

/** Lê texto tentando UTF-8 e caindo para windows-1252 quando há caracteres
    inválidos — planilhas exportadas do ERP costumam vir em latin1. */
function lerTexto(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new FmErro('Não foi possível ler o arquivo selecionado.'));
    r.onload = () => {
      const texto = String(r.result || '');
      if (texto.includes('�')) {
        const r2 = new FileReader();
        r2.onload = () => resolve(String(r2.result || ''));
        r2.onerror = () => resolve(texto);
        r2.readAsText(file, 'windows-1252');
      } else resolve(texto);
    };
    r.readAsText(file, 'utf-8');
  });
}

/* ========================================================================== */
/* 5. PERSISTÊNCIA — rascunho, confirmação e versionamento (§27)               */
/* ========================================================================== */

/** Próxima versão da importação desta competência (§27). */
export async function proximaVersao(competencia_id, tipo = 'faturamento') {
  const rows = (await db.list('fm_importacoes').catch(() => []))
    .filter(i => i.competencia_id === competencia_id && i.tipo === tipo && !i.deleted_at);
  return rows.reduce((max, i) => Math.max(max, Number(i.versao || 0)), 0) + 1;
}

/** Última importação CONFIRMADA — base da comparação entre versões. */
export async function importacaoVigente(competencia_id, tipo = 'faturamento') {
  const rows = (await db.list('fm_importacoes').catch(() => []))
    .filter(i => i.competencia_id === competencia_id && i.tipo === tipo && !i.deleted_at)
    .filter(i => ['Confirmada', 'Aprovada'].includes(i.status));
  return rows.sort((a, b) => Number(b.versao) - Number(a.versao))[0] || null;
}

/**
 * Cria a importação em RASCUNHO com todas as linhas e seus problemas.
 * Nenhum dado vai para fm_fornecimento aqui (§24).
 */
export async function criarRascunho({ competencia, arquivo, matriz, mapa, indiceCabecalho, linhasValidadas, resumo, observacoes }, user) {
  if (!podeFechamento(user?.role, 'importar')) {
    throw new FmErro('Somente Administrador ou Gestor da Qualidade pode importar arquivos.');
  }
  exigirEditavel(competencia);

  const eu = identidade(user);
  const versao = await proximaVersao(competencia.id);

  let imp;
  try {
    imp = await db.insert('fm_importacoes', {
      competencia_id: competencia.id, tipo: 'faturamento', planta: competencia.planta,
      arquivo_nome: arquivo?.name || 'arquivo', arquivo_url: null,
      arquivo_hash: await hashArquivo(arquivo).catch(() => null),
      versao,
      status: resumo.invalidos ? 'Com erros' : 'Validada',
      qtd_registros: resumo.total, qtd_erros: resumo.invalidos, qtd_alertas: resumo.alertas,
      mapeamento: { mapa, indiceCabecalho, cabecalho: matriz[indiceCabecalho] },
      observacoes: observacoes || null,
      usuario_id: eu.id, usuario: eu.nome, importado_em: agoraISO(),
      created_at: agoraISO(), updated_at: agoraISO()
    });
  } catch (e) {
    throw new FmErro(mensagemErro(e, 'importação'), { causa: e });
  }

  for (const l of linhasValidadas) {
    await db.insert('fm_import_linhas', {
      importacao_id: imp.id, linha_num: l.linha_num,
      bruto: l.bruto, dados: l.dados,
      cliente_arquivo: l.cliente_arquivo, cliente_oficial: l.cliente_oficial,
      classificacao_cliente: l.classificacao_cliente,
      status: l.status, erros: l.erros, alertas: l.alertas,
      ignorada: false, created_at: agoraISO()
    });
  }

  await logar({
    competencia_id: competencia.id, tabela: 'fm_importacoes', registro_id: imp.id,
    acao: 'import', valor_novo: `${arquivo?.name || 'arquivo'} · V${versao} · ${resumo.total} registros, ${resumo.invalidos} erro(s)`,
    usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });
  return imp;
}

/** Corrige a associação de cliente de uma linha antes de confirmar (§26). */
export async function corrigirAssociacao(linha_id, clienteOficial, user) {
  const eu = identidade(user);
  const linha = await db.get('fm_import_linhas', linha_id);
  if (!linha) throw new FmErro('Linha da importação não encontrada.');
  const erros = (linha.erros || []).filter(e => !e.includes('não está cadastrado') && !e.includes('casa com mais de um'));
  const alertas = (linha.alertas || []).filter(a => !a.includes('confirme a associação'));
  const row = await db.update('fm_import_linhas', linha_id, {
    cliente_oficial: clienteOficial, classificacao_cliente: 'reconhecido',
    erros, alertas, status: erros.length ? 'invalido' : (alertas.length ? 'alerta' : 'valido')
  });
  await logar({
    tabela: 'fm_import_linhas', registro_id: linha_id, campo: 'cliente_oficial', acao: 'update',
    valor_anterior: linha.cliente_oficial || linha.cliente_arquivo, valor_novo: clienteOficial,
    justificativa: 'Associação confirmada na validação da importação.',
    usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });
  return row;
}

/** Ignora uma linha COM justificativa (§26). */
export async function ignorarLinha(linha_id, justificativa, user) {
  if (!String(justificativa || '').trim()) {
    throw new FmErro('Informe a justificativa para ignorar esta linha.');
  }
  const eu = identidade(user);
  const row = await db.update('fm_import_linhas', linha_id, {
    ignorada: true, justificativa_ignorar: justificativa, status: 'ignorada'
  });
  await logar({
    tabela: 'fm_import_linhas', registro_id: linha_id, acao: 'ignorar',
    justificativa, usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });
  return row;
}

/**
 * §26/§27 — confirma a importação: só aqui os dados chegam em fm_fornecimento.
 * A versão anterior NÃO é apagada (§27 "nunca sobrescrever silenciosamente"):
 * os registros antigos recebem soft delete e a nova versão entra carimbada.
 */
export async function confirmar(importacao_id, { user, competencia } = {}) {
  if (!podeFechamento(user?.role, 'importar')) {
    throw new FmErro('Somente Administrador ou Gestor da Qualidade pode confirmar importações.');
  }
  const imp = await db.get('fm_importacoes', importacao_id);
  if (!imp) throw new FmErro('Importação não encontrada.');
  const comp = competencia?.id ? competencia : await obterCompetencia(imp.competencia_id);
  exigirEditavel(comp);

  const linhas = (await db.list('fm_import_linhas')).filter(l => l.importacao_id === importacao_id);
  const efetivas = linhas.filter(l => !l.ignorada && l.status !== 'invalido');
  const invalidas = linhas.filter(l => !l.ignorada && l.status === 'invalido');

  if (invalidas.length) {
    throw new FmErro(`Não é possível confirmar: ${invalidas.length} linha(s) ainda têm erro crítico. Corrija a associação do cliente ou marque a linha para ignorar (com justificativa).`);
  }
  if (!efetivas.length) {
    throw new FmErro('Não há nenhuma linha válida para importar.');
  }

  const eu = identidade(user);

  /* Versão anterior sai de cena por soft delete — continua auditável. */
  const anteriores = (await db.list('fm_fornecimento'))
    .filter(f => f.competencia_id === comp.id && !f.deleted_at);
  for (const a of anteriores) {
    await db.update('fm_fornecimento', a.id, {
      deleted_at: agoraISO(), deleted_by: eu.id, updated_at: agoraISO()
    });
  }

  let inseridos = 0;
  for (const l of efetivas) {
    const d = l.dados || {};
    await db.insert('fm_fornecimento', {
      competencia_id: comp.id, planta: comp.planta,
      cliente: l.cliente_arquivo, cliente_oficial: l.cliente_oficial,
      part_number: d.part_number || null,
      qtd_fornecida: Math.round(Number(d.qtd_fornecida || 0)),
      faturamento_real: d.faturamento_real ?? null,
      faturamento_orcado: d.faturamento_orcado ?? null,
      variacao: d.variacao ?? null, toneladas: d.toneladas ?? null,
      preco_medio_kg: d.preco_medio_kg ?? null, preco_medio_peca: d.preco_medio_peca ?? null,
      acumulado_ano: d.acumulado_ano ?? null,
      fonte: 'Importação', importacao_id: imp.id, versao: imp.versao,
      origem: 'importado',
      created_at: agoraISO(), created_by: eu.id, updated_at: agoraISO()
    });
    inseridos++;
  }

  /* Registro da comparação entre versões (§27). */
  const alterados = linhas.filter(l => l.dados && anteriores.some(a =>
    normalizar(a.cliente_oficial) === normalizar(l.cliente_oficial) &&
    Number(a.qtd_fornecida) !== Number(l.dados.qtd_fornecida))).length;
  const adicionados = linhas.filter(l => l.cliente_oficial && !anteriores.some(a =>
    normalizar(a.cliente_oficial) === normalizar(l.cliente_oficial))).length;
  const removidos = anteriores.filter(a => !linhas.some(l =>
    normalizar(l.cliente_oficial) === normalizar(a.cliente_oficial))).length;

  await db.insert('fm_import_versoes', {
    importacao_id: imp.id,
    versao_anterior: imp.versao > 1 ? imp.versao - 1 : null, versao_atual: imp.versao,
    alterados, adicionados, removidos,
    variacao_alta: linhas.filter(l => (l.alertas || []).some(a => String(a).startsWith('Variação de'))).length,
    detalhe: [], usuario: eu.nome, quando: agoraISO()
  });

  await db.update('fm_importacoes', importacao_id, {
    status: 'Confirmada', updated_at: agoraISO()
  });

  await logar({
    competencia_id: comp.id, tabela: 'fm_importacoes', registro_id: importacao_id,
    acao: 'import_confirmada',
    valor_novo: `V${imp.versao}: ${inseridos} registros · ${alterados} alterado(s), ${adicionados} adicionado(s), ${removidos} removido(s)`,
    usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });

  return { inseridos, alterados, adicionados, removidos, versao: imp.versao };
}

/**
 * §50 "rollback" — desfaz uma importação confirmada, restaurando a versão
 * anterior do fornecimento. Nada é apagado fisicamente.
 */
export async function reverter(importacao_id, { motivo, user }) {
  if (!podeFechamento(user?.role, 'importar')) {
    throw new FmErro('Somente Administrador ou Gestor da Qualidade pode reverter importações.');
  }
  if (!String(motivo || '').trim()) throw new FmErro('Informe o motivo da reversão.');

  const imp = await db.get('fm_importacoes', importacao_id);
  if (!imp) throw new FmErro('Importação não encontrada.');
  if (imp.status !== 'Confirmada') throw new FmErro(`Só é possível reverter importação CONFIRMADA (atual: ${imp.status}).`);

  const comp = await obterCompetencia(imp.competencia_id);
  exigirEditavel(comp);
  const eu = identidade(user);

  const todos = await db.list('fm_fornecimento');
  const daImportacao = todos.filter(f => f.importacao_id === importacao_id && !f.deleted_at);
  for (const f of daImportacao) {
    await db.update('fm_fornecimento', f.id, {
      deleted_at: agoraISO(), deleted_by: eu.id, updated_at: agoraISO()
    });
  }

  /* Restaura a versão imediatamente anterior, se existir. */
  const anterior = todos
    .filter(f => f.competencia_id === imp.competencia_id && f.importacao_id && f.importacao_id !== importacao_id && f.deleted_at)
    .sort((a, b) => Number(b.versao || 0) - Number(a.versao || 0));
  const versaoRestaurada = anterior.length ? Number(anterior[0].versao) : null;
  let restaurados = 0;
  for (const f of anterior.filter(x => Number(x.versao) === versaoRestaurada)) {
    await db.update('fm_fornecimento', f.id, { deleted_at: null, deleted_by: null, updated_at: agoraISO() });
    restaurados++;
  }

  await db.update('fm_importacoes', importacao_id, { status: 'Cancelada', updated_at: agoraISO() });
  await logar({
    competencia_id: imp.competencia_id, tabela: 'fm_importacoes', registro_id: importacao_id,
    acao: 'import_revertida', justificativa: motivo,
    valor_novo: `V${imp.versao} revertida · ${daImportacao.length} removido(s), ${restaurados} restaurado(s) da V${versaoRestaurada ?? '—'}`,
    usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });
  return { removidos: daImportacao.length, restaurados, versaoRestaurada };
}

export async function listarImportacoes(competencia_id) {
  const rows = (await db.list('fm_importacoes').catch(() => []))
    .filter(i => i.competencia_id === competencia_id && !i.deleted_at);
  return rows.sort((a, b) => Number(b.versao) - Number(a.versao));
}

export async function linhasDa(importacao_id) {
  const rows = await db.list('fm_import_linhas').catch(() => []);
  return rows.filter(l => l.importacao_id === importacao_id)
             .sort((a, b) => Number(a.linha_num) - Number(b.linha_num));
}

/** Hash SHA-256 do arquivo — identifica reimportação do mesmo conteúdo (§40). */
async function hashArquivo(file) {
  if (!file || typeof crypto === 'undefined' || !crypto.subtle) return null;
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/* Limite de variação configurável (§27). */
export async function limiteVariacao(planta) {
  const cfg = await config('import_variacao_alerta', planta, { percentual: 10 });
  return Number(cfg?.percentual ?? 10);
}
