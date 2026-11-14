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

export function renderDrive() {
  if (!isAvailable()) {
    document.getElementById('drive-section').hidden = true;
    document.getElementById('drive-sync-btn').hidden = true;
    return;
  }
  const on = isConnected();
  const last = lastSync();
  // Punto celeste: hay cambios en este equipo después de la última sincronización
  const pending = on && latestLocalChange(state) > (last?.at || '');
  const btn = document.getElementById('drive-sync-btn');
  btn.hidden = false;
  btn.classList.toggle('sync-off', !on);
  btn.classList.toggle('has-pending', pending);
  btn.title = !on
    ? 'Google Drive no está conectado: toca para conectarlo'
    : pending ? 'Hay cambios sin sincronizar: toca para sincronizar con Google Drive' : 'Sincronizar con Google Drive';
  btn.setAttribute('aria-label', btn.title);
  document.getElementById('drive-off').hidden = on;
  document.getElementById('drive-on').hidden = !on;
  const account = syncedAccount();
  const who = account ? `Conectado como ${account}. ` : 'Conectado. ';
  const status = who + (last ? `Última sincronización: ${whenText(last.at)}.` : 'Todavía no sincronizas desde este equipo.')
    + (pending && last ? ' Hay cambios sin sincronizar.' : '');
  document.getElementById('drive-status').textContent = status;
  document.getElementById('drive-desc').textContent = on
    ? [account || 'Conectado', last ? whenText(last.at) : null].filter(Boolean).join(' · ')
    : 'La misma lista en el celular y en la extensión.';
  for (const id of ['drive-sync', 'drive-connect', 'drive-sync-btn']) {
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

/** Sincronizar (también conecta la primera vez). Debe llamarse directo desde el toque. */
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
    if (err instanceof SyncCancelled) {
      showToast(err.message);
      return;
    }
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
