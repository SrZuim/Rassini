/* Documentos & Comunicados */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { can } from '../../../services/config.js';
import { $, $$, toast, modal } from '../ui.js';

const ctx = await mountShell();
let USER;
if (ctx) { USER = ctx.user; render(); }

async function render() {
  const [docs, coms] = await Promise.all([db.list('documentos'), db.list('comunicados')]);
  const podeCriar = can(USER.role,'documentos','create');

  $('#rna-content').innerHTML = `
    <div class="rna-page-head">
      <div><div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Documentos</div>
      <h1>Documentos & Comunicados</h1><p>Procedimentos, normas, instruções e avisos da planta.</p></div>
      ${podeCriar?`<button class="rna-btn rna-btn-primary" id="btn-com"><i class="bi bi-megaphone"></i> Novo comunicado</button>`:''}
    </div>

    <div id="comunicados" class="mb-4">
      <h2 style="font-size:17px;font-weight:700;margin-bottom:12px"><i class="bi bi-megaphone text-yellow"></i> Comunicados</h2>
      <div class="row g-3">
        ${coms.map(c=>`<div class="col-md-6 col-xl-4"><div class="rna-card h-100" style="overflow:hidden">
          <div style="position:relative;height:130px"><img src="${c.img}" style="width:100%;height:100%;object-fit:cover" loading="lazy">
            ${c.fixado?'<span class="rna-badge badge-crit" style="position:absolute;top:10px;left:10px"><i class="bi bi-pin-angle-fill"></i> Fixado</span>':''}
            <span class="rna-badge badge-yellow" style="position:absolute;top:10px;right:10px">${c.tag}</span></div>
          <div class="rna-card__body">
            <h4 style="font-size:14px;font-weight:650;margin:0 0 6px">${c.titulo}</h4>
            <p class="text-muted-2" style="font-size:12.5px">${c.resumo}</p>
            <small class="text-muted-2"><i class="bi bi-person"></i> ${c.autor} · ${c.data.split('-').reverse().join('/')}</small>
          </div></div></div>`).join('')}
      </div>
    </div>

    <h2 style="font-size:17px;font-weight:700;margin-bottom:12px"><i class="bi bi-folder2-open text-yellow"></i> Documentos</h2>
    <div class="rna-card"><div class="rna-card__body p-0">
      <table class="rna-table"><thead><tr><th>Documento</th><th>Tipo</th><th>Área</th><th>Versão</th><th>Atualizado</th><th>Tamanho</th><th></th></tr></thead><tbody>
        ${docs.map(d=>`<tr><td class="cell-strong"><i class="bi bi-file-earmark-text text-yellow"></i> ${d.nome}</td>
          <td><span class="rna-badge badge-info">${d.tipo}</span></td><td>${d.area}</td><td>v${d.versao}</td>
          <td class="cell-sub">${d.data.split('-').reverse().join('/')}</td><td class="cell-sub">${d.tamanho}</td>
          <td class="text-end"><button class="rna-btn rna-btn-ghost rna-btn-sm" data-dl="${d.nome}"><i class="bi bi-download"></i></button></td></tr>`).join('')}
      </tbody></table>
    </div></div>`;

  $$('[data-dl]').forEach(b=>b.addEventListener('click',()=>toast(`Download de “${b.dataset.dl}” — servido via Supabase Storage na integração real.`, { type:'info' })));
  $('#btn-com')?.addEventListener('click', comModal);
  if (location.hash === '#comunicados') document.getElementById('comunicados')?.scrollIntoView();
}

function comModal(){
  const m = modal({ title:'Novo Comunicado', content:`<form class="row g-3">
    <div class="col-12"><label class="form-label">Título</label><input class="form-control" id="cm-tit"></div>
    <div class="col-md-8"><label class="form-label">Resumo</label><input class="form-control" id="cm-res"></div>
    <div class="col-md-4"><label class="form-label">Categoria</label><select class="form-select" id="cm-tag"><option>Segurança</option><option>Qualidade</option><option>Processo</option><option>RH</option></select></div>
  </form>`,
  footer:`<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button><button class="rna-btn rna-btn-primary" id="cm-ok"><i class="bi bi-send"></i> Publicar</button>` });
  $('#cm-ok',m.host).addEventListener('click', async ()=>{
    if(!$('#cm-tit',m.host).value.trim()) return toast('Informe o título.',{type:'warn'});
    await db.insert('comunicados',{ titulo:$('#cm-tit',m.host).value, resumo:$('#cm-res',m.host).value, autor:USER.nome, data:'2026-06-28', tag:$('#cm-tag',m.host).value, img:'assets/rassini/banner-4.jpeg', fixado:false });
    await db.log({ usuario:USER.nome, acao:'Publicou comunicado', entidade:'comunicado', antes:'—', depois:'Publicado' });
    m.close(); toast('Comunicado publicado. Notificação enviada à equipe.', { type:'ok' }); render();
  });
}
