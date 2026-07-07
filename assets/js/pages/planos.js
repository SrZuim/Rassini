/* Plano de Ação (5W2H) vinculado a NC */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { STATUS_PLANO, statusClass, can } from '../../../services/config.js';
import { $, $$, toast, modal } from '../ui.js';
import { initEvidenceUpload } from '../evidence.js';
import { properNome, nomePorId } from '../../../services/funcionarios.js';

const ctx = await mountShell();
let USER, FUNCS=[];
if (ctx) { USER = ctx.user; init(); }

async function init() {
  await render();
  const ncId = new URLSearchParams(location.search).get('nc');
  if (ncId && can(USER.role,'planos','create')) novoModal(ncId);
}

async function render() {
  const [planos, ncs, usuarios, funcionarios] = await Promise.all([db.list('planos_acao'), db.list('nao_conformidades'), db.list('usuarios'), db.list('funcionarios')]);
  FUNCS = funcionarios;
  const podeCriar = can(USER.role,'planos','create');

  $('#rna-content').innerHTML = `
    <div class="rna-page-head">
      <div><div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Plano de Ação</div>
      <h1>Planos de Ação</h1><p>Ações corretivas 5W2H vinculadas às não conformidades, com SLA e histórico.</p></div>
      ${podeCriar?`<button class="rna-btn rna-btn-primary" id="btn-novo"><i class="bi bi-plus-lg"></i> Novo plano</button>`:''}
    </div>
    <div class="row g-3 mb-3">
      ${mini(planos.filter(p=>p.status!=='Concluído').length,'Em aberto','ic-soft-yellow','bi-diagram-3')}
      ${mini(planos.filter(p=>p.status==='Atrasado').length,'Atrasados','ic-soft-red','bi-clock-history')}
      ${mini(planos.filter(p=>p.status==='Concluído').length,'Concluídos','ic-soft-green','bi-check2-all')}
      ${mini(Math.round(planos.reduce((s,p)=>s+p.progresso,0)/(planos.length||1))+'%','Progresso médio','ic-soft-blue','bi-graph-up')}
    </div>
    <div class="row g-3">
      ${planos.map(p=>{
        const nc = ncs.find(n=>n.codigo===p.nc);
        return `<div class="col-md-6 col-xl-4"><div class="rna-card h-100"><div class="rna-card__body">
          <div class="d-flex justify-content-between align-items-start mb-2">
            <div><span class="rna-badge badge-yellow">${p.codigo}</span> <a href="ocorrencias.html" class="rna-badge badge-info">${p.nc}</a></div>
            <span class="rna-badge ${statusClass(p.status)}">${p.status}</span>
          </div>
          <h4 style="font-size:14px;font-weight:650;margin:6px 0 4px">${nc?nc.descricao.slice(0,60)+'…':p.nc}</h4>
          <p class="text-muted-2" style="font-size:12.5px">${p.acao}</p>
          <div class="d-flex justify-content-between" style="font-size:12px"><span>Progresso</span><b>${p.progresso}%</b></div>
          <div class="rna-progress my-1"><span style="width:${p.progresso}%;background:${p.status==='Atrasado'?'var(--rna-crit)':'var(--rna-yellow)'}"></span></div>
          <div class="d-flex justify-content-between align-items-center mt-2" style="font-size:12px">
            <span class="text-muted-2"><i class="bi bi-person"></i> ${nomeUser(usuarios,p.responsavel)}</span>
            <span class="text-muted-2"><i class="bi bi-calendar"></i> ${p.prazo.split('-').reverse().join('/')}</span>
          </div>
          ${podeCriar?`<div class="divider"></div><div class="d-flex gap-2">
            <button class="rna-btn rna-btn-ghost rna-btn-sm flex-fill" data-hist="${p.id}"><i class="bi bi-clock-history"></i> Histórico</button>
            ${p.status!=='Concluído'?`<button class="rna-btn rna-btn-primary rna-btn-sm flex-fill" data-avanca="${p.id}"><i class="bi bi-arrow-up-right"></i> Avançar</button>`:''}
          </div>`:''}
        </div></div></div>`;
      }).join('')}
    </div>`;

  $('#btn-novo')?.addEventListener('click',()=>novoModal());
  $$('[data-avanca]').forEach(b=>b.addEventListener('click',()=>avancar(b.dataset.avanca)));
  $$('[data-hist]').forEach(b=>b.addEventListener('click',()=>historico(b.dataset.hist)));
}

const nomeUser=(us,id)=> nomePorId(FUNCS,id) || us.find(u=>u.id===id)?.nome || '—';
const mini=(v,l,ic,icon)=>`<div class="col-6 col-md-3"><div class="rna-stat"><div class="rna-stat__icon ${ic}"><i class="bi ${icon}"></i></div><div class="rna-stat__val" style="font-size:22px">${v}</div><div class="rna-stat__label">${l}</div></div></div>`;

