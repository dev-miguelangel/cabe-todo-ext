// Vista "Hoy": bloques AM/PM, filtro por épica, bandeja, dependencias y drag & drop.

import { formatMinutes } from './parser.js';
import { scheduleBlock, isNowInBlock, criticalIds, wouldCreateCycle, canDepend, suggestMove } from './pert.js';
import { todayISO, shiftDate, dayLabel, shortLabel, nowMinutes, toMinutes } from './dates.js';
import {
  state, setView, findTask, findEpic, activeEpics, blockTasks, dayTasks, calibrationInfo, backlogTasks, overdueTasks,
  addFromText, editFromText, updateTask, setDependency, planTask, planMany, unplanTask, unplanMany, applyOrder,
  toggleTimer,
} from './store.js';
import { h, showToast, attachEpicAutocomplete } from './ui.js';
import { renderCard, updateTimerChip } from './cards.js';
import { trackedMs } from './timer.js';
import { showTaskModal } from './task-modal.js';
import { toQuickAddText } from './parser.js';

const BLOCKS = ['am', 'pm'];
const BLOCK_ICON = { am: '☀︎', pm: '☾' };
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
    allTasks: state.tasks,
    byId: new Map(state.tasks.map((t) => [t.id, t])),
    epicsById: new Map(state.epics.map((e) => [e.id, e])),
    critical: criticalIds(state.tasks),
    planDate: state.viewDate,
  };
}

const BLOCK_LABEL = { am: 'la mañana', pm: 'la tarde' };

/**
 * Si el bloque va mal (< 50%), sugiere mover una tarea al otro bloque del mismo día
 * o a la mañana del día siguiente. Nunca sugiere mover tareas de las que otra depende.
 */
function computeSuggestion(block, ctx) {
  if (state.viewDate < todayISO()) return null;
  const nowMin = nowMinutesFor(state.viewDate);
  const other = block === 'am' ? 'pm' : 'am';
  const next = shiftDate(state.viewDate, 1);
  const targets = [];
  if (scheduleBlock([], state.settings[other], nowMin).remaining > 0) {
    targets.push({
      date: state.viewDate, block: other, label: `a ${BLOCK_LABEL[other]}`,
      tasks: blockTasks(other), range: state.settings[other], nowMin,
    });
  }
  targets.push({
    date: next, block: 'am', label: `al ${shortLabel(next)} en la mañana`,
    tasks: blockTasks('am', next), range: state.settings.am, nowMin: null,
  });

  const canMove = (task, target) => {
    // A otro día: solo tareas sueltas (sus dependencias del día dejarían de valer).
    if (target.date !== task.date) return task.dependencies.length === 0;
    // De la tarde a la mañana: no si algo de lo que depende está en la tarde.
    if (target.block === 'am') {
      return !task.dependencies.some((id) => ctx.byId.get(id)?.date === task.date && ctx.byId.get(id)?.block === 'pm');
    }
    return true;
  };

  return suggestMove(
    { tasks: blockTasks(block), range: state.settings[block], nowMin },
    targets,
    { critical: ctx.critical, canMove },
  );
}

// ---------- Aviso de sobrecarga al agregar ----------

const OVERLOAD_BELOW = 0.5;
const pctText = (p) => `${Math.round(p * 100)} %`;

/** Probabilidad actual del bloque del día que se ve (without: sin contar la última tarea agregada). */
function probabilityOf(block, without = false) {
  let list = blockTasks(block);
  if (without) list = list.slice(0, -1);
  return scheduleBlock(list, state.settings[block], nowMinutesFor(state.viewDate)).probability;
}

/**
 * Si la tarea recién agregada deja su bloque bajo 50 % (y antes no lo estaba), ofrecer
 * en el mismo momento llevarla a donde sí cabe: el otro bloque de hoy o mañana en la mañana.
 */
