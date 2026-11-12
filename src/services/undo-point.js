// Copia de lo que había antes de mezclar o importar, para "Deshacer". Compartido con la versión web.
// Se guarda junto a los datos (storage-backend.js: chrome.storage en la extensión, IndexedDB en la web).

import { exportBackup, readBackup, restoreBackup } from './store.js';
import { getRaw, setRaw } from './storage-backend.js';

const UNDO_KEY = 'import_undo';

/** Guarda una copia de lo actual. */
export async function saveUndoPoint() {
  await setRaw({ [UNDO_KEY]: { at: new Date().toISOString(), backup: exportBackup() } });
}

/** { at } de la copia guardada, o null. */
export async function undoPoint() {
  const { [UNDO_KEY]: undo } = await getRaw([UNDO_KEY]);
  return undo?.backup ? { at: undo.at } : null;
}

/** Vuelve a la copia guardada. Devuelve el resumen restaurado ({ tasks, epics }) o null. */
export async function undoImport() {
  const { [UNDO_KEY]: undo } = await getRaw([UNDO_KEY]);
  if (!undo?.backup) return null;
  const previous = readBackup(undo.backup);
  restoreBackup(previous.data);
  await setRaw({ [UNDO_KEY]: null });
  return previous.summary;
}
