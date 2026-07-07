/* Meu Perfil */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { auth } from '../../../services/auth.js';
import { ROLES, RBAC, MODULES } from '../../../services/config.js';
import { charts, PALETTE } from '../charts.js';
import { $, $$, toast, initials, confirmDialog } from '../ui.js';

const ctx = await mountShell();
let USER;
if (ctx) { USER = ctx.user; render(); }

async function render() {
  const [atividades, logs] = await Promise.all([db.list('atividades'), db.list('logs')]);
  const minhas = atividades.filter(a=>a.auditor===USER.id);
  const meusLogs = logs.filter(l=>l.usuario===USER.nome);
  const perms = RBAC[USER.role] || {};

  $('#rna-content').innerHTML = `
    <div class="rna-page-head">
      <div><div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Perfil</div>
      <h1>Meu Perfil</h1><p>Seus dados, produtividade e registros de auditoria.</p></div>
      <button class="rna-btn rna-btn-ghost" id="btn-logout"><i class="bi bi-box-arrow-left"></i> Sair</button>
    </div>

    <div class="row g-3">
      <div class="col-lg-4">
        <div class="rna-card mb-3"><div class="rna-card__body text-center">
          <div style="position:relative;height:90px;border-radius:12px;overflow:hidden;margin-bottom:-30px">
            <img src="assets/rassini/banner-2.jpg" style="width:100%;height:100%;object-fit:cover;opacity:.85"></div>
          <div class="rna-avatar mx-auto" style="width:74px;height:74px;font-size:26px;border:4px solid #fff;position:relative">${initials(USER.nome)}</div>
          <h3 style="margin:10px 0 2px;font-size:18px">${USER.nome}</h3>
          <span class="rna-badge badge-yellow"><i class="bi ${ROLES[USER.role]?.icon}"></i> ${ROLES[USER.role]?.label}</span>
          <div class="divider"></div>
          <div class="text-start" style="font-size:13px;line-height:2.1">
            <div class="d-flex justify-content-between"><span class="text-muted-2">Matrícula</span><b>${USER.matricula}</b></div>
            <div class="d-flex justify-content-between"><span class="text-muted-2">E-mail</span><b style="font-size:12px">${USER.email}</b></div>
            <div class="d-flex justify-content-between"><span class="text-muted-2">Área</span><b>${USER.area}</b></div>
            <div class="d-flex justify-content-between"><span class="text-muted-2">Planta</span><b>${USER.planta}</b></div>
          </div>
        </div></div>
        <div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-shield-check"></i> Minhas permissões</h3></div>
          <div class="rna-card__body" style="max-height:280px;overflow:auto">
            ${MODULES.map(mo=>{
              const p = perms[mo.id]||[];
              return `<div class="d-flex justify-content-between align-items-center py-1" style="border-bottom:1px solid #eef1f4;font-size:12.5px">
                <span><i class="bi ${mo.icon} text-muted-2"></i> ${mo.label}</span>
                ${p.length?`<span class="rna-badge badge-ok">${p.includes('view')&&p.length===1?'Leitura':p.length>=6?'Total':p.length+' ações'}</span>`:'<span class="rna-badge badge-na">—</span>'}</div>`;
            }).join('')}
          </div></div>
      </div>

      <div class="col-lg-8">
        <div class="row g-3 mb-3">
          ${mini(minhas.length,'Atividades','ic-soft-blue','bi-journal-text')}
          ${mini(minhas.filter(a=>a.resultado==='Conforme').length,'Conformes','ic-soft-green','bi-check2')}
          ${mini(minhas.filter(a=>a.tempo>a.tempo_padrao).length,'Tempo excedido','ic-soft-red','bi-stopwatch')}
          ${mini('92%','Eficiência','ic-soft-yellow','bi-graph-up')}
        </div>
        <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-bar-chart"></i> Produtividade na semana</h3></div>
          <div class="rna-card__body"><div style="height:220px"><canvas id="ch-perf"></canvas></div></div></div>

        <div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-clock-history"></i> Trilha de auditoria (logs)</h3>
          <span class="rna-badge badge-info">${meusLogs.length} registros</span></div>
          <div class="rna-card__body p-0"><table class="rna-table"><thead><tr><th>Quando</th><th>Ação</th><th>Antes → Depois</th><th>Dispositivo</th></tr></thead><tbody>
            ${(meusLogs.length?meusLogs:logs).slice(0,8).map(l=>`<tr><td class="cell-sub">${l.quando}</td><td class="cell-strong">${l.acao}</td>
              <td><span class="rna-badge badge-na">${l.antes}</span> → <span class="rna-badge badge-ok">${l.depois}</span></td><td class="cell-sub">${l.dispositivo}</td></tr>`).join('')}
          </tbody></table></div></div>

        <div class="rna-card mt-3"><div class="rna-card__head"><h3><i class="bi bi-gear"></i> Preferências & dados</h3></div>
          <div class="rna-card__body d-flex flex-wrap gap-2">
            <button class="rna-btn rna-btn-ghost" id="btn-reset"><i class="bi bi-arrow-counterclockwise"></i> Restaurar dados demo</button>
            <span class="rna-badge ${db.mode==='demo'?'badge-warn':'badge-ok'}" style="align-self:center"><i class="bi bi-database"></i> Modo: ${db.mode==='demo'?'Demonstração (local)':'Supabase'}</span>
          </div></div>
      </div>
    </div>`;

  charts.bar('ch-perf', ['Seg','Ter','Qua','Qui','Sex','Sáb'],
    [{ label:'Rotinas', data:[12,15,14,17,19,8], backgroundColor:PALETTE.yellow },
     { label:'NCs tratadas', data:[1,0,2,1,3,0], backgroundColor:PALETTE.graphite }]);

  $('#btn-logout').addEventListener('click',()=>auth.logout());
  $('#btn-reset').addEventListener('click',()=>confirmDialog('Restaurar os dados de demonstração ao estado inicial? Suas alterações locais serão perdidas.', ()=>{
    db.resetDemo(); toast('Dados de demonstração restaurados.', { type:'ok' }); setTimeout(()=>location.reload(),700);
  }, { title:'Restaurar dados', okLabel:'Restaurar', danger:true }));
}
const mini=(v,l,ic,icon)=>`<div class="col-6 col-md-3"><div class="rna-stat"><div class="rna-stat__icon ${ic}"><i class="bi ${icon}"></i></div><div class="rna-stat__val" style="font-size:22px">${v}</div><div class="rna-stat__label">${l}</div></div></div>`;
