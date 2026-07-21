/* ==========================================================================
   RNA One — FORMATAÇÃO NUMÉRICA · FONTE ÚNICA (§M07)
   Padrão brasileiro para todo valor MEDIDO exibido: vírgula decimal e duas
   casas — 10 → "10,00" · 5 → "5,00" · 1.5 → "1,50" · 25.347 → "25,35".

   Antes desta melhoria havia cinco cópias de `String(v).replace('.', ',')`
   espalhadas (inspecao.js, rotinas.js, biblioteca.js, consulta-dimensional.js,
   op-minhas-auditorias.js) — que só trocavam o separador e não padronizavam as
   casas decimais. Todas passam a delegar para cá.

   ONDE APLICAR: medições, valores nominais, tolerâncias, especificações,
   indicadores numéricos, cartões, relatórios, PDFs e impressões.

   ONDE **NÃO** APLICAR (§M07): datas, horários, IDs, OP, lote, revisão e
   códigos — são identificadores, não grandezas. Também ficam de fora as
   CONTAGENS inteiras (6 características, 12 medições) e percentuais (83%):
   "6,00 características" seria ruído, não padronização. A regra do requisito é
   "apenas medições e valores numéricos".

   Sem dependências: pode ser importado por qualquer camada.
   ========================================================================== */

/** Converte "10,25" | "10.25" | 10.25 → Number. Vazio/inválido → null. */
export function paraNumero(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return Number.isNaN(v) ? null : v;
  // remove separador de milhar pt-BR antes de trocar a vírgula decimal
  const s = String(v).trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isNaN(n) ? null : n;
}

/** Formata um valor MEDIDO no padrão pt-BR com casas fixas (padrão: 2).
    `agrupar` fica desligado por padrão: numa tabela de metrologia "1.520,00"
    se confunde com separador decimal — "1520,00" é o que a folha de medição usa.
    Valor não numérico é devolvido como texto (ex.: "Conforme desenho"). */
export function fmtNum(v, { casas = 2, agrupar = false, vazio = '—' } = {}) {
  if (v === '' || v == null) return vazio;
  const n = paraNumero(v);
  if (n == null) return String(v);                 // texto livre passa intacto
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: casas, maximumFractionDigits: casas, useGrouping: agrupar
  });
}

/** Igual a fmtNum, mas mantém texto livre e devolve `vazio` para nulo — é o
    formato usado nas tabelas de medição/especificação. Alias semântico. */
export const fmtMedida = (v, opts = {}) => fmtNum(v, opts);

/** Número com agrupamento de milhar, para dashboards e indicadores agregados
    (ex.: "1.250,00"). Use quando a grandeza é totalizada, não medida. */
export const fmtNumAgrupado = (v, opts = {}) => fmtNum(v, { agrupar: true, ...opts });

/** Contagem inteira — NÃO recebe casas decimais (§M07: não é medição). */
export function fmtInteiro(v, { vazio = '—' } = {}) {
  const n = paraNumero(v);
  if (n == null) return vazio;
  return Math.round(n).toLocaleString('pt-BR', { useGrouping: true });
}

/** Percentual: uma casa quando fracionário, nenhuma quando inteiro (83% / 83,5%). */
export function fmtPercent(v, { vazio = '—' } = {}) {
  const n = paraNumero(v);
  if (n == null) return vazio;
  const casas = Number.isInteger(n) ? 0 : 1;
  return `${n.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}
