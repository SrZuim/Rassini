/* ==========================================================================
   RNA One — MOTOR DE AVALIAÇÃO DA MEDIÇÃO · FONTE ÚNICA (§Erro 01 / §Erro 07)
   Regra única de aprovação/reprovação de uma medição dimensional ou de atributo.
   Todo consumidor (tela de medições, revisão, resultado, relatório, PDF,
   pendência, monitoramento) deve derivar o status daqui — nunca reimplementar.

   ---------------------------------------------------------------- LIMITES
   Os limites são INCLUSIVOS (§Erro 01):
       aprovado  ⇔  valor >= minimo  E  valor <= maximo
       reprovado ⇔  valor <  minimo  OU valor >  maximo
   Um valor exatamente igual ao limite é APROVADO — com sinalização visual de
   atenção (amarelo), que NÃO é reprovação.

   ------------------------------------------------------------- PRECISÃO
   A comparação NÃO usa aritmética de ponto flutuante: os dois lados são
   convertidos para inteiros escalonados (BigInt) na maior quantidade de casas
   decimais entre eles. Assim 3,350 vs 3,350 é igualdade exata e 3,351 > 3,350
   por 0,001 — sem o erro clássico de 0.1 + 0.2 !== 0.3 do JavaScript.
   Nada é arredondado antes de comparar.

   ----------------------------------------------------- FAIXA DE ATENÇÃO
   ALERTA_PCT concentra num único lugar a definição de "próximo do limite".
   Amplitude = máximo − mínimo · faixa de alerta = amplitude × ALERTA_PCT,
   medida a partir de cada extremo. Só existe quando há os dois limites; com
   um limite só, apenas o valor exatamente no limite fica amarelo.
   ========================================================================== */

/** Percentual da amplitude de tolerância considerado "próximo do limite".
    Ponto ÚNICO de configuração (§Erro 01 — "não espalhar a porcentagem"). */
export const ALERTA_PCT = 0.10;

/* Status técnico persistido (compatível com as bases já existentes). */
export const STATUS = {
  APROVADO: 'aprovado',
  REPROVADO: 'reprovado',
  REGISTRADO: 'registrado',   // referência: medida, sem limites
  PENDENTE: 'pendente'
};

/* Estado VISUAL derivado — nunca persistido, sempre recalculado.
   'ok' verde · 'atencao' amarelo · 'crit' vermelho · 'ref' azul · '' neutro. */
export const VISUAL = { OK: 'ok', ATENCAO: 'atencao', CRIT: 'crit', REF: 'ref', NEUTRO: '' };

export const VISUAL_LABEL = {
  ok: 'Aprovado',
  atencao: 'Aprovado com atenção',
  crit: 'Reprovado',
  ref: 'Registrado — Referência',
  '': 'Aguardando medição'
};

/* ====================================================== DECIMAL SEM FLOAT */
/** Quebra um valor em { neg, i, f } (partes inteira e fracionária, texto).
    Aceita "10,25", "10.25", 10.25 e milhar pt-BR ("1.520,00"). Retorna null
    quando não é um número — inclusive para OK/NOK e texto livre. */
export function partesDecimais(v) {
  if (v === '' || v == null) return null;
  let s = String(v).trim().replace(/\s/g, '');
  if (!s) return null;
  /* O ponto só é separador de milhar quando existe uma vírgula decimal na mesma
     string ("1.520,00"). Sozinho, ele É o separador decimal ("3.350" = 3,350) —
     tratá-lo como milhar transformaria 3,350 em 3350. */
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const neg = s.startsWith('-');
  s = s.replace(/^[+-]/, '');
  const [ip = '0', fp = ''] = s.split('.');
  return { neg, i: (ip.replace(/^0+(?=\d)/, '') || '0'), f: fp };
}

/** true quando o valor é numérico (na precisão informada, sem converter). */
export function ehNumerico(v) { return partesDecimais(v) != null; }

/** Casas decimais realmente informadas no valor (0 quando não numérico). */
export function casasDecimais(v) { return partesDecimais(v)?.f.length || 0; }

/** Compara dois decimais SEM ponto flutuante. -1 | 0 | 1; null se algum lado
    não for numérico. Escala os dois para a maior precisão entre eles. */
