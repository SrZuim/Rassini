/* Check-in do Plantão — hub do Fluxo do Auditor */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { TURNOS, PLANTAS } from '../../../services/config.js';
import { estado, hhmm, nowISO } from '../../../services/fluxo.js';
import { stepper } from '../flow-ui.js';
import { $, $$, toast, initials } from '../ui.js';
import { AREA_SUPERVISOR, porArea, properNome } from '../../../services/funcionarios.js';

const ctx = await mountShell();
if (ctx) render(ctx.user);

async function render(user) {
  const st = await estado(user.id);
  const funcionarios = await db.list('funcionarios');
  const supervisores = porArea(funcionarios, AREA_SUPERVISOR).map(f => properNome(f.nome));
  const now = new Date();

  let body;
  if (!st.plantao) {
    body = `
    <div class="row g-3">
      <div class="col-lg-8">
        <div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-box-arrow-in-right"></i> Iniciar Plantão</h3></div>
          <div class="rna-card__body">
            <form id="form-checkin" class="row g-3">
              <div class="col-md-6"><label class="form-label">Nome do auditor *</label><input class="form-control" value="${user.nome}" disabled></div>
              <div class="col-md-6"><label class="form-label">Turno *</label>${sel('f-turno', TURNOS)}</div>
              <div class="col-md-6"><label class="form-label">Data</label><input class="form-control" type="date" value="${now.toISOString().slice(0,10)}" id="f-data" readonly></div>
              <div class="col-md-6"><label class="form-label">Horário de início</label><input class="form-control" value="${hhmm(now)}" id="f-hora" readonly></div>
              <div class="col-md-6"><label class="form-label">Planta</label>${sel('f-planta', PLANTAS)}</div>
              <div class="col-md-6"><label class="form-label">Supervisor</label>${sel('f-sup', supervisores)}</div>
              <div class="col-md-6"><label class="form-label">Dispositivo</label>${sel('f-disp', ['Tablet RNA-T07','Coletor RNA-C12','Desktop SUP-02','Smartphone corporativo'])}</div>
              <div class="col-md-6"><label class="form-label">Status do plantão</label><input class="form-control" value="Em andamento" disabled></div>
              <div class="col-12 pt-2">
                <button type="submit" class="rna-btn rna-btn-primary rna-btn-xl"><i class="bi bi-play-fill"></i> Iniciar Plantão e liberar Rotina</button>
              </div>
            </form>
          </div></div>
      </div>
      <div class="col-lg-4">
        <div class="rna-card"><div class="rna-card__body text-center">
          <img src="assets/rassini/fabrica.jpeg" class="w-100 rounded-3 mb-3" style="height:120px;object-fit:cover">
          <div class="rna-avatar mx-auto mb-2" style="width:54px;height:54px;font-size:18px">${initials(user.nome)}</div>
          <h4 style="font-size:15px;margin:0">${user.nome}</h4><small class="text-muted-2">${user.matricula} · ${user.area}</small>
          <div class="divider"></div>
          <p class="text-muted-2 text-start" style="font-size:12.5px;margin:0">Ao iniciar o plantão, o sistema libera a <b>Rotina Obrigatória</b> do dia. As etapas seguem ordem fixa e não podem ser puladas.</p>
        </div></div>
      </div>
    </div>`;
  } else {
    const p = st.plantao;
    body = `
    <div class="rna-card mb-3" style="border-left:4px solid var(--rna-ok)">
      <div class="rna-card__body d-flex flex-wrap align-items-center gap-3">
        <div class="rna-stat__icon ic-soft-green" style="margin:0"><i class="bi bi-broadcast"></i></div>
        <div class="flex-fill"><h3 style="margin:0;font-size:16px">Plantão em andamento</h3>
          <small class="text-muted-2">${p.turno} · iniciado ${p.hora} · ${p.planta||''}</small></div>
        <span class="rna-badge badge-ok"><i class="bi bi-circle-fill"></i> Aberto</span>
        <button class="rna-btn rna-btn-dark" id="btn-encerrar"><i class="bi bi-stop-fill"></i> Encerrar</button>
      </div>
    </div>
    <div class="row g-3 mb-3">
      ${prog('Rotina Obrigatória','bi-list-check', st.rot.pct, `${st.rot.concluidas}/${st.rot.total} itens`, st.rotinaOk, 'rotinas.html')}
      ${prog('Checklist Obrigatório','bi-ui-checks', st.chk.pct, p.categoria_checklist?`${st.chk.respondidos}/${st.chk.total} · ${p.categoria_checklist}`:'Escolher categoria', st.checklistOk, 'checklist.html')}
      ${prog('Auditoria de Peças','bi-search', st.auditoriaLiberada?100:0, st.auditoriaLiberada?'Liberada':'Bloqueada', false, st.auditoriaLiberada?'auditoria.html':'#')}
    </div>
    <div class="rna-card"><div class="rna-card__body text-center" style="padding:26px">
      ${st.auditoriaLiberada
        ? `<i class="bi bi-unlock-fill" style="font-size:40px;color:var(--rna-ok)"></i><h3 style="margin:12px 0 4px">Tudo pronto!</h3><p class="text-muted-2">Rotina e checklist concluídos. A página de Auditoria está liberada.</p><a href="auditoria.html" class="rna-btn rna-btn-primary rna-btn-lg"><i class="bi bi-search"></i> Ir para Auditoria</a>`
        : !st.rotinaOk
          ? `<i class="bi bi-arrow-right-circle" style="font-size:40px;color:var(--rna-yellow-600)"></i><h3 style="margin:12px 0 4px">Próxima etapa: Rotina</h3><p class="text-muted-2">Conclua a rotina obrigatória do dia para liberar o checklist.</p><a href="rotinas.html" class="rna-btn rna-btn-primary rna-btn-lg"><i class="bi bi-list-check"></i> Realizar Rotina</a>`
          : `<i class="bi bi-arrow-right-circle" style="font-size:40px;color:var(--rna-yellow-600)"></i><h3 style="margin:12px 0 4px">Próxima etapa: Checklist</h3><p class="text-muted-2">Conclua o checklist obrigatório para liberar a auditoria.</p><a href="checklist.html" class="rna-btn rna-btn-primary rna-btn-lg"><i class="bi bi-ui-checks"></i> Realizar Checklist</a>`}
    </div></div>`;
  }

  $('#rna-content').innerHTML = `
    <div class="rna-page-head"><div>
      <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Fluxo do Auditor</div>
      <h1>Check-in do Plantão</h1><p>Plantão → Rotina → Checklist → Auditoria</p></div>
    </div>
    ${stepper(st, 'plantao')}
    ${body}`;

  $('#form-checkin')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const reg = { usuario:user.id, usuario_nome:user.nome, data:$('#f-data').value, hora:$('#f-hora').value,
      turno:$('#f-turno').value, planta:$('#f-planta').value, supervisor:$('#f-sup').value,
      dispositivo:$('#f-disp').value, categoria_checklist:null, status:'Aberto', inicio_iso:nowISO() };
    await db.insert('plantoes', reg);
    await db.log({ usuario:user.nome, acao:`Iniciou plantão (${reg.turno})`, entidade:'plantao', antes:'—', depois:'Aberto' });
    toast('Plantão iniciado! Rotina obrigatória liberada.', { type:'ok', title:'Check-in' });
    render(user);
  });

  $('#btn-encerrar')?.addEventListener('click', async () => {
    const { confirmDialog } = await import('../ui.js');
    confirmDialog('Encerrar o plantão atual?', async () => {
      await db.update('plantoes', st.plantao.id, { status:'Encerrado', fim_iso:nowISO() });
      await db.log({ usuario:user.nome, acao:'Encerrou plantão', entidade:'plantao', antes:'Aberto', depois:'Encerrado' });
      toast('Plantão encerrado.', { type:'ok' }); render(user);
    }, { title:'Encerrar plantão', okLabel:'Encerrar', danger:true });
  });
}

const sel = (id, opts) => `<select class="form-select" id="${id}">${opts.map(o=>`<option>${o}</option>`).join('')}</select>`;
function prog(titulo, icon, pct, sub, done, href) {
  return `<div class="col-md-4"><a href="${href}" class="rna-card h-100" style="display:block;text-decoration:none;color:inherit">
    <div class="rna-card__body">
      <div class="d-flex justify-content-between align-items-start mb-2">
        <div class="rna-stat__icon ${done?'ic-soft-green':'ic-soft-yellow'}" style="margin:0"><i class="bi ${icon}"></i></div>
        ${done?'<span class="rna-badge badge-ok"><i class="bi bi-check-lg"></i> OK</span>':`<span class="rna-badge badge-warn">${pct}%</span>`}
      </div>
      <b style="font-size:14px">${titulo}</b>
      <div class="text-muted-2" style="font-size:12px;margin:2px 0 8px">${sub}</div>
      <div class="rna-progress"><span style="width:${pct}%;background:${done?'var(--rna-ok)':'var(--rna-yellow)'}"></span></div>
    </div></a></div>`;
}
