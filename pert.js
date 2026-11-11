// Cálculos PERT del plan. Funciones puras (sin DOM ni chrome.*), fáciles de testear.
//
// Una persona hace una cosa a la vez: dentro de un bloque las tareas son secuenciales,
// las dependencias solo definen el orden, y la suma de TE/varianzas da la probabilidad
// de terminar el bloque a tiempo.

import { toISO, shiftDate, toMinutes, nowMinutes } from './dates.js';

/** Multiplicadores de O y P sobre M según la certeza del usuario. */
export const CERTAINTY = {
  fixed: { o: 1, p: 1 },          // reuniones: duración fija, sin incertidumbre
  sure: { o: 0.9, p: 1.3 },
  normal: { o: 0.75, p: 2 },
  unsure: { o: 0.5, p: 3 },
};

const BLOCKS = ['am', 'pm'];
const MAX_FORECAST_DAYS = 366;

/** Minutos disponibles en un bloque { start: "08:00", end: "13:00" }. */
export function blockCapacity(range) {
  return Math.max(0, toMinutes(range.end) - toMinutes(range.start));
}

/** ¿La hora actual (Date) cae dentro del bloque? */
export function isNowInBlock(range, now = new Date()) {
  const current = nowMinutes(now);
  return current >= toMinutes(range.start) && current < toMinutes(range.end);
}

/** Bloque por defecto según la hora: antes del fin de la mañana → am, si no → pm. */
export function currentBlock(settings, now = new Date()) {
  const current = nowMinutes(now);
  return current < toMinutes(settings.am.end) ? 'am' : 'pm';
}

/** O, M, P, TE y varianza de una tarea a partir de su única duración (M) y su certeza. */
export function estimate(task) {
  const k = CERTAINTY[task.certainty] || CERTAINTY.normal;
  const m = task.minutes;
  const o = m * k.o;
  const p = m * k.p;
  return { o, m, p, te: (o + 4 * m + p) / 6, variance: ((p - o) / 6) ** 2 };
}

/** Normal acumulada Φ(z) (aproximación de Abramowitz-Stegun, error < 1.5e-7). */
export function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - poly * Math.exp(-x * x);
  return 0.5 * (1 + (z < 0 ? -erf : erf));
}

/**
 * Orden de ejecución dentro de un bloque: topológico por dependencias (solo las del
 * mismo bloque), resolviendo empates con el `order` manual. Si hubiera un ciclo,
 * las tareas restantes se agregan por `order` (no debería pasar: se bloquean al crearlas).
 */
export function orderBlock(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const pendingDeps = new Map();
  const children = new Map();
  for (const t of tasks) {
    pendingDeps.set(t.id, 0);
    children.set(t.id, []);
  }
  for (const t of tasks) {
    for (const dep of t.dependencies || []) {
      if (dep !== t.id && byId.has(dep)) {
        pendingDeps.set(t.id, pendingDeps.get(t.id) + 1);
        children.get(dep).push(t.id);
      }
    }
  }

  const result = [];
  const ready = tasks.filter((t) => pendingDeps.get(t.id) === 0);
  while (ready.length) {
    ready.sort((a, b) => a.order - b.order);
    const t = ready.shift();
    result.push(t);
    for (const childId of children.get(t.id)) {
      const left = pendingDeps.get(childId) - 1;
      pendingDeps.set(childId, left);
      if (left === 0) ready.push(byId.get(childId));
    }
  }

  if (result.length < tasks.length) {
    const placed = new Set(result.map((t) => t.id));
    result.push(...tasks.filter((t) => !placed.has(t.id)).sort((a, b) => a.order - b.order));
  }
  return result;
}

// ---------- Reuniones ----------

export const isMeeting = (task) => Boolean(task.meeting);

/** Rango de la reunión en minutos desde medianoche. */
export function meetingRange(task) {
  return { start: toMinutes(task.meeting.start), end: toMinutes(task.meeting.end) };
}

/** Bloque al que pertenece una hora: antes del fin de la mañana → am; si no → pm. */
export function blockForTime(hhmm, settings) {
  return toMinutes(hhmm) < toMinutes(settings.am.end) ? 'am' : 'pm';
}

