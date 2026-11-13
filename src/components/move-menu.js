// Menú "Mover" de una tarea (botón ⇢): una cuadrícula con los próximos 7 días (filas) y los bloques
// (columnas): un toque y queda movida. Arriba, "Siguiente bloque"; abajo, "Al backlog".
// Las reuniones solo cambian de día (conservan la hora). Compartido con la versión web.

import { state, findTask, planTask, unplanTask, setMeeting } from '../services/store.js';
import { h, showToast } from '../utils/ui.js';
import { blocksOf, firstBlock, blockById } from '../core/blocks.js';
import { todayISO, shiftDate, shortLabel, nowMinutes, toMinutes } from '../utils/dates.js';
import { titleCase } from '../utils/text.js';

const DAYS = 7;
let menu = null;

const dayName = (iso) => {
  const today = todayISO();
  if (iso === today) return 'Hoy';
  if (iso === shiftDate(today, 1)) return 'Mañana';
  return shortLabel(iso).replace(/ \w+$/, ''); // "vie 14"
};
const label = (b) => `${b.icon} ${b.title}`;

/**
 * Siguiente lugar para una tarea: el próximo bloque del mismo día que todavía no termina;
 * si no queda ninguno, el primer bloque del día siguiente.
 */
export function nextSlot(date, blockId) {
  const blocks = blocksOf(state.settings);
  const i = blocks.findIndex((b) => b.id === blockId);
  const today = todayISO();
  const open = (b) => date > today || (date === today && toMinutes(b.end) > nowMinutes());
  const later = blocks.slice(i + 1).find(open);
  if (later) return { date, block: later.id };
  const next = shiftDate(date < today ? today : date, date < today ? 0 : 1);
  if (next === today) {
    const now = blocks.find(open);
    if (now) return { date: today, block: now.id };
    return { date: shiftDate(today, 1), block: firstBlock(state.settings).id };
  }
  return { date: next, block: firstBlock(state.settings).id };
}

/** "→ ☾ Tarde" / "→ mañana, ☀︎ Mañana" / "→ jue 12 nov, ☀︎ Mañana" */
export function slotText(slot, fromDate) {
  const b = blockById(state.settings, slot.block);
  if (slot.date === fromDate) return label(b);
  const day = slot.date === todayISO() ? 'hoy' : slot.date === shiftDate(todayISO(), 1) ? 'mañana' : shortLabel(slot.date);
  return `${day}, ${label(b)}`;
}

function move(task, date, block) {
  close();
  if (task.meeting) {
    const error = setMeeting(task.id, { date, start: task.meeting.start, end: task.meeting.end, blocking: task.meeting.blocking });
    if (error) { showToast(error); return; }
    showToast(`Reunión "${task.title}" → ${dayName(date).toLowerCase()}, ${task.meeting.start}–${task.meeting.end}.`);
    return;
  }
  planTask(task.id, block, date);
  showToast(`"${task.title}" → ${slotText({ date, block }, null)}.`);
}

/** "Hoy" / "Mañana" / "Lun", y debajo la fecha ("14 nov"). */
function dayCell(iso) {
  const today = todayISO();
  const [weekday, ...rest] = shortLabel(iso).split(' ');
  const main = iso === today ? 'Hoy' : iso === shiftDate(today, 1) ? 'Mañana' : titleCase(weekday);
  return h('span', { class: 'move-day' }, h('strong', {}, main), h('small', {}, rest.join(' ')));
}

