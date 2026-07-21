/* Plantão — hub/dashboard do auditor (Gestão Operacional) */
import { mountShell } from '../app.js';
import { db } from '../../../services/db.js';
import * as ATIV from '../../../services/atividades.js';
import { TURNOS, PLANTAS } from '../../../services/config.js';
import { AREA_SUPERVISOR, porArea, properNome } from '../../../services/funcionarios.js';
import { $, $$, toast, confirmDialog, initials } from '../ui.js';

const ctx = await mountShell();
let USER;   // TIMER removido: não há mais cronômetro na tela do plantão (§M02)
if (ctx) { USER = ctx.user; render(); }

function saudacao() { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; }
function primeiroNome(n) { return String(n || '').trim().split(/\s+/)[0] || ''; }
function head() {
  return `<div class="rna-page-head"><div>
    <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Operações</div>
    <h1>Plantão</h1><p>Central de operações do seu turno.</p></div></div>`;
}

async function render() {
  const plantao = await ATIV.plantaoAtivo(USER.id);
  if (!plantao) return renderIniciar();

  await ATIV.montarPlantao(USER, plantao, 'rotina');           // idempotente
  await ATIV.montarPlantao(USER, plantao, 'checklist');
  const execs = await ATIV.execucoesDo(plantao.id, USER, 'rotina');
  const execsChk = await ATIV.execucoesDo(plantao.id, USER, 'checklist');
  const r = ATIV.resumo(execs);
  const rChk = ATIV.resumo(execsChk);
  const fin = await ATIV.podeFinalizar(plantao.id, USER);
  const pendAbertas = (await ATIV.pendenciasDe(USER)).filter(p => p.status !== 'resolvida');
  const proxima = [...execs, ...execsChk].find(e => e.status === 'pendente' || e.status === 'em_andamento');

  $('#rna-content').innerHTML = head() + `
    <div class="rna-card mb-3" style="border-left:4px solid var(--rna-ok)"><div class="rna-card__body">
      <div class="d-flex flex-wrap align-items-center gap-3">
        <div class="rna-avatar" style="width:52px;height:52px;font-size:18px">${initials(USER.nome)}</div>
        <div class="flex-fill" style="min-width:200px"><h2 style="margin:0;font-size:20px">${saudacao()}, ${primeiroNome(USER.nome)} 👋</h2>
          <small class="text-muted-2">${plantao.turno} · ${plantao.planta || ''} · iniciado ${plantao.hora || ''}</small></div>
        <button class="rna-btn rna-btn-dark" id="op-finalizar"><i class="bi bi-stop-fill"></i> Finalizar Plantão</button>
      </div>
    </div>
    <div class="row g-3 mb-3">
      ${stat('bi-list-check', 'ic-soft-yellow', r.total, 'Rotinas atribuídas')}
      ${stat('bi-ui-checks', 'ic-soft-orange', rChk.total, 'Checklists atribuídos')}
      ${stat('bi-search', 'ic-soft-blue', '—', 'Auditorias · Fase 3')}
      ${stat('bi-exclamation-circle', 'ic-soft-red', pendAbertas.length, 'Pendências')}
    </div>
    <div class="rna-card mb-3"><div class="rna-card__body">
      ${(() => { const tot = r.total + rChk.total, con = r.concluidas + rChk.concluidas, pct = tot ? Math.round(con / tot * 100) : 100, obr = fin.totalPend; return `
      <div class="d-flex justify-content-between mb-1"><b>Progresso do plantão</b><b>${con}/${tot} · ${pct}%</b></div>
      <div class="rna-progress" style="height:12px"><span style="width:${pct}%;background:${pct === 100 ? 'var(--rna-ok)' : 'var(--rna-yellow)'}"></span></div>
      ${obr ? `<small class="text-muted-2"><i class="bi bi-lock"></i> ${obr} atividade(s) obrigatória(s) pendente(s) — fechamento bloqueado</small>` : `<small style="color:var(--rna-ok)"><i class="bi bi-unlock"></i> Todas as obrigatórias concluídas — pode finalizar</small>`}`; })()}
    </div></div>
    <div class="row g-3">
      <div class="col-lg-7"><div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-play-circle"></i> Próxima atividade</h3>
        <a href="op-minhas-rotinas.html" class="rna-btn rna-btn-ghost rna-btn-sm">Ver todas <i class="bi bi-arrow-right"></i></a></div>
        <div class="rna-card__body">${proxima ? proxCard(proxima) : `<div class="empty-state"><i class="bi bi-check2-circle"></i><div>Nenhuma atividade pendente. Bom trabalho!</div></div>`}</div></div></div>
      <div class="col-lg-5"><div class="rna-card h-100"><div class="rna-card__head"><h3><i class="bi bi-clock-history"></i> Últimas atividades</h3></div>
        <div class="rna-card__body p-0">${ultimas([...execs, ...execsChk])}</div></div></div>
    </div>`;

  /* §M02 — o cronômetro NÃO é mais exibido ao auditor (nem o setInterval que o
     atualizava, o que também poupa um timer por segundo na página). O registro
     de tempo continua integral: `inicio_iso` na abertura e `fim_iso` +
     `duracao_seg` no fechamento (ver finalizar). As métricas ficam visíveis
     apenas na Administração — ver config.podeVerMetricasTempo. */
  $('#op-finalizar').addEventListener('click', () => finalizar(plantao, fin));
}

