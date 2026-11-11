// Wrapper de chrome.storage.local. Si se abre panel.html fuera de la extensión
// (por ejemplo, directo en el navegador para probar), usa localStorage.

const DEFAULT_SETTINGS = {
  am: { start: '08:00', end: '13:00' },
  pm: { start: '14:00', end: '19:00' },
  default_minutes: 30,
  notify: true,
  timer_sound: true,
  float_timer: true,
  calibrate: true,  // ajustar el pronóstico según cuánto tardas de verdad
  meeting_lead: 10, // minutos antes de una reunión en que aparece su cuenta regresiva
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

const hasChromeStorage = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

async function getRaw(keys) {
  if (hasChromeStorage) return chrome.storage.local.get(keys);
  const out = {};
  for (const k of keys) {
    try {
      const v = localStorage.getItem(`pertday:${k}`);
      if (v !== null) out[k] = JSON.parse(v);
    } catch {
      /* almacenamiento no disponible: se parte vacío */
    }
  }
  return out;
}

async function setRaw(obj) {
  if (hasChromeStorage) return chrome.storage.local.set(obj);
  for (const [k, v] of Object.entries(obj)) {
    try {
      localStorage.setItem(`pertday:${k}`, JSON.stringify(v));
    } catch {
      /* ignorar */
    }
  }
}

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

function withDefaults(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    am: { ...DEFAULT_SETTINGS.am, ...settings.am },
    pm: { ...DEFAULT_SETTINGS.pm, ...settings.pm },
  };
}

export function saveData({ tasks, epics, routines }) {
  return setRaw({ tasks, epics, ...(routines ? { routines } : {}), meta: { writer: WRITER_ID, at: Date.now() } });
}

export function saveSettings(settings) {
  return setRaw({ settings, meta: { writer: WRITER_ID, at: Date.now() } });
}

// ---------- Respaldo (exportar / importar) ----------

export const BACKUP_APP = 'pert-day';

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
  if (!data || data.app !== BACKUP_APP || !Array.isArray(data.tasks) || !Array.isArray(data.epics)) {
    throw new Error('El archivo no es un respaldo de Pert-day.');
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
  if (!hasChromeStorage) return;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.meta?.newValue?.writer === WRITER_ID) return;
    const data = {};
    if (changes.tasks) data.tasks = (changes.tasks.newValue || []).map(normalizeTask);
    if (changes.epics) data.epics = normalizeEpics(changes.epics.newValue || []);
    if (changes.settings) data.settings = withDefaults(changes.settings.newValue || {});
    if (changes.routines) data.routines = changes.routines.newValue || [];
    if (data.tasks || data.epics || data.settings || data.routines) callback(data);
  });
}
