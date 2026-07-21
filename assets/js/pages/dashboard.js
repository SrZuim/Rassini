/* Dashboard de Indicadores */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import { charts, PALETTE } from '../charts.js';
import { statusClass, podeVerMetricasTempo } from '../../../services/config.js';
import { $ } from '../ui.js';

const ctx = await mountShell();
if (ctx) render(ctx.user);

async function render(user) {
  const [rotinas, auditorias, ncs, planos, maquinas, usuarios, atividades,
         plantoes, rotinaExec, checklistExec, auditPeca, catPecas] = await Promise.all([
    db.list('rotinas'), db.list('auditorias'), db.list('nao_conformidades'),
    db.list('planos_acao'), db.list('maquinas'), db.list('usuarios'), db.list('atividades'),
    db.list('plantoes'), db.list('rotina_exec'), db.list('checklist_exec'), db.list('auditorias_peca'), db.list('cat_pecas')
  ]);

  // ---- métricas do fluxo de auditores ----
  const emPlantao = plantoes.filter(p => p.status === 'Aberto');
  const chkNok = checklistExec.filter(e => e.status === 'NOK').length;
  const audAndamento = auditPeca.filter(a => a.status === 'Em andamento').length;
  const audFinal = auditPeca.filter(a => a.status !== 'Em andamento').length;
  const audAtraso = auditPeca.filter(a => a.excedeu).length;
  const finalizadas = auditPeca.filter(a => a.tempo_total != null);
  const concDia = rotinaExec.filter(e => e.status === 'Concluído').length;

  const audDia = auditorias.filter(a => a.data === '2026-06-28');
  const audPend = auditorias.filter(a => a.status !== 'Concluída').length;
  const audConc = auditorias.filter(a => a.status === 'Concluída').length;
  const rotAtras = rotinas.filter(r => ['Postergada','Não executada'].includes(r.status)).length;
  const ncAbertas = ncs.filter(n => !['Resolvida','Encerrada'].includes(n.status)).length;
  const acoesAbertas = planos.filter(p => p.status !== 'Concluído').length;
  const tempoMedio = Math.round(atividades.filter(a=>a.tempo).reduce((s,a)=>s+a.tempo,0) / (atividades.filter(a=>a.tempo).length||1));

  $('#rna-content').innerHTML = `
    <div class="rna-page-head">
      <div>
        <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Dashboard</div>
        <h1>Indicadores do Plantão</h1>
        <p>Visão consolidada · 28/06/2026 · 1º Turno</p>
      </div>
      <div class="d-flex gap-2">
        <button class="rna-btn rna-btn-ghost"><i class="bi bi-calendar3"></i> Hoje</button>
        <button class="rna-btn rna-btn-dark" id="btn-export"><i class="bi bi-download"></i> Exportar</button>
      </div>
    </div>

    <h2 style="font-size:16px;font-weight:700;margin:0 0 12px"><i class="bi bi-people-fill text-yellow"></i> Acompanhamento dos Auditores</h2>
    <div class="row g-3 mb-3">
      ${kpi('bi-broadcast','ic-soft-green', emPlantao.length, 'Auditores em plantão','','')}
      ${kpi('bi-list-check','ic-soft-yellow', concDia, 'Rotinas concluídas','','')}
      ${kpi('bi-ui-checks','ic-soft-blue', checklistExec.length, 'Itens de checklist','','')}
      ${kpi('bi-x-octagon','ic-soft-red', chkNok, 'Checklist NOK','','')}
      ${kpi('bi-search','ic-soft-blue', audAndamento, 'Auditorias em andamento','','')}
      ${kpi('bi-stopwatch','ic-soft-orange', audAtraso, 'Acima do tempo médio','','')}
    </div>
    <div class="row g-3 mb-3">
      <div class="col-lg-5"><div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-broadcast"></i> Em plantão agora</h3></div>
        <div class="rna-card__body p-0">${tabelaPlantao(emPlantao, usuarios, rotinaExec, checklistExec, auditPeca)}</div></div></div>
      <div class="col-lg-4"><div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-box"></i> Peças mais auditadas</h3></div>
        <div class="rna-card__body"><div style="height:230px"><canvas id="ch-pecas"></canvas></div></div></div></div>
      <div class="col-lg-3"><div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-stopwatch"></i> Tempo médio / peça</h3></div>
        <div class="rna-card__body p-0">${tabelaTempo(catPecas, finalizadas)}</div></div></div>
    </div>
    <div class="row g-3 mb-4">
      <div class="col-lg-6"><div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-graph-down"></i> Ranking de atrasos por peça</h3></div>
        <div class="rna-card__body"><div style="height:220px"><canvas id="ch-atraso-peca"></canvas></div></div></div></div>
      <div class="col-lg-6"><div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-person-x"></i> Ocorrências por auditor</h3></div>
        <div class="rna-card__body"><div style="height:220px"><canvas id="ch-ocorr-aud"></canvas></div></div></div></div>
    </div>

    <h2 style="font-size:16px;font-weight:700;margin:0 0 12px"><i class="bi bi-graph-up text-yellow"></i> Indicadores Gerais</h2>
    <div class="row g-3 mb-3">
      ${kpi('bi-clipboard-data','ic-soft-blue', audDia.length, 'Auditorias do dia','+2 vs ontem','up')}
      ${kpi('bi-hourglass-split','ic-soft-yellow', audPend, 'Auditorias pendentes','','')}
      ${kpi('bi-check2-circle','ic-soft-green', audConc, 'Auditorias concluídas','+1','up')}
      ${kpi('bi-clock-history','ic-soft-orange', rotAtras, 'Rotinas atrasadas','crítico','down')}
      ${kpi('bi-exclamation-octagon','ic-soft-red', ncAbertas, 'NCs em aberto','','')}
      ${kpi('bi-diagram-3','ic-soft-gray', acoesAbertas, 'Ações corretivas abertas','','')}
    </div>

    <div class="row g-3 mb-3">
      <div class="col-lg-8">
        <div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-activity"></i> Execução de rotinas por hora</h3>
          ${podeVerMetricasTempo(user.role) ? `<span class="rna-badge badge-yellow">Tempo médio ${tempoMedio} min</span>` : ''}</div>
          <div class="rna-card__body"><div style="height:280px"><canvas id="ch-exec"></canvas></div></div></div>
      </div>
      <div class="col-lg-4">
        <div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-pie-chart"></i> Status das rotinas</h3></div>
          <div class="rna-card__body"><div style="height:280px"><canvas id="ch-rot"></canvas></div></div></div>
      </div>
    </div>

    <div class="row g-3 mb-3">
      <div class="col-lg-6">
        <div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-person-badge"></i> Produtividade por auditor</h3></div>
          <div class="rna-card__body"><div style="height:260px"><canvas id="ch-prod"></canvas></div></div></div>
      </div>
      <div class="col-lg-6">
        <div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-bar-chart-steps"></i> Não conformidades por área</h3></div>
          <div class="rna-card__body"><div style="height:260px"><canvas id="ch-nc-area"></canvas></div></div></div>
      </div>
    </div>

    <div class="row g-3 mb-3">
      <div class="col-lg-4">
        <div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-clock"></i> Defeitos por turno</h3></div>
          <div class="rna-card__body"><div style="height:230px"><canvas id="ch-turno"></canvas></div></div></div>
      </div>
      <div class="col-lg-4">
        <div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-speedometer2"></i> Eficiência do plantão (OEE)</h3></div>
          <div class="rna-card__body"><div style="height:230px"><canvas id="ch-oee"></canvas></div></div></div>
      </div>
      <div class="col-lg-4">
        <div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-cone-striped"></i> Máquinas críticas</h3></div>
          <div class="rna-card__body p-0">${maquinasCriticas(maquinas)}</div></div>
      </div>
    </div>

    <div class="row g-3 mb-3">
      <div class="col-lg-6">
        <div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-trophy"></i> Ranking de auditores</h3></div>
          <div class="rna-card__body p-0">${rankingAuditores(usuarios, atividades, auditorias)}</div></div>
      </div>
      <div class="col-lg-6">
        <div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-gear-wide-connected"></i> Ranking de máquinas (OEE)</h3></div>
          <div class="rna-card__body p-0">${rankingMaquinas(maquinas)}</div></div>
      </div>
    </div>

    <div id="bi" class="rna-card">
      <div class="rna-card__head"><h3><i class="bi bi-bar-chart-line"></i> Power BI — Relatórios Corporativos</h3>
        <span class="rna-badge badge-info">Integração</span></div>
      <div class="rna-card__body">
        <div style="border:2px dashed var(--rna-border);border-radius:12px;padding:40px;text-align:center;background:var(--rna-bg)">
          <i class="bi bi-bar-chart-line" style="font-size:42px;color:var(--rna-yellow-600)"></i>
          <h4 style="margin:12px 0 6px;font-weight:650">Embed do Power BI</h4>
          <p class="text-muted-2" style="max-width:520px;margin:0 auto 14px">
            Espaço reservado para o relatório corporativo do Power BI Embedded. Basta inserir a URL do report e o token na configuração de integrações.</p>
          <code style="background:#fff;border:1px solid var(--rna-border);padding:6px 12px;border-radius:8px;font-size:12px">services/integrations/powerbi.js → embed(reportId, token)</code>
        </div>
      </div>
    </div>`;

  // ---- charts do fluxo de auditores ----
  const pecaCount = {};
  auditPeca.forEach(a => { pecaCount[a.peca] = (pecaCount[a.peca]||0)+1; });
  const pecaLabels = Object.keys(pecaCount);
  if (pecaLabels.length) charts.doughnut('ch-pecas', pecaLabels, Object.values(pecaCount),
    [PALETTE.yellow, PALETTE.blue, PALETTE.green, PALETTE.orange, PALETTE.red, PALETTE.steel]);
  else emptyCanvas('ch-pecas');

  const atrasoPeca = {};
  auditPeca.filter(a=>a.excedeu).forEach(a => { atrasoPeca[a.peca]=(atrasoPeca[a.peca]||0)+1; });
  const apLabels = Object.keys(atrasoPeca);
  if (apLabels.length) charts.hbar('ch-atraso-peca', apLabels, [{ label:'Atrasos', data:apLabels.map(p=>atrasoPeca[p]), backgroundColor:PALETTE.red }], { plugins:{legend:{display:false}} });
  else emptyCanvas('ch-atraso-peca');

  const ocorrAud = {};
  auditPeca.filter(a=>a.status==='Com ocorrência').forEach(a => { ocorrAud[a.auditor_nome||'—']=(ocorrAud[a.auditor_nome]||0)+1; });
  const oaLabels = Object.keys(ocorrAud);
  if (oaLabels.length) charts.bar('ch-ocorr-aud', oaLabels, [{ label:'Ocorrências', data:oaLabels.map(a=>ocorrAud[a]), backgroundColor:PALETTE.orange }], { plugins:{legend:{display:false}} });
  else emptyCanvas('ch-ocorr-aud');

  // ---- charts ----
  charts.line('ch-exec', ['06h','07h','08h','09h','10h','11h','12h','13h'],
    [{ label:'Executadas', data:[2,5,8,11,13,15,17,19], borderColor:PALETTE.yellow, backgroundColor:(c)=>charts.fade(PALETTE.yellow,c) },
     { label:'Previstas', data:[3,6,9,12,15,18,21,24], borderColor:PALETTE.gray, borderDash:[5,5], fill:false }]);

  const rc = { Pendente:0, 'Em andamento':0, Concluída:0, Postergada:0, 'Não executada':0 };
  rotinas.forEach(r => rc[r.status]++);
  charts.doughnut('ch-rot', Object.keys(rc), Object.values(rc),
    [PALETTE.gray, PALETTE.blue, PALETTE.green, PALETTE.orange, PALETTE.red]);

  charts.bar('ch-prod', ['Ana B.','Carlos M.','Equipe T2','Equipe T3'],
    [{ label:'Rotinas concluídas', data:[19,14,11,9], backgroundColor:PALETTE.yellow },
     { label:'Auditorias', data:[2,2,1,1], backgroundColor:PALETTE.graphite }]);

  const areas = [...new Set(ncs.map(n=>n.area))];
  charts.hbar('ch-nc-area', areas, [{ label:'NCs', data: areas.map(a=>ncs.filter(n=>n.area===a).length), backgroundColor:PALETTE.red }]);

  charts.bar('ch-turno', ['1º Turno','2º Turno','3º Turno'],
    [{ label:'Defeitos', data:[3,5,2], backgroundColor:[PALETTE.green,PALETTE.orange,PALETTE.blue] }], { plugins:{legend:{display:false}} });

  charts.doughnut('ch-oee', ['Disponibilidade','Performance','Qualidade','Perda'], [88,84,97,12],
    [PALETTE.green, PALETTE.yellow, PALETTE.blue, PALETTE.grid]);

  document.getElementById('btn-export')?.addEventListener('click', () => {
    import('../ui.js').then(m => m.toast('Relatório do plantão preparado para exportação (PDF/Excel) — geração no servidor prevista na fase 2.', { type:'ok', title:'Exportar' }));
  });

  if (location.hash === '#bi') document.getElementById('bi')?.scrollIntoView({ behavior:'smooth' });
}

