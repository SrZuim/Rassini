/* ==========================================================================
   RNA One — DATA E HORA · FONTE ÚNICA (§Erro 06)
   Todo horário do sistema é GRAVADO em UTC (ISO 8601 com "Z" — ver nowISO) e
   EXIBIDO no fuso oficial da operação: America/Sao_Paulo.

   CAUSA RAIZ CORRIGIDA: as telas liam o texto do ISO por posição
   (`iso.slice(11,16)`), o que mostra a HORA UTC — três horas à frente do
   horário real de São Paulo. Nenhum ajuste manual de "-3h" é feito aqui: a
   conversão é delegada ao Intl, que já trata horário de verão e mudanças de
   regra de fuso. Converter duas vezes é justamente o erro que este módulo evita.

   REGRA DE USO:
     • timestamp (data + hora) → formatarDataHoraBrasil / formatarHoraBrasil
     • data pura "AAAA-MM-DD"  → formatarDataBrasil (NÃO converte fuso: uma data
       civil sem hora não tem fuso; convertê-la voltaria um dia)
   ========================================================================== */

export const FUSO_BR = 'America/Sao_Paulo';
const LOCALE = 'pt-BR';

/* "2026-07-21" (data civil, sem hora) — formatada literalmente. */
const SO_DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Date válido a partir de ISO/Date/epoch; null quando não dá para interpretar. */
export function paraData(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') { const d = new Date(v); return isNaN(d) ? null : d; }
  const s = String(v).trim();
  if (!s) return null;
  /* Timestamp sem fuso explícito ("2026-07-21 15:30:00") é interpretado pelo
     navegador como hora LOCAL — que é o que o Postgres devolveria se a coluna
     fosse `timestamp` em vez de `timestamptz`. Mantemos esse comportamento
     (não inventamos um fuso), apenas normalizamos o espaço para "T". */
  const d = new Date(s.includes(' ') && !s.includes('T') ? s.replace(' ', 'T') : s);
  return isNaN(d) ? null : d;
}

function partes(v) {
  const d = paraData(v);
  if (!d) return null;
  const fmt = new Intl.DateTimeFormat(LOCALE, {
    timeZone: FUSO_BR, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const p = {};
  for (const { type, value } of fmt.formatToParts(d)) p[type] = value;
  if (p.hour === '24') p.hour = '00';
  return p;
}

/** "21/07/2026". Data civil pura é formatada sem conversão de fuso. */
export function formatarDataBrasil(v, { vazio = '—' } = {}) {
  if (v == null || v === '') return vazio;
  const s = String(v).trim();
  if (SO_DATA.test(s)) return s.split('-').reverse().join('/');
  const p = partes(v);
  return p ? `${p.day}/${p.month}/${p.year}` : vazio;
}

/** "15:30" (ou "15:30:42" com segundos: true). */
export function formatarHoraBrasil(v, { vazio = '—', segundos = false } = {}) {
  const p = partes(v);
  if (!p) return vazio;
  return segundos ? `${p.hour}:${p.minute}:${p.second}` : `${p.hour}:${p.minute}`;
}

/** "21/07/2026 15:30" — formato oficial do relatório (§Erro 06). */
export function formatarDataHoraBrasil(v, { vazio = '—', segundos = false } = {}) {
  const s = String(v ?? '').trim();
  if (SO_DATA.test(s)) return formatarDataBrasil(s, { vazio });   // sem hora para inventar
  const p = partes(v);
  if (!p) return vazio;
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}${segundos ? ':' + p.second : ''}`;
}

/** Data "AAAA-MM-DD" do dia corrente EM SÃO PAULO (não em UTC).
    Usar `new Date().toISOString().slice(0,10)` erra o dia após as 21h. */
export function hojeBR(base = new Date()) {
  const p = partes(base);
  return p ? `${p.year}-${p.month}-${p.day}` : '';
}

/** Instante atual em ISO UTC — formato de gravação (timestamptz). */
export function agoraISO() { return new Date().toISOString(); }

/** Diferença em segundos entre dois instantes (nunca negativa).
    Trabalha sobre os timestamps absolutos: fuso não altera a duração. */
export function duracaoSegundos(inicio, fim = new Date()) {
  const a = paraData(inicio), b = paraData(fim);
  if (!a || !b) return null;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));
}
