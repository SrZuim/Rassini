/* Auditoria de Peças — etapa 4 do Fluxo do Auditor */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { estado, calcAuditoria, nowISO, hhmm } from '../../../services/fluxo.js';
import { stepper, bloqueio } from '../flow-ui.js';
import { $, $$, toast, modal } from '../ui.js';
import { initEvidenceUpload } from '../evidence.js';

const ctx = await mountShell();
let USER, TIMER;
if (ctx) { USER = ctx.user; render(); }

async function render() {
  const st = await estado(USER.id);

  if (!st.plantao || !st.rotinaOk || !st.checklistOk) {
    const faltam = !st.plantao ? ['checkin.html','Iniciar Plantão','Inicie o plantão para acessar a auditoria.']
      : !st.rotinaOk ? ['rotinas.html','Ir para Rotina','Conclua a rotina obrigatória antes da auditoria.']
      : ['checklist.html','Ir para Checklist','Conclua o checklist obrigatório para liberar a auditoria.'];
    $('#rna-content').innerHTML = head(st) + bloqueio('Auditoria bloqueada', faltam[2], faltam[0], faltam[1]);
    return;
  }

  const [pecas, tipos, todas] = await Promise.all([
    db.list('cat_pecas'), db.list('cat_tipos_auditoria'), db.list('auditorias_peca')
  ]);
  const minhas = todas.filter(a => a.plantao_id === st.plantao.id);
  const emAndamento = minhas.find(a => a.status === 'Em andamento');
  const pecasAtivas = pecas.filter(p => p.ativo);

  $('#rna-content').innerHTML = head(st) + `
    <div class="row g-3 mb-3">
      ${kpi(minhas.length,'Auditorias no plantão','ic-soft-blue','bi-search')}
      ${kpi(minhas.filter(a=>a.status==='Finalizada').length,'Finalizadas','ic-soft-green','bi-check2-circle')}
      ${kpi(minhas.filter(a=>a.excedeu).length,'Acima do tempo','ic-soft-red','bi-stopwatch')}
      ${kpi(minhas.filter(a=>a.status==='Com ocorrência').length,'Com ocorrência','ic-soft-orange','bi-exclamation-octagon')}
    </div>
    <div class="row g-3">
      <div class="col-lg-5">
        <div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-search"></i> ${emAndamento?'Auditoria em andamento':'Nova auditoria de peça'}</h3></div>
          <div class="rna-card__body" id="audit-panel"></div></div>
      </div>
      <div class="col-lg-7">
        <div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-list-ul"></i> Auditorias do plantão</h3></div>
          <div class="rna-card__body p-0">${tabela(minhas)}</div></div>
      </div>
    </div>`;

  if (emAndamento) painelAndamento(emAndamento);
  else painelNova(pecasAtivas, tipos.filter(t=>t.ativo), st.plantao.id);
}

function head(st) {
  return `<div class="rna-page-head"><div>
    <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Auditoria de Peças</div>
    <h1>Auditoria de Peças</h1><p>O auditor trabalha por peça — inicie, finalize e registre o tempo.</p></div></div>
    ${stepper(st, 'auditoria')}`;
}

function painelNova(pecas, tipos, plantaoId) {
  $('#audit-panel').innerHTML = `
    <div class="row g-3">
      <div class="col-12"><label class="form-label">Auditor</label><input class="form-control" value="${USER.nome}" disabled></div>
      <div class="col-12"><label class="form-label">Peça auditada *</label>
        <select class="form-select" id="a-peca">${pecas.map(p=>`<option value="${p.id}" data-cod="${p.codigo}" data-tm="${p.tempo_medio}">${p.nome} — tempo médio ${p.tempo_medio} min</option>`).join('')}</select></div>
      <div class="col-md-6"><label class="form-label">Código da peça</label><input class="form-control" id="a-cod" readonly></div>
      <div class="col-md-6"><label class="form-label">OP / Lote</label><input class="form-control" id="a-op" placeholder="Ex.: OP-12345"></div>
      <div class="col-12"><label class="form-label">Tipo de auditoria</label><select class="form-select" id="a-tipo">${tipos.map(t=>`<option>${t.nome}</option>`).join('')}</select></div>
      <div class="col-12 pt-1"><button class="rna-btn rna-btn-primary rna-btn-xl" id="a-iniciar"><i class="bi bi-play-fill"></i> Iniciar Auditoria</button></div>
    </div>`;
  const peca = $('#a-peca'), cod = $('#a-cod');
  const setCod = () => { cod.value = peca.selectedOptions[0].dataset.cod; };
  setCod(); peca.addEventListener('change', setCod);
  $('#a-iniciar').addEventListener('click', async () => {
    const opt = peca.selectedOptions[0];
    const reg = await db.insert('auditorias_peca', {
      plantao_id:plantaoId, auditor:USER.id, auditor_nome:USER.nome,
      peca:opt.text.split(' — ')[0], peca_id:peca.value, codigo:cod.value, op_lote:$('#a-op').value||'—',
      tipo:$('#a-tipo').value, inicio_iso:nowISO(), inicio:hhmm(), fim:null, fim_iso:null,
      tempo_total:null, tempo_medio:+opt.dataset.tm, status:'Em andamento', excedeu:false, motivo_atraso:null, justificativa:null, obs:''
    });
    await db.log({ usuario:USER.nome, acao:`Iniciou auditoria de ${reg.peca}`, entidade:'auditoria_peca', antes:'—', depois:'Em andamento' });
    toast(`Auditoria iniciada: ${reg.peca}`, { type:'info' }); render();
  });
}

