// Mezclar datos de dos equipos (respaldo con "Mezclar" o sincronización con Drive). Funciones puras.
//
// Reglas:
// - Tareas, épicas y rutinas se comparan por id; si existe en los dos lados gana el `updated_at` más
//   reciente (completo). Lo que no tiene `updated_at` (datos de antes) cuenta como lo más antiguo.
// - Borrados: `deleted` = { id: fecha }. Un borrado gana si es posterior a la última edición; así lo que
//   se borró en un equipo no "revive" al mezclar con otro. Se olvidan después de TOMBSTONE_DAYS.
// - Comentarios: se unen por id (también se borran con `deleted`); si un comentario se editó en los dos
//   lados, gana la edición más reciente.
// - Rutinas: `generated` (días ya creados) se une siempre y no cuenta como edición.
// - Ajustes: por partes (SETTINGS_GROUPS), cada una con su fecha en `settings.updated`: cambiar las
//   plantillas en un equipo no pisa los bloques cambiados en otro. El tema es de cada equipo: no viaja.

export const TOMBSTONE_DAYS = 60;

/** Partes de los ajustes que se sincronizan por separado (el tema no: cada equipo tiene el suyo). */
export const SETTINGS_GROUPS = {
  blocks: { label: 'bloques del día', keys: ['blocks'] },
  templates: { label: 'plantillas', keys: ['templates', 'default_template'] },
  tabs: { label: 'menú inferior', keys: ['tab_order'] },
  prefs: { label: 'preferencias', keys: ['default_minutes', 'notify', 'timer_sound', 'float_timer', 'calibrate', 'meeting_lead'] },
};
const LOCAL_ONLY = ['theme'];

const groupValue = (settings, group) => JSON.stringify(SETTINGS_GROUPS[group].keys.map((k) => settings?.[k] ?? null));

/**
 * Ajustes nuevos con la fecha de las partes que cambiaron respecto de `old` (en settings.updated) y
 * updated_at = la más reciente (para versiones anteriores, que comparan los ajustes completos).
 */
export function stampSettings(old, next, now = new Date().toISOString()) {
  const updated = { ...(old?.updated || {}), ...(next.updated || {}) };
  for (const group of Object.keys(SETTINGS_GROUPS)) {
    if (groupValue(old, group) !== groupValue(next, group)) updated[group] = now;
  }
  const latest = Object.values(updated).sort().pop() || old?.updated_at || null;
  return { ...next, updated, updated_at: latest };
}

/** Todas las partes con la misma fecha (al reemplazar todo con un respaldo). */
export function stampAllSettings(settings, now = new Date().toISOString()) {
  const updated = Object.fromEntries(Object.keys(SETTINGS_GROUPS).map((g) => [g, now]));
  return { ...settings, updated, updated_at: now };
}

/**
 * Fecha de una parte. Los ajustes de versiones anteriores no tienen `updated` y su updated_at vale
 * para todas las partes; con `updated`, una parte sin fecha nunca cambió (cuenta como la más antigua).
 */
const groupStamp = (settings, group) => (settings?.updated
  ? settings.updated[group] || ''
  : settings?.updated_at || '');

/**
 * Mezcla ajustes por partes: de cada una gana la más reciente. El tema (y lo que no está en ninguna
 * parte) se queda como en este equipo. Devuelve { settings, changed: [etiquetas de lo que llegó] }.
 */
export function mergeSettings(local, remote) {
  if (!remote) return { settings: local, changed: [] };
  if (!local) return { settings: remote, changed: [] };
  const out = { ...local, updated: { ...(local.updated || {}) } };
  const changed = [];
  for (const [group, { label, keys }] of Object.entries(SETTINGS_GROUPS)) {
    if (groupStamp(remote, group) <= groupStamp(local, group)) continue;
    for (const key of keys) if (key in remote) out[key] = remote[key];
    out.updated[group] = groupStamp(remote, group);
    if (groupValue(local, group) !== groupValue(out, group)) changed.push(label);
  }
  for (const key of LOCAL_ONLY) if (key in local) out[key] = local[key];
  out.updated_at = Object.values(out.updated).sort().pop() || local.updated_at || null;
  return { settings: changed.length || out.updated_at !== local.updated_at ? out : local, changed };
}

/** Campos que no cuentan como edición al detectar cambios. */
const IGNORED = {
  tasks: ['updated_at'],
  epics: ['updated_at'],
  routines: ['updated_at', 'generated'],
};

function fingerprint(item, ignored) {
  const copy = { ...item };
  for (const key of ignored) delete copy[key];
  return JSON.stringify(copy);
}