function stat(icon, cor, val, label) {
  return `<div class="col-6 col-lg-3"><div class="rna-stat"><div class="rna-stat__icon ${cor}"><i class="bi ${icon}"></i></div>
    <div class="rna-stat__val" style="font-size:24px">${val}</div><div class="rna-stat__label">${label}</div></div></div>`;
}
function proxCard(e) {
  const a = e.atividade || {};
  const chk = e.tipo_slug === 'checklist';
  const href = `${chk ? 'op-meus-checklists' : 'op-minhas-rotinas'}.html?exec=${e.id}`;
  return `<a href="${href}" class="op-next" style="text-decoration:none;color:inherit">
    <div class="d-flex align-items-center gap-3">
      <div class="rna-stat__icon ${chk ? 'ic-soft-orange' : 'ic-soft-yellow'}" style="margin:0"><i class="bi ${chk ? 'bi-ui-checks' : 'bi-list-check'}"></i></div>
      <div class="flex-fill"><b style="font-size:15px">${a.nome || '—'}</b>
        <div class="op-item__resp"><span>${a.codigo || ''}</span><span><i class="bi bi-tag"></i> ${a.categoria || '—'}</span>${a.horario ? `<span><i class="bi bi-clock"></i> ${a.horario}</span>` : ''}${a.obrigatoria ? '<span class="rna-badge badge-crit">Obrigatória</span>' : ''}</div></div>
      <span class="rna-btn rna-btn-primary"><i class="bi bi-play-fill"></i> ${chk ? 'Responder' : 'Executar'}</span>
    </div></a>`;
}
function ultimas(execs) {
  const feitas = execs.filter(e => e.status === 'concluida' || e.status === 'nao_aplicavel').slice(0, 6);
  if (!feitas.length) return `<div class="empty-state" style="padding:26px"><i class="bi bi-hourglass"></i><div>Nenhuma atividade concluída ainda.</div></div>`;
  return `<div class="bib-list">${feitas.map(e => `<div class="bib-list__item" style="cursor:default">
    <div class="rna-stat__icon ${e.status === 'concluida' ? 'ic-soft-green' : 'ic-soft-gray'}" style="margin:0;width:34px;height:34px"><i class="bi ${e.status === 'concluida' ? 'bi-check-lg' : 'bi-slash-circle'}"></i></div>
    <div class="flex-fill"><b style="font-size:13.5px">${e.atividade?.nome || '—'}</b><div class="cell-sub">${e.atividade?.codigo || ''}</div></div>
    <span class="rna-badge ${e.status === 'concluida' ? 'badge-ok' : 'badge-na'}">${e.status === 'concluida' ? 'Concluída' : 'N/A'}</span></div>`).join('')}</div>`;
}

