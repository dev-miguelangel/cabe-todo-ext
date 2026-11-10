// Piezas de UI compartidas: helper para crear elementos, aviso temporal y autocompletado de #épicas.

import { slugify, tagKey } from './parser.js';

/** h('div', { class: 'x', dataset: { id: 1 }, onclick }, ...hijos) */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style') el.style.cssText = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (typeof value === 'boolean') el[key] = value;
    else el.setAttribute(key, value);
  }
  el.append(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

// ---------- Aviso temporal ----------

let toastTimer;
export function showToast(message, action) {
  const el = document.getElementById('toast');
  const hide = () => { el.hidden = true; };
  el.replaceChildren(h('span', {}, message));
  if (action) {
    el.append(h('button', {
      class: 'toast-action',
      onclick: () => { hide(); action.run(); },
    }, action.label));
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hide, action ? 8000 : 4000);
}

// ---------- Autocompletado de #épica ----------

/**
 * Al escribir "#" en el input sugiere épicas existentes (o crear una nueva).
 * ↑/↓ para moverse, Enter/Tab para elegir, Escape para cerrar.
 * Debe llamarse ANTES de agregar otros listeners de keydown al input.
 */
export function attachEpicAutocomplete(input, getEpics) {
  let box = null;
  let items = [];
  let index = 0;

  function tokenAtCaret() {
    const pos = input.selectionStart ?? input.value.length;
    const m = input.value.slice(0, pos).match(/(^|\s)#([\p{L}\p{N}_-]*)$/u);
    return m ? { start: pos - m[2].length - 1, end: pos, typed: m[2] } : null;
  }

  function close() {
    box?.remove();
    box = null;
    items = [];
    index = 0;
  }

  function draw() {
    if (!box) {
      box = h('div', { class: 'autocomplete', role: 'listbox' });
      document.body.append(box);
    }
    box.replaceChildren(...items.map((it, i) => h('div', {
      class: `ac-item${i === index ? ' active' : ''}`,
      role: 'option',
      onmousedown: (e) => { e.preventDefault(); pick(i); },
    },
    it.create ? h('span', { class: 'ac-plus' }, '+') : h('span', { class: 'dot', style: `background:${it.color}` }),
    h('span', {}, it.label))));
    const rect = input.getBoundingClientRect();
    box.style.left = `${rect.left + window.scrollX}px`;
    box.style.top = `${rect.bottom + 2 + window.scrollY}px`;
    box.style.width = `${rect.width}px`;
  }

  function update() {
    const tok = tokenAtCaret();
    if (!tok) return close();
    const key = tagKey(tok.typed);
    const epics = getEpics().filter((e) => !key || tagKey(e.name).includes(key));
    items = epics.map((e) => ({ label: e.name, color: e.color, insert: slugify(e.name) }));
    if (key && /^\p{L}/u.test(tok.typed) && !epics.some((e) => tagKey(e.name) === key)) {
      items.push({ label: `Crear épica "${tok.typed.replace(/[-_]+/g, ' ')}"`, create: true, insert: tok.typed });
    }
    if (!items.length) return close();
    index = Math.min(index, items.length - 1);
    draw();
  }

  function pick(i) {
    const tok = tokenAtCaret();
    const it = items[i];
    if (!tok || !it) return close();
    const text = `#${it.insert} `;
    const rest = input.value.slice(tok.end).replace(/^\s+/, '');
    input.value = input.value.slice(0, tok.start) + text + rest;
    const caret = tok.start + text.length;
    input.setSelectionRange(caret, caret);
    close();
  }

  input.addEventListener('input', () => { index = 0; update(); });
  input.addEventListener('keydown', (e) => {
    if (!box) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      index = (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      draw();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      e.stopImmediatePropagation();
      pick(index);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopImmediatePropagation();
      close();
    }
  });
  input.addEventListener('blur', close);
}
