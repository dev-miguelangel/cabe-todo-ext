// Estado de la app y todas las acciones que lo cambian.
// Las vistas leen `state` y llaman acciones; cada acción termina en commit(), que aplica
// las reglas, guarda y avisa a los suscriptores para re-renderizar.

import {
  loadData, saveData, saveSettings as saveSettingsRaw, onDataChanged, PALETTE, makeBackup, parseBackup,
} from './storage.js';
import {
  calibrationFrom, setCalibration,
  enforceBlockOrder, pruneInvalidDeps, wouldCreateCycle, canDepend, isMeeting, blockForTime, timerBlockedBy,
} from '../core/pert.js';
import { parseQuickAdd, tagKey } from '../core/parser.js';
import { blocksOf, blockWords, blockName, firstBlock, validateBlocks, neighborBlock, BACKLOG } from '../core/blocks.js';
import { routineFrom, dueInstances, repeatLabel, weekdayOf, ALL_DAYS } from '../core/routines.js';
import { todayISO, shortLabel, shiftDate } from '../utils/dates.js';
import { isRunning, timerConflicts } from '../core/timer.js';

export { PALETTE } from './storage.js';

export const state = {
  tasks: [],
  epics: [],
  routines: [],     // tareas que se repiten (moldes)
  settings: null,
  tab: 'minimal',    // vista abierta: 'minimal' (Hoy) | 'epics' | 'done' | 'docs' | 'settings'
};

// ---------- Suscripción y avisos ----------

const listeners = new Set();
export function subscribe(fn) {
  listeners.add(fn);
}
function emit(info = {}) {
  recalibrate();
  listeners.forEach((fn) => fn(info));
}

/** Historial real vs estimado → factor que usa el PERT (si el ajuste está activo). */
export let calibrationInfo = { factor: 1, samples: 0 };
function recalibrate() {
  calibrationInfo = calibrationFrom(state.tasks);
  setCalibration(state.settings?.calibrate === false ? 1 : calibrationInfo.factor);
}

let notify = () => {};
/** La UI registra aquí cómo mostrar avisos: notify(mensaje, { label, run }?) */
export function setNotifier(fn) {
  notify = fn;
}

export async function initStore() {
  const data = await loadData();
  Object.assign(state, data);
  recalibrate();
  onDataChanged((changed) => {
    Object.assign(state, changed);
    emit({ external: true });
  });
}

/**
 * Relee tareas y épicas del almacenamiento. Útil antes de guardar desde una pestaña que
 * pasa mucho tiempo abierta (documentación), para no pisar cambios recientes del panel.
 */
export async function refreshFromStorage() {
  const data = await loadData();
  state.tasks = data.tasks;
  state.epics = data.epics;
  state.routines = data.routines;
}

/** Cambios solo de vista (pestaña): no se guardan. */
export function setView(changes) {
  Object.assign(state, changes);
  emit();
}

/** Tareas o rutinas con un bloque que ya no existe (p. ej. al restaurar un respaldo): al primer bloque. */
function fixOrphanBlocks() {
  const ids = new Set(blocksOf(state.settings).map((b) => b.id));
  const fallback = firstBlock(state.settings).id;
  for (const t of state.tasks) if (t.date && t.block && !ids.has(t.block)) t.block = fallback;
  for (const r of state.routines) if (r.block && !ids.has(r.block)) r.block = fallback;
}

function commit() {
  fixOrphanBlocks();
  const removed = pruneInvalidDeps(state.tasks);
  if (removed) {
    notify(`Se ${removed > 1 ? `quitaron ${removed} dependencias` : 'quitó 1 dependencia'}: entre días distintos solo se puede depender de tareas de la misma épica.`);
  }
  const dates = new Set(state.tasks.map((t) => t.date).filter(Boolean));
  for (const date of dates) {
    const moved = enforceBlockOrder(state.tasks.filter((t) => t.date === date), state.settings);
    if (moved.length) {
      const { task, because } = moved[0];
      const extra = moved.length > 1 ? ` (y ${moved.length - 1} más)` : '';
      notify(`"${task.title}"${extra} pasó a ${blockName(state.settings, task.block)}: va después de "${because.title}".`);
    }
  }
  saveData({ tasks: state.tasks, epics: state.epics, routines: state.routines });
  emit();
}

