// Vista "Épicas" (estilo de la vista Hoy): cada épica es una fila plegable.
// Cerrada: nombre, hechas/total, fecha objetivo, "Quedan ~41m de trabajo" y, si tiene valor hora, su costo.
// Abierta: el detalle del costo (trabajado, pendiente y total) y el valor hora junto a la fecha objetivo.
// Abierta: campo para agregar tareas (misma sintaxis de Hoy) y sus tareas separadas por líneas
// (──── Sin fecha · Planificadas · Hechas), más la fecha objetivo y renombrar / archivar / borrar.

import { formatMinutes } from '../core/parser.js';
import { epicForecast, criticalIds } from '../core/pert.js';
import { todayISO, shortLabel, parseISO } from '../utils/dates.js';
import {
  state, findEpic, activeEpics, archivedEpics, epicTasks,
  createEpic, renameEpic, setEpicTarget, setEpicRate, reorderEpics, archiveEpic, restoreEpic, deleteEpic,
  addFromText, updateTask, toggleTimer,
} from '../services/store.js';
import { blockIndex } from '../core/blocks.js';
import { h, attachEpicAutocomplete, showToast } from '../utils/ui.js';
import { renderCard } from '../components/cards.js';
import { showTaskModal, openEpicDoc } from '../components/task-modal.js';
import { openMoveMenu } from '../components/move-menu.js';
import { probTag } from '../components/prob-tag.js';
import { makeSortable } from '../utils/drag-sort.js';
import { titleCase } from '../utils/text.js';
import {
  CURRENCIES, CURRENCY_LABEL, defaultCurrency, hasRate, epicCost, formatMoney,
} from '../core/cost.js';

// Épicas abiertas en esta sesión (al abrir el panel, todas empiezan cerradas)
const openEpics = new Set();
let renaming = null; // id de la épica que se está renombrando

/** Probabilidad de terminar a la fecha objetivo (0–1), o null si no aplica. */
function forecastOf(fc, epic) {
  if (!epic.target_date || !fc.pendingCount) return null;
  if (epic.target_date < todayISO()) return null; // ya lo dice "Objetivo vencido"
  return fc.probability;
}

/** "Objetivo: mié 24 dic (en 13 días)" · "Objetivo: hoy" · "Objetivo vencido: lun 10 nov" · "Sin fecha objetivo" */
/** Valor hora para el campo: "25.000" en CLP, "25,50" en USD o EUR (sin el símbolo). */
const rateText = (epic) => new Intl.NumberFormat('es-CL', {
  minimumFractionDigits: 0, maximumFractionDigits: epic.currency === 'CLP' ? 0 : 2,
}).format(epic.rate);

/** Dinero en la moneda de la épica. */
const money = (epic, amount) => formatMoney(amount, epic.currency);

/** "Total 6h · $150.000 · Trabajado 3h · $75.000 · Pendiente 2h30 · $62.500" */
function costLine(epic) {
  const c = epicCost(epic, state.tasks);
  const sep = () => h('span', { class: 'epic-sep', 'aria-hidden': 'true' }, ' · ');
  const part = (label, min, amount, title) => [
    h('span', { class: 'cost-label', title }, label), ` ${formatMinutes(Math.round(min))} · `, h('strong', {}, money(epic, amount))];
  return h('p', { class: 'epic-cost-line' },
    ...part('Total', c.minutes.estimated, c.amount.estimated, 'Todas las tareas por su estimado'), sep(),
    ...part('Trabajado', c.minutes.worked, c.amount.worked, 'Tiempo del temporizador (en las hechas sin temporizador, su estimado)'), sep(),
    ...part('Pendiente', c.minutes.pending, c.amount.pending, 'Lo que falta de las pendientes'));
}

function targetText(target) {
  if (!target) return 'Sin fecha objetivo';
  const today = todayISO();
  const days = Math.round((parseISO(target) - parseISO(today)) / 86400000);
  const year = target.slice(0, 4) !== today.slice(0, 4) ? ` ${target.slice(0, 4)}` : '';
  const date = `${shortLabel(target)}${year}`;
  if (days < 0) return `🎯 Objetivo vencido: ${date}`;
  if (days === 0) return '🎯 Objetivo: hoy';
  if (days === 1) return `🎯 Objetivo: mañana, ${date}`;
  return `🎯 Objetivo: ${date} (en ${days} días)`;
}

function remainingText(fc) {
  if (fc.pendingCount) return `Quedan ~${formatMinutes(fc.mu)} de trabajo`;
  return fc.total ? '✓ Todo hecho' : 'Sin tareas todavía';
}

