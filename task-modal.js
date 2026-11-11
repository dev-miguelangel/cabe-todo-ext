// Detalle de una tarea (al pincharla): por qué está bloqueada, temporizador y comentarios en Markdown.

import { blockersOf, timerBlockedBy } from './pert.js';
import { formatMinutes } from './parser.js';
import { todayISO, shortLabel, toMinutes, nowMinutes } from './dates.js';
import {
  isRunning, trackedMs, formatStopwatch, remainingMs, estimateMs, formatCountdown, formatTracked,
} from './timer.js';
import { markdownExcerpt } from './markdown.js';
import {
  state, findTask, findEpic, updateTask, setDependency, subscribe, toggleTimer, resetTimer, deleteTask,
  setMeeting, removeMeeting, finishMeeting, findRoutine, setRepeat,
} from './store.js';
import { ALL_DAYS, WEEKDAYS, DAY_LETTER, repeatLabel } from './routines.js';
import { createComments } from './comments.js';
import { h, openModal, closeModal, isModalOpen, showToast } from './ui.js';

const BLOCK_NAME = { am: '☀︎ mañana', pm: '☾ tarde' };

// Estado del modal (sobrevive a los re-render que provoca cada cambio guardado)
let currentId = null;
let wasBlocked = false;
let tick = null;
let blockedById = null; // reunión que impide iniciar el temporizador (para notar cuando cambia)
let repeatOpen = false; // sección "Repetir" abierta en una tarea que aún no se repite
let meetingForm = null; // formulario de reunión abierto: { date, start, end, mode, duration, blocking, error }
const comments = createComments({ rerender: () => render() });

function whereText(task) {
  if (!task.date) return '⤓ backlog';
  const day = task.date === todayISO() ? 'hoy' : shortLabel(task.date);
  return `${day} · ${BLOCK_NAME[task.block]}`;
}

// ---------- Secciones ----------

function metaSection(task) {
  const epic = findEpic(task.epic_id);
  const what = task.meeting
    ? `◷ Reunión · ${task.date === todayISO() ? 'hoy' : shortLabel(task.date)} · ${task.meeting.start}–${task.meeting.end}`
    : `${formatMinutes(task.minutes)} estimadas · ${whereText(task)}`;
  return h('p', { class: 'task-meta' },
    what,
    epic ? h('span', { class: 'task-meta-epic' }, ' · ', h('span', { class: 'dot', style: `background:${epic.color}` }), ` ${epic.name}`) : null,
    task.done ? ' · ✓ hecha' : '',
    // Convertir en reunión: un enlace discreto en la misma línea (no una sección aparte)
    !task.meeting && !meetingForm ? h('button', {
      type: 'button',
      class: 'link-btn meta-link',
      title: 'Darle fecha y horario fijo (inicio y fin) a esta tarea',
      onclick: () => { meetingForm = newMeetingForm(task); render(); },
    }, '◷ Convertir en reunión') : null,
    !findRoutine(task.routine_id) && !repeatOpen ? h('button', {
      type: 'button',
      class: 'link-btn meta-link',
      title: 'Crear esta tarea sola en los días que elijas',
      onclick: () => { repeatOpen = true; render(); },
    }, '↻ Repetir') : null);
}