// ---------- Consultas ----------

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const findTask = (id) => state.tasks.find((t) => t.id === id);
export const findEpic = (id) => state.epics.find((e) => e.id === id);
export const activeEpics = () => state.epics.filter((e) => !e.archived);
export const archivedEpics = () => state.epics.filter((e) => e.archived);
export const dayTasks = (date = todayISO()) => state.tasks.filter((t) => t.date === date);
export const blockTasks = (block, date = todayISO()) => dayTasks(date).filter((t) => t.block === block);
export const backlogTasks = (epicId) =>
  state.tasks.filter((t) => t.date === null && (epicId === undefined || t.epic_id === epicId));
export const epicTasks = (epicId) => state.tasks.filter((t) => t.epic_id === epicId);

function nextOrder(date, block) {
  const list = date ? blockTasks(block, date) : backlogTasks();
  const orders = list.map((t) => t.order);
  return orders.length ? Math.max(...orders) + 1 : 0;
}

// ---------- Épicas ----------

function pickColor() {
  const used = new Set(activeEpics().map((e) => e.color));
  return PALETTE.find((c) => !used.has(c)) || PALETTE[state.epics.length % PALETTE.length];
}

function createEpicRaw(name) {
  const epic = {
    id: newId('e'),
    name,
    color: pickColor(),
    target_date: null,
    archived: false,
    created_at: new Date().toISOString(),
  };
  state.epics.push(epic);
  return epic;
}

export function createEpic(name) {
  const clean = name.trim();
  if (!clean) return null;
  const existing = activeEpics().find((e) => tagKey(e.name) === tagKey(clean));
  if (existing) {
    notify(`Ya existe la épica "${existing.name}".`);
    return existing;
  }
  const epic = createEpicRaw(clean);
  commit();
  return epic;
}

/** #etiqueta → épica activa con ese nombre; si no existe, la crea. */
function resolveEpicTag(tag) {
  const key = tagKey(tag);
  if (!key) return null;
  const found = activeEpics().find((e) => tagKey(e.name) === key);
  if (found) return found;
  const epic = createEpicRaw(tag.replace(/[-_]+/g, ' '));
  notify(`Nueva épica: "${epic.name}".`);
  return epic;
}

export function renameEpic(id, name) {
  const epic = findEpic(id);
  const clean = name.trim();
  if (!epic || !clean || clean === epic.name) return;
  epic.name = clean;
  commit();
}

export function setEpicTarget(id, date) {
  const epic = findEpic(id);
  if (!epic) return;
  epic.target_date = date || null;
  commit();
}

/** Archivar: las tareas hechas conservan la épica; las pendientes quedan sin épica. */
export function archiveEpic(id) {
  const epic = findEpic(id);
  if (!epic) return;
  epic.archived = true;
  for (const t of epicTasks(id)) if (!t.done) t.epic_id = null;
  commit();
}

export function restoreEpic(id) {
  const epic = findEpic(id);
  if (!epic) return;
  epic.archived = false;
  commit();
}

/** Borrar: ninguna tarea se borra; todas quedan sin épica. */
export function deleteEpic(id) {
  for (const t of epicTasks(id)) t.epic_id = null;
  state.epics = state.epics.filter((e) => e.id !== id);
  commit();
}

function checkEpicComplete(epicId) {
  const epic = findEpic(epicId);
  const own = epicTasks(epicId);
  if (!epic || epic.archived || !own.length || own.some((t) => !t.done)) return;
  notify(`¡Completaste "${epic.name}"!`, { label: 'Archivar', run: () => archiveEpic(epicId) });
}

