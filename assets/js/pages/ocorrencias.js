/* Não Conformidades */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { STATUS_NC, SEVERIDADES, NC_TIPOS, NC_CATEGORIAS, NC_ORIGENS, SLA_HORAS, statusClass, sevColor, can } from '../../../services/config.js';
import { $, $$, toast, modal } from '../ui.js';
import { initEvidenceUpload } from '../evidence.js';
import { properNome, nomePorId } from '../../../services/funcionarios.js';

const ctx = await mountShell();
let USER, FILTRO='Todas', FUNCS=[];
if (ctx) { USER = ctx.user; render(); }

async function render() {
  const [ncs, maquinas, usuarios, planos, funcionarios] = await Promise.all([
    db.list('nao_conformidades'), db.list('maquinas'), db.list('usuarios'), db.list('planos_acao'), db.list('funcionarios')
  ]);
  FUNCS = funcionarios;
  const filtered = FILTRO==='Todas'? ncs : ncs.filter(n=>n.status===FILTRO);
  const podeCriar = can(USER.role,'ocorrencias','create');

  $('#rna-content').innerHTML = `
    <div class="rna-page-head">
      <div><div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Não Conformidades</div>
      <h1>Não Conformidades</h1><p>Abertura, classificação e tratativa com plano de ação.</p></div>
      ${podeCriar?`<button class="rna-btn rna-btn-primary" id="btn-nc"><i class="bi bi-plus-lg"></i> Nova NC</button>`:''}
    </div>
    <div class="row g-3 mb-3">
      ${mini(ncs.filter(n=>n.status==='Aberta').length,'Abertas','ic-soft-red','bi-exclamation-octagon')}
      ${mini(ncs.filter(n=>['Em análise','Em andamento'].includes(n.status)).length,'Em tratativa','ic-soft-orange','bi-arrow-repeat')}
      ${mini(ncs.filter(n=>n.severidade==='Crítica'&&!['Resolvida','Encerrada'].includes(n.status)).length,'Críticas ativas','ic-soft-red','bi-cone-striped')}
      ${mini(ncs.filter(n=>['Resolvida','Encerrada'].includes(n.status)).length,'Resolvidas','ic-soft-green','bi-check2-circle')}
    </div>
    <div class="d-flex flex-wrap gap-2 mb-3">
      ${['Todas',...STATUS_NC].map(s=>`<button class="rna-chip ${s===FILTRO?'active':''}" data-f="${s}">${s}</button>`).join('')}
    </div>
    <div class="rna-card"><div class="rna-card__body p-0">
      <table class="rna-table"><thead><tr><th>Código</th><th>Descrição</th><th>Máquina</th><th>Severidade</th><th>Responsável</th><th>Prazo</th><th>Status</th><th></th></tr></thead><tbody>
      ${filtered.map(n=>{
        const temPlano = planos.some(p=>p.nc===n.codigo);
        return `<tr><td class="cell-strong">${n.codigo}<div class="cell-sub">${n.tipo} · ${n.origem}</div></td>
        <td style="max-width:260px"><div style="font-size:13px">${n.descricao}</div><div class="cell-sub">${n.area}</div></td>
        <td>${n.maquina}</td>
        <td><span class="rna-badge" style="background:${sevColor(n.severidade)}22;color:${sevColor(n.severidade)}"><span class="sev-dot" style="background:${sevColor(n.severidade)}"></span> ${n.severidade}</span></td>
        <td>${nome(usuarios,n.responsavel)}</td>
        <td class="cell-sub">${n.prazo.split('-').reverse().join('/')}<div style="font-size:10px;color:var(--rna-gray)">SLA ${SLA_HORAS[n.severidade]}h</div></td>
        <td><span class="rna-badge ${statusClass(n.status)}">${n.status}</span></td>
        <td class="text-end"><div class="d-flex gap-1 justify-content-end">
          <button class="rna-btn rna-btn-ghost rna-btn-sm" data-ver="${n.id}"><i class="bi bi-eye"></i></button>
          ${temPlano?`<a class="rna-btn rna-btn-ghost rna-btn-sm" href="planos-acao.html" title="Plano vinculado"><i class="bi bi-diagram-3 text-yellow"></i></a>`
            : (can(USER.role,'planos','create')?`<button class="rna-btn rna-btn-dark rna-btn-sm" data-plano="${n.id}"><i class="bi bi-plus"></i> Plano</button>`:'')}
        </div></td></tr>`;
      }).join('')}
      </tbody></table>
    </div></div>`;

  $$('.rna-chip').forEach(c=>c.addEventListener('click',()=>{FILTRO=c.dataset.f;render();}));
  $$('[data-ver]').forEach(b=>b.addEventListener('click',()=>verNC(b.dataset.ver)));
  $$('[data-plano]').forEach(b=>b.addEventListener('click',()=>criarPlano(b.dataset.plano)));
  $('#btn-nc')?.addEventListener('click',()=>novaModal(maquinas,funcionarios));
}