function render(task) {
  const today = todayISO();
  const days = Array.from({ length: DAYS }, (_, i) => shiftDate(today, i));
  const blocks = blocksOf(state.settings);
  const compact = blocks.length > 2; // con 3 o más bloques, solo el ícono (el nombre va arriba)
  const nowMin = nowMinutes();

  const quick = [];
  if (!task.meeting && task.date) {
    const next = nextSlot(task.date, task.block);
    quick.push(h('button', { type: 'button', class: 'move-quick', dataset: { date: next.date, block: next.block } },
      h('span', { class: 'move-arrow', 'aria-hidden': 'true' }, '→'), `Siguiente bloque: ${slotText(next, task.date)}`));
  }

  const slot = (d, b) => {
    const ended = d === today && toMinutes(b.end) <= nowMin;
    const here = d === task.date && b.id === task.block;
    const where = `${d === today ? 'hoy' : shortLabel(d)}, ${b.title}`;
    return h('button', {
      type: 'button',
      class: `move-slot${here ? ' current' : ''}`,
      dataset: { date: d, block: b.id },
      disabled: ended || here,
      title: here ? `Está aquí (${where})` : ended ? `${b.title} de hoy ya terminó` : `Mover a ${where}`,
      'aria-label': here ? `Está en ${where}` : `Mover a ${where}`,
    }, compact ? b.icon : label(b));
  };
  const meetingSlot = (d) => h('button', {
    type: 'button',
    class: `move-slot${d === task.date ? ' current' : ''}`,
    dataset: { date: d },
    disabled: d === task.date,
    'aria-label': `Mover a ${d === today ? 'hoy' : shortLabel(d)}, ${task.meeting.start}–${task.meeting.end}`,
  }, `${task.meeting.start}–${task.meeting.end}`);

  const columns = task.meeting ? 1 : blocks.length;
  const grid = h('div', { class: 'move-grid', style: `--cols:${columns}`, role: 'group', 'aria-label': 'Día y bloque' },
    compact && !task.meeting
      ? [h('span', {}), ...blocks.map((b) => h('span', { class: 'move-col', title: b.title }, b.icon, h('small', {}, b.title)))]
      : null,
    ...days.map((d) => [dayCell(d), ...(task.meeting ? [meetingSlot(d)] : blocks.map((b) => slot(d, b)))]));

  menu.replaceChildren(...[
    h('p', { class: 'move-title' }, 'Mover a…', h('small', {}, titleCase(task.title))),
    ...quick,
    grid,
    task.meeting ? h('p', { class: 'move-note' }, 'La reunión conserva su horario.') : null,
    task.meeting || !task.date ? null : h('button', { type: 'button', class: 'move-quick move-backlog', dataset: { backlog: '1' } },
      h('span', { class: 'move-arrow', 'aria-hidden': 'true' }, '⤓'), 'Al backlog (sin fecha)'),
  ].filter(Boolean)); // replaceChildren escribiría "null" como texto
}

function place(anchor) {
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
  let top = r.bottom + 6;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 6);
  menu.style.left = `${left}px`; // fijo a la ventana: funciona igual dentro de un modal
  menu.style.top = `${top}px`;
}

function onClick(e) {
  const task = findTask(menu?.dataset.task);
  if (!task) { close(); return; }
  const btn = e.target.closest('button');
  if (!btn || btn.disabled) return;
  if (btn.dataset.backlog) {
    close();
    unplanTask(task.id);
    showToast(`"${task.title}" al backlog.`);
  } else if (btn.dataset.date) {
    move(task, btn.dataset.date, btn.dataset.block || null);
  }
}

const onOutside = (e) => { if (menu && !menu.contains(e.target) && !e.target.closest('.move-btn, .pick-move')) close(); };
const onKey = (e) => {
  if (e.key !== 'Escape') return;
  e.preventDefault(); // en un modal: cerrar solo el menú, no el modal
  e.stopPropagation();
  close();
};

export function close() {
  if (!menu) return;
  menu.remove();
  menu = null;
  document.removeEventListener('mousedown', onOutside, true);
  document.removeEventListener('keydown', onKey, true);
}

/** Abre (o cierra, si ya estaba abierto para esa tarea) el menú junto al botón. */
export function openMoveMenu(taskId, anchor) {
  const same = menu?.dataset.task === taskId;
  close();
  if (same) return;
  const task = findTask(taskId);
  if (!task) return;
  menu = h('div', { class: 'move-menu', role: 'dialog', 'aria-label': `Mover "${task.title}"`, dataset: { task: taskId } });
  menu.addEventListener('click', onClick);
  // Dentro de un modal (<dialog>), el menú va en el mismo modal: si no, quedaría por debajo
  (anchor.closest('dialog') || document.body).append(menu);
  render(task);
  place(anchor);
  menu.querySelector('button:not(:disabled)')?.focus();
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
}
