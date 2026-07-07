/* Checklist Obrigatório — etapa 3 do Fluxo do Auditor */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { estado, checklistItens, hhmm } from '../../../services/fluxo.js';
import { stepper, bloqueio } from '../flow-ui.js';
import { $, $$, toast, modal } from '../ui.js';
import { initEvidenceUpload } from '../evidence.js';

const ctx = await mountShell();
let USER;
if (ctx) { USER = ctx.user; render(); }

async function render() {
  const st = await estado(USER.id);

  if (!st.plantao) {
    $('#rna-content').innerHTML = head(st) + bloqueio('Inicie o plantão primeiro', 'O checklist é liberado após o check-in do plantão.', 'checkin.html', 'Iniciar Plantão');
    return;
  }
  if (!st.rotinaOk) {
    $('#rna-content').innerHTML = head(st) + bloqueio('Conclua a rotina obrigatória', 'Você precisa concluir todos os itens da rotina do dia antes do checklist.', 'rotinas.html', 'Ir para Rotina');
    return;
  }

  const p = st.plantao;
  if (!p.categoria_checklist) { renderEscolha(st); return; }

  const itens = await checklistItens(p.categoria_checklist);
  const ex = (await db.list('checklist_exec')).filter(e => e.plantao_id === p.id);
  const byId = Object.fromEntries(ex.map(e => [e.item_id, e]));

  const grupos = {};
  itens.forEach(i => (grupos[i.categoria] = grupos[i.categoria] || []).push(i));

  const itemHtml = (i) => {
    const e = byId[i.id]; const s = e?.status;
    const cls = s==='OK'?'ok':s==='NOK'?'nok':s==='N/A'?'na':'';
    return `<div class="op-item ${cls}">
      <div class="op-item__main">
        <b>${i.nome}</b>
        <div class="op-item__resp">
          <span><i class="bi bi-arrow-repeat"></i> ${i.frequencia}</span>
          ${e?.hora?`<span style="background:rgba(34,168,90,.14);color:#1c8c4a"><i class="bi bi-clock"></i> ${e.hora}</span>`:''}
          ${s==='NOK'&&e?.justificativa?`<span style="background:rgba(226,59,59,.13);color:#c62f2f" title="${e.justificativa}"><i class="bi bi-exclamation-triangle"></i> ${e.justificativa.slice(0,28)}</span>`:''}
        </div>
      </div>
      <div class="seg-btn" data-item="${i.id}">
        <button class="${s==='OK'?'sel-ok':''}" data-s="OK">OK</button>
        <button class="${s==='NOK'?'sel-nok':''}" data-s="NOK">NOK</button>
        <button class="${s==='N/A'?'sel-na':''}" data-s="N/A">N/A</button>
      </div>
    </div>`;
  };

  const ordem = [p.categoria_checklist, 'Atividades Auditor'];
  const secoes = ordem.filter(c=>grupos[c]).map(c => `
    <div class="rna-card mb-3"><div class="rna-card__head"><h3><i class="bi bi-ui-checks"></i> ${c} <span class="rna-badge badge-info">${grupos[c].length}</span></h3></div>
      <div class="rna-card__body">${grupos[c].map(itemHtml).join('')}</div></div>`).join('');

  $('#rna-content').innerHTML = head(st) + `
    <div class="rna-card mb-3" style="border-left:4px solid ${st.checklistOk?'var(--rna-ok)':'var(--rna-yellow)'}">
      <div class="rna-card__body d-flex flex-wrap align-items-center gap-3">
        <div><span class="rna-badge badge-yellow"><i class="bi bi-box-seam"></i> Categoria: ${p.categoria_checklist}</span>
          <button class="rna-btn rna-btn-ghost rna-btn-sm ms-1" id="btn-trocar"><i class="bi bi-arrow-repeat"></i> Trocar</button></div>
        <div class="flex-fill" style="min-width:180px">
          <div class="d-flex justify-content-between"><b>Respondidos</b><b>${st.chk.respondidos}/${st.chk.total}${st.chk.nok?` · ${st.chk.nok} NOK`:''}</b></div>
          <div class="rna-progress mt-1"><span style="width:${st.chk.pct}%;background:${st.checklistOk?'var(--rna-ok)':'var(--rna-yellow)'}"></span></div>
        </div>
        ${st.checklistOk
          ? `<a href="auditoria.html" class="rna-btn rna-btn-primary rna-btn-lg"><i class="bi bi-search"></i> Liberar Auditoria</a>`
          : `<span class="rna-badge badge-warn"><i class="bi bi-lock"></i> Responda todos os itens</span>`}
      </div>
    </div>
    ${secoes}`;

  $('#btn-trocar')?.addEventListener('click', async () => {
    await db.update('plantoes', p.id, { categoria_checklist:null }); render();
  });

  $$('.seg-btn').forEach(seg => seg.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
    responder(seg.dataset.item, btn.dataset.s, itens, p.id, byId);
  })));
}

