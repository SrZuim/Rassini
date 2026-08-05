/* ==========================================================================
   RNA One — FECHAMENTO MENSAL · Integração com os módulos existentes (§29)
   ---------------------------------------------------------------------------
   O fechamento NÃO redigita o que o sistema já sabe. Este módulo lê os
   registros dos outros módulos e os oferece para importação na competência.

   Duas regras que impedem número inflado:
   1) VÍNCULO — todo registro importado grava source_module + source_record_id
      + source_type. É por esse par que a duplicidade é impedida (índice único
      em fm_ocorrencias garante isso também no banco).
   2) SUGESTÃO, NÃO AUTOMAÇÃO — nada entra sozinho. A Qualidade revisa a lista
      e confirma. Um relatório dimensional reprovado pode já ter virado
      ocorrência por outro caminho; só uma pessoa sabe.
   ========================================================================== */
import { db } from '../db.js';
import { agoraISO } from '../datahora.js';
import { FmErro, identidade, logar, exigirEditavel } from './fm-core.js';
import * as REG from './fm-registros.js';

const ativo = r => !r?.deleted_at;

/** Um registro externo já foi trazido para esta competência? */
async function jaImportado(tabela, source_module, source_record_id, competencia_id) {
  const rows = await db.list(tabela).catch(() => []);
  return rows.some(r => ativo(r) &&
    r.source_module === source_module &&
    String(r.source_record_id) === String(source_record_id) &&
    r.competencia_id === competencia_id);
}

/* ========================================================================== */
/* 1. RELATÓRIOS DIMENSIONAIS REPROVADOS → OCORRÊNCIAS INTERNAS (§29)          */
/* ========================================================================== */

/**
 * Lista os relatórios de inspeção dimensional REPROVADOS no período da
 * competência que ainda não viraram ocorrência interna.
 * O status é derivado do campo `resultado` — a mesma fonte que a consulta
 * corporativa usa (services/inspecao.js).
 */
export async function relatoriosDimensionaisReprovados(competencia) {
  const rels = await db.list('insp_relatorios').catch(() => []);
  const inicio = competencia.data_inicial, fim = competencia.data_final;

  const candidatos = rels.filter(r => {
    if (r.resultado !== 'reprovado') return false;
    if (competencia.planta && r.planta && r.planta !== competencia.planta) return false;
    const data = String(r.completed_iso || r.started_iso || r.created_at || '').slice(0, 10);
    return data && (!inicio || data >= inicio) && (!fim || data <= fim);
  });

  const resultado = [];
  for (const r of candidatos) {
    resultado.push({
      ...r,
      _data: String(r.completed_iso || r.started_iso || r.created_at || '').slice(0, 10),
      _importado: await jaImportado('fm_ocorrencias', 'consulta_dim', r.id, competencia.id)
    });
  }
  return resultado.sort((a, b) => String(b._data).localeCompare(String(a._data)));
}

/** Converte um relatório dimensional reprovado em ocorrência interna. */
export async function importarRelatorioDimensional(relatorio, competencia, user) {
  exigirEditavel(competencia);
  if (await jaImportado('fm_ocorrencias', 'consulta_dim', relatorio.id, competencia.id)) {
    throw new FmErro(`O relatório ${relatorio.numero || relatorio.id} já foi importado para esta competência.`);
  }

  /* Peças NG: quando o relatório não traz a quantidade, é melhor deixar o campo
     para a pessoa preencher do que chutar um número que entraria no PPM. */
  const qtd = Number(relatorio.quantidade || 0);

  return REG.salvar('ocorrencias', {
    data: String(relatorio.completed_iso || relatorio.started_iso || '').slice(0, 10),
    planta: relatorio.planta || competencia.planta,
    linha: relatorio.linha || null,
    turno: relatorio.turno || null,
    origem_ocorrencia: 'Auditoria dimensional',
    cliente: relatorio.cliente || null,
    part_number: relatorio.peca_codigo || null,
    produto: relatorio.peca_nome || null,
    tipo_defeito: 'Não conformidade dimensional',
    descricao: `Relatório de inspeção dimensional ${relatorio.numero || ''} reprovado. Peça: ${relatorio.peca_nome || '—'} (${relatorio.peca_codigo || '—'}). Lote: ${relatorio.lote || '—'} · OP: ${relatorio.op || '—'}.`,
    qtd_pecas: qtd,
    ordem_producao: relatorio.op || null,
    lote: relatorio.lote || null,
    detectado_por: relatorio.auditor_nome || null,
    status: 'Aberta',
    origem: 'automatico',
    source_module: 'consulta_dim',
    source_record_id: relatorio.id,
    source_type: 'insp_relatorios'
  }, { competencia, user });
}

