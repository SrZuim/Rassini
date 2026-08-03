/* ==========================================================================
   RNA One — Cliente Supabase
   Carrega o SDK por ESM CDN somente quando há credenciais configuradas.
   ========================================================================== */
import { SUPABASE } from './config.js';

let _client = null;

export async function getSupabase() {
  if (!SUPABASE.enabled) return null;
  if (_client) return _client;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  _client = createClient(SUPABASE.url, SUPABASE.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true }
  });
  return _client;
}

export { SUPABASE };