function head(st) {
  return `<div class="rna-page-head"><div>
    <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Checklist Obrigatório</div>
    <h1>Checklist Obrigatório</h1><p>Itens da agenda de tarefas — marque OK / NOK / N/A.</p></div></div>
    ${stepper(st, 'checklist')}`;
}

async function renderEscolha(st) {
  const cats = (await db.list('cat_categorias')).filter(c => c.ativo && c.tipo === 'peça');
  $('#rna-content').innerHTML = head(st) + `
    <div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-box-seam"></i> Selecione a categoria/peça do checklist</h3></div>
      <div class="rna-card__body">
        <p class="text-muted-2">O checklist carregará os itens da categoria escolhida + as <b>Atividades Auditor</b> comuns.</p>
        <div class="row g-3">
          ${cats.map(c => `<div class="col-md-4"><button class="rna-card w-100 h-100 cat-pick" data-cat="${c.nome}" style="border:1.5px solid var(--rna-border);cursor:pointer;text-align:center;padding:24px">
            <div class="rna-stat__icon ic-soft-orange mx-auto" style="margin-bottom:10px"><i class="bi bi-box"></i></div>
            <b style="font-size:15px">${c.nome}</b></button></div>`).join('')}
        </div>
      </div></div>`;
  $$('.cat-pick').forEach(b => b.addEventListener('click', async () => {
    await db.update('plantoes', st.plantao.id, { categoria_checklist:b.dataset.cat });
    await db.log({ usuario:USER.nome, acao:`Iniciou checklist (${b.dataset.cat})`, entidade:'checklist', antes:'—', depois:b.dataset.cat });
    render();
  }));
}

async function responder(itemId, status, itens, plantaoId, byId) {
  const item = itens.find(i => i.id === itemId);
  if (status === 'NOK') { nokModal(item, plantaoId, byId); return; }
  await saveResp(itemId, plantaoId, byId, status, '', '');
  render();
}

function nokModal(item, plantaoId, byId) {
  const m = modal({ title:`NOK · ${item.nome}`, size:'',
    content:`<div class="row g-3">
      <div class="col-12"><div class="rna-badge badge-crit mb-1"><i class="bi bi-exclamation-triangle"></i> Item não conforme</div></div>
      <div class="col-12"><label class="form-label text-danger">Justificativa obrigatória *</label><textarea class="form-control" id="nk-just" rows="2" placeholder="Descreva a não conformidade..."></textarea></div>
      <div class="col-12"><label class="form-label">Foto / evidência do problema</label><div id="nk-evid"></div></div>
      <div class="col-12 form-check ms-2"><input class="form-check-input" type="checkbox" id="nk-abrirnc" checked><label class="form-check-label" for="nk-abrirnc">Abrir Não Conformidade automaticamente</label></div>
    </div>`,
    footer:`<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button><button class="rna-btn rna-btn-dark" id="nk-ok"><i class="bi bi-x-octagon"></i> Registrar NOK</button>` });
  const up = initEvidenceUpload($('#nk-evid', m.host), { label:'Foto do problema', accent:'crit', multiple:true });
  $('#nk-ok', m.host).addEventListener('click', async () => {
    const just = $('#nk-just', m.host).value.trim();
    if (!just) return toast('Justificativa é obrigatória para NOK.', { type:'warn' });
    const btn = $('#nk-ok', m.host); btn.disabled = true;
    try {
      const exec = await saveResp(item.id, plantaoId, byId, 'NOK', just, '');
      const evs = await up.commit({ registro_tipo:'checklist', registro_id:exec?.id, usuario:USER });
      if (evs[0]) await db.update('checklist_exec', exec.id, { foto: evs[0].url });
      if ($('#nk-abrirnc', m.host).checked) {
        const nc = await db.insert('nao_conformidades', { codigo:'NC-'+Math.floor(Math.random()*900+500), tipo:'Produto', categoria:item.categoria,
          origem:'Checklist', maquina:'—', linha:'—', area:USER.area, descricao:`${item.nome}: ${just}`, severidade:'Alta',
          responsavel:USER.id, prazo:new Date(Date.now()+86400000).toISOString().slice(0,10), status:'Aberta', abertura:new Date().toISOString().slice(0,10) });
        for (const ev of evs) await db.insert('evidencias', { entidade:'ocorrencia', entidade_id:nc.id, nome:ev.nome, url:ev.url, tipo:ev.tipo, dataHora:ev.dataHora, usuario:USER.nome });
        toast('NOK registrado e Não Conformidade aberta.', { type:'crit', title:'Não conformidade' });
      } else toast('Item NOK registrado.', { type:'warn' });
      m.close(); render();
    } catch { btn.disabled = false; }
  });
}

async function saveResp(itemId, plantaoId, byId, status, justificativa, foto) {
  const item = (await db.list('cat_checklist')).find(i => i.id === itemId);
  const e = byId[itemId];
  const payload = { status, hora:hhmm(), justificativa, foto, categoria:item?.categoria, auditor:USER.id };
  let rec;
  if (e) rec = await db.update('checklist_exec', e.id, payload);
  else rec = await db.insert('checklist_exec', { plantao_id:plantaoId, item_id:itemId, ...payload });
  return rec;
}
