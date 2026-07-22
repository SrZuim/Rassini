/* ==========================================================================
   RNA One — IDENTIFICADORES DA INSPEÇÃO · FONTE ÚNICA (§Erro 02 e §Erro 03)
   Lote e OP identificam o material auditado e alimentam buscas, filtros e
   relatórios. Sem padronização, "2026a99" e "2026A99" viram dois lotes
   diferentes e "26WWW" entra como Ordem de Produção.

   Estas funções são a ÚNICA regra de normalização/validação — a tela usa para
   filtrar a digitação, e a camada de persistência (services/inspecao.js) usa de
   novo antes de gravar. Nunca confiar só no CSS `text-transform: uppercase`:
   ele muda a aparência, não o valor salvo.
   ========================================================================== */

/** LOTE — maiúsculas, sem espaços nas pontas e sem espaços duplicados.
    Números e símbolos permitidos (hífen, barra, ponto) são preservados.
    "  2026a99 " → "2026A99" · "abc-001" → "ABC-001" */
export function normalizarIdentificadorMaiusculo(v) {
  return String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleUpperCase('pt-BR');
}

/** OP — somente dígitos. Tudo que não for 0-9 é descartado.
    Zeros à esquerda são PRESERVADOS: a OP é texto, nunca número
    ("000145" precisa continuar "000145"). */
export function normalizarOP(v) {
  return String(v ?? '').replace(/\D+/g, '');
}

/** Formato aceito no banco (mesma regra do CHECK da migration). */
export const OP_REGEX = /^[0-9]+$/;

/** true quando o texto informado já é uma OP válida (só dígitos, não vazia). */
export function opValida(v) {
  const s = String(v ?? '').trim();
  return s !== '' && OP_REGEX.test(s);
}

/** true quando o texto contém algo que será descartado na normalização da OP. */
export function opTemCaractereInvalido(v) {
  const s = String(v ?? '');
  return s !== '' && s !== normalizarOP(s);
}

export const MSG_OP_INVALIDA = 'A OP deve conter somente números.';

/** Normaliza o par lote/OP de uma vez (usado antes de INSERT/UPDATE). */
export function normalizarIdentificacao({ lote, op } = {}) {
  const out = {};
  if (lote !== undefined) out.lote = normalizarIdentificadorMaiusculo(lote);
  if (op !== undefined) out.op = normalizarOP(op);
  return out;
}
