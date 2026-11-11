// Editor Markdown compartido (modal de tarea y pestaña de documentación):
// pestañas Código / Lectura y, en Código, barra de botones rápidos.

import { renderMarkdown } from '../utils/markdown.js';
import { applyFormat, TOOLBAR, SHORTCUTS } from '../utils/md-format.js';
import { h } from '../utils/ui.js';

/** Vista de lectura. renderMarkdown escapa todo el HTML, así que innerHTML es seguro. */
export function markdownView(text, { headingBase, empty = 'Nada que mostrar todavía.' } = {}) {
  const box = h('div', { class: 'md' });
  if (text.trim()) box.innerHTML = renderMarkdown(text, { headingBase });
  else box.append(h('p', { class: 'md-empty' }, empty));
  return box;
}

/** Aplica un botón de la barra sobre el textarea y deja seleccionado lo que conviene completar. */
function format(area, kind, onInput) {
  const { text, start, end } = applyFormat(area.value, area.selectionStart, area.selectionEnd, kind);
  area.focus();
  area.value = text; // nota: los cambios hechos con botones no entran al ⌘Z del navegador
  area.setSelectionRange(start, end);
  onInput(area.value);
}

/**
 * o: { key, text, tab: 'code'|'read', onInput(v), onTab(t), placeholder, rows,
 *      headingBase, className, toolbarStart(area) → [botones], onKeydown(e) }
 */
export function markdownEditor(o) {
  const area = h('textarea', {
    class: 'md-input',
    rows: String(o.rows || 4),
    placeholder: o.placeholder || '',
    dataset: { key: o.key },
    'aria-label': o.label || 'Texto en Markdown',
    spellcheck: 'true',
  });
  area.value = o.text;
  area.addEventListener('input', () => o.onInput(area.value));
  area.addEventListener('keydown', (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && SHORTCUTS[e.key.toLowerCase()]) {
      e.preventDefault();
      format(area, SHORTCUTS[e.key.toLowerCase()], o.onInput);
      return;
    }
    // Tab inserta sangría en vez de saltar de campo
    if (e.key === 'Tab' && !e.shiftKey && !mod) {
      e.preventDefault();
      area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end');
      o.onInput(area.value);
      return;
    }
    o.onKeydown?.(e);
  });

  const tabBtn = (id, label) => h('button', {
    type: 'button',
    class: `md-tab${o.tab === id ? ' active' : ''}`,
    role: 'tab',
    'aria-selected': String(o.tab === id),
    dataset: { key: `${o.key}-tab-${id}` },
    onclick: () => o.onTab(id),
  }, label);

  // o.toolbarStart(area): botones propios al inicio de la barra (p. ej. "Plantilla" en la documentación)
  const start = o.tab === 'code' && o.toolbarStart ? o.toolbarStart(area) : [];
  const toolbar = o.tab === 'code' ? h('div', { class: 'md-toolbar', role: 'toolbar', 'aria-label': 'Formato' },
    ...start,
    ...(start.length ? [h('span', { class: 'md-tb-sep', 'aria-hidden': 'true' })] : []),
    ...TOOLBAR.map((b) => (b.sep
      ? h('span', { class: 'md-tb-sep', 'aria-hidden': 'true' })
      : h('button', {
        type: 'button',
        class: `md-tb${b.className ? ` ${b.className}` : ''}`,
        title: b.title,
        'aria-label': b.title,
        // mousedown evita que el textarea pierda la selección antes del clic
        onmousedown: (e) => e.preventDefault(),
        onclick: () => format(area, b.kind, o.onInput),
      }, b.label)))) : null;

  return h('div', { class: `md-editor${o.className ? ` ${o.className}` : ''}` },
    h('div', { class: 'md-tabs', role: 'tablist' }, tabBtn('code', 'Código'), tabBtn('read', 'Lectura')),
    toolbar,
    o.tab === 'code' ? area : markdownView(o.text, { headingBase: o.headingBase }));
}