const nome=(us,id)=> nomePorId(FUNCS,id) || us.find(u=>u.id===id)?.nome || '—';
const mini=(v,l,ic,icon)=>`<div class="col-6 col-md-3"><div class="rna-stat"><div class="rna-stat__icon ${ic}"><i class="bi ${icon}"></i></div><div class="rna-stat__val" style="font-size:22px">${v}</div><div class="rna-stat__label">${l}</div></div></div>`;

async function verNC(id){
  const n = await db.get('nao_conformidades', id);
  modal({ title:`${n.codigo} · ${n.tipo}`, size:'modal-lg', content:`
    <div class="row g-2" style="font-size:13px">
      <div class="col-md-8"><label class="form-label">Descrição</label><div class="rna-card"><div class="rna-card__body py-2">${n.descricao}</div></div></div>
      <div class="col-md-4"><label class="form-label">Severidade</label><div><span class="rna-badge" style="background:${sevColor(n.severidade)}22;color:${sevColor(n.severidade)}">${n.severidade}</span></div>
        <label class="form-label mt-2">Status</label><div><span class="rna-badge ${statusClass(n.status)}">${n.status}</span></div></div>
      <div class="col-md-3"><label class="form-label">Categoria</label><div>${n.categoria}</div></div>
      <div class="col-md-3"><label class="form-label">Origem</label><div>${n.origem}</div></div>
      <div class="col-md-3"><label class="form-label">Máquina</label><div>${n.maquina}</div></div>
      <div class="col-md-3"><label class="form-label">Prazo</label><div>${n.prazo.split('-').reverse().join('/')}</div></div>
    </div>` });
}

function criarPlano(ncId){ location.href = 'planos-acao.html?nc='+ncId; }

function novaModal(maquinas, funcionarios){
  const sel=(id,opts)=>`<select class="form-select" id="${id}">${opts.map(o=>`<option>${o}</option>`).join('')}</select>`;
  const ativos = (funcionarios||[]).filter(f=>f.ativo!==false);
  const m = modal({ title:'Nova Não Conformidade', size:'modal-lg', content:`<form class="row g-3">
      <div class="col-md-4"><label class="form-label">Tipo</label>${sel('nc-tipo',NC_TIPOS)}</div>
      <div class="col-md-4"><label class="form-label">Categoria</label>${sel('nc-cat',NC_CATEGORIAS)}</div>
      <div class="col-md-4"><label class="form-label">Origem</label>${sel('nc-org',NC_ORIGENS)}</div>
      <div class="col-md-6"><label class="form-label">Máquina</label><select class="form-select" id="nc-maq">${maquinas.map(x=>`<option value="${x.tag}">${x.tag} · ${x.nome}</option>`).join('')}</select></div>
      <div class="col-md-6"><label class="form-label">Linha</label><input class="form-control" id="nc-linha" placeholder="Linha"></div>
      <div class="col-12"><label class="form-label">Descrição *</label><textarea class="form-control" id="nc-desc" rows="2"></textarea></div>
      <div class="col-md-4"><label class="form-label">Severidade</label>${sel('nc-sev',SEVERIDADES)}</div>
      <div class="col-md-4"><label class="form-label">Responsável</label><select class="form-select" id="nc-resp">${ativos.map(f=>`<option value="${f.id}">${properNome(f.nome)}</option>`).join('')}</select></div>
      <div class="col-md-4"><label class="form-label">Prazo</label><input type="date" class="form-control" id="nc-prazo" value="2026-06-30"></div>
      <div class="col-12"><label class="form-label">Fotos / evidências</label><div id="nc-evid"></div></div>
    </form>`,
    footer:`<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button><button class="rna-btn rna-btn-primary" id="nc-ok"><i class="bi bi-check2"></i> Abrir NC</button>`
  });
  const up = initEvidenceUpload($('#nc-evid',m.host), { label:'Fotos da não conformidade', multiple:true });
  $('#nc-ok',m.host).addEventListener('click', async ()=>{
    const desc=$('#nc-desc',m.host).value.trim();
    if(!desc) return toast('Descrição é obrigatória.',{type:'warn'});
    const btn=$('#nc-ok',m.host); btn.disabled=true;
    try {
      const sev=$('#nc-sev',m.host).value;
      const nc = await db.insert('nao_conformidades',{ codigo:'NC-'+Math.floor(Math.random()*900+460), tipo:$('#nc-tipo',m.host).value, categoria:$('#nc-cat',m.host).value,
        origem:$('#nc-org',m.host).value, maquina:$('#nc-maq',m.host).value, linha:$('#nc-linha',m.host).value||'—', descricao:desc, severidade:sev,
        responsavel:$('#nc-resp',m.host).value, prazo:$('#nc-prazo',m.host).value, status:'Aberta', abertura:'2026-06-28', area:USER.area });
      await up.commit({ registro_tipo:'ocorrencia', registro_id:nc.id, usuario:USER });
      await db.log({ usuario:USER.nome, acao:'Abriu não conformidade', entidade:'nao_conformidade', antes:'—', depois:'Aberta' });
      m.close();
      toast(`NC aberta (${sev}). ${sev==='Crítica'?'Notificação Andon disparada.':''}`, { type:sev==='Crítica'?'crit':'ok', title:'Não conformidade' });
      render();
    } catch { btn.disabled=false; }
  });
}
