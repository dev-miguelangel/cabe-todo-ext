// Vista "Hoy" (mínima): la lista de tareas del día, sin tablero (‹ › para ver otros días). Cada bloque empieza con una línea
// horizontal y a la derecha su pronóstico, nombre y horario: ───────── 85% | Mañana | 08:00 - 13:00
// Clic en el porcentaje: tooltip con el detalle del pronóstico y, si el bloque va mal, la misma
// sugerencia ("✦ Si mueves…") con su botón Mover. Un ✦ junto al % avisa que hay sugerencia.
// Arriba, un quick-add con la misma sintaxis de siempre; va al bloque en curso o al que se nombre.
// Las tareas se arrastran para reordenarlas o pasarlas a otro bloque (las reuniones tienen hora fija).

import {
  state, blockTasks, backlogTasks, overdueTasks, updateTask, toggleTimer, findTask, findEpic, addFromText, editFromText,
  activeEpics, planTask, applyOrder, ensureRoutines, applyTaskToRoutine, moveTasks,
} from '../services/store.js';
import { computeSuggestion, renderSuggestion } from '../components/suggestion.js';
import { h, attachEpicAutocomplete, showToast } from '../utils/ui.js';
import { todayISO, dayLabel, nowMinutes, toMinutes, shiftDate, shortLabel } from '../utils/dates.js';
import { formatMinutes, toQuickAddText } from '../core/parser.js';
import { scheduleBlock, criticalIds, isNowInBlock, currentBlock } from '../core/pert.js';
import { blocksOf, blockById, firstBlock } from '../core/blocks.js';
import { renderCard } from '../components/cards.js';
import { showTaskModal } from '../components/task-modal.js';
import { showSyntaxHelp } from '../components/syntax-help.js';
import { showBacklogPicker } from '../components/backlog-picker.js';
import { showUpcoming } from '../components/upcoming.js';
import { probTag } from '../components/prob-tag.js';
import { openMoveMenu, nextSlot, slotText } from '../components/move-menu.js';
import { titleCase } from '../utils/text.js';

/**
 * Pronóstico corto del bloque: { text: "85%", cls, head, detail } (con su color),
 * o null si no hay nada pendiente que pronosticar.
 */
function forecastOf(sched) {
  if (sched.pendingCount === 0) {
    return sched.items.length ? { p: null, head: 'Todo listo', detail: 'No quedan tareas pendientes en este bloque.' } : null;
  }
  const n = `${sched.pendingCount} pendiente${sched.pendingCount > 1 ? 's' : ''}`;
  if (sched.remaining <= 0) return { p: 0, head: 'El bloque ya terminó', detail: `Quedaron ${n}.` };
  const pct = Math.round(sched.probability * 100);
  return {
    p: sched.probability,
    head: `${pct}% de terminar a tiempo`,
    detail: `${n} · estimado ${formatMinutes(sched.mu)} ± ${formatMinutes(sched.sigma)} · quedan ${formatMinutes(sched.remaining)} en el bloque`,
  };
}

// Tooltip abierto con clic: 'dot:<bloque>' o 'pct:<bloque>' (se mantiene aunque la lista se re-renderice)
let openTip = null;

// ---------- Día que se está viendo ----------
// null = hoy (y sigue siendo "hoy" al pasar la medianoche); si no, 'YYYY-MM-DD'.
let pinnedDate = null;
const viewDate = () => pinnedDate || todayISO();

/** "Ahora" en minutos para el día que se ve: fin del día si ya pasó, -1 si todavía no llega. */
function nowFor(date) {
  const today = todayISO();
  if (date < today) return 24 * 60;
  if (date > today) return -1;
  return nowMinutes();
}

/** Ir a un día (desde ‹ ›, "Volver a hoy" o los próximos 7 días). */
export function goToDate(iso) {
  const today = todayISO();
  pinnedDate = iso === today ? null : iso;
  openTip = null;
  // Las rutinas de un día próximo se crean al mirarlo (si se crean, el guardado re-renderiza)
  if (!(iso > today && ensureRoutines(true, [iso]))) renderMinimal();
}

