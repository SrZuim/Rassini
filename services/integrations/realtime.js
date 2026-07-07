/* ==========================================================================
   RNA One — Realtime (Supabase Channels)
   Assina mudanças de tabela para alimentar Gestão à Vista / Andon ao vivo.
   Uso: subscribe('nao_conformidades', (payload) => { ... })
   Em modo demo (sem Supabase) é um no-op silencioso.
   ========================================================================== */
import { getSupabase, SUPABASE } from '../supabaseClient.js';

const channels = {};

export async function subscribe(table, handler, { event = '*' } = {}) {
  if (!SUPABASE.enabled) return () => {};
  const sb = await getSupabase();
  const ch = sb.channel(`rt-${table}`)
    .on('postgres_changes', { event, schema: 'public', table }, payload => handler(payload))
    .subscribe();
  channels[table] = ch;
  return () => { sb.removeChannel(ch); delete channels[table]; };
}

export async function unsubscribeAll() {
  if (!SUPABASE.enabled) return;
  const sb = await getSupabase();
  Object.values(channels).forEach(ch => sb.removeChannel(ch));
}
