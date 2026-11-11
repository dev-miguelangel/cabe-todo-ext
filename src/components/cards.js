// Tarjeta de tarea, compartida por la vista del día, la bandeja y la vista de épicas.

import { formatMinutes, formatClock } from '../core/parser.js';
import { blockersOf, timerBlockedBy } from '../core/pert.js';
import { markdownExcerpt } from '../utils/markdown.js';
import { shortLabel, dayLabel } from '../utils/dates.js';
import { isRunning, trackedMs, remainingMs, formatTracked, formatLeft } from '../core/timer.js';

/**
 * Chip de tiempo de la fila: cuánto queda (o cuánto se pasó). Clic = pausar/reanudar.
 * allTasks: para saber si una reunión que bloquea impide reanudarla.
 */
export function updateTimerChip(chip, task, allTasks = []) {
  const running = isRunning(task);
  const left = remainingMs(task);
  const over = left <= 0;
  const blockedBy = running ? null : timerBlockedBy(task, allTasks);
  chip.classList.toggle('running', running);
  chip.classList.toggle('over', over);
  chip.classList.toggle('blocked', Boolean(blockedBy));
  chip.disabled = Boolean(blockedBy);
  chip.textContent = over ? `⚠\ufe0e +${formatTracked(-left)}` : `${running ? '●' : '⏱\ufe0e'} ${formatLeft(left)}`;
  const state = running && task.meeting ? 'reunión en curso: clic para finalizar o reprogramar'
    : running ? 'clic para pausar'
    : blockedBy ? `no se puede reanudar: "${blockedBy.title}" en curso hasta las ${blockedBy.meeting.end}` : 'clic para reanudar';
  chip.title = over ? `Tiempo cumplido: +${formatTracked(-left)} sobre lo estimado · ${state}` : `Quedan ${formatLeft(left)} · ${state}`;
  chip.setAttribute('aria-label', chip.title);
}

const template = document.getElementById('task-template');
const BLOCK_ICON = { am: '☀︎', pm: '☾' };

function signed(minutes) {
  return minutes >= 0 ? formatMinutes(minutes) : `−${formatMinutes(-minutes)}`;
}

/** "backlog" · "mié 12 nov" · nada si es el mismo día de la tarea */
function whereLabel(pred, task) {
  if (pred.date === task.date) return '';
  return pred.date ? shortLabel(pred.date) : 'backlog';
}

export function whenLabel(task) {
  return task.date ? `${shortLabel(task.date)} · ${BLOCK_ICON[task.block]}` : 'backlog';
}

/**
 * opts:
 *  ctx       { byId, epicsById, critical:Set, planDate }
 *  item      resultado de scheduleBlock para esta tarea (hora estimada, holgura)
 *  draggable, link, plan (botones → AM/PM), unplan (↩︎ al backlog), when (mostrar fecha), dim
 *  ended     { date, block, label, title } si el bloque ya terminó: → siguiente bloque / ⤓ backlog
 */