// ---------- Tareas ----------

/**
 * Crea una tarea desde el texto del quick-add. Devuelve la tarea creada (o false).
 * where: { date, block } para el día, o { epicId } para la bandeja de una épica
 * (en la bandeja, escribir am/pm la planifica directo en el día que se está viendo).
 * "bl" al final la deja en el backlog, se escriba donde se escriba.
 * Un día escrito ("mañana", "viernes") la planifica ese día; "Reunión … 1pm" crea una reunión.
 */
export function addFromText(text, where) {
  const parsed = parseQuickAdd(text, blockWords(state.settings));
  if (!parsed) return false;

  let epicId = where.epicId || null;
  if (!epicId && parsed.epicTag) epicId = resolveEpicTag(parsed.epicTag)?.id || null;

  const today = todayISO();
  const meeting = parsed.meeting;
  let date;
  let block;
  const toBacklog = parsed.block === BACKLOG && !meeting; // una reunión siempre tiene día y hora
  if (meeting) {
    date = parsed.date || (where.epicId ? null : where.date) || today;
    block = blockForTime(meeting.start, state.settings);
  } else if (toBacklog) {
    date = null;
    block = null;
  } else if (parsed.date) {
    // "mañana", "viernes"…: ese día, en el bloque escrito, o en el de este campo si es el mismo día, o en el primero
    date = parsed.date;
    block = parsed.block || (date === where.date && where.block) || firstBlock(state.settings).id;
  } else if (where.epicId) {
    date = parsed.block ? todayISO() : null;
    block = parsed.block || null;
  } else {
    date = where.date;
    block = parsed.block || where.block;
  }

  const task = {
    id: newId('t'),
    title: parsed.title,
    note: '',
    date,
    block,
    order: nextOrder(date, block),
    minutes: parsed.minutes || state.settings.default_minutes,
    certainty: meeting ? 'fixed' : parsed.certainty || 'normal',
    epic_id: epicId,
    dependencies: [],
    done: false,
    done_at: null,
    time_entries: [],
    comments: [],
    meeting: null,
    created_at: new Date().toISOString(),
  };
  if (meeting) {
    // Sin fin ni duración: dura lo de siempre (Ajustes)
    const end = meeting.end || minutesToHHMM(Math.min(toMin(meeting.start) + task.minutes, 23 * 60 + 59));
    task.meeting = { start: meeting.start, end, blocking: true };
    task.minutes = toMin(end) - toMin(meeting.start);
  }
  // "cada día" / "hábiles" / "cada lun,jue": crear la rutina
  if (parsed.repeat) {
    const routine = routineFrom(task, { id: newId('r'), days: parsed.repeat, startDate: date || todayISO(), block: firstBlock(state.settings).id });
    state.routines.push(routine);
    if (!date || !routine.days.includes(weekdayOf(date))) {
      // Desde el backlog (o un día que no le toca, como "cada lunes" escrito un miércoles):
      // solo el molde; las tareas aparecen solas en los días que tocan
      ensureRoutines(false);
      commit();
      notify(`↻ "${task.title}" se repite ${repeatLabel(routine.days)}.`);
      return true;
    }
    task.routine_id = routine.id; // escrita en un día: esta es la de ese día
  }
  state.tasks.push(task);
  if (task.routine_id) ensureRoutines(false);
  commit();
  const day = (iso) => (iso === today ? 'hoy' : shortLabel(iso));
  if (task.routine_id) notify(`↻ "${task.title}" se repite ${repeatLabel(parsed.repeat)}.`);
  else if (meeting) notify(`◷ Reunión "${task.title}": ${day(date)}, ${task.meeting.start}–${task.meeting.end}.`);
  else if (toBacklog && !where.epicId) notify(`"${task.title}" quedó en el backlog.`);
  else if (parsed.date && date !== where.date) notify(`"${task.title}" → ${day(date)}, ${blockName(state.settings, block)}.`);
  return task;
}

