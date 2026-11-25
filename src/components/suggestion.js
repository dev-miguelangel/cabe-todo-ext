// Sugerencia para un bloque que va mal. La usa la vista Hoy (en el tooltip del porcentaje de cada bloque).
// - Regla de los 2 minutos (primero): "✦ Haz la versión mínima de X: este bloque sube de A% a B%".
//   Un hábito se achica antes que moverse: mantener la costumbre importa más que hacerla completa.
// - Si no hay hábito que achicar: "✦ Si mueves X a otro bloque, este sube de A% a B%".

import { state, blockTasks, minVersionOf } from '../services/store.js';
import { h } from '../utils/ui.js';
import { scheduleBlock, suggestMove, suggestShrink } from '../core/pert.js';
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
 * Si el bloque va mal (< 50%), sugiere primero achicar un hábito a su versión mínima
 * ({ kind: 'shrink', task, min, before, after }); si no hay, mover una tarea a otro bloque del mismo día
 * que aún tenga tiempo o al primer bloque del día siguiente ({ kind: 'move', … }).
 * Nunca sugiere mover tareas de las que otra depende. ctx: { byId, critical }.
 */
export function computeSuggestion(block, ctx, date = todayISO()) {
  if (date < todayISO()) return null;
  const nowMin = nowMinutesFor(date);
  const source = { tasks: blockTasks(block, date), range: blockRange(state.settings, block), nowMin };
  const shrink = suggestShrink(source, minVersionOf);
  if (shrink) return { kind: 'shrink', ...shrink };
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

  const move = suggestMove(source, targets, { critical: ctx.critical, canMove });
  return move ? { kind: 'move', ...move } : null;
}

/** Pinta la sugerencia (texto + botón "Mover") en `el`; la oculta si no hay. */
export function renderSuggestion(el, sug) {
  el.hidden = !sug;
  if (!sug) return;
  const pct = (p) => `${Math.round(p * 100)}%`;
  if (sug.kind === 'shrink') {
    el.replaceChildren(
      h('span', {}, `✦ Haz solo la versión mínima de "${sug.task.title}" (${formatMinutes(sug.min.minutes)} en vez de ${formatMinutes(sug.task.minutes)}): este bloque sube de ${pct(sug.before)} a ${pct(sug.after)}. Mejor poco que nada: el hábito sigue.`),
      h('button', {
        class: 'suggest-btn',
        dataset: { shrink: sug.task.id },
        title: `Hoy: "${sug.min.title}". Puedes volver a la completa desde su detalle.`,
      }, 'Hacer la mínima'),
    );
    return;
  }
  el.replaceChildren(
    h('span', {}, `✦ Si mueves "${sug.task.title}" (${formatMinutes(sug.task.minutes)}) ${sug.target.label}, este bloque sube de ${pct(sug.before)} a ${pct(sug.sourceProbability)}.`),
    h('button', {
      class: 'suggest-btn',
      dataset: { task: sug.task.id, date: sug.target.date, block: sug.target.block },
      title: `El destino quedaría en ${pct(sug.targetProbability)}`,
    }, 'Mover'),
  );
}