function warnIfOverloaded(task, before) {
  if (!task.date || !task.block || state.viewDate < todayISO()) return;
  const after = probabilityOf(task.block);
  if (after === null || after >= OVERLOAD_BELOW || (before !== null && before !== undefined && before < OVERLOAD_BELOW)) return;

  const nowMin = nowMinutesFor(state.viewDate);
  const other = task.block === 'am' ? 'pm' : 'am';
  const next = shiftDate(state.viewDate, 1);
  const options = [];
  if (other === 'pm' && scheduleBlock([], state.settings.pm, nowMin).remaining > 0) {
    options.push({ date: state.viewDate, block: 'pm', label: 'a la tarde', range: state.settings.pm, nowMin, tasks: blockTasks('pm') });
  }
  options.push({ date: next, block: 'am', label: `el ${shortLabel(next).split(' ')[0]} en la mañana`, range: state.settings.am, nowMin: null, tasks: blockTasks('am', next) });

  const moved = { ...task, order: Number.MAX_SAFE_INTEGER, dependencies: [] };
  const fit = options
    .filter((o) => !(o.date === task.date && o.block === task.block))
    .map((o) => ({ ...o, p: scheduleBlock([...o.tasks, moved], o.range, o.nowMin).probability }))
    .find((o) => o.p !== null && o.p >= OVERLOAD_BELOW);

  const where = BLOCK_LABEL[task.block];
  if (!fit) {
    showToast(`Con "${task.title}", ${where} queda en ${pctText(after)}.`);
    return;
  }
  showToast(`Con "${task.title}", ${where} queda en ${pctText(after)}. ${fit.label[0].toUpperCase()}${fit.label.slice(1)} cabe (${pctText(fit.p)}).`, {
    label: 'Mover',
    run: () => {
      planTask(task.id, fit.block, fit.date);
      showToast(`"${task.title}" → ${fit.date === state.viewDate ? BLOCK_LABEL[fit.block] : `${shortLabel(fit.date)}, en la mañana`}.`);
    },
  });
}

function renderSuggestion(el, sug) {
  el.hidden = !sug;
  if (!sug) return;
  const pct = (p) => `${Math.round(p * 100)}%`;
  el.replaceChildren(
    h('span', {}, `✦ Si mueves "${sug.task.title}" (${formatMinutes(sug.task.minutes)}) ${sug.target.label}, este bloque sube de ${pct(sug.before)} a ${pct(sug.sourceProbability)}.`),
    h('button', {
      class: 'suggest-btn',
      dataset: { task: sug.task.id, date: sug.target.date, block: sug.target.block },
      title: `El destino quedaría en ${pct(sug.targetProbability)}`,
    }, 'Mover'),
  );
}

/**
 * Próximo bloque que todavía no termina, contando desde ahora:
 * la mañana de hoy, la tarde de hoy o la mañana del día siguiente.
 */
function nextOpenBlock() {
  const today = todayISO();
  const now = nowMinutes();
  let target;
  if (now < toMinutes(state.settings.am.end)) target = { date: today, block: 'am' };
  else if (now < toMinutes(state.settings.pm.end)) target = { date: today, block: 'pm' };
  else target = { date: shiftDate(today, 1), block: 'am' };
  const isToday = target.date === today;
  return {
    ...target,
    label: isToday ? `→ ${target.block.toUpperCase()}` : `→ ${shortLabel(target.date).split(' ')[0]} ${target.block.toUpperCase()}`,
    title: isToday ? `Mover a ${BLOCK_LABEL[target.block]} de hoy` : `Mover al ${shortLabel(target.date)}, en ${BLOCK_LABEL[target.block]}`,
  };
}

/** Barra del bloque terminado: mover todas las pendientes de una vez. */
function renderEndedBar(el, block, pending, next) {
  el.hidden = !pending.length;
  if (!pending.length) return;
  el.replaceChildren(
    h('span', {}, 'Bloque terminado'),
    h('button', { class: 'ended-all', dataset: { all: 'next', block }, title: next.title }, `Todo ${next.label}`),
    h('button', { class: 'ended-all', dataset: { all: 'backlog', block }, title: 'Enviar todas al backlog' }, 'Todo ⤓'),
  );
}

// ---------- Cierre del día ----------

/** ¿Ya terminó la tarde de hoy (y hay algo que cerrar)? */
function dayIsClosing() {
  return state.viewDate === todayISO()
    && nowMinutes() >= toMinutes(state.settings.pm.end)
    && dayTasks().length > 0;
}