function finalizar(plantao, fin) {
  if (!fin.ok) {
    toast(`Ainda existem atividades obrigatórias pendentes. Rotinas: ${fin.pend.rotina} · Checklists: ${fin.pend.checklist} · Auditorias: ${fin.pend.auditoria}. Finalize todas antes de encerrar o plantão.`, { type: 'warn', title: 'Plantão em aberto', timeout: 6500 });
    return;
  }
  confirmDialog('Finalizar o plantão atual? Todas as atividades obrigatórias estão concluídas.', async () => {
    /* Registro de tempo (§M02): antes só gravávamos fim_iso. A duração total
       passa a ser calculada e persistida aqui — é o insumo de produtividade e
       tempo médio da Administração, mesmo sem cronômetro na tela do auditor. */
    const fimIso = ATIV.nowISO();
    const inicioMs = new Date(plantao.inicio_iso || fimIso).getTime();
    const duracaoSeg = Math.max(0, Math.round((new Date(fimIso).getTime() - inicioMs) / 1000));
    const nucleo = { status: 'Encerrado', fim_iso: fimIso };
    try {
      await db.update('plantoes', plantao.id, { ...nucleo, duracao_seg: duracaoSeg });
    } catch (e) {
      // Banco sem a coluna nova: encerra o plantão mesmo assim (a duração
      // permanece derivável de inicio_iso/fim_iso). Ver fix_lote1_melhorias.sql.
      console.warn('[PLANTÃO] duracao_seg não gravada (coluna ausente?):', e?.message || e);
      await db.update('plantoes', plantao.id, nucleo);
    }
    await db.log({ usuario: USER.nome, acao: 'Finalizou plantão (Gestão Operacional)', entidade: 'plantao', antes: 'Aberto', depois: 'Encerrado' });
    toast('Plantão finalizado.', { type: 'ok' }); render();
  }, { title: 'Finalizar plantão', okLabel: 'Finalizar', danger: true });
}

async function renderIniciar() {
  const funcionarios = await db.list('funcionarios');
  const sups = porArea(funcionarios, AREA_SUPERVISOR).map(f => properNome(f.nome));
  const now = new Date();
  const sel = (id, opts) => `<select class="form-select" id="${id}">${opts.map(o => `<option>${o}</option>`).join('')}</select>`;
  $('#rna-content').innerHTML = head() + `
    <div class="rna-card"><div class="rna-card__head"><h3><i class="bi bi-box-arrow-in-right"></i> Iniciar Plantão</h3></div>
      <div class="rna-card__body"><form id="op-form" class="row g-3">
        <div class="col-md-6"><label class="form-label">Auditor</label><input class="form-control" value="${USER.nome}" disabled></div>
        <div class="col-md-6"><label class="form-label">Turno *</label>${sel('f-turno', TURNOS)}</div>
        <div class="col-md-6"><label class="form-label">Planta *</label>${sel('f-planta', PLANTAS)}</div>
        <div class="col-md-6"><label class="form-label">Supervisor</label>${sel('f-sup', sups.length ? sups : ['—'])}</div>
        <div class="col-12"><p class="text-muted-2" style="font-size:12.5px;margin:0"><i class="bi bi-info-circle"></i> Ao iniciar, o sistema carrega automaticamente as atividades atribuídas a você (por usuário, cargo ou planta+turno) e você as executa em qualquer ordem. O fechamento só é liberado quando todas as obrigatórias estiverem concluídas.</p></div>
        <div class="col-12 pt-1"><button type="submit" class="rna-btn rna-btn-primary rna-btn-xl"><i class="bi bi-play-fill"></i> Iniciar Plantão</button></div>
      </form></div></div>`;

  $('#op-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const reg = {
      usuario: USER.id, usuario_nome: USER.nome, data: now.toISOString().slice(0, 10),
      hora: now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      turno: $('#f-turno').value, planta: $('#f-planta').value, supervisor: $('#f-sup').value,
      dispositivo: 'Web', categoria_checklist: null, status: 'Aberto', inicio_iso: ATIV.nowISO()
    };
    const p = await db.insert('plantoes', reg);
    await db.log({ usuario: USER.nome, acao: `Iniciou plantão (${reg.turno})`, entidade: 'plantao', antes: '—', depois: 'Aberto' });
    await ATIV.montarPlantao(USER, p, 'rotina');
    toast('Plantão iniciado! Atividades atribuídas carregadas.', { type: 'ok', title: 'Plantão' });
    render();
  });
}
