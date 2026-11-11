// Vista "Épicas": crear épicas, ver progreso y pronóstico, y llenar su backlog.

import { formatMinutes } from '../core/parser.js';
import { epicForecast, criticalIds } from '../core/pert.js';
import { todayISO, dayLabel } from '../utils/dates.js';
import {
  state, findEpic, activeEpics, archivedEpics, epicTasks,
  createEpic, renameEpic, setEpicTarget, archiveEpic, restoreEpic, deleteEpic,
  addFromText, updateTask, planTask, unplanTask, toggleTimer,
} from '../services/store.js';
import { h } from '../utils/ui.js';
import { renderCard } from '../components/cards.js';
import { showTaskModal } from '../components/task-modal.js';

const OPEN_PLANNED_KEY = 'pertday:openPlanned';
let openPlanned = new Set();
try {
  openPlanned = new Set(JSON.parse(localStorage.getItem(OPEN_PLANNED_KEY) || '[]'));
} catch { /* sin almacenamiento */ }

function rememberPlanned(id, open) {
  if (open) openPlanned.add(id);
  else openPlanned.delete(id);
  try { localStorage.setItem(OPEN_PLANNED_KEY, JSON.stringify([...openPlanned])); } catch { /* ignorar */ }
}

function forecastText(fc, epic) {
  if (!epic.target_date || !fc.pendingCount) return null;
  if (epic.target_date < todayISO()) return ['◷ La fecha ya pasó', 'bad'];
  const pct = Math.round(fc.probability * 100);
  if (fc.probability >= 0.8) return [`✓ ${pct}% a tiempo`, 'good'];
  if (fc.probability >= 0.5) return [`◐ ${pct}% a tiempo`, 'warn'];
  return [`⚠︎ ${pct}% a tiempo`, 'bad'];
}

function blocksText(blocks) {
  const n = Math.max(0.5, Math.round(blocks * 2) / 2);
  return `≈ ${n.toLocaleString('es')} bloque${n === 1 ? '' : 's'}`;
}

function renderEpic(epic, ctx) {
  const fc = epicForecast(epic, state.tasks, state.settings);
  const own = epicTasks(epic.id);
  const backlog = own.filter((t) => t.date === null).sort((a, b) => a.done - b.done || a.order - b.order);
  const planned = own.filter((t) => t.date !== null)
    .sort((a, b) => a.date.localeCompare(b.date) || a.block.localeCompare(b.block) || a.order - b.order);
  const pct = fc.total ? (fc.doneCount / fc.total) * 100 : 0;

  const remaining = fc.pendingCount
    ? `Quedan ~${formatMinutes(fc.mu)} de trabajo (${blocksText(fc.blocks)})`
    : fc.total ? '✓ Todo hecho' : 'Agrega tareas al backlog para empezar';

  const forecast = forecastText(fc, epic);
  const target = h('div', { class: 'epic-target' },
    h('label', {}, 'Fecha objetivo ',
      h('input', {
        type: 'date', value: epic.target_date || '', dataset: { action: 'target' },
        'aria-label': `Fecha objetivo de ${epic.name}`,
      })),
    forecast ? h('span', {
      class: `forecast ${forecast[1]}`,
      title: `Necesitas ~${formatMinutes(fc.mu)} ± ${formatMinutes(fc.sigma)} · libres hasta esa fecha: ${formatMinutes(fc.capacity)} (descontando otras tareas ya planificadas)`,
    }, forecast[0]) : null);

  const cardOpts = { ctx, link: false, plan: true, unplan: true, showEpic: false };
  const backlogList = h('ul', { class: 'list' }, ...backlog.map((t) => renderCard(t, cardOpts)));
  if (!backlog.length) backlogList.append(h('li', { class: 'empty' }, 'Sin tareas en el backlog'));

  const plannedDetails = planned.length ? h('details', {
    class: 'planned', open: openPlanned.has(epic.id), dataset: { epicId: epic.id },
  },
  h('summary', {}, `Planificadas (${planned.length})`),
  h('ul', { class: 'list' }, ...planned.map((t) => renderCard(t, { ...cardOpts, plan: false, when: true })))) : null;

  return h('article', { class: 'epic', dataset: { epicId: epic.id }, style: `--epic:${epic.color}` },
    h('header', { class: 'epic-head' },
      h('span', { class: 'dot', style: `background:${epic.color}` }),
      h('h3', { class: 'epic-name', title: 'Doble clic para renombrar' }, epic.name),
      h('span', { class: 'epic-count' }, `${fc.doneCount}/${fc.total} ✓`),
      h('button', { class: 'epic-action', dataset: { action: 'archive' }, title: 'Archivar épica' }, 'Archivar'),
      h('button', { class: 'epic-action danger', dataset: { action: 'delete-epic' }, title: 'Borrar épica' }, 'Borrar')),
    h('div', { class: 'bar epic-bar' }, h('div', { class: 'bar-done', style: `width:${pct}%` })),
    h('p', { class: 'epic-remaining' }, remaining),
    target,
    h('h4', {}, `Backlog (${backlog.filter((t) => !t.done).length})`),
    h('form', { class: 'quick-add', autocomplete: 'off', dataset: { action: 'add-task' } },
      h('input', {
        type: 'text',
        placeholder: '+ Agregar tarea…  (ej: Comprar dominio 15m)',
        'aria-label': `Nueva tarea para ${epic.name}`,
        dataset: { focusKey: `backlog-${epic.id}` },
      })),
    backlogList,
    plannedDetails);
}

