// Vista "Rutinas": todo lo que se repite, con su próxima fecha. Se edita en el lugar (título, días,
// bloque y duración, u horario si es reunión) o se elimina (con sus tareas pendientes).

import { state, findEpic, updateRoutine, deleteRoutine, nextOccurrence } from '../services/store.js';
import { h, showToast } from '../utils/ui.js';
import { ALL_DAYS, DAY_LETTER, repeatLabel } from '../core/routines.js';
import { blocksOf, blockName } from '../core/blocks.js';
import { formatMinutes } from '../core/parser.js';
import { todayISO, shiftDate, shortLabel } from '../utils/dates.js';

const DURATIONS = [10, 15, 20, 30, 45, 60, 90, 120, 180, 240];

let editingId = null;
let draft = null; // { title, days, minutes, block, start, end } mientras se edita
let error = '';

/** ¿Se está editando una rutina? (el panel no re-renderiza por cambios de otra ventana) */
export function isRoutinesBusy() {
  return Boolean(editingId);
}

function whenText(date) {
  if (!date) return 'Sin próximas en 2 semanas';
  const today = todayISO();
  if (date === today) return 'Próxima: hoy';
  if (date === shiftDate(today, 1)) return 'Próxima: mañana';
  return `Próxima: ${shortLabel(date)}`;
}

function routineMeta(r) {
  const what = r.meeting ? `◷ ${r.meeting.start}–${r.meeting.end}` : `${blockName(state.settings, r.block)} · ${formatMinutes(r.minutes)}`;
  return `${repeatLabel(r.days)} · ${what}`;
}

function viewRow(r) {
  const epic = findEpic(r.epic_id);
  const next = nextOccurrence(r);
  return h('li', { class: `routine-card${r.meeting ? ' is-meeting' : ''}`, dataset: { id: r.id } },
    h('div', { class: 'routine-main' },
      h('span', { class: 'routine-title' },
        h('span', { class: 'routine-icon', 'aria-hidden': 'true' }, r.meeting ? '◷' : '↻'),
        epic ? h('span', { class: 'dot', style: `background:${epic.color}`, title: epic.name }) : null,
        r.title),
      h('span', { class: 'routine-meta' }, routineMeta(r)),
      h('span', { class: `routine-next${next === todayISO() ? ' is-today' : ''}` }, whenText(next))),
    h('div', { class: 'routine-actions' },
      h('button', { type: 'button', class: 'ghost small', dataset: { action: 'edit' } }, 'Editar'),
      h('button', { type: 'button', class: 'danger-btn small', dataset: { action: 'delete' } }, 'Eliminar')));
}

function editRow(r) {
  const chip = (d) => h('button', {
    type: 'button',
    class: `day-chip${draft.days.includes(d) ? ' on' : ''}`,
    'aria-pressed': String(draft.days.includes(d)),
    dataset: { day: d },
    title: draft.days.includes(d) ? 'Quitar este día' : 'Agregar este día',
  }, DAY_LETTER[d]);
  const durations = DURATIONS.includes(draft.minutes) ? DURATIONS : [...DURATIONS, draft.minutes].sort((a, b) => a - b);

  const fields = r.meeting
    ? h('div', { class: 'routine-fields' },
      h('label', {}, 'Desde ', h('input', { type: 'time', name: 'start', value: draft.start, required: true })),
      h('label', {}, 'Hasta ', h('input', { type: 'time', name: 'end', value: draft.end, required: true })))
    : h('div', { class: 'routine-fields' },
      h('label', {}, 'Bloque ', h('select', { name: 'block' },
        ...blocksOf(state.settings).map((b) => h('option', { value: b.id, selected: b.id === draft.block }, `${b.icon} ${b.title}`)))),
      h('label', {}, 'Duración ', h('select', { name: 'minutes' },
        ...durations.map((m) => h('option', { value: m, selected: m === draft.minutes }, formatMinutes(m))))));

  return h('li', { class: 'routine-card editing', dataset: { id: r.id } },
    h('form', { class: 'routine-form', autocomplete: 'off' },
      h('input', { type: 'text', name: 'title', class: 'routine-title-input', value: draft.title, 'aria-label': 'Título', required: true }),
      h('div', { class: 'repeat-days', role: 'group', 'aria-label': 'Días' }, ...ALL_DAYS.map(chip)),
      fields,
      error ? h('p', { class: 'settings-error' }, error) : null,
      h('p', { class: 'routine-note' }, 'Los cambios se aplican a la rutina y a sus tareas pendientes de hoy en adelante.'),
      h('div', { class: 'mf-actions' },
        h('button', { type: 'submit', class: 'primary small' }, 'Guardar'),
        h('button', { type: 'button', class: 'ghost small', dataset: { action: 'cancel' } }, 'Cancelar'))));
}

