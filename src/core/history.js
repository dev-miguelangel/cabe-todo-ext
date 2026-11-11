// Historial de tareas completadas. Funciones puras: sin DOM ni chrome.*.

import { toISO } from '../utils/dates.js';

/** Día en que se completó una tarea (hora local); si no se sabe, el día en que estaba planificada. */
export function doneDay(task) {
  if (task.done_at) {
    const d = new Date(task.done_at);
    if (!Number.isNaN(d.getTime())) return toISO(d);
  }
  return task.date || null;
}

/**
 * Tareas completadas agrupadas por día, del más reciente al más antiguo:
 * [{ date: 'YYYY-MM-DD', tasks: [...] }]. Dentro de cada día, la última terminada primero.
 */
export function doneByDay(tasks) {
  const groups = new Map();
  for (const t of tasks) {
    if (!t.done) continue;
    const date = doneDay(t) || '0000-00-00';
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(t);
  }
  const at = (t) => t.done_at || '';
  return [...groups.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, list]) => ({ date, tasks: list.sort((x, y) => at(y).localeCompare(at(x))) }));
}
