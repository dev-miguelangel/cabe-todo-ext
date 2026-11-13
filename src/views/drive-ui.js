// Sincronizar con Google Drive: Ajustes → "Sincronizar con Google Drive" y el botón ⟳ de Hoy.
// El ⟳ siempre está a la vista: amarillo mientras Drive no está conectado (al tocarlo lleva a Ajustes →
// Sincronizar con Google Drive) y normal cuando lo está (al tocarlo sincroniza).
// Compartido con la versión web (scripts/sync-core.mjs). El permiso de Google lo maneja drive-session.js,
// propio de cada app.

import {
  state, exportBackup, readBackup, mergeBackup, setView,
} from '../services/store.js';
import { saveUndoPoint, undoImport } from '../services/undo-point.js';
import {
  syncNow, isConnected, lastSync, disconnect, prepare, isAvailable, redirectUrl,
} from '../services/drive-session.js';
import { mergeSummaryText } from '../core/merge.js';
import { showToast } from '../utils/ui.js';

let busy = false;

/** Lo que la sincronización necesita del equipo. */
const local = {
  exportText: () => exportBackup(),
  read: (text) => readBackup(text),
  merge: (data) => mergeBackup(data),
  saveUndo: () => saveUndoPoint(),
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

export function renderDrive() {
  if (!isAvailable()) {
    document.getElementById('drive-section').hidden = true;
    document.getElementById('drive-sync-btn').hidden = true;
    return;
  }
  const on = isConnected();
  const btn = document.getElementById('drive-sync-btn');
  btn.hidden = false;
  btn.classList.toggle('sync-off', !on);
  btn.title = on ? 'Sincronizar con Google Drive' : 'Google Drive no está conectado: toca para conectarlo';
  btn.setAttribute('aria-label', btn.title);
  const setup = document.getElementById('drive-setup');
  if (setup) setup.textContent = redirectUrl();
  document.getElementById('drive-off').hidden = on;
  document.getElementById('drive-on').hidden = !on;
  const last = lastSync();
  const status = last ? `Última sincronización: ${whenText(last.at)}.` : 'Conectado. Todavía no sincronizas desde este equipo.';
  document.getElementById('drive-status').textContent = status;
  document.getElementById('drive-desc').textContent = on
    ? (last ? `Conectado · ${whenText(last.at)}` : 'Conectado')
    : 'La misma lista en el celular y en la extensión.';
  for (const id of ['drive-sync', 'drive-connect', 'drive-sync-btn']) {
    const el = document.getElementById(id);
    el.disabled = busy;
    el.classList.toggle('is-busy', busy);
  }
}

/** Sincronizar (también conecta la primera vez). Debe llamarse directo desde el toque. */
const TAB_KEY = 'cabetodo:tab';

/** Ir a Ajustes → Sincronizar con Google Drive (abierta y a la vista). */
export function openDriveSettings() {
  try { localStorage.setItem(TAB_KEY, 'settings'); } catch { /* sin almacenamiento */ }
  setView({ tab: 'settings' });
  const section = document.getElementById('drive-section');
  section.open = true;
  requestAnimationFrame(() => {
    section.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    document.getElementById(isConnected() ? 'drive-sync' : 'drive-connect')?.focus({ preventScroll: true });
  });
}

function startSync() {
  if (busy) return;
  busy = true;
  renderDrive();
  const done = () => { busy = false; renderDrive(); };
  syncNow(local).then(({ summary, created }) => {
    if (created) showToast(`Listo: tus datos quedaron en Google Drive (${state.tasks.length} tareas). Sincroniza desde tus otros equipos.`);
    else {
      showToast(`Sincronizado: ${mergeSummaryText(summary)}.`, {
        label: 'Deshacer',
        run: async () => { await undoImport(); showToast('Volviste a lo de antes de sincronizar.'); },
      });
    }
  }).catch((err) => {
    showToast(err.message || 'No se pudo sincronizar.');
  }).finally(done);
}

export function setupDrive() {
  // La librería de Google se carga antes del toque: así la ventanita de Google no queda bloqueada
  if (isConnected()) prepare().catch(() => {});
  document.getElementById('drive-section').addEventListener('toggle', (e) => {
    if (e.target.open) prepare().catch((err) => showToast(err.message));
  });
  document.getElementById('drive-connect').addEventListener('click', startSync);
  document.getElementById('drive-sync').addEventListener('click', startSync);
  // ⟳ de Hoy: sin conexión lleva a Ajustes; conectado, sincroniza
  document.getElementById('drive-sync-btn').addEventListener('click', () => {
    if (isConnected()) startSync();
    else openDriveSettings();
  });
  document.getElementById('drive-disconnect').addEventListener('click', async () => {
    // eslint-disable-next-line no-alert
    if (!window.confirm('¿Desconectar Google Drive en este equipo? Tus datos se quedan aquí y el archivo en tu Drive no se borra.')) return;
    await disconnect();
    showToast('Google Drive desconectado en este equipo.');
    renderDrive();
  });
  renderDrive();
}
