/* ==========================================================================
   RNA One — [MÓDULO USUÁRIOS] Serviço de administração de usuários
   ---------------------------------------------------------------------------
   • Leitura via db.js (Supabase real ou demo/localStorage).
   • Ações administrativas via RPC SECURITY DEFINER (aprovar/recusar/bloquear/
     alterar cargo/excluir) — a regra e o log vivem no servidor (requisito #14).
   • Fallback DEMO: quando não há Supabase, replica a ação em localStorage e
     grava em usuarios_logs, para a tela funcionar offline.
   ========================================================================== */
import { SUPABASE } from './config.js';
import { getSupabase } from './supabaseClient.js';
import { db } from './db.js';

export const STATUS_META = {
  pendente:  { label:'Pendente',  badge:'badge-pend', icon:'bi-hourglass-split' },
  aprovado:  { label:'Aprovado',  badge:'badge-ok',   icon:'bi-check-circle' },
  recusado:  { label:'Recusado',  badge:'badge-crit', icon:'bi-x-circle' },
  bloqueado: { label:'Bloqueado', badge:'badge-warn', icon:'bi-lock' }
};

export const usuariosSvc = {
  /** Lista todos os usuários (mais recentes primeiro). */
  async list() {
    const rows = await db.list('usuarios').catch(() => []);
    return [...rows].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  },

  /** Trilha de auditoria (usuarios_logs). */
  async logs(afetadoId = null) {
    const rows = await db.list('usuarios_logs').catch(() => []);
    const filtered = afetadoId ? rows.filter(l => l.afetado_id === afetadoId) : rows;
    return [...filtered].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  },

  /** Indicadores para os cards do topo. */
  stats(rows) {
    const s = { total: rows.length, pendentes: 0, aprovados: 0, recusados: 0, bloqueados: 0,
                ativos: 0, admin: 0, supervisor: 0, auditor: 0, visitante: 0 };
    const map = { pendente:'pendentes', aprovado:'aprovados', recusado:'recusados', bloqueado:'bloqueados' };
    rows.forEach(u => {
      const k = map[u.status]; if (k) s[k]++;
      if (u.ativo) s.ativos++;
      if (s[u.role] != null) s[u.role]++;
    });
    return s;
  },

  /* -------------------------------------------------- ações administrativas */
  aprovar(u)            { return this._acao('fn_aprovar_usuario',  { p_alvo: u.id }, u, { status:'aprovado', ativo:true }, 'aprovacao', 'Acesso aprovado'); },
  recusar(u, motivo)    { return this._acao('fn_recusar_usuario',  { p_alvo: u.id, p_motivo: motivo || null }, u, { status:'recusado', ativo:false, recusado_motivo: motivo||null }, 'recusa', motivo || 'Acesso recusado'); },
  bloquear(u)           { return this._acao('fn_bloquear_usuario', { p_alvo: u.id, p_bloquear: true },  u, { status:'bloqueado', ativo:false }, 'bloqueio', 'Usuário bloqueado'); },
  desbloquear(u)        { return this._acao('fn_bloquear_usuario', { p_alvo: u.id, p_bloquear: false }, u, { status:'aprovado', ativo:true }, 'desbloqueio', 'Usuário desbloqueado'); },
  alterarCargo(u, role) { return this._acao('fn_alterar_cargo',    { p_alvo: u.id, p_role: role }, u, { role }, 'alteracao_dados', 'Cargo alterado para ' + role); },
  async excluir(u) {
    try { await this._rpc('fn_excluir_usuario', { p_alvo: u.id }); }
    catch (e) {
      if (e.message !== '__DEMO__') throw e;
      await db.remove('usuarios', u.id);
      await this._logDemo(u, 'exclusao', 'Usuário excluído');
    }
  },

  /* ------------------------------------------------------------- internos */
  async _rpc(fn, args) {
    if (!SUPABASE.enabled) throw new Error('__DEMO__');
    const sb = await getSupabase();
    const { error } = await sb.rpc(fn, args);
    if (error) throw new Error(error.message || 'Falha na operação.');
    return true;
  },

  /** Executa via RPC (produção) ou replica no demo (offline). */
  async _acao(fn, args, u, patch, acao, detalhe) {
    try { await this._rpc(fn, args); }
    catch (e) {
      if (e.message !== '__DEMO__') throw e;
      await db.update('usuarios', u.id, { ...patch, updated_at: new Date().toISOString() });
      await this._logDemo(u, acao, detalhe, patch);
    }
  },

  async _logDemo(u, acao, detalhe, depois = null) {
    try {
      await db.insert('usuarios_logs', {
        afetado_id: u.id, afetado_nome: u.nome, acao, detalhe,
        depois: depois ? JSON.stringify(depois) : null,
        created_at: new Date().toISOString()
      });
    } catch {}
  }
};
