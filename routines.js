// Tareas que se repiten (rutinas). Funciones puras: sin DOM ni chrome.*.
//
// Una rutina es un molde ({ title, minutes, block, días… }). Cada día que le toca se crea una
// tarea normal con `routine_id`, que se planifica, cronometra y marca como cualquier otra.
// `generated` recuerda qué días ya se crearon: si mueves o borras esa tarea, no vuelve a aparecer.

import { parseISO, toISO, shiftDate } from './dates.js';

export const ALL_DAYS = [1, 2, 3, 4, 5, 6, 0];      // lunes primero (como se muestra)
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const DAY_LETTER = { 1: 'L', 2: 'M', 3: 'X', 4: 'J', 5: 'V', 6: 'S', 0: 'D' };
const DAY_NAME = { 1: 'lunes', 2: 'martes', 3: 'miércoles', 4: 'jueves', 5: 'viernes', 6: 'sábados', 0: 'domingos' };

// Palabras del quick-add → día de la semana (0 = domingo)
const DAY_WORDS = {
  lunes: 1, lun: 1, martes: 2, mar: 2, 'miércoles': 3, miercoles: 3, mie: 3, 'mié': 3,
  jueves: 4, jue: 4, viernes: 5, vie: 5, 'sábado': 6, sabado: 6, 'sábados': 6, sabados: 6, sab: 6, 'sáb': 6,
  domingo: 0, domingos: 0, dom: 0,
};
const KEEP_GENERATED_DAYS = 21; // cuánto historial de "ya creada" guardar

export const weekdayOf = (iso) => parseISO(iso).getDay();
const sortDays = (days) => ALL_DAYS.filter((d) => days.includes(d));

/** "lun,jue" / "lunes" → [1, 4]; null si alguna parte no es un día. */
function parseDayList(word) {
  const parts = word.toLowerCase().split(/[,/]/).filter(Boolean);
  if (!parts.length) return null;
  const days = parts.map((p) => DAY_WORDS[p]);
  return days.every((d) => d !== undefined) ? sortDays([...new Set(days)]) : null;
}

/**
 * Lee la repetición al final de las palabras del quick-add (las consume del arreglo).
 * Acepta: "cada día", "hábiles", "días hábiles", "cada lunes", "cada lun,jue".
 * ("diario" no: es común en títulos como "Informe diario").
 * Devuelve los días [0..6] o null.
 */
export function takeRepeat(words) {
  if (words.length < 2) return null;
  const last = words[words.length - 1].toLowerCase();
  const prev = words.length > 2 ? words[words.length - 2].toLowerCase() : null;

  if ((last === 'día' || last === 'dia') && prev === 'cada') { words.splice(-2); return [...ALL_DAYS]; }
  if (last === 'hábiles' || last === 'habiles') {
    words.splice(prev === 'días' || prev === 'dias' ? -2 : -1);
    return [...WEEKDAYS];
  }
  if (prev === 'cada') {
    const days = parseDayList(last);
    if (days) { words.splice(-2); return days; }
  }
  return null;
}

/** [1,2,3,4,5] → "días hábiles" · todos → "cada día" · [1,4] → "lunes y jueves" */
export function repeatLabel(days) {
  const d = sortDays(days);
  if (d.length === 7) return 'cada día';
  if (d.length === 5 && WEEKDAYS.every((x) => d.includes(x))) return 'días hábiles';
  if (d.length === 2 && d.includes(6) && d.includes(0)) return 'fines de semana';
  const names = d.map((x) => DAY_NAME[x]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} y ${names.at(-1)}` : `los ${names[0]}`;
}

/** Texto corto para el quick-add (lo inverso de takeRepeat). */
export function repeatToken(days) {
  const d = sortDays(days);
  if (d.length === 7) return 'cada día';
  if (d.length === 5 && WEEKDAYS.every((x) => d.includes(x))) return 'hábiles';
  const short = { 1: 'lun', 2: 'mar', 3: 'mie', 4: 'jue', 5: 'vie', 6: 'sab', 0: 'dom' };
  return `cada ${d.map((x) => short[x]).join(',')}`;
}

/** Molde a partir de una tarea (título, duración, certeza, épica, bloque y horario si es reunión). */
export function routineFrom(task, { id, days, startDate, now = new Date() }) {
  return {
    id,
    title: task.title,
    minutes: task.minutes,
    certainty: task.certainty,
    epic_id: task.epic_id ?? null,
    block: task.block || 'am',
    meeting: task.meeting ? { ...task.meeting } : null,
    days: sortDays(days),
    start_date: startDate,
    generated: task.date ? [task.date] : [],
    created_at: now.toISOString(),
  };
}

/**
 * Tareas nuevas que tocan en `date` (sin repetir días ya creados).
 * newId(): genera ids. Devuelve { tasks, routines } con las rutinas actualizadas
 * (solo cambia `generated`); si no hay nada que crear, tasks = [].
 */
export function dueInstances(routines, date, { newId, orderFor, now = new Date() }) {
  const weekday = weekdayOf(date);
  const created = [];
  const oldest = toISO(new Date(parseISO(date).getTime() - KEEP_GENERATED_DAYS * 86400000));
  const next = routines.map((r) => {
    if (!r.days.includes(weekday) || date < r.start_date || r.generated.includes(date)) return r;
    created.push({
      id: newId(),
      title: r.title,
      note: '',
      date,
      block: r.block,
      order: orderFor(date, r.block) + created.filter((t) => t.block === r.block).length,
      minutes: r.minutes,
      certainty: r.certainty,
      epic_id: r.epic_id,
      dependencies: [],
      done: false,
      done_at: null,
      time_entries: [],
      comments: [],
      doc: '',
      doc_updated_at: null,
      meeting: r.meeting ? { ...r.meeting } : null,
      routine_id: r.id,
      created_at: now.toISOString(),
    });
    return { ...r, generated: [...r.generated.filter((d) => d >= oldest), date] };
  });
  return { tasks: created, routines: created.length ? next : routines };
}

/** Días de hoy en adelante que se pueden materializar al mirarlos (no más de 2 semanas). */
export function materializableDates(today, viewDate) {
  const dates = [today];
  if (viewDate > today && viewDate <= shiftDate(today, 14)) dates.push(viewDate);
  return dates;
}