/** Huellas de una lista (id → texto) para comparar después qué cambió. */
export function snapshotOf(list, kind) {
  return new Map(list.map((item) => [item.id, fingerprint(item, IGNORED[kind])]));
}

/**
 * Marca `updated_at = now` en lo nuevo o cambiado respecto de `before` (snapshotOf) y devuelve los ids
 * que ya no están (borrados). Modifica los objetos de `list` en su lugar.
 */
export function stampChanges(before, list, kind, now = new Date().toISOString()) {
  const ids = new Set();
  for (const item of list) {
    ids.add(item.id);
    const prev = before.get(item.id);
    if (prev === undefined || prev !== fingerprint(item, IGNORED[kind])) item.updated_at = now;
  }
  return [...before.keys()].filter((id) => !ids.has(id));
}

/** Agrega borrados (id → fecha) y olvida los de hace más de TOMBSTONE_DAYS. Devuelve un objeto nuevo. */
export function addTombstones(deleted, ids, now = new Date()) {
  const out = pruneTombstones(deleted, now);
  for (const id of ids) out[id] = now.toISOString();
  return out;
}

export function pruneTombstones(deleted = {}, now = new Date()) {
  const limit = new Date(now.getTime() - TOMBSTONE_DAYS * 86400000).toISOString();
  return Object.fromEntries(Object.entries(deleted || {}).filter(([, at]) => typeof at === 'string' && at >= limit));
}

const stamp = (item) => item?.updated_at || '';
const commentStamp = (c) => c.updated_at || c.created_at || '';

/** Une los borrados de los dos lados (la fecha más reciente de cada id). */
function mergeTombstones(a = {}, b = {}) {
  const out = { ...a };
  for (const [id, at] of Object.entries(b || {})) if (!out[id] || at > out[id]) out[id] = at;
  return pruneTombstones(out);
}

/** ¿Sigue vivo? (no hay borrado, o se editó después de borrarse en otro lado) */
const alive = (item, deleted) => !deleted[item.id] || stamp(item) > deleted[item.id];

function mergeComments(a = [], b = [], deleted) {
  const byId = new Map(a.map((c) => [c.id, c]));
  for (const c of b) {
    const mine = byId.get(c.id);
    if (!mine || commentStamp(c) > commentStamp(mine)) byId.set(c.id, c);
  }
  return [...byId.values()]
    .filter((c) => !deleted[c.id])
    .sort((x, y) => (x.created_at || '').localeCompare(y.created_at || ''));
}