function kpi(icon, ic, val, label, trend, dir) {
  return `<div class="col-6 col-md-4 col-xl-2"><div class="rna-stat">
    <div class="rna-stat__icon ${ic}"><i class="bi ${icon}"></i></div>
    <div class="rna-stat__val">${val}</div><div class="rna-stat__label">${label}</div>
    ${trend ? `<div class="rna-stat__trend ${dir==='up'?'trend-up':'trend-down'}"><i class="bi bi-arrow-${dir==='up'?'up':'down'}-right"></i> ${trend}</div>` : ''}
  </div></div>`;
}

function emptyCanvas(id) {
  const c = document.getElementById(id);
  if (c) c.parentElement.innerHTML = '<div class="empty-state"><i class="bi bi-bar-chart"></i><div>Sem dados ainda neste plantão.</div></div>';
}

function tabelaPlantao(emPlantao, usuarios, rotinaExec, checklistExec, auditPeca) {
  if (!emPlantao.length) return `<div class="empty-state"><i class="bi bi-person-workspace"></i><div>Nenhum auditor em plantão.</div></div>`;
  return `<table class="rna-table"><thead><tr><th>Auditor</th><th>Turno</th><th>Rotina</th><th>Checklist</th><th>Auditorias</th></tr></thead><tbody>
    ${emPlantao.map(p=>{
      const rot = rotinaExec.filter(e=>e.plantao_id===p.id && (e.status==='Concluído'||e.status==='Não aplicável')).length;
      const chk = checklistExec.filter(e=>e.plantao_id===p.id && e.status && e.status!=='Pendente').length;
      const aud = auditPeca.filter(a=>a.plantao_id===p.id).length;
      return `<tr><td class="cell-strong">${p.usuario_nome||'—'}</td><td class="cell-sub">${(p.turno||'').split(' ')[0]}</td>
        <td><span class="rna-badge ${rot?'badge-ok':'badge-pend'}">${rot} ok</span></td>
        <td><span class="rna-badge ${chk?'badge-info':'badge-pend'}">${chk}</span></td>
        <td><span class="rna-badge badge-yellow">${aud}</span></td></tr>`;
    }).join('')}
  </tbody></table>`;
}

