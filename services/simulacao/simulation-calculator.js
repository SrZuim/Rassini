/* ==========================================================================
   RNA One — SimulationCalculator (Rel. Dimensionais de Produção)
   ÚNICA responsabilidade: GERAR um valor numérico (ou OK/NOK) plausível dentro
   dos limites de uma característica. Não conhece relatório, não conhece banco,
   não decide o que precisa ser simulado — só calcula.

   ---------------------------------------------------------------- PRECISÃO
   Toda a aritmética acontece em INTEIROS ESCALONADOS (valor × 10^casas),
   montados a partir do TEXTO do número (services/medicao.js → partesDecimais),
   nunca por multiplicação em ponto flutuante. É a mesma disciplina do motor de
   avaliação: 15,20 e 15,40 viram 1520 e 1540, e o valor gerado volta como
   texto "15,24" — sem 15,239999999999998.

   ------------------------------------------------------------- REPETIBILIDADE
   O gerador é PSEUDO-aleatório com SEMENTE derivada de (relatório, cota,
   amostra). Isso é deliberado:
     • valores diferentes em cada cota e em cada peça (sem padrão visível);
     • porém ESTÁVEIS — abrir o mesmo relatório simulado duas vezes, ou gerar o
       PDF depois de ver a tela, mostra exatamente os mesmos números. Um
       Math.random() puro faria o relatório "mudar sozinho" a cada F5 e o PDF
       divergir da tela.

   ------------------------------------------------------------- FAIXA SEGURA
   O valor é sorteado dentro da faixa central da tolerância, afastado dos
   extremos por MARGEM_SEGURA. O motivo é o motor oficial (medicao.js): um valor
   exatamente no limite — ou nos ALERTA_PCT finais — é APROVADO, mas aparece
   como "▲ Aprovado com atenção" (amarelo). Numa simulação cuja premissa é
   "tudo conforme", o amarelo seria ruído. Fora da faixa segura só quando a
   tolerância é estreita demais para comportá-la.
   ========================================================================== */
import * as MED from '../medicao.js';

/** Afastamento mínimo de cada extremo, em fração da amplitude. Fica acima de
    ALERTA_PCT para o valor cair no verde, não no amarelo de "atenção". */
export const MARGEM_SEGURA = MED.ALERTA_PCT + 0.05;

