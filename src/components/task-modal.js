// Detalle de una tarea (al pincharla): editar (tocando el título), por qué está bloqueada, temporizador
// y comentarios en Markdown.

import { blockersOf, timerBlockedBy } from '../core/pert.js';
import { formatMinutes, toQuickAddText } from '../core/parser.js';
import { todayISO, shortLabel, toMinutes, nowMinutes } from '../utils/dates.js';
import {
  isRunning, trackedMs, formatStopwatch, remainingMs, estimateMs, formatCountdown, formatTracked,
} from '../core/timer.js';
import {
  state, findTask, findEpic, updateTask, setDependency, subscribe, toggleTimer, resetTimer, deleteTask,
  setMeeting, removeMeeting, finishMeeting, findRoutine, setRepeat, deleteRoutine, applyTaskToRoutine, setView,
  clearDoc, restoreDoc, editFromText,
} from '../services/store.js';
import { ALL_DAYS, WEEKDAYS, DAY_LETTER, repeatLabel } from '../core/routines.js';
import { blockName, blockRange, firstBlock } from '../core/blocks.js';
import { createComments } from './comments.js';
import { h, openModal, closeModal, isModalOpen, showToast } from '../utils/ui.js';
import { titleCase } from '../utils/text.js';


// Estado del modal (sobrevive a los re-render que provoca cada cambio guardado)
let currentId = null;
let wasBlocked = false;
let tick = null;
let blockedById = null; // reunión que impide iniciar el temporizador (para notar cuando cambia)
let repeatOpen = false; // sección "Repetir" abierta en una tarea que aún no se repite
let meetingForm = null; // formulario de reunión abierto: { date, start, end, mode, duration, blocking, error }
let deleteAsk = false; // tarea de una rutina: preguntando "¿solo esta o todas?" antes de borrar
let titleDraft = null;  // editando la tarea (texto como en "+ Nueva tarea"); null = sin editar
const comments = createComments({ rerender: () => render() });

function whereText(task) {
  if (!task.date) return '⤓ backlog';
  const day = task.date === todayISO() ? 'hoy' : shortLabel(task.date);
  return `${day} · ${blockName(state.settings, task.block)}`;
}

// ---------- Secciones ----------

