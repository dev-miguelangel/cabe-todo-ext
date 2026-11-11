// Sugerencia "✦ Si mueves X a otro bloque, este sube de A% a B%" para un bloque que va mal.
// La usa la vista Hoy (en el tooltip del porcentaje de cada bloque).

import { state, blockTasks } from '../services/store.js';
import { h } from '../utils/ui.js';
import { scheduleBlock, suggestMove } from '../core/pert.js';
import { blocksOf, blockById, blockRange, blockIndex, firstBlock } from '../core/blocks.js';
import { formatMinutes } from '../core/parser.js';
import { todayISO, shiftDate, shortLabel, nowMinutes } from '../utils/dates.js';

/** "Ahora" en minutos para un día: null si es futuro, fin del día si es pasado. */
function nowMinutesFor(iso) {
  const today = todayISO();
  if (iso < today) return 24 * 60;
  if (iso > today) return null;
  return nowMinutes();
}

/** "☾ Tarde" para frases: "a ☾ Tarde", "en ☀︎ Mañana". */
const blockLabel = (id) => {
  const b = blockById(state.settings, id);
  return b ? `${b.icon} ${b.title}` : '';
};

/** Destino del día siguiente: su primer bloque. */
function tomorrowTarget(from) {
  const next = shiftDate(from, 1);
  const first = firstBlock(state.settings);
  return {
    date: next, block: first.id, label: `al ${shortLabel(next)} en ${blockLabel(first.id)}`,
    tasks: blockTasks(first.id, next), range: blockRange(state.settings, first.id), nowMin: null,
  };
}

/**
 * Si el bloque va mal (< 50%), sugiere mover una tarea a otro bloque del mismo día que aún
 * tenga tiempo o al primer bloque del día siguiente. Nunca sugiere mover tareas de las que otra depende.
 * ctx: { byId, critical }.
 */
export function computeSuggestion(block, ctx, date = todayISO()) {
  if (date < todayISO()) return null;
  const nowMin = nowMinutesFor(date);
  const targets = blocksOf(state.settings)
    .filter((b) => b.id !== block && scheduleBlock([], b, nowMin).remaining > 0)
    .map((b) => ({
      date, block: b.id, label: `a ${blockLabel(b.id)}`,
      tasks: blockTasks(b.id, date), range: blockRange(state.settings, b.id), nowMin,
    }));
  targets.push(tomorrowTarget(date));

  const rank = (id) => blockIndex(state.settings, id);
  const canMove = (task, target) => {
    // A otro día: solo tareas sueltas (sus dependencias del día dejarían de valer).
    if (target.date !== task.date) return task.dependencies.length === 0;
    // A un bloque anterior: no si algo de lo que depende está en un bloque posterior a ese.
    return !task.dependencies.some((id) => {
      const dep = ctx.byId.get(id);
      return dep?.date === task.date && dep.block && rank(dep.block) > rank(target.block);
    });
  };

  return suggestMove(
    { tasks: blockTasks(block, date), range: blockRange(state.settings, block), nowMin },
    targets,
    { critical: ctx.critical, canMove },
  );
}

/** Pinta la sugerencia (texto + botón "Mover") en `el`; la oculta si no hay. */
export function renderSuggestion(el, sug) {
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
