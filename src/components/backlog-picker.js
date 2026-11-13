// Modal "Pendientes → hoy": las tareas que quedaron de días anteriores y las del backlog (sin fecha);
// cada una se planifica en un bloque de hoy con un clic. Tocar el título abre su detalle (para verla o
// editarla) con "‹ Volver a pendientes". Compartido con la versión web.
// Cada botón de bloque muestra cómo quedaría ese bloque (su pronóstico) si se agrega la tarea.

import { state, backlogTasks, overdueTasks, planTask, subscribe, findEpic } from '../services/store.js';
import { h, openModal, isModalOpen, showToast } from '../utils/ui.js';
import { blocksOf } from '../core/blocks.js';
import { scheduleBlock } from '../core/pert.js';
import { probTag } from './prob-tag.js';
import { openMoveMenu } from './move-menu.js';
import { showTaskModal } from './task-modal.js';
import { formatMinutes } from '../core/parser.js';
import { todayISO, nowMinutes, shortLabel } from '../utils/dates.js';
import { titleCase } from '../utils/text.js';

let isOpen = false;
let query = '';
let targetDate = null; // día al que se pasan las tareas (el que se ve en Hoy)
let listening = false; // el <dialog> del modal es uno solo y compartido: escuchar sus clics una vez

const fold = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Tareas pendientes del backlog, ordenadas por épica y luego por orden. */
function pendingBacklog() {
  const epicsOrder = new Map(state.epics.map((e, i) => [e.id, i]));
  return backlogTasks()
    .filter((t) => !t.done)
    .sort((a, b) => (epicsOrder.get(a.epic_id) ?? 1e9) - (epicsOrder.get(b.epic_id) ?? 1e9) || a.order - b.order);
}

/** "85%" del bloque de ese día si se le agrega la tarea (o null si el bloque ya terminó). */
function forecastWith(block, task, today, nowMin) {
  const list = state.tasks.filter((t) => t.date === today && t.block === block.id);
  const sched = scheduleBlock([...list, { ...task, date: today, block: block.id, order: Number.MAX_SAFE_INTEGER, dependencies: [] }], block, nowMin);
  if (sched.remaining <= 0) return null;
  return sched.probability;
}

function taskRow(task, blocks, today, nowMin) {
  const epic = findEpic(task.epic_id);
  const from = task.date ? `de ${shortLabel(task.date)}` : null; // pendiente de un día anterior
  const buttons = blocks.map((b) => {
    const p = forecastWith(b, task, today, nowMin);
    const ended = p === null;
    const pct = ended ? '' : `${Math.round(p * 100)}%`;
    return h('button', {
      type: 'button',
      class: 'pick-btn',
      dataset: { task: task.id, block: b.id },
      disabled: ended,
      title: ended ? `${b.title} ya terminó` : null,
      'aria-label': ended ? `${b.title} ya terminó` : `Agregar "${task.title}" a ${b.title} (quedaría en ${pct})`,
    }, h('span', { class: 'pick-icon', 'aria-hidden': 'true' }, b.icon), h('span', { class: 'pick-name' }, b.title),
    ended ? null : probTag(p, { class: 'pick-pct' }));
  });
  return h('li', { class: 'pick-row', dataset: { task: task.id } },
    h('button', {
      type: 'button', class: 'pick-move', title: 'Mover a otro bloque o día', 'aria-label': `Mover "${task.title}" a otro bloque o día`,
    }, '⇢'),
    h('div', {
      class: 'pick-info pick-open', role: 'button', tabindex: '0', title: 'Ver o editar la tarea',
      'aria-label': `Ver o editar "${task.title}"`,
    },
      h('span', { class: 'pick-title' },
        epic ? h('span', { class: 'dot', style: `background:${epic.color}`, title: epic.name }) : null,
        titleCase(task.title), h('span', { class: 'pick-chevron', 'aria-hidden': 'true' }, '›')),
      h('span', { class: 'pick-meta' },
        [from, formatMinutes(task.minutes), epic ? titleCase(epic.name) : null, task.certainty === 'unsure' ? 'poca certeza' : null]
          .filter(Boolean).join(' · '))),
    h('div', { class: 'pick-actions', role: 'group', 'aria-label': `Agregar "${task.title}" a un bloque de hoy` }, ...buttons));
}