async function avancar(id){
  const p = await db.get('planos_acao', id);
  const novo = Math.min(100, p.progresso + 25);
  const status = novo===100 ? 'Concluído' : 'Em andamento';
  await db.update('planos_acao', id, { progresso:novo, status });
  await db.log({ usuario:USER.nome, acao:`Avançou plano ${p.codigo} (${novo}%)`, entidade:'plano_acao', antes:p.progresso+'%', depois:novo+'%' });
  if (novo===100) {
    await db.update('nao_conformidades', (await db.list('nao_conformidades')).find(n=>n.codigo===p.nc)?.id, { status:'Resolvida' }).catch(()=>{});
    toast(`Plano ${p.codigo} concluído. NC ${p.nc} marcada como resolvida.`, { type:'ok' });
  } else toast(`Plano ${p.codigo} avançado para ${novo}%.`, { type:'info' });
  render();
}

async function historico(id){
  const p = await db.get('planos_acao', id);
  const logs = (await db.list('logs')).filter(l=>l.acao.includes(p.codigo));
  modal({ title:`Histórico · ${p.codigo}`, content:`
    <div class="rna-timeline">
      <div class="rna-timeline__item"><div class="rna-timeline__time">${p.abertura}</div><div style="font-weight:600">Plano criado</div><small class="text-muted-2">${p.acao}</small></div>
      ${logs.map(l=>`<div class="rna-timeline__item"><div class="rna-timeline__time">${l.quando}</div><div style="font-weight:600">${l.acao}</div><small class="text-muted-2">${l.usuario} · ${l.antes} → ${l.depois}</small></div>`).join('')}
      <div class="rna-timeline__item"><div class="rna-timeline__time">Atual</div><div style="font-weight:600">Status: ${p.status} (${p.progresso}%)</div></div>
    </div>` });
}

async function novoModal(ncId){
  const [ncs, funcionarios] = await Promise.all([db.list('nao_conformidades'), db.list('funcionarios')]);
  const ativos = funcionarios.filter(f=>f.ativo!==false);
  const ncSel = ncId ? ncs.find(n=>n.id===ncId) : null;
  const m = modal({ title:'Novo Plano de Ação (5W2H)', size:'modal-lg', content:`<form class="row g-3">
      <div class="col-md-6"><label class="form-label">NC vinculada</label><select class="form-select" id="pl-nc">
        ${ncs.map(n=>`<option value="${n.codigo}" ${ncSel&&ncSel.codigo===n.codigo?'selected':''}>${n.codigo} · ${n.descricao.slice(0,40)}</option>`).join('')}</select></div>
      <div class="col-md-6"><label class="form-label">Responsável (Who)</label><select class="form-select" id="pl-resp">${ativos.map(f=>`<option value="${f.id}">${properNome(f.nome)}</option>`).join('')}</select></div>
      <div class="col-12"><label class="form-label">Ação proposta (What / How)</label><textarea class="form-control" id="pl-acao" rows="2" placeholder="Descreva a ação corretiva..."></textarea></div>
      <div class="col-md-6"><label class="form-label">Prazo (When)</label><input type="date" class="form-control" id="pl-prazo" value="2026-07-02"></div>
      <div class="col-12"><label class="form-label">Comentários iniciais</label><input class="form-control" id="pl-com" placeholder="Observações"></div>
      <div class="col-12"><label class="form-label">Evidências (fotos)</label><div id="pl-evid"></div></div>
    </form>`,
    footer:`<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button><button class="rna-btn rna-btn-primary" id="pl-ok"><i class="bi bi-check2"></i> Criar plano</button>`
  });
  const up = initEvidenceUpload($('#pl-evid',m.host), { label:'Evidências do plano', multiple:true });
  $('#pl-ok',m.host).addEventListener('click', async ()=>{
    const acao=$('#pl-acao',m.host).value.trim();
    if(!acao) return toast('Descreva a ação proposta.',{type:'warn'});
    const btn=$('#pl-ok',m.host); btn.disabled=true;
    try {
      const nc=$('#pl-nc',m.host).value;
      const plano = await db.insert('planos_acao',{ nc, codigo:'PA-'+nc.replace('NC-',''), responsavel:$('#pl-resp',m.host).value,
        prazo:$('#pl-prazo',m.host).value, acao, status:'Em andamento', progresso:10, abertura:'2026-06-28' });
      await up.commit({ registro_tipo:'plano', registro_id:plano.id, usuario:USER });
      await db.update('nao_conformidades', ncs.find(n=>n.codigo===nc)?.id, { status:'Em andamento' }).catch(()=>{});
      await db.log({ usuario:USER.nome, acao:`Criou plano para ${nc}`, entidade:'plano_acao', antes:'—', depois:'Em andamento' });
      m.close(); toast('Plano de ação criado e vinculado à NC.', { type:'ok' });
      history.replaceState(null,'','planos-acao.html'); render();
    } catch { btn.disabled=false; }
  });
}
