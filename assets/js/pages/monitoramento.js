/* Monitoramento Industrial — Gestão à Vista / Andon */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { charts, PALETTE } from '../charts.js';
import { sevColor } from '../../../services/config.js';
import { $, $$, toast } from '../ui.js';

const ctx = await mountShell();
if (ctx) render();

async function render() {
  const [maquinas, ncs, rotinas] = await Promise.all([db.list('maquinas'), db.list('nao_conformidades'), db.list('rotinas')]);
  const operando = maquinas.filter(m=>m.status==='Operando').length;
  const paradas = maquinas.filter(m=>m.status==='Parada').length;
  const atencao = maquinas.filter(m=>m.status==='Atenção').length;
  const oeeGeral = Math.round(maquinas.reduce((s,m)=>s+m.oee,0)/maquinas.length);
  const criticasAtivas = ncs.filter(n=>n.severidade==='Crítica' && !['Resolvida','Encerrada'].includes(n.status));

  $('#rna-content').innerHTML = `
    <div class="rna-page-head">
      <div><div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Monitoramento</div>
      <h1>Monitoramento Industrial</h1><p>Gestão à Vista · atualização automática a cada 10s.</p></div>
      <div class="d-flex gap-2">
        <span class="rna-badge badge-ok" id="live-badge"><i class="bi bi-broadcast"></i> Ao vivo</span>
        <button class="rna-btn rna-btn-dark" id="btn-kiosk"><i class="bi bi-fullscreen"></i> Modo TV</button>
      </div>
    </div>

    ${criticasAtivas.length?`<div class="rna-card mb-3" style="border-left:4px solid var(--rna-crit);animation:pulse 2s infinite">
      <div class="rna-card__body d-flex align-items-center gap-3">
        <i class="bi bi-exclamation-octagon-fill" style="font-size:26px;color:var(--rna-crit)"></i>
        <div class="flex-fill"><b style="color:var(--rna-crit)">ANDON · ${criticasAtivas.length} alerta(s) crítico(s) ativo(s)</b>
          <div style="font-size:13px">${criticasAtivas.map(n=>`${n.codigo} · ${n.maquina} — ${n.descricao.slice(0,50)}`).join(' &nbsp;|&nbsp; ')}</div></div>
        <a href="ocorrencias.html" class="rna-btn rna-btn-dark rna-btn-sm">Tratar</a>
      </div></div>`:''}

    <div class="row g-3 mb-3">
      <div class="col-6 col-lg-3"><div class="monitor-tile ok"><small>Operando</small><h2>${operando}</h2><i class="bi bi-gear-fill position-absolute" style="right:16px;top:16px;font-size:26px;opacity:.4"></i></div></div>
      <div class="col-6 col-lg-3"><div class="monitor-tile warn"><small>Em atenção</small><h2>${atencao}</h2><i class="bi bi-exclamation-triangle-fill position-absolute" style="right:16px;top:16px;font-size:26px;opacity:.4"></i></div></div>
      <div class="col-6 col-lg-3"><div class="monitor-tile crit"><small>Paradas</small><h2>${paradas}</h2><i class="bi bi-stop-circle-fill position-absolute" style="right:16px;top:16px;font-size:26px;opacity:.4"></i></div></div>
      <div class="col-6 col-lg-3"><div class="monitor-tile dark"><small>OEE Geral</small><h2>${oeeGeral}%</h2><i class="bi bi-speedometer2 position-absolute" style="right:16px;top:16px;font-size:26px;opacity:.4"></i></div></div>
    </div>

    <div class="row g-3 mb-3">
      <div class="col-lg-8"><div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-cpu"></i> Status das máquinas</h3></div>
        <div class="rna-card__body"><div class="row g-3" id="maq-grid">
          ${maquinas.map(m=>{
            const cls = m.status==='Operando'?'ok':m.status==='Atenção'?'warn':'crit';
            const col = m.status==='Operando'?'var(--rna-ok)':m.status==='Atenção'?'var(--rna-warn)':'var(--rna-crit)';
            return `<div class="col-md-6 col-xl-4"><div class="rna-card" style="border-left:4px solid ${col}"><div class="rna-card__body py-3">
              <div class="d-flex justify-content-between"><b style="font-size:13.5px">${m.tag}</b><span class="rna-badge badge-${cls==='ok'?'ok':cls==='warn'?'warn':'crit'}">${m.status}</span></div>
              <div class="cell-sub mb-2">${m.nome}</div>
              <div class="d-flex justify-content-between" style="font-size:11.5px"><span class="text-muted-2">OEE</span><b>${m.oee}%</b></div>
              <div class="rna-progress"><span style="width:${m.oee}%;background:${col}"></span></div>
            </div></div></div>`;
          }).join('')}
        </div></div></div></div>
      <div class="col-lg-4"><div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-pie-chart"></i> Disponibilidade da planta</h3></div>
        <div class="rna-card__body"><div style="height:200px"><canvas id="ch-disp"></canvas></div>
          <div class="mt-3"><div class="d-flex justify-content-between mb-1" style="font-size:12.5px"><span>Rotinas executadas no turno</span><b>${rotinas.filter(r=>r.status==='Concluída').length}/${rotinas.length}</b></div>
          <div class="rna-progress"><span style="width:${Math.round(rotinas.filter(r=>r.status==='Concluída').length/rotinas.length*100)}%"></span></div></div>
        </div></div></div>
    </div>`;

  charts.doughnut('ch-disp', ['Operando','Atenção','Parada'], [operando,atencao,paradas], [PALETTE.green,PALETTE.orange,PALETTE.red]);

  $('#btn-kiosk').addEventListener('click', () => {
    document.body.classList.toggle('kiosk');
    if (document.body.classList.contains('kiosk')) { document.documentElement.requestFullscreen?.(); toast('Modo TV/Gestão à Vista ativo. Pressione ESC para sair.', { type:'info' }); }
    else document.exitFullscreen?.();
  });

  // auto-refresh simulado
  clearInterval(window.__rnaMon);
  window.__rnaMon = setInterval(() => {
    const b = $('#live-badge'); if (b) { b.style.opacity = '.4'; setTimeout(()=>{ if(b) b.style.opacity='1'; }, 300); }
  }, 10000);
}