export function compararDecimal(a, b) {
  const A = partesDecimais(a), B = partesDecimais(b);
  if (!A || !B) return null;
  const casas = Math.max(A.f.length, B.f.length);
  const inteiro = d => BigInt((d.neg ? '-' : '') + d.i + d.f.padEnd(casas, '0'));
  const x = inteiro(A), y = inteiro(B);
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Número em ponto flutuante — SOMENTE para cálculos auxiliares (amplitude da
    faixa de atenção). Jamais para decidir aprovado/reprovado. */
export function paraNumeroSeguro(v) {
  const p = partesDecimais(v);
  if (!p) return null;
  return Number(`${p.neg ? '-' : ''}${p.i}.${p.f || '0'}`);
}

/* =========================================================== ATRIBUTO OK/NOK */
const OK_TOKENS = ['OK', 'O.K.', 'CONFORME', 'APROVADO'];
const NOK_TOKENS = ['NOK', 'NOK.', 'N.O.K.', 'NÃO OK', 'NAO OK', 'NÃO CONFORME', 'NAO CONFORME', 'REPROVADO'];

/** Reconhece um valor de atributo, venha de onde vier. É o que garante que uma
    característica visual preenchida com OK/NOK apareça como Aprovado/Reprovado
    mesmo em cadastros antigos que não marcaram o tipo como ATRIBUTO (§Erro 07). */
export function ehValorAtributo(valor) {
  const s = String(valor ?? '').trim().toUpperCase();
  return OK_TOKENS.includes(s) || NOK_TOKENS.includes(s);
}

/** OK → aprovado · NOK → reprovado · vazio/desconhecido → pendente. */
export function avaliarAtributo(valor) {
  const s = String(valor ?? '').trim().toUpperCase();
  if (OK_TOKENS.includes(s)) return STATUS.APROVADO;
  if (NOK_TOKENS.includes(s)) return STATUS.REPROVADO;
  return STATUS.PENDENTE;
}

/** Referência: preenchida → 'registrado' (neutro); vazia → 'pendente'. */
export function avaliarReferencia(valor) {
  return String(valor ?? '').trim() === '' ? STATUS.PENDENTE : STATUS.REGISTRADO;
}

/* ============================================================== AVALIAÇÃO */
/** Avalia uma medição e devolve { status, visual, label, motivo }.
    `tipo`: 'ATRIBUTO' | 'REFERENCIA' | qualquer outro (numérico com limites).
    Não lança e não arredonda. */
export function avaliarMedicaoDetalhe(valor, minimo, maximo, tipo) {
  const vazio = String(valor ?? '').trim() === '';

  if (tipo === 'REFERENCIA') {
    return vazio
      ? det(STATUS.PENDENTE, VISUAL.NEUTRO, 'Aguardando medição')
      : det(STATUS.REGISTRADO, VISUAL.REF, 'Registrado — Referência');
  }
  if (tipo === 'ATRIBUTO' || ehValorAtributo(valor)) {
    const st = avaliarAtributo(valor);
    return st === STATUS.APROVADO ? det(st, VISUAL.OK, 'Aprovado')
      : st === STATUS.REPROVADO ? det(st, VISUAL.CRIT, 'Reprovado')
      : det(STATUS.PENDENTE, VISUAL.NEUTRO, 'Aguardando medição');
  }
  if (vazio) return det(STATUS.PENDENTE, VISUAL.NEUTRO, 'Aguardando medição');
  if (!ehNumerico(valor)) {
    return det(STATUS.PENDENTE, VISUAL.NEUTRO, 'Valor inválido',
      'O valor medido precisa ser um número (ex.: 3,350).');
  }

  const temMin = ehNumerico(minimo), temMax = ehNumerico(maximo);
  // sem limites cadastrados não há o que reprovar — a medição fica registrada
  if (!temMin && !temMax) return det(STATUS.APROVADO, VISUAL.OK, 'Aprovado');

  // limites INCLUSIVOS: só reprova abaixo do mínimo ou acima do máximo
  if (temMin && compararDecimal(valor, minimo) < 0)
    return det(STATUS.REPROVADO, VISUAL.CRIT, 'Reprovado', 'Abaixo do limite mínimo.');
  if (temMax && compararDecimal(valor, maximo) > 0)
    return det(STATUS.REPROVADO, VISUAL.CRIT, 'Reprovado', 'Acima do limite máximo.');

  // exatamente no limite → aprovado, com atenção
  if ((temMin && compararDecimal(valor, minimo) === 0) || (temMax && compararDecimal(valor, maximo) === 0))
    return det(STATUS.APROVADO, VISUAL.ATENCAO, 'Aprovado com atenção', 'Valor exatamente no limite.');

  // dentro da faixa de proximidade configurável (só com os dois limites)
  if (temMin && temMax && naFaixaDeAlerta(valor, minimo, maximo))
    return det(STATUS.APROVADO, VISUAL.ATENCAO, 'Aprovado com atenção', 'Valor próximo do limite.');

  return det(STATUS.APROVADO, VISUAL.OK, 'Aprovado');
}

function det(status, visual, label, motivo = '') { return { status, visual, label, motivo }; }

/** true quando o valor está nos ALERTA_PCT finais da faixa, junto de um extremo. */
export function naFaixaDeAlerta(valor, minimo, maximo) {
  const v = paraNumeroSeguro(valor), mn = paraNumeroSeguro(minimo), mx = paraNumeroSeguro(maximo);
  if (v == null || mn == null || mx == null) return false;
  const amplitude = mx - mn;
  if (!(amplitude > 0)) return false;
  const faixa = amplitude * ALERTA_PCT;
  return (v - mn) <= faixa || (mx - v) <= faixa;
}

/** Status técnico da medição — assinatura histórica, mantida por compatibilidade. */
export function avaliarMedicao(valor, minimo, maximo, tipo) {
  return avaliarMedicaoDetalhe(valor, minimo, maximo, tipo).status;
}

/** Estado visual da medição ('ok' | 'atencao' | 'crit' | 'ref' | ''). */
export function visualMedicao(valor, minimo, maximo, tipo) {
  return avaliarMedicaoDetalhe(valor, minimo, maximo, tipo).visual;
}

/* ============================================== AGREGAÇÃO POR CARACTERÍSTICA */
/** Visual da LINHA a partir dos visuais das medições: um vermelho reprova a
    linha; um amarelo (sem vermelho) sinaliza atenção. */
export function visualCaracteristica(visuais = []) {
  if (visuais.includes(VISUAL.CRIT)) return VISUAL.CRIT;
  if (visuais.includes(VISUAL.ATENCAO)) return VISUAL.ATENCAO;
  if (visuais.includes(VISUAL.OK)) return VISUAL.OK;
  if (visuais.includes(VISUAL.REF)) return VISUAL.REF;
  return VISUAL.NEUTRO;
}
