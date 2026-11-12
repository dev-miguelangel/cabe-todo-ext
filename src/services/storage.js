// Datos guardados: valores por defecto, normalización y respaldo. Dónde se guardan lo decide
// storage-backend.js (chrome.storage en la extensión, IndexedDB en la versión web).

import { getRaw, setRaw, watchRaw } from './storage-backend.js';
import { DEFAULT_BLOCKS, migrateBlocks } from '../core/blocks.js';
import { TAB_IDS, normalizeTabOrder } from '../core/tabs.js';
import { DEFAULT_TEMPLATES, DEFAULT_TEMPLATE_ID, normalizeTemplates } from '../core/templates.js';

const DEFAULT_SETTINGS = {
  blocks: DEFAULT_BLOCKS, // bloques del día (Ajustes): de 1 a 5, sin superponerse
  default_minutes: 30,
  notify: true,
  timer_sound: true,
  float_timer: true,
  theme: 'chrome',  // 'chrome' (oscuro) | 'trello' (claro)
  calibrate: true,  // ajustar el pronóstico según cuánto tardas de verdad
  meeting_lead: 10, // minutos antes de una reunión en que aparece su cuenta regresiva
  tab_order: TAB_IDS, // orden de las pestañas del menú inferior
  templates: DEFAULT_TEMPLATES, // plantillas de documentación (Ajustes → Plantillas)
  default_template: DEFAULT_TEMPLATE_ID,
};

// Colores de épicas: solo los tonos de la paleta (Cod Gray es el fondo, no sirve como color de épica).
// Ordenados para que las primeras épicas se distingan lo más posible.
export const PALETTE = ['#1db954', '#b1f2b1', '#6fdc7c', '#1dd75e'];

/** Épicas guardadas con colores de antes: pasarlas a la paleta. */
function normalizeEpics(epics) {
  return epics.map((e, i) => (PALETTE.includes(e.color) ? e : { ...e, color: PALETTE[i % PALETTE.length] }));
}

// Identifica a esta ventana: así ignoramos los avisos de cambio que provocamos nosotros mismos.
const WRITER_ID = Math.random().toString(36).slice(2);

/** Completa campos que no existían en versiones anteriores. */
export function normalizeTask(task) {
  return {
    certainty: 'normal',
    dependencies: [],
    epic_id: null,
    done_at: null,
    time_entries: [],
    comments: [],
    doc: '',
    doc_updated_at: null,
    pinned_at: null,        // anclada arriba en Docs (fecha en que se ancló)
    meeting: null,          // { start: 'HH:MM', end: 'HH:MM', blocking } si es reunión
    routine_id: null,       // rutina que la creó (tarea que se repite)
    ...task,
  };
}

export async function loadData() {
  const { tasks = [], epics = [], settings = {}, routines = [] } = await getRaw(['tasks', 'epics', 'settings', 'routines']);
  return {
    tasks: tasks.map(normalizeTask),
    routines,
    epics: normalizeEpics(epics),
    settings: withDefaults(settings),
  };
}

/** Completa ajustes faltantes. Los de antes ({ am, pm } fijos) pasan a `blocks` con ids 'am' y 'pm'. */
function withDefaults(settings) {
  const merged = { ...DEFAULT_SETTINGS, ...migrateBlocks(settings) };
  const templates = normalizeTemplates(merged.templates);
  const defaultId = templates.some((t) => t.id === merged.default_template) ? merged.default_template : templates[0].id;
  return { ...merged, tab_order: normalizeTabOrder(merged.tab_order), templates, default_template: defaultId };
}

export function saveData({ tasks, epics, routines }) {
  return setRaw({ tasks, epics, ...(routines ? { routines } : {}), meta: { writer: WRITER_ID, at: Date.now() } });
}

export function saveSettings(settings) {
  return setRaw({ settings, meta: { writer: WRITER_ID, at: Date.now() } });
}

// ---------- Respaldo (exportar / importar) ----------

export const BACKUP_APP = 'cabe-todo';
/** Respaldos hechos cuando la app se llamaba Pert-day: se siguen aceptando. */
const LEGACY_BACKUP_APPS = ['pert-day'];

/** Objeto listo para JSON.stringify con todo lo guardado. */
export function makeBackup({ tasks, epics, settings, routines = [] }) {
  return { app: BACKUP_APP, version: 1, exported_at: new Date().toISOString(), tasks, epics, routines, settings };
}

/**
 * Valida un respaldo (texto JSON) y lo devuelve normalizado.
 * Lanza un Error con un mensaje para mostrar si el archivo no sirve.
 */
export function parseBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  if (!data || ![BACKUP_APP, ...LEGACY_BACKUP_APPS].includes(data.app) || !Array.isArray(data.tasks) || !Array.isArray(data.epics)) {
    throw new Error('El archivo no es un respaldo de Cabe Todo.');
  }
  const okTask = (t) => t && typeof t.id === 'string' && typeof t.title === 'string' && Number.isFinite(t.minutes);
  const okEpic = (e) => e && typeof e.id === 'string' && typeof e.name === 'string';
  if (!data.tasks.every(okTask) || !data.epics.every(okEpic)) throw new Error('El respaldo tiene tareas o épicas dañadas.');
  return {
    tasks: data.tasks.map(normalizeTask),
    epics: normalizeEpics(data.epics),
    routines: Array.isArray(data.routines) ? data.routines.filter((r) => r && typeof r.id === 'string' && Array.isArray(r.days)) : [],
    settings: withDefaults(data.settings && typeof data.settings === 'object' ? data.settings : {}),
  };
}

/** Avisa cuando OTRA ventana con el panel abierto cambia los datos. */
export function onDataChanged(callback) {
  watchRaw((changes) => {
    if (changes.meta?.writer === WRITER_ID) return;
    const data = {};
    if ('tasks' in changes) data.tasks = (changes.tasks || []).map(normalizeTask);
    if ('epics' in changes) data.epics = normalizeEpics(changes.epics || []);
    if ('settings' in changes) data.settings = withDefaults(changes.settings || {});
    if ('routines' in changes) data.routines = changes.routines || [];
    if (data.tasks || data.epics || data.settings || data.routines) callback(data);
  });
}
