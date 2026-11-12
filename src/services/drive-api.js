// Sincronizar con Google Drive: lo que es igual en la extensión y en la web (scripts/sync-core.mjs).
// Un archivo privado `Cabe Todo/cabe-todo-sync.json` en mi Drive; permiso `drive.file` (la app solo ve
// los archivos que ella misma crea).
//
// Sincronizar = traer el archivo → mezclar con lo local (core/merge.js) → guardar → subir el resultado.
// Si otro equipo lo cambió entre medio, se repite. Antes de mezclar se guarda una copia para Deshacer.
//
// Cómo se obtiene el permiso de Google es distinto en cada app (drive-session.js):
// la extensión usa chrome.identity; la web, Google Identity Services.

export const CLIENT_ID = '1028503566136-hdj7jumklq1r5u2gn9ogbtgm08apb3d8.apps.googleusercontent.com';
export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const FOLDER_NAME = 'Cabe Todo';
const FILE_NAME = 'cabe-todo-sync.json';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const MAX_ATTEMPTS = 3;

/** Falta el permiso de Google o venció: hay que volver a pedirlo. */
export class DriveAuthError extends Error {}

// ---------- La secuencia (probada con un drive de mentira) ----------

/**
 * drive: { find() → { id } | null, download(id) → texto, modified(id) → modifiedTime,
 *          create(texto) → { id }, update(id, texto) }
 * local: { exportText() → texto, read(texto) → respaldo leído (lanza si no sirve),
 *          merge(datos) → resumen, saveUndo() }
 * Devuelve { summary, created, fileId }.
 */
export async function runSync(drive, local, { fileId = null } = {}) {
  let file = fileId ? { id: fileId } : null;
  if (!file) file = await drive.find();
  if (!file) {
    const created = await drive.create(local.exportText());
    return { summary: null, created: true, fileId: created.id };
  }
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const before = await drive.modified(file.id);
    const remote = local.read(await drive.download(file.id)); // lanza si el archivo está dañado: no se toca nada
    if (attempt === 1) await local.saveUndo();
    const summary = local.merge(remote.data);
    // ¿Otro equipo subió algo mientras mezclábamos? Volver a traerlo y mezclar de nuevo.
    if ((await drive.modified(file.id)) !== before) continue;
    await drive.update(file.id, local.exportText());
    return { summary, created: false, fileId: file.id };
  }
  throw new Error('Otro equipo está sincronizando al mismo tiempo. Prueba de nuevo en un momento.');
}

// ---------- Drive real (API REST v3) ----------

/** Error de Google con su motivo: permiso vencido, API sin activar, etc. */
async function driveError(res) {
  let reason = '';
  let message = '';
  try {
    const body = await res.json();
    reason = body.error?.errors?.[0]?.reason || body.error?.status || '';
    message = body.error?.message || '';
  } catch { /* sin detalle */ }
  // Primero lo más específico: un 403 por API sin activar no se arregla volviendo a conectar
  if (['accessNotConfigured', 'SERVICE_DISABLED'].includes(reason) || /has not been used|is disabled/i.test(message)) {
    return new Error('La API de Google Drive no está activada en el proyecto de Google Cloud.');
  }
  if (res.status === 401 || ['authError', 'insufficientPermissions', 'insufficientScopes'].includes(reason)) {
    return new DriveAuthError('Hay que volver a conectar Google Drive.');
  }
  if (res.status === 404) return new Error('No se encontró el archivo en Google Drive (404).');
  if (['rateLimitExceeded', 'userRateLimitExceeded'].includes(reason) || res.status === 429) {
    return new Error('Google Drive pide esperar un momento. Prueba de nuevo en un minuto.');
  }
  return new Error(`Google Drive respondió ${res.status}${message ? `: ${message}` : ''}.`);
}

export function googleDrive(token, fetchImpl = fetch) {
  const call = async (url, options = {}) => {
    const res = await fetchImpl(url, { ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) } });
    if (!res.ok) throw await driveError(res);
    return res;
  };
  const json = async (url, options) => (await call(url, options)).json();
  const q = (query) => `${API}/files?q=${encodeURIComponent(query)}&spaces=drive&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`;

  async function folderId() {
    const found = await json(q(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`));
    if (found.files.length) return found.files[0].id;
    const created = await json(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    });
    return created.id;
  }

  return {
    async find() {
      const found = await json(q(`name='${FILE_NAME}' and trashed=false`));
      return found.files[0] || null;
    },
    async download(id) {
      return (await call(`${API}/files/${id}?alt=media`)).text();
    },
    async modified(id) {
      return (await json(`${API}/files/${id}?fields=modifiedTime`)).modifiedTime;
    },
    async create(text) {
      const parent = await folderId();
      const boundary = `cabetodo${Date.now()}`;
      const body = [
        `--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '',
        JSON.stringify({ name: FILE_NAME, mimeType: 'application/json', parents: [parent] }),
        `--${boundary}`, 'Content-Type: application/json', '', text, `--${boundary}--`, '',
      ].join('\r\n');
      return json(`${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`, {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
      });
    },
    async update(id, text) {
      return json(`${UPLOAD}/files/${id}?uploadType=media&fields=modifiedTime`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text,
      });
    },
  };
}

// ---------- Estado en este equipo ----------

const KEYS = {
  connected: 'cabetodo:driveConnected',
  fileId: 'cabetodo:driveFileId',
  last: 'cabetodo:driveLastSync', // { at, summary }
};
const ls = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
};

export const isConnected = () => Boolean(ls.get(KEYS.connected));
export const lastSync = () => ls.get(KEYS.last); // { at, summary } | null
export const markConnected = () => ls.set(KEYS.connected, true);

/** Olvida la conexión en este equipo (los datos y el archivo en Drive quedan). */
export function forgetDrive() {
  for (const k of Object.values(KEYS)) ls.del(k);
}

/**
 * Sincroniza con el Drive real usando un token ya obtenido. onAuthError(): olvidar el token vencido.
 * Devuelve { summary, created }.
 */
export async function syncWithToken(token, local, { onAuthError = () => {} } = {}) {
  try {
    const result = await runSync(googleDrive(token), local, { fileId: ls.get(KEYS.fileId) });
    ls.set(KEYS.fileId, result.fileId);
    ls.set(KEYS.last, { at: new Date().toISOString(), summary: result.summary });
    markConnected();
    return result;
  } catch (err) {
    if (err instanceof DriveAuthError) onAuthError();
    if (/\(404\)/.test(err.message)) ls.del(KEYS.fileId); // el archivo recordado ya no existe: buscarlo o crearlo de nuevo
    throw err;
  }
}