// ---------- Rutinas (tareas que se repiten) ----------

export const findRoutine = (id) => (id ? state.routines.find((r) => r.id === id) : null);

/** Cuántos días hacia adelante se crean tareas de rutina al mirarlos (Hoy ‹ ›, próximos 7 días). */
const ROUTINE_HORIZON_DAYS = 14;

/**
 * Crea las tareas de las rutinas que tocan hoy y, si se pide, en otros días próximos que se están mirando.
 * save=false: solo prepara (quien llama hace commit). Devuelve true si creó algo.
 */
export function ensureRoutines(save = true, extraDates = []) {
  if (!state.routines.length) return false;
  const today = todayISO();
  const limit = shiftDate(today, ROUTINE_HORIZON_DAYS);
  const dates = [today, ...extraDates.filter((d) => d > today && d <= limit)];
  let created = 0;
  for (const date of [...new Set(dates)]) {
    const { tasks, routines } = dueInstances(state.routines, date, { newId: () => newId('t'), orderFor: nextOrder });
    if (!tasks.length) continue;
    state.tasks.push(...tasks);
    state.routines = routines;
    created += tasks.length;
  }
  if (created && save) commit();
  return created > 0;
}

// ---------- Rutinas: administrarlas (vista Rutinas y "¿solo esta o todas?") ----------

/** Tareas de una rutina que siguen pendientes (de `from` en adelante, si se indica). */
const pendingInstances = (routineId, from = null) => state.tasks.filter((t) =>
  t.routine_id === routineId && !t.done && (!from || (t.date && t.date >= from)));

/** Próximo día (de hoy en adelante, hasta 2 semanas) en que toca la rutina y su tarea sigue pendiente. */
export function nextOccurrence(routine, from = todayISO()) {
  for (let i = 0; i <= ROUTINE_HORIZON_DAYS; i += 1) {
    const date = shiftDate(from, i);
    if (date < routine.start_date || !routine.days.includes(weekdayOf(date))) continue;
    const task = state.tasks.find((t) => t.routine_id === routine.id && t.date === date);
    if (task ? !task.done : !routine.generated.includes(date)) return date;
  }
  return null;
}

/** Copia el molde a las tareas pendientes de hoy en adelante (salvo `exceptId`). */
function propagateRoutine(routine, exceptId = null) {
  for (const t of pendingInstances(routine.id, todayISO())) {
    if (t.id === exceptId) continue;
    Object.assign(t, {
      title: routine.title,
      minutes: routine.minutes,
      certainty: routine.certainty,
      epic_id: routine.epic_id,
      meeting: routine.meeting ? { ...routine.meeting } : null,
    });
    if (routine.meeting) t.block = blockForTime(routine.meeting.start, state.settings);
    else if (t.block !== routine.block) {
      t.block = routine.block;
      t.order = nextOrder(t.date, t.block);
    }
  }
}

/**
 * Edita una rutina desde la vista Rutinas: { title, days, minutes, block, meeting: { start, end } | null }.
 * Cambia el molde y sus tareas pendientes de hoy en adelante. Devuelve un mensaje de error o null.
 */