export function renderCard(task, opts) {
  const { ctx } = opts;
  const li = template.content.firstElementChild.cloneNode(true);
  li.dataset.id = task.id;
  const meeting = task.meeting;
  // Las reuniones tienen hora fija: no se arrastran ni se mueven de bloque o al backlog
  li.draggable = Boolean(opts.draggable) && !meeting;
  li.classList.toggle('meeting', Boolean(meeting));
  li.classList.toggle('done', task.done);
  li.classList.toggle('dim', Boolean(opts.dim));
  li.querySelector('.check').checked = task.done;
  li.querySelector('.title').textContent = task.title;

  const epic = ctx.epicsById.get(task.epic_id);
  if (epic && opts.showEpic !== false) {
    const dot = li.querySelector('.dot');
    dot.hidden = false;
    dot.style.background = epic.color;
    dot.title = epic.name;
  }

  const mark = task.certainty === 'unsure' ? ' ?' : task.certainty === 'sure' ? ' !' : '';
  li.querySelector('.minutes').textContent = formatMinutes(task.minutes) + mark;
  if (meeting) {
    const time = li.querySelector('.meeting-time');
    time.hidden = false;
    time.textContent = `◷ ${meeting.start}–${meeting.end}`;
    time.classList.toggle('parallel', !meeting.blocking);
    li.querySelector('.minutes').hidden = true;
    li.dataset.meetingTitle = `Reunión ${meeting.start}–${meeting.end} · ${meeting.blocking
      ? 'bloquea la toma de tareas' : 'paralela: se puede seguir trabajando'}`;
  }

  // Línea secundaria: cuándo (en la vista de épica) y de qué depende
  const meta = [];
  if (opts.when) meta.push(whenLabel(task));
  const preds = task.dependencies.map((id) => ctx.byId.get(id)).filter(Boolean);
  if (preds.length) {
    const names = preds.map((p) => {
      const where = whereLabel(p, task);
      return where ? `${p.title} (${where})` : p.title;
    });
    meta.push(`↳ después de: ${names.join(', ')}`);
  }
  if (meta.length) {
    const deps = li.querySelector('.deps');
    deps.hidden = false;
    deps.textContent = meta.join(' · ');
  }

  const blockers = blockersOf(task, ctx.byId);
  if (blockers.length) {
    const lock = li.querySelector('.locked');
    lock.hidden = false;
    lock.title = `Bloqueada: falta ${blockers.map((p) => `"${p.title}"`).join(', ')}`;
    li.classList.add('blocked');
  }

  // Tiempo registrado: chip que pausa/reanuda (solo si ya hay tiempo o está corriendo).
  const running = isRunning(task);
  if (running || trackedMs(task) > 0) {
    const chip = li.querySelector('.timer-btn');
    chip.hidden = false;
    updateTimerChip(chip, task, ctx.allTasks);
  }
  if (task.doc?.trim()) {
    const mark = li.querySelector('.doc-mark');
    mark.hidden = false;
    mark.title = `Documentación: ${markdownExcerpt(task.doc, 140)}`;
  }
  li.querySelector('.repeat-mark').hidden = !task.routine_id;
  if (task.comments?.length) {
    const count = li.querySelector('.comment-count');
    count.hidden = false;
    count.textContent = `✎ ${task.comments.length}`;
    count.title = `${task.comments.length} comentario${task.comments.length > 1 ? 's' : ''}`;
  }

  const critical = ctx.critical?.has(task.id);
  li.querySelector('.critical').hidden = !critical;

  // Dependencias: solo tiene sentido en tareas pendientes.
  li.querySelector('.link').hidden = opts.link === false || task.done;
  if (opts.plan && !task.done && !meeting) {
    const plan = li.querySelector('.plan');
    plan.hidden = false;
    const day = dayLabel(ctx.planDate).toLowerCase();
    plan.querySelector('[data-block="am"]').title = `Planificar el ${day} en la mañana`;
    plan.querySelector('[data-block="pm"]').title = `Planificar el ${day} en la tarde`;
  }
  li.querySelector('.unplan').hidden = !(opts.unplan && task.date && !task.done && !meeting);
  if (opts.ended && !task.done && !meeting) {
    const ended = li.querySelector('.ended');
    ended.hidden = false;
    const next = ended.querySelector('.next-btn');
    next.textContent = opts.ended.label;
    next.title = opts.ended.title;
    next.dataset.date = opts.ended.date;
    next.dataset.block = opts.ended.block;
  }

  const item = opts.item;
  if (meeting) {
    li.title = li.dataset.meetingTitle + (task.done ? ' · hecha' : '');
  } else if (item && !task.done) {
    // En un bloque ya terminado todas irían "tarde": no marcarlas, ya hay botones para moverlas.
    li.classList.toggle('late', item.slack < 0 && !opts.ended);
    const lines = [
      `Terminarías ~${formatClock(item.finish)} · holgura ${signed(item.slack)}`,
      `Estimado ${formatMinutes(item.est.te)} (entre ${formatMinutes(item.est.o)} y ${formatMinutes(item.est.p)})`,
    ];
    if (critical) lines.push('◆ Otras tareas dependen de esta');
    if (blockers.length) lines.push(lock(blockers));
    li.title = lines.join('\n');
  } else if (task.done) {
    li.title = 'Hecha';
  }
  return li;
}

function lock(blockers) {
  return `⧖ Falta: ${blockers.map((p) => p.title).join(', ')}`;
}