/** Avance del bloque según la hora: { pct 0–100, state 'before' | 'now' | 'after', tip: [título, detalle] }. */
function blockProgress(block, nowMin) {
  const start = toMinutes(block.start);
  const end = toMinutes(block.end);
  const length = formatMinutes(end - start);
  if (nowMin < 0) return { pct: 0, state: 'before', tip: [`${block.start} – ${block.end}`, `dura ${length}`] }; // otro día, futuro
  if (nowMin < start) {
    return { pct: 0, state: 'before', tip: [`Empieza en ${formatMinutes(start - nowMin)}`, `a las ${block.start} · dura ${length}`] };
  }
  if (nowMin >= end) {
    return { pct: 100, state: 'after', tip: ['Bloque terminado', `terminó a las ${block.end} · duró ${length}`] };
  }
  const pct = ((nowMin - start) / (end - start)) * 100;
  return {
    pct,
    state: 'now',
    tip: [`Quedan ${formatMinutes(end - nowMin)}`, `de ${length} · termina a las ${block.end} · ${Math.round(pct)}% transcurrido`],
  };
}

/**
 * Línea con lo transcurrido del bloque y un punto en "ahora", más el tooltip del punto
 * (va en la fila, no en la línea: así nunca se sale por los bordes del panel).
 */
function blockLine(block, nowMin) {
  const p = blockProgress(block, nowMin);
  const tipId = `dot-tip-${block.id}`;
  const line = h('span', { class: `done-line block-line ${p.state}`, style: `--pct:${p.pct.toFixed(2)}%` },
    h('span', { class: 'block-line-fill', 'aria-hidden': 'true' }),
    h('button', {
      type: 'button',
      class: `block-dot${openTip === `dot:${block.id}` ? ' open' : ''}`,
      dataset: { tip: `dot:${block.id}` },
      'aria-label': `${block.title}: ${p.tip[0]}`,
      'aria-describedby': tipId,
      'aria-expanded': String(openTip === `dot:${block.id}`),
    }));
  const tip = h('span', { class: `dot-tip ${p.state}`, id: tipId, role: 'tooltip' },
    h('strong', {}, p.tip[0]),
    h('span', {}, p.tip[1]));
  return [line, tip];
}

/** Tooltip del porcentaje: detalle del pronóstico y, si hay, la sugerencia para mejorarlo. */
function forecastTip(block, fc, sug) {
  const tipId = `pct-tip-${block.id}`;
  const box = h('div', { class: 'pct-tip', id: tipId, role: 'dialog', 'aria-label': `Pronóstico de ${block.title}` },
    h('strong', {}, fc.head),
    h('span', {}, fc.detail));
  if (sug) {
    const suggestion = h('div', { class: 'suggestion pct-suggestion' });
    renderSuggestion(suggestion, sug);
    box.append(suggestion);
  }
  return box;
}

/**
 * Bloque terminado con tareas sin hacer: una línea discreta para moverlas todas
 * al siguiente bloque que sigue abierto o al día siguiente. (Las reuniones no se mueven.)
 */
function endedRow(block, items, date) {
  const left = items.map((i) => i.task).filter((t) => !t.done && !t.meeting);
  if (!left.length || !(date <= todayISO())) return null;
  const next = nextSlot(date, block.id);
  const tomorrow = { date: shiftDate(todayISO(), 1), block: firstBlock(state.settings).id };
  const slots = [next];
  if (next.date !== tomorrow.date || next.block !== tomorrow.block) slots.push(tomorrow);
  const ids = left.map((t) => t.id).join(',');
  return h('li', { class: 'ended-row', dataset: { block: block.id } },
    h('span', {}, `${left.length} sin terminar`),
    ...slots.map((s) => h('button', {
      type: 'button', class: 'ended-move link-btn', dataset: { ids, date: s.date, block: s.block },
      title: `Mover ${left.length === 1 ? 'la pendiente' : `las ${left.length} pendientes`} a ${slotText(s, date)}`,
    }, `→ ${slotText(s, date)}`)));
}