function painelAndamento(a) {
  const startMs = new Date(a.inicio_iso).getTime();
  $('#audit-panel').innerHTML = `
    <div class="text-center mb-3">
      <div class="rna-badge badge-info mb-2"><i class="bi bi-broadcast"></i> Em andamento</div>
      <div class="audit-timer" id="a-timer">00:00</div>
      <small class="text-muted-2">Tempo médio da peça: <b>${a.tempo_medio} min</b></small>
    </div>
    <div class="op-item" style="margin-bottom:14px"><div class="op-item__main">
      <b>${a.peca}</b><div class="op-item__resp"><span>${a.codigo}</span><span>${a.op_lote}</span><span>${a.tipo}</span><span><i class="bi bi-clock"></i> início ${a.inicio}</span></div>
    </div></div>
    <button class="rna-btn rna-btn-dark rna-btn-xl" id="a-finalizar"><i class="bi bi-stop-fill"></i> Finalizar Auditoria</button>`;

  const tEl = $('#a-timer');
  const tick = () => {
    const sec = Math.floor((Date.now() - startMs) / 1000);
    const mm = String(Math.floor(sec/60)).padStart(2,'0'), ss = String(sec%60).padStart(2,'0');
    tEl.textContent = `${mm}:${ss}`;
    tEl.classList.toggle('over', sec/60 > a.tempo_medio || sec > 3600);
  };
  clearInterval(TIMER); tick(); TIMER = setInterval(tick, 1000);

  $('#a-finalizar').addEventListener('click', () => finalizar(a));
}

function finalizar(a) {
  clearInterval(TIMER);
  const fimISO = nowISO();
  const calc = calcAuditoria(a.inicio_iso, fimISO, a.tempo_medio);
  const precisaMotivo = calc.excedeu;

  modalFinal(a, fimISO, calc, precisaMotivo);
}

