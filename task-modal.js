// Detalle de una tarea (al pincharla): por qué está bloqueada, temporizador y comentarios en Markdown.

import { blockersOf } from './pert.js';
import { formatMinutes } from './parser.js';
import { todayISO, shortLabel } from './dates.js';
import {
  isRunning, trackedMs, formatStopwatch, remainingMs, estimateMs, formatCountdown, formatTracked,
} from './timer.js';
import { markdownExcerpt } from './markdown.js';
import {
  state, findTask, findEpic, updateTask, setDependency, subscribe, toggleTimer, resetTimer,
} from './store.js';
import { createComments } from './comments.js';
import { h, openModal, closeModal, isModalOpen, showToast } from './ui.js';

const BLOCK_NAME = { am: '☀︎ mañana', pm: '☾ tarde' };

// Estado del modal (sobrevive a los re-render que provoca cada cambio guardado)
let currentId = null;
let wasBlocked = false;
let tick = null;
const comments = createComments({ rerender: () => render() });

function whereText(task) {
  if (!task.date) return '⤓ backlog';
  const day = task.date === todayISO() ? 'hoy' : shortLabel(task.date);
  return `${day} · ${BLOCK_NAME[task.block]}`;
}

// ---------- Secciones ----------

function metaSection(task) {
  const epic = findEpic(task.epic_id);
  return h('p', { class: 'task-meta' },
    `${formatMinutes(task.minutes)} estimadas · ${whereText(task)}`,
    epic ? h('span', { class: 'task-meta-epic' }, ' · ', h('span', { class: 'dot', style: `background:${epic.color}` }), ` ${epic.name}`) : null,
    task.done ? ' · ✓ hecha' : '');
}

function blockedSection(task, blockers, byId) {
  const n = blockers.length;
  return h('section', { class: 'detail-section blocked-section' },
    h('h3', {}, '⧖ Bloqueada'),
    h('p', { class: 'modal-text' }, n === 1 ? 'Para empezarla, primero hay que terminar:' : `Para empezarla, primero hay que terminar estas ${n} tareas:`),
    h('ul', { class: 'blockers' }, ...blockers.map((pred) => {
      const epic = findEpic(pred.epic_id);
      const alsoBlocked = blockersOf(pred, byId);
      return h('li', { class: 'blocker' },
        h('div', { class: 'blocker-info' },
          h('span', { class: 'blocker-title' },
            epic ? h('span', { class: 'dot', style: `background:${epic.color}`, title: epic.name }) : null, pred.title),
          h('span', { class: 'blocker-meta' }, `${formatMinutes(pred.minutes)} · ${whereText(pred)}`,
            alsoBlocked.length ? ` · ⧖ espera a "${alsoBlocked.map((p) => p.title).join('", "')}"` : '')),
        h('div', { class: 'blocker-actions' },
          h('button', { class: 'primary small', onclick: () => updateTask(pred.id, { done: true }) }, '✓ Marcar hecha'),
          h('button', { class: 'ghost small', onclick: () => setDependency(task.id, pred.id, false) }, 'Quitar dependencia')));
    })));
}

/** Estado visual del temporizador (se recalcula cada segundo). */
function timerView(task, now = Date.now()) {
  const running = isRunning(task);
  const ms = trackedMs(task, now);
  const left = remainingMs(task, now);
  const over = left <= 0;
  const est = formatMinutes(task.minutes);
  let sub;
  if (over) sub = `⚠\ufe0e Tiempo cumplido · llevas ${formatTracked(ms)} de ${est}${running ? '' : ' · en pausa'}`;
  else if (running) sub = `Cuenta atrás · llevas ${formatTracked(ms)} de ${est}`;
  else if (ms) sub = `En pausa · llevas ${formatTracked(ms)} de ${est}`;
  else sub = `Listo para empezar · estimado ${est}`;
  return {
    running, ms, over, sub,
    clock: formatCountdown(left),
    progress: Math.min(100, (ms / (estimateMs(task) || 1)) * 100),
  };
}

function timerSection(task) {
  const view = timerView(task);
  const { running, ms } = view;
  return h('section', { class: `detail-section timer${running ? ' running' : ''}${view.over ? ' over' : ''}` },
    h('button', {
      class: 'timer-toggle',
      dataset: { key: 'timer-toggle' },
      'aria-label': running ? 'Pausar temporizador' : 'Iniciar temporizador',
      title: running ? 'Pausar' : ms ? 'Reanudar' : 'Iniciar cuenta atrás',
      onclick: () => toggleTimer(task.id),
    }, running ? '❚❚' : '▶︎'),
    h('div', { class: 'timer-info' },
      h('div', { class: 'timer-clock', dataset: { tick: '' }, 'aria-live': 'off' }, view.clock),
      h('div', { class: 'timer-sub', dataset: { tickSub: '' } }, view.sub),
      h('div', { class: 'timer-bar' }, h('div', { class: 'timer-bar-fill', dataset: { tickBar: '' }, style: `width:${view.progress}%` }))),
    ms || running ? h('button', {
      class: 'ghost small',
      title: 'Volver el tiempo a cero',
      onclick: () => {
        if (window.confirm(`¿Reiniciar el temporizador de "${task.title}"? Se borran ${formatStopwatch(trackedMs(task))} registrados y vuelve a ${formatMinutes(task.minutes)}.`)) resetTimer(task.id);
      },
    }, '↺︎ Reiniciar') : null);
}