/** Resumen al terminar la tarde: hecho, pendiente, real vs estimado y mover lo pendiente a mañana. */
function renderDayClose() {
  const section = document.getElementById('day-close');
  section.hidden = !dayIsClosing();
  if (section.hidden) return;

  const work = dayTasks().filter((t) => !t.meeting);
  const done = work.filter((t) => t.done);
  const pending = work.filter((t) => !t.done);
  const timed = done.filter((t) => trackedMs(t) >= 60000);
  const real = timed.reduce((sum, t) => sum + trackedMs(t) / 60000, 0);
  const planned = timed.reduce((sum, t) => sum + t.minutes, 0);
  const tomorrow = shiftDate(state.viewDate, 1);
  const tomorrowLabel = shortLabel(tomorrow).split(' ')[0];

  const lines = [h('h2', {}, '☾ Cierre del día')];
  lines.push(h('p', { class: 'close-stat' },
    h('span', { class: 'close-done' }, `✓ ${done.length} de ${work.length} hecha${work.length === 1 ? '' : 's'}`),
    timed.length ? h('span', {
      class: 'close-time',
      title: `Tiempo registrado en ${timed.length} tarea${timed.length === 1 ? '' : 's'} terminada${timed.length === 1 ? '' : 's'}, contra lo que estimaste para ellas`,
    }, ` · real ${formatMinutes(Math.round(real))} / estimado ${formatMinutes(planned)}`) : null));

  if (pending.length) {
    const left = pending.reduce((sum, t) => sum + t.minutes, 0);
    lines.push(h('div', { class: 'close-pending' },
      h('span', {}, `${pending.length} pendiente${pending.length === 1 ? '' : 's'} · ${formatMinutes(left)}`),
      h('span', { class: 'close-actions' },
        h('button', {
          class: 'close-btn primary', dataset: { close: 'next' },
          title: `Mover las pendientes al ${shortLabel(tomorrow)}, en la mañana`,
        }, `Todo → ${tomorrowLabel} AM`),
        h('button', { class: 'close-btn', dataset: { close: 'backlog' }, title: 'Enviar las pendientes al backlog' }, 'Todo ⤓'))));
  } else {
    lines.push(h('p', { class: 'close-clear' }, 'Nada pendiente. Buen día ✓'));
  }

  const { factor, samples } = calibrationInfo;
  const pct = Math.round(Math.abs(factor - 1) * 100);
  if (samples >= 3 && pct >= 5) {
    lines.push(h('p', { class: 'close-learn', title: `Según tus últimas ${samples} tareas con tiempo registrado (Ajustes)` },
      state.settings.calibrate === false
        ? `✦ Sueles tardar ~${pct} % ${factor > 1 ? 'más' : 'menos'} de lo que estimas. Puedes activar el ajuste en Ajustes.`
        : `✦ Sueles tardar ~${pct} % ${factor > 1 ? 'más' : 'menos'} de lo que estimas: el pronóstico de mañana ya lo considera.`));
  }
  section.replaceChildren(...lines);
}

