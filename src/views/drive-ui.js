// Sincronizar con Google Drive y con una carpeta local (solo computador): Ajustes y el botón ⟳ de Hoy.
// El ⟳ siempre está a la vista: amarillo mientras no hay nada conectado (al tocarlo lleva a Ajustes →
// Sincronizar con Google Drive) y normal cuando sí (al tocarlo sincroniza con todo lo conectado).
// La carpeta, mientras Chrome dé el permiso, se sincroniza sola: al abrir, al volver a la ventana y
// unos segundos después de cada cambio.
// Compartido con la versión web (scripts/sync-core.mjs). El permiso de Google lo maneja drive-session.js,
// propio de cada app.

import {
  state, exportBackup, readBackup, mergeBackup, setView, subscribe,
} from '../services/store.js';
import {
  folderAvailable, loadFolder, folderConnected, folderName, folderLastSync, folderGranted,
  chooseFolder, forgetFolder, syncFolder,
} from '../services/folder-sync.js';
import { saveUndoPoint, undoImport } from '../services/undo-point.js';
import {
  syncNow, isConnected, lastSync, disconnect, prepare, isAvailable,
} from '../services/drive-session.js';
import { mergeSummaryText, latestLocalChange } from '../core/merge.js';
import { syncedAccount, SyncCancelled } from '../services/drive-api.js';
import {
  showToast, h, openModal, closeModal,
} from '../utils/ui.js';

let busy = false;

/**
 * Cuentas de Google distintas: avisar antes de mezclar. Promesa con true (continuar) o false (cancelar).
 * current: la cuenta conectada ahora; others: con las que se sincronizó antes este equipo o el archivo.
 */
export function confirmAccount({ current, others }) {
  return new Promise((resolve) => {
    let accepted = false;
    const pick = (value) => () => {
      accepted = value;
      closeModal();
    };
    const list = others.flatMap((email, i) => [i ? ', ' : '', h('strong', {}, email)]);
    openModal('Otra cuenta de Google', [
      h('p', { class: 'modal-text' }, 'Ahora estás conectado como ', h('strong', {}, current),
        ', pero estos datos se sincronizaron antes con ', ...list, '.'),
      h('p', { class: 'modal-text' },
        `Si continúas, se mezclará la información de ambos correos (en este equipo y en el Drive de ${current}). `
        + 'Puede dejar tareas repetidas o mezcladas que después no se pueden separar.'),
      h('div', { class: 'import-choices' },
        h('button', { type: 'button', class: 'import-choice', onclick: pick(true) },
          h('strong', {}, 'Continuar y mezclar'),
          h('span', {}, 'Une los datos de las dos cuentas. Después puedes usar Deshacer en este equipo.')),
        h('button', { type: 'button', class: 'import-choice primary-choice', onclick: pick(false) },
          h('strong', {}, 'Cancelar'),
          h('span', {}, 'No se cambia nada, ni aquí ni en Drive. Puedes desconectar y entrar con la otra cuenta.'))),
    ], () => resolve(accepted));
  });
}

/** Lo que la sincronización necesita del equipo. */
const local = {
  exportText: () => exportBackup(),
  read: (text) => readBackup(text),
  merge: (data) => mergeBackup(data),
  saveUndo: () => saveUndoPoint(),
  confirmAccount,
};