/** ───────── ✦ 85% | Mañana | 08:00 - 13:00 */
function blockDivider(block, now, sched, nowMin, sug) {
  const fc = forecastOf(sched);
  const key = `pct:${block.id}`;
  const parts = [];
  if (fc) {
    // Etiqueta de probabilidad (✓ si ya no queda nada); clic = detalle y sugerencia
    const attrs = {
      type: 'button',
      dataset: { tip: key },
      'aria-expanded': String(openTip === key),
      'aria-controls': `pct-tip-${block.id}`,
    };
    const cls = `minimal-pct${sug ? ' has-tip' : ''}${openTip === key ? ' open' : ''}`;
    const tag = fc.p === null
      ? h('button', { ...attrs, class: `prob-tag good ${cls}`, 'aria-label': 'Todo listo', dataset: { tip: key, tooltip: 'Todo listo' } }, '✓')
      : probTag(fc.p, { tag: 'button', class: cls, prefix: sug ? '✦ ' : '', attrs });
    parts.push(tag, ' | ');
  }
  parts.push(`${titleCase(block.title)} | ${block.start} - ${block.end}`);
  return h('li', { class: `done-divider block-divider${now ? ' is-now' : ''}`, dataset: { block: block.id } },
    ...blockLine(block, nowMin),
    h('span', { class: 'done-date', title: now ? 'Bloque en curso' : null }, ...parts),
    fc ? forecastTip(block, fc, sug) : null);
}

export function renderMinimal() {
  const today = viewDate(); // el día que se ve (se llama "today" por costumbre del resto del código)
  const isToday = today === todayISO();
  document.getElementById('minimal-day').textContent = dayLabel(today);
  document.getElementById('minimal-today').hidden = isToday;
  const ctx = {
    allTasks: state.tasks,
    byId: new Map(state.tasks.map((t) => [t.id, t])),
    epicsById: new Map(state.epics.map((e) => [e.id, e])),
    critical: criticalIds(state.tasks),
  };
  const nowMin = nowFor(today);
  const schedNow = nowMin < 0 ? null : nowMin; // día futuro: el bloque se pronostica completo
  let pending = 0;
  let total = 0;
  const nodes = blocksOf(state.settings).flatMap((block) => {
    const list = blockTasks(block.id, today);
    // Mismo orden que el tablero (dependencias y reuniones por horario)
    const sched = scheduleBlock(list, block, schedNow);
    const { items } = sched;
    total += items.length;
    pending += items.filter((i) => !i.task.done).length;
    const now = isToday && isNowInBlock(block);
    const blockEnded = sched.remaining <= 0;
    const cards = items.map((item) => renderCard(item.task, { ctx, item, blockEnded, draggable: true, move: true }));
    if (now) cards.find((li) => !li.classList.contains('done'))?.classList.add('current');
    // Sugerencia para mejorar el bloque (si ya terminó no hay nada que reacomodar)
    const sug = sched.remaining > 0 ? computeSuggestion(block.id, ctx, today) : null;
    return [blockDivider(block, now, sched, nowMin, sug), blockEnded ? endedRow(block, items, today) : null,
      ...(cards.length ? cards : [h('li', { class: 'minimal-empty' }, 'Sin tareas')])].filter(Boolean);
  });
  document.getElementById('minimal-count').textContent = total
    ? `${pending} pendiente${pending === 1 ? '' : 's'} de ${total}`
    : `Nada planificado para ${isToday ? 'hoy' : 'este día'}`;
  document.getElementById('minimal-list').replaceChildren(...nodes);

  // A dónde va una tarea si no se nombra un bloque (en el placeholder, sin texto extra)
  const target = blockById(state.settings, isToday ? currentBlock(state.settings) : firstBlock(state.settings).id);
  document.querySelector('#minimal-add input').placeholder = isToday
    ? `+ Nueva tarea en ${target.title}`
    : `+ Nueva tarea para el ${shortLabel(today)}`;

  // Cuántas tareas esperan en el backlog o quedaron de días anteriores (en el botón que las trae a hoy)
  const inBacklog = backlogTasks().filter((t) => !t.done).length + overdueTasks(todayISO()).length;
  const badge = document.getElementById('backlog-count');
  badge.hidden = !inBacklog;
  badge.textContent = inBacklog > 99 ? '99+' : String(inBacklog);
  document.getElementById('backlog-picker-btn').title = inBacklog
    ? `${inBacklog} tarea${inBacklog === 1 ? '' : 's'} pendiente${inBacklog === 1 ? '' : 's'} para pasar a ${isToday ? 'hoy' : 'este día'} (backlog y días anteriores)`
    : 'Nada pendiente fuera de hoy';
}