function tabelaTempo(catPecas, finalizadas) {
  return `<table class="rna-table"><thead><tr><th>Peça</th><th>Médio</th><th>Real</th></tr></thead><tbody>
    ${catPecas.filter(p=>p.ativo).map(p=>{
      const fs = finalizadas.filter(a=>a.peca===p.nome);
      const real = fs.length ? Math.round(fs.reduce((s,a)=>s+a.tempo_total,0)/fs.length) : null;
      return `<tr><td class="cell-strong">${p.nome}</td><td class="cell-sub">${p.tempo_medio} min</td>
        <td>${real!=null?`<b class="${real>p.tempo_medio?'text-danger':'text-success'}">${real} min</b>`:'<span class="text-muted-2">—</span>'}</td></tr>`;
    }).join('')}
  </tbody></table>`;
}

function maquinasCriticas(maquinas) {
  const crit = maquinas.filter(m => m.criticidade === 'Alta' || m.status !== 'Operando').slice(0,5);
  return `<div class="p-2">${crit.map(m => `
    <div class="d-flex align-items-center gap-3 p-2" style="border-bottom:1px solid #eef1f4">
      <div class="rna-avatar" style="background:${m.status==='Parada'?'rgba(226,59,59,.12)':'rgba(244,169,17,.16)'};color:${m.status==='Parada'?'var(--rna-crit)':'var(--rna-warn)'};border-radius:10px"><i class="bi bi-gear-fill"></i></div>
      <div class="flex-fill"><div class="cell-strong" style="font-size:13px">${m.tag} · ${m.nome}</div><div class="cell-sub">${m.linha}</div></div>
      <span class="rna-badge ${statusClass(m.status)}">${m.status}</span>
    </div>`).join('')}</div>`;
}

