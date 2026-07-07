/* Treinamentos */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { $, $$, toast } from '../ui.js';

const ctx = await mountShell();
if (ctx) render();

async function render() {
  const trs = await db.list('treinamentos');
  const concl = trs.filter(t=>t.status==='Concluído').length;
  const media = Math.round(trs.reduce((s,t)=>s+t.progresso,0)/(trs.length||1));

  $('#rna-content').innerHTML = `
    <div class="rna-page-head">
      <div><div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Treinamentos</div>
      <h1>Treinamentos</h1><p>Trilhas de capacitação e certificações da equipe.</p></div>
    </div>
    <div class="row g-3 mb-3">
      ${mini(trs.length,'Trilhas disponíveis','ic-soft-blue','bi-mortarboard')}
      ${mini(concl,'Concluídas','ic-soft-green','bi-patch-check')}
      ${mini(trs.filter(t=>t.status==='Em andamento').length,'Em andamento','ic-soft-yellow','bi-play-circle')}
      ${mini(media+'%','Aderência média','ic-soft-orange','bi-graph-up')}
    </div>
    <div class="row g-3">
      ${trs.map(t=>`<div class="col-md-6 col-xl-3"><div class="rna-card h-100" style="overflow:hidden">
        <div style="position:relative;height:120px"><img src="${t.img}" style="width:100%;height:100%;object-fit:cover" loading="lazy">
          <span class="rna-badge badge-yellow" style="position:absolute;top:10px;left:10px">${t.categoria}</span></div>
        <div class="rna-card__body">
          <h4 style="font-size:13.5px;font-weight:650;margin:0 0 4px;min-height:38px">${t.nome}</h4>
          <small class="text-muted-2"><i class="bi bi-clock"></i> ${t.carga}</small>
          <div class="d-flex justify-content-between mt-2" style="font-size:12px"><span>Progresso</span><b>${t.progresso}%</b></div>
          <div class="rna-progress my-1"><span style="width:${t.progresso}%"></span></div>
          <button class="rna-btn ${t.status==='Concluído'?'rna-btn-ghost':'rna-btn-primary'} rna-btn-sm w-100 mt-2 justify-content-center" data-tr="${t.id}">
            ${t.status==='Concluído'?'<i class="bi bi-check2"></i> Concluído':t.status==='Em andamento'?'<i class="bi bi-play-fill"></i> Continuar':'<i class="bi bi-play-fill"></i> Iniciar'}</button>
        </div></div></div>`).join('')}
    </div>`;

  $$('[data-tr]').forEach(b=>b.addEventListener('click',()=>toast('Conteúdo do treinamento — player/LMS integrado na fase 2.', { type:'info' })));
}
const mini=(v,l,ic,icon)=>`<div class="col-6 col-md-3"><div class="rna-stat"><div class="rna-stat__icon ${ic}"><i class="bi ${icon}"></i></div><div class="rna-stat__val" style="font-size:22px">${v}</div><div class="rna-stat__label">${l}</div></div></div>`;
