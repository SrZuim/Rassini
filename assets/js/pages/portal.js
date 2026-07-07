/* Portal corporativo — home */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { MODULES, can, BRAND, ROLES } from '../../../services/config.js';
import { $, initials } from '../ui.js';

const colorMap = { yellow:'ic-soft-yellow', green:'ic-soft-green', red:'ic-soft-red', blue:'ic-soft-blue', orange:'ic-soft-orange', gray:'ic-soft-gray' };

const ctx = await mountShell();
if (ctx) render(ctx.user);

async function render(user) {
  const [ncs, rotinas, plantoes, auditorias, comunicados] = await Promise.all([
    db.list('nao_conformidades'), db.list('rotinas'), db.list('plantoes').catch(()=>[]),
    db.list('auditorias'), db.list('comunicados')
  ]);
  const ncAbertas = ncs.filter(n => !['Resolvida','Encerrada'].includes(n.status)).length;
  const rotPend = rotinas.filter(r => r.status === 'Pendente' || r.status === 'Em andamento').length;
  const audDia = auditorias.filter(a => a.data === '2026-06-28').length;
  const plantaoAtivo = (await db.list('plantoes').catch(()=>[])).find(p => p.usuario === user.id && p.status === 'Aberto');

  const hora = new Date().getHours();
  const saud = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';

  const cards = MODULES.map(m => {
    const allowed = can(user.role, m.id, 'view');
    return `<div class="col-6 col-md-4 col-xl-3">
      <a href="${allowed ? m.page : '#'}" class="portal-card ${allowed ? '' : 'opacity-75'}" ${allowed ? '' : 'onclick="return false" title="Sem permissão"'}>
        ${allowed ? '' : '<i class="bi bi-lock-fill lock"></i>'}
        <div class="portal-card__icon ${colorMap[m.color]||'ic-soft-gray'}"><i class="bi ${m.icon}"></i></div>
        <h4>${m.label}</h4>
        <p>${m.desc}</p>
        <span class="portal-card__go">${allowed ? 'Acessar' : 'Bloqueado'} <i class="bi bi-arrow-right"></i></span>
      </a>
    </div>`;
  }).join('');

  const comHtml = comunicados.slice(0,3).map(c => `
    <a href="documentos.html#comunicados" class="d-flex gap-3 p-2 rounded-3 text-decoration-none" style="border-bottom:1px solid #eef1f4">
      <img src="${c.img}" style="width:74px;height:56px;object-fit:cover;border-radius:9px" loading="lazy">
      <div>
        <span class="rna-badge badge-yellow mb-1">${c.tag}</span>
        <div style="font-size:13px;font-weight:600;line-height:1.25;color:var(--rna-graphite)">${c.titulo}</div>
        <small class="text-muted-2">${c.autor} · ${c.data.split('-').reverse().join('/')}</small>
      </div>
    </a>`).join('');

  $('#rna-content').innerHTML = `
    <div class="portal-hero mb-4">
      <img class="bg" src="${BRAND.banners[0]}" alt="">
      <div class="portal-hero__inner">
        <span class="portal-hero__badge"><i class="bi bi-broadcast"></i> Plataforma online · ${ROLES[user.role]?.label}</span>
        <h2>${saud}, ${user.nome.split(' ')[0]}.</h2>
        <p>Bem-vindo ao <b>RNA One</b>, o ambiente integrado de monitoramento, qualidade e auditoria da Rassini NHK Automotive.
        ${plantaoAtivo ? 'Seu plantão está <b style="color:var(--rna-yellow)">em andamento</b>.' : 'Você ainda não iniciou o plantão de hoje.'}</p>
        <div class="d-flex gap-2 mt-3">
          <a href="checkin.html" class="rna-btn rna-btn-primary"><i class="bi bi-box-arrow-in-right"></i> ${plantaoAtivo ? 'Ver plantão' : 'Iniciar plantão'}</a>
          <a href="dashboard.html" class="rna-btn rna-btn-ghost" style="background:rgba(255,255,255,.1);color:#fff;border-color:rgba(255,255,255,.2)"><i class="bi bi-grid-1x2"></i> Indicadores</a>
        </div>
      </div>
    </div>

    <div class="row g-3 mb-4">
      ${miniStat('bi-clipboard-data','ic-soft-blue', audDia, 'Auditorias hoje')}
      ${miniStat('bi-list-check','ic-soft-yellow', rotPend, 'Rotinas pendentes')}
      ${miniStat('bi-exclamation-octagon','ic-soft-red', ncAbertas, 'NCs em aberto')}
      ${miniStat('bi-graph-up','ic-soft-green', '92%', 'Eficiência do plantão')}
    </div>

    <div class="d-flex align-items-center justify-content-between mb-3">
      <h2 style="font-size:18px;font-weight:700;margin:0">Módulos da plataforma</h2>
      <small class="text-muted-2">Acesso conforme seu perfil</small>
    </div>
    <div class="row g-3 mb-4">${cards}</div>

    <div class="row g-3">
      <div class="col-lg-8">
        <div class="rna-card">
          <div class="rna-card__head"><h3><i class="bi bi-megaphone"></i> Comunicados recentes</h3><a href="documentos.html#comunicados" style="font-size:12.5px;font-weight:600;color:var(--rna-yellow-600)">Ver todos</a></div>
          <div class="rna-card__body pt-2">${comHtml}</div>
        </div>
      </div>
      <div class="col-lg-4">
        <div class="rna-card h-100">
          <div class="rna-card__head"><h3><i class="bi bi-people"></i> Equipe & treinamentos</h3></div>
          <div class="rna-card__body">
            <img src="${BRAND.auditores}" class="w-100 rounded-3 mb-3" style="object-fit:cover;max-height:130px" loading="lazy">
            <div class="d-flex justify-content-between align-items-center mb-2"><span style="font-size:13px">Aderência a treinamentos</span><b style="color:var(--rna-yellow-600)">71%</b></div>
            <div class="rna-progress mb-3"><span style="width:71%"></span></div>
            <a href="treinamentos.html" class="rna-btn rna-btn-ghost w-100 justify-content-center"><i class="bi bi-mortarboard"></i> Ver trilhas</a>
          </div>
        </div>
      </div>
    </div>`;
}

function miniStat(icon, ic, val, label) {
  return `<div class="col-6 col-md-3"><div class="rna-stat">
    <div class="rna-stat__icon ${ic}"><i class="bi ${icon}"></i></div>
    <div class="rna-stat__val">${val}</div><div class="rna-stat__label">${label}</div>
  </div></div>`;
}