/** Intervalos ocupados por reuniones que bloquean (pendientes), recortados a [lo, hi] y unidos. */
export function blockedIntervals(tasks, lo, hi) {
  const raw = tasks
    .filter((t) => isMeeting(t) && t.meeting.blocking && !t.done)
    .map(meetingRange)
    .map((r) => ({ start: Math.max(lo, r.start), end: Math.min(hi, r.end) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ ...r });
  }
  return merged;
}

const totalOf = (intervals) => intervals.reduce((sum, r) => sum + (r.end - r.start), 0);

/** Si `t` cae dentro de una reunión que bloquea, se corre a su término. */
function skipBlocked(t, intervals) {
  let cur = t;
  for (const r of intervals) if (cur >= r.start && cur < r.end) cur = r.end;
  return cur;
}

/**
 * Avanza `minutes` de trabajo desde `t` saltando las reuniones que bloquean:
 * la tarea se pausa durante la reunión y sigue después.
 */
export function advance(t, minutes, intervals) {
  let cur = skipBlocked(t, intervals);
  let left = minutes;
  for (const r of intervals) {
    if (r.end <= cur) continue;
    if (r.start >= cur + left) break;
    left -= r.start - cur;
    cur = r.end;
  }
  return cur + left;
}

/**
 * Planifica un bloque.
 * @param tasks   tareas del bloque (cualquier orden), incluidas reuniones
 * @param range   { start, end } del bloque
 * @param nowMin  minutos desde medianoche de "ahora" si es hoy; null para un día futuro;
 *                24*60 para un día pasado.
 * @returns items en el orden en que se ven (reuniones en su horario) con hora estimada y holgura,
 *          y el pronóstico del bloque.
 *
 * Las reuniones tienen hora fija. Si bloquean, ese tiempo no está disponible para tareas
 * (se pausan y siguen después); si no bloquean, solo se muestran en su horario.
 */
export function scheduleBlock(tasks, range, nowMin = null) {
  const startMin = toMinutes(range.start);
  const endMin = toMinutes(range.end);
  const from = Math.min(endMin, Math.max(startMin, nowMin ?? startMin));

  const meetings = tasks.filter(isMeeting).sort((a, b) => meetingRange(a).start - meetingRange(b).start);
  const flexible = tasks.filter((t) => !isMeeting(t));
  const blockedAhead = blockedIntervals(meetings, from, endMin);       // lo que queda del bloque
  const blockedAll = blockedIntervals(meetings, startMin, endMin);     // todo el bloque (para la barra)
  const meetingEnd = new Map(meetings.map((m) => [m.id, meetingRange(m).end]));

  let cursor = from;
  let mu = 0;
  let variance = 0;
  let doneMinutes = 0;
  let pendingCount = 0;

  const flexItems = orderBlock(flexible).map((task) => {
    const est = estimate(task);
    if (task.done) {
      doneMinutes += task.minutes;
      return { task, est, start: null, finish: null, slack: null };
    }
    pendingCount += 1;
    // Si depende de una reunión pendiente de este bloque, empieza cuando esta termina
    let earliest = cursor;
    for (const dep of task.dependencies || []) {
      const end = meetingEnd.get(dep);
      const m = end !== undefined && meetings.find((x) => x.id === dep);
      if (m && !m.done) earliest = Math.max(earliest, end);
    }
    const start = skipBlocked(earliest, blockedAhead);
    const finish = advance(start, est.te, blockedAhead);
    cursor = finish;
    mu += est.te;
    variance += est.variance;
    return { task, est, start, finish, slack: endMin - finish };
  });

  // Mezclar: cada reunión va antes de la primera tarea pendiente que empieza a su hora o después
  const meetingItems = meetings.map((task) => {
    const r = meetingRange(task);
    return { task, est: estimate(task), start: r.start, finish: r.end, slack: null, meeting: true };
  });
  const items = [];
  let mi = 0;
  for (const item of flexItems) {
    if (item.start !== null) {
      while (mi < meetingItems.length && meetingItems[mi].start <= item.start) items.push(meetingItems[mi++]);
    }
    items.push(item);
  }
  while (mi < meetingItems.length) items.push(meetingItems[mi++]);

  const remaining = endMin - from - totalOf(blockedAhead);
  const sigma = Math.sqrt(variance);
  let probability = null;
  if (pendingCount > 0) {
    if (remaining <= 0) probability = 0;
    else if (sigma === 0) probability = mu <= remaining ? 1 : 0;
    else probability = normalCdf((remaining - mu) / sigma);
  }

  return {
    items,
    capacity: endMin - startMin,
    remaining,
    meetingMinutes: totalOf(blockedAll),
    mu,
    sigma,
    doneMinutes,
    pendingCount,
    probability,
  };
}

