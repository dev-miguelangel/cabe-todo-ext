// Vista "Docs": todas las tareas, de la más nueva a la más antigua, con un buscador
// que filtra por el título de la tarea y por los títulos/subtítulos de su documentación.

import { state } from './store.js';
import { h } from './ui.js';
import { markdownExcerpt, markdownHeadings } from './markdown.js';
import { whenLabel } from './cards.js';
import { showTaskModal, openDocTab } from './task-modal.js';

let query = '';

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
  const hasDoc = Boolean(task.doc?.trim());
  const shown = terms.length ? headings.filter((x) => hits(x.text, terms)) : [];

  return h('li', { class: `doc-card${task.done ? ' done' : ''}${hasDoc ? '' : ' no-doc'}`, dataset: { id: task.id } },
    h('button', {
      type: 'button', class: 'doc-card-open',
      title: hasDoc ? 'Abrir la documentación en una pestaña' : 'Escribir la documentación en una pestaña',
      onclick: () => openDocTab(task.id),
    },
    h('span', { class: 'doc-card-title' },
      epic ? h('span', { class: 'dot', style: `background:${epic.color}`, title: epic.name }) : null,
      h('span', { class: 'doc-card-name' }, ...highlight(task.title, terms))),
    shown.length ? h('ul', { class: 'doc-card-headings' },
      ...shown.map((x) => h('li', { style: `--lvl:${Math.min(x.level, 4) - 1}` }, ...highlight(x.text, terms)))) : null,
    hasDoc && !shown.length ? h('span', { class: 'doc-card-excerpt' }, markdownExcerpt(task.doc, 140)) : null,
    hasDoc ? null : h('span', { class: 'doc-card-excerpt none' }, 'Sin documentación')),
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
  const rows = [...state.tasks].sort(byNewest)
    .map((t) => ({ t, headings: markdownHeadings(t.doc) }))
    .filter(({ t, headings }) => matchTask(t, terms, headings));

  const total = state.tasks.length;
  document.getElementById('docs-count').textContent = terms.length
    ? `${rows.length} de ${total}`
    : `${total} tarea${total === 1 ? '' : 's'} · ${state.tasks.filter((t) => t.doc?.trim()).length} con documentación`;

  if (!rows.length) {
    root.replaceChildren(h('li', { class: 'empty' },
      total ? `Nada coincide con "${query.trim()}"` : 'Todavía no hay tareas'));
    return;
  }
  root.replaceChildren(...rows.map(({ t, headings }) => renderDocCard(t, terms, headings, epicsById)));
}

export function setupDocs() {
  const input = document.getElementById('docs-search');
  input.addEventListener('input', () => { query = input.value; renderDocs(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; query = ''; renderDocs(); }
  });
}
