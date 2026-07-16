/* ==========================================================================
   RNA One — App shell
   Injeta sidebar (filtrada por RBAC) + topbar ao redor do conteúdo da página.
   Uso na página:
     <div id="rna-page" data-module="dashboard" data-title="..." data-subtitle="...">
       ...conteúdo...
     </div>
     <script type="module" src="assets/js/pages/<pagina>.js"></script>
   ========================================================================== */
import { auth } from '../../services/auth.js';
import { db } from '../../services/db.js';
import { MODULES, ROLES, RBAC, can, BRAND } from '../../services/config.js';
import { $, $$, el, initials, toast } from './ui.js';
import { subscribe } from '../../services/integrations/realtime.js';   // [MÓDULO USUÁRIOS]

export async function mountShell() {
  const page = document.getElementById('rna-page');
  if (!page) return null;
  const user = auth.guard();
  if (!user) return null;

  console.log('[RNA-SHELL] usuário da sessão:', user, '| role:', user.role);

  // Papel inválido/ausente → volta ao login com aviso (não renderiza shell quebrado).
  if (!ROLES[user.role]) { location.href = 'login.html?perfil=0'; return null; }

  // Visitante não acessa a plataforma interna — apenas a tela institucional.
  if (user.role === 'visitante') { location.href = 'home.html'; return null; }

  const moduleId = page.dataset.module || 'dashboard';
  const title = page.dataset.title || 'RNA One';
  const subtitle = page.dataset.subtitle || BRAND.full;

  // Bloqueia acesso sem permissão de view
  if (moduleId !== 'home' && !can(user.role, moduleId, 'view')) {
    document.body.innerHTML = accessDenied(title);
    return null;
  }

  // ---- monta grupos de navegação respeitando RBAC ----
  const liberados = MODULES.filter(m => !m.hidden && can(user.role, m.id, 'view'));
  console.log('[RNA-SHELL] menus liberados para', user.role, ':', ['home (Portal)', ...liberados.map(m => m.id)]);
  const groups = {};
  liberados.forEach(m => {
    (groups[m.group] = groups[m.group] || []).push(m);
  });

  const navHtml = Object.entries(groups).map(([grp, mods]) => `
    <div class="rna-nav__section">${grp}</div>
    ${mods.map(m => navLink(m, moduleId)).join('')}
  `).join('');

  const notifs = await db.list('notificacoes').catch(() => []);
  const unread = notifs.filter(n => !n.lida).length;

  // ---- estrutura ----
  const shell = el(`<div class="rna-shell">
    <aside class="rna-sidebar" id="rna-sidebar">
      <a class="rna-sidebar__brand" href="index.html">
        <img src="${BRAND.logo}" alt="RNA">
        <span><b>${BRAND.name}</b><small>Rassini NHK</small></span>
      </a>
      <nav class="rna-nav">
        <div class="rna-nav__section">Início</div>
        ${navLink({ id:'home', label:'Portal', short:'Portal', page:'index.html', icon:'bi-house-door' }, moduleId)}
        ${navHtml}
        <div class="rna-nav__section">Sistema</div>
        <a class="rna-nav__link" href="#" id="rna-logout"><i class="bi bi-box-arrow-left"></i> Sair</a>
      </nav>
    </aside>
    <div class="rna-sidebar__backdrop" id="rna-backdrop"></div>
    <div class="rna-main">
      <header class="rna-topbar">
        <button class="rna-icon-btn rna-burger" id="rna-burger"><i class="bi bi-list"></i></button>
        <div class="rna-topbar__title">${title}<small>${subtitle}</small></div>
        <div class="rna-topbar__search ms-auto d-none d-lg-flex">
          <i class="bi bi-search"></i><input placeholder="Buscar máquina, NC, rotina...">
        </div>
        <button class="rna-icon-btn" id="rna-bell" title="Notificações">
          <i class="bi bi-bell"></i>${unread ? '<span class="dot"></span>' : ''}
        </button>
        ${can(user.role,'monitoramento','view') ? `<button class="rna-icon-btn d-none d-md-grid" id="rna-monitor" title="Modo Gestão à Vista" onclick="location.href='monitoramento.html'">
          <i class="bi bi-display"></i>
        </button>` : ''}
        <div class="rna-user" id="rna-user" title="Login: ${user.loginHora || '—'} · expira em ${SESSAO_LABEL(user)}">
          <div class="rna-avatar">${initials(user.nome)}</div>
          <div class="rna-user__meta"><b>${user.nome}</b><small>${ROLES[user.role]?.label || user.role}</small></div>
          <i class="bi bi-chevron-down text-muted-2 d-none d-md-block" style="font-size:11px"></i>
        </div>
      </header>
      <main class="rna-content" id="rna-content"></main>
    </div>
  </div>`);

  // move conteúdo da página para dentro do content host
  const content = shell.querySelector('#rna-content');
  content.appendChild(page);

  document.body.innerHTML = '';
  document.body.appendChild(shell);

  wireShell(user, notifs);
  return { user };
}