/* ========================================================================== */
/* 2. NÃO CONFORMIDADES (RNC) — vínculo e sugestão                             */
/* ========================================================================== */

/** NCs abertas no período — para vincular a quebras e ocorrências (§29). */
export async function ncsDoPeriodo(competencia) {
  const ncs = await db.list('nao_conformidades').catch(() => []);
  return ncs.filter(n => {
    const data = String(n.data || n.created_at || '').slice(0, 10);
    if (competencia.data_inicial && data && data < competencia.data_inicial) return false;
    if (competencia.data_final && data && data > competencia.data_final) return false;
    return true;
  }).sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
}

export async function importarNC(nc, competencia, user) {
  exigirEditavel(competencia);
  if (await jaImportado('fm_ocorrencias', 'ocorrencias', nc.id, competencia.id)) {
    throw new FmErro(`A não conformidade ${nc.codigo || nc.id} já foi importada para esta competência.`);
  }
  return REG.salvar('ocorrencias', {
    data: String(nc.data || nc.created_at || '').slice(0, 10),
    planta: nc.planta || competencia.planta,
    setor: nc.setor || null, linha: nc.linha || nc.maquina || null,
    origem_ocorrencia: 'Contenção interna',
    part_number: nc.part_number || nc.peca || null,
    tipo_defeito: nc.categoria || nc.tipo || 'Não conformidade',
    descricao: nc.descricao || nc.titulo || '—',
    qtd_pecas: Number(nc.quantidade || 0),
    detectado_por: nc.responsavel || nc.aberto_por || null,
    classificacao: nc.severidade || null,
    rnc_id: nc.codigo || nc.id,
    status: 'Aberta',
    origem: 'automatico',
    source_module: 'ocorrencias', source_record_id: nc.id, source_type: 'nao_conformidades'
  }, { competencia, user });
}

/* ========================================================================== */
/* 3. PENDÊNCIAS OPERACIONAIS EM ABERTO (§29)                                  */
/* ========================================================================== */

/**
 * Pendências dos módulos operacionais que continuam abertas — aparecem no
 * fechamento como contexto, SEM virar pendência do fechamento (elas têm dono
 * e fluxo próprios; duplicá-las criaria duas listas para a mesma coisa).
 */
