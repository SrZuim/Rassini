/* ==========================================================================
   RNA One — FECHAMENTO MENSAL · Página
   ---------------------------------------------------------------------------
   17 áreas (§2) sobre uma competência selecionada. O estado vive em `state`;
   cada aba tem um `render*` que devolve HTML e liga seus eventos.

   Decisão central: os 12 cadastros de lançamento (reclamações, ocorrências,
   produção, custos, CARE, quebras...) usam UM formulário e UMA tabela
   genéricos, dirigidos pelo SPEC de fm-schema.js. Doze cópias significariam
   doze lugares para esquecer a auditoria, a trava de competência fechada ou a
   validação — que é justamente o que este módulo não pode errar.
   ========================================================================== */
import { mountShell } from '../app.js';
import { can, PLANTAS } from '../../../services/config.js';
import { db } from '../../../services/db.js';
import { $, $$, el, toast, modal, confirmDialog, loading } from '../ui.js';
import { formatarDataBrasil, formatarDataHoraBrasil, hojeBR } from '../../../services/datahora.js';
import { fmtInteiro } from '../../../services/formato.js';

import * as SCHEMA from '../../../services/fechamento/fm-schema.js';
import * as CORE from '../../../services/fechamento/fm-core.js';
import * as REG from '../../../services/fechamento/fm-registros.js';
import * as IND from '../../../services/fechamento/fm-indicadores.js';
import * as CALC from '../../../services/fechamento/fm-calc.js';
import * as PEND from '../../../services/fechamento/fm-pendencias.js';
import * as IMP from '../../../services/fechamento/fm-import.js';
import * as CLI from '../../../services/fechamento/fm-clientes.js';
import * as APRES from '../../../services/fechamento/fm-apresentacao.js';
import * as INTEG from '../../../services/fechamento/fm-integracao.js';
import * as UI from '../fechamento/fm-ui.js';

const { esc } = UI;
const nf = (v, c = 0) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c });
const moeda = v => v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/* ------------------------------------------------------------------ estado */
let USER, PODE;
const state = {
  aba: 'dashboard',
  competenciaId: null,
  competencia: null,
  competencias: [],
  painel: null,          // consolidação (cache por render)
  secao: 'reclamacoes',  // subaba dos cadastros
  filtro: '',
  importacao: null,      // wizard em andamento
  observacoesSlides: {},
  resumoEditado: null
};

/* Filtros persistentes (§49) — por usuário, só preferência de navegação. */
const LS = 'rna_fm_prefs';
function salvarPrefs() {
  try {
    localStorage.setItem(LS, JSON.stringify({
      competenciaId: state.competenciaId, aba: state.aba, secao: state.secao
    }));
  } catch { /* modo privado: seguir sem persistir */ }
}
function lerPrefs() {
  try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch { return {}; }
}

/* ------------------------------------------------------------------ início */
/* O bootstrap fica no FIM do arquivo (procure por "arranque"). Com top-level
   await, iniciar aqui em cima executaria antes das constantes declaradas
   abaixo — e a rejeição de um top-level await não aparece no console, o que
   deixaria a tela em branco sem nenhuma pista. */

function configurarPermissoes(user) {
  USER = user;
  PODE = {
    lancar:     SCHEMA.podeFechamento(USER.role, 'lancar')     && can(USER.role, 'fechamento', 'create'),
    editar:     SCHEMA.podeFechamento(USER.role, 'lancar')     && can(USER.role, 'fechamento', 'edit'),
    excluir:    SCHEMA.podeFechamento(USER.role, 'excluir')    && can(USER.role, 'fechamento', 'delete'),
    aprovar:    SCHEMA.podeFechamento(USER.role, 'aprovar')    && can(USER.role, 'fechamento', 'approve'),
    importar:   SCHEMA.podeFechamento(USER.role, 'importar'),
    configurar: SCHEMA.podeFechamento(USER.role, 'configurar'),
    reabrir:    SCHEMA.podeFechamento(USER.role, 'reabrir'),
    gerar:      SCHEMA.podeFechamento(USER.role, 'gerar')
  };
}

/* ------------------------------------------------------------ guarda de rota
   §8 — antes de carregar QUALQUER coisa: sessão válida, cadastro ativo e
   aprovado, perfil administrador. mountShell já recusa o módulo pelo RBAC; esta
   é a segunda barreira, específica do fechamento, e a que emite a mensagem
   exigida pelo requisito. A terceira e definitiva é o RLS (fm_is_admin). */
function bloquearAcesso() {
  document.title = 'Acesso não autorizado · RNA One';
  $('#rna-content').innerHTML = `
    <div class="rna-page-head"><div>
      <div class="rna-breadcrumb"><a href="index.html">Portal</a></div>
      <h1>Acesso não autorizado</h1></div></div>
    ${UI.aviso(`<b>Acesso não autorizado. Esta área está disponível exclusivamente para administradores.</b>
      <div style="margin-top:10px"><a class="rna-btn rna-btn-primary rna-btn-sm" href="index.html">
        <i class="bi bi-house-door"></i> Voltar ao portal</a></div>`, 'erro')}`;
}

async function iniciar() {
  if (!SCHEMA.podeAcessarFechamento(USER)) { bloquearAcesso(); return; }

  const prefs = lerPrefs();
  /* A âncora da URL manda mais que a preferência salva: é como o submenu da
     sidebar e os links compartilhados chegam numa área específica. */
  state.aba = areaDaURL() || prefs.aba || 'dashboard';
  state.secao = prefs.secao || 'reclamacoes';
  /* A URL passa a identificar a área desde o primeiro render — sem isso,
     recarregar a página cairia no Dashboard mesmo vindo de "#custos". */
  history.replaceState(null, '', `#${state.aba}`);

  window.addEventListener('hashchange', () => {
    const a = areaDaURL();
    if (a && a !== state.aba) { state.aba = a; salvarPrefs(); render(); }
  });

  await verificarEstrutura();
}