async function modalFinal(a, fimISO, calc, precisaMotivo) {
  const motivos = (await db.list('cat_motivos_atraso')).filter(m=>m.ativo);
  const m = modal({ title:`Finalizar · ${a.peca}`, content:`
    <div class="text-center mb-3">
      <div class="audit-timer ${precisaMotivo?'over':''}">${String(Math.floor(calc.tempo_total/60)).padStart(2,'0')}:${String(calc.tempo_total%60).padStart(2,'0')}<span style="font-size:16px;font-weight:500"> </span></div>
      <small class="text-muted-2">Tempo total: <b>${calc.tempo_total} min</b> · Tempo médio: ${a.tempo_medio} min</small>
    </div>
    ${precisaMotivo?`<div class="rna-card" style="background:#fdf6f6;border-color:var(--rna-crit)"><div class="rna-card__body py-2">
      <div style="color:var(--rna-crit);font-weight:600;font-size:13px"><i class="bi bi-exclamation-triangle-fill"></i> Você demorou mais que o tempo médio esperado para essa auditoria. Informe o motivo.</div></div></div>`:''}
    <div class="row g-3 mt-1">
      ${precisaMotivo?`<div class="col-12"><label class="form-label text-danger">Motivo do atraso *</label>
        <select class="form-select" id="f-motivo">${motivos.map(x=>`<option>${x.nome}</option>`).join('')}</select></div>
        <div class="col-12"><label class="form-label text-danger">Justificativa *</label><textarea class="form-control" id="f-just" rows="2"></textarea></div>`:''}
      <div class="col-12"><label class="form-label">Resultado</label><select class="form-select" id="f-result"><option>Conforme</option><option>Com ocorrência (NC)</option></select></div>
      <div class="col-12"><label class="form-label">Observações</label><textarea class="form-control" id="f-obs" rows="2"></textarea></div>
      <div class="col-12"><label class="form-label">Evidência (foto)</label><div id="f-evid"></div></div>
    </div>`,
    footer:`<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Voltar</button><button class="rna-btn rna-btn-primary" id="f-ok"><i class="bi bi-check2"></i> Finalizar</button>` });

  const up = initEvidenceUpload($('#f-evid', m.host), { label:'Evidência da auditoria', multiple:true });
  $('#f-ok', m.host).addEventListener('click', async () => {
    if (precisaMotivo && !$('#f-just', m.host).value.trim()) return toast('Justificativa obrigatória pelo tempo excedido.', { type:'warn' });
    const btn = $('#f-ok', m.host); btn.disabled = true;
    try {
      const result = $('#f-result', m.host).value;
      const comOcorrencia = result.startsWith('Com ocorrência');
      const status = comOcorrencia ? 'Com ocorrência' : precisaMotivo ? 'Com atraso' : 'Finalizada';
      await db.update('auditorias_peca', a.id, {
        fim_iso:fimISO, fim:hhmm(fimISO), tempo_total:calc.tempo_total, excedeu:precisaMotivo, status,
        motivo_atraso: precisaMotivo ? $('#f-motivo', m.host).value : null,
        justificativa: precisaMotivo ? $('#f-just', m.host).value : null,
        obs: $('#f-obs', m.host).value
      });
      const evs = await up.commit({ registro_tipo:'auditoria', registro_id:a.id, usuario:USER });
      if (evs[0]) await db.update('auditorias_peca', a.id, { foto: evs[0].url });
      await db.log({ usuario:USER.nome, acao:`Finalizou auditoria de ${a.peca} (${calc.tempo_total} min)`, entidade:'auditoria_peca', antes:'Em andamento', depois:status });
      if (comOcorrencia) {
        const nc = await db.insert('nao_conformidades', { codigo:'NC-'+Math.floor(Math.random()*900+500), tipo:'Produto', categoria:'Funcional', origem:'Auditoria',
          maquina:'—', linha:'—', area:USER.area, descricao:`Ocorrência na auditoria de ${a.peca} (${a.op_lote})`, severidade:'Alta',
          responsavel:USER.id, prazo:new Date(Date.now()+86400000).toISOString().slice(0,10), status:'Aberta', abertura:new Date().toISOString().slice(0,10) });
        for (const ev of evs) await db.insert('evidencias', { entidade:'ocorrencia', entidade_id:nc.id, nome:ev.nome, url:ev.url, tipo:ev.tipo, dataHora:ev.dataHora, usuario:USER.nome });
      }
      m.close();
      toast(`Auditoria finalizada em ${calc.tempo_total} min.${precisaMotivo?' Justificativa registrada.':''}`, { type:precisaMotivo?'warn':'ok' });
      render();
    } catch { btn.disabled = false; }
  });
}

function tabela(rows) {
  if (!rows.length) return `<div class="empty-state"><i class="bi bi-search"></i><div>Nenhuma auditoria neste plantão ainda.</div></div>`;
  return `<table class="rna-table"><thead><tr><th>Peça</th><th>OP/Lote</th><th>Tipo</th><th>Tempo</th><th>Status</th></tr></thead><tbody>
    ${rows.map(a=>`<tr><td class="cell-strong">${a.peca}<div class="cell-sub">${a.codigo}</div></td><td class="cell-sub">${a.op_lote}</td><td>${a.tipo}</td>
      <td>${a.tempo_total!=null?`<b class="${a.excedeu?'text-danger':''}">${a.tempo_total} min</b><div class="cell-sub">méd ${a.tempo_medio}</div>`:'<span class="rna-badge badge-info">em curso</span>'}</td>
      <td><span class="rna-badge ${a.status==='Finalizada'?'badge-ok':a.status==='Em andamento'?'badge-info':a.status==='Com ocorrência'?'badge-crit':'badge-warn'}">${a.status}</span>
        ${a.motivo_atraso?`<div class="cell-sub" title="${a.justificativa||''}">${a.motivo_atraso}</div>`:''}</td></tr>`).join('')}
  </tbody></table>`;
}

const kpi = (v,l,ic,icon) => `<div class="col-6 col-md-3"><div class="rna-stat"><div class="rna-stat__icon ${ic}"><i class="bi ${icon}"></i></div><div class="rna-stat__val" style="font-size:22px">${v}</div><div class="rna-stat__label">${l}</div></div></div>`;