/** ───────── Planificadas (3) — mismo separador que Hoy y Hechas. */
const divider = (label) => h('li', { class: 'done-divider' },
  h('span', { class: 'done-line', 'aria-hidden': 'true' }),
  h('span', { class: 'done-date' }, label));

function epicBody(epic, ctx) {
  const own = epicTasks(epic.id);
  const rank = (t) => blockIndex(state.settings, t.block);
  const undated = own.filter((t) => !t.date && !t.done).sort((a, b) => a.order - b.order);
  const planned = own.filter((t) => t.date && !t.done)
    .sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b) || a.order - b.order);
  const done = own.filter((t) => t.done).sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''));
  const card = (t, opts = {}) => renderCard(t, { ctx, showEpic: false, move: true, ...opts });

  const items = [];
  if (undated.length) items.push(divider(`Sin Fecha (${undated.length})`), ...undated.map((t) => card(t)));
  if (planned.length) items.push(divider(`Planificadas (${planned.length})`), ...planned.map((t) => card(t, { when: true })));
  if (done.length) items.push(divider(`Hechas (${done.length})`), ...done.map((t) => card(t, { when: true })));

  const actions = renaming === epic.id
    ? h('form', { class: 'epic-rename', dataset: { action: 'rename' } },
      h('input', { class: 'edit-input', name: 'name', value: epic.name, 'aria-label': 'Nombre de la épica', dataset: { focusKey: `rename-${epic.id}` } }),
      h('button', { type: 'submit', class: 'link-btn' }, 'Guardar'),
      h('button', { type: 'button', class: 'link-btn', dataset: { action: 'rename-cancel' } }, 'Cancelar'))
    : h('div', { class: 'epic-actions' },
      h('button', { type: 'button', class: 'link-btn', dataset: { action: 'rename' } }, 'Renombrar'),
      h('button', { type: 'button', class: 'link-btn', dataset: { action: 'archive' } }, 'Archivar'),
      h('button', { type: 'button', class: 'link-btn danger', dataset: { action: 'delete-epic' } }, 'Borrar'));

  return h('div', { class: 'epic-body' },
    h('form', { class: 'quick-add epic-add', autocomplete: 'off', dataset: { action: 'add-task' } },
      h('input', {
        type: 'text',
        placeholder: `+ Nueva tarea en ${titleCase(epic.name)}`,
        title: 'Sin día queda sin fecha. Con "mañana", "viernes", am/pm o el nombre del bloque, se planifica.',
        'aria-label': `Nueva tarea para ${epic.name}`,
        dataset: { focusKey: `add-${epic.id}` },
      })),
    hasRate(epic) ? costLine(epic) : null,
    items.length
      ? h('ul', { class: 'done-list epic-tasks', 'aria-label': `Tareas de ${epic.name}` }, ...items)
      : h('p', { class: 'minimal-empty epic-empty' }, 'Escribe arriba la primera tarea de esta épica.'),
    h('div', { class: 'epic-foot' },
      h('label', { class: 'epic-target' }, '🎯 Fecha objetivo ',
        h('input', { type: 'date', value: epic.target_date || '', dataset: { action: 'target' }, 'aria-label': `Fecha objetivo de ${epic.name}` })),
      h('button', {
        type: 'button', class: `epic-doc-btn${epic.doc ? '' : ' create'}`, dataset: { action: 'epic-doc' },
        title: epic.doc ? 'Abrir la documentación de la épica' : 'Crear la documentación de la épica',
      }, epic.doc ? '▤ Documentación' : '+ Documentación'),
      h('span', { class: 'epic-rate', role: 'group', 'aria-label': `Valor hora de ${epic.name}` }, '💲 Valor hora ',
        h('input', {
          type: 'text', inputmode: 'decimal', class: 'epic-rate-input', placeholder: 'sin costo',
          value: epic.rate ? rateText(epic) : '', dataset: { action: 'rate', focusKey: `rate-${epic.id}` },
          'aria-label': 'Valor por hora', title: 'Para ver el costo de la épica. Vacío = sin costos.',
        }),
        h('select', { dataset: { action: 'currency' }, 'aria-label': 'Moneda', title: 'Cambiar la moneda no convierte el valor: solo cambian el formato y el símbolo.' },
          ...[...new Set([...CURRENCIES, epic.currency || defaultCurrency()])].map((code) => h('option', { value: code, selected: code === (epic.currency || defaultCurrency()) }, CURRENCY_LABEL[code] || code)))),
      actions));
}

