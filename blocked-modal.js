// Modal "¿Por qué está bloqueada?": lista lo que falta terminar y permite resolverlo ahí mismo.

import { blockersOf } from './pert.js';
import { formatMinutes } from './parser.js';
import { todayISO, shortLabel } from './dates.js';
import { state, findTask, findEpic, updateTask, setDependency, subscribe } from './store.js';
import { h, openModal, closeModal, isModalOpen, showToast } from './ui.js';

const BLOCK_NAME = { am: '☀︎ mañana', pm: '☾ tarde' };

let currentId = null;

function whereText(task) {
  if (!task.date) return '⤓ en el backlog';
  const day = task.date === todayISO() ? 'hoy' : shortLabel(task.date);
  return `${day} · ${BLOCK_NAME[task.block]}`;
}

function render() {
  const task = findTask(currentId);
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const blockers = task ? blockersOf(task, byId) : [];

  if (!task || !blockers.length) {
    closeModal();
    if (task) showToast(`✓ "${task.title}" ya no está bloqueada.`);
    return;
  }

  const items = blockers.map((pred) => {
    const epic = findEpic(pred.epic_id);
    const alsoBlocked = blockersOf(pred, byId);
    return h('li', { class: 'blocker' },
      h('div', { class: 'blocker-info' },
        h('span', { class: 'blocker-title' },
          epic ? h('span', { class: 'dot', style: `background:${epic.color}`, title: epic.name }) : null,
          pred.title),
        h('span', { class: 'blocker-meta' },
          `${formatMinutes(pred.minutes)} · ${whereText(pred)}`,
          alsoBlocked.length ? ` · ⧖ también espera a "${alsoBlocked.map((p) => p.title).join('", "')}"` : ''),
      ),
      h('div', { class: 'blocker-actions' },
        h('button', { class: 'primary small', onclick: () => updateTask(pred.id, { done: true }) }, '✓ Marcar hecha'),
        h('button', { class: 'ghost small', onclick: () => setDependency(task.id, pred.id, false) }, 'Quitar dependencia')),
    );
  });

  const n = blockers.length;
  openModal(`⧖ "${task.title}" está bloqueada`, [
    h('p', { class: 'modal-text' },
      n === 1 ? 'Para empezarla, primero hay que terminar esta tarea:' : `Para empezarla, primero hay que terminar estas ${n} tareas:`),
    h('ul', { class: 'blockers' }, ...items),
  ], () => { currentId = null; });
}

export function showBlockedModal(taskId) {
  currentId = taskId;
  render();
}

// Si cambian los datos con el modal abierto (por ejemplo, al marcar una como hecha), actualizarlo.
subscribe(() => {
  if (currentId && isModalOpen()) render();
});
