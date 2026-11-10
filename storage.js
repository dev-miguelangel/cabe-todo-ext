// Wrapper de chrome.storage.local. Si se abre panel.html fuera de la extensión
// (por ejemplo, directo en el navegador para probar), usa localStorage.

const DEFAULT_SETTINGS = {
  am: { start: '08:00', end: '13:00' },
  pm: { start: '14:00', end: '19:00' },
  default_minutes: 30,
  notify: true,
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
    ...task,
  };
}

export async function loadData() {
  const { tasks = [], epics = [], settings = {} } = await getRaw(['tasks', 'epics', 'settings']);
  return {
    tasks: tasks.map(normalizeTask),
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

export function saveData({ tasks, epics }) {
  return setRaw({ tasks, epics, meta: { writer: WRITER_ID, at: Date.now() } });
}

export function saveSettings(settings) {
  return setRaw({ settings, meta: { writer: WRITER_ID, at: Date.now() } });
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
    if (data.tasks || data.epics || data.settings) callback(data);
  });
}
