/* Meu Perfil */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { auth } from '../../../services/auth.js';
import { ROLES, RBAC, MODULES, SUPABASE } from '../../../services/config.js';
import { getSupabase } from '../../../services/supabaseClient.js';
import { charts, PALETTE } from '../charts.js';
import { $, $$, toast, initials, confirmDialog, modal } from '../ui.js';

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
            ${MODULES.filter(mo=>!mo.hidden).map(mo=>{
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

        <div class="rna-card mt-3"><div class="rna-card__head"><h3><i class="bi bi-shield-lock"></i> Conta & Segurança</h3></div>
          <div class="rna-card__body">
            <div class="d-flex flex-wrap gap-2">
              <button class="rna-btn rna-btn-primary" id="btn-foto"><i class="bi bi-camera"></i> Alterar foto</button>
              <button class="rna-btn rna-btn-ghost" id="btn-senha"><i class="bi bi-key"></i> Alterar senha</button>
            </div>
            <p class="text-muted-2 mt-2 mb-0" style="font-size:11.5px"><i class="bi bi-info-circle"></i> Cargo, permissões, status e planta são gerenciados pelo administrador e não podem ser alterados aqui.</p>
          </div></div>

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

  // [MÓDULO USUÁRIOS] Alterar foto / senha (única coisa editável pelo próprio usuário).
  $('#btn-foto').addEventListener('click', alterarFotoModal);
  $('#btn-senha').addEventListener('click', alterarSenhaModal);
}
const mini=(v,l,ic,icon)=>`<div class="col-6 col-md-3"><div class="rna-stat"><div class="rna-stat__icon ${ic}"><i class="bi ${icon}"></i></div><div class="rna-stat__val" style="font-size:22px">${v}</div><div class="rna-stat__label">${l}</div></div></div>`;

/* -------------------------------------------------- [MÓDULO USUÁRIOS] foto/senha */
function alterarSenhaModal() {
  const m = modal({
    title: 'Alterar senha',
    content: `<label class="form-label">Nova senha</label>
      <input type="password" id="np1" class="form-control" placeholder="Mínimo 6 caracteres" autocomplete="new-password">
      <label class="form-label mt-2">Confirmar nova senha</label>
      <input type="password" id="np2" class="form-control" autocomplete="new-password">`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-primary" id="sv-pw">Salvar senha</button>`
  });
  $('#sv-pw', m.host).addEventListener('click', async () => {
    const a = $('#np1', m.host).value, b = $('#np2', m.host).value;
    if (a.length < 6) return toast('A senha deve ter ao menos 6 caracteres.', { type:'warn' });
    if (a !== b)      return toast('As senhas não coincidem.', { type:'warn' });
    if (!SUPABASE.enabled) { m.close(); return toast('Troca de senha disponível apenas com backend Supabase.', { type:'warn' }); }
    try {
      const sb = await getSupabase();
      const { error } = await sb.auth.updateUser({ password: a });
      if (error) throw error;
      m.close(); toast('Senha alterada com sucesso.', { type:'ok' });
    } catch (e) { toast(e.message || 'Falha ao alterar senha.', { type:'crit' }); }
  });
}

function alterarFotoModal() {
  const m = modal({
    title: 'Alterar foto',
    content: `<p class="text-muted-2" style="font-size:12.5px">JPG, PNG ou WEBP. A imagem é redimensionada automaticamente.</p>
      <input type="file" id="ph-file" class="form-control" accept="image/*">
      <div id="ph-prev" class="mt-3 text-center"></div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-primary" id="sv-ph" disabled>Salvar foto</button>`
  });
  let dataUrl = null;
  $('#ph-file', m.host).addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      dataUrl = await comprimirImagem(f);
      $('#ph-prev', m.host).innerHTML = `<img src="${dataUrl}" style="width:104px;height:104px;border-radius:16px;object-fit:cover;border:3px solid var(--rna-border)">`;
      $('#sv-ph', m.host).disabled = false;
    } catch { toast('Não foi possível ler a imagem.', { type:'crit' }); }
  });
  $('#sv-ph', m.host).addEventListener('click', async () => {
    if (!dataUrl) return;
    try {
      await db.update('usuarios', USER.id, { avatar: dataUrl });
      m.close(); toast('Foto atualizada.', { type:'ok' }); setTimeout(() => location.reload(), 700);
    } catch (e) { toast(e.message || 'Falha ao salvar foto.', { type:'crit' }); }
  });
}

async function comprimirImagem(file) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const MAX = 256; let w = img.width, h = img.height;
  const sc = Math.min(1, MAX / Math.max(w, h)); w = Math.round(w * sc); h = Math.round(h * sc);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.8);
}