function renderEpic(epic, ctx) {
  const fc = epicForecast(epic, state.tasks, state.settings);
  const pct = fc.total ? (fc.doneCount / fc.total) * 100 : 0;
  const forecast = forecastOf(fc, epic);
  const open = openEpics.has(epic.id);
  const when = targetText(epic.target_date);

  return h('details', { class: 'epic-item', open, dataset: { epicId: epic.id }, style: `--epic:${epic.color}` },
    h('summary', {},
      h('span', { class: 'epic-row' },
        h('span', { class: 'epic-handle', title: 'Arrastra para ordenar', 'aria-hidden': 'true' }, '⠿'),
        h('span', { class: 'dot', style: `background:${epic.color}` }),
        h('span', { class: 'epic-name' }, titleCase(epic.name),
          epic.doc ? h('span', { class: 'epic-has-doc', title: 'Tiene documentación', 'aria-label': 'Tiene documentación' }, ' ▤') : null),
        h('span', { class: 'epic-count', title: `${fc.doneCount} hechas de ${fc.total}` }, `${fc.doneCount}/${fc.total} ✓`),
        h('span', { class: 'ss-chevron', 'aria-hidden': 'true' })),
      h('span', { class: 'epic-meta' },
        h('span', { class: 'epic-target-text', title: epic.target_date ? 'Fecha objetivo (se cambia al abrir la épica)' : null }, when),
        forecast !== null ? probTag(forecast) : null,
        h('span', { class: 'epic-sep', 'aria-hidden': 'true' }, '·'),
        h('span', {}, remainingText(fc)),
        hasRate(epic) ? (() => {
          const c = epicCost(epic, state.tasks);
          return h('span', {
            class: 'epic-cost',
            'data-tooltip': `Total de todas las tareas: ${money(epic, c.amount.estimated)} · Trabajado ${money(epic, c.amount.worked)} · Pendiente ${money(epic, c.amount.pending)}`,
          }, money(epic, c.amount.estimated));
        })() : null),
      h('span', { class: 'epic-progress', 'aria-hidden': 'true' }, h('span', { style: `width:${pct}%` }))),
    open ? epicBody(epic, ctx) : null);
}

function renderArchived() {
  const list = archivedEpics();
  if (!list.length) return null;
  return h('details', { class: 'epic-item archived' },
    h('summary', {},
      h('span', { class: 'epic-row' },
        h('span', { class: 'epic-name' }, `Archivadas (${list.length})`),
        h('span', { class: 'ss-chevron', 'aria-hidden': 'true' }))),
    h('ul', { class: 'archived-list' }, ...list.map((epic) => h('li', { dataset: { epicId: epic.id } },
      h('span', { class: 'dot', style: `background:${epic.color}` }),
      h('span', { class: 'archived-name' }, titleCase(epic.name)),
      h('span', { class: 'epic-count' }, `${epicTasks(epic.id).filter((t) => t.done).length} hechas`),
      h('button', { type: 'button', class: 'link-btn', dataset: { action: 'restore' } }, 'Restaurar'),
      h('button', { type: 'button', class: 'link-btn danger', dataset: { action: 'delete-epic' } }, 'Borrar')))));
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
  const archivedOpen = root.querySelector('.epic-item.archived')?.open;

  const ctx = {
    allTasks: state.tasks,
    byId: new Map(state.tasks.map((t) => [t.id, t])),
    epicsById: new Map(state.epics.map((e) => [e.id, e])),
    critical: criticalIds(state.tasks),
  };
  const epics = activeEpics();
  document.getElementById('epics-count').textContent = epics.length
    ? `${epics.length} épica${epics.length === 1 ? '' : 's'} activa${epics.length === 1 ? '' : 's'}`
    : '';
  const nodes = epics.map((e) => renderEpic(e, ctx));
  if (!epics.length) {
    nodes.push(h('div', { class: 'routine-empty' },
      h('p', {}, 'Una épica agrupa tareas de varios días: "Lanzar web", "Mudanza", "Curso de inglés"…'),
      h('p', {}, 'Créala arriba, o escribe ', h('code', {}, '#nombre'), ' al final de cualquier tarea.')));
  }
  const archived = renderArchived();
  if (archived) {
    archived.open = Boolean(archivedOpen);
    nodes.push(archived);
  }
  root.replaceChildren(...nodes);
  root.querySelectorAll('.epic-add input').forEach((el) => attachEpicAutocomplete(el, activeEpics));

  root.querySelectorAll('[data-focus-key]').forEach((el) => {
    if (drafts.has(el.dataset.focusKey)) el.value = drafts.get(el.dataset.focusKey);
    if (el.dataset.focusKey === active) {
      el.focus();
      if (caret !== null) el.setSelectionRange(caret, caret);
    }
  });
}

let sortable = null; // ordenar arrastrando la manija ⠿ (setupEpics)

export function isEpicsBusy() {
  return Boolean(renaming || document.querySelector('#view-epics .edit-input') || sortable?.busy());
}

// ---------- Eventos ----------

