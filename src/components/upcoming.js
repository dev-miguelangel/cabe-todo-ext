// Modal "Próximos 7 días": las tareas de mañana en adelante, agrupadas por día con el mismo
// separador de la vista Hechas: ───────── jue 12-11-2026. Clic en un día lo abre en Hoy.

import { state, dayTasks, subscribe, updateTask, ensureRoutines } from '../services/store.js';
import { h, openModal, closeModal, isModalOpen } from '../utils/ui.js';
import { blockIndex } from '../core/blocks.js';
import { criticalIds } from '../core/pert.js';
import { formatMinutes } from '../core/parser.js';
import { todayISO, shiftDate, formatDMY, shortLabel } from '../utils/dates.js';
import { renderCard } from './cards.js';
import { showTaskModal } from './task-modal.js';

const DAYS = 7;
let isOpen = false;
let goTo = () => {};

const nextDates = () => Array.from({ length: DAYS }, (_, i) => shiftDate(todayISO(), i + 1));

/** Orden dentro del día: por bloque, reuniones por hora y luego el orden manual. */
function sortDay(list) {
  const rank = (t) => blockIndex(state.settings, t.block);
  return [...list].sort((a, b) => rank(a) - rank(b)
    || (a.meeting?.start || '').localeCompare(b.meeting?.start || '')
    || a.order - b.order);
}

function dayDivider(date, list) {
  const pending = list.filter((t) => !t.done);
  const minutes = pending.reduce((sum, t) => sum + (t.minutes || 0), 0);
  const weekday = shortLabel(date).split(' ')[0];
  return h('li', { class: 'done-divider upcoming-day' },
    h('span', { class: 'done-line', 'aria-hidden': 'true' }),
    h('button', {
      type: 'button', class: 'done-date upcoming-go', dataset: { date },
      title: `Abrir el ${shortLabel(date)} en Hoy${pending.length ? ` · ${pending.length} pendiente${pending.length === 1 ? '' : 's'}, ${formatMinutes(minutes)}` : ''}`,
    }, `${weekday} ${formatDMY(date)}`));
}

function render() {
  const ctx = {
    allTasks: state.tasks,
    byId: new Map(state.tasks.map((t) => [t.id, t])),
    epicsById: new Map(state.epics.map((e) => [e.id, e])),
    critical: criticalIds(state.tasks),
    planDate: todayISO(),
  };
  const dates = nextDates();
  let total = 0;
  const nodes = dates.flatMap((date) => {
    const list = sortDay(dayTasks(date));
    total += list.length;
    return [dayDivider(date, list), ...(list.length
      ? list.map((t) => renderCard(t, { ctx, showBlock: true }))
      : [h('li', { class: 'minimal-empty' }, 'Sin tareas')])];
  });
  openModal('Próximos 7 días', [
    h('div', { class: 'upcoming' },
      h('p', { class: 'pick-lead' }, total
        ? `${total} tarea${total === 1 ? '' : 's'} de mañana al ${shortLabel(dates.at(-1))}. Toca un día para abrirlo en Hoy.`
        : 'Nada planificado para los próximos 7 días.'),
      h('ul', { class: 'done-list upcoming-list' }, ...nodes)),
  ], () => { isOpen = false; });
}

/** Abre el modal. onGoToDay(iso): abrir ese día en la vista Hoy. */
export function showUpcoming(onGoToDay) {
  goTo = onGoToDay || goTo;
  ensureRoutines(true, nextDates()); // las rutinas de estos días se crean al mirarlos
  isOpen = true;
  render();
  const dialog = document.getElementById('modal');
  if (!dialog.dataset.upcomingWired) {
    dialog.dataset.upcomingWired = '1';
    dialog.addEventListener('click', onClick);
    dialog.addEventListener('change', onChange);
  }
}

function onClick(e) {
  if (!isOpen || !e.target.closest('.upcoming')) return;
  const day = e.target.closest('.upcoming-go');
  if (day) {
    isOpen = false;
    closeModal();
    goTo(day.dataset.date);
    return;
  }
  const li = e.target.closest('.task');
  if (li && !e.target.closest('button, input')) {
    isOpen = false; // el detalle de la tarea reemplaza este modal
    showTaskModal(li.dataset.id);
  }
}

function onChange(e) {
  if (!isOpen || !e.target.matches('.upcoming .task .check')) return;
  updateTask(e.target.closest('.task').dataset.id, { done: e.target.checked });
}

// Mientras está abierto, se actualiza con cada cambio
subscribe(() => {
  if (isOpen && isModalOpen() && document.querySelector('#modal .upcoming')) render();
});