export function updateRoutine(id, changes) {
  const routine = findRoutine(id);
  if (!routine) return 'La rutina ya no existe.';
  const title = (changes.title ?? routine.title).trim();
  const days = changes.days ?? routine.days;
  if (!title) return 'Escribe un título.';
  if (!days.length) return 'Elige al menos un día.';
  let { meeting } = routine;
  let minutes = Number(changes.minutes ?? routine.minutes);
  if (changes.meeting !== undefined) meeting = changes.meeting ? { blocking: true, ...routine.meeting, ...changes.meeting } : null;
  if (meeting) {
    if (!meeting.start || !meeting.end) return 'Indica la hora de inicio y de fin.';
    minutes = toMin(meeting.end) - toMin(meeting.start);
    if (minutes <= 0) return 'La reunión debe terminar después de empezar.';
  } else if (!(minutes > 0)) return 'Indica una duración.';
  Object.assign(routine, {
    title,
    days: ALL_DAYS.filter((d) => days.includes(d)),
    minutes,
    meeting,
    block: meeting ? blockForTime(meeting.start, state.settings) : changes.block ?? routine.block,
  });
  propagateRoutine(routine);
  // Tareas ya creadas para días que dejaron de tocar (sin tiempo registrado): fuera
  const today = todayISO();
  state.tasks = state.tasks.filter((t) => !(t.routine_id === id && !t.done && t.date && t.date >= today
    && !routine.days.includes(weekdayOf(t.date)) && !t.time_entries.length));
  ensureRoutines(false);
  commit();
  return null;
}

/**
 * Elimina una rutina: se borran sus tareas pendientes (salvo las que tienen tiempo registrado,
 * que quedan como tareas sueltas) y las hechas se conservan en el historial.
 */
export function deleteRoutine(id) {
  const routine = findRoutine(id);
  if (!routine) return 0;
  const drop = new Set(state.tasks.filter((t) => t.routine_id === id && !t.done && !t.time_entries.length).map((t) => t.id));
  state.tasks = state.tasks.filter((t) => !drop.has(t.id));
  for (const t of state.tasks) {
    if (t.routine_id === id) t.routine_id = null;
    if (t.dependencies.some((d) => drop.has(d))) t.dependencies = t.dependencies.filter((d) => !drop.has(d));
  }
  state.routines = state.routines.filter((r) => r.id !== id);
  commit();
  return drop.size;
}

/** "Aplicar a todas": lo que tiene ahora esta tarea pasa a su rutina y a sus próximas tareas. */
export function applyTaskToRoutine(taskId) {
  const task = findTask(taskId);
  const routine = findRoutine(task?.routine_id);
  if (!task || !routine) return false;
  Object.assign(routine, {
    title: task.title,
    minutes: task.minutes,
    certainty: task.certainty,
    epic_id: task.epic_id ?? null,
    block: task.block || routine.block,
    meeting: task.meeting ? { ...task.meeting } : null,
  });
  propagateRoutine(routine, task.id);
  commit();
  return true;
}

/**
 * Repetir una tarea los días indicados (0 = domingo). Si ya es de una rutina, la actualiza
 * tomando esta tarea como molde (título, duración, bloque, horario…). days vacío = dejar de repetir.
 */
export function setRepeat(taskId, days) {
  const task = findTask(taskId);
  if (!task) return;
  const current = findRoutine(task.routine_id);
  if (!days.length) {
    if (current) state.routines = state.routines.filter((r) => r !== current);
    for (const t of state.tasks) if (t.routine_id === task.routine_id) t.routine_id = null;
    task.routine_id = null;
    commit();
    return;
  }
  const generated = current ? current.generated : [];
  const routine = routineFrom(task, {
    id: current?.id || newId('r'),
    days,
    startDate: current?.start_date || task.date || todayISO(),
    block: firstBlock(state.settings).id,
  });
  routine.generated = [...new Set([...generated, ...routine.generated])];
  if (current) Object.assign(current, routine, { created_at: current.created_at });
  else state.routines.push(routine);
  task.routine_id = routine.id;
  ensureRoutines(false);
  commit();
}

