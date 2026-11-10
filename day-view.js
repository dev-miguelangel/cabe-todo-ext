// Vista "Hoy": bloques AM/PM, filtro por épica, bandeja, dependencias y drag & drop.

import { formatMinutes } from './parser.js';
import { scheduleBlock, isNowInBlock, criticalIds, wouldCreateCycle, canDepend } from './pert.js';
import { todayISO, shiftDate, dayLabel, shortLabel, nowMinutes } from './dates.js';
import {
  state, setView, findTask, findEpic, activeEpics, dayTasks, blockTasks, backlogTasks,
  addFromText, editFromText, updateTask, deleteTask, setDependency, planTask, applyOrder,
} from './store.js';
import { h, showToast, attachEpicAutocomplete } from './ui.js';
import { renderCard } from './cards.js';
import { toQuickAddText } from './parser.js';

const BLOCKS = ['am', 'pm'];
const BLOCK_ICON = { am: '☀️', pm: '🌙' };
const BACKLOG_OPEN_KEY = 'pertday:backlogOpen';

/** "Ahora" en minutos para el día que se está viendo: null si es futuro, fin del día si es pasado. */
function nowMinutesFor(iso) {
  const today = todayISO();
  if (iso < today) return 24 * 60;
  if (iso > today) return null;
  return nowMinutes();
}

function makeCtx() {
  return {
    byId: new Map(state.tasks.map((t) => [t.id, t])),
    epicsById: new Map(state.epics.map((e) => [e.id, e])),
    critical: criticalIds(state.tasks),
    planDate: state.viewDate,
  };
}

const dimmed = (task) => Boolean(state.filter && task.epic_id !== state.filter);

// ---------- Render ----------

function renderFilters() {
  const bar = document.getElementById('filters');
  const epics = activeEpics();
  bar.hidden = !epics.length;
  if (!epics.length) return;
  const chip = (id, label, color) => h('button', {
    class: `chip${state.filter === id ? ' active' : ''}`,
    dataset: { filter: id || '' },
    'aria-pressed': String(state.filter === id),
  }, color ? h('span', { class: 'dot', style: `background:${color}` }) : null, label);
  bar.replaceChildren(chip(null, 'Todas'), ...epics.map((e) => chip(e.id, e.name, e.color)));
}

function renderForecast(el, sched) {
  el.className = 'forecast';
  el.title = '';
  if (sched.pendingCount === 0) {
    el.textContent = sched.items.length ? '✓ Todo listo' : '';
    if (sched.items.length) el.classList.add('good');
    return;
  }
  if (sched.remaining <= 0) {
    el.textContent = `⏰ Bloque terminado · ${sched.pendingCount} pendiente${sched.pendingCount > 1 ? 's' : ''}`;
    el.classList.add('bad');
    return;
  }
  const pct = Math.round(sched.probability * 100);
  const [icon, cls] = sched.probability >= 0.8 ? ['✅', 'good'] : sched.probability >= 0.5 ? ['🟡', 'warn'] : ['⚠️', 'bad'];
  el.textContent = `${icon} ${pct}% de terminar a tiempo`;
  el.classList.add(cls);
  el.title = `Estimado ${formatMinutes(sched.mu)} ± ${formatMinutes(sched.sigma)} · quedan ${formatMinutes(sched.remaining)} en el bloque`;
}

/** "2h ● Lanzar web · 1h sin épica" */
function renderEpicSummary(el, list, ctx) {
  const groups = new Map();
  for (const t of list) groups.set(t.epic_id, (groups.get(t.epic_id) || 0) + t.minutes);
  const hasEpics = [...groups.keys()].some((id) => id && ctx.epicsById.has(id));
  el.hidden = !hasEpics;
  if (!hasEpics) return;
  const parts = [...groups.entries()]
    .sort(([a], [b]) => (a === null) - (b === null))
    .map(([id, minutes]) => {
      const epic = ctx.epicsById.get(id);
      return h('span', { class: 'sum-item' },
        epic ? h('span', { class: 'dot', style: `background:${epic.color}` }) : null,
        `${formatMinutes(minutes)} ${epic ? epic.name : 'sin épica'}`);
    });
  el.replaceChildren(...parts);
}

