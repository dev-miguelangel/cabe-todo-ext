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

/**
 * Todas las tareas en grupos para la vista Tareas (funciones puras; `today` = YYYY-MM-DD):
 * overdue  pendientes de días anteriores (la más antigua primero; sin reuniones pasadas)
 * today    pendientes de hoy
 * upcoming pendientes de días siguientes (la más cercana primero)
 * backlog  pendientes sin fecha
 * done     hechas, por día (doneByDay)
 */
export function groupTasks(tasks, today) {
  const pending = tasks.filter((t) => !t.done);
  const byDate = (a, b) => a.date.localeCompare(b.date) || (a.block || '').localeCompare(b.block || '') || (a.order ?? 0) - (b.order ?? 0);
  return {
    overdue: pending.filter((t) => t.date && t.date < today && !t.meeting).sort(byDate),
    today: pending.filter((t) => t.date === today).sort(byDate),
    upcoming: pending.filter((t) => t.date && t.date > today).sort(byDate),
    backlog: pending.filter((t) => !t.date).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
    done: doneByDay(tasks),
  };
}

const fold = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** ¿La tarea calza con la búsqueda? (todas las palabras, en el título o en el nombre de su épica) */
export function matchesQuery(task, query, epicName = '') {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const hay = `${fold(task.title)} ${fold(epicName)}`;
  return words.every((w) => hay.includes(w));
}
