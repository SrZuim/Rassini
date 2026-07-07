/* Diário de Bordo */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { can } from '../../../services/config.js';
import { $, $$, toast, modal } from '../ui.js';

const ctx = await mountShell();
let USER;
if (ctx) { USER = ctx.user; render(); }

async function render() {
  const ats = (await db.list('atividades')).filter(a => a.auditor === USER.id || USER.role !== 'auditor');
  const total = ats.reduce((s,a)=>s+(a.tempo||0),0);
  const excedidas = ats.filter(a => a.tempo > a.tempo_padrao).length;
  const podeCriar = can(USER.role, 'diario', 'create');

  $('#rna-content').innerHTML = `
    <div class="rna-page-head">
      <div><div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Diário</div>
      <h1>Diário de Bordo</h1><p>Registro cronológico das atividades do plantão.</p></div>
      ${podeCriar?`<button class="rna-btn rna-btn-primary" id="btn-nova"><i class="bi bi-plus-lg"></i> Nova atividade</button>`:''}
    </div>
    <div class="row g-3 mb-3">
      ${mini(ats.length,'Atividades registradas','ic-soft-blue','bi-journal-text')}
      ${mini(total+' min','Tempo total','ic-soft-yellow','bi-stopwatch')}
      ${mini(excedidas,'Tempo excedido','ic-soft-red','bi-exclamation-triangle')}
      ${mini(ats.filter(a=>a.resultado==='Conforme').length,'Conformes','ic-soft-green','bi-check2-circle')}
    </div>
    <div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-clock-history"></i> Linha do tempo · 28/06/2026</h3></div>
      <div class="rna-card__body">
        <div class="rna-timeline">
          ${ats.length ? ats.map(item).join('') : '<div class="empty-state"><i class="bi bi-journal"></i><div>Nenhuma atividade registrada.</div></div>'}
        </div>
      </div></div>`;

  $('#btn-nova')?.addEventListener('click', novaModal);
}

function item(a) {
  const excedeu = a.tempo > a.tempo_padrao;
  const resCls = a.resultado==='Conforme'?'badge-ok':a.resultado==='Atenção'?'badge-warn':a.resultado==='Em execução'?'badge-info':'badge-crit';
  return `<div class="rna-timeline__item ${excedeu?'crit':''}">
    <div class="d-flex justify-content-between flex-wrap gap-2">
      <div>
        <span class="rna-timeline__time"><i class="bi bi-clock"></i> ${a.inicio} ${a.fim?'– '+a.fim:''}</span>
        <div style="font-weight:650;font-size:14px;margin-top:2px">${a.rotina} · ${a.maquina}</div>
        <div class="text-muted-2" style="font-size:12.5px">Peça: ${a.peca} · Qtd: ${a.quantidade} ${a.obs?'· '+a.obs:''}</div>
        ${a.justificativa?`<div class="mt-1" style="font-size:12px;color:var(--rna-crit)"><i class="bi bi-info-circle"></i> Justificativa: ${a.justificativa}</div>`:''}
      </div>
      <div class="text-end">
        <span class="rna-badge ${resCls}">${a.resultado}</span>
        <div style="font-size:12px;margin-top:4px" class="${excedeu?'text-danger':'text-muted-2'}">
          <i class="bi bi-stopwatch"></i> ${a.tempo||0}/${a.tempo_padrao} min ${excedeu?'(excedido)':''}</div>
      </div>
    </div></div>`;
}

function novaModal() {
  const m = modal({ title:'Nova atividade · Diário de Bordo', size:'modal-lg',
    content:`<form class="row g-3">
      <div class="col-md-4"><label class="form-label">Início</label><input type="time" class="form-control" id="d-ini"></div>
      <div class="col-md-4"><label class="form-label">Fim</label><input type="time" class="form-control" id="d-fim"></div>
      <div class="col-md-4"><label class="form-label">Tempo padrão (min)</label><input type="number" class="form-control" id="d-pad" value="15"></div>
      <div class="col-md-6"><label class="form-label">Máquina</label><input class="form-control" id="d-maq" placeholder="Ex.: PR-1450"></div>
      <div class="col-md-6"><label class="form-label">Peça</label><input class="form-control" id="d-peca" placeholder="Ex.: Mola parabólica"></div>
      <div class="col-md-4"><label class="form-label">Quantidade</label><input type="number" class="form-control" id="d-qtd" value="0"></div>
      <div class="col-md-8"><label class="form-label">Resultado</label><select class="form-select" id="d-res"><option>Conforme</option><option>Atenção</option><option>Não conforme</option></select></div>
      <div class="col-12"><label class="form-label">Observação</label><textarea class="form-control" id="d-obs" rows="2"></textarea></div>
      <div id="d-just-zone" class="col-12" style="display:none"><label class="form-label text-danger">Justificativa (tempo excedido) *</label><textarea class="form-control" id="d-just" rows="2"></textarea></div>
    </form>`,
    footer:`<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button><button class="rna-btn rna-btn-primary" id="d-ok"><i class="bi bi-check2"></i> Registrar</button>`
  });
  const calc = () => {
    const i=$('#d-ini',m.host).value, f=$('#d-fim',m.host).value;
    if(!i||!f) return 0;
    const [ih,im]=i.split(':').map(Number),[fh,fm]=f.split(':').map(Number);
    const t=(fh*60+fm)-(ih*60+im);
    $('#d-just-zone',m.host).style.display = (t > +$('#d-pad',m.host).value) ? 'block':'none';
    return t;
  };
  ['#d-ini','#d-fim','#d-pad'].forEach(s=>$(s,m.host).addEventListener('input',calc));
  $('#d-ok',m.host).addEventListener('click', async () => {
    const t = calc();
    if (t > +$('#d-pad',m.host).value && !$('#d-just',m.host).value.trim()) return toast('Justificativa obrigatória: tempo excedido.', { type:'warn' });
    await db.insert('atividades', { rotina:'RT-AVU', maquina:$('#d-maq',m.host).value||'—', peca:$('#d-peca',m.host).value||'—',
      quantidade:+$('#d-qtd',m.host).value, inicio:$('#d-ini',m.host).value, fim:$('#d-fim',m.host).value, tempo:t, tempo_padrao:+$('#d-pad',m.host).value,
      resultado:$('#d-res',m.host).value, obs:$('#d-obs',m.host).value, justificativa:(t>+$('#d-pad',m.host).value)?$('#d-just',m.host).value:null, auditor:USER.id });
    await db.log({ usuario:USER.nome, acao:'Registrou atividade no diário', entidade:'atividade', antes:'—', depois:'Registrada' });
    m.close(); toast('Atividade registrada no diário de bordo.', { type:'ok' }); render();
  });
}

const mini = (v,l,ic,icon) => `<div class="col-6 col-md-3"><div class="rna-stat"><div class="rna-stat__icon ${ic}"><i class="bi ${icon}"></i></div><div class="rna-stat__val" style="font-size:22px">${v}</div><div class="rna-stat__label">${l}</div></div></div>`;