/** Edición en línea: mismo formato del quick-add. Sin #etiqueta = sin épica. */
export function editFromText(id, text) {
  const parsed = parseQuickAdd(text, blockWords(state.settings));
  if (!parsed) return false;
  // "Reunión … 1pm": pasa a ser (o se reprograma como) reunión
  if (parsed.meeting) {
    const task = findTask(id);
    if (!task) return false;
    updateTask(id, { title: parsed.title, epic_id: parsed.epicTag ? resolveEpicTag(parsed.epicTag)?.id || null : task.epic_id });
    const start = parsed.meeting.start;
    const end = parsed.meeting.end || minutesToHHMM(Math.min(toMin(start) + (parsed.minutes || task.minutes), 23 * 60 + 59));
    return setMeeting(id, { date: parsed.date || task.date || todayISO(), start, end, blocking: task.meeting?.blocking ?? true }) === null;
  }
  // Reunión: su horario se cambia en el modal; aquí solo título y épica
  if (isMeeting(findTask(id) || {})) {
    updateTask(id, {
      title: parsed.title,
      epic_id: parsed.epicTag ? resolveEpicTag(parsed.epicTag)?.id || null : null,
    });
    return true;
  }
  const changes = {
    title: parsed.title,
    certainty: parsed.certainty || 'normal',
    epic_id: parsed.epicTag ? resolveEpicTag(parsed.epicTag)?.id || null : null,
  };
  if (parsed.minutes) changes.minutes = parsed.minutes;
  if (parsed.block === BACKLOG) {
    changes.date = null;
    changes.block = null;
  } else if (parsed.date) {
    // "mañana", "viernes"…: a ese día (en el bloque escrito, o en el que tenía)
    changes.date = parsed.date;
    changes.block = parsed.block || findTask(id)?.block || firstBlock(state.settings).id;
  } else if (parsed.block) {
    changes.block = parsed.block;
    if (!findTask(id)?.date) changes.date = todayISO();
  }
  updateTask(id, changes);
  return true;
}

export function updateTask(id, changes) {
  const t = findTask(id);
  if (!t) return;
  const date = 'date' in changes ? changes.date : t.date;
  const block = 'block' in changes ? changes.block : t.block;
  if (date !== t.date || block !== t.block) changes.order = nextOrder(date, block);
  if ('done' in changes && changes.done !== t.done) {
    changes.done_at = changes.done ? new Date().toISOString() : null;
  }
  // Al terminar una tarea, su temporizador se detiene.
  if (changes.done && isRunning(t)) stopEntry(t);
  Object.assign(t, changes);
  commit();
  if (changes.done && t.epic_id) checkEpicComplete(t.epic_id);
}

export function planTask(id, block, date = todayISO()) {
  updateTask(id, { date, block });
}

/** Mueve varias tareas a un día y bloque de una vez (un solo guardado; quedan al final, en su orden). */
export function moveTasks(ids, date, block) {
  let order = nextOrder(date, block);
  for (const id of ids) {
    const t = findTask(id);
    if (t) Object.assign(t, { date, block, order: order++ });
  }
  commit();
}

/** Pendientes de días anteriores a `today` (las reuniones pasadas no se arrastran). */
export const overdueTasks = (today) =>
  state.tasks.filter((t) => t.date && t.date < today && !t.done && !isMeeting(t));

// ---------- Ajustes ----------

/**
 * Valida y guarda ajustes. Devuelve un mensaje de error o null.
 * Si se borra un bloque, sus tareas y rutinas pasan al bloque vecino (el anterior, o el siguiente).
 */
export function saveSettings(next) {
  const blocks = next.blocks ? next.blocks.map((b) => ({ ...b, title: b.title.trim() })) : blocksOf(state.settings);
  const problem = validateBlocks(blocks);
  if (problem) return problem;
  const old = blocksOf(state.settings);
  const removed = old.filter((b) => !blocks.some((x) => x.id === b.id));
  const remap = new Map(removed.map((b) => [b.id, neighborBlock(old, b.id, blocks)]));
  const sorted = blocksOf({ blocks });

  state.settings = { ...state.settings, ...next, blocks: sorted };
  if (remap.size) {
    for (const t of state.tasks) if (remap.has(t.block)) t.block = remap.get(t.block);
    for (const r of state.routines) if (remap.has(r.block)) r.block = remap.get(r.block);
    saveSettingsRaw(state.settings);
    commit(); // reordena y guarda las tareas movidas
    return null;
  }
  saveSettingsRaw(state.settings);
  emit();
  return null;
}