/** Días en que se repite (L M X J V S D). Cada cambio se guarda al tiro. */
function repeatSection(task) {
  const routine = findRoutine(task.routine_id);
  if (!routine && !repeatOpen) return null;
  const days = routine?.days || [];
  const save = (next) => {
    setRepeat(task.id, next);
    if (!next.length) { repeatOpen = false; showToast(`"${task.title}" ya no se repite.`); }
  };
  const chip = (d) => h('button', {
    type: 'button',
    class: `day-chip${days.includes(d) ? ' on' : ''}`,
    'aria-pressed': String(days.includes(d)),
    title: days.includes(d) ? 'Quitar este día' : 'Agregar este día',
    onclick: () => save(days.includes(d) ? days.filter((x) => x !== d) : [...days, d]),
  }, DAY_LETTER[d]);
  const where = task.meeting ? `${task.meeting.start}–${task.meeting.end}` : BLOCK_NAME[routine?.block || task.block || 'am'];
  return h('section', { class: 'detail-section repeat-section' },
    h('h3', {}, routine ? `↻ Se repite ${repeatLabel(days)}` : '↻ Repetir'),
    h('div', { class: 'repeat-days', role: 'group', 'aria-label': 'Días' }, ...ALL_DAYS.map(chip)),
    h('p', { class: 'repeat-note' }, routine
      ? `Se crea sola esos días (${where}), con lo que tiene esta tarea ahora.`
      : 'Elige los días: se creará sola cada uno de ellos.'),
    h('div', { class: 'mf-actions' },
      routine ? null : h('button', { type: 'button', class: 'ghost small', onclick: () => save([...ALL_DAYS]) }, 'Cada día'),
      routine ? null : h('button', { type: 'button', class: 'ghost small', onclick: () => save([...WEEKDAYS]) }, 'Días hábiles'),
      routine
        ? h('button', { type: 'button', class: 'ghost small', onclick: () => save([]) }, 'Dejar de repetir')
        : h('button', { type: 'button', class: 'ghost small', onclick: () => { repeatOpen = false; render(); } }, 'Cancelar')));
}

/** Pie del modal: borrar la tarea (con confirmación). */
function footerSection(task) {
  return h('footer', { class: 'modal-footer' },
    h('button', {
      type: 'button',
      class: 'danger-btn',
      onclick: () => {
        if (!window.confirm(`¿Borrar "${task.title}"? Se pierden su tiempo registrado, comentarios y documentación.`)) return;
        closeModal();
        deleteTask(task.id);
        showToast(`"${task.title}" borrada.`);
      },
    }, 'Borrar tarea'));
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
  else if (running) sub = `${task.meeting ? 'Reunión en curso' : 'Cuenta atrás'} · llevas ${formatTracked(ms)} de ${est}`;
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
  const meeting = Boolean(task.meeting);
  // Durante una reunión que bloquea, solo esa reunión puede iniciar su temporizador
  const blockedBy = running ? null : timerBlockedBy(task, state.tasks);
  blockedById = blockedBy?.id ?? null;

  // Reunión finalizada: solo el resumen del tiempo
  if (meeting && task.done) {
    return h('section', { class: 'detail-section timer finished' },
      h('div', { class: 'timer-done-icon', 'aria-hidden': 'true' }, '✓'),
      h('div', { class: 'timer-info' },
        h('div', { class: 'timer-clock' }, formatStopwatch(ms)),
        h('div', { class: 'timer-sub' }, `Reunión finalizada · estimado ${formatMinutes(task.minutes)}`)));
  }

  // Botón principal: en una reunión en curso es ■ Finalizar (las reuniones no se pausan)
  let main;
  if (meeting && running) {
    main = h('button', {
      class: 'timer-toggle stop',
      dataset: { key: 'timer-toggle' },
      'aria-label': 'Finalizar reunión',
      title: 'Finalizar reunión',
      onclick: () => {
        finishMeeting(task.id);
        showToast(`Reunión "${task.title}" finalizada.`);
      },
    });
  } else {
    main = h('button', {
      class: 'timer-toggle',
      dataset: { key: 'timer-toggle' },
      disabled: Boolean(blockedBy),
      'aria-label': running ? 'Pausar temporizador' : blockedBy ? 'Iniciar temporizador (bloqueado por una reunión)' : 'Iniciar temporizador',
      title: running ? 'Pausar' : blockedBy ? `Bloqueado: "${blockedBy.title}" en curso` : ms ? 'Reanudar' : 'Iniciar cuenta atrás',
      onclick: () => toggleTimer(task.id),
    }, running ? '❚❚' : '▶︎');
  }

  let side = null;
  if (meeting && running) {
    side = h('div', { class: 'timer-side' },
      h('button', { class: 'primary small', onclick: () => { finishMeeting(task.id); showToast(`Reunión "${task.title}" finalizada.`); } }, '■ Finalizar'),
      h('button', { class: 'ghost small', onclick: () => { meetingForm = newMeetingForm(task); render(); } }, 'Reprogramar'));
  } else if (!meeting && (ms || running)) {
    side = h('button', {
      class: 'ghost small',
      title: 'Volver el tiempo a cero',
      onclick: () => {
        if (window.confirm(`¿Reiniciar el temporizador de "${task.title}"? Se borran ${formatStopwatch(trackedMs(task))} registrados y vuelve a ${formatMinutes(task.minutes)}.`)) resetTimer(task.id);
      },
    }, '↺︎ Reiniciar');
  }

  const section = h('section', { class: `detail-section timer${running ? ' running' : ''}${view.over ? ' over' : ''}${blockedBy ? ' blocked' : ''}${meeting ? ' meeting' : ''}` },
    main,
    h('div', { class: 'timer-info' },
      h('div', { class: 'timer-clock', dataset: { tick: '' }, 'aria-live': 'off' }, view.clock),
      h('div', { class: 'timer-sub', dataset: { tickSub: '' } }, view.sub),
      h('div', { class: 'timer-bar' }, h('div', { class: 'timer-bar-fill', dataset: { tickBar: '' }, style: `width:${view.progress}%` }))),
    side);
  if (!blockedBy) return section;
  return h('div', { class: 'timer-group' }, section,
    h('p', { class: 'timer-blocked-note', role: 'status' },
      `⊘ "${blockedBy.title}" está en curso hasta las ${blockedBy.meeting.end}: no se pueden iniciar otras tareas durante la reunión.`));
}

