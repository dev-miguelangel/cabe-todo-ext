// Dónde se guardan los datos: chrome.storage.local en la extensión, o localStorage si panel.html se
// abre fuera de la extensión (pruebas). storage.js usa solo estas tres funciones, así que la versión
// web (cabe-todo-web) tiene su propio storage-backend.js (IndexedDB) y comparte storage.js y store.js.

/** Se revisa en cada llamada (no al cargar): así funciona aunque `chrome` aparezca después (pruebas). */
const hasChromeStorage = () => typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);

/** { clave: valor } de las claves pedidas que existan. */
export async function getRaw(keys) {
  if (hasChromeStorage()) return chrome.storage.local.get(keys);
  const out = {};
  for (const k of keys) {
    try {
      const v = localStorage.getItem(`cabetodo:${k}`);
      if (v !== null) out[k] = JSON.parse(v);
    } catch {
      /* almacenamiento no disponible: se parte vacío */
    }
  }
  return out;
}

/** Guarda { clave: valor }. */
export async function setRaw(obj) {
  if (hasChromeStorage()) return chrome.storage.local.set(obj);
  for (const [k, v] of Object.entries(obj)) {
    try {
      localStorage.setItem(`cabetodo:${k}`, JSON.stringify(v));
    } catch {
      /* ignorar */
    }
  }
}

/** Llama a callback({ clave: valorNuevo }) cuando cambian los datos (también los propios). */
export function watchRaw(callback) {
  if (!hasChromeStorage()) return;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    callback(Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.newValue])));
  });
}
