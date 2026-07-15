/* ==========================================================================
   RNA One — Autenticação e Sessão (login local)
   ---------------------------------------------------------------------------
   • Credenciais e perfis: services/users.json  ← EDITE OS USUÁRIOS LÁ
   • Sessão em localStorage/sessionStorage, com expiração de 8 horas
   • Logs de acesso (login/logout/falha) em localStorage ('rna_acessos')
   • Pronto para migrar para Supabase Auth (basta configurar services/config.js)
   ========================================================================== */
import { SUPABASE, ROLES } from './config.js';
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

/* [MÓDULO USUÁRIOS] Domínio corporativo obrigatório em cadastros novos.
   1ª camada (front). O back-end revalida no trigger fn_usuario_signup. */
export const DOMINIO_CORP = 'rassininhk.com.br';
const DOMINIO_RE = /@rassininhk\.com\.br$/i;
export function emailCorporativoValido(email) {
  return DOMINIO_RE.test(String(email || '').trim());
}

/* [MÓDULO USUÁRIOS] Traduz erros do Supabase (Auth/PostgREST/RPC) em mensagens
   reais e amigáveis. NUNCA usar JSON.stringify(error) — objetos de erro do
   Supabase têm propriedades não-enumeráveis e serializam para "{}". */
export function traduzErroSupabase(error, contexto = '') {
  if (!error) return new Error('Erro desconhecido.');
  const msg    = String(error.message || '');
  const det    = String(error.details || '');
  const hint   = String(error.hint || '');
  const code   = String(error.code || error.status || '');
  const full   = `${msg} ${det} ${hint}`.toLowerCase();

  // --- Casos de LOGIN (Supabase Auth) → mensagem real ---------------------
  if (/email not confirmed|not confirmed|email_not_confirmed/.test(full))
    return new Error('Confirme seu e-mail antes de acessar a plataforma.');
  if (/invalid login credentials|invalid credentials|invalid_grant/.test(full))
    return new Error('E-mail ou senha inválidos.');
  if (/user not found|no user found/.test(full))
    return new Error('E-mail não cadastrado.');
  if (/for security purposes|rate limit|too many|over_request_rate/.test(full))
    return new Error('Muitas tentativas. Aguarde alguns segundos e tente novamente.');

  // Casos conhecidos → mensagem clara e ACIONÁVEL (não um beco sem saída).
  // OBS.: no cadastro, signup() intercepta "already registered" ANTES daqui
  // para tentar recuperar contas órfãs; esta mensagem é o fallback.
  if (/already registered|already been registered|user already exists|user_already_exists/.test(full))
    return new Error('Este e-mail já possui uma conta. Se você já solicitou acesso, aguarde a aprovação; caso já use a plataforma, faça login ou recupere sua senha.');
  if (code === '23505' || /duplicate key|unique constraint/.test(full))
    return new Error('Já existe um cadastro com este e-mail.');
  if (/invalid email|email.*invalid/.test(full))
    return new Error('O endereço de e-mail informado é inválido.');
  if (/rassini|corporativo/.test(full))
    return new Error('Utilize seu e-mail corporativo da Rassini NHK.');
  if (code === '42501' || /row-level security|permission denied|violates row-level/.test(full))
    return new Error('Política RLS bloqueou o cadastro. Rode database/fix_cadastro_usuarios.sql no Supabase.');
  if (/database error saving new user|unexpected_failure/.test(full))
    return new Error('Erro ao criar usuário no Auth (trigger no banco). Rode database/fix_cadastro_usuarios.sql.');
  if (code === '23514' || /check constraint|violates check/.test(full))
    return new Error(msg || 'Campo obrigatório ausente ou inválido.');
  if (/for security purposes|rate limit|too many/.test(full))
    return new Error('Muitas tentativas. Aguarde alguns segundos e tente novamente.');
  if (/invalid|password/.test(full) && contexto === 'auth')
    return new Error(msg || 'Dados de cadastro inválidos.');

  // Genérico — monta a partir das partes reais disponíveis
  const partes = [msg, det, hint && `Dica: ${hint}`].filter(Boolean);
  const texto = partes.join(' · ') || (code ? `Erro ${code}` : 'Falha ao solicitar acesso.');
  return new Error(contexto === 'perfil' ? `Erro ao salvar perfil: ${texto}` : texto);
}