function renderOverdue(ctx) {
  const section = document.getElementById('overdue');
  const today = todayISO();
  const list = state.viewDate === today ? overdueTasks(today) : [];
  section.hidden = !list.length;
  if (!list.length) {
    section.querySelector('.list').replaceChildren();
    return;
  }
  list.sort((a, b) => a.date.localeCompare(b.date) || a.block.localeCompare(b.block) || a.order - b.order);
  section.querySelector('.count').textContent = `(${list.length})`;
  section.querySelector('.list').replaceChildren(...list.map((task) => renderCard(task, {
    ctx, draggable: true, plan: true, unplan: true, when: true, dim: dimmed(task),
  })));
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

/** Pronóstico compacto para el encabezado del bloque; la frase completa va en el tooltip. */
function renderForecast(el, sched) {
  el.className = 'forecast';
  el.title = '';
  if (sched.pendingCount === 0) {
    el.textContent = sched.items.length ? '✓ listo' : '';
    if (sched.items.length) el.classList.add('good');
    return;
  }
  if (sched.remaining <= 0) {
    el.textContent = `◷ ${sched.pendingCount} pendiente${sched.pendingCount > 1 ? 's' : ''}`;
    el.title = 'El bloque ya terminó';
    el.classList.add('bad');
    return;
  }
  const pct = Math.round(sched.probability * 100);
  const [icon, cls] = sched.probability >= 0.8 ? ['✓', 'good'] : sched.probability >= 0.5 ? ['◐', 'warn'] : ['⚠︎', 'bad'];
  el.textContent = `${icon} ${pct}%`;
  el.classList.add(cls);
  el.title = `${pct}% de probabilidad de terminar a tiempo\nEstimado ${formatMinutes(sched.mu)} ± ${formatMinutes(sched.sigma)} · quedan ${formatMinutes(sched.remaining)} en el bloque`;
}

/** "2h Lanzar web · 1h sin épica" (para el tooltip de la barra). */
function epicSummary(list, ctx) {
  const groups = new Map();
  for (const t of list) groups.set(t.epic_id, (groups.get(t.epic_id) || 0) + t.minutes);
  if (![...groups.keys()].some((id) => id && ctx.epicsById.has(id))) return '';
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null) - (b === null))
    .map(([id, minutes]) => `${formatMinutes(minutes)} ${ctx.epicsById.get(id)?.name || 'sin épica'}`)
    .join(' · ');
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
  const planned = sched.doneMinutes + sched.meetingMinutes + sched.mu;
  const scale = Math.max(sched.capacity, planned) || 1;
  const over = sched.mu > sched.remaining && sched.pendingCount > 0;
  section.classList.toggle('over', over);
  const cap = section.querySelector('.capacity');
  cap.querySelector('.bar-done').style.width = `${(sched.doneMinutes / scale) * 100}%`;
  cap.querySelector('.bar-meeting').style.width = `${(sched.meetingMinutes / scale) * 100}%`;
  cap.querySelector('.bar-pending').style.width = `${(sched.mu / scale) * 100}%`;
  const label = section.querySelector('.capacity-label');
  label.textContent = `${formatMinutes(planned)} / ${formatMinutes(sched.capacity)}`;
  const summary = epicSummary(list, ctx);
  label.title = cap.title = [
    over ? `Te faltan ${formatMinutes(sched.mu - sched.remaining)} (estimado PERT)`
      : `Libre: ${formatMinutes(sched.remaining - sched.mu)} (estimado PERT)`,
    sched.meetingMinutes ? `Reuniones que bloquean: ${formatMinutes(sched.meetingMinutes)}` : '',
    summary,
  ].filter(Boolean).join('\n');

  renderForecast(section.querySelector('.forecast'), sched);

  // Bloque terminado con pendientes: ofrecer moverlas en vez de sugerir reacomodos.
  const ended = sched.remaining <= 0 && sched.pendingCount > 0;
  const next = ended ? nextOpenBlock() : null;
  const closing = dayIsClosing(); // el cierre del día ya ofrece mover todo
  renderEndedBar(section.querySelector('.ended-bar'), block, ended && !closing ? list.filter((t) => !t.done && !t.meeting) : [], next);
  renderSuggestion(section.querySelector('.suggestion'), ended ? null : computeSuggestion(block, ctx));

  const ul = section.querySelector('.list');
  const cards = sched.items.map((item) => renderCard(item.task, {
    ctx, item, draggable: true, dim: dimmed(item.task), ended: next,
  }));
  if (now) cards.find((li) => !li.classList.contains('done'))?.classList.add('current');
  ul.replaceChildren(...cards);
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
  if (!cards.length) ul.append(h('li', { class: 'empty' }, 'Vacío · arrastra aquí lo que quieras dejar para después'));
}