/* ============================================================ ALEATÓRIO ===== */
/** Hash FNV-1a 32 bits — transforma a semente textual num inteiro. */
export function hashSemente(texto) {
  let h = 0x811c9dc5;
  const s = String(texto ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Gerador mulberry32: rápido, sem dependência e com boa distribuição.
    Devolve uma função () => número em [0,1). */
export function geradorAleatorio(semente) {
  let a = (typeof semente === 'number' ? semente : hashSemente(semente)) >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ================================================= DECIMAL ↔ INTEIRO ======== */
/** Casas decimais a respeitar: a MAIOR precisão entre nominal, limites e o
    valor originalmente medido. Assim uma cota cadastrada em 15,20/15,40 gera
    duas casas, e uma cota de 3,350 continua com três. Teto de 6 por segurança. */
export function casasDaCaracteristica(car, valores = []) {
  const fontes = [car?.nominal, car?.minimo, car?.maximo, ...valores];
  return Math.min(6, fontes.reduce((max, v) => Math.max(max, MED.casasDecimais(v)), 0));
}

/** Valor decimal → inteiro escalonado (× 10^casas), montado por TEXTO.
    Devolve null quando o valor não é numérico. */
export function paraInteiroEscalado(v, casas) {
  const p = MED.partesDecimais(v);
  if (!p) return null;
  const f = p.f.length >= casas ? p.f.slice(0, casas) : p.f.padEnd(casas, '0');
  const n = Number(p.i + (casas ? f : ''));
  if (!Number.isSafeInteger(n)) return null;
  return p.neg ? -n : n;
}

/** Inteiro escalonado → texto pt-BR ("1524", 2 → "15,24"). */
export function deInteiroEscalado(n, casas) {
  const neg = n < 0;
  const s = String(Math.abs(Math.trunc(n))).padStart(casas + 1, '0');
  const corte = s.length - casas;
  const inteiro = s.slice(0, corte);
  const frac = casas ? s.slice(corte) : '';
  return (neg ? '-' : '') + inteiro + (casas ? ',' + frac : '');
}

/* ============================================================== GERAÇÃO ===== */
const resultado = (valor, ok, motivo = '') => ({ valor, ok, motivo });

/** Sorteia um inteiro em [lo, hi] com a função aleatória informada. */
const sortear = (rnd, lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

/** Afasta o candidato de valores "suspeitos de padrão" (o nominal, o centro
    exato da tolerância e os já usados na mesma cota), andando em passos de 1
    dentro da faixa permitida. Se a faixa não tiver folga, devolve o próprio
    candidato — respeitar o limite vale mais do que evitar a repetição. */
function afastarDePadroes(candidato, { lo, hi, proibidos, rnd }) {
  if (hi <= lo) return candidato;
  const veta = v => proibidos.some(p => p != null && p === v);
  if (!veta(candidato)) return candidato;
  const largura = hi - lo + 1;
  const sentido = rnd() < 0.5 ? -1 : 1;
  for (let passo = 1; passo < largura; passo++) {
    for (const dir of [sentido, -sentido]) {
      const alvo = candidato + dir * passo;
      if (alvo >= lo && alvo <= hi && !veta(alvo)) return alvo;
    }
  }
  return candidato;
}

/** Faixa de sorteio a partir dos dois limites: recuada de MARGEM_SEGURA em cada
    extremo; com tolerância estreita, relaxa gradualmente até a faixa cheia. */
function faixaSegura(minI, maxI) {
  const amplitude = maxI - minI;
  if (amplitude <= 0) return null;
  /* A margem precisa ULTRAPASSAR a faixa de alerta, não empatar com ela: em
     escala inteira (cota sem casas decimais, amplitude 10), floor(10×0,15)=1
     cairia exatamente no primeiro passo alertado e o valor sairia amarelo.
     Por isso o piso é "um passo além de ALERTA_PCT". */
  const margem = Math.max(Math.floor(amplitude * MARGEM_SEGURA), Math.floor(amplitude * MED.ALERTA_PCT) + 1);
  let lo = minI + margem, hi = maxI - margem;
  if (hi - lo < 2) { lo = minI + 1; hi = maxI - 1; }          // tolerância estreita
  if (hi < lo) { lo = minI; hi = maxI; }                       // limites inclusivos
  return { lo, hi };
}

/** Faixa quando só existe UM limite cadastrado. O afastamento é derivado do
    nominal (quando há) — que é a distância "natural" daquela cota — ou de um
    punhado de passos da própria precisão. */
function faixaLimiteUnico({ minI, maxI, nomI }) {
  if (minI != null) {
    if (nomI != null && nomI > minI) {
      const delta = nomI - minI;
      return { lo: minI + Math.max(1, Math.round(delta * 0.3)), hi: minI + delta * 2 };
    }
    return { lo: minI + 1, hi: minI + 10 };
  }
  if (nomI != null && nomI < maxI) {
    const delta = maxI - nomI;
    return { lo: maxI - delta * 2, hi: maxI - Math.max(1, Math.round(delta * 0.3)) };
  }
  return { lo: maxI - 10, hi: maxI - 1 };
}

/**
 * Gera um valor conforme para UMA medição.
 * @param {object}   car           característica (nominal, minimo, maximo, tipo_especificacao)
 * @param {object}   opts
 * @param {string}   opts.semente  chave estável (relatório · cota · amostra)
 * @param {any}      opts.valorOriginal valor reprovado (só para herdar a precisão)
 * @param {number[]} opts.usados   inteiros escalonados já gerados nesta cota
 * @returns {{valor:string|null, ok:boolean, motivo:string, escalonado:number|null, casas:number}}
 */
export function gerarValor(car, { semente, valorOriginal = null, usados = [] } = {}) {
  const rnd = geradorAleatorio(semente);

  /* Verificação (OK/NOK): não há faixa a sortear — conforme é literalmente OK. */
  if (car?.tipo_especificacao === 'ATRIBUTO' || MED.ehValorAtributo(valorOriginal)) {
    return { ...resultado('OK', true), escalonado: null, casas: 0 };
  }

  const casas = casasDaCaracteristica(car, [valorOriginal]);
  const minI = paraInteiroEscalado(car?.minimo, casas);
  const maxI = paraInteiroEscalado(car?.maximo, casas);
  const nomI = paraInteiroEscalado(car?.nominal, casas);

  if (minI == null && maxI == null) {
    /* Sem limites cadastrados nada reprova (medicao.js) — se chegou aqui, o
       cadastro é que está incompleto. Não inventa faixa: devolve o nominal
       quando existe e denuncia a impossibilidade quando nem ele existe. */
    return nomI != null
      ? { ...resultado(deInteiroEscalado(nomI, casas), true), escalonado: nomI, casas }
      : { ...resultado(null, false, 'Característica sem limites e sem valor nominal cadastrados.'), escalonado: null, casas };
  }

  let faixa;
  if (minI != null && maxI != null) {
    faixa = faixaSegura(minI, maxI);
    if (!faixa) {
      return { ...resultado(null, false, `Limites inconsistentes na Biblioteca Técnica (mínimo ${car?.minimo} maior ou igual ao máximo ${car?.maximo}).`), escalonado: null, casas };
    }
  } else {
    faixa = faixaLimiteUnico({ minI, maxI, nomI });
  }

  const centro = (minI != null && maxI != null) ? Math.round((minI + maxI) / 2) : null;
  let escolhido = sortear(rnd, faixa.lo, faixa.hi);
  /* "Não usar sempre o nominal nem o centro da tolerância" e "não gerar números
     iguais para todas as cotas": o nominal, o centro e os valores já sorteados
     nesta mesma característica são vetados. */
  escolhido = afastarDePadroes(escolhido, { lo: faixa.lo, hi: faixa.hi, proibidos: [nomI, centro, ...usados], rnd });

  return { ...resultado(deInteiroEscalado(escolhido, casas), true), escalonado: escolhido, casas };
}
