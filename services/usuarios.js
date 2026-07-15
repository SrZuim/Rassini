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
  /** Lista todos os usuários (mais recentes primeiro).
      Normaliza status/role para minúsculo para exibir pendentes mesmo que o
      banco tenha gravado em caixa diferente (requisitos #11/#12/#13). */
  async list() {
    const rows = await db.list('usuarios').catch(() => []);
    return rows
      .map(u => ({ ...u, status: String(u.status || 'aprovado').toLowerCase(), role: String(u.role || 'visitante').toLowerCase() }))
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
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
  /** Exclusão FÍSICA: remove dependências (via RPC) e apaga a linha em usuarios.
      A RPC fn_excluir_usuario faz DELETE real no servidor (limpa notificacoes/
      logs e anula vínculos operacionais antes). */
  async excluir(u, motivo) {
    try { await this._rpc('fn_excluir_usuario', { p_alvo: u.id, p_motivo: motivo || null }); }
    catch (e) {
      if (e.message !== '__DEMO__') throw e;
      // Fallback demo (localStorage): apaga vínculos e o usuário.
      try {
        const notifs = await db.list('notificacoes');
        for (const n of notifs.filter(n => n.destinatario === u.id)) await db.remove('notificacoes', n.id);
        const logs = await db.list('usuarios_logs');
        for (const l of logs.filter(l => l.afetado_id === u.id || l.executor_id === u.id)) await db.remove('usuarios_logs', l.id);
      } catch {}
      await db.remove('usuarios', u.id);
    }
  },

  /* ------------------------------------------ diagnóstico de e-mail (admin)
     Investiga um e-mail nos dois locais (auth.users + usuarios) e devolve a
     situação + ação recomendada. Requer as RPCs de fix_email_ja_cadastrado.sql. */
  async diagnosticoEmail(email) {
    return this._rpc('fn_diagnostico_email', { p_email: String(email || '').trim().toLowerCase() });
  },
  /** Recupera o perfil órfão (existe no Auth, ausente em usuarios). */
  async recuperarOrfao(email, { nome = null, planta = null, cargo = 'auditor' } = {}) {
    return this._rpc('fn_recuperar_perfil_orfao', {
      p_email: String(email || '').trim().toLowerCase(), p_nome: nome, p_planta: planta, p_cargo: cargo
    });
  },
  /** Alinha usuarios.auth_id ao auth.users.id correto (mesmo e-mail). */
  async corrigirVinculo(email) {
    return this._rpc('fn_corrigir_vinculo_email', { p_email: String(email || '').trim().toLowerCase() });
  },
  /** Redefine o status do perfil para 'pendente' (reabre a solicitação). */
  redefinirPendente(u) {
    return this._acao('fn_redefinir_pendente', { p_alvo: u.id }, u,
      { status: 'pendente', ativo: false }, 'alteracao_dados', 'Status redefinido para pendente');
  },

  /* ------------------------------------------------------------- internos */
  async _rpc(fn, args) {
    if (!SUPABASE.enabled) throw new Error('__DEMO__');
    const sb = await getSupabase();
    const { data, error } = await sb.rpc(fn, args);
    if (error) {
      // Log completo (message/details/hint/code) — nunca só o objeto (req #4/#8).
      console.error(`[USUARIOS] RPC ${fn} falhou:`, {
        message: error.message, details: error.details, hint: error.hint, code: error.code
      });
      const partes = [error.message, error.details, error.hint && `Dica: ${error.hint}`].filter(Boolean);
      throw new Error(partes.join(' · ') || (error.code ? `Erro ${error.code}` : 'Falha na operação.'));
    }
    return data ?? true;
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
