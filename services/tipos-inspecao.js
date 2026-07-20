/* ==========================================================================
   RNA One — TIPOS DE INSPEÇÃO · FONTE ÚNICA DA VERDADE (§12)
   Toda tela que exibe, filtra ou grava um tipo de inspeção passa por aqui:
   Biblioteca Técnica (cadastro/edição/listagem/filtros), Minhas Auditorias,
   relatórios e consultas. NÃO declare listas de tipos em outro arquivo.

   O catálogo canônico já existia: `insp_tipos` (semente INSP_TIPOS_DEFAULT em
   inspecao-data.js), com slug estável por tipo. Este módulo é a fachada de
   leitura/normalização em volta dele — não duplica a lista.

   Slugs canônicos (estáveis, já gravados em insp_relatorios.tipo_slug):
     vda65 · layout · final · ppap · durabilidade · ride · fisico_dim

   Este módulo não importa db.js no topo (import dinâmico) para poder ser usado
   tanto pela camada de dados quanto pelas páginas sem risco de ciclo.
   ========================================================================== */
import { INSP_TIPOS_DEFAULT } from './inspecao-data.js';

/* Identificadores alternativos aceitos na LEITURA (import de planilha, payload
   externo, documentação que usa nomes longos). Sempre normalizados para o slug
   canônico antes de gravar — evita "PPAP"/"Ppap"/"ppap" divergentes (§12). */
const ALIASES = {
  vda_6_5: 'vda65', vda6_5: 'vda65', vda: 'vda65', auditoria_vda_6_5: 'vda65',
  inspecao_layout: 'layout', layout_inspecao: 'layout',
  inspecao_final: 'final',
  processo_ppap: 'ppap',
  relatorio_durabilidade: 'durabilidade', durability: 'durabilidade',
  relatorio_ride: 'ride',
  teste_fisico_dimensional: 'fisico_dim', fisico_dimensional: 'fisico_dim'
};

/** Rótulo curto para chips/etiquetas (a listagem fica ilegível com o nome longo
    do PPAP). O nome completo continua sendo o de `insp_tipos.nome`. */
const CURTOS = {
  vda65: 'VDA 6.5', layout: 'Layout', final: 'Inspeção Final', ppap: 'PPAP',
  durabilidade: 'Durabilidade', ride: 'Ride', fisico_dim: 'Físico e Dimensional'
};

/** Marcador de peça legada, ainda sem vínculo configurado (§5). */
export const SEM_TIPOS_LABEL = 'Tipo de inspeção não configurado';

/** Normaliza um identificador qualquer → slug canônico, ou null se desconhecido. */
export function normalizarSlug(valor) {
  const s = String(valor ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!s) return null;
  if (INSP_TIPOS_DEFAULT.some(t => t.slug === s)) return s;
  return ALIASES[s] || null;
}

/** Lista canônica dos tipos ATIVOS. Lê `insp_tipos` (permite CRUD futuro pelo
    Admin) e cai na semente se a tabela ainda não existir/estiver vazia. */
export async function listarTipos() {
  let rows = [];
  try {
    const { db } = await import('./db.js');
    rows = await db.list('insp_tipos');
  } catch { /* tabela ausente → usa a semente abaixo */ }
  const base = (rows && rows.length) ? rows : INSP_TIPOS_DEFAULT;
  return base.filter(t => t.ativo !== false)
    .map(t => ({ ...t, curto: CURTOS[t.slug] || t.nome }))
    .sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
}

/** Mapa slug → { slug, nome, curto } para render rápido de chips. */
export async function mapaTipos() {
  const list = await listarTipos();
  return Object.fromEntries(list.map(t => [t.slug, t]));
}

/** Rótulo completo de um slug (fallback: o próprio slug, nunca "undefined"). */
export function nomeDoSlug(slug, mapa) {
  const s = normalizarSlug(slug) || slug;
  return mapa?.[s]?.nome || INSP_TIPOS_DEFAULT.find(t => t.slug === s)?.nome || String(slug ?? '—');
}
/** Rótulo curto de um slug (chips/etiquetas). */
export function curtoDoSlug(slug, mapa) {
  const s = normalizarSlug(slug) || slug;
  return mapa?.[s]?.curto || CURTOS[s] || nomeDoSlug(slug, mapa);
}

/* ============================================================ PEÇA × TIPOS ==
   `bib_pecas.tipos_inspecao` guarda um array de slugs canônicos. Aceita também
   JSON em texto e string separada por vírgula (bancos/imports legados). */

/** Lê os tipos de uma peça, sempre como array de slugs canônicos válidos. */
export function tiposDaPeca(peca) {
  const bruto = peca?.tipos_inspecao;
  let arr = [];
  if (Array.isArray(bruto)) arr = bruto;
  else if (typeof bruto === 'string' && bruto.trim()) {
    const t = bruto.trim();
    if (t.startsWith('[')) { try { arr = JSON.parse(t); } catch { arr = []; } }
    else arr = t.split(',');
  }
  return [...new Set(arr.map(normalizarSlug).filter(Boolean))];
}

/** true quando a peça ainda não foi configurada (registro legado, §5). */
export function semTiposConfigurados(peca) {
  return tiposDaPeca(peca).length === 0;
}

/** Regra de compatibilidade (§6). Peça sem configuração NÃO é compatível com
    tipo algum — aparecer em todas as inspeções manteria o risco de seleção
    incorreta que esta melhoria existe para eliminar (§5). */
export function pecaAtendeTipo(peca, tipoSlug) {
  const alvo = normalizarSlug(tipoSlug);
  if (!alvo) return false;
  return tiposDaPeca(peca).includes(alvo);
}

/** Validação de cadastro (§3), reutilizada pelo formulário E pelo serviço (§3
    "também na camada de persistência"). Retorna string de erro ou null. */
export const MSG_TIPOS_OBRIGATORIO = 'Selecione pelo menos um tipo de inspeção aplicável a esta peça.';
export function validarTiposInspecao(valor) {
  const arr = tiposDaPeca({ tipos_inspecao: valor });
  return arr.length ? null : MSG_TIPOS_OBRIGATORIO;
}

/** Normaliza para gravação: array de slugs canônicos, sem duplicatas, ordenado
    pela ordem oficial do catálogo (saída estável no banco e nos diffs). */
export function normalizarParaGravar(valor) {
  const arr = tiposDaPeca({ tipos_inspecao: valor });
  const ordem = INSP_TIPOS_DEFAULT.map(t => t.slug);
  return arr.sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b));
}