/** Cuántas tareas (pendientes, de hoy en adelante) y rutinas tiene un bloque: para avisar antes de borrarlo. */
export function blockUsage(id) {
  const today = todayISO();
  return {
    tasks: state.tasks.filter((t) => t.block === id && t.date && t.date >= today && !t.done).length,
    routines: state.routines.filter((r) => r.block === id).length,
  };
}

// ---------- Respaldo ----------

/** Todo lo guardado, como texto JSON para descargar. */
export function exportBackup() {
  return JSON.stringify(makeBackup(state), null, 2);
}

/** Lee un respaldo (texto) sin aplicarlo: { data, summary } o lanza Error con el motivo. */
export function readBackup(text) {
  const data = parseBackup(text);
  return { data, summary: { tasks: data.tasks.length, epics: data.epics.length } };
}

/** Reemplaza tareas, épicas y ajustes por los del respaldo. */
export function restoreBackup(data) {
  state.tasks = data.tasks;
  state.epics = data.epics;
  state.routines = data.routines;
  state.settings = data.settings;
  saveSettingsRaw(state.settings);
  commit();
}

export function unplanTask(id) {
  updateTask(id, { date: null, block: null });
}

/** Anclar / desanclar una tarea arriba de la vista Docs. Devuelve si quedó anclada. */
export function togglePin(id) {
  const task = findTask(id);
  if (!task) return false;
  task.pinned_at = task.pinned_at ? null : new Date().toISOString();
  commit();
  return Boolean(task.pinned_at);
}

export function deleteTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  for (const t of state.tasks) {
    if (t.dependencies.includes(id)) t.dependencies = t.dependencies.filter((d) => d !== id);
  }
  commit();
}

// ---------- Temporizador ----------

function stopEntry(task, at = new Date().toISOString()) {
  const last = task.time_entries[task.time_entries.length - 1];
  task.time_entries = [...task.time_entries.slice(0, -1), { ...last, end: at }];
}

/** Inicia (o reanuda) el temporizador. Solo uno corre a la vez: los demás se pausan. */
export function startTimer(id) {
  const task = findTask(id);
  if (!task || isRunning(task)) return;
  const meeting = timerBlockedBy(task, state.tasks);
  if (meeting) {
    notify(`No se pueden iniciar tareas durante "${meeting.title}" (hasta las ${meeting.meeting.end}).`);
    return;
  }
  const conflicts = timerConflicts(task, state.tasks);
  if (conflicts.blockedBy) {
    notify(`"${conflicts.blockedBy.title}" sigue en curso: finalízala antes de iniciar otra tarea.`);
    return;
  }
  const now = new Date().toISOString();
  conflicts.pause.forEach((t) => stopEntry(t, now));
  task.time_entries = [...task.time_entries, { start: now, end: null }];
  commit();
  if (conflicts.pause.length) notify(`Se pausó "${conflicts.pause[0].title}" (solo una tarea corre a la vez).`);
}

/** Pausa el temporizador. Las reuniones no se pausan: se finalizan o se reprograman. */
export function pauseTimer(id) {
  const task = findTask(id);
  if (!task || !isRunning(task)) return;
  if (isMeeting(task)) {
    notify('Las reuniones no se pausan: finalízala o reprográmala.');
    return;
  }
  stopEntry(task);
  commit();
}

/** Finaliza una reunión: la marca como hecha (y su temporizador se detiene). */
export function finishMeeting(id) {
  updateTask(id, { done: true });
}

export function toggleTimer(id) {
  const task = findTask(id);
  if (task) (isRunning(task) ? pauseTimer : startTimer)(id);
}

