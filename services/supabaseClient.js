/* ==========================================================================
   RNA One — Cliente Supabase
   Carrega o SDK por ESM CDN somente quando há credenciais configuradas.
   ========================================================================== */
import { SUPABASE } from './config.js';

let _client = null;

/* Ambiente de desenvolvimento — localhost, IP local ou arquivo aberto direto.
   Só aqui os logs de diagnóstico são emitidos. */
export function ehDesenvolvimento() {
  if (typeof location === 'undefined') return false;
  return location.protocol === 'file:' ||
         /^(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0|.*\.local)$/i.test(location.hostname) ||
         /^(10|127|192\.168)\./.test(location.hostname);
}

/** Identificação do projeto Supabase em uso. NUNCA devolve chave alguma. */
export function projetoSupabase() {
  try {
    const host = new URL(SUPABASE.url).hostname;
    return { host, ref: host.split('.')[0] };
  } catch { return { host: null, ref: null }; }
}

export async function getSupabase() {
  if (!SUPABASE.enabled) return null;
  if (_client) return _client;
  /* Divergência de projeto entre o SQL Editor e o front é invisível até alguém
     comparar os refs — este log existe para tornar a comparação trivial. */
  if (ehDesenvolvimento()) console.info('[RNA] Supabase project:', projetoSupabase().host);
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  _client = createClient(SUPABASE.url, SUPABASE.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  return _client;
}

export { SUPABASE };
