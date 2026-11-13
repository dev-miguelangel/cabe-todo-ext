// Vista "Tareas" (pestaña con el ícono ✓; antes "Hechas"): todas las tareas agrupadas, con filtros
// Todas · Atrasadas · Backlog · Hechas y búsqueda. Compartida con la versión web.
//
// - Todas: Atrasadas, Hoy, Próximas, Backlog y Hechas (los últimos 7 días, con "Ver todas").
// - Hechas: por el día en que se terminaron, cada día con su línea: ───────── 11-11-2026
// Cada grupo empieza con una línea horizontal y su nombre a la derecha. Tocar una tarea abre su detalle.

import { state, updateTask, findEpic } from '../services/store.js';
import { h } from '../utils/ui.js';
import { formatDMY, todayISO, shiftDate } from '../utils/dates.js';
import { formatMinutes } from '../core/parser.js';
import { groupTasks, matchesQuery } from '../core/history.js';
import { renderCard } from '../components/cards.js';
import { showTaskModal } from '../components/task-modal.js';
import { openMoveMenu } from '../components/move-menu.js';

const FILTER_KEY = 'cabetodo:tasksFilter';
const FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'overdue', label: 'Atrasadas' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'done', label: 'Hechas' },
];
const RECENT_DONE_DAYS = 7;

let filter = (() => {
  try {
    const saved = localStorage.getItem(FILTER_KEY);
    return FILTERS.some((f) => f.id === saved) ? saved : 'all';
  } catch {
    return 'all';
  }
})();
let query = '';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function divider(label, { title = '', now = false } = {}) {
  return h('li', { class: `done-divider${now ? ' is-now' : ''}`, role: 'separator' },
    h('span', { class: 'done-line', 'aria-hidden': 'true' }),
    h('span', { class: 'done-date', title: title || null }, label));
}

function dayDivider(date, tasks) {
  const minutes = tasks.reduce((sum, t) => sum + (t.minutes || 0), 0);
  const today = todayISO();
  const hint = date === today ? 'hoy · ' : date === shiftDate(today, -1) ? 'ayer · ' : '';
  return divider(date === '0000-00-00' ? 'sin fecha' : formatDMY(date), {
    title: `${hint}${plural(tasks.length, 'tarea')} · ${formatMinutes(minutes)} estimados`,
  });
}

export function renderDone() {
  const today = todayISO();
  const epicName = (t) => findEpic(t.epic_id)?.name || '';
  const visible = query.trim() ? state.tasks.filter((t) => matchesQuery(t, query, epicName(t))) : state.tasks;
  const g = groupTasks(visible, today);
  const doneCount = g.done.reduce((n, d) => n + d.tasks.length, 0);
  const counts = { all: visible.length, overdue: g.overdue.length, backlog: g.backlog.length, done: doneCount };

  // Filtros con su cantidad
  const chips = document.getElementById('tasks-filters');
  chips.replaceChildren(...FILTERS.map((f) => h('button', {
    type: 'button',
    class: `tasks-filter${f.id === filter ? ' on' : ''}${f.id === 'overdue' && counts.overdue ? ' warn' : ''}`,
    dataset: { filter: f.id },
    'aria-pressed': String(f.id === filter),
  }, f.label, h('span', { class: 'tasks-filter-count' }, String(counts[f.id])))));

  const pending = g.overdue.length + g.today.length + g.upcoming.length + g.backlog.length;
  document.getElementById('done-count').textContent = state.tasks.length
    ? `${plural(pending, 'pendiente')} · ${plural(doneCount, 'hecha')}`
    : '';

  const ctx = {
    byId: new Map(state.tasks.map((t) => [t.id, t])),
    epicsById: new Map(state.epics.map((e) => [e.id, e])),
    critical: new Set(),
  };
  const card = (task, extra = {}) => renderCard(task, { ctx, move: !task.done, ...extra });
  const group = (label, tasks, extra, opts) => (tasks.length
    ? [divider(`${label} (${tasks.length})`, opts), ...tasks.map((t) => card(t, extra))]
    : []);
  const doneDays = (days) => days.flatMap(({ date, tasks }) => [dayDivider(date, tasks), ...tasks.map((t) => card(t))]);

  let items = [];
  if (filter === 'all') {
    const since = shiftDate(today, -(RECENT_DONE_DAYS - 1));
    const recent = g.done.filter((d) => d.date >= since);
    const olderCount = doneCount - recent.reduce((n, d) => n + d.tasks.length, 0);
    items = [
      ...group('Atrasadas', g.overdue, { when: true }),
      ...group('Hoy', g.today, { showBlock: true }, { now: true }),
      ...group('Próximas', g.upcoming, { when: true }),
      ...group('Backlog', g.backlog, {}),
      ...(recent.length ? [divider(`Hechas · últimos ${RECENT_DONE_DAYS} días`), ...recent.flatMap(({ tasks }) => tasks.map((t) => card(t, { when: true })))] : []),
      ...(olderCount ? [h('li', { class: 'tasks-more' },
        h('button', { type: 'button', class: 'link-btn', dataset: { filter: 'done' } }, `Ver todas las hechas (${doneCount})`))] : []),
    ];
  } else if (filter === 'overdue') {
    items = group('Atrasadas', g.overdue, { when: true });
  } else if (filter === 'backlog') {
    items = group('Backlog', g.backlog, {});
  } else {
    items = doneDays(g.done);
  }

  const list = document.getElementById('done-list');
  if (items.length) {
    list.replaceChildren(...items);
    return;
  }
  const empty = query.trim()
    ? `Nada coincide con "${query.trim()}".`
    : {
      all: 'Todavía no tienes tareas. Escribe una en Hoy.',
      overdue: 'Nada atrasado. ¡Bien!',
      backlog: 'El backlog está vacío. Escribe bl al final de una tarea para dejarla aquí.',
      done: 'Todavía no completas tareas. Aquí aparecerán, día por día.',
    }[filter];
  list.replaceChildren(h('li', { class: 'empty' }, empty));
}

function setFilter(id) {
  filter = id;
  try { localStorage.setItem(FILTER_KEY, id); } catch { /* sin almacenamiento */ }
  renderDone();
  document.getElementById('view-done')?.scrollIntoView({ block: 'start' });
}

export function setupDone() {
  document.getElementById('tasks-filters').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (btn) setFilter(btn.dataset.filter);
  });
  const search = document.getElementById('tasks-search');
  search.addEventListener('input', () => {
    query = search.value;
    renderDone();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) {
      search.value = '';
      query = '';
      renderDone();
    }
  });

  const list = document.getElementById('done-list');
  // Marcar o desmarcar desde aquí
  list.addEventListener('change', (e) => {
    if (e.target.matches('.task .check')) updateTask(e.target.closest('.task').dataset.id, { done: e.target.checked });
  });
  list.addEventListener('click', (e) => {
    const more = e.target.closest('[data-filter]');
    if (more) {
      setFilter(more.dataset.filter);
      return;
    }
    const move = e.target.closest('.move-btn');
    if (move) {
      openMoveMenu(move.closest('.task').dataset.id, move);
      return;
    }
    const li = e.target.closest('.task');
    if (li && !e.target.closest('button, input, textarea')) showTaskModal(li.dataset.id);
  });
}