function SESSAO_LABEL(user) {
  if (!user.expiresAt) return '—';
  const ms = user.expiresAt - Date.now();
  if (ms <= 0) return 'expirada';
  const h = Math.floor(ms / 3600000), min = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h${String(min).padStart(2,'0')}` : `${min}min`;
}

function navLink(m, active) {
  const badge = m.badge ? `<span class="rna-nav__badge">${m.badge}</span>` : '';
  const cls = (m.id === active) ? 'rna-nav__link active' : 'rna-nav__link';
  return `<a class="${cls}" href="${m.page}"><i class="bi ${m.icon}"></i> ${m.short || m.label} ${badge}</a>`;
}

function wireShell(user, notifs) {
  // logout
  $('#rna-logout')?.addEventListener('click', (e) => { e.preventDefault(); auth.logout(); });

  // mobile nav
  const sb = $('#rna-sidebar'), bd = $('#rna-backdrop');
  $('#rna-burger')?.addEventListener('click', () => { sb.classList.toggle('open'); bd.classList.toggle('show'); });
  bd?.addEventListener('click', () => { sb.classList.remove('open'); bd.classList.remove('show'); });

  // user menu
  $('#rna-user')?.addEventListener('click', () => { location.href = 'perfil.html'; });

  // notifications dropdown
  $('#rna-bell')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('#rna-notif-pop')?.remove();
    const pop = el(`<div id="rna-notif-pop" style="position:absolute;top:56px;right:120px;width:330px;background:#fff;border:1px solid var(--rna-border);border-radius:14px;box-shadow:var(--rna-shadow-lg);z-index:2000;overflow:hidden">
      <div style="padding:13px 16px;border-bottom:1px solid var(--rna-border);display:flex;justify-content:space-between;align-items:center">
        <b style="font-size:13.5px">Notificações</b><span class="rna-badge badge-crit">${notifs.filter(n=>!n.lida).length} novas</span></div>
      <div style="max-height:340px;overflow:auto">
        ${notifs.map(n => `<div style="padding:12px 16px;border-bottom:1px solid #eef1f4;display:flex;gap:11px">
          <i class="bi ${n.tipo==='crit'?'bi-x-octagon-fill':n.tipo==='warn'?'bi-exclamation-triangle-fill':'bi-info-circle-fill'}" style="color:${n.tipo==='crit'?'var(--rna-crit)':n.tipo==='warn'?'var(--rna-warn)':'var(--rna-info)'};margin-top:2px"></i>
          <div><b style="font-size:13px">${n.titulo}</b><div style="font-size:12px;color:var(--rna-gray)">${n.texto}</div><small style="color:var(--rna-gray-300)">${n.quando}</small></div>
        </div>`).join('')}
      </div>
      <a href="dashboard.html" style="display:block;text-align:center;padding:11px;font-size:12.5px;font-weight:600;color:var(--rna-graphite);border-top:1px solid var(--rna-border)">Ver todas no painel</a>
    </div>`);
    document.querySelector('.rna-main').appendChild(pop);
    setTimeout(() => document.addEventListener('click', function h(ev){ if(!pop.contains(ev.target)){ pop.remove(); document.removeEventListener('click', h);} }), 0);
  });

  // search demo
  $('.rna-topbar__search input')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) toast(`Busca por “${e.target.value}” — integração de índice global prevista para a fase 2.`, { type:'info', title:'Busca global' });
  });

  // [MÓDULO USUÁRIOS] Notificações em tempo real (novas solicitações p/ admin etc.)
  // Assina INSERTs em `notificacoes`; o RLS já limita ao destinatário. Filtramos
  // também no cliente por segurança. No-op silencioso em modo demo.
  subscribe('notificacoes', ({ new: n }) => {
    if (!n) return;
    if (n.destinatario && user.id && n.destinatario !== user.id) return;
    notifs.unshift({ titulo: n.titulo, texto: n.texto, tipo: n.tipo || 'info', quando: 'agora', lida: false });
    const bell = $('#rna-bell');
    if (bell && !bell.querySelector('.dot')) bell.insertAdjacentHTML('beforeend', '<span class="dot"></span>');
    toast(n.texto ? `${n.titulo} · ${n.texto}` : n.titulo, { type: n.tipo === 'crit' ? 'crit' : 'info', title: 'Notificação' });
  }, { event: 'INSERT' }).catch(() => {});
}

function accessDenied(title) {
  return `<div style="min-height:100vh;display:grid;place-items:center;text-align:center;padding:30px">
    <div><i class="bi bi-shield-lock" style="font-size:54px;color:var(--rna-gray-300)"></i>
    <h2 style="margin:14px 0 6px">Acesso restrito</h2>
    <p style="color:var(--rna-gray)">Seu perfil não tem permissão para acessar <b>${title}</b>.</p>
    <a class="rna-btn rna-btn-primary mt-2" href="index.html"><i class="bi bi-house-door"></i> Voltar ao portal</a></div></div>`;
}