function whenText(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

const driveOn = () => isAvailable() && isConnected();

/** La sincronización más antigua entre lo conectado (para el punto celeste). */
function oldestSync() {
  const times = [];
  if (driveOn()) times.push(lastSync()?.at || '');
  if (folderConnected()) times.push(folderLastSync()?.at || '');
  return times.length ? times.sort()[0] : null;
}

function renderFolder() {
  const section = document.getElementById('folder-section');
  if (!section) return;
  section.hidden = !folderAvailable();
  if (section.hidden) return;
  const on = folderConnected();
  const last = folderLastSync();
  document.getElementById('folder-off').hidden = on;
  document.getElementById('folder-on').hidden = !on;
  document.getElementById('folder-status').textContent = on
    ? `Carpeta: ${folderName()}. ${last ? `Última sincronización: ${whenText(last.at)}.` : 'Todavía no sincronizas con ella.'}`
    : '';
  document.getElementById('folder-desc').textContent = on
    ? [`Carpeta ${folderName()}`, last ? whenText(last.at) : null].filter(Boolean).join(' · ')
    : 'La app web y la extensión de este computador, con los mismos datos.';
  for (const id of ['folder-choose', 'folder-sync', 'folder-change']) {
    const el = document.getElementById(id);
    el.disabled = busy;
    el.classList.toggle('is-busy', busy);
  }
}

export function renderDrive() {
  renderFolder();
  const btn = document.getElementById('drive-sync-btn');
  const driveSection = document.getElementById('drive-section');
  driveSection.hidden = !isAvailable();
  if (!isAvailable() && !folderAvailable()) {
    btn.hidden = true;
    return;
  }
  const on = driveOn() || folderConnected();
  const oldest = oldestSync();
  // Punto celeste: hay cambios en este equipo después de la última sincronización
  const pending = on && latestLocalChange(state) > (oldest || '');
  const where = [driveOn() ? 'Google Drive' : null, folderConnected() ? 'la carpeta' : null].filter(Boolean).join(' y ');
  btn.hidden = false;
  btn.classList.toggle('sync-off', !on);
  btn.classList.toggle('has-pending', pending);
  btn.title = !on
    ? 'La sincronización no está conectada: toca para conectarla'
    : pending ? `Hay cambios sin sincronizar: toca para sincronizar con ${where}` : `Sincronizar con ${where}`;
  btn.setAttribute('aria-label', btn.title);
  btn.disabled = busy;
  btn.classList.toggle('is-busy', busy);
  if (!isAvailable()) return;

  const driveConnected = isConnected();
  const last = lastSync();
  const drivePending = driveConnected && latestLocalChange(state) > (last?.at || '');
  document.getElementById('drive-off').hidden = driveConnected;
  document.getElementById('drive-on').hidden = !driveConnected;
  const account = syncedAccount();
  const who = account ? `Conectado como ${account}. ` : 'Conectado. ';
  const status = who + (last ? `Última sincronización: ${whenText(last.at)}.` : 'Todavía no sincronizas desde este equipo.')
    + (drivePending && last ? ' Hay cambios sin sincronizar.' : '');
  document.getElementById('drive-status').textContent = status;
  document.getElementById('drive-desc').textContent = driveConnected
    ? [account || 'Conectado', last ? whenText(last.at) : null].filter(Boolean).join(' · ')
    : 'La misma lista en el celular y en la extensión.';
  for (const id of ['drive-sync', 'drive-connect']) {
    const el = document.getElementById(id);
    el.disabled = busy;
    el.classList.toggle('is-busy', busy);
  }
}

/** Ir a Ajustes → Sincronizar con Google Drive (abierta y a la vista). */
export function openDriveSettings() {
  setView({ tab: 'settings' });
  const section = document.getElementById('drive-section');
  section.open = true;
  requestAnimationFrame(() => {
    section.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    document.getElementById(isConnected() ? 'drive-sync' : 'drive-connect')?.focus({ preventScroll: true });
  });
}

const undoAction = {
  label: 'Deshacer',
  run: async () => { await undoImport(); showToast('Volviste a lo de antes de sincronizar.'); },
};

function reportError(err) {
  showToast(err instanceof SyncCancelled ? err.message : (err.message || 'No se pudo sincronizar.'));
}

/**
 * Sincronizar. targets: 'all' (lo conectado: carpeta y Drive), 'drive' o 'folder'.
 * Debe llamarse directo desde el toque (Drive y la carpeta piden permiso en ese momento).
 */
async function startSync(targets = 'all') {
  if (busy) return;
  busy = true;
  renderDrive();
  const steps = [];
  if ((targets === 'all' || targets === 'folder') && folderConnected()) steps.push(['la carpeta', syncFolder]);
  if (targets === 'drive' || (targets === 'all' && driveOn())) steps.push(['Google Drive', syncNow]);
  const results = [];
  let undoSaved = false;
  try {
    for (const [name, run] of steps) {
      // Un solo punto de Deshacer: el de antes de la primera mezcla
      const ctx = undoSaved ? { ...local, saveUndo: () => {} } : local;
      try {
        const r = await run(ctx);
        if (!r.created) undoSaved = true;
        results.push([name, r]);
      } catch (err) {
        reportError(steps.length > 1 && !(err instanceof SyncCancelled) ? new Error(`${name}: ${err.message}`) : err);
        return;
      }
    }
  } finally {
    busy = false;
    renderDrive();
  }
  if (!results.length) return;
  const text = results.map(([name, r]) => (r.created
    ? `tus datos quedaron en ${name}`
    : mergeSummaryText(r.summary))).join(' · ');
  const created = results.every(([, r]) => r.created);
  showToast(created ? `Listo: ${text} (${state.tasks.length} tareas).` : `Sincronizado: ${text}.`, created ? undefined : undoAction);
}

// ---------- Carpeta: sincronizar sola mientras haya permiso ----------

let autoTimer = null;
const AUTO_DELAY = 4000;

/** Sincroniza con la carpeta sin preguntar nada (solo si ya hay permiso). Avisa solo si trajo cambios. */
async function autoFolderSync() {
  if (busy || !folderConnected() || !(await folderGranted())) return;
  busy = true;
  try {
    const r = await syncFolder({ ...local, confirmAccount: async () => false });
    const text = r.summary ? mergeSummaryText(r.summary) : '';
    if (text && text !== 'ya estaba al día') showToast(`Desde la carpeta: ${text}.`, undoAction);
  } catch {
    // en silencio: el ⟳ y Ajustes muestran el error cuando se sincroniza a mano
  } finally {
    busy = false;
    renderDrive();
  }
}

function scheduleAutoSync() {
  if (!folderConnected()) return;
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    if (latestLocalChange(state) > (folderLastSync()?.at || '')) autoFolderSync();
  }, AUTO_DELAY);
}