/** Ids de tareas críticas: no hechas y con al menos una tarea pendiente que depende de ellas. */
export function criticalIds(dayTasks) {
  const byId = new Map(dayTasks.map((t) => [t.id, t]));
  const ids = new Set();
  for (const t of dayTasks) {
    if (t.done) continue;
    for (const dep of t.dependencies || []) {
      const pred = byId.get(dep);
      if (pred && !pred.done) ids.add(dep);
    }
  }
  return ids;
}

/** ¿Hacer que `taskId` dependa de `predId` crearía un ciclo? (también si son la misma tarea) */
export function wouldCreateCycle(dayTasks, taskId, predId) {
  if (taskId === predId) return true;
  const byId = new Map(dayTasks.map((t) => [t.id, t]));
  const seen = new Set();
  const stack = [predId];
  while (stack.length) {
    const id = stack.pop();
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    const t = byId.get(id);
    if (t) stack.push(...(t.dependencies || []));
  }
  return false;
}

/**
 * Regla: una tarea no puede estar en la mañana si algo de lo que depende está en la tarde.
 * Mueve esas tareas (y en cascada sus dependientes) al final de la tarde.
 * Muta `dayTasks` y devuelve [{ task, because }] con lo que se movió.
 */
export function enforceBlockOrder(dayTasks) {
  const byId = new Map(dayTasks.map((t) => [t.id, t]));
  const moved = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of dayTasks) {
      if (t.block !== 'am' || isMeeting(t)) continue; // las reuniones tienen hora fija
      const blocker = (t.dependencies || []).map((id) => byId.get(id)).find((p) => p && p.block === 'pm');
      if (!blocker) continue;
      const pmOrders = dayTasks.filter((x) => x.block === 'pm').map((x) => x.order);
      t.block = 'pm';
      t.order = pmOrders.length ? Math.max(...pmOrders) + 1 : 0;
      moved.push({ task: t, because: blocker });
      changed = true;
    }
  }
  return moved;
}

// ---------- Épicas y dependencias entre días ----------

/**
 * ¿Puede `task` depender de `pred`?
 * Sí si están planificadas el mismo día, o si son de la misma épica (aunque estén en días
 * distintos o en la bandeja sin fecha).
 */
export function canDepend(task, pred) {
  if (!task || !pred || task.id === pred.id) return false;
  if (task.date && pred.date && task.date === pred.date) return true;
  return Boolean(task.epic_id && task.epic_id === pred.epic_id);
}

/** Quita dependencias rotas o que dejaron de ser válidas. Muta y devuelve cuántas quitó. */
export function pruneInvalidDeps(tasks) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  let removed = 0;
  for (const t of tasks) {
    const deps = t.dependencies || [];
    const keep = deps.filter((id) => canDepend(t, byId.get(id)));
    if (keep.length !== deps.length) {
      removed += deps.length - keep.length;
      t.dependencies = keep;
    }
  }
  return removed;
}

/** Predecesoras que bloquean una tarea: todas las que todavía no están hechas. */
export function blockersOf(task, byId) {
  if (task.done) return [];
  return (task.dependencies || [])
    .map((id) => byId.get(id))
    .filter((p) => p && !p.done);
}

/**
 * Pronóstico de una épica: progreso, trabajo restante y (si tiene fecha objetivo)
 * probabilidad de terminarla a tiempo con los bloques que quedan hasta esa fecha,
 * descontando lo que ya ocupan en ellos las tareas de otras épicas.
 */
