// Vista "Hoy" (mínima): la lista de tareas de hoy, sin tablero. Cada bloque empieza con una línea
// horizontal y a la derecha su pronóstico, nombre y horario: ───────── 85% | Mañana | 08:00 - 13:00
// Clic en el porcentaje: tooltip con el detalle del pronóstico y, si el bloque va mal, la misma
// sugerencia de Plan ("✦ Si mueves…") con su botón Mover. Un ✦ junto al % avisa que hay sugerencia.
// Arriba, un quick-add con la misma sintaxis de siempre; va al bloque en curso o al que se nombre.
// Las tareas se arrastran para reordenarlas o pasarlas a otro bloque (las reuniones tienen hora fija).

import { state, blockTasks, backlogTasks, updateTask, toggleTimer, findTask, addFromText, activeEpics, planTask, applyOrder } from '../services/store.js';
import { computeSuggestion, renderSuggestion } from './day-view.js';
import { h, attachEpicAutocomplete, showToast } from '../utils/ui.js';
import { todayISO, dayLabel, nowMinutes, toMinutes } from '../utils/dates.js';
import { formatMinutes } from '../core/parser.js';
import { scheduleBlock, criticalIds, isNowInBlock, currentBlock } from '../core/pert.js';
import { blocksOf, blockById } from '../core/blocks.js';
import { renderCard } from '../components/cards.js';
import { showTaskModal } from '../components/task-modal.js';
import { showSyntaxHelp } from '../components/syntax-help.js';
import { showBacklogPicker } from '../components/backlog-picker.js';

/**
 * Pronóstico corto del bloque: { text: "85%", cls, head, detail } (con su color),
 * o null si no hay nada pendiente que pronosticar.
 */
function forecastOf(sched) {
  if (sched.pendingCount === 0) {
    return sched.items.length ? { text: '✓', cls: 'good', head: 'Todo listo', detail: 'No quedan tareas pendientes en este bloque.' } : null;
  }
  const n = `${sched.pendingCount} pendiente${sched.pendingCount > 1 ? 's' : ''}`;
  if (sched.remaining <= 0) return { text: '0%', cls: 'bad', head: 'El bloque ya terminó', detail: `Quedaron ${n}.` };
  const pct = Math.round(sched.probability * 100);
  const cls = sched.probability >= 0.8 ? 'good' : sched.probability >= 0.5 ? 'warn' : 'bad';
  return {
    text: `${pct}%`,
    cls,
    head: `${pct}% de terminar a tiempo`,
    detail: `${n} · estimado ${formatMinutes(sched.mu)} ± ${formatMinutes(sched.sigma)} · quedan ${formatMinutes(sched.remaining)} en el bloque`,
  };
}

// Tooltip abierto con clic: 'dot:<bloque>' o 'pct:<bloque>' (se mantiene aunque la lista se re-renderice)
let openTip = null;