export function setupEpics() {
  const form = document.getElementById('new-epic');
  const input = form.querySelector('input');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const epic = createEpic(input.value);
    if (!epic) return;
    input.value = '';
    openEpics.add(epic.id); // la nueva se abre para agregarle tareas
    renderEpics();
    document.querySelector(`.epic-item[data-epic-id="${epic.id}"] .epic-add input`)?.focus();
  });

  const root = document.getElementById('epics-list');
  // Ordenar las épicas arrastrando la manija ⠿ (la de Archivadas no se mueve)
  sortable = makeSortable(root, {
    item: '.epic-item:not(.archived)',
    handle: '.epic-handle',
    idOf: (el) => el.dataset.epicId,
    onSort: (ids) => reorderEpics(ids),
  });
  // Tocar la manija no abre ni cierra la épica
  root.addEventListener('click', (e) => {
    if (e.target.closest('.epic-handle')) e.preventDefault();
  }, true);

  // Abrir / cerrar una épica: su contenido se arma solo al abrirla
  root.addEventListener('toggle', (e) => {
    const item = e.target;
    if (!item.matches?.('.epic-item[data-epic-id]')) return;
    const id = item.dataset.epicId;
    if (item.open === openEpics.has(id)) return;
    if (item.open) openEpics.add(id);
    else openEpics.delete(id);
    renderEpics();
  }, true);

  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const epicId = f.closest('.epic-item')?.dataset.epicId;
    if (f.matches('[data-action="add-task"]')) {
      const field = f.querySelector('input');
      const value = field.value;
      field.value = '';
      if (!addFromText(value, { epicId })) field.value = value;
    } else if (f.matches('[data-action="rename"]')) {
      renaming = null;
      renameEpic(epicId, f.elements.name.value);
      renderEpics();
    }
  });

  root.addEventListener('change', (e) => {
    if (e.target.matches('.task .check')) {
      updateTask(e.target.closest('.task').dataset.id, { done: e.target.checked });
    } else if (e.target.matches('[data-action="target"]')) {
      setEpicTarget(e.target.closest('.epic-item').dataset.epicId, e.target.value);
    } else if (e.target.matches('[data-action="rate"], [data-action="currency"]')) {
      const group = e.target.closest('.epic-rate');
      const epicId = e.target.closest('.epic-item').dataset.epicId;
      const currency = group.querySelector('[data-action="currency"]').value;
      setEpicRate(epicId, group.querySelector('[data-action="rate"]').value, currency);
      // Cambiar la moneda no convierte el valor hora: solo cambia el formato y el símbolo
      if (e.target.matches('[data-action="currency"]') && findEpic(epicId)?.rate) {
        showToast(`Moneda: ${CURRENCY_LABEL[currency] || currency}. No se convierte el valor: solo cambian el formato y el símbolo.`);
      }
    }
  });

  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && renaming) {
      renaming = null;
      renderEpics();
    }
  });

  root.addEventListener('click', (e) => {
    const docBtn = e.target.closest('[data-action="epic-doc"]');
    if (docBtn) {
      openEpicDoc(docBtn.closest('.epic-item').dataset.epicId);
      return;
    }
    const li = e.target.closest('.task');
    if (li) {
      const id = li.dataset.id;
      const moveBtn = e.target.closest('.move-btn');
      if (moveBtn) {
        openMoveMenu(id, moveBtn);
        return;
      }
      if (e.target.matches('.timer-btn')) {
        const t = state.tasks.find((x) => x.id === id);
        if (t?.meeting && t.time_entries.at(-1)?.end === null) showTaskModal(id);
        else toggleTimer(id);
        return;
      }
      if (!e.target.closest('button, input, textarea')) showTaskModal(id);
      return;
    }
    const action = e.target.closest('button[data-action]')?.dataset.action;
    const epicId = e.target.closest('[data-epic-id]')?.dataset.epicId;
    if (!action || !epicId) return;
    const epic = findEpic(epicId);
    if (action === 'rename') {
      renaming = epicId;
      renderEpics();
      const field = root.querySelector(`.epic-item[data-epic-id="${epicId}"] .epic-rename input`);
      field?.focus();
      field?.select();
    } else if (action === 'rename-cancel') {
      renaming = null;
      renderEpics();
    } else if (action === 'archive') archiveEpic(epicId);
    else if (action === 'restore') restoreEpic(epicId);
    else if (action === 'delete-epic') {
      const n = epicTasks(epicId).length;
      const detail = n ? ` Sus ${n} tarea${n > 1 ? 's' : ''} no se borran: quedan sin épica.` : '';
      if (window.confirm(`¿Borrar la épica "${epic.name}"?${detail}`)) deleteEpic(epicId);
    }
  });
}