export function epicForecast(epic, tasks, settings, now = new Date()) {
  const own = tasks.filter((t) => t.epic_id === epic.id);
  const pending = own.filter((t) => !t.done);

  let mu = 0;
  let variance = 0;
  for (const t of pending) {
    const est = estimate(t);
    mu += est.te;
    variance += est.variance;
  }
  const sigma = Math.sqrt(variance);
  const avgBlock = (blockCapacity(settings.am) + blockCapacity(settings.pm)) / 2 || 1;

  let capacity = null;
  let probability = null;
  if (epic.target_date && pending.length) {
    const today = toISO(now);
    const current = nowMinutes(now);
    capacity = 0;
    let day = today;
    for (let i = 0; i < MAX_FORECAST_DAYS && day <= epic.target_date; i += 1) {
      for (const block of BLOCKS) {
        const range = settings[block];
        const start = toMinutes(range.start);
        const end = toMinutes(range.end);
        const from = day === today ? Math.min(end, Math.max(start, current)) : start;
        let free = end - from;
        for (const t of tasks) {
          if (t.date === day && t.block === block && !t.done && t.epic_id !== epic.id
            && !(isMeeting(t) && !t.meeting.blocking)) free -= estimate(t).te;
        }
        capacity += Math.max(0, free);
      }
      day = shiftDate(day, 1);
    }
    if (capacity <= 0) probability = 0;
    else if (sigma === 0) probability = mu <= capacity ? 1 : 0;
    else probability = normalCdf((capacity - mu) / sigma);
  }

  return {
    total: own.length,
    doneCount: own.length - pending.length,
    pendingCount: pending.length,
    mu,
    sigma,
    blocks: mu / avgBlock,
    capacity,
    probability,
  };
}

// ---------- Sugerencias ----------

const SUGGEST_BELOW = 0.5;

/**
 * Para un bloque con baja probabilidad de terminar a tiempo, busca UNA tarea para mover
 * a otro bloque que lo arregle (o mejore) sin trasladar el problema al destino.
 *
 * source:  { tasks, range, nowMin }
 * targets: [{ ...cualquier dato del destino, tasks, range, nowMin }]
 * options: critical  — ids de tareas de las que depende otra (no se sugiere moverlas)
 *          canMove(task, target) — filtro extra (dependencias, etc.)
 * Devuelve { task, target, before, sourceProbability, targetProbability } o null.
 */
export function suggestMove(source, targets, { critical = new Set(), canMove = () => true } = {}) {
  const before = scheduleBlock(source.tasks, source.range, source.nowMin).probability;
  if (before === null || before >= SUGGEST_BELOW) return null;

  let best = null;
  for (const task of source.tasks) {
    if (task.done || critical.has(task.id) || isMeeting(task)) continue;
    const rest = source.tasks.filter((t) => t !== task);
    const sourceProbability = scheduleBlock(rest, source.range, source.nowMin).probability ?? 1;
    for (const target of targets) {
      if (!canMove(task, target)) continue;
      const moved = { ...task, order: Number.MAX_SAFE_INTEGER, dependencies: [] };
      const targetProbability = scheduleBlock([...target.tasks, moved], target.range, target.nowMin).probability;
      if (targetProbability === null || targetProbability < SUGGEST_BELOW) continue;
      const score = Math.min(sourceProbability, targetProbability);
      const better = !best
        || score > best.score + 1e-9
        || (Math.abs(score - best.score) <= 1e-9 && task.minutes < best.task.minutes);
      if (better) best = { task, target, score, before, sourceProbability, targetProbability };
    }
  }
  return best && best.score > before ? best : null;
}

// ---------- Reunión que bloquea en curso ----------

/** ¿La reunión está en curso ahora y bloquea la toma de tareas? */
export function isBlockingNow(task, now = new Date()) {
  if (!isMeeting(task) || !task.meeting.blocking || task.done || task.date !== toISO(now)) return false;
  const cur = nowMinutes(now);
  return toMinutes(task.meeting.start) <= cur && cur < toMinutes(task.meeting.end);
}

/** Reunión que bloquea y está en curso ahora (la que empezó primero), o null. */
export function activeBlockingMeeting(tasks, now = new Date()) {
  return tasks
    .filter((t) => isBlockingNow(t, now))
    .sort((a, b) => toMinutes(a.meeting.start) - toMinutes(b.meeting.start))[0] || null;
}

/**
 * Si no se puede iniciar el temporizador de `task` ahora, devuelve la reunión que lo impide.
 * Durante una reunión que bloquea solo pueden correr las reuniones que bloquean en curso.
 */
export function timerBlockedBy(task, tasks, now = new Date()) {
  if (isBlockingNow(task, now)) return null;
  return activeBlockingMeeting(tasks, now);
}