function metaSection(task) {
  const epic = findEpic(task.epic_id);
  const what = task.meeting
    ? `◷ Reunión · ${task.date === todayISO() ? 'hoy' : shortLabel(task.date)} · ${task.meeting.start}–${task.meeting.end}`
    : `${formatMinutes(task.minutes)} estimadas · ${whereText(task)}`;
  return h('p', { class: 'task-meta' },
    what,
    epic ? h('span', { class: 'task-meta-epic' }, ' · ', h('span', { class: 'dot', style: `background:${epic.color}` }), ` ${titleCase(epic.name)}`) : null,
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
  const where = task.meeting ? `${task.meeting.start}–${task.meeting.end}` : blockName(state.settings, routine?.block || task.block || firstBlock(state.settings).id);
  return h('section', { class: 'detail-section repeat-section' },
    h('h3', {}, routine ? titleCase(`↻ Se repite ${repeatLabel(days)}`) : '↻ Repetir',
      routine ? h('button', {
        type: 'button', class: 'link-btn repeat-manage', title: 'Ver y editar todas tus rutinas',
        onclick: () => { closeModal(); setView({ tab: 'routines' }); },
      }, 'Administrar rutinas') : null),
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

/** Pie del modal: borrar la tarea (con confirmación; si se repite, "¿solo esta o todas?"). */
function footerSection(task) {
  const routine = findRoutine(task.routine_id);
  if (routine && deleteAsk) {
    return h('footer', { class: 'modal-footer delete-ask' },
      h('p', {}, `"${task.title}" se repite ${repeatLabel(routine.days)}. ¿Qué quieres borrar?`),
      h('div', { class: 'mf-actions' },
        h('button', {
          type: 'button', class: 'danger-btn', title: 'Borra la de este día; la rutina sigue',
          onclick: () => {
            closeModal();
            deleteTask(task.id); // no vuelve a aparecer: su día ya quedó como creado
            showToast(`"${task.title}" borrada solo este día. La rutina sigue.`);
          },
        }, 'Solo esta'),
        h('button', {
          type: 'button', class: 'danger-btn', title: 'Termina la rutina y borra sus tareas pendientes',
          onclick: () => {
            closeModal();
            deleteTask(task.id);
            deleteRoutine(routine.id);
            showToast(`Rutina "${routine.title}" terminada: se borraron esta y las próximas.`);
          },
        }, 'Esta y las próximas'),
        h('button', { type: 'button', class: 'ghost small', onclick: () => { deleteAsk = false; render(); } }, 'Cancelar')));
  }
  if (routine) {
    return h('footer', { class: 'modal-footer' },
      h('button', { type: 'button', class: 'danger-btn', onclick: () => { deleteAsk = true; render(); } }, 'Borrar tarea'));
  }
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
            epic ? h('span', { class: 'dot', style: `background:${epic.color}`, title: epic.name }) : null, titleCase(pred.title)),
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
  const date = task.date || todayISO();
  // Hoy: próxima media hora; otro día: inicio del bloque de la tarea (o del primero)
  let start = toMinutes(blockRange(state.settings, task.block).start);
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
  const before = wasMeeting ? `${task.meeting.start}–${task.meeting.end}` : null; // antes de guardar (setMeeting muta la tarea)
  const error = setMeeting(task.id, { date: f.date, start: f.start, end, blocking: f.blocking });
  if (error) {
    f.error = error;
    render();
    return;
  }
  meetingForm = null;
  render();
  // Una reunión de rutina reprogramada: el cambio es solo de este día, salvo que se aplique a todas
  const now = findTask(task.id);
  if (now?.routine_id && wasMeeting && before !== `${now.meeting.start}–${now.meeting.end}`) {
    showToast(`Reunión reprogramada: ${f.start}–${end}, solo este día.`, {
      label: 'Aplicar a todas',
      run: () => { applyTaskToRoutine(task.id); showToast(`Todas las "${now.title}" quedan de ${now.meeting.start} a ${now.meeting.end}.`); },
    });
    return;
  }
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
      h('h3', {}, task.meeting ? 'Reprogramar Reunión' : 'Convertir en Reunión'), meetingFormView(task));
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
/** Documentación: un solo botón largo y delgado (abrir si existe, crear si no); se edita en su pestaña. */
function docSection(task) {
  const exists = Boolean(task.doc?.trim());
  const updated = exists && task.doc_updated_at
    ? new Date(task.doc_updated_at).toLocaleDateString('es', { day: 'numeric', month: 'short' })
    : null;
  const open = h('button', {
    type: 'button',
    class: `doc-link-btn${exists ? '' : ' create'}`,
    title: exists ? 'Abrir la documentación en una pestaña nueva' : 'Crear la documentación en una pestaña nueva',
    onclick: () => openDocTab(task.id),
  },
  h('span', { class: 'doc-link-icon', 'aria-hidden': 'true' }, exists ? '▤' : '+'),
  h('span', { class: 'doc-link-label' }, exists ? 'Abrir documentación' : 'Crear documentación'),
  updated ? h('span', { class: 'doc-link-meta' }, `editada ${updated}`) : null,
  h('span', { class: 'doc-link-arrow', 'aria-hidden': 'true' }, '↗'));
  if (!exists) return open;
  // Eliminar la documentación (con confirmación y "Deshacer")
  const remove = h('button', {
    type: 'button', class: 'doc-delete-btn', title: 'Eliminar la documentación', 'aria-label': 'Eliminar la documentación',
    onclick: () => {
      // eslint-disable-next-line no-alert
      if (!window.confirm(`¿Eliminar la documentación de "${titleCase(task.title)}"?`)) return;
      const prev = clearDoc(task.id);
      if (!prev) return;
      showToast('Documentación eliminada.', { label: 'Deshacer', run: () => { restoreDoc(task.id, prev); showToast('Documentación restaurada.'); } });
    },
  });
  remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
  return h('div', { class: 'doc-link-row' }, open, remove);
}

/** Abre (en una pestaña) la página de documentación de la tarea. */
export function openDocTab(taskId) {
  const query = `?task=${encodeURIComponent(taskId)}`;
  if (typeof chrome !== 'undefined' && chrome.tabs?.create) {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/pages/doc/doc.html' + query) });
  } else {
    window.open('../doc/doc.html' + query, '_blank', 'noopener'); // fuera de la extensión (pruebas), relativo al panel
  }
}

// ---------- Render ----------

// ---------- Editar: el título del detalle se toca y se escribe como en "+ Nueva tarea" ----------

const snapshotOf = (t) => JSON.stringify([t.title, t.minutes, t.certainty, t.epic_id, t.block, t.date, t.meeting]);

function startTitleEdit(task) {
  titleDraft = toQuickAddText(task, findEpic(task.epic_id));
  render();
  const input = document.querySelector('#modal .modal-title-input');
  input?.focus();
  input?.select();
}

function finishTitleEdit(save) {
  if (titleDraft === null) return;
  const task = findTask(currentId);
  const text = titleDraft;
  titleDraft = null;
  if (!task || !save) {
    render();
    return;
  }
  const before = snapshotOf(task);
  if (!editFromText(task.id, text)) {
    render();
    return;
  }
  const now = findTask(task.id);
  // Tarea de una rutina: el cambio es solo de este día, salvo que se aplique a todas
  if (now?.routine_id && snapshotOf(now) !== before) {
    showToast(`Cambiaste "${now.title}" solo este día.`, {
      label: 'Aplicar a todas',
      run: () => { applyTaskToRoutine(now.id); showToast(`Listo: las próximas "${now.title}" quedan igual.`); },
    });
  }
  render();
}

/** Cambia el <h2> del modal por el título editable (✎) o por el campo de edición. */
function decorateTitle(task) {
  const title = document.getElementById('modal-title');
  if (!title) return;
  if (titleDraft === null) {
    title.classList.add('modal-title-editable');
    title.tabIndex = 0;
    title.setAttribute('role', 'button');
    title.title = 'Editar la tarea';
    title.append(h('span', { class: 'modal-title-pencil', 'aria-hidden': 'true' }, '✎'));
    title.addEventListener('click', () => startTitleEdit(task));
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        startTitleEdit(task);
      }
    });
    return;
  }
  const input = h('input', {
    class: 'modal-title-input', value: titleDraft, 'aria-label': 'Editar la tarea', dataset: { key: 'title-edit' },
    enterkeyhint: 'done', autocomplete: 'off',
  });
  input.addEventListener('input', () => { titleDraft = input.value; });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishTitleEdit(true);
    } else if (e.key === 'Escape') {
      e.preventDefault(); // que Escape cancele la edición y no cierre el detalle
      e.stopPropagation();
      finishTitleEdit(false);
    }
  });
  // Al salir del campo se guarda (si el campo se quitó por un re-render, no)
  input.addEventListener('blur', () => setTimeout(() => { if (input.isConnected && titleDraft !== null) finishTitleEdit(true); }, 0));
  const hint = h('p', { class: 'modal-title-hint' },
    'Título, duración (', h('code', {}, '45m'), '), ', h('code', {}, '?'), ' / ', h('code', {}, '!'),
    ', bloque o día (', h('code', {}, 'tarde'), ', ', h('code', {}, 'mañana'), ') y ', h('code', {}, '#épica'), '. Enter guarda.');
  title.replaceWith(h('div', { class: 'modal-title-edit', id: 'modal-title' }, input, hint));
}

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
  decorateTitle(task);

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
  titleDraft = null;
  meetingForm = null;
  repeatOpen = false;
  deleteAsk = false;
  comments.stopEditing();
  clearInterval(tick);
  tick = null;
}

/** Abre el detalle. opts.edit: abrirlo ya editando (✎ de la tarjeta). */
export function showTaskModal(taskId, opts = {}) {
  if (currentId !== taskId) {
    comments.reset();
    meetingForm = null;
    repeatOpen = false;
    titleDraft = null;
  }
  currentId = taskId;
  wasBlocked = false;
  render();
  if (opts.edit) {
    const task = findTask(taskId);
    if (task) startTitleEdit(task);
  }
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

// ✎ de las tarjetas (con mouse, al pasar por encima): abrir el detalle editando. Se atiende aquí, antes
// que los clics de cada vista, para que no abran además el detalle normal.
document.addEventListener('click', (e) => {
  const btn = e.target.closest?.('.task .edit-btn');
  if (!btn) return;
  e.stopPropagation();
  e.preventDefault();
  const id = btn.closest('.task')?.dataset.id;
  if (id) showTaskModal(id, { edit: true });
}, true);
