/* Operações — placeholder de módulos das próximas fases (Checklists/Auditorias) */
import { mountShell } from '../app.js';
import { $ } from '../ui.js';

const ctx = await mountShell();
if (ctx) {
  $('#rna-content').innerHTML = `
    <div class="rna-page-head"><div>
      <div class="rna-breadcrumb"><a href="index.html">Portal</a><i class="bi bi-chevron-right"></i> Operações</div>
      <h1>Em breve</h1><p>Este módulo faz parte da próxima fase da Gestão Operacional.</p></div></div>
    <div class="rna-card"><div class="rna-card__body text-center" style="padding:44px 20px">
      <i class="bi bi-cone-striped" style="font-size:48px;color:var(--rna-yellow-600)"></i>
      <h3 style="margin:14px 0 6px">Disponível na próxima fase</h3>
      <p class="text-muted-2" style="max-width:460px;margin:0 auto 16px">Checklists e Auditorias configuráveis chegam nas Fases 2 e 3, reutilizando o mesmo motor de atividades. Por enquanto, use <b>Minhas Rotinas</b>.</p>
      <a href="op-minhas-rotinas.html" class="rna-btn rna-btn-primary rna-btn-lg"><i class="bi bi-list-check"></i> Ir para Minhas Rotinas</a>
    </div></div>`;
}
