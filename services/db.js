/* ==========================================================================
   RNA One — Camada de dados
   Abstrai o acesso: MODO DEMO (localStorage + semente) ou Supabase real.
   API: db.list(tabela), db.get(tabela,id), db.insert, db.update, db.remove
   ========================================================================== */
import { SUPABASE } from './config.js';
import { getSupabase } from './supabaseClient.js';
import { SEED } from './seed.js';
import { CATALOGOS } from './auditoria-data.js';
import { FUNCIONARIOS_DEFAULT } from './funcionarios.js';
import { BIBLIOTECA } from './biblioteca-data.js';
import { GESTAO_OP } from './gestao-op-data.js';
import { INSPECAO } from './inspecao-data.js';

const LS_KEY = 'rna_demo_db_v2';

/* Base do banco demo = dados gerais (seed) + catálogos editáveis + cadastro de
   funcionários + tabelas de execução do fluxo do auditor (inicialmente vazias). */
function baseSeed() {
  return {
    ...structuredClone(SEED),
    ...structuredClone(CATALOGOS),
    ...structuredClone(BIBLIOTECA),
    ...structuredClone(GESTAO_OP),
    ...structuredClone(INSPECAO),
    funcionarios: structuredClone(FUNCIONARIOS_DEFAULT),
    rotina_exec: [],
    checklist_exec: [],
    auditorias_peca: []
  };
}

function loadLocal() {
  let raw = localStorage.getItem(LS_KEY);
  if (!raw) {
    const base = baseSeed();
    localStorage.setItem(LS_KEY, JSON.stringify(base));
    return base;
  }
  try {
    const data = JSON.parse(raw);
    // garante que tabelas novas existam mesmo em bases antigas
    const base = baseSeed();
    let changed = false;
    for (const k of Object.keys(base)) {
      if (!(k in data)) { data[k] = base[k]; changed = true; }
    }
    if (changed) localStorage.setItem(LS_KEY, JSON.stringify(data));
    return data;
  } catch { return baseSeed(); }
}
function saveLocal(data) { localStorage.setItem(LS_KEY, JSON.stringify(data)); }
function uid() { return 'x' + Math.random().toString(36).slice(2, 9); }

export const db = {
  mode: SUPABASE.enabled ? 'supabase' : 'demo',

  resetDemo() { localStorage.removeItem(LS_KEY); },

  async list(table, { filter } = {}) {
    if (SUPABASE.enabled) {
      const sb = await getSupabase();
      let q = sb.from(table).select('*');
      if (filter) Object.entries(filter).forEach(([k, v]) => { q = q.eq(k, v); });
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    }
    const local = loadLocal();
    let rows = local[table] || [];
    if (filter) rows = rows.filter(r => Object.entries(filter).every(([k, v]) => r[k] === v));
    return structuredClone(rows);
  },

  /* Leitura de UM registro. Em Supabase vai direto pelo id (`.eq`), em vez de
     baixar a tabela inteira e filtrar no navegador — este método está no caminho
     quente de salvar peça, abrir ficha e reabrir relatório, e o scan completo era
     a maior parte do tempo de salvamento na Biblioteca. */
  async get(table, id) {
    if (!id) return null;
    if (SUPABASE.enabled) {
      const sb = await getSupabase();
      const { data, error } = await sb.from(table).select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data || null;
    }
    const rows = await this.list(table);
    return rows.find(r => r.id === id) || null;
  },

  /* `returning:false` grava sem o SELECT do retorno. Necessário em tabelas cuja
     policy de leitura é mais restrita que a de escrita (ex.: `logs`, legível só
     por admin/supervisor): sem isso o PostgREST devolveria 0 linhas no RETURNING
     e a gravação bem-sucedida pareceria erro. */
  async insert(table, row, { returning = true } = {}) {
    if (SUPABASE.enabled) {
      const sb = await getSupabase();
      if (!returning) {
        const { error } = await sb.from(table).insert(row);
        if (error) throw error;
        return null;
      }
      const { data, error } = await sb.from(table).insert(row).select().single();
      if (error) throw error;
      return data;
    }
    const local = loadLocal();
    local[table] = local[table] || [];
    const rec = { id: uid(), ...row };
    local[table].unshift(rec);
    saveLocal(local);
    return structuredClone(rec);
  },

  async update(table, id, patch) {
    if (SUPABASE.enabled) {
      const sb = await getSupabase();
      const { data, error } = await sb.from(table).update(patch).eq('id', id).select().single();
      if (error) throw error;
      return data;
    }
    const local = loadLocal();
    const i = (local[table] || []).findIndex(r => r.id === id);
    if (i >= 0) { local[table][i] = { ...local[table][i], ...patch }; saveLocal(local); return structuredClone(local[table][i]); }
    return null;
  },

  async remove(table, id) {
    if (SUPABASE.enabled) {
      const sb = await getSupabase();
      const { error } = await sb.from(table).delete().eq('id', id);
      if (error) throw error;
      return true;
    }
    const local = loadLocal();
    local[table] = (local[table] || []).filter(r => r.id !== id);
    saveLocal(local);
    return true;
  },

  /* Registro de auditoria (logs antes/depois).
     A trilha de auditoria NUNCA pode derrubar a transação de negócio que a
     originou: finalizar uma rotina/inspeção precisa concluir mesmo que a
     gravação do log falhe (RLS, sessão expirada, migration pendente). A falha é
     reportada no console com a causa real e devolvida em `{ ok, erro }` para
     quem quiser tratar — nunca lançada. Ver database/fix_logs_rls.sql. */
  async log(entry) {
    const dispositivo = `${navigator.platform || 'Web'} · ${location.hostname}`;
    try {
      await this.insert('logs', {
        quando: new Date().toISOString().slice(0, 16).replace('T', ' '),
        dispositivo, ...entry
      }, { returning: false });     // logs_read é restrito: não pede o RETURNING
      return { ok: true };
    } catch (e) {
      const rls = e?.code === '42501' || /row-level security|violates row-level/i.test(String(e?.message || ''));
      console.warn('[LOG] Registro de auditoria não gravado', {
        acao: entry?.acao, message: e?.message, code: e?.code, details: e?.details, hint: e?.hint,
        causa: rls ? 'RLS: falta a policy de INSERT em "logs" — rode database/fix_logs_rls.sql no Supabase.' : undefined
      });
      return { ok: false, erro: e };
    }
  }
};
