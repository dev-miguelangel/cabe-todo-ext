// Modal "Backlog → hoy": lista las tareas sin fecha y las planifica en un bloque de hoy con un clic.
// Cada botón de bloque muestra cómo quedaría ese bloque (su pronóstico) si se agrega la tarea.

import { state, backlogTasks, planTask, subscribe, findEpic } from '../services/store.js';
import { h, openModal, isModalOpen, showToast } from '../utils/ui.js';
import { blocksOf } from '../core/blocks.js';
import { scheduleBlock } from '../core/pert.js';
import { formatMinutes } from '../core/parser.js';
import { todayISO, nowMinutes } from '../utils/dates.js';

let isOpen = false;
let query = '';
let listening = false; // el <dialog> del modal es uno solo y compartido: escuchar sus clics una vez

const fold = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Tareas pendientes del backlog, ordenadas como en Plan (por épica y luego por orden). */
function pendingBacklog() {
  const epicsOrder = new Map(state.epics.map((e, i) => [e.id, i]));
  return backlogTasks()
    .filter((t) => !t.done)
    .sort((a, b) => (epicsOrder.get(a.epic_id) ?? 1e9) - (epicsOrder.get(b.epic_id) ?? 1e9) || a.order - b.order);
}

/** "85%" de un bloque de hoy si se le agrega la tarea (o null si el bloque ya terminó). */
function forecastWith(block, task, today, nowMin) {
  const list = state.tasks.filter((t) => t.date === today && t.block === block.id);
  const sched = scheduleBlock([...list, { ...task, date: today, block: block.id, order: Number.MAX_SAFE_INTEGER, dependencies: [] }], block, nowMin);
  if (sched.remaining <= 0) return null;
  return sched.probability;
}

function taskRow(task, blocks, today, nowMin) {
  const epic = findEpic(task.epic_id);
  const buttons = blocks.map((b) => {
    const p = forecastWith(b, task, today, nowMin);
    const ended = p === null;
    const pct = ended ? '' : `${Math.round(p * 100)}%`;
    const cls = ended ? '' : p >= 0.8 ? 'good' : p >= 0.5 ? 'warn' : 'bad';
    return h('button', {
      type: 'button',
      class: `pick-btn ${cls}`,
      dataset: { task: task.id, block: b.id },
      disabled: ended,
      title: ended ? `${b.title} ya terminó` : `Agregar a ${b.icon} ${b.title}: el bloque quedaría en ${pct}`,
      'aria-label': ended ? `${b.title} ya terminó` : `Agregar "${task.title}" a ${b.title} (quedaría en ${pct})`,
    }, h('span', { class: 'pick-icon', 'aria-hidden': 'true' }, b.icon), h('span', { class: 'pick-name' }, b.title),
    pct ? h('span', { class: 'pick-pct' }, pct) : null);
  });
  return h('li', { class: 'pick-row' },
    h('div', { class: 'pick-info' },
      h('span', { class: 'pick-title' },
        epic ? h('span', { class: 'dot', style: `background:${epic.color}`, title: epic.name }) : null,
        task.title),
      h('span', { class: 'pick-meta' },
        [formatMinutes(task.minutes), epic ? epic.name : null, task.certainty === 'unsure' ? 'poca certeza' : null]
          .filter(Boolean).join(' · '))),
    h('div', { class: 'pick-actions', role: 'group', 'aria-label': `Agregar "${task.title}" a un bloque de hoy` }, ...buttons));
}

function render() {
  const all = pendingBacklog();
  const terms = fold(query).split(/\s+/).filter(Boolean);
  const list = terms.length ? all.filter((t) => terms.every((w) => fold(t.title).includes(w) || fold(findEpic(t.epic_id)?.name || '').includes(w))) : all;
  const today = todayISO();
  const nowMin = nowMinutes();
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

  const body = all.length === 0
    ? h('p', { class: 'pick-empty' }, 'El backlog está vacío. Escribe bl al final de una tarea para dejarla aquí.')
    : list.length === 0
      ? h('p', { class: 'pick-empty' }, `Nada coincide con "${query}".`)
      : h('ul', { class: 'pick-list' }, ...list.map((t) => taskRow(t, blocks, today, nowMin)));

  openModal(`⤓ Backlog → hoy`, [
    h('div', { class: 'backlog-picker' },
      h('p', { class: 'pick-lead' },
        all.length
          ? `${all.length} tarea${all.length === 1 ? '' : 's'} sin fecha. Elige el bloque de hoy donde quieres hacerla; el % es cómo quedaría ese bloque.`
          : 'Aquí aparecen las tareas sin fecha.'),
      all.length > 5 ? search : null,
      body),
  ], () => { isOpen = false; });

  if (hadFocus) {
    const el = document.getElementById('pick-search');
    el?.focus();
    if (el && caret !== null) el.setSelectionRange(caret, caret);
  }
}

/** Abre el modal del backlog para pasar tareas a hoy. */
export function showBacklogPicker() {
  query = '';
  isOpen = true;
  render();
  if (!listening) {
    document.getElementById('modal')?.addEventListener('click', onPick);
    listening = true;
  }
}

function onPick(e) {
  const btn = e.target.closest('.pick-btn');
  if (!btn || !isOpen) return;
  const task = state.tasks.find((t) => t.id === btn.dataset.task);
  const block = blocksOf(state.settings).find((b) => b.id === btn.dataset.block);
  if (!task || !block) return;
  planTask(task.id, block.id, todayISO()); // re-renderiza el modal por la suscripción
  showToast(`"${task.title}" → ${block.icon} ${block.title}, hoy.`);
}

// Mientras está abierto, se actualiza con cada cambio (otra ventana, el panel, etc.)
subscribe(() => {
  if (isOpen && isModalOpen()) render();
});
