/* ==========================================================================
   RNA One — Lista suspensa pesquisável (comboFiltro)
   Componente reutilizável para filtros de consulta: pesquisa interna, opção
   "Todos", navegação por teclado (setas/Enter/Esc), toque, limpar seleção e
   estado vazio. Reaproveita o visual do combobox da Biblioteca Técnica
   (.bib-combo-panel / .bib-combo-opt / .bib-combo-empty).
   ========================================================================== */
import { el } from './ui.js';

const norm = s => String(s ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();
const escHtml = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const MAX_OPCOES = 200;

/**
 * Transforma um <input> em lista suspensa pesquisável.
 * @param {HTMLInputElement} input — input já no DOM (dentro de .rna-combo, ou é embrulhado)
 * @param {object} cfg — { allLabel, options:[{value,label}], emptyText, onChange(value) }
 * @returns API { value, set(v), setOptions(list,{emptyText}), clear({silent}), input }
 */
export function comboFiltro(input, { allLabel = 'Todos', options = [], emptyText = 'Nenhum resultado encontrado', onChange = null } = {}) {
  const st = { value: '', opts: options.slice(), emptyText, panel: null, hi: 0, query: null };

  let wrap = input.closest('.rna-combo');
  if (!wrap) { wrap = el('<div class="rna-combo bib-combo"></div>'); input.parentNode.insertBefore(wrap, input); wrap.appendChild(input); }
  input.classList.add('rna-combo__input');
  input.placeholder = allLabel;
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'false');
  wrap.appendChild(el('<i class="bi bi-chevron-down rna-combo__caret" aria-hidden="true"></i>'));
  const btnClear = el('<button type="button" class="rna-combo__clear" title="Limpar seleção" aria-label="Limpar seleção"><i class="bi bi-x-lg"></i></button>');
  wrap.appendChild(btnClear);

  const labelDe = v => st.opts.find(o => String(o.value) === String(v))?.label ?? '';
  const matches = () => {
    const q = norm(st.query ?? '');
    const lista = q ? st.opts.filter(o => norm(o.label).includes(q) || norm(o.value).includes(q)) : st.opts;
    return lista.slice(0, MAX_OPCOES);
  };
  function sync() {
    input.value = st.value ? labelDe(st.value) : '';
    wrap.classList.toggle('has-value', !!st.value);
  }

  /* ------------------------------------------------------------- painel --- */
  function abrir() {
    if (st.panel || input.disabled) return;
    st.query = '';
    st.hi = 0;
    st.panel = el('<div class="bib-combo-panel rna-combo-panel" role="listbox"></div>');
    document.body.appendChild(st.panel);
    input.setAttribute('aria-expanded', 'true');
    posicionar(); renderOpcoes();
    st._pos = () => posicionar();
    window.addEventListener('scroll', st._pos, true);
    window.addEventListener('resize', st._pos);
    input.select();
  }
  function fechar() {
    if (!st.panel) return;
    window.removeEventListener('scroll', st._pos, true);
    window.removeEventListener('resize', st._pos);
    st.panel.remove(); st.panel = null; st.query = null;
    input.setAttribute('aria-expanded', 'false');
    sync();
  }
  function posicionar() {
    if (!st.panel) return;
    const r = input.getBoundingClientRect(), p = st.panel;
    p.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 8 - Math.max(r.width, 220))) + 'px';
    p.style.top = (r.bottom + 3) + 'px';
    p.style.minWidth = Math.max(r.width, 220) + 'px';
    p.style.maxWidth = (window.innerWidth - 16) + 'px';
  }
  function realce(nome, q) {
    const n = norm(q); if (!n) return escHtml(nome);
    const i = norm(nome).indexOf(n); if (i < 0) return escHtml(nome);
    return `${escHtml(nome.slice(0, i))}<mark>${escHtml(nome.slice(i, i + q.length))}</mark>${escHtml(nome.slice(i + q.length))}`;
  }
  function renderOpcoes() {
    if (!st.panel) return;
    const q = (st.query ?? '').trim();
    const list = matches();
    const total = list.length + 1;                       /* +1 = opção "Todos" */
    if (st.hi >= total) st.hi = 0;
    st.panel.innerHTML =
      `<button type="button" class="bib-combo-opt rna-combo-all ${st.hi === 0 ? 'hi' : ''}" data-all="1" role="option">${escHtml(allLabel)}</button>` +
      (list.length
        ? list.map((o, i) => `<button type="button" class="bib-combo-opt ${st.hi === i + 1 ? 'hi' : ''}" data-i="${i}" role="option">${realce(o.label, q)}</button>`).join('')
        : `<div class="bib-combo-empty">${escHtml(st.emptyText)}</div>`);
    st.panel.querySelector('[data-all]')?.addEventListener('mousedown', e => { e.preventDefault(); escolher(''); });
    st.panel.querySelectorAll('[data-i]').forEach(b =>
      b.addEventListener('mousedown', e => { e.preventDefault(); escolher(list[+b.dataset.i].value); }));
    st.panel.querySelector('.hi')?.scrollIntoView({ block: 'nearest' });
  }
  function escolher(valor, { silent = false } = {}) {
    const mudou = String(st.value) !== String(valor);
    st.value = valor; fechar(); sync();
    if (mudou && !silent) onChange?.(valor);
  }

  /* ------------------------------------------------------------- eventos --- */
  input.addEventListener('focus', abrir);
  input.addEventListener('click', abrir);
  input.addEventListener('input', () => { if (!st.panel) abrir(); st.query = input.value; st.hi = 0; renderOpcoes(); });
  input.addEventListener('blur', () => setTimeout(() => {
    if (!st.panel) return;
    /* texto digitado que casa exatamente com uma opção é aceito como seleção */
    const digitado = (st.query ?? '').trim();
    const exato = digitado ? st.opts.find(o => norm(o.label) === norm(digitado) || norm(o.value) === norm(digitado)) : null;
    if (exato) escolher(exato.value); else fechar();
  }, 150));
  input.addEventListener('keydown', e => {
    if (!st.panel) { if (e.key === 'ArrowDown') { abrir(); e.preventDefault(); } return; }
    const list = matches(), total = list.length + 1;
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopImmediatePropagation(); st.hi = (st.hi + 1) % total; renderOpcoes(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); st.hi = (st.hi - 1 + total) % total; renderOpcoes(); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); if (st.hi === 0) escolher(''); else if (list[st.hi - 1]) escolher(list[st.hi - 1].value); else fechar(); }
    else if (e.key === 'Escape') { e.stopImmediatePropagation(); fechar(); }
    else if (e.key === 'Tab') fechar();
  });
  btnClear.addEventListener('mousedown', e => e.preventDefault());
  btnClear.addEventListener('click', () => { escolher(''); input.focus(); });

  sync();

  /* ------------------------------------------------------------------ API --- */
  return {
    get value() { return st.value; },
    set(v, { silent = true } = {}) { escolher(v, { silent }); },
    setOptions(list, { emptyText: et } = {}) {
      st.opts = (list || []).slice();
      if (et) st.emptyText = et;
      if (st.value && !st.opts.some(o => String(o.value) === String(st.value))) st.value = '';
      sync(); if (st.panel) { st.hi = 0; renderOpcoes(); }
    },
    clear({ silent = true } = {}) { escolher('', { silent }); },
    input
  };
}