function renderBlock(block, ctx) {
  const section = document.querySelector(`.block[data-block="${block}"]`);
  const range = state.settings[block];
  const list = blockTasks(block);
  const sched = scheduleBlock(list, range, nowMinutesFor(state.viewDate));

  section.querySelector('.range').textContent = `${range.start}–${range.end}`;
  const now = state.viewDate === todayISO() && isNowInBlock(range);
  section.classList.toggle('is-now', now);
  section.querySelector('.now-badge').hidden = !now;

  // Capacidad: lo hecho (minutos reales) + lo pendiente (TE) contra el largo del bloque.
  const planned = sched.doneMinutes + sched.mu;
  const scale = Math.max(sched.capacity, planned) || 1;
  const over = sched.mu > sched.remaining && sched.pendingCount > 0;
  const cap = section.querySelector('.capacity');
  cap.classList.toggle('over', over);
  cap.querySelector('.bar-done').style.width = `${(sched.doneMinutes / scale) * 100}%`;
  cap.querySelector('.bar-pending').style.width = `${(sched.mu / scale) * 100}%`;
  cap.querySelector('.capacity-label').textContent = `${formatMinutes(planned)} / ${formatMinutes(sched.capacity)}`;
  cap.title = over
    ? `Te faltan ${formatMinutes(sched.mu - sched.remaining)} (estimado PERT)`
    : `Libre: ${formatMinutes(sched.remaining - sched.mu)} (estimado PERT)`;

  renderForecast(section.querySelector('.forecast'), sched);
  renderEpicSummary(section.querySelector('.epic-summary'), list, ctx);

  const ul = section.querySelector('.list');
  const cards = sched.items.map((item) => renderCard(item.task, {
    ctx, item, draggable: true, dim: dimmed(item.task),
  }));
  if (now) cards.find((li) => !li.classList.contains('done'))?.classList.add('current');
  ul.replaceChildren(...cards);
  if (!cards.length) ul.append(h('li', { class: 'empty' }, 'Sin tareas'));
}

function renderBacklog(ctx) {
  const section = document.getElementById('backlog');
  const list = backlogTasks().filter((t) => !t.done);
  const epicsOrder = new Map(state.epics.map((e, i) => [e.id, i]));
  list.sort((a, b) =>
    (epicsOrder.get(a.epic_id) ?? 1e9) - (epicsOrder.get(b.epic_id) ?? 1e9) || a.order - b.order);

  section.hidden = !list.length && !activeEpics().length;
  section.querySelector('.count').textContent = list.length ? `(${list.length})` : '';
  const ul = section.querySelector('.list');
  const cards = list.map((task) => renderCard(task, {
    ctx, draggable: true, plan: true, dim: dimmed(task),
  }));
  ul.replaceChildren(...cards);
  if (!cards.length) ul.append(h('li', { class: 'empty' }, 'Vacía · agrega tareas desde la pestaña Épicas'));
}

export function renderDay() {
  document.getElementById('day-label').textContent = dayLabel(state.viewDate);
  document.getElementById('go-today').hidden = state.viewDate === todayISO();
  const ctx = makeCtx();
  renderFilters();
  BLOCKS.forEach((block) => renderBlock(block, ctx));
  renderBacklog(ctx);
  refreshDepsMenu();
}

// ---------- Menú "Va después de…" ----------

let menu = null;

