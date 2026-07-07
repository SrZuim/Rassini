/* Auditorias */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { statusClass, can } from '../../../services/config.js';
import { charts, PALETTE } from '../charts.js';
import { $, $$, toast, modal } from '../ui.js';

const ctx = await mountShell();
let USER;
if (ctx) { USER = ctx.user; render(); }

async function render() {
  const [auds, areas, usuarios] = await Promise.all([db.list('auditorias'), db.list('areas'), db.list('usuarios')]);
  const podeCriar = can(USER.role,'auditorias','create');
  const confMedia = Math.round(auds.reduce((s,a)=>s+a.conformidade,0)/(auds.length||1));

  $('#rna-content').innerHTML = `
    <div class="rna-page-head">
      <div><div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Auditorias</div>
      <h1>Auditorias</h1><p>Auditorias de processo, produto, segurança e 5S (LPA).</p></div>
      ${podeCriar?`<button class="rna-btn rna-btn-primary" id="btn-aud"><i class="bi bi-plus-lg"></i> Nova auditoria</button>`:''}
    </div>
    <div class="row g-3 mb-3">
      ${mini(auds.length,'Auditorias','ic-soft-blue','bi-clipboard-data')}
      ${mini(auds.filter(a=>a.status==='Concluída').length,'Concluídas','ic-soft-green','bi-check2-circle')}
      ${mini(auds.reduce((s,a)=>s+a.ncs,0),'NCs geradas','ic-soft-red','bi-exclamation-octagon')}
      ${mini(confMedia+'%','Conformidade média','ic-soft-yellow','bi-graph-up-arrow')}
    </div>
    <div class="row g-3 mb-3">
      <div class="col-lg-7"><div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-bar-chart"></i> Conformidade por auditoria</h3></div>
        <div class="rna-card__body"><div style="height:240px"><canvas id="ch-conf"></canvas></div></div></div></div>
      <div class="col-lg-5"><div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-diagram-2"></i> Conformidade por dimensão (LPA)</h3></div>
        <div class="rna-card__body"><div style="height:240px"><canvas id="ch-radar"></canvas></div></div></div></div>
    </div>
    <div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-list-ul"></i> Histórico de auditorias</h3></div>
      <div class="rna-card__body p-0"><table class="rna-table"><thead><tr><th>Código</th><th>Tipo</th><th>Área / Linha</th><th>Auditor</th><th>Data</th><th>Conformidade</th><th>NCs</th><th>Status</th></tr></thead><tbody>
        ${auds.map(a=>`<tr><td class="cell-strong">${a.codigo}</td><td><span class="rna-badge badge-info">${a.tipo}</span></td>
          <td>${a.area}<div class="cell-sub">${a.linha}</div></td><td>${nome(usuarios,a.auditor)}</td><td class="cell-sub">${a.data.split('-').reverse().join('/')}</td>
          <td><div class="d-flex align-items-center gap-2"><div class="rna-progress" style="width:70px"><span style="width:${a.conformidade}%;background:${a.conformidade>90?'var(--rna-ok)':a.conformidade>80?'var(--rna-yellow)':'var(--rna-crit)'}"></span></div><small>${a.conformidade}%</small></div></td>
          <td>${a.ncs?`<span class="rna-badge badge-crit">${a.ncs}</span>`:'<span class="text-muted-2">0</span>'}</td>
          <td><span class="rna-badge ${statusClass(a.status)}">${a.status}</span></td></tr>`).join('')}
      </tbody></table></div></div>`;

  charts.bar('ch-conf', auds.map(a=>a.codigo), [{ label:'Conformidade %', data:auds.map(a=>a.conformidade),
    backgroundColor:auds.map(a=>a.conformidade>90?PALETTE.green:a.conformidade>80?PALETTE.yellow:PALETTE.red) }], { plugins:{legend:{display:false}}, scales:{y:{max:100}} });
  charts.radar('ch-radar', ['Segurança','Qualidade','5S','Processo','Documentação','Manutenção'],
    [{ label:'Atual', data:[82,96,90,88,94,79], borderColor:PALETTE.yellow, backgroundColor:PALETTE.yellow+'33', borderWidth:2 },
     { label:'Meta', data:[95,95,95,95,95,95], borderColor:PALETTE.gray, backgroundColor:'transparent', borderDash:[4,4], borderWidth:1.5 }]);

  $('#btn-aud')?.addEventListener('click',()=>novaModal(areas,usuarios));
}
const nome=(us,id)=>us.find(u=>u.id===id)?.nome||'—';
const mini=(v,l,ic,icon)=>`<div class="col-6 col-md-3"><div class="rna-stat"><div class="rna-stat__icon ${ic}"><i class="bi ${icon}"></i></div><div class="rna-stat__val" style="font-size:22px">${v}</div><div class="rna-stat__label">${l}</div></div></div>`;

function novaModal(areas,usuarios){
  const m = modal({ title:'Nova Auditoria', size:'modal-lg', content:`<form class="row g-3">
      <div class="col-md-6"><label class="form-label">Tipo</label><select class="form-select" id="au-tipo"><option>Processo</option><option>Produto</option><option>Segurança</option><option>5S</option><option>LPA</option></select></div>
      <div class="col-md-6"><label class="form-label">Área</label><select class="form-select" id="au-area">${areas.map(a=>`<option>${a.nome}</option>`).join('')}</select></div>
      <div class="col-md-6"><label class="form-label">Linha</label><input class="form-control" id="au-linha" placeholder="Linha"></div>
      <div class="col-md-6"><label class="form-label">Data</label><input type="date" class="form-control" id="au-data" value="2026-06-28"></div>
      <div class="col-12"><label class="form-label">Escopo / observações</label><textarea class="form-control" rows="2" id="au-obs"></textarea></div>
    </form>`,
    footer:`<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button><button class="rna-btn rna-btn-primary" id="au-ok"><i class="bi bi-play-fill"></i> Iniciar auditoria</button>`
  });
  $('#au-ok',m.host).addEventListener('click', async ()=>{
    await db.insert('auditorias',{ codigo:'AUD-'+Math.floor(Math.random()*900+2405), tipo:$('#au-tipo',m.host).value, area:$('#au-area',m.host).value,
      linha:$('#au-linha',m.host).value||'—', auditor:USER.id, data:$('#au-data',m.host).value, conformidade:100, ncs:0, status:'Em andamento' });
    await db.log({ usuario:USER.nome, acao:'Iniciou auditoria', entidade:'auditoria', antes:'—', depois:'Em andamento' });
    m.close(); toast('Auditoria iniciada.', { type:'ok' }); render();
  });
}