/* [MÓDULO USUÁRIOS] Mensagens do gate de status no login. */
function mensagemStatus(status) {
  return ({
    pendente:  'Seu cadastro foi recebido e está aguardando aprovação do administrador.',
    recusado:  'Seu acesso foi recusado. Procure seu supervisor ou administrador.',
    bloqueado: 'Seu acesso está bloqueado. Procure o administrador.'
  })[status] || 'Seu acesso está inativo. Procure o administrador.';
}

/* [MÓDULO USUÁRIOS] Mensagens do CADASTRO quando o e-mail já tem perfil público.
   Erro amigável e específico por status (substitui o genérico "já cadastrado"). */
function mensagemCadastroExistente(status) {
  return ({
    pendente:  'Já existe uma solicitação de acesso pendente para este e-mail. Aguarde a aprovação do administrador.',
    aprovado:  'Este e-mail já possui uma conta ativa. Utilize a tela de login ou a opção de recuperação de senha.',
    recusado:  'Este e-mail possui uma solicitação recusada. Entre em contato com o administrador para reavaliação.',
    bloqueado: 'Este e-mail está bloqueado. Entre em contato com o administrador.'
  })[status] || 'Este e-mail já possui um cadastro no sistema.';
}

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
      auditor: 'op-plantao.html',   // início de plantão (Operações)
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
      console.log('%c[RNA-AUTH] Tentando login:', 'color:#e0a500;font-weight:bold', email);
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      console.log('%c[RNA-AUTH] Auth result:', 'color:#e0a500;font-weight:bold', { userId: data?.user?.id || null, temSessao: !!data?.session });
      if (error) {
        // [MÓDULO USUÁRIOS] Loga o erro COMPLETO antes de qualquer mensagem (req #11).
        console.error('[RNA-AUTH] Auth error:', error, '| message:', error?.message, '| status:', error?.status, '| code:', error?.code);
        this._logAcesso({ email, evento: 'falha', motivo: error?.message || 'auth_error' });
        throw traduzErroSupabase(error, 'login');   // mensagem real: credenciais / e-mail não confirmado / rate limit
      }

      const authUser = data.user;
      dbg('1) Usuário autenticado pelo Auth:', { id: authUser?.id, email: authUser?.email });

      // Carrega o perfil real na tabela "usuarios" (por e-mail e, se preciso, por auth_id).
      const { prof, diag } = await this._carregarPerfil(sb, authUser);
      console.log('%c[RNA-AUTH] Perfil encontrado:', 'color:#e0a500;font-weight:bold', prof, '| diagnóstico:', diag);

      // Papel padronizado do projeto (o sistema usa 'admin', não 'administrador').
      const role = PERFIL_PARA_ROLE[prof?.role] || prof?.role || null;

      // Sem perfil válido → NÃO cria sessão quebrada (visitante/null). Bloqueia (requisito #8).
      if (!prof || !role) {
        try { await sb.auth.signOut(); } catch {}
        this._logAcesso({ email, evento: 'falha', motivo: prof ? 'role_invalida' : 'sem_perfil' });
        console.error('[RNA-AUTH] Perfil não carregado. Diagnóstico:', diag);
        throw new Error('Perfil não encontrado. Verifique o cadastro do usuário.');
      }

      // [MÓDULO USUÁRIOS] Gate de status corporativo (requisito #4).
      // Registros anteriores ao módulo não têm status → tratados como 'aprovado'.
      const status = prof.status || 'aprovado';
      const ativo  = prof.ativo !== false;
      if (status !== 'aprovado' || !ativo) {
        try { await sb.auth.signOut(); } catch {}
        this._logAcesso({ email, evento: 'falha', motivo: 'status_' + status });
        dbg('Acesso bloqueado por status:', status, '| ativo:', ativo);
        throw new Error(mensagemStatus(status));
      }

      // Objeto do usuário NORMALIZADO — sempre com os mesmos campos.
      const usuario = {
        id:        prof.id || authUser.id,
        auth_id:   authUser.id,
        nome:      prof.nome || email.split('@')[0],
        email:     prof.email || email,
        role,                                   // 'admin' | 'supervisor' | 'auditor' | 'visitante'
        matricula: prof.matricula ?? null,
        area:      prof.area ?? null,
        planta:    prof.planta ?? null
      };

      dbg('5) Role final utilizada pelo sistema:', role);
      // [MÓDULO USUÁRIOS] Carimba o último login (best-effort; não bloqueia o acesso).
      try { await sb.rpc('fn_registrar_login'); } catch (e) { dbg('fn_registrar_login falhou:', e?.message); }
      return this._abrirSessao(usuario, remember);
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

  /* [MÓDULO USUÁRIOS] ----------------------------------------------------------
     Cadastro público (solicitarAcesso). Fluxo robusto de ponta a ponta:
       1) valida nome/domínio/senha/planta
       2) cria a conta no Supabase Auth (signUp) → usa data.user.id
       3) cria o PERFIL via RPC solicitar_acesso (SECURITY DEFINER):
          status='pendente', ativo=false, role travada em auditor|visitante
       4) encerra a sessão (usuário aguarda aprovação)
     Erros SEMPRE com mensagem real (message/details/hint/code); nunca "{}". */
  async signup({ nome, email, password, planta, cargo } = {}) {
    email = String(email || '').trim().toLowerCase();
    nome  = String(nome || '').trim();

    if (!nome)                             throw new Error('Informe seu nome completo.');
    if (!emailCorporativoValido(email))    throw new Error('Utilize seu e-mail corporativo da Rassini NHK.');
    if (String(password || '').length < 6) throw new Error('A senha deve ter ao menos 6 caracteres.');
    if (!planta)                           throw new Error('Selecione a sua planta.');

    // Clamp de front (o servidor também força): só auditor/visitante.
    const cargoOk = ['auditor', 'visitante'].includes(cargo) ? cargo : 'visitante';
    if (!SUPABASE.enabled) throw new Error('Cadastro indisponível: backend não configurado.');
    const sb = await getSupabase();

    console.log('%c[CADASTRO] 1) dados enviados', 'color:#e0a500;font-weight:bold', { nome, email, planta, cargo: cargoOk });

    // (1.5) Pré-checagem de status → mensagem específica em vez da genérica.
    //       Se já há perfil público, não faz sentido tentar signUp de novo.
    const pre = await this._statusEmail(sb, email);
    if (pre?.existe_usuarios) {
      this._logAcesso({ email, evento: 'cadastro_bloqueado', motivo: 'status_' + (pre.status || '?') });
      throw new Error(mensagemCadastroExistente(pre.status));
    }
    // Órfão conhecido (existe no Auth, ausente em usuarios) → recupera direto,
    // sem depender do erro do signUp.
    if (pre?.orfao_auth) {
      const rec = await this._recuperarOrfao(sb, { email, nome, planta, cargo: cargoOk });
      if (rec?.recuperado) {
        this._logAcesso({ nome, email, evento: 'cadastro_recuperado' });
        return { email, nome, status: 'pendente', recuperado: true };
      }
      if (rec?.ja_existe) throw new Error(mensagemCadastroExistente(rec.status));
    }

    // (2) Cria a conta no Auth
    const { data, error: authErr } = await sb.auth.signUp({
      email, password,
      options: { data: { nome, planta, cargo_desejado: cargoOk } }
    });
    console.log('%c[CADASTRO] 2) resultado signUp', 'color:#e0a500;font-weight:bold',
      { userId: data?.user?.id || null, temSessao: !!data?.session, authErr });

    if (authErr) {
      console.error('[CADASTRO] erro Auth completo:', { message: authErr?.message, code: authErr?.code, status: authErr?.status });
      // Conta já existe no Auth mas sem perfil público (órfão típico de exclusão
      // parcial). Tenta recuperar o perfil pendente sem duplicar nem trocar senha.
      if (/already registered|already been registered|user already exists|user_already_exists/i.test(String(authErr?.message || ''))) {
        const rec = await this._recuperarOrfao(sb, { email, nome, planta, cargo: cargoOk });
        if (rec?.recuperado) {
          this._logAcesso({ nome, email, evento: 'cadastro_recuperado' });
          return { email, nome, status: 'pendente', recuperado: true };
        }
        if (rec?.ja_existe) throw new Error(mensagemCadastroExistente(rec.status));
        // Conta no Auth existe, mas não conseguimos recuperar automaticamente.
        throw new Error('Este e-mail já possui uma conta de acesso. Se for você, faça login ou use "Esqueci minha senha". Se acredita que houve um erro, procure o administrador.');
      }
      throw traduzErroSupabase(authErr, 'auth');
    }

    const authId = data?.user?.id || null;   // usa data.user.id (funciona com confirm-email ON/OFF)
    if (!authId) console.warn('[CADASTRO] signUp não retornou user.id (confirm-email?). A RPC seguirá por e-mail.');

    // (3) Cria o perfil pendente via RPC segura. Se falhar aqui, a conta já foi
    //     criada no Auth → sinaliza claramente a criação PARCIAL (recuperável).
    const { data: rpc, error: rpcErr } = await sb.rpc('solicitar_acesso', {
      p_nome: nome, p_email: email, p_planta: planta, p_cargo: cargoOk, p_auth_id: authId
    });
    console.log('%c[CADASTRO] 3) resultado solicitar_acesso', 'color:#e0a500;font-weight:bold', { rpc, rpcErr });
    if (rpcErr) {
      console.error('[CADASTRO] Conta criada no Auth, mas o perfil falhou (criação parcial):',
        { message: rpcErr?.message, code: rpcErr?.code });
      this._logAcesso({ email, evento: 'cadastro_parcial', motivo: rpcErr?.message || 'perfil' });
      throw new Error('A conta foi criada, mas o perfil não foi finalizado. Tente cadastrar novamente — o sistema recuperará seus dados automaticamente — ou procure o administrador.');
    }

    // (4) Não deixa sessão aberta — usuário aguarda aprovação.
    try { await sb.auth.signOut(); } catch {}
    this._logAcesso({ nome, email, evento: 'cadastro' });
    console.log('%c[CADASTRO] 4) concluído — perfil pendente criado', 'color:#1c8c4a;font-weight:bold');
    return { email, nome, status: 'pendente' };
  },

  /* [MÓDULO USUÁRIOS] Pré-checagem de status do e-mail (RPC fn_status_email).
     Best-effort: se a RPC não existir (banco desatualizado), retorna null e o
     fluxo segue pelo caminho antigo (signUp + tratamento de erro). */
  async _statusEmail(sb, email) {
    try {
      const { data, error } = await sb.rpc('fn_status_email', { p_email: email });
      if (error) { console.warn('[CADASTRO] fn_status_email indisponível:', error?.message); return null; }
      return data || null;
    } catch (e) { console.warn('[CADASTRO] fn_status_email exceção:', e?.message); return null; }
  },

  /* [MÓDULO USUÁRIOS] Recupera perfil órfão (RPC fn_recuperar_perfil_orfao).
     Cria o perfil pendente a partir da conta existente em auth.users. */
  async _recuperarOrfao(sb, { email, nome, planta, cargo }) {
    try {
      const { data, error } = await sb.rpc('fn_recuperar_perfil_orfao', {
        p_email: email, p_nome: nome, p_planta: planta, p_cargo: cargo
      });
      if (error) { console.warn('[CADASTRO] recuperação de órfão falhou:', error?.message); return null; }
      return data || null;
    } catch (e) { console.warn('[CADASTRO] recuperação de órfão exceção:', e?.message); return null; }
  },

  /** Alias explícito exigido pelo fluxo de cadastro. */
  solicitarAcesso(payload) { return this.signup(payload); },

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
    // Sessão sem papel válido (ex.: sessão antiga/quebrada) → não deixa entrar sem perfil.
    if (!raw.role || !ROLES[raw.role]) {
      this._clear();
      location.href = 'login.html?perfil=0';
      return null;
    }
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