export function renderDay() {
  document.getElementById('day-label').textContent = dayLabel(state.viewDate);
  document.getElementById('go-today').hidden = state.viewDate === todayISO();
  const ctx = makeCtx();
  renderFilters();
  renderOverdue(ctx);
  renderDayClose();
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
    const where = other.date === task.date ? BLOCK_ICON[other.block] || '⤓'
      : other.date ? `${shortLabel(other.date)} ${BLOCK_ICON[other.block]}` : '⤓';
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

let detailClickTimer = null;
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
    document.body.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'linkMove';
    e.dataTransfer.setData('text/plain', draggingId);
    requestAnimationFrame(() => li.classList.add('dragging'));
  });

  view.addEventListener('dragend', () => {
    if (!draggingId) return;
    const id = draggingId;
    const target = linkTarget?.classList.contains('link-target') ? linkTarget.dataset.id : null;
    draggingId = null;
    document.body.classList.remove('is-dragging');
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
      const before = block && probabilityOf(block);
      const task = addFromText(input.value, { date: state.viewDate, block });
      if (!task) return;
      input.value = '';
      warnIfOverloaded(task, task.block === block ? before : probabilityOf(task.block, true));
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
    const suggest = e.target.closest('.suggest-btn');
    if (suggest) {
      planTask(suggest.dataset.task, suggest.dataset.block, suggest.dataset.date);
      showToast(`"${findTask(suggest.dataset.task).title}" se movió.`);
      return;
    }
    const bulk = e.target.closest('[data-bulk]');
    if (bulk) {
      const today = todayISO();
      planMany(overdueTasks(today).map((t) => t.id), bulk.dataset.bulk, today);
      return;
    }
    const close = e.target.closest('.close-btn');
    if (close) {
      const ids = dayTasks().filter((t) => !t.done && !t.meeting).map((t) => t.id);
      if (!ids.length) return;
      const n = `${ids.length} tarea${ids.length > 1 ? 's' : ''}`;
      if (close.dataset.close === 'backlog') {
        unplanMany(ids);
        showToast(`${n} al backlog.`);
      } else {
        const tomorrow = shiftDate(state.viewDate, 1);
        planMany(ids, 'am', tomorrow);
        showToast(`${n} → ${shortLabel(tomorrow)}, en la mañana.`);
      }
      return;
    }
    const all = e.target.closest('.ended-all');
    if (all) {
      const ids = blockTasks(all.dataset.block).filter((t) => !t.done && !t.meeting).map((t) => t.id);
      if (all.dataset.all === 'backlog') {
        unplanMany(ids);
        showToast(`${ids.length} tarea${ids.length > 1 ? 's' : ''} al backlog.`);
      } else {
        const next = nextOpenBlock();
        planMany(ids, next.block, next.date);
        showToast(`${ids.length} tarea${ids.length > 1 ? 's' : ''} movida${ids.length > 1 ? 's' : ''}: ${next.title.replace('Mover ', '')}.`);
      }
      return;
    }
    const filter = e.target.closest('.chip');
    if (filter) {
      const id = filter.dataset.filter || null;
      setView({ filter: state.filter === id ? null : id });
      return;
    }
    const li = e.target.closest('.task');
    if (!li) return;
    const id = li.dataset.id;
    if (!e.target.closest('button, input, textarea')) {
      // Clic simple = detalle (espera un instante: si es doble clic, se edita en línea)
      clearTimeout(detailClickTimer);
      detailClickTimer = setTimeout(() => showTaskModal(id), 220);
      return;
    }
    if (e.target.matches('.timer-btn')) {
      // Las reuniones no se pausan: el chip abre el detalle (Finalizar / Reprogramar)
      if (findTask(id)?.meeting && findTask(id).time_entries.at(-1)?.end === null) showTaskModal(id);
      else toggleTimer(id);
    }
    else if (e.target.matches('.plan-btn')) planTask(id, e.target.dataset.block);
    else if (e.target.matches('.unplan, .backlog-btn')) {
      unplanTask(id);
      showToast(`"${findTask(id).title}" al backlog.`);
    } else if (e.target.matches('.next-btn')) {
      planTask(id, e.target.dataset.block, e.target.dataset.date);
      showToast(`"${findTask(id).title}" movida: ${e.target.title.replace('Mover ', '')}.`);
    }
    else if (e.target.matches('.link')) {
      if (menu?.dataset.taskId === id) closeDepsMenu();
      else openDepsMenu(id, e.target);
    }
  });
  view.addEventListener('dblclick', (e) => {
    clearTimeout(detailClickTimer); // doble clic = editar, no abrir el modal
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
    details.open = localStorage.getItem(BACKLOG_OPEN_KEY) === '1';
  } catch { /* sin almacenamiento: queda abierta */ }
  details.addEventListener('toggle', () => {
    try { localStorage.setItem(BACKLOG_OPEN_KEY, details.open ? '1' : '0'); } catch { /* ignorar */ }
  });

  setupDragAndDrop();

  // Los chips de temporizador se actualizan solos (sin re-renderizar todo): el tiempo de los que
  // corren y el bloqueo de los pausados cuando una reunión que bloquea empieza o termina.
  setInterval(() => {
    document.querySelectorAll('.timer-btn:not([hidden])').forEach((chip) => {
      const task = findTask(chip.closest('.task')?.dataset.id);
      if (task) updateTimerChip(chip, task, state.tasks);
    });
  }, 5 * 1000);
}