/** Documentación: solo un extracto aquí; se edita en su propia pestaña. */
function docSection(task) {
  const excerpt = markdownExcerpt(task.doc, 220);
  const updated = task.doc_updated_at
    ? new Date(task.doc_updated_at).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
  return h('section', { class: 'detail-section doc-section' },
    h('div', { class: 'doc-section-head' },
      h('h3', {}, 'Documentación'),
      h('button', {
        type: 'button',
        class: 'ghost small',
        title: 'Abrir la documentación de la tarea en una pestaña nueva',
        onclick: () => openDocTab(task.id),
      }, excerpt ? 'Abrir en pestaña ↗' : 'Documentar en pestaña ↗')),
    excerpt
      ? h('div', { class: 'doc-excerpt', title: 'Clic para abrir la documentación completa', onclick: () => openDocTab(task.id) },
        h('p', {}, excerpt),
        updated ? h('span', { class: 'doc-updated' }, `Editado ${updated}`) : null)
      : h('p', { class: 'doc-empty' }, 'Sin documentación todavía. Ábrela en una pestaña para escribir con espacio (títulos, enlaces, bloques de código…).'));
}

/** Abre (en una pestaña) la página de documentación de la tarea. */
export function openDocTab(taskId) {
  const url = `doc.html?task=${encodeURIComponent(taskId)}`;
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    chrome.tabs.create({ url: chrome.runtime.getURL(url) });
  } else {
    window.open(url, '_blank', 'noopener'); // fuera de la extensión (pruebas)
  }
}

// ---------- Render ----------

function render() {
  const task = findTask(currentId);
  if (!task) {
    closeModal();
    return;
  }
  const byId = new Map(state.tasks.map((t) => [t.id, t]));
  const blockers = blockersOf(task, byId);
  if (wasBlocked && !blockers.length) showToast(`✓ "${task.title}" ya no está bloqueada.`);
  wasBlocked = blockers.length > 0;

  // Conservar foco y cursor tras re-renderizar
  const active = document.activeElement;
  const key = active?.dataset?.key;
  const sel = key && 'selectionStart' in active ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = document.querySelector('#modal .modal-box')?.scrollTop ?? 0;

  openModal(`${blockers.length ? '⧖ ' : ''}${task.title}`, [
    metaSection(task),
    blockers.length ? blockedSection(task, blockers, byId) : null,
    timerSection(task),
    docSection(task),
    comments.section(task),
  ].filter(Boolean), onClose);

  const box = document.querySelector('#modal .modal-box');
  if (box) box.scrollTop = scroll;
  if (key) {
    const el = document.querySelector(`#modal [data-key="${CSS.escape(key)}"]`);
    if (el) {
      el.focus();
      if (sel && el.setSelectionRange) el.setSelectionRange(...sel);
    }
  }
}

function onClose() {
  currentId = null;
  comments.stopEditing();
  clearInterval(tick);
  tick = null;
}

export function showTaskModal(taskId) {
  if (currentId !== taskId) comments.reset();
  currentId = taskId;
  wasBlocked = false;
  render();
  wasBlocked = blockersOf(findTask(taskId), new Map(state.tasks.map((t) => [t.id, t]))).length > 0;
  clearInterval(tick);
  // El reloj avanza cada segundo sin re-renderizar el modal (no interrumpe lo que escribes).
  tick = setInterval(() => {
    const task = findTask(currentId);
    const section = document.querySelector('#modal .timer');
    if (!task || !section) return;
    const view = timerView(task);
    section.querySelector('[data-tick]').textContent = view.clock;
    section.querySelector('[data-tick-sub]').textContent = view.sub;
    section.querySelector('[data-tick-bar]').style.width = `${view.progress}%`;
    section.classList.toggle('over', view.over); // al cruzar el cero: alerta (el sonido lo pone el service worker)
  }, 1000);
}

// Si cambian los datos con el modal abierto (timer, comentarios, dependencias), actualizarlo.
subscribe(() => {
  if (currentId && isModalOpen()) render();
});
