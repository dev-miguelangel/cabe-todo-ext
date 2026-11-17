// Sincronizar con una carpeta local (solo en computador): el mismo archivo cabe-todo-sync.json que Drive,
// pero en una carpeta que eliges (File System Access API). Sirve para tener la app web instalada y la
// extensión en el mismo PC con los mismos datos: cada una elige la misma carpeta una vez.
// Compartido con la versión web. La mezcla es la de Drive (runSync de drive-api.js), sin cuentas.
//
// La carpeta elegida (su "handle") se guarda en IndexedDB de este navegador. Chrome pide permiso de nuevo
// en cada visita (salvo que elijas "Permitir en cada visita"): el permiso se pide con un toque.

import { runSync } from './drive-api.js';

export const FILE_NAME = 'cabe-todo-sync.json';
const DB = 'cabetodo-folder';
const STORE = 'handles';
const KEY = 'syncFolder';
const LAST_KEY = 'cabetodo:folderLastSync'; // { at, summary, folder }

let handle = null; // carpeta elegida (cargada al iniciar, para pedir el permiso directo desde el toque)
let loaded = null;

/** ¿Se puede usar aquí? Solo en computador (puntero fino) y con selector de carpetas. */
export function folderAvailable() {
  if (typeof window === 'undefined' || typeof window.showDirectoryPicker !== 'function') return false;
  try {
    return !matchMedia('(pointer: coarse)').matches;
  } catch {
    return true;
  }
}

// ---------- IndexedDB: guardar la carpeta elegida ----------

function db() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => { d.close(); resolve(req?.result); };
    tx.onerror = () => { d.close(); reject(tx.error); };
  });
}

/** Carga la carpeta recordada (una vez). */
export function loadFolder() {
  if (!loaded) {
    loaded = (async () => {
      if (!folderAvailable()) return null;
      try {
        handle = (await idb('readonly', (s) => s.get(KEY))) || null;
      } catch {
        handle = null;
      }
      return handle;
    })();
  }
  return loaded;
}

const ls = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
};

export const folderConnected = () => Boolean(handle);
export const folderName = () => handle?.name || '';
export const folderLastSync = () => ls.get(LAST_KEY);

/** ¿Ya hay permiso (sin preguntar)? Para sincronizar solo, sin molestar. */
export async function folderGranted() {
  if (!handle) return false;
  try {
    return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/** Pide el permiso si hace falta. Debe llamarse directo desde un toque. */
async function ensurePermission() {
  if (await folderGranted()) return;
  let result = 'denied';
  try {
    result = await handle.requestPermission({ mode: 'readwrite' });
  } catch { /* sin gesto del usuario */ }
  if (result !== 'granted') throw new Error('Sin permiso para usar la carpeta. Toca de nuevo y elige "Permitir".');
}

/** Elegir la carpeta (desde un toque). Devuelve su nombre, o null si se cerró el selector. */
export async function chooseFolder() {
  let picked;
  try {
    picked = await window.showDirectoryPicker({ id: 'cabe-todo-sync', mode: 'readwrite' });
  } catch (err) {
    if (err?.name === 'AbortError') return null;
    throw new Error(`No se pudo abrir el selector de carpetas (${err?.message || err}).`);
  }
  handle = picked;
  loaded = Promise.resolve(handle);
  try { await idb('readwrite', (s) => s.put(picked, KEY)); } catch { /* solo por esta sesión */ }
  ls.del(LAST_KEY);
  return picked.name;
}

/** Olvidar la carpeta en este equipo (el archivo queda). */
export async function forgetFolder() {
  handle = null;
  loaded = Promise.resolve(null);
  ls.del(LAST_KEY);
  try { await idb('readwrite', (s) => s.delete(KEY)); } catch { /* ignorar */ }
}

/** Adaptador para runSync: el "Drive" es un archivo de la carpeta. */
export function folderStore(dir) {
  const fileHandle = (create) => dir.getFileHandle(FILE_NAME, { create });
  const write = async (text) => {
    const w = await (await fileHandle(true)).createWritable();
    await w.write(text);
    await w.close();
  };
  return {
    account: null, // sin cuentas: nada que comparar
    async find() {
      try {
        await fileHandle(false);
        return { id: FILE_NAME };
      } catch (err) {
        if (err?.name === 'NotFoundError') return null;
        throw err;
      }
    },
    download: async () => (await (await fileHandle(false)).getFile()).text(),
    modified: async () => (await (await fileHandle(false)).getFile()).lastModified,
    async create(text) {
      await write(text);
      return { id: FILE_NAME };
    },
    update: (id, text) => write(text),
  };
}

/** Sincroniza con la carpeta (pide el permiso si hace falta). Devuelve { summary, created }. */
export async function syncFolder(local) {
  await loadFolder();
  if (!handle) throw new Error('Primero elige una carpeta.');
  await ensurePermission();
  let result;
  try {
    result = await runSync(folderStore(handle), local);
  } catch (err) {
    if (err?.name === 'NotFoundError') throw new Error(`La carpeta "${handle.name}" ya no existe. Elige otra.`);
    if (err?.name === 'NotAllowedError') throw new Error('Sin permiso para usar la carpeta. Toca de nuevo y elige "Permitir".');
    throw err;
  }
  ls.set(LAST_KEY, { at: new Date().toISOString(), summary: result.summary, folder: handle.name });
  return result;
}