function mergeList(local = [], remote = [], deleted, combine) {
  const byId = new Map(local.map((item) => [item.id, item]));
  for (const theirs of remote) {
    const mine = byId.get(theirs.id);
    if (!mine) {
      byId.set(theirs.id, theirs);
      continue;
    }
    const winner = stamp(theirs) > stamp(mine) ? theirs : mine;
    byId.set(theirs.id, combine ? combine(winner, mine, theirs) : winner);
  }
  return [...byId.values()].filter((item) => alive(item, deleted));
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** De dos tareas de la misma rutina y día, cuál conservar: la hecha, la con tiempo, la de id fijo, la más nueva. */
function preferInstance(a, b) {
  const score = (t) => [t.done ? 1 : 0, (t.time_entries || []).length ? 1 : 0, t.id === `${t.routine_id}_${t.date}` ? 1 : 0, stamp(t)];
  const [x, y] = [score(a), score(b)];
  for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return x[i] > y[i] ? a : b;
  return a.id < b.id ? a : b;
}

/**
 * Tareas de rutina repetidas (cada equipo creó la del mismo día con otro id, antes de los ids fijos):
 * deja una por rutina y día. Devuelve { tasks, dropped }.
 */
function dedupeRoutineTasks(tasks) {
  const keep = new Map();
  for (const t of tasks) {
    if (!t.routine_id || !t.date) continue;
    const key = `${t.routine_id}|${t.date}`;
    const other = keep.get(key);
    keep.set(key, other ? preferInstance(other, t) : t);
  }
  const kept = new Set([...keep.values()].map((t) => t.id));
  const dropped = tasks.filter((t) => t.routine_id && t.date && !kept.has(t.id)).map((t) => t.id);
  const drop = new Set(dropped);
  return { tasks: tasks.filter((t) => !drop.has(t.id)), dropped };
}

/**
 * Mezcla los datos locales con los de otro equipo.
 * local / remote: { tasks, epics, routines, settings, deleted }.
 * Devuelve { data, summary: { added, updated, removed } } (summary: cambios respecto de lo local).
 */
export function mergeData(local, remote, now = new Date()) {
  let deleted = mergeTombstones(local.deleted, remote.deleted);

  const epics = mergeList(local.epics, remote.epics, deleted);
  const routines = mergeList(local.routines, remote.routines, deleted, (winner, mine, theirs) => ({
    ...winner,
    generated: [...new Set([...(mine.generated || []), ...(theirs.generated || [])])].sort(),
  }));
  let tasks = mergeList(local.tasks, remote.tasks, deleted, (winner, mine, theirs) => ({
    ...winner,
    comments: mergeComments(mine.comments, theirs.comments, deleted),
  }));

  const dedupe = dedupeRoutineTasks(tasks);
  tasks = dedupe.tasks;
  if (dedupe.dropped.length) deleted = addTombstones(deleted, dedupe.dropped, now); // que no vuelvan desde el otro equipo

  // Referencias a lo que ya no existe: dependencias, épica y rutina
  const taskIds = new Set(tasks.map((t) => t.id));
  const epicIds = new Set(epics.map((e) => e.id));
  const routineIds = new Set(routines.map((r) => r.id));
  tasks = tasks.map((t) => {
    const changes = {};
    const deps = (t.dependencies || []).filter((id) => taskIds.has(id));
    const comments = (t.comments || []).filter((c) => !deleted[c.id]);
    if (t.dependencies && deps.length !== t.dependencies.length) changes.dependencies = deps;
    if (t.comments && comments.length !== t.comments.length) changes.comments = comments;
    if (t.epic_id && !epicIds.has(t.epic_id)) changes.epic_id = null;
    if (t.routine_id && !routineIds.has(t.routine_id)) changes.routine_id = null;
    return Object.keys(changes).length ? { ...t, ...changes } : t;
  });


  const { settings, changed: settingsChanged } = mergeSettings(local.settings, remote.settings);

  // Resumen respecto de lo local: totales y por tipo
  const summary = { added: 0, updated: 0, removed: 0 };
  for (const [kind, before, after] of [['tasks', local.tasks, tasks], ['epics', local.epics, epics], ['routines', local.routines, routines]]) {
    const counts = { added: 0, updated: 0, removed: 0 };
    const old = new Map((before || []).map((i) => [i.id, i]));
    const now = new Set(after.map((i) => i.id));
    for (const item of after) {
      if (!old.has(item.id)) counts.added += 1;
      else if (!same(old.get(item.id), item)) counts.updated += 1;
    }
    for (const id of old.keys()) if (!now.has(id)) counts.removed += 1;
    summary[kind] = counts;
    for (const k of ['added', 'updated', 'removed']) summary[k] += counts[k];
  }

  summary.settings = settingsChanged;
  return { data: { tasks, epics, routines, settings, deleted }, summary };
}

const NOUNS = { tasks: 'tarea', epics: 'épica', routines: 'rutina' };
const ADJS = { added: 'nueva', updated: 'actualizada', removed: 'borrada' };

/** "3 tareas nuevas, 1 épica nueva, 2 tareas actualizadas" (o "ya estaba al día"). */
export function mergeSummaryText(summary) {
  const parts = [];
  for (const op of ['added', 'updated', 'removed']) {
    for (const kind of ['tasks', 'epics', 'routines']) {
      const n = summary[kind]?.[op] || 0;
      if (n) parts.push(`${n} ${NOUNS[kind]}${n === 1 ? '' : 's'} ${ADJS[op]}${n === 1 ? '' : 's'}`);
    }
  }
  if (summary.settings?.length) parts.push(`ajustes: ${summary.settings.join(', ')}`);
  return parts.length ? parts.join(', ') : 'ya estaba al día';
}

/**
 * Fecha (ISO) del último cambio de este equipo que vale la pena sincronizar, o ''.
 * No cuentan las tareas de rutina recién creadas y sin tocar (todos los equipos las crean iguales,
 * con el mismo id) ni el tema (no se sincroniza).
 */
export function latestLocalChange({ tasks = [], epics = [], routines = [], settings = null, deleted = {} } = {}) {
  let latest = '';
  const consider = (at) => { if (typeof at === 'string' && at > latest) latest = at; };
  for (const t of tasks) {
    const untouchedRoutine = t.routine_id && t.created_at && t.updated_at
      && Math.abs(Date.parse(t.updated_at) - Date.parse(t.created_at)) < 10000;
    if (!untouchedRoutine) consider(t.updated_at);
  }
  for (const item of [...epics, ...routines]) consider(item.updated_at);
  for (const at of Object.values(deleted || {})) consider(at);
  consider(settings?.updated_at);
  return latest;
}