// ---------- Drag & drop: reordenar y mover entre bloques ----------

let dragId = null;
let dropped = false;
let clickTimer = null;

/** ¿Hay un arrastre o una edición en curso? (el panel no re-renderiza mientras tanto) */
export function isMinimalBusy() {
  return Boolean(dragId || document.querySelector('#minimal-list .edit-input'));
}

// ---------- Edición en línea (doble clic): mismo formato del quick-add ----------

function startEdit(li) {
  const task = findTask(li.dataset.id);
  if (!task || li.querySelector('.edit-input')) return;
  const titleEl = li.querySelector('.title');
  const input = h('input', { class: 'edit-input', 'aria-label': 'Editar tarea' });
  // Se puede cambiar título, duración, certeza, bloque, día o épica escribiendo
  input.value = toQuickAddText(task, findEpic(task.epic_id));
  titleEl.replaceWith(input);
  li.draggable = false;
  attachEpicAutocomplete(input, activeEpics);
  input.focus();
  input.select();

  const snapshot = (t) => JSON.stringify([t.title, t.minutes, t.certainty, t.epic_id, t.block, t.meeting]);
  const before = snapshot(task);
  let finished = false;
  const finish = (save) => {
    if (finished) return;
    finished = true;
    const value = input.value;
    input.replaceWith(titleEl);
    if (!save || !editFromText(task.id, value)) {
      renderMinimal();
      return;
    }
    // Tarea de una rutina: el cambio es solo de este día, salvo que se aplique a todas
    const now = findTask(task.id);
    if (now?.routine_id && snapshot(now) !== before) {
      showToast(`Cambiaste "${now.title}" solo este día.`, {
        label: 'Aplicar a todas',
        run: () => { applyTaskToRoutine(now.id); showToast(`Listo: las próximas "${now.title}" quedan igual.`); },
      });
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

/** Guarda el orden de la lista tal como quedó: cada tarea pertenece al bloque del separador anterior. */
function persistOrder(list) {
  const lists = [];
  for (const li of list.children) {
    if (li.classList.contains('block-divider')) lists.push({ date: viewDate(), block: li.dataset.block, ids: [] });
    else if (li.classList.contains('task') && lists.length) lists.at(-1).ids.push(li.dataset.id);
  }
  applyOrder(lists);
}

function setupDragAndDrop(list) {
  list.addEventListener('dragstart', (e) => {
    const li = e.target.closest?.('.task');
    if (!li) return;
    dragId = li.dataset.id;
    dropped = false;
    list.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    requestAnimationFrame(() => li.classList.add('dragging'));
  });
  list.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const dragged = list.querySelector(`.task[data-id="${CSS.escape(dragId)}"]`);
    const over = e.target.closest('li');
    if (!dragged || !over || over === dragged || over.parentElement !== list) return;
    if (over.classList.contains('block-divider')) {
      // Sobre la línea de un bloque: al principio de ese bloque
      over.after(dragged);
    } else if (over.classList.contains('minimal-empty')) {
      over.before(dragged);
    } else if (over.classList.contains('task')) {
      const box = over.getBoundingClientRect();
      if (e.clientY < box.top + box.height / 2) over.before(dragged);
      else over.after(dragged);
    }
    // Bloques que quedan vacíos / se llenan mientras se arrastra
    list.querySelectorAll('.minimal-empty').forEach((empty) => {
      const prev = empty.previousElementSibling;
      empty.hidden = Boolean(prev && prev.classList.contains('task'));
    });
  });
  list.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    dropped = true;
  });
  list.addEventListener('dragend', () => {
    if (!dragId) return;
    dragId = null;
    list.classList.remove('is-dragging');
    list.querySelectorAll('.task.dragging').forEach((li) => li.classList.remove('dragging'));
    if (dropped) persistOrder(list); // guarda y re-renderiza
    else renderMinimal(); // arrastre cancelado: volver a como estaba
  });
}

