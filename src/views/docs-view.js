// Vista "Docs": las tareas con documentación, de la más nueva a la más antigua, con un buscador
// que filtra por el título de la tarea y por los títulos/subtítulos de su documentación.

import { state, togglePin } from '../services/store.js';
import { h, showToast } from '../utils/ui.js';
import { markdownExcerpt, markdownHeadings } from '../utils/markdown.js';
import { whenLabel } from '../components/cards.js';
import { showTaskModal, openDocTab } from '../components/task-modal.js';

let query = '';
const PINNED_OPEN_KEY = 'cabetodo:docsPinnedOpen';

/** Chinche (contorno; relleno cuando está anclada, por CSS). */
function PIN_ICON() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<path d="M9 4h6l-1 5 3 3v2H7v-2l3-3-1-5z"/><path d="M12 14v6"/>';
  return svg;
}

/** Minúsculas y sin tildes, carácter a carácter, con el índice original de cada carácter. */
function fold(text) {
  let out = '';
  const map = [];
  [...text].forEach((ch, i) => {
    const f = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (let k = 0; k < f.length; k += 1) map.push(i);
    out += f;
  });
  return { out, map, chars: [...text] };
}

export function searchTerms(q) {
  return fold(q).out.split(/\s+/).filter(Boolean);
}

const hits = (text, terms) => { const f = fold(text).out; return terms.some((t) => f.includes(t)); };

/** ¿La tarea cumple la búsqueda? Cada palabra debe estar en el título o en algún título de la doc. */
export function matchTask(task, terms, headings = markdownHeadings(task.doc)) {
  if (!terms.length) return true;
  const haystack = [task.title, ...headings.map((x) => x.text)].map((s) => fold(s).out);
  return terms.every((t) => haystack.some((s) => s.includes(t)));
}

/** Texto con las coincidencias envueltas en <mark>. */
function highlight(text, terms) {
  if (!terms.length) return [text];
  const { out, map, chars } = fold(text);
  const on = new Array(chars.length).fill(false);
  for (const t of terms) {
    for (let i = out.indexOf(t); i !== -1; i = out.indexOf(t, i + 1)) {
      for (let k = i; k < i + t.length; k += 1) on[map[k]] = true;
    }
  }
  const parts = [];
  let i = 0;
  while (i < chars.length) {
    let j = i;
    while (j < chars.length && on[j] === on[i]) j += 1;
    const piece = chars.slice(i, j).join('');
    parts.push(on[i] ? h('mark', {}, piece) : piece);
    i = j;
  }
  return parts;
}

const byNewest = (a, b) => (b.created_at || '').localeCompare(a.created_at || '');

function created(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  const year = d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric';
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short', year });
}

function renderDocCard(task, terms, headings, epicsById) {
  const epic = epicsById.get(task.epic_id);
  const shown = terms.length ? headings.filter((x) => hits(x.text, terms)) : [];

  const pinned = Boolean(task.pinned_at);
  return h('li', { class: `doc-card${task.done ? ' done' : ''}${pinned ? ' pinned' : ''}`, dataset: { id: task.id } },
    h('button', {
      type: 'button', class: 'doc-pin', 'aria-pressed': String(pinned),
      title: pinned ? 'Desanclar' : 'Anclar arriba', 'aria-label': `${pinned ? 'Desanclar' : 'Anclar'} "${task.title}"`,
      onclick: () => {
        const now = togglePin(task.id);
        showToast(now ? `"${task.title}" anclada arriba.` : `"${task.title}" desanclada.`);
      },
    }, PIN_ICON()),
    h('button', {
      type: 'button', class: 'doc-card-open',
      title: 'Abrir la documentación en una pestaña',
      onclick: () => openDocTab(task.id),
    },
    h('span', { class: 'doc-card-title' },
      epic ? h('span', { class: 'dot', style: `background:${epic.color}`, title: epic.name }) : null,
      h('span', { class: 'doc-card-name' }, ...highlight(task.title, terms))),
    shown.length ? h('ul', { class: 'doc-card-headings' },
      ...shown.map((x) => h('li', { style: `--lvl:${Math.min(x.level, 4) - 1}` }, ...highlight(x.text, terms)))) : null,
    shown.length ? null : h('span', { class: 'doc-card-excerpt' }, markdownExcerpt(task.doc, 140))),
    h('div', { class: 'doc-card-foot' },
      h('span', { class: 'doc-card-meta' },
        [created(task.created_at), whenLabel(task), task.done ? '✓ hecha' : null].filter(Boolean).join(' · ')),
      h('button', {
        type: 'button', class: 'link-btn doc-card-detail', title: 'Ver el detalle de la tarea',
        onclick: () => showTaskModal(task.id),
      }, 'Detalle')));
}

export function renderDocs() {
  const root = document.getElementById('docs-list');
  const terms = searchTerms(query);
  const epicsById = new Map(state.epics.map((e) => [e.id, e]));
  // Solo las tareas que tienen documentación escrita
  const documented = state.tasks.filter((t) => t.doc?.trim()).sort(byNewest);
  const rows = documented
    .map((t) => ({ t, headings: markdownHeadings(t.doc) }))
    .filter(({ t, headings }) => matchTask(t, terms, headings));

  const total = documented.length;
  document.getElementById('docs-count').textContent = terms.length
    ? `${rows.length} de ${total}`
    : `${total} tarea${total === 1 ? '' : 's'} con documentación`;

  // Ancladas arriba (la última anclada primero), en su sección plegable
  const pinned = rows.filter(({ t }) => t.pinned_at).sort((a, b) => b.t.pinned_at.localeCompare(a.t.pinned_at));
  const rest = rows.filter(({ t }) => !t.pinned_at);
  const pinnedBox = document.getElementById('docs-pinned');
  pinnedBox.hidden = !pinned.length;
  document.getElementById('docs-pinned-count').textContent = `(${pinned.length})`;
  document.getElementById('docs-pinned-list').replaceChildren(...pinned.map(({ t, headings }) => renderDocCard(t, terms, headings, epicsById)));

  if (!rows.length) {
    root.replaceChildren(h('li', { class: 'empty' },
      total ? `Nada coincide con "${query.trim()}"`
        : 'Ninguna tarea tiene documentación todavía. Escríbela desde el detalle de una tarea, en la sección Documentación.'));
    return;
  }
  root.replaceChildren(...rest.map(({ t, headings }) => renderDocCard(t, terms, headings, epicsById)));
}

export function setupDocs() {
  // Sección de ancladas: abierta por defecto; se recuerda abierta/cerrada en este navegador
  const pinnedBox = document.getElementById('docs-pinned');
  try { pinnedBox.open = localStorage.getItem(PINNED_OPEN_KEY) !== '0'; } catch { pinnedBox.open = true; }
  pinnedBox.addEventListener('toggle', () => {
    try { localStorage.setItem(PINNED_OPEN_KEY, pinnedBox.open ? '1' : '0'); } catch { /* ignorar */ }
  });
  const input = document.getElementById('docs-search');
  input.addEventListener('input', () => { query = input.value; renderDocs(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; query = ''; renderDocs(); }
  });
}