async function pickFolder() {
  try {
    const name = await chooseFolder();
    if (!name) return;
    renderDrive();
    showToast(`Carpeta elegida: ${name}.`);
    await startSync('folder');
  } catch (err) {
    showToast(err.message);
  }
}

export function setupDrive() {
  // La librería de Google se carga antes del toque: así la ventanita de Google no queda bloqueada
  if (isConnected()) prepare().catch(() => {});
  document.getElementById('drive-section').addEventListener('toggle', (e) => {
    if (e.target.open) prepare().catch((err) => showToast(err.message));
  });
  document.getElementById('drive-connect').addEventListener('click', () => startSync('drive'));
  document.getElementById('drive-sync').addEventListener('click', () => startSync('drive'));
  // ⟳ de Hoy: sin conexión lleva a Ajustes; conectado, sincroniza con todo lo conectado
  document.getElementById('drive-sync-btn').addEventListener('click', () => {
    if (driveOn() || folderConnected()) startSync('all');
    else openDriveSettings();
  });

  // Carpeta local (solo computador)
  if (folderAvailable()) {
    document.getElementById('folder-choose').addEventListener('click', pickFolder);
    document.getElementById('folder-change').addEventListener('click', pickFolder);
    document.getElementById('folder-sync').addEventListener('click', () => startSync('folder'));
    document.getElementById('folder-forget').addEventListener('click', async () => {
      // eslint-disable-next-line no-alert
      if (!window.confirm('¿Dejar de sincronizar con esta carpeta en este equipo? Tus datos se quedan aquí y el archivo no se borra.')) return;
      await forgetFolder();
      showToast('Ya no se sincroniza con la carpeta en este equipo.');
      renderDrive();
    });
    loadFolder().then(() => { renderDrive(); autoFolderSync(); });
    // Al volver a la ventana, traer lo que cambió la otra app; después de cada cambio, guardarlo
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') autoFolderSync(); });
    window.addEventListener('focus', () => autoFolderSync());
    subscribe(scheduleAutoSync);
  }
  document.getElementById('drive-disconnect').addEventListener('click', async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('¿Desconectar Google Drive en este equipo? Tus datos se quedan aquí y el archivo en tu Drive no se borra.')) return;
    await disconnect();
    showToast('Google Drive desconectado en este equipo.');
    renderDrive();
  });
  renderDrive();
}
