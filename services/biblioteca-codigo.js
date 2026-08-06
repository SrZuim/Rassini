/* ==========================================================================
   RNA One — Código da peça (Biblioteca Técnica): normalização e unicidade
   ---------------------------------------------------------------------------
   Módulo puro (sem acesso a banco e sem DOM) com a regra do identificador da
   peça. Existe separado porque a mesma decisão é tomada em três lugares —
   formulário, serviço e banco — e três implementações ligeiramente diferentes
   foram exatamente o que produziu o erro técnico
   "duplicate key value violates unique constraint bib_pecas_codigo_uidx"
   na cara do usuário durante uma EDIÇÃO normal.

   Contrato:
   • `normalizarCodigo` é a ÚNICA forma de gerar o valor que vai para a consulta,
     para o INSERT e para o UPDATE — consultar de um jeito e gravar de outro é o
     que faz a checagem prévia passar e o banco recusar em seguida.
   • O índice único do banco (`bib_pecas_codigo_uidx`, sobre `lower(codigo)`)
     continua valendo e é a autoridade final: a checagem prévia é conveniência
     (mensagem clara), NUNCA garantia — outro usuário pode gravar entre a
     consulta e o INSERT, e RLS pode esconder a linha conflitante. Por isso o
     erro 23505 também é traduzido, em vez de só evitado.
   ========================================================================== */

/** Mensagem única de código ausente. */
export const MSG_CODIGO_OBRIGATORIO = 'O código da peça é obrigatório.';

/** Mensagem única de código duplicado — a que o usuário pode ler e agir.
    Nenhuma variante técnica ("duplicate key", "unique constraint", nome do
    índice) pode chegar à tela: isso vai só para o console. */
export const MSG_CODIGO_DUPLICADO =
  'Já existe uma peça cadastrada com este código. Abra o cadastro existente para edição ou informe outro código.';

/* O que o copiar-e-colar de Excel/PDF traz junto e o olho não vê. São duas
   coisas DIFERENTES e o tratamento não pode ser o mesmo — trocar zero-width por
   espaço partiria "12345" em "123 45", criando o problema que se quer evitar.
   Escrito por PROPRIEDADE Unicode em vez de listar os caracteres: o literal
   seria invisível no fonte para quem for ler este arquivo. */
const ZERO_WIDTH = /\p{Cf}/gu;   // zero-width, BOM, marcas de formatação: SOMEM
const ESPACOS    = /\p{Zs}/gu;   // NBSP e espaços tipográficos: viram espaço comum

/** Forma canônica do código: sem invisíveis, sem espaços nas pontas, espaços
    internos colapsados e em CAIXA ALTA. */
export function normalizarCodigo(codigo) {
  return String(codigo ?? '')
    .replace(ZERO_WIDTH, '')
    .replace(ESPACOS, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/** null quando o código é utilizável; mensagem de erro quando não é.
    Vazio e "só espaços" caem no mesmo caso — depois de normalizar, são idênticos. */
export function validarCodigo(codigo) {
  return normalizarCodigo(codigo) ? null : MSG_CODIGO_OBRIGATORIO;
}

/** Dois códigos são o MESMO cadastro? (caixa/espaço/invisível não distinguem). */
export function codigosIguais(a, b) {
  const x = normalizarCodigo(a);
  return !!x && x === normalizarCodigo(b);
}

/** Primeira linha de `linhas` que ocupa o código, ignorando a própria peça
    (`exceto` = id em edição). Devolve a linha conflitante ou null.
    Puro de propósito: quem busca as linhas (Supabase ou demo) fica fora daqui. */
export function acharConflito(codigo, linhas = [], exceto = null) {
  const alvo = normalizarCodigo(codigo);
  if (!alvo) return null;
  return (linhas || []).find(l => l && l.id !== exceto && codigosIguais(l.codigo, alvo)) || null;
}

/** Erro de código duplicado já traduzido. `amigavel` avisa as camadas de cima
    que a mensagem está pronta e NÃO deve ser reembrulhada (mesma convenção de
    MidiaError/AnexoError). `duplicado` permite tratamento específico na tela. */
export class CodigoDuplicadoError extends Error {
  constructor(codigo, causa) {
    super(MSG_CODIGO_DUPLICADO);
    this.name = 'CodigoDuplicadoError';
    this.amigavel = true;
    this.duplicado = true;
    this.codigo = normalizarCodigo(codigo);
    this.causa = causa;
    // Detalhe técnico preservado para o console — nunca para a tela.
    this.tecnico = causa?.message || causa?.details || null;
  }
}

/** O erro do banco é violação da unicidade do CÓDIGO DA PEÇA?
    Restringe ao 23505 (unique_violation) cuja mensagem cita o índice/coluna do
    código — um 23505 de outra tabela não pode virar "código duplicado". */
export function ehErroCodigoDuplicado(e) {
  if (!e) return false;
  if (e.duplicado === true) return true;
  const texto = `${e.message || ''} ${e.details || ''} ${e.hint || ''} ${e.constraint || ''}`;
  const unico = String(e.code || '') === '23505' || /duplicate key value|unique constraint/i.test(texto);
  return unico && /bib_pecas_codigo|codigo_uidx|\bcodigo\b/i.test(texto);
}

/** Escapa curingas do LIKE/ILIKE para o código ser buscado literalmente. */
export function escaparLike(txt) {
  return String(txt ?? '').replace(/[\\%_]/g, c => `\\${c}`);
}