export async function pendenciasOperacionaisAbertas(competencia) {
  const rows = await db.list('op_pendencias').catch(() => []);
  return rows
    .filter(p => !['Concluída', 'Concluido', 'Concluído', 'Cancelada'].includes(p.status))
    .filter(p => {
      const data = String(p.created_at || p.data || '').slice(0, 10);
      return !competencia.data_final || !data || data <= competencia.data_final;
    })
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

/* ========================================================================== */
/* 4. PLANO 5W2H → TAREFA NA AGENDA DO RESPONSÁVEL (§29)                       */
/* ========================================================================== */

/**
 * Publica o plano como plano de ação corporativo (tabela `planos_acao`, já
 * consumida por planos-acao.html e pela agenda). Assim o prazo vencido aparece
 * para o responsável no módulo onde ele já trabalha.
 */
export async function publicarPlanoNaAgenda(acao, competencia, user) {
  const eu = identidade(user);
  const existentes = await db.list('planos_acao').catch(() => []);
  const ja = existentes.find(p => p.source_module === 'fechamento' && String(p.source_record_id) === String(acao.id));
  if (ja) throw new FmErro('Este plano já foi publicado na agenda corporativa.');

  const row = await db.insert('planos_acao', {
    codigo: `FM-${String(competencia.mes).padStart(2, '0')}${competencia.ano}-${String(acao.id).slice(-4)}`,
    titulo: acao.what || acao.problema || 'Plano do fechamento mensal',
    descricao: [acao.why && `Por quê: ${acao.why}`, acao.how && `Como: ${acao.how}`,
                acao.causa_raiz && `Causa raiz: ${acao.causa_raiz}`].filter(Boolean).join('\n'),
    responsavel: acao.who || null,
    prazo: acao.when_ || null,
    status: acao.status === 'Concluído' ? 'Concluído' : 'Aberto',
    origem: 'Fechamento Mensal',
    source_module: 'fechamento', source_record_id: acao.id, source_type: 'fm_acoes',
    created_at: agoraISO()
  });

  await logar({
    competencia_id: competencia.id, tabela: 'planos_acao', registro_id: row.id,
    acao: 'integracao', valor_novo: `Plano 5W2H publicado na agenda: ${row.codigo}`,
    usuario_id: eu.id, usuario: eu.nome, perfil: eu.perfil
  });
  return row;
}

/* ========================================================================== */
/* 5. BIBLIOTECA TÉCNICA — Part Numbers e clientes (§29)                       */
/* ========================================================================== */

/** Peças cadastradas, para autocompletar Part Number nos lançamentos. */
export async function pecas() {
  const rows = await db.list('bib_pecas').catch(() => []);
  return rows
    .filter(p => p.ativo !== false)
    .map(p => ({ codigo: p.codigo, nome: p.nome, cliente: p.cliente, tipo: p.tipo_produto || p.tipo }))
    .sort((a, b) => String(a.codigo).localeCompare(String(b.codigo)));
}

/** Usuários ativos, para os campos de responsável. */
export async function responsaveis() {
  const rows = await db.list('usuarios').catch(() => []);
  return rows
    .filter(u => u.ativo !== false && u.status !== 'inativo')
    .map(u => ({ id: u.id, nome: u.nome, email: u.email, role: u.role, planta: u.planta }))
    .sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
}

/* ========================================================================== */
/* 6. ÍNDICE DE AUDITORIA (§29) — alimenta "Outros Indicadores"                */
/* ========================================================================== */

/**
 * Percentual de relatórios dimensionais aprovados no período. Alimenta o
 * indicador "Índice de auditoria" do §28. Devolve null (não zero) quando não
 * há relatórios: zero significaria "todos reprovados".
 */
export async function indiceAuditoria(competencia) {
  const rels = (await db.list('insp_relatorios').catch(() => []))
    .filter(r => {
      const data = String(r.completed_iso || r.started_iso || '').slice(0, 10);
      if (!data) return false;
      if (competencia.data_inicial && data < competencia.data_inicial) return false;
      if (competencia.data_final && data > competencia.data_final) return false;
      return ['aprovado', 'reprovado'].includes(r.resultado);
    });
  if (!rels.length) {
    return { valor: null, exibicao: 'Sem relatórios no período', total: 0, aprovados: 0 };
  }
  const aprovados = rels.filter(r => r.resultado === 'aprovado').length;
  const pct = (aprovados / rels.length) * 100;
  return {
    valor: pct,
    exibicao: `${pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`,
    total: rels.length, aprovados
  };
}

/* ========================================================================== */
/* 7. PAINEL DE INTEGRAÇÕES                                                    */
/* ========================================================================== */

/** Resumo do que há disponível para importar — mostrado na aba do módulo. */
export async function disponiveis(competencia) {
  const [dimensionais, ncs, pendOp, idxAud] = await Promise.all([
    relatoriosDimensionaisReprovados(competencia).catch(() => []),
    ncsDoPeriodo(competencia).catch(() => []),
    pendenciasOperacionaisAbertas(competencia).catch(() => []),
    indiceAuditoria(competencia).catch(() => ({ valor: null, exibicao: '—' }))
  ]);
  return {
    dimensionais: {
      total: dimensionais.length,
      pendentes: dimensionais.filter(r => !r._importado).length,
      registros: dimensionais
    },
    ncs: { total: ncs.length, registros: ncs },
    pendenciasOperacionais: { total: pendOp.length, registros: pendOp },
    indiceAuditoria: idxAud
  };
}