// ---------- Reunión ----------

const pad = (n) => String(n).padStart(2, '0');
const toHHMM = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;
const DURATIONS = [15, 30, 45, 60, 90, 120, 180];

/** Valores iniciales del formulario: los de la reunión, o sugeridos a partir de la tarea. */
function newMeetingForm(task) {
  if (task.meeting) {
    return {
      date: task.date, start: task.meeting.start, end: task.meeting.end,
      mode: 'end', duration: task.minutes, blocking: task.meeting.blocking, error: null,
    };
  }
  const date = task.date || state.viewDate;
  // Hoy: próxima media hora; otro día: inicio del bloque de la tarea (o de la mañana)
  let start = toMinutes(state.settings[task.block || 'am'].start);
  if (date === todayISO()) start = Math.max(start, Math.ceil(nowMinutes() / 30) * 30);
  const duration = task.minutes || 30;
  return {
    date, start: toHHMM(start), end: toHHMM(start + duration),
    mode: 'end', duration, blocking: true, error: null,
  };
}

function saveMeetingForm(task) {
  const f = meetingForm;
  const end = f.mode === 'duration' && f.start ? toHHMM(toMinutes(f.start) + Number(f.duration)) : f.end;
  const wasMeeting = Boolean(task.meeting);
  const error = setMeeting(task.id, { date: f.date, start: f.start, end, blocking: f.blocking });
  if (error) {
    f.error = error;
    render();
    return;
  }
  meetingForm = null;
  render();
  showToast(wasMeeting ? `Reunión reprogramada: ${f.start}–${end}.` : `"${task.title}" ahora es una reunión.`);
}