function openDepsMenu(taskId, anchor) {
  closeDepsMenu();
  menu = h('div', { class: 'menu', dataset: { taskId } });
  document.body.append(menu);
  fillDepsMenu();

  const rect = anchor.getBoundingClientRect();
  const left = Math.min(Math.max(8, rect.right - menu.offsetWidth), window.innerWidth - menu.offsetWidth - 8);
  let top = rect.bottom + 4 + window.scrollY;
  if (rect.bottom + menu.offsetHeight + 8 > window.innerHeight) {
    top = Math.max(8, rect.top - menu.offsetHeight - 4) + window.scrollY;
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.querySelector('input')?.focus();
}

/** Candidatas: tareas del mismo día + pendientes de la misma épica en otros días o la bandeja. */
function depCandidates(task) {
  const rank = (t) => (t.date === task.date ? 0 : t.date ? 1 : 2);
  return state.tasks
    .filter((o) => canDepend(task, o) && (o.date === task.date || !o.done))
    .sort((a, b) => rank(a) - rank(b)
      || (a.date || '').localeCompare(b.date || '')
      || (a.block || '').localeCompare(b.block || '')
      || a.order - b.order);
}

function fillDepsMenu() {
  const task = findTask(menu.dataset.taskId);
  if (!task) {
    closeDepsMenu();
    return;
  }
  const nodes = [h('h3', {}, `"${task.title}" va después de…`)];
  const candidates = depCandidates(task);
  if (!candidates.length) {
    nodes.push(h('div', { class: 'menu-empty' },
      task.date ? 'No hay otras tareas este día ni en su épica.' : 'No hay otras tareas en su épica.'));
  }
  for (const other of candidates) {
    const checked = task.dependencies.includes(other.id);
    const blocked = !checked && wouldCreateCycle(state.tasks, task.id, other.id);
    const where = other.date === task.date ? BLOCK_ICON[other.block] || '📥'
      : other.date ? `${shortLabel(other.date)} ${BLOCK_ICON[other.block]}` : '📥';
    const box = h('input', { type: 'checkbox', checked, disabled: blocked });
    box.addEventListener('change', () => setDependency(task.id, other.id, box.checked));
    nodes.push(h('label', {
      class: blocked ? 'disabled' : null,
      title: blocked ? `"${other.title}" ya depende de esta tarea` : null,
    }, box, h('span', {}, `${where} ${other.title}`)));
  }
  menu.replaceChildren(...nodes);
}

function refreshDepsMenu() {
  if (!menu) return;
  const index = [...menu.querySelectorAll('input')].indexOf(document.activeElement);
  fillDepsMenu();
  if (menu && index >= 0) menu.querySelectorAll('input')[index]?.focus();
}

export function closeDepsMenu() {
  menu?.remove();
  menu = null;
}

// ---------- Edición en línea ----------

function startEdit(li) {
  const task = findTask(li.dataset.id);
  if (!task || li.querySelector('.edit-input')) return;

  const titleEl = li.querySelector('.title');
  const input = h('input', { class: 'edit-input' });
  // Mismo formato del quick-add: se puede cambiar duración, certeza, bloque o épica escribiendo.
  input.value = toQuickAddText(task, findEpic(task.epic_id));
  titleEl.replaceWith(input);
  li.draggable = false;
  attachEpicAutocomplete(input, activeEpics);
  input.focus();
  input.select();

  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    const value = input.value;
    input.replaceWith(titleEl);
    if (!save || !editFromText(task.id, value)) renderDay();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

// ---------- Drag & drop ----------
// Bordes de una tarjeta = reordenar / mover. Centro = "va después de esta".

let draggingId = null;
let linkTarget = null;
let dropped = false;

export function isDayBusy() {
  return Boolean(draggingId || document.querySelector('#view-day .edit-input'));
}

function cardAfter(ul, y) {
  return [...ul.querySelectorAll('.task:not(.dragging)')].find((card) => {
    const box = card.getBoundingClientRect();
    return y < box.top + box.height / 2;
  }) || null;
}

function setLinkTarget(card, valid) {
  if (linkTarget && linkTarget !== card) linkTarget.classList.remove('link-target', 'link-invalid');
  linkTarget = card;
  if (card) {
    card.classList.toggle('link-target', valid);
    card.classList.toggle('link-invalid', !valid);
  }
}

function linkValidity(taskId, targetId) {
  const task = findTask(taskId);
  const target = findTask(targetId);
  if (!canDepend(task, target)) return 'otro día y otra épica';
  if (wouldCreateCycle(state.tasks, taskId, targetId)) return 'crearía un ciclo';
  return null;
}

function persistFromDom() {
  const lists = [...document.querySelectorAll('#view-day .list[data-list]')].map((ul) => {
    const isBacklog = ul.dataset.list === 'backlog';
    return {
      date: isBacklog ? null : state.viewDate,
      block: isBacklog ? null : ul.dataset.list,
      ids: [...ul.querySelectorAll('.task')].map((li) => li.dataset.id),
    };
  });
  applyOrder(lists);
}

function setupDragAndDrop() {
  document.querySelectorAll('#view-day .list[data-list]').forEach((ul) => {
    ul.addEventListener('dragover', (e) => {
      if (!draggingId) return;
      e.preventDefault();
      ul.classList.add('drag-over');

      const card = e.target.closest('.task:not(.dragging)');
      if (card) {
        const box = card.getBoundingClientRect();
        const rel = (e.clientY - box.top) / box.height;
        if (rel > 0.3 && rel < 0.7) {
          const problem = linkValidity(draggingId, card.dataset.id);
          setLinkTarget(card, !problem);
          card.dataset.linkProblem = problem || '';
          e.dataTransfer.dropEffect = problem ? 'none' : 'link';
          return;
        }
      }
      setLinkTarget(null);
      e.dataTransfer.dropEffect = 'move';

      const dragged = document.querySelector('.task.dragging');
      if (!dragged) return;
      ul.querySelector('.empty')?.remove();
      const after = cardAfter(ul, e.clientY);
      if (after) ul.insertBefore(dragged, after);
      else ul.append(dragged);
    });
    ul.addEventListener('dragleave', (e) => {
      if (!ul.contains(e.relatedTarget)) ul.classList.remove('drag-over');
    });
    ul.addEventListener('drop', (e) => {
      e.preventDefault();
      dropped = true;
    });
  });

  const view = document.getElementById('view-day');
  view.addEventListener('dragstart', (e) => {
    const li = e.target.closest?.('.task');
    if (!li) return;
    closeDepsMenu();
    draggingId = li.dataset.id;
    dropped = false;
    e.dataTransfer.effectAllowed = 'linkMove';
    e.dataTransfer.setData('text/plain', draggingId);
    requestAnimationFrame(() => li.classList.add('dragging'));
  });

  view.addEventListener('dragend', () => {
    if (!draggingId) return;
    const id = draggingId;
    const target = linkTarget?.classList.contains('link-target') ? linkTarget.dataset.id : null;
    draggingId = null;
    setLinkTarget(null);
    document.querySelectorAll('.list.drag-over').forEach((ul) => ul.classList.remove('drag-over'));

    if (!dropped) renderDay(); // arrastre cancelado: volver a como estaba
    else if (target) {
      if (!setDependency(id, target, true)) renderDay();
      else showToast(`"${findTask(id).title}" va después de "${findTask(target).title}".`);
    } else persistFromDom();
  });
}

// ---------- Eventos ----------

export function setupDay() {
  document.querySelectorAll('.block').forEach((section) => {
    const block = section.dataset.block;
    const form = section.querySelector('.quick-add');
    const input = form.querySelector('input');
    attachEpicAutocomplete(input, activeEpics);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (addFromText(input.value, { date: state.viewDate, block })) input.value = '';
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') input.value = '';
    });
  });

  const view = document.getElementById('view-day');
  view.addEventListener('change', (e) => {
    if (!e.target.matches('.task .check')) return;
    updateTask(e.target.closest('.task').dataset.id, { done: e.target.checked });
  });
  view.addEventListener('click', (e) => {
    const filter = e.target.closest('.chip');
    if (filter) {
      const id = filter.dataset.filter || null;
      setView({ filter: state.filter === id ? null : id });
      return;
    }
    const li = e.target.closest('.task');
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.matches('.delete')) deleteTask(id);
    else if (e.target.matches('.plan-btn')) planTask(id, e.target.dataset.block);
    else if (e.target.matches('.link')) {
      if (menu?.dataset.taskId === id) closeDepsMenu();
      else openDepsMenu(id, e.target);
    }
  });
  view.addEventListener('dblclick', (e) => {
    const li = e.target.closest('.task');
    if (li && !e.target.closest('button, input')) startEdit(li);
  });

  // Cerrar el menú al hacer clic fuera o con Escape.
  document.addEventListener('mousedown', (e) => {
    if (menu && !menu.contains(e.target) && !e.target.matches('.link')) closeDepsMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menu) closeDepsMenu();
  });

  const goTo = (iso) => {
    closeDepsMenu();
    setView({ viewDate: iso });
  };
  document.getElementById('prev-day').addEventListener('click', () => goTo(shiftDate(state.viewDate, -1)));
  document.getElementById('next-day').addEventListener('click', () => goTo(shiftDate(state.viewDate, 1)));
  document.getElementById('go-today').addEventListener('click', () => goTo(todayISO()));

  // Bandeja plegable; se recuerda abierta/cerrada en este navegador.
  const details = document.getElementById('backlog-details');
  try {
    details.open = localStorage.getItem(BACKLOG_OPEN_KEY) !== '0';
  } catch { /* sin almacenamiento: queda abierta */ }
  details.addEventListener('toggle', () => {
    try { localStorage.setItem(BACKLOG_OPEN_KEY, details.open ? '1' : '0'); } catch { /* ignorar */ }
  });

  setupDragAndDrop();
}