function rankingAuditores(usuarios, atividades, auditorias) {
  const auds = usuarios.filter(u => u.role === 'auditor');
  const rows = auds.map(u => {
    const acts = atividades.filter(a => a.auditor === u.id);
    const conformes = acts.filter(a => a.resultado === 'Conforme').length;
    return { nome: u.nome, exec: acts.length + auditorias.filter(a=>a.auditor===u.id).length, ef: acts.length ? Math.round(conformes/acts.length*100) : 95 };
  }).sort((a,b)=>b.exec-a.exec);
  return `<table class="rna-table"><thead><tr><th>#</th><th>Auditor</th><th>Execuções</th><th>Eficiência</th></tr></thead><tbody>
    ${rows.map((r,i)=>`<tr><td><b>${i+1}º</b></td><td class="cell-strong">${r.nome}</td><td>${r.exec}</td>
      <td><div class="d-flex align-items-center gap-2"><div class="rna-progress" style="width:70px"><span style="width:${r.ef}%"></span></div><small>${r.ef}%</small></div></td></tr>`).join('')}
  </tbody></table>`;
}

function rankingMaquinas(maquinas) {
  const rows = [...maquinas].sort((a,b)=>b.oee-a.oee);
  return `<table class="rna-table"><thead><tr><th>Máquina</th><th>Linha</th><th>OEE</th></tr></thead><tbody>
    ${rows.map(m=>`<tr><td class="cell-strong">${m.tag}</td><td class="cell-sub">${m.linha}</td>
      <td><div class="d-flex align-items-center gap-2"><div class="rna-progress" style="width:80px"><span style="width:${m.oee}%;background:${m.oee>85?'var(--rna-ok)':m.oee>70?'var(--rna-yellow)':'var(--rna-crit)'}"></span></div><small>${m.oee}%</small></div></td></tr>`).join('')}
  </tbody></table>`;
}