function render() {
  const today = targetDate;
  const isToday = today === todayISO();
  const overdue = overdueTasks(todayISO()).sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
  const all = [...overdue, ...pendingBacklog()];
  const terms = fold(query).split(/\s+/).filter(Boolean);
  const matches = (t) => terms.every((w) => fold(t.title).includes(w) || fold(findEpic(t.epic_id)?.name || '').includes(w));
  const list = terms.length ? all.filter(matches) : all;
  const nowMin = isToday ? nowMinutes() : today < todayISO() ? 24 * 60 : null;
  const blocks = blocksOf(state.settings);
  const hadFocus = document.activeElement?.id === 'pick-search';
  const caret = hadFocus ? document.activeElement.selectionStart : null;

  const search = h('input', {
    type: 'search', id: 'pick-search', class: 'pick-search', value: query, autocomplete: 'off',
    placeholder: 'Buscar en el backlog…', 'aria-label': 'Buscar en el backlog',
  });
  search.addEventListener('input', () => {
    query = search.value;
    render();
  });

  const section = (title, tasks) => (tasks.length
    ? [h('h3', { class: 'pick-section' }, title), h('ul', { class: 'pick-list' }, ...tasks.map((t) => taskRow(t, blocks, today, nowMin)))]
    : []);
  const late = list.filter((t) => t.date);
  const undated = list.filter((t) => !t.date);
  const body = all.length === 0
    ? [h('p', { class: 'pick-empty' }, 'Nada pendiente fuera de hoy. Escribe bl al final de una tarea para dejarla en el backlog.')]
    : list.length === 0
      ? [h('p', { class: 'pick-empty' }, `Nada coincide con "${query}".`)]
      : [...section(`« De días anteriores (${late.length})`, late), ...section(`⤓ Backlog (${undated.length})`, undated)];

  openModal(`Pendientes → ${isToday ? 'hoy' : shortLabel(today)}`, [
    h('div', { class: 'backlog-picker' },
      h('p', { class: 'pick-lead' },
        all.length
          ? `Elige el bloque ${isToday ? 'de hoy' : `del ${shortLabel(today)}`} donde quieres hacer cada una; el % es cómo quedaría ese bloque.`
          : 'Aquí aparecen las tareas sin fecha y las que quedaron pendientes de días anteriores.'),
      all.length > 5 ? search : null,
      ...body),
  ], () => { isOpen = false; });

  if (hadFocus) {
    const el = document.getElementById('pick-search');
    el?.focus();
    if (el && caret !== null) el.setSelectionRange(caret, caret);
  }
}

/** Abre el modal de pendientes para pasarlas a un día (por defecto, hoy). */
export function showBacklogPicker(date = todayISO()) {
  targetDate = typeof date === 'string' ? date : todayISO();
  query = '';
  isOpen = true;
  render();
  if (!listening) {
    const dialog = document.getElementById('modal');
    dialog?.addEventListener('click', onPick);
    dialog?.addEventListener('keydown', (e) => {
      const info = e.target.closest?.('.pick-open');
      if (info && isOpen && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        openTask(info.closest('.pick-row').dataset.task);
      }
    });
    listening = true;
  }
}

/** Abre el detalle de una tarea; "‹ Volver a pendientes" vuelve a esta lista. */
function openTask(id) {
  const date = targetDate;
  isOpen = false; // el modal pasa a ser el detalle
  showTaskModal(id, { returnTo: { label: 'pendientes', run: () => showBacklogPicker(date) } });
}

function onPick(e) {
  const info = e.target.closest('.pick-open');
  if (info && isOpen) {
    openTask(info.closest('.pick-row').dataset.task);
    return;
  }
  const move = e.target.closest('.pick-move');
  if (move && isOpen) {
    openMoveMenu(move.closest('.pick-row').dataset.task, move);
    return;
  }
  const btn = e.target.closest('.pick-btn');
  if (!btn || !isOpen) return;
  const task = state.tasks.find((t) => t.id === btn.dataset.task);
  const block = blocksOf(state.settings).find((b) => b.id === btn.dataset.block);
  if (!task || !block) return;
  planTask(task.id, block.id, targetDate); // re-renderiza el modal por la suscripción
  showToast(`"${task.title}" → ${block.icon} ${block.title}, ${targetDate === todayISO() ? 'hoy' : shortLabel(targetDate)}.`);
}

// Mientras está abierto, se actualiza con cada cambio (otra ventana, el panel, etc.)
subscribe(() => {
  if (isOpen && isModalOpen()) render();
});
