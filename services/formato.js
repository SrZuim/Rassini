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

   Depende apenas de services/medicao.js (leitura decimal sem ponto flutuante):
   pode ser importado por qualquer camada.
   ========================================================================== */
import { paraNumeroSeguro, casasDecimais } from './medicao.js';

/** Converte "10,25" | "10.25" | 10.25 → Number. Vazio/inválido → null.
    A interpretação do separador é delegada a services/medicao.js (fonte única):
    o ponto só é milhar quando existe vírgula decimal na mesma string. Antes,
    "3.350" (três vírgula trezentos e cinquenta) virava 3350 — o ponto era
    tratado como separador de milhar e a medição aparecia com 1000× o valor. */
export function paraNumero(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') return Number.isNaN(v) ? null : v;
  return paraNumeroSeguro(v);
}

/** Formata um valor MEDIDO no padrão pt-BR com no MÍNIMO `casas` decimais
    (padrão: 2 — §M07 "00,00") e sem NUNCA esconder a precisão informada:
    3,350 continua "3,350" e 3,351 continua "3,351" — arredondar para duas casas
    faria dois valores diferentes aparecerem iguais no relatório (§Erro 01).
    `agrupar` fica desligado por padrão: numa tabela de metrologia "1.520,00"
    se confunde com separador decimal — "1520,00" é o que a folha de medição usa.
    Valor não numérico é devolvido como texto (ex.: "OK", "Conforme desenho"). */
export function fmtNum(v, { casas = 2, agrupar = false, vazio = '—', maxCasas } = {}) {
  if (v === '' || v == null) return vazio;
  const n = paraNumero(v);
  if (n == null) return String(v);                 // texto livre passa intacto
  /* As casas exibidas são o MAIOR entre o padrão (00,00) e as casas realmente
     informadas — mínimo e máximo iguais, para o zero à direita não sumir:
     3,350 continua "3,350" e não vira "3,35". Teto de 6 casas por segurança. */
  const reais = Math.min(casasDecimais(v), 6);
  const usar = maxCasas != null ? Math.max(casas, maxCasas) : Math.max(casas, reais);
  return n.toLocaleString('pt-BR', {
    minimumFractionDigits: usar, maximumFractionDigits: usar, useGrouping: agrupar
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
