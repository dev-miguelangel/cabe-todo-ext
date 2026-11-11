// Pestaña de documentación de una tarea: documento Markdown (Código / Lectura con barra de formato)
// con guardado automático. Los comentarios viven solo en el modal de la tarea.

import {
  state, initStore, subscribe, setNotifier, findTask, findEpic, setDoc, refreshFromStorage,
} from './store.js';
import { formatMinutes } from './parser.js';
import { todayISO, shortLabel } from './dates.js';
import { isRunning, remainingMs, formatCountdown } from './timer.js';
import { h, showToast, applyTheme } from './ui.js';
import { markdownEditor } from './md-editor.js';

const SAVE_DELAY = 700;
const BLOCK_NAME = { am: '☀︎ mañana', pm: '☾ tarde' };
const taskId = new URLSearchParams(location.search).get('task');
// Esqueleto opcional para empezar una documentación vacía
const TEMPLATE = '## Objetivo\n\n\n## Notas\n\n\n## Resultado\n\n';
const TEMPLATE_CURSOR = '## Objetivo\n\n'.length;

let text = '';          // contenido del editor (puede ir por delante de lo guardado)
let saved = '';         // último contenido guardado
let tab = 'code';
let saveTimer = null;
let savedAt = null;

// ---------- Guardado ----------

function setStatus() {
  const el = document.getElementById('doc-status');
  if (!el) return;
  if (text !== saved) el.textContent = 'Guardando…';
  else if (savedAt) el.textContent = `Guardado · ${savedAt.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`;
  else el.textContent = 'Guardado automático';
}

let saving = Promise.resolve();

/** Guarda lo escrito. Antes relee el almacenamiento para no pisar cambios hechos en el panel. */
function flush() {
  clearTimeout(saveTimer);
  if (text === saved) return saving;
  const value = text;
  saving = saving.then(async () => {
    await refreshFromStorage();
    setDoc(taskId, value);
    saved = value;
    savedAt = new Date();
    setStatus();
  });
  return saving;
}

function onInput(value) {
  text = value;
  const offer = document.querySelector('.doc-template');
  if (offer) offer.hidden = Boolean(text.trim());
  setStatus();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, SAVE_DELAY);
}

// ---------- Render ----------

function whereText(task) {
  if (!task.date) return '⤓ backlog';
  const day = task.date === todayISO() ? 'hoy' : shortLabel(task.date);
  return `${day} · ${BLOCK_NAME[task.block]}`;
}

function renderHead(task) {
  const epic = findEpic(task.epic_id);
  const running = isRunning(task);
  document.title = `${task.title} · Documentación`;
  document.getElementById('doc-head').replaceChildren(
    h('p', { class: 'doc-kicker' }, 'Documentación de la tarea'),
    h('h1', { class: 'doc-title' }, task.title),
    h('p', { class: 'doc-meta' },
      epic ? h('span', { class: 'doc-chip' }, h('span', { class: 'dot', style: `background:${epic.color}` }), epic.name) : null,
      h('span', { class: 'doc-chip' }, whereText(task)),
      h('span', { class: 'doc-chip' }, `${formatMinutes(task.minutes)} estimadas`),
      running ? h('span', { class: 'doc-chip running' }, `● ${formatCountdown(remainingMs(task))}`) : null,
      task.done ? h('span', { class: 'doc-chip done' }, '✓ hecha') : null,
      h('span', { class: 'doc-status', id: 'doc-status' })),
  );
  setStatus();
}

function renderEditor() {
  const container = document.getElementById('doc-editor');
  const active = document.activeElement;
  const hadFocus = active?.classList?.contains('md-input') && container.contains(active);
  const sel = hadFocus ? [active.selectionStart, active.selectionEnd] : null;

  container.replaceChildren(markdownEditor({
    key: 'doc',
    text,
    tab,
    rows: 18,
    headingBase: 1,
    className: 'doc-editor',
    label: 'Documentación en Markdown',
    placeholder: '# Objetivo\n\nDescribe la tarea, decisiones, enlaces y pasos…\n\nUsa la barra de arriba para títulos, enlaces y bloques de código.',
    onInput,
    onTab: (t) => {
      flush();
      tab = t;
      renderEditor();
      if (t === 'code') container.querySelector('.md-input')?.focus();
    },
    footer: tab === 'code' ? h('div', { class: 'doc-template', hidden: Boolean(text.trim()) },
      h('span', {}, '¿Empiezas con un esqueleto?'),
      h('button', {
        type: 'button', class: 'ghost small', title: 'Objetivo · Notas · Resultado',
        onclick: () => {
          onInput(TEMPLATE);
          renderEditor();
          const area = container.querySelector('.md-input');
          area?.focus();
          area?.setSelectionRange(TEMPLATE_CURSOR, TEMPLATE_CURSOR);
        },
      }, 'Usar plantilla')) : null,
    onKeydown: (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        flush();
        showToast('Documentación guardada.');
      }
    },
  }));

  if (sel) {
    const area = container.querySelector('.md-input');
    area?.focus();
    area?.setSelectionRange(...sel);
  }
}

function renderMissing() {
  document.title = 'Tarea no encontrada · Pert-day';
  document.querySelector('.doc-main').replaceChildren(
    h('div', { class: 'doc-card doc-missing' },
      h('h1', {}, 'No se encontró la tarea'),
      h('p', {}, 'Puede que se haya borrado. Cierra esta pestaña y vuelve al panel de Pert-day.')),
  );
}

// ---------- Inicio ----------

async function init() {
  await initStore();
  setNotifier(showToast);
  applyTheme(state.settings.theme);
  const task = findTask(taskId);
  if (!task) {
    renderMissing();
    return;
  }
  text = task.doc || '';
  saved = text;
  savedAt = task.doc_updated_at ? new Date(task.doc_updated_at) : null;
  tab = text ? 'read' : 'code'; // si ya hay documentación, abrir en lectura

  renderHead(task);
  renderEditor();
  if (tab === 'code') document.querySelector('#doc-editor .md-input')?.focus();

  subscribe(() => {
    applyTheme(state.settings.theme);
    const current = findTask(taskId);
    if (!current) {
      renderMissing();
      return;
    }
    renderHead(current);
    // Si la documentación cambió desde otra ventana y aquí no hay cambios sin guardar, mostrarla.
    if ((current.doc || '') !== saved && text === saved) {
      text = current.doc || '';
      saved = text;
      renderEditor();
    }
  });

  // El reloj del temporizador en la cabecera
  setInterval(() => {
    const current = findTask(taskId);
    if (current && isRunning(current)) {
      const chip = document.querySelector('.doc-chip.running');
      if (chip) chip.textContent = `● ${formatCountdown(remainingMs(current))}`;
    }
  }, 1000);

  // No perder lo último escrito al cerrar o cambiar de pestaña.
  // Al cerrar no hay tiempo para releer: se guarda directo (sincrónico).
  window.addEventListener('pagehide', () => {
    clearTimeout(saveTimer);
    if (text !== saved) {
      setDoc(taskId, text);
      saved = text;
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

init();