export function setupMinimal() {
  const form = document.getElementById('minimal-add');
  const input = form.querySelector('input');
  attachEpicAutocomplete(input, activeEpics);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    // El día que se ve (hoy: en el bloque en curso; otro día: en el primero);
    // "… tarde", "@gym", "am"/"pm", "mañana" o "viernes" lo cambian
    const date = viewDate();
    const block = date === todayISO() ? currentBlock(state.settings) : firstBlock(state.settings).id;
    const task = addFromText(input.value, { date, block });
    if (task) input.value = '';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') input.value = '';
  });
  document.getElementById('syntax-help-btn').addEventListener('click', showSyntaxHelp);
  document.getElementById('backlog-picker-btn').addEventListener('click', () => showBacklogPicker(viewDate()));
  document.getElementById('upcoming-btn').addEventListener('click', () => showUpcoming(goToDate));
  document.getElementById('minimal-prev').addEventListener('click', () => goToDate(shiftDate(viewDate(), -1)));
  document.getElementById('minimal-next').addEventListener('click', () => goToDate(shiftDate(viewDate(), 1)));
  document.getElementById('minimal-today').addEventListener('click', () => goToDate(todayISO()));

  const list = document.getElementById('minimal-list');
  setupDragAndDrop(list);
  list.addEventListener('change', (e) => {
    if (e.target.matches('.task .check')) updateTask(e.target.closest('.task').dataset.id, { done: e.target.checked });
  });
  // Tooltips del punto de avance y del porcentaje: clic abre/cierra (uno a la vez);
  // clic fuera o Escape los cierra. El del punto también se ve al pasar el mouse.
  const closeTips = () => {
    openTip = null;
    list.querySelectorAll('[data-tip].open').forEach((b) => { b.classList.remove('open'); b.setAttribute('aria-expanded', 'false'); });
  };
  document.addEventListener('click', (e) => {
    if (openTip && !e.target.closest('[data-tip], .pct-tip')) closeTips();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openTip) closeTips();
  });
  list.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-tip]');
    if (opener) {
      const key = opener.dataset.tip;
      const wasOpen = openTip === key;
      closeTips();
      if (!wasOpen) {
        openTip = key;
        opener.classList.add('open');
        opener.setAttribute('aria-expanded', 'true');
      }
      return;
    }
    const endedMove = e.target.closest('.ended-move');
    if (endedMove) {
      const ids = endedMove.dataset.ids.split(',');
      moveTasks(ids, endedMove.dataset.date, endedMove.dataset.block);
      showToast(`${ids.length} tarea${ids.length === 1 ? '' : 's'} → ${endedMove.textContent.replace('→ ', '')}.`);
      return;
    }
    const moveBtn = e.target.closest('.move-btn');
    if (moveBtn) {
      clearTimeout(clickTimer);
      openMoveMenu(moveBtn.closest('.task').dataset.id, moveBtn);
      return;
    }
    const suggest = e.target.closest('.suggest-btn');
    if (suggest) {
      closeTips();
      planTask(suggest.dataset.task, suggest.dataset.block, suggest.dataset.date);
      showToast(`"${findTask(suggest.dataset.task).title}" se movió.`);
      return;
    }
    const li = e.target.closest('.task');
    if (!li) return;
    const id = li.dataset.id;
    if (e.target.matches('.timer-btn')) {
      // Las reuniones no se pausan: el chip abre el detalle (Finalizar / Reprogramar)
      const task = findTask(id);
      if (task?.meeting && task.time_entries.at(-1)?.end === null) showTaskModal(id);
      else toggleTimer(id);
      return;
    }
    if (!e.target.closest('button, input, textarea')) {
      // Clic = detalle (espera un instante: si es doble clic, se edita en línea)
      clearTimeout(clickTimer);
      clickTimer = setTimeout(() => showTaskModal(id), 220);
    }
  });
  list.addEventListener('dblclick', (e) => {
    clearTimeout(clickTimer);
    const li = e.target.closest('.task');
    if (li && !e.target.closest('button, input')) startEdit(li);
  });
}
