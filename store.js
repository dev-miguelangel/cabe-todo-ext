// Estado de la app y todas las acciones que lo cambian.
// Las vistas leen `state` y llaman acciones; cada acción termina en commit(), que aplica
// las reglas, guarda y avisa a los suscriptores para re-renderizar.

import {
  loadData, saveData, saveSettings as saveSettingsRaw, onDataChanged, PALETTE, makeBackup, parseBackup,
} from './storage.js';
import {
  calibrationFrom, setCalibration,
  enforceBlockOrder, pruneInvalidDeps, wouldCreateCycle, canDepend, isMeeting, blockForTime, timerBlockedBy,
} from './pert.js';
import { parseQuickAdd, tagKey } from './parser.js';
import { routineFrom, dueInstances, materializableDates, repeatLabel } from './routines.js';
import { todayISO } from './dates.js';
import { isRunning, timerConflicts } from './timer.js';

export { PALETTE } from './storage.js';

export const state = {
  tasks: [],
  epics: [],
  routines: [],     // tareas que se repiten (moldes)
  settings: null,
  viewDate: todayISO(),
  tab: 'day',        // 'day' | 'epics'
  filter: null,      // id de épica para resaltar en la vista del día
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
    if (state.filter && !findEpic(state.filter)) state.filter = null;
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

/** Cambios solo de vista (pestaña, día, filtro): no se guardan. */
export function setView(changes) {
  Object.assign(state, changes);
  if (changes.viewDate && ensureRoutines()) return; // ensureRoutines ya guardó y avisó
  emit();
}

function commit() {
  const removed = pruneInvalidDeps(state.tasks);
  if (removed) {
    notify(`Se ${removed > 1 ? `quitaron ${removed} dependencias` : 'quitó 1 dependencia'}: entre días distintos solo se puede depender de tareas de la misma épica.`);
  }
  const dates = new Set(state.tasks.map((t) => t.date).filter(Boolean));
  for (const date of dates) {
    const moved = enforceBlockOrder(state.tasks.filter((t) => t.date === date));
    if (moved.length) {
      const { task, because } = moved[0];
      const extra = moved.length > 1 ? ` (y ${moved.length - 1} más)` : '';
      notify(`"${task.title}"${extra} pasó a la tarde: va después de "${because.title}".`);
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
export const dayTasks = (date = state.viewDate) => state.tasks.filter((t) => t.date === date);
export const blockTasks = (block, date = state.viewDate) => dayTasks(date).filter((t) => t.block === block);
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
  if (state.filter === id) state.filter = null;
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
  if (state.filter === id) state.filter = null;
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
 */
export function addFromText(text, where) {
  const parsed = parseQuickAdd(text);
  if (!parsed) return false;

  let epicId = where.epicId || null;
  if (!epicId && parsed.epicTag) epicId = resolveEpicTag(parsed.epicTag)?.id || null;

  let date;
  let block;
  if (where.epicId) {
    date = parsed.block ? state.viewDate : null;
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
    certainty: parsed.certainty || 'normal',
    epic_id: epicId,
    dependencies: [],
    done: false,
    done_at: null,
    time_entries: [],
    comments: [],
    created_at: new Date().toISOString(),
  };
  // "cada día" / "hábiles" / "cada lun,jue": crear la rutina
  if (parsed.repeat) {
    const routine = routineFrom(task, { id: newId('r'), days: parsed.repeat, startDate: date || todayISO() });
    state.routines.push(routine);
    if (!date) {
      // Desde el backlog: solo el molde; las tareas aparecen solas en los días que tocan
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
  if (task.routine_id) notify(`↻ "${task.title}" se repite ${repeatLabel(parsed.repeat)}.`);
  return task;
}

// ---------- Rutinas (tareas que se repiten) ----------

export const findRoutine = (id) => (id ? state.routines.find((r) => r.id === id) : null);

/**
 * Crea las tareas de las rutinas que tocan hoy (y el día que se está mirando, si es próximo).
 * save=false: solo prepara (quien llama hace commit). Devuelve true si creó algo.
 */
export function ensureRoutines(save = true) {
  if (!state.routines.length) return false;
  let created = 0;
  for (const date of materializableDates(todayISO(), state.viewDate)) {
    const { tasks, routines } = dueInstances(state.routines, date, { newId: () => newId('t'), orderFor: nextOrder });
    if (!tasks.length) continue;
    state.tasks.push(...tasks);
    state.routines = routines;
    created += tasks.length;
  }
  if (created && save) commit();
  return created > 0;
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
  const parsed = parseQuickAdd(text);
  if (!parsed) return false;
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
  if (parsed.block) {
    changes.block = parsed.block;
    if (!findTask(id)?.date) changes.date = state.viewDate;
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

export function planTask(id, block, date = state.viewDate) {
  updateTask(id, { date, block });
}

/** Mueve varias tareas de una vez (un solo guardado: las dependencias entre ellas se conservan). */
export function planMany(ids, block, date = state.viewDate) {
  let order = nextOrder(date, block);
  for (const id of ids) {
    const t = findTask(id);
    if (t) Object.assign(t, { date, block, order: order++ });
  }
  commit();
}

/** Envía varias tareas al backlog (sin fecha) de una vez. */
export function unplanMany(ids) {
  let order = nextOrder(null, null);
  for (const id of ids) {
    const t = findTask(id);
    if (t) Object.assign(t, { date: null, block: null, order: order++ });
  }
  commit();
}

/** Pendientes de días anteriores a `today` (las reuniones pasadas no se arrastran). */
export const overdueTasks = (today) =>
  state.tasks.filter((t) => t.date && t.date < today && !t.done && !isMeeting(t));

// ---------- Ajustes ----------

/** Valida y guarda ajustes. Devuelve un mensaje de error o null. */
export function saveSettings(next) {
  const m = (hhmm) => {
    const [h, min] = hhmm.split(':').map(Number);
    return h * 60 + min;
  };
  if (!(m(next.am.start) < m(next.am.end))) return 'La mañana debe terminar después de empezar.';
  if (!(m(next.pm.start) < m(next.pm.end))) return 'La tarde debe terminar después de empezar.';
  if (m(next.am.end) > m(next.pm.start)) return 'La tarde debe empezar cuando termina la mañana o después.';
  state.settings = { ...state.settings, ...next };
  saveSettingsRaw(state.settings);
  emit();
  return null;
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
  if (state.filter && !findEpic(state.filter)) state.filter = null;
  saveSettingsRaw(state.settings);
  commit();
}

export function unplanTask(id) {
  updateTask(id, { date: null, block: null });
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
