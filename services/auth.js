/* ==========================================================================
   RNA One — Autenticação e Sessão (login local)
   ---------------------------------------------------------------------------
   • Credenciais e perfis: services/users.json  ← EDITE OS USUÁRIOS LÁ
   • Sessão em localStorage/sessionStorage, com expiração de 8 horas
   • Logs de acesso (login/logout/falha) em localStorage ('rna_acessos')
   • Pronto para migrar para Supabase Auth (basta configurar services/config.js)
   ========================================================================== */
import { SUPABASE } from './config.js';
import { getSupabase } from './supabaseClient.js';

const SESSION_KEY = 'rna_session';
const ACESSOS_KEY = 'rna_acessos';
const SESSAO_HORAS = 8;                       // expiração automática da sessão

/* Logs temporários de depuração do fluxo de autenticação.
   Deixe true enquanto investiga o perfil; troque para false em produção. */
const AUTH_DEBUG = true;
const dbg = (...a) => { if (AUTH_DEBUG) console.log('%c[RNA-AUTH]', 'color:#e0a500;font-weight:bold', ...a); };

/* Mapeia o "perfil" do users.json para o papel interno usado no RBAC */
const PERFIL_PARA_ROLE = {
  administrador: 'admin', admin: 'admin',
  supervisor: 'supervisor', auditor: 'auditor', visitante: 'visitante'
};

/* Fallback embutido (caso o fetch de users.json falhe, ex.: file://).
   Mantenha sincronizado com services/users.json. */
const USERS_FALLBACK = [
  { id:'uADM', nome:'Administrador', email:'admin@rassini.com',      senha:'admin123',      perfil:'administrador', status:'ativo', matricula:'RNA-ADM', area:'Qualidade', planta:'Planta São Bernardo' },
  { id:'uSUP', nome:'Supervisor',    email:'supervisor@rassini.com', senha:'supervisor123', perfil:'supervisor',    status:'ativo', matricula:'RNA-SUP', area:'Qualidade', planta:'Planta São Bernardo' },
  { id:'uAUD', nome:'Auditor',       email:'auditor@rassini.com',    senha:'auditor123',    perfil:'auditor',       status:'ativo', matricula:'RNA-AUD', area:'Montagem',  planta:'Planta São Bernardo' },
  { id:'uVIS', nome:'Visitante',     email:'visitante@rassini.com',  senha:'visitante123',  perfil:'visitante',     status:'ativo', matricula:'—',       area:'—',         planta:'Planta São Bernardo' },
  { id:'u1',   nome:'Jorge Lucas',   email:'jorgelucaszuim@gmail.com', senha:'rna2026',     perfil:'administrador', status:'ativo', matricula:'RNA-0001', area:'Qualidade', planta:'Planta São Bernardo' }
];

let _usersCache = null;
async function loadUsers() {
  if (_usersCache) return _usersCache;
  try {
    const res = await fetch('services/users.json', { cache: 'no-store' });
    const json = await res.json();
    _usersCache = json.usuarios || json;          // aceita {usuarios:[...]} ou [...]
  } catch {
    _usersCache = USERS_FALLBACK;                  // offline / file://
  }
  return _usersCache;
}