/** Lê a área a partir de `fechamento-mensal.html#custos`. */
function areaDaURL() {
  const h = (location.hash || '').replace(/^#/, '').trim();
  return SCHEMA.areaPorId(h) ? h : null;
}

/**
 * Verifica a estrutura e, se estiver tudo certo, abre o módulo.
 * Usada no arranque e pelo botão "Verificar estrutura novamente" (§20).
 */
async function verificarEstrutura({ renovar = false } = {}) {
  /* Desenha a moldura ANTES de consultar o banco: o diagnóstico e a lista de
     competências são idas ao servidor, e deixar a área de conteúdo em branco
     durante isso parece uma tela quebrada. */
  $('#rna-content').innerHTML = cabecalho() +
    `<div id="fm-corpo">${UI.skeletonCartoes(6)}</div>`;
  ligarAbas();

  if (renovar) await CORE.renovarSessao();

  const diag = await CORE.diagnostico();
  if (CORE.ehDesenvolvimento?.()) console.info('[FM] diagnóstico da estrutura:', diag);

  if (!diag.ok) { telaDiagnostico(diag); return; }

  state.competencias = await CORE.listarCompetencias().catch(() => []);
  const prefs = lerPrefs();
  state.competenciaId = prefs.competenciaId && state.competencias.some(c => c.id === prefs.competenciaId)
    ? prefs.competenciaId
    : (state.competencias[0]?.id || null);
  await render();
}

/** Tela de erro ESPECÍFICA por tipo de falha (§13/§19). */
function telaDiagnostico(diag) {
  const sessao = diag.tipo === CORE.DIAG.SESSAO;
  const semEstrutura = diag.tipo === CORE.DIAG.SEM_ESTRUTURA;

  const ficha = `<table class="fm-memoria-tabela" style="margin-top:12px">
      <tr><td>Projeto Supabase</td><td><b>${esc(diag.projeto || '—')}</b></td></tr>
      <tr><td>Host</td><td>${esc(diag.host || '—')}</td></tr>
      <tr><td>Schema</td><td>${esc(diag.schema)}</td></tr>
      ${diag.faltando?.length ? `<tr><td>Tabelas ausentes</td><td>${esc(diag.faltando.join(', '))}</td></tr>` : ''}
    </table>
    <div class="fm-form__hint" style="margin-top:8px">
      Confira se este é o mesmo projeto em que o SQL foi executado. Nenhuma chave é exibida aqui.</div>`;

  const orientacao = semEstrutura
    ? `<div style="margin-top:12px;font-size:12.5px">
        Rode <code>database/fechamento_mensal.sql</code> e depois
        <code>database/fix_fechamento_mensal_admin.sql</code> no SQL Editor deste projeto e
        finalize com <code>notify pgrst, 'reload schema';</code>.</div>` : '';

  $('#rna-content').innerHTML = cabecalho() + UI.aviso(
    `<b>${esc(diag.titulo)}</b><br>${esc(diag.mensagem)}
     ${diag.detalhe ? `<div class="fm-form__hint" style="margin-top:6px">${esc(diag.detalhe)}</div>` : ''}
     ${semEstrutura ? ficha + orientacao : ''}
     <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap">
       <button class="rna-btn rna-btn-primary rna-btn-sm" id="fm-reverificar">
         <i class="bi bi-arrow-clockwise"></i> Verificar estrutura novamente</button>
       ${sessao ? `<a class="rna-btn rna-btn-ghost rna-btn-sm" href="login.html">
         <i class="bi bi-box-arrow-in-right"></i> Entrar novamente</a>` : ''}
     </div>`,
    diag.tipo === CORE.DIAG.SEM_PERMISSAO ? 'alerta' : 'erro');

  /* Uma verificação por clique, e o botão desabilita enquanto roda: sem isso um
     duplo clique dispara duas rodadas de 9 consultas cada. */
  const btn = $('#fm-reverificar');
  btn?.addEventListener('click', async () => {
    btn.disabled = true;
    btn.innerHTML = '<i class="bi bi-hourglass-split"></i> Verificando...';
    try { await verificarEstrutura({ renovar: true }); }
    catch (e) {
      console.error('[FM] falha ao reverificar', e);
      toast(esc(e?.message || 'Falha ao verificar.'), { type: 'crit' });
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Verificar estrutura novamente';
    }
  });
}

/* ---------------------------------------------------------------- moldura */
const ABAS_ORDEM = SCHEMA.AREAS;

function cabecalho() {
  const area = SCHEMA.areaPorId(state.aba);
  return `<div class="rna-page-head"><div>
      <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i>
        <a href="fechamento-mensal.html#dashboard">Fechamento Mensal</a>
        ${area ? `<i class="bi bi-chevron-right"></i> ${esc(area.label)}` : ''}</div>
      <h1>Fechamento Mensal</h1>
      <p>Consolidação dos indicadores da Qualidade e geração da apresentação oficial da planta.</p>
    </div></div>
    ${navAreas()}`;
}

/** Navegação interna agrupada nas 6 seções do módulo (§3). */
function navAreas() {
  return `<div class="fm-nav no-print">${SCHEMA.AREAS_GRUPOS.map(g => {
    const itens = ABAS_ORDEM.filter(a => a.grupo === g);
    if (!itens.length) return '';
    return `<div class="fm-nav__grupo">
      <span class="fm-nav__titulo">${esc(g)}</span>
      <div class="fm-nav__itens">${itens.map(a =>
        `<button class="rna-chip ${a.id === state.aba ? 'active' : ''}" data-aba="${a.id}">
          <i class="bi ${a.icone}"></i> ${esc(a.label)}</button>`).join('')}</div>
    </div>`;
  }).join('')}</div>`;
}

/** Mantém o submenu da sidebar espelhando a aba aberta (inclusive quando ela
    veio da preferência salva, e não da âncora da URL). */
function sincronizarSidebar() {
  const alvo = `fechamento-mensal.html#${state.aba}`;
  $$('.rna-nav__sublink').forEach(a => {
    const ativo = a.getAttribute('href') === alvo;
    a.classList.toggle('active', ativo);
    if (ativo) {
      const g = a.closest('.rna-nav__subgroup');
      g?.classList.add('is-open');
      g?.querySelector('.rna-nav__subtoggle')?.setAttribute('aria-expanded', 'true');
    }
  });
}

function ligarAbas() {
  sincronizarSidebar();
  $$('[data-aba]').forEach(b => b.addEventListener('click', () => {
    state.aba = b.dataset.aba;
    /* Mantém a âncora em dia (link compartilhável e submenu da sidebar).
       replaceState em vez de location.hash: trocar o hash dispararia o
       hashchange e provocaria um render duplicado. */
    history.replaceState(null, '', `#${state.aba}`);
    salvarPrefs();
    render();
  }));
  $('#fm-seletor-comp')?.addEventListener('change', async e => {
    state.competenciaId = e.target.value;
    state.painel = null;
    salvarPrefs();
    await render();
  });
}

async function render() {
  const host = $('#rna-content');
  host.innerHTML = cabecalho() + `<div id="fm-corpo">${UI.skeletonCartoes(6)}</div>`;
  ligarAbas();

  state.competencia = state.competenciaId ? await CORE.obterCompetencia(state.competenciaId) : null;

  /* Sem competência, só faz sentido a aba Competências (e Configurações). */
  if (!state.competencia && !['competencias', 'config'].includes(state.aba)) {
    $('#fm-corpo').innerHTML = UI.cabecalhoCompetencia(null, { acoes: botaoNovaCompetencia() }) +
      UI.vazio('Nenhuma competência aberta',
        'Crie a primeira competência para começar a consolidar os indicadores do mês.',
        botaoNovaCompetencia());
    ligarNovaCompetencia();
    return;
  }

  const renderizadores = {
    dashboard: renderDashboard, competencias: renderCompetencias,
    externos: () => renderCadastros(['reclamacoes', 'fornecimento']),
    internos: () => renderCadastros(['ocorrencias', 'producao']),
    cruz: renderCruz, seguranca: () => renderCadastros(['seguranca']),
    quebras: () => renderCadastros(['quebras']),
    custos: () => renderCadastros(['custos', 'retrabalho', 'sucata']),
    care: () => renderCadastros(['care']),
    planos: renderPlanos, importacoes: renderImportacoes,
    pendencias: renderPendencias, previa: renderPrevia,
    aprovacao: renderAprovacao, geradas: renderGeradas,
    historico: renderHistorico, config: renderConfig
  };

  try {
    await (renderizadores[state.aba] || renderDashboard)();
  } catch (e) {
    console.error('[FM] falha ao renderizar', state.aba, e);
    $('#fm-corpo').innerHTML = UI.aviso(
      `<b>Não foi possível abrir esta área.</b><br>${esc(e?.message || 'Erro desconhecido.')}`, 'erro');
  }
}

/** Cabeçalho + conteúdo da aba, com os eventos comuns já ligados. */
function montar(html, { acoes = '' } = {}) {
  $('#fm-corpo').innerHTML =
    UI.cabecalhoCompetencia(state.competencia, {
      competencias: state.competencias, acoes,
      progresso: state.painel ? Number(state.competencia?.percentual || 0) : null
    }) + html;
  $('#fm-seletor-comp')?.addEventListener('change', async e => {
    state.competenciaId = e.target.value; state.painel = null; salvarPrefs(); await render();
  });
  $$('[data-memoria]').forEach(b => b.addEventListener('click', ev => {
    ev.stopPropagation();
    const card = state.painel?.cards?.[b.dataset.memoria];
    if (card) UI.modalMemoriaCalculo(card);
  }));
}

/** Consolida uma vez por navegação (o cálculo lê muitas tabelas). */
async function painel({ recarregar = false } = {}) {
  if (!state.painel || recarregar) {
    state.painel = await IND.consolidar(state.competencia);
    /* Pendências e progresso acompanham o dado — sincroniza a cada consolidação. */
    if (PODE.lancar && CORE.competenciaEditavel(state.competencia)) {
      await PEND.sincronizar(state.competencia, { user: USER, dados: state.painel.dados }).catch(e =>
        console.warn('[FM] pendências não sincronizadas:', e?.message));
      await CORE.sincronizarProgresso(state.competencia.id, USER).catch(() => {});
      state.competencia = await CORE.obterCompetencia(state.competencia.id);
      /* O seletor do cabeçalho mostra o status de cada competência: sem
         recarregar a lista, ele continuaria exibindo o status anterior. */
      state.competencias = await CORE.listarCompetencias().catch(() => state.competencias);
    }
  }
  return state.painel;
}

/* ========================================================================== */
/* DASHBOARD (§6)                                                              */
/* ========================================================================== */
const CARDS_DASHBOARD = [
  'reclamacoes', 'reclamacoes_negociadas', 'ppm_externo_oficial', 'ppm_externo_real',
  'ocorrencias', 'ppm_interno', 'dias_sem_reclamacao', 'quebras_externas',
  'quebras_internas', 'custo_qualidade', 'care_inspecoes', 'planos_atrasados',
  'pendencias', 'progresso'
];

async function renderDashboard() {
  const p = await painel();
  const d = p.detalhes;

  montar(`
    ${state.competencia.status === 'Fechado' ? UI.aviso(
      '<b>Competência fechada.</b> Os dados estão em somente leitura. Para editar, o administrador precisa reabrir formalmente (§46).', 'info') : ''}

    ${UI.gradeCartoes(p.cards, CARDS_DASHBOARD)}

    <div class="row g-3 mt-1">
      <div class="col-xl-8"><div class="rna-card h-100">
        <div class="rna-card__head"><h3><i class="bi bi-bar-chart-line"></i> Reclamações e PPM externo por mês</h3></div>
        <div class="rna-card__body"><div style="height:290px"><canvas id="g-externo"></canvas></div></div>
      </div></div>
      <div class="col-xl-4"><div class="rna-card h-100">
        <div class="rna-card__head"><h3><i class="bi bi-bullseye"></i> PPM oficial × real</h3></div>
        <div class="rna-card__body">
          <table class="fm-memoria-tabela">
            <tr><td>PPM oficial</td><td><b>${esc(p.cards.ppm_externo_oficial.exibicao)}</b></td></tr>
            <tr><td>PPM real</td><td><b>${esc(p.cards.ppm_externo_real.exibicao)}</b></td></tr>
            <tr><td>Diferença absoluta</td><td>${d.comparativoPPM.diferenca == null ? '—' : nf(d.comparativoPPM.diferenca) + ' PPM'}</td></tr>
            <tr><td>Diferença percentual</td><td>${d.comparativoPPM.diferencaPercentual == null ? '—' : nf(d.comparativoPPM.diferencaPercentual, 1) + '%'}</td></tr>
            <tr><td>Meta</td><td>${p.cards.ppm_externo_real.meta == null ? 'Sem meta cadastrada' : nf(p.cards.ppm_externo_real.meta)}</td></tr>
            <tr><td>Mês anterior</td><td>${p.cards.ppm_externo_real.anterior == null ? '—' : nf(p.cards.ppm_externo_real.anterior)}</td></tr>
            <tr><td>Acumulado anual</td><td><b>${esc(p.anual.ppm_externo_real?.exibicao || '—')}</b></td></tr>
          </table>
        </div>
      </div></div>

      <div class="col-xl-8"><div class="rna-card h-100">
        <div class="rna-card__head"><h3><i class="bi bi-diagram-2"></i> Ocorrências e PPM interno por mês</h3></div>
        <div class="rna-card__body"><div style="height:290px"><canvas id="g-interno"></canvas></div></div>
      </div></div>
      <div class="col-xl-4"><div class="rna-card h-100">
        <div class="rna-card__head"><h3><i class="bi bi-trophy"></i> Principais problemas</h3></div>
        <div class="rna-card__body">${UI.listaRanking(d.rankings.defeito.slice(0, 6),
          { vazio: 'Nenhuma ocorrência interna lançada nesta competência.' })}</div>
      </div></div>

      <div class="col-xl-6"><div class="rna-card h-100">
        <div class="rna-card__head"><h3><i class="bi bi-cash-coin"></i> Custo da qualidade por categoria</h3></div>
        <div class="rna-card__body">
          ${d.custo.porCategoria.length
            ? `<div style="height:240px"><canvas id="g-custos"></canvas></div>
               <table class="fm-memoria-tabela" style="margin-top:12px">
                 <tr><td>Custo no mês</td><td><b>${moeda(d.custo.valor)}</b></td></tr>
                 <tr><td>Limite mensal</td><td>${d.custo.limite == null ? 'Sem limite configurado' : moeda(d.custo.limite)}</td></tr>
                 <tr><td>Acumulado do ano</td><td>${moeda(p.anual.custo_qualidade?.soma)}</td></tr>
                 <tr><td>Custo por peça produzida</td><td>${d.custo.custoPorPeca == null ? 'Sem base de produção' : moeda(d.custo.custoPorPeca)}</td></tr>
               </table>`
            : UI.vazio('Sem custos lançados', 'Lance os custos da qualidade na aba Custos da Qualidade.')}
        </div>
      </div></div>
      <div class="col-xl-6"><div class="rna-card h-100">
        <div class="rna-card__head"><h3><i class="bi bi-plus-square"></i> Cruz da Qualidade</h3>
          <button class="rna-btn rna-btn-ghost rna-btn-sm" data-aba="cruz">Abrir</button></div>
        <div class="rna-card__body">${UI.cruzQualidade(d.cruz, { competencia: state.competencia })}</div>
      </div></div>

      <div class="col-12"><div class="rna-card">
        <div class="rna-card__head"><h3><i class="bi bi-card-text"></i> Resumo das atualizações</h3>
          <span class="cell-sub">Gerado a partir dos dados reais — sem inferir causas (§33)</span></div>
        <div class="rna-card__body">${renderResumo(p)}</div>
      </div></div>
    </div>
  `);

  ligarAbas();
  desenharGraficosDashboard(p);
  $('#fm-resumo-editar')?.addEventListener('click', editarResumo);
}

function renderResumo(p) {
  const frases = state.resumoEditado ?? IND.gerarResumo(p);
  if (!frases.length) {
    return UI.vazio('Sem mudanças a relatar',
      'O resumo compara esta competência com a anterior. Sem lançamentos ou sem mês anterior, não há o que comparar.');
  }
  return `<ul style="margin:0;padding-left:20px;line-height:1.9;font-size:13.5px">
      ${frases.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
    <button class="rna-btn rna-btn-ghost rna-btn-sm mt-3" id="fm-resumo-editar">
      <i class="bi bi-pencil"></i> Editar texto antes de usar na apresentação</button>`;
}

function editarResumo() {
  const frases = state.resumoEditado ?? IND.gerarResumo(state.painel);
  const m = modal({
    title: 'Resumo das atualizações',
    size: 'modal-lg',
    content: `<p class="fm-form__hint" style="margin-bottom:10px">
        Uma frase por linha. O texto editado é o que vai para o slide de pendências — o sistema
        não inventa causas nem justificativas (§33).</p>
      <textarea id="fm-resumo-txt" class="form-control" rows="10"
        style="font-size:13.5px;line-height:1.7">${esc(frases.join('\n'))}</textarea>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-ghost" id="fm-resumo-reset">Restaurar automático</button>
             <button class="rna-btn rna-btn-primary" id="fm-resumo-ok">Salvar texto</button>`
  });
  $('#fm-resumo-reset', m.host).addEventListener('click', () => {
    state.resumoEditado = null; m.close(); render();
  });
  $('#fm-resumo-ok', m.host).addEventListener('click', () => {
    state.resumoEditado = $('#fm-resumo-txt', m.host).value.split('\n').map(s => s.trim()).filter(Boolean);
    m.close();
    toast('Resumo salvo para esta sessão.', { type: 'ok' });
    render();
  });
}

function desenharGraficosDashboard(p) {
  const labels = SCHEMA.MESES.map(m => m.slice(0, 3));
  UI.graficoMensal('g-externo', {
    labels,
    series: [
      { nome: 'Reclamações oficiais', dados: serie(p.anual.reclamacoes) },
      { nome: 'PPM externo oficial', tipo: 'linha', eixo: 'direito', dados: serie(p.anual.ppm_externo_oficial) }
    ],
    meta: null
  });
  UI.graficoMensal('g-interno', {
    labels,
    series: [
      { nome: 'Ocorrências', dados: serie(p.anual.ocorrencias) },
      { nome: 'PPM interno', tipo: 'linha', eixo: 'direito', dados: serie(p.anual.ppm_interno) }
    ]
  });
  if (p.detalhes.custo.porCategoria.length) {
    UI.charts.doughnut('g-custos',
      p.detalhes.custo.porCategoria.map(c => c.chave),
      p.detalhes.custo.porCategoria.map(c => c.valor),
      [UI.PALETTE.yellow, UI.PALETTE.blue, UI.PALETTE.green, UI.PALETTE.orange, UI.PALETTE.red, UI.PALETTE.gray]);
  }
}
const serie = acc => acc?.serie ? acc.serie.map(s => s.valor) : Array(12).fill(null);

/* ========================================================================== */
/* COMPETÊNCIAS (§3, §5)                                                       */
/* ========================================================================== */
/* O botão aparece em dois lugares na mesma tela (cabeçalho e estado vazio).
   Usa CLASSE, não id: dois elementos com o mesmo id deixariam o segundo sem
   listener — e o botão do estado vazio é justamente o que o usuário clica
   quando ainda não existe competência nenhuma. */
function botaoNovaCompetencia() {
  return PODE.aprovar
    ? `<button class="rna-btn rna-btn-primary js-nova-comp"><i class="bi bi-plus-lg"></i> Nova competência</button>`
    : '';
}

async function renderCompetencias() {
  const comps = state.competencias;
  montar(`
    <div class="rna-card">
      <div class="rna-card__head"><h3><i class="bi bi-calendar3"></i> Competências
        <span class="rna-badge badge-info">${comps.length}</span></h3>${botaoNovaCompetencia()}</div>
      <div class="rna-table-wrap">${comps.length ? `<table class="rna-table">
        <thead><tr><th>Competência</th><th>Planta</th><th>Período</th><th>Responsável</th>
          <th>Progresso</th><th>Versão</th><th>Status</th><th></th></tr></thead>
        <tbody>${comps.map(c => `<tr>
          <td class="cell-strong">${SCHEMA.MESES[c.mes - 1]} ${c.ano}<div class="cell-sub">${esc(c.competencia || '')}</div></td>
          <td class="cell-sub">${esc(c.planta)}</td>
          <td class="cell-sub">${formatarDataBrasil(c.data_inicial)} a ${formatarDataBrasil(c.data_final)}</td>
          <td class="cell-sub">${esc(c.responsavel || '—')}</td>
          <td style="min-width:110px">
            <div class="fm-rank__barra"><i style="width:${Math.min(100, Number(c.percentual || 0))}%"></i></div>
            <div class="cell-sub">${nf(c.percentual)}%</div></td>
          <td><span class="rna-badge badge-na">${esc(c.versao || 'V0')}</span></td>
          <td>${UI.seloStatus(c.status)}</td>
          <td class="text-end">
            <button class="rna-btn rna-btn-ghost rna-btn-sm" data-abrir="${c.id}"><i class="bi bi-box-arrow-in-right"></i> Abrir</button>
            ${c.status === 'Fechado' && PODE.aprovar ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-proximo="${c.id}"
              title="Criar a competência seguinte (§5)"><i class="bi bi-calendar-plus"></i> Próximo mês</button>` : ''}
            ${c.status === 'Fechado' && PODE.reabrir ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-reabrir="${c.id}"
              title="Reabertura formal (§46)"><i class="bi bi-unlock"></i></button>` : ''}
          </td>
        </tr>`).join('')}</tbody></table>`
        : UI.vazio('Nenhuma competência criada',
            'A competência é o contêiner de tudo: reclamações, ocorrências, custos e a apresentação do mês.',
            botaoNovaCompetencia())}
      </div>
    </div>`);

  ligarNovaCompetencia();
  $$('[data-abrir]').forEach(b => b.addEventListener('click', async () => {
    state.competenciaId = b.dataset.abrir; state.painel = null; state.aba = 'dashboard';
    salvarPrefs(); await render();
  }));
  $$('[data-proximo]').forEach(b => b.addEventListener('click', () => criarProximoMes(b.dataset.proximo)));
  $$('[data-reabrir]').forEach(b => b.addEventListener('click', () => abrirReabertura(b.dataset.reabrir)));
}

function ligarNovaCompetencia() {
  $$('.js-nova-comp').forEach(btn => btn.addEventListener('click', () => {
    const hoje = hojeBR();
    const anoAtual = Number(hoje.slice(0, 4));
    const mesAtual = Number(hoje.slice(5, 7));
    const m = modal({
      title: 'Nova competência',
      content: `<div class="fm-form" style="grid-template-columns:repeat(2,1fr)">
        <div class="fm-form__campo fm-form__campo--2">
          <label>Planta <span class="req">*</span></label>
          <select id="nc-planta">${PLANTAS.map(p => `<option>${esc(p)}</option>`).join('')}</select></div>
        <div class="fm-form__campo"><label>Mês <span class="req">*</span></label>
          <select id="nc-mes">${SCHEMA.MESES.map((mm, i) =>
            `<option value="${i + 1}" ${i + 1 === mesAtual ? 'selected' : ''}>${mm}</option>`).join('')}</select></div>
        <div class="fm-form__campo"><label>Ano <span class="req">*</span></label>
          <input type="number" id="nc-ano" value="${anoAtual}" min="2000" max="2100"></div>
        <div class="fm-form__campo fm-form__campo--2"><label>Responsável principal</label>
          <input id="nc-resp" value="Garantia da Qualidade"></div>
        <div class="fm-form__campo fm-form__campo--2"><label>Observações</label>
          <textarea id="nc-obs"></textarea></div>
      </div>
      <div class="fm-aviso fm-aviso--info" style="margin-top:14px"><i class="bi bi-info-circle"></i>
        Só existe uma competência por planta/mês/ano. Se já houver, o sistema avisa em vez de duplicar.</div>`,
      footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
               <button class="rna-btn rna-btn-primary" id="nc-ok"><i class="bi bi-check2"></i> Criar competência</button>`
    });
    $('#nc-ok', m.host).addEventListener('click', async () => {
      try {
        loading(true);
        const nova = await CORE.criarCompetencia({
          planta: $('#nc-planta', m.host).value,
          mes: Number($('#nc-mes', m.host).value),
          ano: Number($('#nc-ano', m.host).value),
          responsavel: $('#nc-resp', m.host).value,
          observacoes: $('#nc-obs', m.host).value
        }, USER);
        m.close();
        state.competencias = await CORE.listarCompetencias();
        state.competenciaId = nova.id; state.painel = null; state.aba = 'dashboard';
        salvarPrefs();
        toast(`Competência ${SCHEMA.MESES[nova.mes - 1]}/${nova.ano} criada.`, { type: 'ok' });
        await render();
      } catch (e) {
        toast(esc(e.message), { type: 'crit', title: 'Não foi possível criar', timeout: 8000 });
      } finally { loading(false); }
    });
  }));
}

async function criarProximoMes(compId) {
  try {
    loading(true);
    const comp = await CORE.obterCompetencia(compId);
    const r = await CORE.criarProximaCompetencia(compId, USER);
    state.competencias = await CORE.listarCompetencias();
    if (r.jaExistia) {
      toast(`A competência seguinte já existia (${SCHEMA.MESES[r.competencia.mes - 1]}/${r.competencia.ano}). Abrindo.`, { type: 'info' });
    } else {
      toast(`${SCHEMA.MESES[r.competencia.mes - 1]}/${r.competencia.ano} criada. Dados mensais zerados; planos de ação abertos continuam sendo acompanhados sem duplicar (§5).`,
        { type: 'ok', timeout: 8000 });
    }
    state.competenciaId = r.competencia.id; state.painel = null; salvarPrefs();
    await render();
  } catch (e) {
    toast(esc(e.message), { type: 'crit', title: 'Não foi possível abrir o próximo mês' });
  } finally { loading(false); }
}

function abrirReabertura(compId) {
  const m = modal({
    title: 'Reabrir competência fechada',
    content: `${UI.aviso('A versão final e os arquivos já gerados são <b>preservados</b>. A reabertura fica registrada na trilha de auditoria (§46).', 'alerta')}
      <div class="fm-form" style="grid-template-columns:1fr">
        <div class="fm-form__campo"><label>Motivo da reabertura <span class="req">*</span></label>
          <textarea id="rb-motivo" placeholder="Descreva por que a competência precisa ser reaberta"></textarea></div>
        <div class="fm-form__campo"><label>Responsável autorizador</label>
          <input id="rb-autorizador" placeholder="Quem autorizou formalmente"></div>
      </div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-dark" id="rb-ok"><i class="bi bi-unlock"></i> Reabrir</button>`
  });
  $('#rb-ok', m.host).addEventListener('click', async () => {
    try {
      loading(true);
      await CORE.reabrirCompetencia(compId, {
        motivo: $('#rb-motivo', m.host).value,
        autorizador: $('#rb-autorizador', m.host).value,
        user: USER
      });
      m.close();
      state.competencias = await CORE.listarCompetencias();
      state.painel = null;
      toast('Competência reaberta. O histórico anterior foi preservado.', { type: 'ok' });
      await render();
    } catch (e) {
      toast(esc(e.message), { type: 'crit', title: 'Não foi possível reabrir' });
    } finally { loading(false); }
  });
}

/* ========================================================================== */
/* CADASTROS GENÉRICOS (§7, §12, §14, §17, §18, §19, §20, §21, §22)            */
/* ========================================================================== */

async function renderCadastros(secoes) {
  if (!secoes.includes(state.secao)) state.secao = secoes[0];
  const spec = SCHEMA.SECOES[state.secao];
  const registros = await REG.listar(state.secao, state.competencia.id);
  const editavel = CORE.competenciaEditavel(state.competencia);

  const filtrados = state.filtro
    ? registros.filter(r => JSON.stringify(r).toLowerCase().includes(state.filtro.toLowerCase()))
    : registros;

  montar(`
    ${secoes.length > 1 ? `<div class="fm-secao-nav">${secoes.map(s =>
      `<button class="rna-chip ${s === state.secao ? 'active' : ''}" data-secao="${s}">
        <i class="bi ${SCHEMA.SECOES[s].icone}"></i> ${esc(SCHEMA.SECOES[s].label)}</button>`).join('')}</div>` : ''}

    ${!editavel ? UI.aviso(`Competência <b>${esc(state.competencia.status)}</b> — os lançamentos estão em somente leitura.`, 'info') : ''}

    ${await resumoDaSecao(state.secao, registros)}

    <div class="rna-card">
      <div class="rna-card__head">
        <h3><i class="bi ${spec.icone}"></i> ${esc(spec.label)}
          <span class="rna-badge badge-info">${registros.length}</span></h3>
        <div class="d-flex gap-2">
          ${registros.length ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" id="fm-exportar"><i class="bi bi-download"></i> Exportar CSV</button>` : ''}
          ${editavel && PODE.lancar ? `<button class="rna-btn rna-btn-primary rna-btn-sm" id="fm-novo">
            <i class="bi bi-plus-lg"></i> Novo lançamento</button>` : ''}
        </div>
      </div>
      <div class="rna-card__body" style="padding-bottom:0">
        <div class="fm-toolbar">
          <input type="search" id="fm-busca" placeholder="Buscar nesta seção..." value="${esc(state.filtro)}" style="min-width:240px">
          <span class="cell-sub">${filtrados.length} de ${registros.length} registro(s)</span>
        </div>
      </div>
      <div class="rna-table-wrap">
        ${filtrados.length ? tabelaSecao(spec, filtrados, editavel) : UI.vazio(
          registros.length ? 'Nenhum registro corresponde à busca' : `Nenhum lançamento em ${spec.label}`,
          registros.length ? 'Ajuste os termos da busca.'
            : 'Os indicadores desta seção só aparecem depois do primeiro lançamento — nada é estimado.',
          editavel && PODE.lancar ? `<button class="rna-btn rna-btn-primary" id="fm-novo-2"><i class="bi bi-plus-lg"></i> Novo lançamento</button>` : '')}
      </div>
    </div>`);

  $$('[data-secao]').forEach(b => b.addEventListener('click', () => {
    state.secao = b.dataset.secao; state.filtro = ''; salvarPrefs(); render();
  }));
  $('#fm-busca')?.addEventListener('input', e => {
    state.filtro = e.target.value;
    clearTimeout(window.__fmBusca);
    window.__fmBusca = setTimeout(() => render(), 250);
  });
  $('#fm-novo')?.addEventListener('click', () => abrirFormulario(state.secao));
  $('#fm-novo-2')?.addEventListener('click', () => abrirFormulario(state.secao));
  $('#fm-exportar')?.addEventListener('click', () => exportarCSV(spec, registros));
  $$('[data-editar]').forEach(b => b.addEventListener('click', () => abrirFormulario(state.secao, b.dataset.editar)));
  $$('[data-excluir]').forEach(b => b.addEventListener('click', () => excluirRegistro(state.secao, b.dataset.excluir)));
}

function tabelaSecao(spec, registros, editavel) {
  const cols = spec.colunas.map(k => spec.campos.find(c => c.k === k)).filter(Boolean);
  return `<table class="rna-table">
    <thead><tr>${cols.map(c => `<th>${esc(c.l)}</th>`).join('')}<th>Origem</th><th></th></tr></thead>
    <tbody>${registros.map(r => `<tr>
      ${cols.map(c => `<td${c === cols[0] ? ' class="cell-strong"' : ''}>${valorCelula(c, r[c.k])}</td>`).join('')}
      <td>${UI.seloOrigem(r.origem || 'manual')}</td>
      <td class="text-end" style="white-space:nowrap">
        ${editavel && PODE.editar ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-editar="${r.id}" title="Editar"><i class="bi bi-pencil"></i></button>` : ''}
        ${editavel && PODE.excluir ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-excluir="${r.id}" title="Excluir"><i class="bi bi-trash text-danger"></i></button>` : ''}
      </td></tr>`).join('')}</tbody></table>`;
}

function valorCelula(campo, v) {
  if (v == null || v === '') return '<span class="cell-sub">—</span>';
  switch (campo.t) {
    case 'date':  return formatarDataBrasil(v);
    case 'money': return moeda(v);
    case 'number': return nf(v);
    case 'bool':  return v ? '<i class="bi bi-check-circle-fill" style="color:var(--rna-ok)" title="Sim"></i> Sim'
                           : '<span class="cell-sub">Não</span>';
    default: {
      const t = String(v);
      if (campo.k === 'status') {
        const cls = { 'Concluída': 'badge-ok', 'Concluído': 'badge-ok', 'Cancelada': 'badge-na',
                      'Atrasada': 'badge-crit', 'Atrasado': 'badge-crit', 'Aberta': 'badge-warn' }[t] || 'badge-info';
        return `<span class="rna-badge ${cls}">${esc(t)}</span>`;
      }
      if (campo.k === 'tipo' && ['externa', 'interna'].includes(t)) {
        return `<span class="rna-badge badge-na">${t === 'externa' ? 'Externa' : 'Interna'}</span>`;
      }
      return esc(t.length > 52 ? t.slice(0, 51) + '…' : t);
    }
  }
}

/** Cabeçalho analítico da seção — o número que a seção produz (§6). */
async function resumoDaSecao(secaoId, registros) {
  const p = await painel();
  const chaves = {
    reclamacoes:  ['reclamacoes', 'reclamacoes_negociadas', 'ppm_externo_oficial', 'ppm_externo_real', 'dias_sem_reclamacao'],
    fornecimento: ['ppm_externo_oficial', 'ppm_externo_real'],
    ocorrencias:  ['ocorrencias', 'ppm_interno'],
    producao:     ['ppm_interno'],
    custos:       ['custo_qualidade'],
    retrabalho:   ['retrabalho'],
    sucata:       ['sucata_ppm'],
    care:         ['care_inspecoes', 'care_percentual_ng'],
    quebras:      ['quebras_externas', 'quebras_internas'],
    seguranca:    ['seguranca_eventos']
  }[secaoId] || [];

  if (!chaves.length) return '';
  let extra = '';
  if (secaoId === 'fornecimento') {
    const total = CALC.soma(registros, 'qtd_fornecida');
    extra = UI.aviso(`Total de peças fornecidas na competência: <b>${nf(total)}</b>. ` +
      (total ? 'Este é o denominador do PPM externo.' : 'Sem esse número o PPM externo não pode ser calculado.'),
      total ? 'info' : 'alerta');
  }
  if (secaoId === 'producao') {
    const total = CALC.soma(registros, 'qtd_fabricada');
    extra = UI.aviso(`Total de peças fabricadas: <b>${nf(total)}</b>. ` +
      (total ? 'Este é o denominador do PPM interno.' : 'Sem esse número o PPM interno não pode ser calculado.'),
      total ? 'info' : 'alerta');
  }
  return `${extra}<div style="margin-bottom:16px">${UI.gradeCartoes(p.cards, chaves)}</div>`;
}

/* ------------------------------------------------------------- formulário */

async function abrirFormulario(secaoId, id = null) {
  const spec = SCHEMA.SECOES[secaoId];
  const registro = id ? await REG.obter(secaoId, id) : {};
  const opcoes = await carregarOpcoes(spec);

  const m = modal({
    title: `${id ? 'Editar' : 'Novo'} — ${spec.label}`,
    size: 'modal-xl',
    content: `<form id="fm-form" class="fm-form">${spec.campos.map(c => campoHTML(c, registro, opcoes)).join('')}</form>
      ${id && secaoId === 'producao' ? `<div class="fm-form__campo" style="margin-top:12px">
        <label>Justificativa da correção <span class="req">*</span></label>
        <textarea id="fm-justificativa" placeholder="Correções na base de produção exigem justificativa (§14)"></textarea></div>` : ''}
      <div id="fm-erros"></div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-primary" id="fm-salvar"><i class="bi bi-check2"></i> Salvar</button>`
  });

  /* Campos condicionais (§7 negociação) reagem ao vivo. */
  const atualizarCondicionais = () => {
    const dados = lerFormulario(spec, m.host);
    spec.campos.filter(c => c.showIf).forEach(c => {
      const wrap = $(`[data-campo-wrap="${c.k}"]`, m.host);
      if (wrap) wrap.style.display = c.showIf(dados) ? '' : 'none';
    });
  };
  $$('input,select,textarea', m.host).forEach(i => i.addEventListener('change', atualizarCondicionais));
  atualizarCondicionais();

  $('#fm-salvar', m.host).addEventListener('click', async () => {
    const dados = lerFormulario(spec, m.host);
    $('#fm-erros', m.host).innerHTML = '';
    $$('.is-erro', m.host).forEach(x => x.classList.remove('is-erro'));

    try {
      loading(true);
      await REG.salvar(secaoId, dados, {
        id, competencia: state.competencia, user: USER,
        justificativa: $('#fm-justificativa', m.host)?.value || ''
      });
      m.close();
      state.painel = null;
      toast(`${spec.label}: registro ${id ? 'atualizado' : 'lançado'}.`, { type: 'ok' });
      await render();
    } catch (e) {
      const erros = e.erros || [{ campo: null, mensagem: e.message }];
      $('#fm-erros', m.host).innerHTML = UI.aviso(
        `<b>Não foi possível salvar.</b><ul style="margin:6px 0 0;padding-left:18px">
          ${erros.map(x => `<li>${esc(x.mensagem)}</li>`).join('')}</ul>`, 'erro');
      erros.forEach(x => { if (x.campo) $(`[name="${x.campo}"]`, m.host)?.classList.add('is-erro'); });
      $('#fm-erros', m.host).scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } finally { loading(false); }
  });
}

function campoHTML(c, r, opcoes) {
  const v = r[c.k];
  const cls = `fm-form__campo ${c.col === 4 ? 'fm-form__campo--4' : c.col === 2 ? 'fm-form__campo--2' : ''}`;
  const label = `<label>${esc(c.l)}${c.req ? '<span class="req">*</span>' : ''}</label>`;
  const hint = c.hint ? `<span class="fm-form__hint">${esc(c.hint)}</span>` : '';
  let campo;

  if (c.t === 'bool') {
    return `<div class="${cls}" data-campo-wrap="${c.k}"><div class="fm-form__check">
      <input type="checkbox" name="${c.k}" id="f-${c.k}" ${v ? 'checked' : ''}>
      <label for="f-${c.k}" style="margin:0">${esc(c.l)}</label></div>${hint}</div>`;
  }
  if (c.t === 'select') {
    const lista = Array.isArray(c.opts) ? c.opts : (opcoes[c.opts] || []);
    campo = `<select name="${c.k}">
      <option value="">— selecione —</option>
      ${lista.map(o => {
        const [val, lab] = Array.isArray(o) ? o : [o, o];
        return `<option value="${esc(val)}" ${String(v) === String(val) ? 'selected' : ''}>${esc(lab)}</option>`;
      }).join('')}</select>`;
  } else if (c.t === 'textarea') {
    campo = `<textarea name="${c.k}">${esc(v ?? '')}</textarea>`;
  } else if (c.t === 'readonly') {
    campo = `<input name="${c.k}" value="${esc(v ?? '')}" readonly style="background:#f6f8f9">`;
  } else {
    const tipo = c.t === 'date' ? 'date' : (c.t === 'number' || c.t === 'money') ? 'text' : 'text';
    const modo = (c.t === 'number' || c.t === 'money') ? ' inputmode="decimal"' : '';
    campo = `<input type="${tipo}" name="${c.k}"${modo} value="${esc(v ?? '')}"
      ${c.min != null ? `data-min="${c.min}"` : ''}>`;
  }
  return `<div class="${cls}" data-campo-wrap="${c.k}">${label}${campo}${hint}</div>`;
}

function lerFormulario(spec, host) {
  const dados = {};
  for (const c of spec.campos) {
    const input = $(`[name="${c.k}"]`, host);
    if (!input) continue;
    dados[c.k] = c.t === 'bool' ? input.checked : input.value;
  }
  return dados;
}

/** Opções dinâmicas dos selects (clientes, ocorrências, ações, quebras). */
async function carregarOpcoes(spec) {
  const precisa = new Set(spec.campos.filter(c => typeof c.opts === 'string').map(c => c.opts));
  const out = {};
  if (precisa.has('clientes')) {
    const aliases = await CLI.listar().catch(() => []);
    out.clientes = aliases.map(a => a.nome_oficial);
    if (!out.clientes.length) {
      const bib = await db.list('bib_clientes').catch(() => []);
      out.clientes = bib.filter(c => c.ativo !== false).map(c => c.nome);
    }
  }
  if (precisa.has('ocorrencias')) {
    const rows = await REG.listar('ocorrencias', state.competencia.id).catch(() => []);
    out.ocorrencias = rows.map(o => [o.id, `${formatarDataBrasil(o.data)} · ${o.part_number || '—'} · ${o.tipo_defeito || '—'}`]);
  }
  if (precisa.has('acoes')) {
    const rows = await CORE.acoesVigentes(state.competencia).catch(() => []);
    out.acoes = rows.map(a => [a.id, `${String(a.what || a.problema || '').slice(0, 50)} · ${a.who || '—'}`]);
  }
  if (precisa.has('quebras')) {
    const rows = await REG.listar('quebras', state.competencia.id).catch(() => []);
    out.quebras = rows.map(q => [q.id, `${q.tipo} · ${q.part_number || '—'} · ${formatarDataBrasil(q.data_quebra)}`]);
  }
  return out;
}

function excluirRegistro(secaoId, id) {
  confirmDialog(
    'Excluir este lançamento? Ele sai das listas e dos cálculos, mas continua registrado na trilha de auditoria com quem excluiu e quando (§47).',
    async () => {
      try {
        await REG.excluir(secaoId, id, { competencia: state.competencia, user: USER, motivo: 'Exclusão pela interface' });
        state.painel = null;
        toast('Lançamento excluído.', { type: 'ok' });
        await render();
      } catch (e) {
        toast(esc(e.message), { type: 'crit', title: 'Não foi possível excluir' });
      }
    }, { title: 'Confirmar exclusão', okLabel: 'Excluir', danger: true });
}

function exportarCSV(spec, registros) {
  const cols = spec.campos.map(c => c.k);
  const cabec = spec.campos.map(c => c.l);
  const linhas = registros.map(r => cols.map(k => {
    const v = r[k];
    const t = v == null ? '' : String(v);
    return `"${t.replace(/"/g, '""')}"`;
  }).join(';'));
  const csv = '﻿' + [cabec.join(';'), ...linhas].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${spec.label} - ${state.competencia.competencia?.replace('/', '-')}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('Arquivo CSV exportado.', { type: 'ok' });
}

/* ========================================================================== */
/* CRUZ DA QUALIDADE (§16)                                                     */
/* ========================================================================== */
async function renderCruz() {
  const p = await painel();
  const cruz = p.detalhes.cruz;

  montar(`
    <div class="rna-card">
      <div class="rna-card__head"><h3><i class="bi bi-plus-square"></i> Cruz da Qualidade —
        ${SCHEMA.MESES[state.competencia.mes - 1]} ${state.competencia.ano}</h3>
        ${PODE.configurar ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" id="fm-cruz-regras">
          <i class="bi bi-sliders"></i> Regras de cor</button>` : ''}</div>
      <div class="rna-card__body">${UI.cruzQualidade(cruz, { competencia: state.competencia })}</div>
    </div>`);

  $$('[data-dia]').forEach(d => d.addEventListener('click', () => abrirDia(d.dataset.dia, cruz)));
  $('#fm-cruz-regras')?.addEventListener('click', abrirRegrasCruz);
}

function abrirDia(dia, cruz) {
  const info = cruz.dias.find(d => d.dia === dia);
  if (!info) return;
  const editavel = CORE.competenciaEditavel(state.competencia) && PODE.lancar;

  const m = modal({
    title: `${formatarDataBrasil(dia)} — ${SCHEMA.CRUZ_CORES[info.status]?.label || info.status}`,
    size: 'modal-lg',
    content: `
      <table class="fm-memoria-tabela">
        <tr><td>Data</td><td>${formatarDataBrasil(dia)}</td></tr>
        <tr><td>Status</td><td><b>${esc(SCHEMA.CRUZ_CORES[info.status]?.label || info.status)}</b> — ${esc(info.motivo)}</td></tr>
        <tr><td>Quantidade de ocorrências</td><td>${nf(info.ocorrencias)}</td></tr>
        <tr><td>Quantidade de peças NG</td><td>${nf(info.pecasNG)}</td></tr>
        <tr><td>Quebras no dia</td><td>${nf(info.quebras)}</td></tr>
        <tr><td>Part Numbers</td><td>${info.partNumbers.length ? esc(info.partNumbers.join(', ')) : '—'}</td></tr>
        <tr><td>Origens</td><td>${info.origens.length ? esc(info.origens.join(', ')) : '—'}</td></tr>
        <tr><td>Responsáveis</td><td>${info.responsaveis.length ? esc(info.responsaveis.join(', ')) : '—'}</td></tr>
      </table>
      ${info.registros.length ? `<h6 style="font-size:13px;font-weight:700;margin:16px 0 6px">Ocorrências do dia</h6>
        <div class="rna-table-wrap"><table class="rna-table"><thead><tr>
          <th>Origem</th><th>Part Number</th><th>Defeito</th><th>Peças</th><th>Status</th></tr></thead>
          <tbody>${info.registros.map(r => `<tr>
            <td class="cell-sub">${esc(r.origem_ocorrencia || '—')}</td>
            <td class="cell-strong">${esc(r.part_number || '—')}</td>
            <td>${esc(r.tipo_defeito || '—')}</td>
            <td>${nf(r.qtd_pecas)}</td>
            <td><span class="rna-badge badge-info">${esc(r.status || '—')}</span></td>
          </tr>`).join('')}</tbody></table></div>` : ''}
      ${editavel ? `<h6 style="font-size:13px;font-weight:700;margin:18px 0 6px">Ajuste manual do dia</h6>
        <div class="fm-form" style="grid-template-columns:repeat(2,1fr)">
          <div class="fm-form__campo"><label>Status manual</label>
            <select id="cd-status">
              <option value="">— manter automático —</option>
              ${Object.entries(SCHEMA.CRUZ_CORES).map(([k, v]) =>
                `<option value="${k}" ${info.manual && info.status === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}
            </select></div>
          <div class="fm-form__campo"><label>Sem produção neste dia</label>
            <div class="fm-form__check"><input type="checkbox" id="cd-semprod"> <span>Marcar como sem produção</span></div></div>
          <div class="fm-form__campo fm-form__campo--2"><label>Justificativa</label>
            <textarea id="cd-just" placeholder="Obrigatória ao sobrepor o status automático">${esc(info.motivo && info.manual ? info.motivo : '')}</textarea></div>
          <div class="fm-form__campo fm-form__campo--2"><label>Observação</label>
            <textarea id="cd-obs">${esc(info.observacao || '')}</textarea></div>
        </div>` : ''}`,
    footer: editavel
      ? `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Fechar</button>
         <button class="rna-btn rna-btn-primary" id="cd-ok"><i class="bi bi-check2"></i> Salvar dia</button>`
      : `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Fechar</button>`
  });

  $('#cd-ok', m.host)?.addEventListener('click', async () => {
    const status = $('#cd-status', m.host).value || null;
    const just = $('#cd-just', m.host).value.trim();
    if (status && !just) {
      toast('Informe a justificativa para sobrepor o status automático do dia.', { type: 'warn' });
      return;
    }
    try {
      const existentes = await db.list('fm_cruz_dias');
      const atual = existentes.find(x => x.competencia_id === state.competencia.id && String(x.dia).slice(0, 10) === dia);
      const linha = {
        competencia_id: state.competencia.id, dia,
        status_manual: status, justificativa: just || null,
        sem_producao: $('#cd-semprod', m.host).checked,
        observacao: $('#cd-obs', m.host).value.trim() || null,
        updated_at: new Date().toISOString(), updated_by: USER.id
      };
      if (atual) await db.update('fm_cruz_dias', atual.id, linha);
      else await db.insert('fm_cruz_dias', { ...linha, created_at: new Date().toISOString(), created_by: USER.id });
      await CORE.logar({
        competencia_id: state.competencia.id, tabela: 'fm_cruz_dias', registro_id: atual?.id || dia,
        acao: atual ? 'update' : 'insert', campo: 'status_manual',
        valor_anterior: atual?.status_manual || null, valor_novo: status,
        justificativa: just, usuario_id: USER.id, usuario: USER.nome, perfil: USER.role
      });
      m.close();
      state.painel = null;
      toast('Dia atualizado na Cruz da Qualidade.', { type: 'ok' });
      await render();
    } catch (e) {
      toast(esc(CORE.mensagemErro(e, 'Cruz da Qualidade')), { type: 'crit' });
    }
  });
}

async function abrirRegrasCruz() {
  const r = await CORE.config('cruz_regras', state.competencia.planta, {});
  const m = modal({
    title: 'Regras de cor da Cruz da Qualidade',
    content: `<p class="fm-form__hint" style="margin-bottom:12px">
        A cor de cada dia é derivada destas regras (§16). Alterá-las recalcula a cruz inteira — o histórico
        de ocorrências não muda, apenas a leitura visual.</p>
      <div class="fm-form" style="grid-template-columns:repeat(2,1fr)">
        <div class="fm-form__campo"><label>Amarelo — mínimo de ocorrências</label>
          <input type="number" id="cr-am" value="${r.amarelo_min_ocorrencias ?? 1}" min="1"></div>
        <div class="fm-form__campo"><label>Vermelho — mínimo de ocorrências</label>
          <input type="number" id="cr-vo" value="${r.vermelho_min_ocorrencias ?? 1}" min="1"></div>
        <div class="fm-form__campo"><label>Vermelho — mínimo de peças NG</label>
          <input type="number" id="cr-vp" value="${r.vermelho_min_pecas ?? 10}" min="1"></div>
        <div class="fm-form__campo"><label>Preto — mínimo de peças NG</label>
          <input type="number" id="cr-pp" value="${r.preto_min_pecas ?? 100}" min="1"></div>
        <div class="fm-form__campo fm-form__campo--2"><div class="fm-form__check">
          <input type="checkbox" id="cr-pq" ${r.preto_quebra !== false ? 'checked' : ''}>
          <span>Quebra no dia torna o dia PRETO (crítico)</span></div></div>
      </div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-primary" id="cr-ok">Salvar regras</button>`
  });
  $('#cr-ok', m.host).addEventListener('click', async () => {
    try {
      await CORE.salvarConfig('cruz_regras', {
        amarelo_min_ocorrencias: Number($('#cr-am', m.host).value),
        vermelho_min_ocorrencias: Number($('#cr-vo', m.host).value),
        vermelho_min_pecas: Number($('#cr-vp', m.host).value),
        preto_min_pecas: Number($('#cr-pp', m.host).value),
        preto_quebra: $('#cr-pq', m.host).checked
      }, { planta: state.competencia.planta, user: USER });
      m.close(); state.painel = null;
      toast('Regras atualizadas — a Cruz foi recalculada.', { type: 'ok' });
      await render();
    } catch (e) { toast(esc(e.message), { type: 'crit' }); }
  });
}

/* ========================================================================== */
/* PLANOS 5W2H (§23)                                                           */
/* ========================================================================== */
async function renderPlanos() {
  const acoes = await CORE.acoesVigentes(state.competencia);
  const editavel = CORE.competenciaEditavel(state.competencia);
  const herdadas = acoes.filter(a => a.competencia_origem_id !== state.competencia.id);
  const atrasadas = acoes.filter(a => a.status === 'Atrasado');

  montar(`
    ${herdadas.length ? UI.aviso(
      `<b>${herdadas.length} plano(s) vieram de competências anteriores</b> e continuam em acompanhamento aqui.
       Eles não são duplicados: a mesma ação é referenciada até ser concluída (§5).`, 'info') : ''}
    ${atrasadas.length ? UI.aviso(`<b>${atrasadas.length} plano(s) atrasado(s)</b> — prazo vencido e ação não concluída.`, 'alerta') : ''}

    <div class="rna-card">
      <div class="rna-card__head">
        <h3><i class="bi bi-diagram-3"></i> Planos de Ação 5W2H
          <span class="rna-badge badge-info">${acoes.length}</span></h3>
        ${editavel && PODE.lancar ? `<button class="rna-btn rna-btn-primary rna-btn-sm" id="fm-novo-plano">
          <i class="bi bi-plus-lg"></i> Novo plano</button>` : ''}
      </div>
      <div class="rna-card__body">
        ${acoes.length ? `<div class="row g-3">${acoes.map(a => `
          <div class="col-md-6 col-xl-4" data-plano="${a.id}" style="cursor:pointer">
            ${UI.cartaoPlano(a, { competenciaAtual: state.competencia.id })}</div>`).join('')}</div>`
          : UI.vazio('Nenhum plano de ação',
              'Planos abertos aqui continuam visíveis nos meses seguintes até serem concluídos.',
              editavel && PODE.lancar ? `<button class="rna-btn rna-btn-primary" id="fm-novo-plano-2"><i class="bi bi-plus-lg"></i> Novo plano</button>` : '')}
      </div>
    </div>`);

  $('#fm-novo-plano')?.addEventListener('click', () => abrirFormulario('acoes'));
  $('#fm-novo-plano-2')?.addEventListener('click', () => abrirFormulario('acoes'));
  $$('[data-plano]').forEach(c => c.addEventListener('click', () => {
    if (editavel && PODE.editar) abrirFormulario('acoes', c.dataset.plano);
  }));
}

/* ========================================================================== */
/* IMPORTAÇÕES (§24 a §27)                                                     */
/* ========================================================================== */
async function renderImportacoes() {
  const importacoes = await IMP.listarImportacoes(state.competencia.id);
  const editavel = CORE.competenciaEditavel(state.competencia);

  montar(`
    ${UI.passosImportacao(state.importacao ? 3 : 0)}

    ${!PODE.importar ? UI.aviso('Seu perfil pode consultar as importações, mas não importar arquivos (§43).', 'info') : ''}

    ${editavel && PODE.importar ? `<div class="rna-card" style="margin-bottom:16px">
      <div class="rna-card__head"><h3><i class="bi bi-file-earmark-arrow-up"></i> Importar faturamento</h3></div>
      <div class="rna-card__body">
        <div class="fm-drop" id="fm-drop">
          <i class="bi bi-cloud-arrow-up"></i>
          <div style="font-weight:600;margin-top:8px">Selecione ou arraste a planilha de faturamento</div>
          <div class="fm-form__hint">Aceita .xlsx, .xls e .csv — nada é gravado antes da validação (§24)</div>
          <input type="file" id="fm-arquivo" accept=".xlsx,.xls,.csv" hidden>
        </div>
      </div>
    </div>` : ''}

    <div class="rna-card">
      <div class="rna-card__head"><h3><i class="bi bi-clock-history"></i> Versões importadas
        <span class="rna-badge badge-info">${importacoes.length}</span></h3></div>
      <div class="rna-table-wrap">${importacoes.length ? `<table class="rna-table">
        <thead><tr><th>Versão</th><th>Arquivo</th><th>Importado em</th><th>Usuário</th>
          <th>Registros</th><th>Erros</th><th>Alertas</th><th>Status</th><th></th></tr></thead>
        <tbody>${importacoes.map(i => `<tr>
          <td class="cell-strong">V${i.versao}</td>
          <td class="cell-sub">${esc(i.arquivo_nome || '—')}</td>
          <td class="cell-sub">${formatarDataHoraBrasil(i.importado_em)}</td>
          <td class="cell-sub">${esc(i.usuario || '—')}</td>
          <td>${nf(i.qtd_registros)}</td>
          <td>${i.qtd_erros ? `<span class="rna-badge badge-crit">${i.qtd_erros}</span>` : '0'}</td>
          <td>${i.qtd_alertas ? `<span class="rna-badge badge-warn">${i.qtd_alertas}</span>` : '0'}</td>
          <td><span class="rna-badge ${i.status === 'Confirmada' ? 'badge-ok' : i.status === 'Com erros' ? 'badge-crit' : 'badge-warn'}">${esc(i.status)}</span></td>
          <td class="text-end">
            <button class="rna-btn rna-btn-ghost rna-btn-sm" data-ver-imp="${i.id}"><i class="bi bi-eye"></i></button>
            ${i.status === 'Confirmada' && PODE.importar && editavel
              ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-reverter="${i.id}" title="Reverter esta importação"><i class="bi bi-arrow-counterclockwise"></i></button>` : ''}
          </td></tr>`).join('')}</tbody></table>`
        : UI.vazio('Nenhuma importação nesta competência',
            'A quantidade fornecida pode vir da planilha de faturamento ou ser lançada manualmente em Indicadores Externos.')}
      </div>
    </div>`);

  $('#fm-drop')?.addEventListener('click', () => $('#fm-arquivo').click());
  $('#fm-arquivo')?.addEventListener('change', e => { if (e.target.files[0]) processarArquivo(e.target.files[0]); });
  ['dragover', 'dragenter'].forEach(ev => $('#fm-drop')?.addEventListener(ev, e => {
    e.preventDefault(); $('#fm-drop').classList.add('is-drag');
  }));
  ['dragleave', 'drop'].forEach(ev => $('#fm-drop')?.addEventListener(ev, e => {
    e.preventDefault(); $('#fm-drop').classList.remove('is-drag');
  }));
  $('#fm-drop')?.addEventListener('drop', e => { if (e.dataTransfer.files[0]) processarArquivo(e.dataTransfer.files[0]); });
  $$('[data-ver-imp]').forEach(b => b.addEventListener('click', () => verImportacao(b.dataset.verImp)));
  $$('[data-reverter]').forEach(b => b.addEventListener('click', () => reverterImportacao(b.dataset.reverter)));
}

async function processarArquivo(file) {
  try {
    loading(true);
    const { matriz } = await IMP.lerArquivo(file);
    if (!matriz.length) throw new CORE.FmErro('O arquivo está vazio.');

    const idx = IMP.acharCabecalho(matriz);
    const { mapa, naoReconhecidas, faltando } = IMP.mapearColunas(matriz[idx]);

    if (faltando.length) {
      loading(false);
      return abrirMapeamento(file, matriz, idx, mapa, naoReconhecidas, faltando);
    }
    await validarEExibir(file, matriz, idx, mapa);
  } catch (e) {
    toast(esc(e.message), { type: 'crit', title: 'Não foi possível ler o arquivo', timeout: 9000 });
  } finally { loading(false); }
}

/** §24 — o usuário associa "coluna do arquivo → campo do RNA On". */
function abrirMapeamento(file, matriz, idx, mapa, naoReconhecidas, faltando) {
  const cabec = matriz[idx];
  const m = modal({
    title: 'Associar colunas do arquivo',
    size: 'modal-lg',
    content: `${UI.aviso(`Não foi possível identificar automaticamente: <b>${faltando.map(esc).join(', ')}</b>.
        Indique qual coluna do arquivo corresponde a cada campo — o mapeamento não depende de posição fixa (§24).`, 'alerta')}
      <div class="fm-form" style="grid-template-columns:repeat(2,1fr)">
        ${IMP.CAMPOS_FATURAMENTO.map(c => `<div class="fm-form__campo">
          <label>${esc(c.l)}${c.req ? '<span class="req">*</span>' : ''}</label>
          <select data-map="${c.k}">
            <option value="">— não usar —</option>
            ${cabec.map((h, i) => `<option value="${i}" ${mapa[c.k] === i ? 'selected' : ''}>
              ${esc(h || `(coluna ${i + 1})`)}</option>`).join('')}
          </select></div>`).join('')}
      </div>
      <h6 style="font-size:13px;font-weight:700;margin:16px 0 6px">Prévia das primeiras linhas</h6>
      <div class="rna-table-wrap"><table class="rna-table"><thead><tr>
        ${cabec.map(h => `<th>${esc(h || '—')}</th>`).join('')}</tr></thead>
        <tbody>${matriz.slice(idx + 1, idx + 4).map(l =>
          `<tr>${l.map(c => `<td class="cell-sub">${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-primary" id="map-ok">Continuar</button>`
  });
  $('#map-ok', m.host).addEventListener('click', async () => {
    const novoMapa = {};
    $$('[data-map]', m.host).forEach(s => { if (s.value !== '') novoMapa[s.dataset.map] = Number(s.value); });
    const faltaAinda = IMP.CAMPOS_FATURAMENTO.filter(c => c.req && !(c.k in novoMapa)).map(c => c.l);
    if (faltaAinda.length) {
      toast(`Ainda falta associar: ${faltaAinda.join(', ')}.`, { type: 'warn' });
      return;
    }
    m.close();
    await validarEExibir(file, matriz, idx, novoMapa);
  });
}

async function validarEExibir(file, matriz, idx, mapa) {
  loading(true);
  try {
    const linhas = IMP.extrairLinhas(matriz, idx, mapa);
    const aliases = await CLI.listar();
    const vigente = await IMP.importacaoVigente(state.competencia.id);
    const anterior = vigente
      ? (await db.list('fm_fornecimento')).filter(f => f.importacao_id === vigente.id)
      : [];
    const limite = await IMP.limiteVariacao(state.competencia.planta);
    const { linhas: validadas, resumo } = IMP.validarLinhas(linhas, aliases, { anterior, limiteVariacao: limite });

    const imp = await IMP.criarRascunho({
      competencia: state.competencia, arquivo: file, matriz, mapa,
      indiceCabecalho: idx, linhasValidadas: validadas, resumo
    }, USER);

    state.importacao = imp.id;
    loading(false);
    await verImportacao(imp.id);
  } catch (e) {
    loading(false);
    toast(esc(e.message), { type: 'crit', title: 'Falha na validação', timeout: 9000 });
  }
}

async function verImportacao(importacao_id) {
  const imp = await db.get('fm_importacoes', importacao_id);
  const linhas = await IMP.linhasDa(importacao_id);
  const aliases = await CLI.listar();

  const resumo = {
    total: linhas.length,
    validos: linhas.filter(l => l.status === 'valido').length,
    invalidos: linhas.filter(l => l.status === 'invalido' && !l.ignorada).length,
    alertas: linhas.filter(l => l.status === 'alerta').length,
    clientesNaoReconhecidos: linhas.filter(l => l.classificacao_cliente === 'nao_cadastrado').length,
    clientesPossiveis: linhas.filter(l => l.classificacao_cliente === 'possivel').length,
    duplicados: linhas.filter(l => (l.erros || []).some(e => String(e).startsWith('Linha duplicada'))).length,
    valoresVazios: linhas.filter(l => (l.erros || []).some(e => String(e).includes('está vazio'))).length,
    valoresNegativos: linhas.filter(l => (l.alertas || []).some(a => String(a).includes('negativo'))).length,
    alterados: 0, adicionados: 0, removidos: 0,
    variacaoAlta: linhas.filter(l => (l.alertas || []).some(a => String(a).startsWith('Variação de'))).length
  };
  const podeConfirmar = resumo.invalidos === 0 && linhas.some(l => !l.ignorada);

  const m = modal({
    title: `Importação de faturamento — V${imp.versao} · ${esc(imp.arquivo_nome || '')}`,
    size: 'modal-xl',
    content: `
      ${UI.resumoValidacao(resumo)}
      ${!podeConfirmar ? UI.aviso(
        `<b>Confirmação bloqueada.</b> ${resumo.invalidos} linha(s) com erro crítico.
         Corrija a associação do cliente ou marque a linha para ignorar (com justificativa) — §26.`, 'erro')
        : (imp.status === 'Confirmada'
            ? UI.aviso('Esta versão já foi <b>confirmada</b> e os dados estão em Peças Fornecidas.', 'ok')
            : UI.aviso('Nenhum erro crítico. Ao confirmar, os dados entram em Peças Fornecidas e a versão anterior é preservada (§27).', 'ok'))}
      <div style="margin-top:14px">${UI.tabelaValidacao(linhas, { podeCorrigir: PODE.importar && imp.status !== 'Confirmada' })}</div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Fechar</button>
      ${PODE.importar && imp.status !== 'Confirmada'
        ? `<button class="rna-btn rna-btn-primary" id="imp-ok" ${podeConfirmar ? '' : 'disabled'}>
            <i class="bi bi-check2"></i> Confirmar importação</button>` : ''}`
  });

  $$('[data-associar]', m.host).forEach(b => b.addEventListener('click', () => {
    const linha = linhas.find(l => String(l.id) === b.dataset.associar);
    modalAssociacaoCliente(linha, aliases, m, importacao_id);
  }));
  $$('[data-ignorar]', m.host).forEach(b => b.addEventListener('click', async () => {
    const just = prompt('Justificativa para ignorar esta linha:');
    if (!just) return;
    try {
      await IMP.ignorarLinha(b.dataset.ignorar, just, USER);
      m.close();
      await verImportacao(importacao_id);
    } catch (e) { toast(esc(e.message), { type: 'crit' }); }
  }));
  $('#imp-ok', m.host)?.addEventListener('click', async () => {
    try {
      loading(true);
      const r = await IMP.confirmar(importacao_id, { user: USER, competencia: state.competencia });
      m.close(); state.painel = null; state.importacao = null;
      toast(`Importação confirmada: ${r.inseridos} registros · ${r.alterados} alterado(s), ${r.adicionados} adicionado(s), ${r.removidos} removido(s).`,
        { type: 'ok', timeout: 9000 });
      await render();
    } catch (e) {
      toast(esc(e.message), { type: 'crit', title: 'Não foi possível confirmar', timeout: 9000 });
    } finally { loading(false); }
  });
}

/** CustomerMappingModal (§25/§26) */
function modalAssociacaoCliente(linha, aliases, modalPai, importacao_id) {
  const m = modal({
    title: `Associar cliente — "${esc(linha.cliente_arquivo)}"`,
    content: `<div class="fm-form" style="grid-template-columns:1fr">
        <div class="fm-form__campo">
          <label>Cliente oficial <span class="req">*</span></label>
          <select id="ac-cliente">
            <option value="">— selecione —</option>
            ${aliases.map(a => `<option value="${esc(a.nome_oficial)}">${esc(a.nome_oficial)}</option>`).join('')}
          </select>
          <span class="fm-form__hint">Nada é associado automaticamente: só a confirmação humana vale (§25).</span>
        </div>
        <div class="fm-form__campo"><div class="fm-form__check">
          <input type="checkbox" id="ac-aprender" checked>
          <span>Guardar "${esc(linha.cliente_arquivo)}" como apelido deste cliente</span></div>
          <span class="fm-form__hint">Com o apelido guardado, a próxima importação reconhece sozinha.</span></div>
      </div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-primary" id="ac-ok">Associar</button>`
  });
  $('#ac-ok', m.host).addEventListener('click', async () => {
    const cliente = $('#ac-cliente', m.host).value;
    if (!cliente) { toast('Selecione o cliente oficial.', { type: 'warn' }); return; }
    try {
      await IMP.corrigirAssociacao(linha.id, cliente, USER);
      if ($('#ac-aprender', m.host).checked) {
        await CLI.aprenderApelido(cliente, linha.cliente_arquivo, USER).catch(e =>
          toast(`Associação feita, mas o apelido não foi guardado: ${e.message}`, { type: 'warn' }));
      }
      m.close(); modalPai.close();
      await verImportacao(importacao_id);
    } catch (e) { toast(esc(e.message), { type: 'crit' }); }
  });
}

function reverterImportacao(id) {
  const m = modal({
    title: 'Reverter importação',
    content: `${UI.aviso('Os registros desta versão saem do fornecimento e a versão anterior é restaurada. Nada é apagado fisicamente.', 'alerta')}
      <div class="fm-form" style="grid-template-columns:1fr"><div class="fm-form__campo">
        <label>Motivo <span class="req">*</span></label><textarea id="rv-motivo"></textarea></div></div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-dark" id="rv-ok">Reverter</button>`
  });
  $('#rv-ok', m.host).addEventListener('click', async () => {
    try {
      const r = await IMP.reverter(id, { motivo: $('#rv-motivo', m.host).value, user: USER });
      m.close(); state.painel = null;
      toast(`Importação revertida: ${r.removidos} removido(s), ${r.restaurados} restaurado(s).`, { type: 'ok' });
      await render();
    } catch (e) { toast(esc(e.message), { type: 'crit' }); }
  });
}

/* ========================================================================== */
/* PENDÊNCIAS (§32)                                                            */
/* ========================================================================== */
async function renderPendencias() {
  await painel();   // sincroniza antes de listar
  const pendencias = await PEND.listar(state.competencia.id);
  const abertas = pendencias.filter(p => p.status === 'Aberta');
  const bloqueantes = abertas.filter(p => p.bloqueia_final);

  montar(`
    ${bloqueantes.length ? UI.aviso(
      `<b>${bloqueantes.length} pendência(s) impedem a versão FINAL da apresentação</b> (§41).
       A versão preliminar continua disponível.`, 'alerta')
      : UI.aviso('Nenhuma pendência bloqueante — a competência pode seguir para a versão final.', 'ok')}

    <div class="rna-card">
      <div class="rna-card__head">
        <h3><i class="bi bi-exclamation-circle"></i> Pendências
          <span class="rna-badge badge-crit">${abertas.length} aberta(s)</span></h3>
        <div class="d-flex gap-2">
          <button class="rna-btn rna-btn-ghost rna-btn-sm" id="fm-pend-sync"><i class="bi bi-arrow-repeat"></i> Reavaliar</button>
          ${PODE.lancar ? `<button class="rna-btn rna-btn-primary rna-btn-sm" id="fm-pend-nova"><i class="bi bi-plus-lg"></i> Nova pendência</button>` : ''}
        </div>
      </div>
      <div>${UI.painelPendencias(pendencias, { podeConcluir: PODE.lancar })}</div>
    </div>`);

  $('#fm-pend-sync').addEventListener('click', async () => {
    loading(true);
    try {
      const r = await PEND.sincronizar(state.competencia, { user: USER });
      toast(`Reavaliação concluída: ${r.criadas} nova(s), ${r.fechadas} fechada(s) automaticamente.`, { type: 'ok' });
      state.painel = null;
      await render();
    } finally { loading(false); }
  });
  $('#fm-pend-nova')?.addEventListener('click', abrirNovaPendencia);
  $$('[data-pend-concluir]').forEach(b => b.addEventListener('click', () => {
    const m = modal({
      title: 'Concluir pendência',
      content: `<div class="fm-form" style="grid-template-columns:1fr"><div class="fm-form__campo">
        <label>Como foi resolvida?</label><textarea id="pc-res"></textarea></div></div>`,
      footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
               <button class="rna-btn rna-btn-primary" id="pc-ok">Concluir</button>`
    });
    $('#pc-ok', m.host).addEventListener('click', async () => {
      await PEND.concluir(b.dataset.pendConcluir, { resolucao: $('#pc-res', m.host).value, user: USER });
      m.close(); state.painel = null;
      toast('Pendência concluída.', { type: 'ok' });
      await render();
    });
  }));
}

function abrirNovaPendencia() {
  const m = modal({
    title: 'Nova pendência',
    content: `<div class="fm-form" style="grid-template-columns:repeat(2,1fr)">
      <div class="fm-form__campo fm-form__campo--2"><label>Título <span class="req">*</span></label><input id="np-titulo"></div>
      <div class="fm-form__campo fm-form__campo--2"><label>Descrição</label><textarea id="np-desc"></textarea></div>
      <div class="fm-form__campo"><label>Responsável</label><input id="np-resp"></div>
      <div class="fm-form__campo"><label>Prazo</label><input type="date" id="np-prazo"></div>
      <div class="fm-form__campo"><label>Prioridade</label><select id="np-prio">
        ${SCHEMA.PRIORIDADES.map(p => `<option ${p === 'Média' ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      <div class="fm-form__campo"><label>Módulo</label><input id="np-mod" placeholder="Ex.: Indicadores Externos"></div>
    </div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-primary" id="np-ok">Criar</button>`
  });
  $('#np-ok', m.host).addEventListener('click', async () => {
    const titulo = $('#np-titulo', m.host).value.trim();
    if (!titulo) { toast('Informe o título da pendência.', { type: 'warn' }); return; }
    await PEND.criarManual({
      competencia_id: state.competencia.id, titulo,
      descricao: $('#np-desc', m.host).value, modulo: $('#np-mod', m.host).value,
      responsavel: $('#np-resp', m.host).value, prioridade: $('#np-prio', m.host).value,
      prazo: $('#np-prazo', m.host).value || null
    }, USER);
    m.close();
    toast('Pendência criada.', { type: 'ok' });
    await render();
  });
}

/* ========================================================================== */
/* PRÉVIA DA APRESENTAÇÃO (§35)                                                */
/* ========================================================================== */
async function renderPrevia() {
  const p = await painel();
  const ordem = await APRES.ordemSlides(state.competencia.planta);
  const slides = APRES.montarSlides(p, ordem, {
    resumo: state.resumoEditado ?? IND.gerarResumo(p),
    observacoes: state.observacoesSlides
  });
  const validacao = await APRES.validar(state.competencia, p);

  montar(`
    ${validacao.podeGerarFinal
      ? UI.aviso('Nenhum bloqueio: a versão <b>final</b> pode ser gerada.', 'ok')
      : UI.aviso(`<b>${validacao.bloqueios} bloqueio(s)</b> impedem a versão final. ${esc(validacao.motivoBloqueio || '')}`, 'alerta')}

    <div class="row g-3">
      <div class="col-xl-8">
        <div class="rna-card">
          <div class="rna-card__head"><h3><i class="bi bi-easel"></i> Slides
            <span class="rna-badge badge-info">${slides.length}</span></h3>
            <span class="cell-sub">Clique em um slide para ver os dados que o alimentam</span></div>
          <div class="rna-card__body">${UI.previaApresentacao(slides)}</div>
        </div>
      </div>
      <div class="col-xl-4">
        <div class="rna-card">
          <div class="rna-card__head"><h3><i class="bi bi-check2-square"></i> Validação (§41)</h3></div>
          <div class="rna-card__body">${UI.checklistValidacao(validacao)}</div>
        </div>
        ${PODE.gerar ? `<div class="rna-card mt-3">
          <div class="rna-card__head"><h3><i class="bi bi-download"></i> Gerar apresentação</h3></div>
          <div class="rna-card__body d-grid gap-2">
            <button class="rna-btn rna-btn-primary" id="fm-gerar-prelim">
              <i class="bi bi-file-earmark-slides"></i> Gerar versão preliminar</button>
            <button class="rna-btn rna-btn-dark" id="fm-gerar-final" ${validacao.podeGerarFinal ? '' : 'disabled'}>
              <i class="bi bi-award"></i> Gerar versão FINAL</button>
            <button class="rna-btn rna-btn-ghost" id="fm-gerar-pdf"><i class="bi bi-file-earmark-pdf"></i> Imprimir / PDF</button>
            <button class="rna-btn rna-btn-ghost" id="fm-gerar-xlsx"><i class="bi bi-file-earmark-spreadsheet"></i> Memória de cálculo (.xlsx)</button>
          </div>
        </div>` : ''}
      </div>
    </div>

    ${documentoImpressao(slides, state.competencia)}
  `);

  $$('[data-slide]').forEach(s => s.addEventListener('click', () => abrirSlide(s.dataset.slide, slides)));
  $('#fm-gerar-prelim')?.addEventListener('click', () => gerarApresentacao(false));
  $('#fm-gerar-final')?.addEventListener('click', () => gerarApresentacao(true));
  $('#fm-gerar-pdf')?.addEventListener('click', () => window.print());
  $('#fm-gerar-xlsx')?.addEventListener('click', async () => {
    try {
      loading(true);
      await APRES.gerarXLSX(state.competencia, p);
      toast('Memória de cálculo gerada.', { type: 'ok' });
    } catch (e) {
      toast(esc(e.message), { type: 'crit', title: 'Não foi possível gerar o Excel', timeout: 9000 });
    } finally { loading(false); }
  });
}

function abrirSlide(slug, slides) {
  const s = slides.find(x => x.slug === slug);
  if (!s) return;
  const editavel = CORE.competenciaEditavel(state.competencia);

  const m = modal({
    title: `Slide ${s.numero} — ${esc(s.titulo)}`,
    size: 'modal-lg',
    content: `
      <table class="fm-memoria-tabela">
        <tr><td>Estado</td><td>${esc(s.estado)}</td></tr>
        <tr><td>Planta / período</td><td>${esc(s.planta)} · ${esc(s.periodo)}</td></tr>
        <tr><td>Área</td><td>${esc(s.area)}</td></tr>
        <tr><td>Origem dos dados</td><td>${esc(s.fonte)}</td></tr>
        <tr><td>Atualizado em</td><td>${s.atualizadoEm ? formatarDataHoraBrasil(s.atualizadoEm) : '—'}</td></tr>
      </table>
      ${s.indicadores?.length ? `<h6 style="font-size:13px;font-weight:700;margin:16px 0 6px">Indicadores do slide</h6>
        <table class="fm-memoria-tabela">${s.indicadores.map(i =>
          `<tr><td>${esc(i.label)}</td><td><b>${esc(i.valor)}</b> · meta ${esc(i.meta ?? '—')} · ${esc(i.status?.texto || '')}</td></tr>`).join('')}</table>` : ''}
      ${s.memoria ? `<div class="fm-formula" style="margin-top:14px">${esc(s.memoria.formula)}</div>` : ''}
      ${s.tabela?.linhas?.length ? `<h6 style="font-size:13px;font-weight:700;margin:16px 0 6px">Dados (${s.tabela.linhas.length})</h6>
        <div class="rna-table-wrap" style="max-height:260px;overflow:auto"><table class="rna-table">
          <thead><tr>${s.tabela.cabecalho.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${s.tabela.linhas.slice(0, 30).map(l => `<tr>${l.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table></div>` : ''}
      ${s.vazio && !s.tabela?.linhas?.length ? UI.aviso(esc(s.vazio), 'info') : ''}
      ${editavel ? `<div class="fm-form" style="grid-template-columns:1fr;margin-top:16px">
        <div class="fm-form__campo"><label>Observação do apresentador</label>
          <textarea id="sl-obs" placeholder="Vai para as notas do slide no PowerPoint, não para o corpo">${esc(state.observacoesSlides[slug] || '')}</textarea></div>
      </div>` : ''}`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Fechar</button>
             <button class="rna-btn rna-btn-ghost" id="sl-atualizar"><i class="bi bi-arrow-repeat"></i> Atualizar dados</button>
             ${editavel ? `<button class="rna-btn rna-btn-primary" id="sl-ok">Salvar observação</button>` : ''}`
  });
  $('#sl-atualizar', m.host).addEventListener('click', async () => {
    m.close(); state.painel = null;
    toast('Recalculando a partir dos lançamentos...', { type: 'info' });
    await render();
  });
  $('#sl-ok', m.host)?.addEventListener('click', () => {
    state.observacoesSlides[slug] = $('#sl-obs', m.host).value;
    m.close();
    toast('Observação salva para esta sessão.', { type: 'ok' });
  });
}

async function gerarApresentacao(final) {
  const formatos = ['pptx', 'xlsx'];
  try {
    loading(true);
    const r = await APRES.gerar(state.competencia, {
      versao: final ? 'FINAL' : null,
      formatos, user: USER, painel: state.painel,
      observacoesSlides: state.observacoesSlides
    });
    toast(`Apresentação ${r.versao.versao} gerada com ${r.slides.length} slides. Arquivos: ${r.arquivos.map(a => a.formato.toUpperCase()).join(', ')}.`,
      { type: 'ok', timeout: 9000 });
    state.aba = 'geradas'; salvarPrefs();
    await render();
  } catch (e) {
    toast(esc(e.message), { type: 'crit', title: 'Não foi possível gerar', timeout: 12000 });
  } finally { loading(false); }
}

/** Documento oculto usado só na impressão (§39 PDF). */
function documentoImpressao(slides, c) {
  return `<div class="fm-doc">
    ${c.status !== 'Fechado' ? `<div class="fm-doc__marca">${APRES.MARCA_PRELIMINAR}</div>` : ''}
    ${slides.map(s => `<div class="fm-doc__slide">
      <div class="fm-doc__cab">
        <h2>${esc(s.titulo)}</h2>
        <span>${esc(s.planta)} · ${esc(s.periodo)} · ${esc(s.area)}</span>
      </div>
      ${s.indicadores?.length ? `<table class="fm-memoria-tabela">${s.indicadores.map(i =>
        `<tr><td>${esc(i.label)}</td><td><b>${esc(i.valor)}</b> — meta ${esc(i.meta ?? '—')} · ${esc(i.status?.texto || '')}</td></tr>`).join('')}</table>` : ''}
      ${s.linhas?.length ? `<table class="fm-memoria-tabela">${s.linhas.map(([k, v]) =>
        `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}
      ${(s.texto || s.comparativo || s.auxiliares)?.length ? `<table class="fm-memoria-tabela">${
        (s.texto || s.comparativo || s.auxiliares).map(([k, v]) =>
        `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}
      ${s.tabela?.linhas?.length ? `<table class="rna-table"><thead><tr>${
        s.tabela.cabecalho.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${
        s.tabela.linhas.map(l => `<tr>${l.map(x => `<td>${esc(x)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : ''}
      ${s.resumo?.length ? `<ul>${s.resumo.map(f => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
      ${!s.tabela?.linhas?.length && s.vazio ? `<p><i>${esc(s.vazio)}</i></p>` : ''}
      <div style="font-size:9px;color:#888;margin-top:8px">${esc(s.fonte)} · ${esc(s.rodape)} · slide ${s.numero}</div>
    </div>`).join('')}
  </div>`;
}

/* ========================================================================== */
/* APROVAÇÃO (§42)                                                             */
/* ========================================================================== */
async function renderAprovacao() {
  const c = state.competencia;
  const historico = await CORE.historicoStatus(c.id);
  const validacao = await APRES.validar(c, await painel());
  const destinos = SCHEMA.TRANSICOES[c.status] || [];
  const integracoes = await INTEG.disponiveis(c).catch(() => null);

  montar(`
    <div class="row g-3">
      <div class="col-lg-7">
        <div class="rna-card">
          <div class="rna-card__head"><h3><i class="bi bi-check2-square"></i> Fluxo de aprovação</h3>
            ${UI.seloStatus(c.status)}</div>
          <div class="rna-card__body">
            <p class="fm-form__hint" style="margin-bottom:14px">
              Responsáveis preenchem → Garantia da Qualidade revisa → devolve se necessário →
              Gestor aprova → sistema gera a versão final → competência é fechada.</p>
            ${destinos.length ? `<div class="d-flex flex-wrap gap-2">${destinos.map(d =>
              `<button class="rna-btn ${d === 'Aprovado' || d === 'Fechado' ? 'rna-btn-primary' : 'rna-btn-ghost'}"
                data-status="${esc(d)}" ${podeMudarPara(d) ? '' : 'disabled title="Seu perfil não pode executar esta transição"'}>
                ${esc(d)}</button>`).join('')}</div>`
              : UI.aviso('Nenhuma transição disponível a partir deste status.', 'info')}
            ${c.status === 'Fechado' && PODE.reabrir
              ? `<button class="rna-btn rna-btn-dark mt-3" id="fm-reabrir"><i class="bi bi-unlock"></i> Reabrir competência</button>` : ''}
            ${c.status === 'Fechado' && PODE.aprovar
              ? `<button class="rna-btn rna-btn-primary mt-3" id="fm-proximo"><i class="bi bi-calendar-plus"></i> Criar próxima competência</button>` : ''}
          </div>
        </div>

        <div class="rna-card mt-3">
          <div class="rna-card__head"><h3><i class="bi bi-clipboard-check"></i> Checklist de liberação</h3></div>
          <div class="rna-card__body">${UI.checklistValidacao(validacao)}</div>
        </div>

        ${integracoes ? `<div class="rna-card mt-3">
          <div class="rna-card__head"><h3><i class="bi bi-diagram-2"></i> Integrações disponíveis (§29)</h3></div>
          <div class="rna-card__body">
            <table class="fm-memoria-tabela">
              <tr><td>Relatórios dimensionais reprovados no período</td>
                  <td><b>${integracoes.dimensionais.total}</b> · ${integracoes.dimensionais.pendentes} ainda não importado(s)
                  ${integracoes.dimensionais.pendentes && PODE.lancar && CORE.competenciaEditavel(c)
                    ? `<button class="rna-btn rna-btn-ghost rna-btn-sm ms-2" id="fm-imp-dim">Importar</button>` : ''}</td></tr>
              <tr><td>Não conformidades no período</td><td>${integracoes.ncs.total}</td></tr>
              <tr><td>Pendências operacionais em aberto</td><td>${integracoes.pendenciasOperacionais.total}</td></tr>
              <tr><td>Índice de auditoria (relatórios aprovados)</td><td><b>${esc(integracoes.indiceAuditoria.exibicao)}</b></td></tr>
            </table>
          </div>
        </div>` : ''}
      </div>

      <div class="col-lg-5">
        <div class="rna-card">
          <div class="rna-card__head"><h3><i class="bi bi-clock-history"></i> Linha do tempo</h3></div>
          <div class="rna-card__body">${UI.linhaDoTempo(historico)}</div>
        </div>
      </div>
    </div>`);

  $$('[data-status]').forEach(b => b.addEventListener('click', () => mudarStatus(b.dataset.status)));
  $('#fm-reabrir')?.addEventListener('click', () => abrirReabertura(c.id));
  $('#fm-proximo')?.addEventListener('click', () => criarProximoMes(c.id));
  $('#fm-imp-dim')?.addEventListener('click', () => importarDimensionais(integracoes.dimensionais.registros));
}

function podeMudarPara(status) {
  if (['Aprovado', 'Fechado'].includes(status)) return PODE.aprovar;
  if (status === 'Cancelado') return PODE.aprovar;
  return PODE.lancar;
}

function mudarStatus(novo) {
  const exigeComentario = ['Devolvido para correção', 'Cancelado'].includes(novo);
  const m = modal({
    title: `Mudar status para "${novo}"`,
    content: `${novo === 'Fechado' ? UI.aviso(
        'Ao fechar, todos os lançamentos ficam em <b>somente leitura</b>. Só o administrador pode reabrir, com motivo registrado (§46).', 'alerta') : ''}
      <div class="fm-form" style="grid-template-columns:1fr"><div class="fm-form__campo">
        <label>Comentário${exigeComentario ? ' <span class="req">*</span>' : ''}</label>
        <textarea id="ms-com" placeholder="${exigeComentario ? 'Descreva o motivo' : 'Opcional'}"></textarea></div></div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-primary" id="ms-ok">Confirmar</button>`
  });
  $('#ms-ok', m.host).addEventListener('click', async () => {
    const com = $('#ms-com', m.host).value.trim();
    if (exigeComentario && !com) { toast('O comentário é obrigatório nesta transição.', { type: 'warn' }); return; }
    try {
      loading(true);
      await CORE.mudarStatus(state.competencia.id, novo, { comentario: com, user: USER });
      m.close();
      state.competencias = await CORE.listarCompetencias();
      state.painel = null;
      toast(`Status alterado para "${novo}".`, { type: 'ok' });
      await render();
    } catch (e) {
      toast(esc(e.message), { type: 'crit', title: 'Transição recusada', timeout: 9000 });
    } finally { loading(false); }
  });
}

function importarDimensionais(registros) {
  const pendentes = registros.filter(r => !r._importado);
  const m = modal({
    title: 'Importar relatórios dimensionais reprovados',
    size: 'modal-lg',
    content: `${UI.aviso('Cada relatório vira uma ocorrência interna com vínculo ao registro original — a duplicidade é impedida pelo vínculo (§29).', 'info')}
      <div class="rna-table-wrap"><table class="rna-table">
        <thead><tr><th><input type="checkbox" id="fd-todos"></th><th>Relatório</th><th>Data</th><th>Peça</th><th>Qtd.</th></tr></thead>
        <tbody>${pendentes.map(r => `<tr>
          <td><input type="checkbox" data-rel="${r.id}" checked></td>
          <td class="cell-strong">${esc(r.numero || r.id)}</td>
          <td class="cell-sub">${formatarDataBrasil(r._data)}</td>
          <td>${esc(r.peca_codigo || '—')}<div class="cell-sub">${esc(r.peca_nome || '')}</div></td>
          <td>${nf(r.quantidade)}</td></tr>`).join('')}</tbody></table></div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-primary" id="fd-ok">Importar selecionados</button>`
  });
  $('#fd-todos', m.host).addEventListener('change', e =>
    $$('[data-rel]', m.host).forEach(c => { c.checked = e.target.checked; }));
  $('#fd-ok', m.host).addEventListener('click', async () => {
    const ids = $$('[data-rel]', m.host).filter(c => c.checked).map(c => c.dataset.rel);
    let ok = 0; const falhas = [];
    loading(true);
    for (const id of ids) {
      try {
        await INTEG.importarRelatorioDimensional(pendentes.find(r => r.id === id), state.competencia, USER);
        ok++;
      } catch (e) { falhas.push(e.message); }
    }
    loading(false);
    m.close(); state.painel = null;
    toast(`${ok} relatório(s) importado(s)${falhas.length ? ` · ${falhas.length} recusado(s): ${falhas[0]}` : ''}.`,
      { type: falhas.length ? 'warn' : 'ok', timeout: 9000 });
    await render();
  });
}

/* ========================================================================== */
/* APRESENTAÇÕES GERADAS (§40)                                                 */
/* ========================================================================== */
async function renderGeradas() {
  const versoes = await APRES.listarVersoes(state.competencia.id);
  montar(`
    <div class="rna-card">
      <div class="rna-card__head"><h3><i class="bi bi-collection"></i> Apresentações geradas
        <span class="rna-badge badge-info">${versoes.length}</span></h3></div>
      <div class="rna-table-wrap">${versoes.length ? `<table class="rna-table">
        <thead><tr><th>Versão</th><th>Gerada em</th><th>Por</th><th>Arquivos</th><th>Status</th><th>Observações</th><th></th></tr></thead>
        <tbody>${versoes.map(v => `<tr>
          <td class="cell-strong">${esc(v.versao)}
            ${v.preliminar ? '<div class="cell-sub">preliminar (com marca d’água)</div>' : '<div class="cell-sub">final</div>'}</td>
          <td class="cell-sub">${formatarDataHoraBrasil(v.gerado_em)}</td>
          <td class="cell-sub">${esc(v.gerado_por || '—')}</td>
          <td class="cell-sub">${v.arquivos.length
              ? v.arquivos.map(a => `<div title="${esc(a.nome)}"><i class="bi bi-file-earmark"></i> ${esc(a.formato.toUpperCase())}</div>`).join('')
              : '—'}</td>
          <td><span class="rna-badge ${v.status === 'Aprovada' ? 'badge-ok' : 'badge-info'}">${esc(v.status)}</span>
            ${v.aprovado_por ? `<div class="cell-sub">${esc(v.aprovado_por)}</div>` : ''}</td>
          <td class="cell-sub">${esc(v.observacoes || '—')}</td>
          <td class="text-end">${PODE.aprovar && v.status !== 'Aprovada'
            ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-aprovar-v="${v.id}"><i class="bi bi-check2"></i> Aprovar</button>` : ''}</td>
        </tr>`).join('')}</tbody></table>`
        : UI.vazio('Nenhuma apresentação gerada',
            'Gere a primeira versão na aba Prévia da Apresentação. Toda versão fica guardada com autor, data e arquivos.')}
      </div>
      ${versoes.length ? `<div class="rna-card__body"><div class="fm-form__hint">
        <i class="bi bi-info-circle"></i> Os arquivos são baixados no momento da geração. O histórico acima guarda
        a rastreabilidade (versão, autor, data, hash) — as versões anteriores nunca são apagadas (§40/§46).</div></div>` : ''}
    </div>`);

  $$('[data-aprovar-v]').forEach(b => b.addEventListener('click', async () => {
    try {
      await APRES.aprovarVersao(b.dataset.aprovarV, { user: USER });
      toast('Versão aprovada.', { type: 'ok' });
      await render();
    } catch (e) { toast(esc(e.message), { type: 'crit' }); }
  }));
}

/* ========================================================================== */
/* HISTÓRICO / AUDITORIA (§45)                                                 */
/* ========================================================================== */
async function renderHistorico() {
  const [logs, hist] = await Promise.all([
    CORE.trilha(state.competencia.id),
    CORE.historicoStatus(state.competencia.id)
  ]);
  montar(`
    <div class="row g-3">
      <div class="col-lg-4"><div class="rna-card h-100">
        <div class="rna-card__head"><h3><i class="bi bi-signpost-split"></i> Mudanças de status</h3></div>
        <div class="rna-card__body">${UI.linhaDoTempo(hist)}</div>
      </div></div>
      <div class="col-lg-8"><div class="rna-card h-100">
        <div class="rna-card__head"><h3><i class="bi bi-journal-text"></i> Trilha de auditoria
          <span class="rna-badge badge-info">${logs.length}</span></h3></div>
        <div>${UI.historicoAuditoria(logs)}</div>
      </div></div>
    </div>`);
}

/* ========================================================================== */
/* CONFIGURAÇÕES (§13, §19, §25, §31, §36)                                     */
/* ========================================================================== */
async function renderConfig() {
  const [metas, criterios, aliases, limite, modoRetr] = await Promise.all([
    db.list('fm_metas').then(r => r.filter(m => !m.deleted_at)).catch(() => []),
    db.list('fm_criterios').then(r => r.filter(c => !c.deleted_at)).catch(() => []),
    CLI.listar({ incluirInativos: true }).catch(() => []),
    CORE.config('custo_limite_mensal', null, { valor: null }),
    CORE.config('retrabalho_modo', null, { modo: 'ppm' })
  ]);

  montar(`
    ${!PODE.configurar ? UI.aviso('Você pode consultar as configurações, mas apenas o Administrador altera metas, critérios e cadastros (§43).', 'info') : ''}

    <div class="rna-card mb-3">
      <div class="rna-card__head"><h3><i class="bi bi-bullseye"></i> Metas dos indicadores
        <span class="rna-badge badge-info">${metas.length}</span></h3>
        ${PODE.configurar ? `<button class="rna-btn rna-btn-primary rna-btn-sm" id="cfg-meta-nova"><i class="bi bi-plus-lg"></i> Nova meta</button>` : ''}</div>
      <div class="rna-table-wrap">${metas.length ? `<table class="rna-table">
        <thead><tr><th>Indicador</th><th>Planta</th><th>Cliente</th><th>Ano</th><th>Valor</th>
          <th>Unidade</th><th>Comparação</th><th>Status</th><th></th></tr></thead>
        <tbody>${metas.map(m => `<tr>
          <td class="cell-strong">${esc(SCHEMA.INDICADORES[m.indicador]?.label || m.indicador)}</td>
          <td class="cell-sub">${esc(m.planta || 'Todas')}</td>
          <td class="cell-sub">${esc(m.cliente || 'Todos')}</td>
          <td class="cell-sub">${m.ano || 'Todos'}</td>
          <td><b>${nf(m.valor)}</b></td>
          <td class="cell-sub">${esc(m.unidade || '—')}</td>
          <td class="cell-sub">${esc(SCHEMA.COMPARACOES[m.comparacao] || m.comparacao)}</td>
          <td><span class="rna-badge ${m.status === 'Ativo' ? 'badge-ok' : 'badge-na'}">${esc(m.status)}</span></td>
          <td class="text-end">${PODE.configurar
            ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-meta="${m.id}"><i class="bi bi-pencil"></i></button>` : ''}</td>
        </tr>`).join('')}</tbody></table>` : UI.vazio('Nenhuma meta cadastrada', 'Sem meta, os indicadores aparecem com status "Sem meta cadastrada".')}
      </div>
    </div>

    <div class="rna-card mb-3">
      <div class="rna-card__head"><h3><i class="bi bi-funnel"></i> Critérios do PPM interno</h3>
        ${PODE.configurar ? `<button class="rna-btn rna-btn-primary rna-btn-sm" id="cfg-crit-novo"><i class="bi bi-plus-lg"></i> Novo critério</button>` : ''}</div>
      <div class="rna-table-wrap">${criterios.length ? `<table class="rna-table">
        <thead><tr><th>Critério</th><th>Vigência</th><th>Planta</th><th>Fontes incluídas</th><th>Versão</th><th>Status</th></tr></thead>
        <tbody>${criterios.map(c => `<tr>
          <td class="cell-strong">${esc(c.nome)}<div class="cell-sub">${esc(c.descricao || '')}</div></td>
          <td class="cell-sub">${formatarDataBrasil(c.vigencia_inicio)} a ${c.vigencia_fim ? formatarDataBrasil(c.vigencia_fim) : 'em aberto'}</td>
          <td class="cell-sub">${esc(c.planta || 'Todas')}</td>
          <td class="cell-sub">${esc((c.fontes_incluidas || []).join(' · ') || '—')}</td>
          <td>v${c.versao || 1}</td>
          <td><span class="rna-badge ${c.status === 'Ativo' ? 'badge-ok' : 'badge-na'}">${esc(c.status)}</span></td>
        </tr>`).join('')}</tbody></table>` : UI.vazio('Nenhum critério cadastrado', 'Sem critério vigente o PPM interno não pode ser calculado.')}
      </div>
      <div class="rna-card__body"><div class="fm-form__hint"><i class="bi bi-shield-check"></i>
        O histórico sempre usa o critério vigente NA ÉPOCA da competência. Criar um critério novo não recalcula meses anteriores (§13).</div></div>
    </div>

    <div class="rna-card mb-3">
      <div class="rna-card__head"><h3><i class="bi bi-sliders"></i> Parâmetros gerais</h3></div>
      <div class="rna-card__body">
        <div class="fm-form" style="grid-template-columns:repeat(2,1fr)">
          <div class="fm-form__campo"><label>Limite mensal do custo da qualidade</label>
            <input id="cfg-limite" value="${limite?.valor ?? ''}" ${PODE.configurar ? '' : 'disabled'} inputmode="decimal">
            <span class="fm-form__hint">Referência inicial: R$ 28.000,00 — o valor não fica fixo no código (§19).</span></div>
          <div class="fm-form__campo"><label>Índice de retrabalho apresentado em</label>
            <select id="cfg-retr" ${PODE.configurar ? '' : 'disabled'}>
              <option value="ppm" ${modoRetr?.modo === 'ppm' ? 'selected' : ''}>PPM</option>
              <option value="percentual" ${modoRetr?.modo === 'percentual' ? 'selected' : ''}>Percentual</option>
            </select></div>
        </div>
        ${PODE.configurar ? `<button class="rna-btn rna-btn-primary mt-3" id="cfg-salvar"><i class="bi bi-check2"></i> Salvar parâmetros</button>` : ''}
      </div>
    </div>

    <div class="rna-card">
      <div class="rna-card__head"><h3><i class="bi bi-people"></i> Cadastro unificado de clientes
        <span class="rna-badge badge-info">${aliases.length}</span></h3>
        <div class="d-flex gap-2">
          ${PODE.configurar ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" id="cfg-semear"><i class="bi bi-download"></i> Semear da Biblioteca</button>
          <button class="rna-btn rna-btn-primary rna-btn-sm" id="cfg-cliente-novo"><i class="bi bi-plus-lg"></i> Novo cliente</button>` : ''}
        </div></div>
      <div class="rna-table-wrap">${aliases.length ? `<table class="rna-table">
        <thead><tr><th>Nome oficial</th><th>Código</th><th>Grupo econômico</th><th>Apelidos</th><th>Ativo</th><th></th></tr></thead>
        <tbody>${aliases.map(a => `<tr>
          <td class="cell-strong">${esc(a.nome_oficial)}</td>
          <td class="cell-sub">${esc(a.codigo || '—')}</td>
          <td class="cell-sub">${esc(a.grupo_economico || '—')}</td>
          <td class="cell-sub">${(a.apelidos || []).length ? esc((a.apelidos || []).join(' · ')) : '—'}</td>
          <td>${a.ativo !== false ? '<span class="rna-badge badge-ok">Sim</span>' : '<span class="rna-badge badge-na">Não</span>'}</td>
          <td class="text-end">${PODE.configurar
            ? `<button class="rna-btn rna-btn-ghost rna-btn-sm" data-cliente="${a.id}"><i class="bi bi-pencil"></i></button>` : ''}</td>
        </tr>`).join('')}</tbody></table>`
        : UI.vazio('Nenhum cliente cadastrado',
            'Sem o cadastro unificado, a importação não consegue associar os nomes do arquivo aos clientes oficiais.',
            PODE.configurar ? `<button class="rna-btn rna-btn-primary" id="cfg-semear-2"><i class="bi bi-download"></i> Semear da Biblioteca Técnica</button>` : '')}
      </div>
    </div>`);

  $('#cfg-salvar')?.addEventListener('click', async () => {
    try {
      const valor = $('#cfg-limite').value.trim();
      await CORE.salvarConfig('custo_limite_mensal',
        { valor: valor === '' ? null : Number(String(valor).replace(/\./g, '').replace(',', '.')), moeda: 'BRL' },
        { user: USER });
      await CORE.salvarConfig('retrabalho_modo', { modo: $('#cfg-retr').value }, { user: USER });
      state.painel = null;
      toast('Parâmetros salvos.', { type: 'ok' });
      await render();
    } catch (e) { toast(esc(e.message), { type: 'crit' }); }
  });

  const semear = async () => {
    loading(true);
    try {
      const r = await CLI.semearDaBiblioteca(USER);
      toast(r.motivo || `${r.criados} cliente(s) importado(s) da Biblioteca Técnica.`,
        { type: r.motivo ? 'warn' : 'ok' });
      await render();
    } finally { loading(false); }
  };
  $('#cfg-semear')?.addEventListener('click', semear);
  $('#cfg-semear-2')?.addEventListener('click', semear);
  $('#cfg-cliente-novo')?.addEventListener('click', () => abrirCliente());
  $$('[data-cliente]').forEach(b => b.addEventListener('click', () => abrirCliente(b.dataset.cliente, aliases)));
  $('#cfg-meta-nova')?.addEventListener('click', () => abrirMeta());
  $$('[data-meta]').forEach(b => b.addEventListener('click', () => abrirMeta(b.dataset.meta, metas)));
  $('#cfg-crit-novo')?.addEventListener('click', abrirCriterio);
}

function abrirCliente(id = null, lista = []) {
  const a = id ? lista.find(x => x.id === id) || {} : {};
  const m = modal({
    title: id ? 'Editar cliente' : 'Novo cliente',
    content: `<div class="fm-form" style="grid-template-columns:repeat(2,1fr)">
      <div class="fm-form__campo fm-form__campo--2"><label>Nome oficial <span class="req">*</span></label>
        <input id="cl-nome" value="${esc(a.nome_oficial || '')}"></div>
      <div class="fm-form__campo"><label>Código</label><input id="cl-cod" value="${esc(a.codigo || '')}"></div>
      <div class="fm-form__campo"><label>Grupo econômico</label><input id="cl-grupo" value="${esc(a.grupo_economico || '')}"></div>
      <div class="fm-form__campo fm-form__campo--2"><label>Apelidos</label>
        <textarea id="cl-apelidos" placeholder="Um por linha">${esc((a.apelidos || []).join('\n'))}</textarea>
        <span class="fm-form__hint">Ex.: MAN Latin América, Volkswagen, VW — usados no reconhecimento automático da importação.</span></div>
      <div class="fm-form__campo"><label>Nome no faturamento</label><input id="cl-fat" value="${esc(a.nome_faturamento || '')}"></div>
      <div class="fm-form__campo"><label>Nome nos indicadores</label><input id="cl-ind" value="${esc(a.nome_indicadores || '')}"></div>
      <div class="fm-form__campo fm-form__campo--2"><div class="fm-form__check">
        <input type="checkbox" id="cl-ativo" ${a.ativo !== false ? 'checked' : ''}> <span>Ativo</span></div></div>
    </div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-primary" id="cl-ok">Salvar</button>`
  });
  $('#cl-ok', m.host).addEventListener('click', async () => {
    try {
      await CLI.salvar({
        nome_oficial: $('#cl-nome', m.host).value,
        codigo: $('#cl-cod', m.host).value,
        grupo_economico: $('#cl-grupo', m.host).value,
        apelidos: $('#cl-apelidos', m.host).value,
        nome_faturamento: $('#cl-fat', m.host).value,
        nome_indicadores: $('#cl-ind', m.host).value,
        ativo: $('#cl-ativo', m.host).checked
      }, { id, user: USER });
      m.close();
      toast('Cliente salvo.', { type: 'ok' });
      await render();
    } catch (e) { toast(esc(e.message), { type: 'crit', timeout: 8000 }); }
  });
}

function abrirMeta(id = null, lista = []) {
  const mt = id ? lista.find(x => x.id === id) || {} : {};
  const m = modal({
    title: id ? 'Editar meta' : 'Nova meta',
    content: `<div class="fm-form" style="grid-template-columns:repeat(2,1fr)">
      <div class="fm-form__campo fm-form__campo--2"><label>Indicador <span class="req">*</span></label>
        <select id="mt-ind">${Object.entries(SCHEMA.INDICADORES).map(([k, v]) =>
          `<option value="${k}" ${mt.indicador === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
      <div class="fm-form__campo"><label>Planta</label>
        <select id="mt-planta"><option value="">Todas</option>
          ${PLANTAS.map(p => `<option ${mt.planta === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></div>
      <div class="fm-form__campo"><label>Cliente</label><input id="mt-cli" value="${esc(mt.cliente || '')}" placeholder="Todos"></div>
      <div class="fm-form__campo"><label>Ano</label><input type="number" id="mt-ano" value="${mt.ano || new Date().getFullYear()}"></div>
      <div class="fm-form__campo"><label>Valor <span class="req">*</span></label><input id="mt-valor" value="${mt.valor ?? ''}" inputmode="decimal"></div>
      <div class="fm-form__campo"><label>Unidade</label><input id="mt-un" value="${esc(mt.unidade || '')}"></div>
      <div class="fm-form__campo"><label>Tipo de comparação</label>
        <select id="mt-comp">${Object.entries(SCHEMA.COMPARACOES).map(([k, v]) =>
          `<option value="${k}" ${mt.comparacao === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></div>
      <div class="fm-form__campo"><label>Valor máximo (faixa)</label><input id="mt-max" value="${mt.valor_max ?? ''}" inputmode="decimal"></div>
      <div class="fm-form__campo"><label>Responsável</label><input id="mt-resp" value="${esc(mt.responsavel || '')}"></div>
    </div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-primary" id="mt-ok">Salvar</button>`
  });
  $('#mt-ok', m.host).addEventListener('click', async () => {
    if (!PODE.configurar) { toast('Somente o Administrador altera metas.', { type: 'crit' }); return; }
    const valor = $('#mt-valor', m.host).value.trim();
    if (!valor) { toast('Informe o valor da meta.', { type: 'warn' }); return; }
    const linha = {
      indicador: $('#mt-ind', m.host).value,
      planta: $('#mt-planta', m.host).value || null,
      cliente: $('#mt-cli', m.host).value.trim() || null,
      ano: Number($('#mt-ano', m.host).value) || null,
      valor: Number(String(valor).replace(/\./g, '').replace(',', '.')),
      valor_max: $('#mt-max', m.host).value ? Number(String($('#mt-max', m.host).value).replace(',', '.')) : null,
      unidade: $('#mt-un', m.host).value.trim() || null,
      comparacao: $('#mt-comp', m.host).value,
      responsavel: $('#mt-resp', m.host).value.trim() || null,
      status: 'Ativo', updated_at: new Date().toISOString()
    };
    try {
      const anterior = id ? await db.get('fm_metas', id) : null;
      const row = id ? await db.update('fm_metas', id, linha)
                     : await db.insert('fm_metas', { ...linha, created_at: new Date().toISOString() });
      await CORE.logar({
        tabela: 'fm_metas', registro_id: row.id, acao: id ? 'meta' : 'insert',
        valor_anterior: anterior ? String(anterior.valor) : null, valor_novo: String(linha.valor),
        campo: linha.indicador, usuario_id: USER.id, usuario: USER.nome, perfil: USER.role
      });
      m.close(); state.painel = null;
      toast('Meta salva.', { type: 'ok' });
      await render();
    } catch (e) { toast(esc(CORE.mensagemErro(e, 'metas')), { type: 'crit' }); }
  });
}

function abrirCriterio() {
  const m = modal({
    title: 'Novo critério do PPM interno',
    size: 'modal-lg',
    content: `${UI.aviso('Um critério novo vale a partir da sua vigência. Meses anteriores continuam com o critério da época — o histórico não é recalculado (§13).', 'alerta')}
      <div class="fm-form" style="grid-template-columns:repeat(2,1fr)">
        <div class="fm-form__campo fm-form__campo--2"><label>Nome <span class="req">*</span></label><input id="cr-nome"></div>
        <div class="fm-form__campo fm-form__campo--2"><label>Descrição</label><textarea id="cr-desc"></textarea></div>
        <div class="fm-form__campo"><label>Vigência início <span class="req">*</span></label><input type="date" id="cr-ini" value="${hojeBR()}"></div>
        <div class="fm-form__campo"><label>Vigência fim</label><input type="date" id="cr-fim"></div>
        <div class="fm-form__campo"><label>Planta</label>
          <select id="cr-planta"><option value="">Todas</option>${PLANTAS.map(p => `<option>${esc(p)}</option>`).join('')}</select></div>
        <div class="fm-form__campo"><label>Responsável pela aprovação</label><input id="cr-aprov"></div>
        <div class="fm-form__campo fm-form__campo--2"><label>Fontes incluídas no numerador <span class="req">*</span></label>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px;max-height:200px;overflow:auto;border:1px solid var(--rna-border);border-radius:9px;padding:10px">
            ${SCHEMA.FONTES_PPM_INTERNO.map(f => `<label style="display:flex;gap:7px;align-items:center;font-weight:400;font-size:12.5px">
              <input type="checkbox" data-fonte="${esc(f)}" style="width:auto"> ${esc(f)}</label>`).join('')}
          </div></div>
        <div class="fm-form__campo fm-form__campo--2"><label>Justificativa <span class="req">*</span></label><textarea id="cr-just"></textarea></div>
      </div>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn rna-btn-primary" id="crn-ok">Criar critério</button>`
  });
  $('#crn-ok', m.host).addEventListener('click', async () => {
    const nome = $('#cr-nome', m.host).value.trim();
    const just = $('#cr-just', m.host).value.trim();
    const fontes = $$('[data-fonte]', m.host).filter(c => c.checked).map(c => c.dataset.fonte);
    if (!nome) { toast('Informe o nome do critério.', { type: 'warn' }); return; }
    if (!fontes.length) { toast('Selecione ao menos uma fonte para o numerador.', { type: 'warn' }); return; }
    if (!just) { toast('A justificativa é obrigatória para criar um critério.', { type: 'warn' }); return; }
    try {
      const anteriores = (await db.list('fm_criterios')).filter(c => c.indicador === 'ppm_interno');
      const row = await db.insert('fm_criterios', {
        indicador: 'ppm_interno', nome, descricao: $('#cr-desc', m.host).value,
        vigencia_inicio: $('#cr-ini', m.host).value, vigencia_fim: $('#cr-fim', m.host).value || null,
        planta: $('#cr-planta', m.host).value || null,
        fontes_incluidas: fontes,
        fontes_excluidas: SCHEMA.FONTES_PPM_INTERNO.filter(f => !fontes.includes(f)),
        status: 'Ativo', aprovado_por: $('#cr-aprov', m.host).value || null,
        aprovado_em: hojeBR(), justificativa: just,
        versao: Math.max(0, ...anteriores.map(c => Number(c.versao || 1))) + 1,
        created_at: new Date().toISOString(), created_by: USER.id
      });
      await CORE.logar({
        tabela: 'fm_criterios', registro_id: row.id, acao: 'criterio',
        valor_novo: `${nome} · v${row.versao} · fontes: ${fontes.join(', ')}`,
        justificativa: just, usuario_id: USER.id, usuario: USER.nome, perfil: USER.role
      });
      m.close(); state.painel = null;
      toast('Critério criado. Ele vale a partir da vigência informada.', { type: 'ok' });
      await render();
    } catch (e) { toast(esc(CORE.mensagemErro(e, 'critérios')), { type: 'crit' }); }
  });
}

/* ========================================================================== */
/* ARRANQUE                                                                    */
/* ---------------------------------------------------------------------------
   Fica no FIM do módulo por causa do top-level await: qualquer `const` de
   módulo declarado depois do primeiro `await` ainda está na zona morta
   temporal quando a execução chega aqui. Iniciar no topo quebrava a página
   com "Cannot access 'ABAS_ORDEM' before initialization" — e, por ser uma
   rejeição de top-level await, o erro NÃO aparecia no console: a tela
   simplesmente ficava vazia. Por isso o try/catch também pinta o erro na tela.
   ========================================================================== */
const ctx = await mountShell();
if (ctx) {
  configurarPermissoes(ctx.user);
  try {
    await iniciar();
  } catch (e) {
    console.error('[FM] falha ao iniciar o módulo:', e);
    const host = document.getElementById('rna-content');
    if (host) {
      host.innerHTML = `<div class="rna-page-head"><div><h1>Fechamento Mensal</h1></div></div>
        ${UI.aviso(`<b>O módulo não pôde ser iniciado.</b><br>${esc(e?.message || String(e))}
          <br><span style="font-size:12px">Detalhes técnicos no console do navegador.</span>`, 'erro')}`;
    }
  }
}