function meetingFormView(task) {
  const f = meetingForm;
  const field = (label, input) => h('label', { class: 'mf-field' }, h('span', {}, label), input);
  const input = (props, key) => {
    const el = h('input', { ...props, dataset: { key: `mf-${key}` } });
    el.value = f[key] ?? '';
    el.addEventListener('input', () => { f[key] = el.value; f.error = null; });
    return el;
  };
  const durationSelect = h('select', { dataset: { key: 'mf-duration' } },
    ...[...new Set([...DURATIONS, Number(f.duration)])].sort((a, b) => a - b)
      .map((m) => h('option', { value: String(m), selected: Number(f.duration) === m }, formatMinutes(m))));
  durationSelect.addEventListener('change', () => { f.duration = Number(durationSelect.value); });
  const modeBtn = (mode, label) => h('button', {
    type: 'button',
    class: `mf-mode${f.mode === mode ? ' active' : ''}`,
    'aria-pressed': String(f.mode === mode),
    onclick: () => {
      // al cambiar de modo, mantener la misma reunión
      if (mode === 'duration' && f.start && f.end) f.duration = Math.max(5, toMinutes(f.end) - toMinutes(f.start));
      if (mode === 'end' && f.start) f.end = toHHMM(toMinutes(f.start) + Number(f.duration));
      f.mode = mode;
      render();
    },
  }, label);
  const blocking = h('input', { type: 'checkbox', checked: f.blocking });
  blocking.addEventListener('change', () => { f.blocking = blocking.checked; });

  return h('div', { class: 'meeting-form' },
    h('div', { class: 'mf-row' },
      field('Fecha', input({ type: 'date', required: true }, 'date')),
      field('Inicio', input({ type: 'time', required: true }, 'start'))),
    h('div', { class: 'mf-row' },
      h('div', { class: 'mf-modes', role: 'group', 'aria-label': 'Fin de la reunión' },
        modeBtn('end', 'Hora de fin'), modeBtn('duration', 'Duración')),
      f.mode === 'end' ? field('Hasta', input({ type: 'time', required: true }, 'end')) : field('Dura', durationSelect)),
    h('label', { class: 'mf-check' }, blocking,
      h('span', {},
        h('strong', {}, 'Bloquear la toma de tareas durante la reunión'),
        h('small', {}, 'Si no la marcas, es una reunión paralela: puedes seguir avanzando tareas.'))),
    f.error ? h('p', { class: 'settings-error', role: 'alert' }, f.error) : null,
    h('div', { class: 'mf-actions' },
      h('button', { type: 'button', class: 'ghost small', onclick: () => { meetingForm = null; render(); } }, 'Cancelar'),
      h('button', { type: 'button', class: 'primary small', onclick: () => saveMeetingForm(task) },
        task.meeting ? 'Reprogramar' : 'Convertir en reunión')));
}

function meetingSection(task) {
  if (meetingForm) {
    return h('section', { class: 'detail-section meeting-section' },
      h('h3', {}, task.meeting ? 'Reprogramar reunión' : 'Convertir en reunión'), meetingFormView(task));
  }
  if (!task.meeting) return null; // el enlace para convertir está en la línea de detalles
  const m = task.meeting;
  const day = task.date === todayISO() ? 'Hoy' : shortLabel(task.date);
  return h('section', { class: `detail-section meeting-section is-meeting${m.blocking ? ' blocking' : ''}` },
    h('div', { class: 'meeting-summary' },
      h('div', { class: 'meeting-when' },
        h('span', { class: 'meeting-clock' }, `${m.start}–${m.end}`),
        h('span', { class: 'meeting-day' }, `${day} · ${formatMinutes(task.minutes)}`)),
      h('span', { class: `meeting-badge${m.blocking ? '' : ' parallel'}` },
        m.blocking ? '⊘ Bloquea tareas' : '↔ Paralela')),
    h('div', { class: 'mf-actions' },
      h('button', {
        type: 'button', class: 'ghost small',
        onclick: () => {
          setMeeting(task.id, { date: task.date, start: m.start, end: m.end, blocking: !m.blocking });
          showToast(m.blocking ? 'La reunión ahora es paralela.' : 'La reunión ahora bloquea la toma de tareas.');
        },
      }, m.blocking ? 'Permitir tareas' : 'Bloquear tareas'),
      h('button', { type: 'button', class: 'ghost small', onclick: () => { meetingForm = newMeetingForm(task); render(); } }, 'Reprogramar'),
      h('button', {
        type: 'button', class: 'ghost small',
        onclick: () => { removeMeeting(task.id); showToast(`"${task.title}" volvió a ser una tarea.`); },
      }, 'Quitar reunión')));
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
    meetingSection(task),
    repeatSection(task),
    blockers.length ? blockedSection(task, blockers, byId) : null,
    timerSection(task),
    docSection(task),
    comments.section(task),
    footerSection(task),
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
  meetingForm = null;
  repeatOpen = false;
  comments.stopEditing();
  clearInterval(tick);
  tick = null;
}

export function showTaskModal(taskId) {
  if (currentId !== taskId) {
    comments.reset();
    meetingForm = null;
    repeatOpen = false;
  }
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
    // Si una reunión que bloquea empieza o termina con el modal abierto, actualizar el botón ▶
    const nowBlocked = view.running ? null : timerBlockedBy(task, state.tasks);
    if ((nowBlocked?.id ?? null) !== blockedById) render();
  }, 1000);
}

// Si cambian los datos con el modal abierto (timer, comentarios, dependencias), actualizarlo.
subscribe(() => {
  if (currentId && isModalOpen()) render();
});
