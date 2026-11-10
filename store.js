// Estado de la app y todas las acciones que lo cambian.
// Las vistas leen `state` y llaman acciones; cada acción termina en commit(), que aplica
// las reglas, guarda y avisa a los suscriptores para re-renderizar.

import { loadData, saveData, onDataChanged } from './storage.js';
import { enforceBlockOrder, pruneInvalidDeps, wouldCreateCycle, canDepend } from './pert.js';
import { parseQuickAdd, tagKey } from './parser.js';
import { todayISO } from './dates.js';

export const PALETTE = ['#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#14b8a6', '#84cc16'];

export const state = {
  tasks: [],
  epics: [],
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
  listeners.forEach((fn) => fn(info));
}

let notify = () => {};
/** La UI registra aquí cómo mostrar avisos: notify(mensaje, { label, run }?) */
export function setNotifier(fn) {
  notify = fn;
}

export async function initStore() {
  const data = await loadData();
  Object.assign(state, data);
  onDataChanged((changed) => {
    Object.assign(state, changed);
    if (state.filter && !findEpic(state.filter)) state.filter = null;
    emit({ external: true });
  });
}

/** Cambios solo de vista (pestaña, día, filtro): no se guardan. */
export function setView(changes) {
  Object.assign(state, changes);
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
  saveData({ tasks: state.tasks, epics: state.epics });
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
  notify(`🎉 ¡Completaste "${epic.name}"!`, { label: 'Archivar', run: () => archiveEpic(epicId) });
}

// ---------- Tareas ----------

/**
 * Crea una tarea desde el texto del quick-add.
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

  state.tasks.push({
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
    created_at: new Date().toISOString(),
  });
  commit();
  return true;
}

/** Edición en línea: mismo formato del quick-add. Sin #etiqueta = sin épica. */
export function editFromText(id, text) {
  const parsed = parseQuickAdd(text);
  if (!parsed) return false;
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
  Object.assign(t, changes);
  commit();
  if (changes.done && t.epic_id) checkEpicComplete(t.epic_id);
}

export function planTask(id, block, date = state.viewDate) {
  updateTask(id, { date, block });
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
