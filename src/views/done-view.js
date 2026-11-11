// Vista "Hechas": todas las tareas completadas, agrupadas por el día en que se terminaron.
// Cada día empieza con una línea horizontal y la fecha a la derecha: ───────── 11-11-2026

import { state, updateTask } from '../services/store.js';
import { h } from '../utils/ui.js';
import { formatDMY, todayISO, shiftDate } from '../utils/dates.js';
import { formatMinutes } from '../core/parser.js';
import { doneByDay } from '../core/history.js';
import { renderCard } from '../components/cards.js';
import { showTaskModal } from '../components/task-modal.js';

function dayDivider(date, tasks) {
  const minutes = tasks.reduce((sum, t) => sum + (t.minutes || 0), 0);
  const today = todayISO();
  const hint = date === today ? 'hoy · ' : date === shiftDate(today, -1) ? 'ayer · ' : '';
  return h('li', { class: 'done-divider', role: 'separator' },
    h('span', { class: 'done-line', 'aria-hidden': 'true' }),
    h('span', {
      class: 'done-date',
      title: `${hint}${tasks.length} tarea${tasks.length === 1 ? '' : 's'} · ${formatMinutes(minutes)} estimados`,
    }, date === '0000-00-00' ? 'sin fecha' : formatDMY(date)));
}

export function renderDone() {
  const groups = doneByDay(state.tasks);
  const total = groups.reduce((n, g) => n + g.tasks.length, 0);
  document.getElementById('done-count').textContent = total
    ? `${total} tarea${total === 1 ? '' : 's'} completada${total === 1 ? '' : 's'}`
    : '';
  const ctx = {
    byId: new Map(state.tasks.map((t) => [t.id, t])),
    epicsById: new Map(state.epics.map((e) => [e.id, e])),
    critical: new Set(),
    planDate: state.viewDate,
  };
  const list = document.getElementById('done-list');
  if (!total) {
    list.replaceChildren(h('li', { class: 'empty' }, 'Todavía no completas tareas. Aquí aparecerán, día por día.'));
    return;
  }
  list.replaceChildren(...groups.flatMap(({ date, tasks }) => [
    dayDivider(date, tasks),
    ...tasks.map((task) => renderCard(task, { ctx, link: false })),
  ]));
}

export function setupDone() {
  const list = document.getElementById('done-list');
  // Desmarcar = vuelve a estar pendiente (y sale de esta lista)
  list.addEventListener('change', (e) => {
    if (e.target.matches('.task .check')) updateTask(e.target.closest('.task').dataset.id, { done: e.target.checked });
  });
  list.addEventListener('click', (e) => {
    const li = e.target.closest('.task');
    if (li && !e.target.closest('button, input, textarea')) showTaskModal(li.dataset.id);
  });
}