export const auth = {
  /** Página de destino após login, conforme o perfil. */
  homeFor(role) {
    return ({
      admin: 'index.html',          // painel principal completo
      supervisor: 'dashboard.html', // consulta / dashboards
      auditor: 'checkin.html',      // início de plantão
      visitante: 'home.html'        // tela institucional
    })[role] || 'index.html';
  },

  /** Sessão atual (ou null). Verifica expiração. */
  current() {
    let s;
    try { s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || 'null'); }
    catch { return null; }
    if (!s) return null;
    if (s.expiresAt && Date.now() > s.expiresAt) { this._clear(); return null; }
    return s;
  },

  /** Login local: valida e-mail + senha + status no users.json. */
  async login(email, password, { remember = true } = {}) {
    email = String(email || '').trim().toLowerCase();

    if (SUPABASE.enabled) {
      const sb = await getSupabase();
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) { this._logAcesso({ email, evento: 'falha' }); throw new Error('E-mail ou senha inválidos.'); }

      const authUser = data.user;
      dbg('1) Usuário autenticado pelo Auth:', { id: authUser?.id, email: authUser?.email });

      // Carrega o perfil real na tabela "usuarios" (por e-mail e, se preciso, por auth_id).
      const { prof, diag } = await this._carregarPerfil(sb, authUser);
      dbg('2) Resultado da consulta em usuarios:', prof, '| diagnóstico:', diag);

      // Só rebaixa para "visitante" se realmente NÃO existir cadastro (consulta OK e vazia).
      // Se a consulta falhou (RLS/rede), preserva um perfil mínimo e sinaliza o problema — nunca "visitante" silencioso.
      let role;
      if (prof) {
        role = PERFIL_PARA_ROLE[prof.role] || prof.role || 'visitante';
      } else if (diag.encontrado === false) {
        role = 'visitante';                       // usuário autenticado sem registro em "usuarios"
        console.warn('[RNA-AUTH] Nenhum registro em "usuarios" para', email, '→ perfil visitante.');
      } else {
        // Consulta com erro (ex.: RLS bloqueando SELECT). Não sabemos o papel: NÃO forçar visitante.
        role = null;
        console.error('[RNA-AUTH] Falha ao ler "usuarios" (verifique RLS/policies):', diag.erro);
      }

      const sessao = this._abrirSessao({
        ...(prof || {}),
        id: prof?.id || authUser.id,
        auth_id: authUser.id,
        nome: prof?.nome || authUser.user_metadata?.nome || authUser.user_metadata?.full_name || email.split('@')[0],
        email: prof?.email || email,
        matricula: prof?.matricula ?? null,
        area: prof?.area ?? null,
        role
      }, remember);

      dbg('3) Dados gravados na sessão/localStorage:', sessao);
      dbg('5) Role final utilizada pelo sistema:', sessao.role);
      if (!prof) dbg('8) DIVERGÊNCIA: Auth OK, mas perfil em "usuarios" não foi carregado. Origem:', diag);
      return sessao;
    }

    const users = await loadUsers();
    const u = users.find(x => String(x.email).toLowerCase() === email);
    if (!u)               { this._logAcesso({ email, evento: 'falha', motivo: 'inexistente' }); throw new Error('E-mail não cadastrado.'); }
    if (u.status !== 'ativo') { this._logAcesso({ email, evento: 'falha', motivo: 'inativo' }); throw new Error('Usuário inativo. Contate o administrador.'); }
    if (String(u.senha) !== String(password)) { this._logAcesso({ email, evento: 'falha', motivo: 'senha' }); throw new Error('Senha incorreta.'); }

    const role = PERFIL_PARA_ROLE[u.perfil] || u.perfil;
    const { senha, perfil, ...rest } = u;       // nunca guardar a senha na sessão
    return this._abrirSessao({ ...rest, perfil, role }, remember);
  },

  /**
   * Busca o registro do usuário na tabela "usuarios".
   * Estratégia: 1) por e-mail (case-insensitive) → 2) por auth_id → 3) por id = uuid do Auth.
   * Retorna { prof, diag } onde diag informa exatamente onde/como a busca terminou.
   */
  async _carregarPerfil(sb, authUser) {
    const email = String(authUser?.email || '').trim();

    // 1) Por e-mail (ilike = ignora maiúsc/minúsc; evita divergência de caixa no banco).
    let r = await sb.from('usuarios').select('*').ilike('email', email).limit(1);
    if (r.error) return { prof: null, diag: { etapa: 'email', encontrado: null, erro: r.error.message } };
    if (r.data?.length) return { prof: r.data[0], diag: { etapa: 'email', encontrado: true } };

    // 2) Por auth_id (quando o registro foi vinculado ao UID do Supabase Auth).
    if (authUser?.id) {
      r = await sb.from('usuarios').select('*').eq('auth_id', authUser.id).limit(1);
      if (!r.error && r.data?.length) return { prof: r.data[0], diag: { etapa: 'auth_id', encontrado: true } };

      // 3) Por id = uuid do Auth (caso a PK da tabela seja o próprio UID).
      const r3 = await sb.from('usuarios').select('*').eq('id', authUser.id).limit(1);
      if (!r3.error && r3.data?.length) return { prof: r3.data[0], diag: { etapa: 'id', encontrado: true } };
      if (r.error && r3.error) return { prof: null, diag: { etapa: 'auth_id', encontrado: null, erro: r.error.message } };
    }

    // Consulta executou sem erro, mas não há linha correspondente → usuário realmente não cadastrado.
    return { prof: null, diag: { etapa: 'nenhuma', encontrado: false } };
  },

  /** Acesso rápido de demonstração — entra com as credenciais do users.json. */
  async loginAs(role) {
    const users = await loadUsers();
    const u = users.find(x => (PERFIL_PARA_ROLE[x.perfil] || x.perfil) === role && x.status === 'ativo');
    if (!u) throw new Error('Perfil de demonstração indisponível.');
    return this.login(u.email, u.senha, { remember: true });
  },

  _abrirSessao(user, remember) {
    const now = Date.now();
    const sessao = {
      ...user,
      role: user.role,
      loginAt: now,
      loginHora: new Date(now).toLocaleString('pt-BR'),
      expiresAt: now + SESSAO_HORAS * 3600 * 1000
    };
    this._persist(sessao, remember);
    this._logAcesso({ nome: user.nome, email: user.email, perfil: user.role, evento: 'login' });
    return sessao;
  },

  _persist(sessao, remember) {
    const store = remember ? localStorage : sessionStorage;
    store.setItem(SESSION_KEY, JSON.stringify(sessao));
    (remember ? sessionStorage : localStorage).removeItem(SESSION_KEY);
  },

  _clear() {
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  },

  async logout() {
    const u = this.current();
    if (u) this._logAcesso({ nome: u.nome, email: u.email, perfil: u.role, evento: 'logout' });
    if (SUPABASE.enabled) { try { const sb = await getSupabase(); await sb.auth.signOut(); } catch {} }
    this._clear();
    location.href = 'login.html';
  },

  /** Protege uma página: exige sessão válida (não expirada). Retorna o usuário. */
  guard() {
    let raw = null;
    try { raw = JSON.parse(sessionStorage.getItem(SESSION_KEY) || localStorage.getItem(SESSION_KEY) || 'null'); } catch {}
    if (raw && raw.expiresAt && Date.now() > raw.expiresAt) {
      this._logAcesso({ nome: raw.nome, email: raw.email, perfil: raw.role, evento: 'expirou' });
      this._clear();
      location.href = 'login.html?expired=1';
      return null;
    }
    if (!raw) { location.href = 'login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() || ''); return null; }
    return raw;
  },

  /* ---------------------------------------------------------- logs de acesso */
  _logAcesso(entry) {
    try {
      const logs = JSON.parse(localStorage.getItem(ACESSOS_KEY) || '[]');
      logs.unshift({ ...entry, quando: new Date().toLocaleString('pt-BR'), dispositivo: navigator.userAgent.slice(0, 60) });
      localStorage.setItem(ACESSOS_KEY, JSON.stringify(logs.slice(0, 200)));   // mantém os 200 últimos
    } catch {}
  },
  acessos() {
    try { return JSON.parse(localStorage.getItem(ACESSOS_KEY) || '[]'); } catch { return []; }
  }
};
