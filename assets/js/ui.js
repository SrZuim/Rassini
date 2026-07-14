/* ==========================================================================
   RNA One — Utilitários de UI (toasts, formatação, helpers de DOM)
   ========================================================================== */

export const $  = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function toast(message, { title = 'RNA One', type = 'info', timeout = 4200 } = {}) {
  let wrap = $('#rna-toasts');
  if (!wrap) { wrap = el('<div id="rna-toasts"></div>'); document.body.appendChild(wrap); }
  const icons = { info:'bi-info-circle-fill', ok:'bi-check-circle-fill', warn:'bi-exclamation-triangle-fill', crit:'bi-x-octagon-fill' };
  const node = el(`<div class="rna-toast ${type}">
    <i class="bi ${icons[type] || icons.info}"></i>
    <div><b>${title}</b><p>${message}</p></div>
  </div>`);
  wrap.appendChild(node);
  setTimeout(() => { node.style.opacity = '0'; node.style.transform = 'translateX(30px)'; node.style.transition = '.25s'; setTimeout(() => node.remove(), 260); }, timeout);
}

export function fmtDate(d) {
  if (!d) return '—';
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date)) return d;
  return date.toLocaleDateString('pt-BR');
}
export function fmtNum(n) { return new Intl.NumberFormat('pt-BR').format(n); }

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map(p => p[0]?.toUpperCase() || '').join('') || 'RN';
}

/** Modal genérico baseado em Bootstrap. content = HTML string. */
export function modal({ title, content, size = '', footer = '' }) {
  $('#rna-modal-host')?.remove();
  const host = el(`<div id="rna-modal-host" class="modal fade" tabindex="-1">
    <div class="modal-dialog ${size} modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content" style="border:0;border-radius:16px;overflow:hidden">
        <div class="modal-header" style="background:var(--rna-graphite);color:#fff;border:0">
          <h5 class="modal-title" style="font-size:15px;font-weight:650">${title}</h5>
          <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
        </div>
        <div class="modal-body" style="padding:20px">${content}</div>
        ${footer ? `<div class="modal-footer" style="border-top:1px solid var(--rna-border)">${footer}</div>` : ''}
      </div>
    </div>
  </div>`);
  document.body.appendChild(host);
  const inst = new bootstrap.Modal(host);
  // Remove o host + backdrop de forma robusta. A transição de "hide" do Bootstrap
  // pode ser interrompida por um re-render pesado logo após fechar (deixando o
  // modal/backdrop presos na tela). Por isso limpamos manualmente, sem depender só
  // do evento hidden.bs.modal.
  const cleanup = () => {
    host.remove();
    if (!document.querySelector('.modal.show')) {   // não interfere em modais empilhados
      document.querySelectorAll('.modal-backdrop').forEach(b => b.remove());
      document.body.classList.remove('modal-open');
      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('padding-right');
    }
  };
  host.addEventListener('hidden.bs.modal', cleanup);
  inst.show();
  const close = () => { try { inst.hide(); } catch { /* ignora */ } setTimeout(() => { if (document.body.contains(host)) cleanup(); }, 250); };
  return { host, inst, close };
}

export function confirmDialog(message, onConfirm, { title = 'Confirmar ação', okLabel = 'Confirmar', danger = false } = {}) {
  const m = modal({
    title, content: `<p style="margin:0;font-size:14px">${message}</p>`,
    footer: `<button class="rna-btn rna-btn-ghost" data-bs-dismiss="modal">Cancelar</button>
             <button class="rna-btn ${danger ? 'rna-btn-dark' : 'rna-btn-primary'}" id="rna-confirm-ok">${okLabel}</button>`
  });
  $('#rna-confirm-ok', m.host).addEventListener('click', () => {
    m.close();
    // onConfirm pode ser async: captura rejeições p/ nunca falhar em silêncio.
    Promise.resolve().then(() => onConfirm?.()).catch(err => {
      console.error('[confirmDialog] Ação falhou:', err);
      toast((err && err.message) || 'Não foi possível concluir a ação.', { type: 'crit' });
    });
  });
}

/** spinner de tela cheia simples */
export function loading(on = true) {
  let l = $('#rna-loading');
  if (on) {
    if (!l) {
      l = el(`<div id="rna-loading" style="position:fixed;inset:0;background:rgba(244,246,248,.6);z-index:5000;display:grid;place-items:center">
        <div class="spinner-border" style="color:var(--rna-yellow)"></div></div>`);
      document.body.appendChild(l);
    }
  } else { l?.remove(); }
}