/** Avance del bloque según la hora: { pct 0–100, state 'before' | 'now' | 'after', tip: [título, detalle] }. */
function blockProgress(block, nowMin) {
  const start = toMinutes(block.start);
  const end = toMinutes(block.end);
  const length = formatMinutes(end - start);
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

/** ───────── ✦ 85% | Mañana | 08:00 - 13:00 */
function blockDivider(block, now, sched, nowMin, sug) {
  const fc = forecastOf(sched);
  const key = `pct:${block.id}`;
  const parts = [];
  if (fc) {
    parts.push(h('button', {
      type: 'button',
      class: `forecast minimal-pct ${fc.cls}${sug ? ' has-tip' : ''}${openTip === key ? ' open' : ''}`,
      dataset: { tip: key },
      'aria-expanded': String(openTip === key),
      'aria-controls': `pct-tip-${block.id}`,
      title: sug ? 'Hay una sugerencia para este bloque' : null,
    }, sug ? `✦ ${fc.text}` : fc.text), ' | ');
  }
  parts.push(`${block.title} | ${block.start} - ${block.end}`);
  return h('li', { class: `done-divider block-divider${now ? ' is-now' : ''}`, dataset: { block: block.id } },
    ...blockLine(block, nowMin),
    h('span', { class: 'done-date', title: now ? 'Bloque en curso' : null }, ...parts),
    fc ? forecastTip(block, fc, sug) : null);
}

export function renderMinimal() {
  const today = todayISO();
  document.getElementById('minimal-day').textContent = dayLabel(today);
  const ctx = {
    byId: new Map(state.tasks.map((t) => [t.id, t])),
    epicsById: new Map(state.epics.map((e) => [e.id, e])),
    critical: criticalIds(state.tasks),
    planDate: today,
  };
  const nowMin = nowMinutes();
  let pending = 0;
  let total = 0;
  const nodes = blocksOf(state.settings).flatMap((block) => {
    const list = blockTasks(block.id, today);
    // Mismo orden que el tablero (dependencias y reuniones por horario)
    const sched = scheduleBlock(list, block, nowMin);
    const { items } = sched;
    total += items.length;
    pending += items.filter((i) => !i.task.done).length;
    const now = isNowInBlock(block);
    const cards = items.map((item) => renderCard(item.task, { ctx, link: false, draggable: true }));
    if (now) cards.find((li) => !li.classList.contains('done'))?.classList.add('current');
    // Misma sugerencia que en Plan (si el bloque terminó no hay nada que reacomodar)
    const sug = sched.remaining > 0 ? computeSuggestion(block.id, ctx, today) : null;
    return [blockDivider(block, now, sched, nowMin, sug), ...(cards.length ? cards : [h('li', { class: 'minimal-empty' }, 'Sin tareas')])];
  });
  document.getElementById('minimal-count').textContent = total
    ? `${pending} pendiente${pending === 1 ? '' : 's'} de ${total}`
    : 'Nada planificado para hoy';
  document.getElementById('minimal-list').replaceChildren(...nodes);

  // A dónde va una tarea si no se nombra un bloque (en el placeholder, sin texto extra)
  const target = blockById(state.settings, currentBlock(state.settings));
  document.querySelector('#minimal-add input').placeholder = `+ Nueva tarea en ${target.title}`;

  // Cuántas tareas esperan en el backlog (en el botón que las trae a hoy)
  const inBacklog = backlogTasks().filter((t) => !t.done).length;
  const badge = document.getElementById('backlog-count');
  badge.hidden = !inBacklog;
  badge.textContent = inBacklog > 99 ? '99+' : String(inBacklog);
  document.getElementById('backlog-picker-btn').title = inBacklog
    ? `Backlog: ${inBacklog} tarea${inBacklog === 1 ? '' : 's'} para pasar a hoy`
    : 'Backlog vacío';
}

// ---------- Drag & drop: reordenar y mover entre bloques ----------

let dragId = null;
let dropped = false;

/** ¿Hay un arrastre en curso? (el panel no re-renderiza mientras tanto) */
export function isMinimalBusy() {
  return Boolean(dragId);
}

/** Guarda el orden de la lista tal como quedó: cada tarea pertenece al bloque del separador anterior. */
function persistOrder(list) {
  const lists = [];
  for (const li of list.children) {
    if (li.classList.contains('block-divider')) lists.push({ date: todayISO(), block: li.dataset.block, ids: [] });
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
    // Hoy, en el bloque en curso; "… tarde", "@gym", "am"/"pm" lo cambian (igual que en Plan)
    const task = addFromText(input.value, { date: todayISO(), block: currentBlock(state.settings) });
    if (task) input.value = '';
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') input.value = '';
  });
  document.getElementById('syntax-help-btn').addEventListener('click', showSyntaxHelp);
  document.getElementById('backlog-picker-btn').addEventListener('click', showBacklogPicker);

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
    if (!e.target.closest('button, input, textarea')) showTaskModal(id);
  });
}