export function resetTimer(id) {
  const task = findTask(id);
  if (!task) return;
  task.time_entries = [];
  commit();
}

// ---------- Reuniones ----------

const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const minutesToHHMM = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * Convierte la tarea en reunión (o actualiza su horario).
 * m: { date, start: 'HH:MM', end: 'HH:MM', blocking }. Devuelve un mensaje de error o null.
 */
export function setMeeting(id, m) {
  const task = findTask(id);
  if (!task) return 'La tarea ya no existe.';
  if (!m.date) return 'Elige la fecha de la reunión.';
  if (!m.start || !m.end) return 'Indica la hora de inicio y de fin (o la duración).';
  const minutes = toMin(m.end) - toMin(m.start);
  if (minutes <= 0) return 'La reunión debe terminar después de empezar.';
  // Reprogramar (otra fecha u hora de inicio) detiene su temporizador si estaba corriendo
  if (isRunning(task) && task.meeting && (task.date !== m.date || task.meeting.start !== m.start)) stopEntry(task);
  Object.assign(task, {
    meeting: { start: m.start, end: m.end, blocking: Boolean(m.blocking) },
    date: m.date,
    block: blockForTime(m.start, state.settings),
    minutes,
    certainty: 'fixed',
  });
  commit();
  return null;
}

/** Vuelve a ser una tarea normal (conserva fecha, bloque y duración). */
export function removeMeeting(id) {
  const task = findTask(id);
  if (!task || !task.meeting) return;
  task.meeting = null;
  task.certainty = 'normal';
  task.order = nextOrder(task.date, task.block);
  commit();
}

// ---------- Documentación ----------

/** Guarda la documentación (Markdown) de una tarea. */
export function setDoc(taskId, text) {
  const task = findTask(taskId);
  if (!task || task.doc === text) return;
  task.doc = text;
  task.doc_updated_at = new Date().toISOString();
  commit();
}

// ---------- Comentarios ----------

export function addComment(taskId, text) {
  const task = findTask(taskId);
  const clean = text.trim();
  if (!task || !clean) return false;
  const now = new Date().toISOString();
  task.comments = [...task.comments, { id: newId('c'), text: clean, created_at: now, updated_at: null }];
  commit();
  return true;
}

export function editComment(taskId, commentId, text) {
  const task = findTask(taskId);
  const clean = text.trim();
  if (!task || !clean) return false;
  task.comments = task.comments.map((c) =>
    (c.id === commentId ? { ...c, text: clean, updated_at: new Date().toISOString() } : c));
  commit();
  return true;
}

export function deleteComment(taskId, commentId) {
  const task = findTask(taskId);
  if (!task) return;
  task.comments = task.comments.filter((c) => c.id !== commentId);
  commit();
}

/** Activa o quita "taskId va después de predId". Devuelve false si no se pudo. */
export function setDependency(taskId, predId, on) {
  const t = findTask(taskId);
  const pred = findTask(predId);
  if (!t || !pred) return false;
  if (on) {
    if (t.dependencies.includes(predId)) return true;
    if (!canDepend(t, pred)) {
      notify('Solo puede ir después de tareas del mismo día o de su misma épica.');
      return false;
    }
    if (wouldCreateCycle(state.tasks, taskId, predId)) {
      notify('No se puede: crearía un ciclo de dependencias.');
      return false;
    }
    t.dependencies = [...t.dependencies, predId];
  } else {
    t.dependencies = t.dependencies.filter((d) => d !== predId);
  }
  commit();
  return true;
}

/**
 * Guarda el orden tras un drag & drop.
 * lists: [{ date, block, ids }] — date/block null = bandeja.
 */
export function applyOrder(lists) {
  for (const { date, block, ids } of lists) {
    ids.forEach((id, index) => {
      const t = findTask(id);
      if (t) Object.assign(t, { date, block, order: index });
    });
  }
  commit();
}
