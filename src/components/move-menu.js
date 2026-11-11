// Menú "Mover" de una tarea (botón ⇢ en las acciones de la tarjeta): al siguiente bloque, a mañana,
// a otro día y bloque (próximos 7 días) o al backlog. Las reuniones solo cambian de día (conservan la hora).

import { state, findTask, planTask, unplanTask, setMeeting } from '../services/store.js';
import { h, showToast } from '../utils/ui.js';
import { blocksOf, firstBlock, blockById } from '../core/blocks.js';
import { todayISO, shiftDate, shortLabel, nowMinutes, toMinutes } from '../utils/dates.js';

const DAYS = 7;
let menu = null;
let pickedDay = null;

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

function render(task) {
  const today = todayISO();
  const days = Array.from({ length: DAYS }, (_, i) => shiftDate(today, i));
  const quick = [];
  if (!task.meeting && task.date) {
    const next = nextSlot(task.date, task.block);
    quick.push(h('button', { type: 'button', class: 'move-quick', dataset: { date: next.date, block: next.block } },
      h('span', { class: 'move-arrow', 'aria-hidden': 'true' }, '→'), `Siguiente: ${slotText(next, task.date)}`));
  }
  const tomorrow = shiftDate(today, 1);
  if (task.date !== tomorrow) {
    const first = firstBlock(state.settings);
    quick.push(h('button', { type: 'button', class: 'move-quick', dataset: { date: tomorrow, block: task.meeting ? '' : first.id } },
      h('span', { class: 'move-arrow', 'aria-hidden': 'true' }, '→'), task.meeting ? 'Mañana, a la misma hora' : `Mañana, ${label(first)}`));
  }

  const dayChips = h('div', { class: 'move-days', role: 'group', 'aria-label': 'Día' }, ...days.map((d) => h('button', {
    type: 'button',
    class: `move-chip${d === pickedDay ? ' on' : ''}${d === task.date ? ' current' : ''}`,
    dataset: { day: d },
    'aria-pressed': String(d === pickedDay),
    title: d === task.date ? 'Está en este día' : null,
  }, dayName(d))));
  const blockChips = task.meeting
    ? h('p', { class: 'move-note' }, `Conserva su horario (${task.meeting.start}–${task.meeting.end}): toca el día.`)
    : h('div', { class: 'move-blocks', role: 'group', 'aria-label': 'Bloque' }, ...blocksOf(state.settings).map((b) => h('button', {
      type: 'button',
      class: `move-chip${pickedDay === task.date && b.id === task.block ? ' current' : ''}`,
      dataset: { block: b.id },
      disabled: pickedDay === task.date && b.id === task.block,
    }, label(b))));

  menu.replaceChildren(
    h('p', { class: 'move-title' }, `Mover "${task.title}"`),
    ...quick,
    h('p', { class: 'move-section' }, task.meeting ? 'Otro día' : 'Otro día y bloque'),
    dayChips,
    blockChips,
    task.meeting || !task.date ? null : h('button', { type: 'button', class: 'move-quick move-backlog', dataset: { backlog: '1' } },
      h('span', { class: 'move-arrow', 'aria-hidden': 'true' }, '⤓'), 'Al backlog'));
}

function place(anchor) {
  const r = anchor.getBoundingClientRect();
  const w = menu.offsetWidth;
  const left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
  let top = r.bottom + 6;
  if (top + menu.offsetHeight > window.innerHeight - 8) top = Math.max(8, r.top - menu.offsetHeight - 6);
  menu.style.left = `${left + window.scrollX}px`;
  menu.style.top = `${top + window.scrollY}px`;
}

function onClick(e) {
  const task = findTask(menu?.dataset.task);
  if (!task) { close(); return; }
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.backlog) {
    close();
    unplanTask(task.id);
    showToast(`"${task.title}" al backlog.`);
  } else if (btn.dataset.day) {
    pickedDay = btn.dataset.day;
    if (task.meeting) { move(task, pickedDay, null); return; }
    render(task);
  } else if (btn.classList.contains('move-quick')) {
    move(task, btn.dataset.date, btn.dataset.block || null);
  } else if (btn.dataset.block) {
    move(task, pickedDay, btn.dataset.block);
  }
}

const onOutside = (e) => { if (menu && !menu.contains(e.target) && !e.target.closest('.move-btn')) close(); };
const onKey = (e) => { if (e.key === 'Escape') close(); };

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
  pickedDay = task.date && task.date >= todayISO() ? task.date : todayISO();
  menu = h('div', { class: 'move-menu', role: 'dialog', 'aria-label': `Mover "${task.title}"`, dataset: { task: taskId } });
  menu.addEventListener('click', onClick);
  document.body.append(menu);
  render(task);
  place(anchor);
  menu.querySelector('button')?.focus();
  document.addEventListener('mousedown', onOutside, true);
  document.addEventListener('keydown', onKey, true);
}