export function renderRoutines() {
  const list = document.getElementById('routine-list');
  const routines = [...state.routines].sort((a, b) =>
    (nextOccurrence(a) || '9999').localeCompare(nextOccurrence(b) || '9999')
    || (a.meeting?.start || '99').localeCompare(b.meeting?.start || '99')
    || a.title.localeCompare(b.title));
  if (editingId && !routines.some((r) => r.id === editingId)) editingId = null;
  document.getElementById('routines-count').textContent = routines.length
    ? `${routines.length} rutina${routines.length === 1 ? '' : 's'}`
    : '';
  if (!routines.length) {
    list.replaceChildren(h('li', { class: 'routine-empty' },
      h('p', {}, 'Todavía no tienes rutinas.'),
      h('p', {}, 'Escribe una tarea con ', h('code', {}, 'cada día'), ', ', h('code', {}, 'hábiles'), ' o ', h('code', {}, 'cada lun,jue'), ':'),
      h('p', {}, h('code', {}, 'Standup 15m cada día'), ' · ', h('code', {}, 'Reunión semanal lunes 10am 1h cada lunes'))));
    return;
  }
  const focused = document.activeElement?.name;
  list.replaceChildren(...routines.map((r) => (r.id === editingId ? editRow(r) : viewRow(r))));
  if (editingId && focused) list.querySelector(`.editing [name="${focused}"]`)?.focus();
}

function startEditing(r) {
  editingId = r.id;
  error = '';
  draft = {
    title: r.title,
    days: [...r.days],
    minutes: r.minutes,
    block: r.block,
    start: r.meeting?.start || '',
    end: r.meeting?.end || '',
  };
  renderRoutines();
  document.querySelector('#routine-list .editing [name="title"]')?.focus();
}

function stopEditing() {
  editingId = null;
  draft = null;
  error = '';
  renderRoutines();
}

export function setupRoutines() {
  const list = document.getElementById('routine-list');
  list.addEventListener('click', (e) => {
    const card = e.target.closest('.routine-card');
    const r = card && state.routines.find((x) => x.id === card.dataset.id);
    if (!r) return;
    const day = e.target.closest('[data-day]');
    if (day && draft) {
      const d = Number(day.dataset.day);
      draft.days = draft.days.includes(d) ? draft.days.filter((x) => x !== d) : [...draft.days, d];
      renderRoutines();
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'edit') startEditing(r);
    else if (action === 'cancel') stopEditing();
    else if (action === 'delete') {
      const pending = state.tasks.filter((t) => t.routine_id === r.id && !t.done).length;
      const detail = pending ? ` Se borran sus ${pending} tarea${pending === 1 ? '' : 's'} pendiente${pending === 1 ? '' : 's'};` : '';
      // eslint-disable-next-line no-alert
      if (!window.confirm(`¿Eliminar la rutina "${r.title}"?${detail} las hechas se quedan en Hechas.`)) return;
      if (editingId === r.id) stopEditing();
      deleteRoutine(r.id);
      showToast(`Rutina "${r.title}" eliminada.`);
    }
  });
  list.addEventListener('input', (e) => {
    if (!draft || !e.target.name) return;
    const { name, value } = e.target;
    draft[name] = name === 'minutes' ? Number(value) : value;
  });
  list.addEventListener('submit', (e) => {
    e.preventDefault();
    const r = state.routines.find((x) => x.id === editingId);
    if (!r || !draft) return;
    const problem = updateRoutine(r.id, {
      title: draft.title,
      days: draft.days,
      ...(r.meeting ? { meeting: { start: draft.start, end: draft.end } } : { minutes: draft.minutes, block: draft.block }),
    });
    if (problem) {
      error = problem;
      renderRoutines();
      return;
    }
    const title = draft.title.trim();
    stopEditing();
    showToast(`Rutina "${title}" actualizada.`);
  });
  list.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && editingId) stopEditing();
  });
}