function renderArchived() {
  const list = archivedEpics();
  if (!list.length) return null;
  return h('details', { class: 'archived' },
    h('summary', {}, `Archivadas (${list.length})`),
    h('ul', { class: 'archived-list' }, ...list.map((epic) => {
      const own = epicTasks(epic.id);
      return h('li', { dataset: { epicId: epic.id } },
        h('span', { class: 'dot', style: `background:${epic.color}` }),
        h('span', { class: 'archived-name' }, epic.name),
        h('span', { class: 'epic-count' }, `${own.filter((t) => t.done).length} hechas`),
        h('button', { class: 'epic-action', dataset: { action: 'restore' } }, 'Restaurar'),
        h('button', { class: 'epic-action danger', dataset: { action: 'delete-epic' } }, 'Borrar'));
    })));
}

/** Re-render conservando foco y lo que el usuario estaba escribiendo. */
export function renderEpics() {
  const root = document.getElementById('epics-list');
  const drafts = new Map();
  root.querySelectorAll('[data-focus-key]').forEach((el) => {
    if (el.value) drafts.set(el.dataset.focusKey, el.value);
  });
  const active = document.activeElement?.dataset?.focusKey;
  const caret = active ? document.activeElement.selectionStart : null;

  const ctx = {
    allTasks: state.tasks,
    byId: new Map(state.tasks.map((t) => [t.id, t])),
    epicsById: new Map(state.epics.map((e) => [e.id, e])),
    critical: criticalIds(state.tasks),
    planDate: state.viewDate,
  };
  const epics = activeEpics();
  const nodes = epics.map((e) => renderEpic(e, ctx));
  if (!epics.length) {
    nodes.push(h('div', { class: 'epics-empty' },
      h('p', {}, 'Una épica agrupa tareas de varios días: "Lanzar web", "Mudanza", "Curso de inglés"…'),
      h('p', {}, 'Créala arriba, o escribe ', h('code', {}, '#nombre'), ' al final de cualquier tarea.')));
  }
  const archived = renderArchived();
  if (archived) nodes.push(archived);
  root.replaceChildren(...nodes);

  document.getElementById('plan-date-hint').textContent =
    `Los botones → AM / → PM planifican en: ${dayLabel(state.viewDate).toLowerCase()}`;

  root.querySelectorAll('[data-focus-key]').forEach((el) => {
    if (drafts.has(el.dataset.focusKey)) el.value = drafts.get(el.dataset.focusKey);
    if (el.dataset.focusKey === active) {
      el.focus();
      if (caret !== null) el.setSelectionRange(caret, caret);
    }
  });
}

// ---------- Renombrar ----------

function startRename(nameEl, epicId) {
  const epic = findEpic(epicId);
  if (!epic) return;
  const input = h('input', { class: 'edit-input', value: epic.name, 'aria-label': 'Nombre de la épica' });
  nameEl.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const value = input.value;
    input.replaceWith(nameEl);
    if (save) renameEpic(epicId, value);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

export function isEpicsBusy() {
  return Boolean(document.querySelector('#view-epics .edit-input'));
}

// ---------- Eventos ----------

export function setupEpics() {
  const form = document.getElementById('new-epic');
  const input = form.querySelector('input');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (createEpic(input.value)) input.value = '';
  });

  const root = document.getElementById('epics-list');

  root.addEventListener('submit', (e) => {
    const f = e.target.closest('form[data-action="add-task"]');
    if (!f) return;
    e.preventDefault();
    const epicId = f.closest('.epic').dataset.epicId;
    const field = f.querySelector('input');
    const value = field.value;
    field.value = '';
    if (!addFromText(value, { epicId })) field.value = value;
  });

  root.addEventListener('change', (e) => {
    if (e.target.matches('.task .check')) {
      updateTask(e.target.closest('.task').dataset.id, { done: e.target.checked });
    } else if (e.target.matches('[data-action="target"]')) {
      setEpicTarget(e.target.closest('.epic').dataset.epicId, e.target.value);
    }
  });

  root.addEventListener('toggle', (e) => {
    if (e.target.matches('details.planned')) rememberPlanned(e.target.dataset.epicId, e.target.open);
  }, true);

  root.addEventListener('click', (e) => {
    const li = e.target.closest('.task');
    if (li) {
      const id = li.dataset.id;
      if (!e.target.closest('button, input, textarea')) {
        showTaskModal(id);
        return;
      }
      if (e.target.matches('.timer-btn')) {
        const t = state.tasks.find((x) => x.id === id);
        if (t?.meeting && t.time_entries.at(-1)?.end === null) showTaskModal(id);
        else toggleTimer(id);
      }
      else if (e.target.matches('.plan-btn')) planTask(id, e.target.dataset.block);
      else if (e.target.matches('.unplan')) unplanTask(id);
      return;
    }
    const action = e.target.closest('[data-action]')?.dataset.action;
    const epicId = e.target.closest('[data-epic-id]')?.dataset.epicId;
    if (!action || !epicId) return;
    const epic = findEpic(epicId);
    if (action === 'archive') archiveEpic(epicId);
    else if (action === 'restore') restoreEpic(epicId);
    else if (action === 'delete-epic') {
      const n = epicTasks(epicId).length;
      const detail = n ? ` Sus ${n} tarea${n > 1 ? 's' : ''} no se borran: quedan sin épica.` : '';
      if (window.confirm(`¿Borrar la épica "${epic.name}"?${detail}`)) deleteEpic(epicId);
    }
  });

  root.addEventListener('dblclick', (e) => {
    const name = e.target.closest('.epic-name');
    if (name) startRename(name, name.closest('.epic').dataset.epicId);
  });
}
