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

/** El usuario canceló la sincronización (cuentas distintas): no se cambió nada. */
export class SyncCancelled extends Error {
  constructor() {
    super('Sincronización cancelada: no se cambió nada.');
  }
}

/** Agrega al archivo de sincronización con qué cuenta se sincronizó y cuándo. */
function withAccount(text, email) {
  if (!email) return text;
  const data = JSON.parse(text);
  data.account = { email, synced_at: new Date().toISOString() };
  return JSON.stringify(data, null, 2);
}

/** Cuenta que sincronizó por última vez el archivo de Drive (o null). */
function fileAccount(text) {
  try {
    return JSON.parse(text).account?.email || null;
  } catch {
    return null;
  }
}

/**
 * drive: { account() → correo de la cuenta de Drive, find() → { id } | null, download(id) → texto,
 *          modified(id) → modifiedTime, create(texto) → { id }, update(id, texto) }
 * local: { exportText() → texto, read(texto) → respaldo leído (lanza si no sirve), merge(datos) → resumen,
 *          saveUndo(), confirmAccount({ current, others }) → true para seguir (cuentas distintas) }
 * opts: { fileId, previousAccount }: el archivo y la cuenta con que este equipo sincronizó la última vez.
 * Si la cuenta de ahora no es la de este equipo, o no es la que sincronizó el archivo, se pregunta antes de
 * mezclar (si se cancela: SyncCancelled y nada cambia).
 * Devuelve { summary, created, fileId, email }.
 */
export async function runSync(drive, local, { fileId = null, previousAccount = null } = {}) {
  // El correo es un extra: si Google no lo entrega, se sincroniza igual (sin mostrarlo ni comparar cuentas)
  let email = null;
  try {
    email = drive.account ? await drive.account() : null;
  } catch (err) {
    if (err instanceof DriveAuthError) throw err; // permiso vencido: eso sí hay que resolverlo
  }
  const switched = Boolean(email && previousAccount && previousAccount !== email);
  const ask = async (fileOwner) => {
    if (!email) return; // sin correo (o carpeta local): nada que comparar
    const others = [...new Set([switched ? previousAccount : null, fileOwner && fileOwner !== email ? fileOwner : null].filter(Boolean))];
    if (others.length && !(await local.confirmAccount({ current: email, others }))) throw new SyncCancelled();
  };

  let file = fileId && !switched ? { id: fileId } : null; // con otra cuenta, el archivo recordado no sirve
  if (!file) file = await drive.find();
  if (!file) {
    await ask(null);
    const created = await drive.create(withAccount(local.exportText(), email));
    return { summary: null, created: true, fileId: created.id, email };
  }
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const before = await drive.modified(file.id);
    const text = await drive.download(file.id);
    const remote = local.read(text); // lanza si el archivo está dañado: no se toca nada
    if (attempt === 1) {
      await ask(fileAccount(text));
      await local.saveUndo();
    }
    const summary = local.merge(remote.data);
    // ¿Otro equipo subió algo mientras mezclábamos? Volver a traerlo y mezclar de nuevo.
    if ((await drive.modified(file.id)) !== before) continue;
    await drive.update(file.id, withAccount(local.exportText(), email));
    return { summary, created: false, fileId: file.id, email };
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

function fromDataUrl(dataUrl) {
  const comma = dataUrl.indexOf(',');
  const mime = dataUrl.slice(5, dataUrl.indexOf(';')) || 'image/webp';
  const bin = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return { mime, bytes };
}

function toDataUrl(mime, bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

// ---------- Imágenes de la documentación (archivos aparte en Drive) ----------
// images: driveImages de store.js. Los errores de una imagen no detienen la sincronización: la imagen
// queda para la próxima (si no se subió, viaja dentro del archivo como antes). Un permiso vencido sí.

/** Sube las imágenes nuevas a Cabe Todo/img/{épica}/{tarea}/. Devuelve cuántas subió. */
export async function uploadPendingImages(drive, images) {
  const done = [];
  for (const p of images.pending()) {
    try {
      const parent = await drive.imageFolder(p.path);
      const file = await drive.uploadImage(parent, p.name, p.data);
      done.push({ ...p, fileId: file.id });
    } catch (err) {
      if (err instanceof DriveAuthError) { images.setDrive(done); throw err; }
    }
  }
  images.setDrive(done);
  return done.length;
}

/** Descarga las imágenes que faltan en este equipo. Devuelve cuántas bajó. */
export async function downloadMissingImages(drive, images) {
  const done = [];
  for (const m of images.missing()) {
    try {
      done.push({ ...m, data: await drive.downloadImage(m.fileId) });
    } catch (err) {
      if (err instanceof DriveAuthError) break;
    }
  }
  images.setData(done);
  return done.length;
}

/** Manda a la papelera las imágenes que ya no se usan. */
export async function trashUnusedImages(drive, images) {
  const failed = [];
  for (const id of images.takeTrash()) {
    try {
      await drive.trash(id);
    } catch (err) {
      if (!/\(404\)/.test(err.message)) failed.push(id); // si ya no existe, nada que hacer
    }
  }
  if (failed.length) images.requeueTrash(failed);
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

  // Subcarpetas (img/…): se buscan o crean una vez por sincronización
  const folders = new Map();
  async function childFolder(parent, name) {
    const key = `${parent}/${name}`;
    if (folders.has(key)) return folders.get(key);
    const safe = name.replace(/['\\]/g, '');
    const found = await json(q(`name='${safe}' and '${parent}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`));
    const id = found.files.length ? found.files[0].id : (await json(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: safe, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }),
    })).id;
    folders.set(key, id);
    return id;
  }

  return {
    /** Carpeta Cabe Todo/<path…> (la crea si falta). Devuelve su id. */
    async imageFolder(path) {
      let parent = await folderId();
      for (const name of path) parent = await childFolder(parent, name);
      return parent;
    },
    /** Sube una imagen (data:image/…;base64) a la carpeta. Devuelve { id }. */
    async uploadImage(parent, name, dataUrl) {
      const { mime, bytes } = fromDataUrl(dataUrl);
      const boundary = `cabetodo${Date.now()}`;
      const head = [`--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '',
        JSON.stringify({ name, mimeType: mime, parents: [parent] }), `--${boundary}`, `Content-Type: ${mime}`, '', ''].join('\r\n');
      const body = new Blob([head, bytes, `\r\n--${boundary}--\r\n`]);
      return json(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
        method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body,
      });
    },
    /** Descarga una imagen como data:image/…;base64. */
    async downloadImage(id) {
      const res = await call(`${API}/files/${id}?alt=media`);
      const mime = (res.headers.get('Content-Type') || 'image/webp').split(';')[0];
      return toDataUrl(mime, new Uint8Array(await res.arrayBuffer()));
    },
    /** A la papelera de Drive (se puede recuperar desde ahí 30 días). */
    async trash(id) {
      await call(`${API}/files/${id}?fields=id`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
      });
    },
    /** Correo de la cuenta dueña del Drive (con el mismo permiso drive.file, sin pedir más). */
    async account() {
      const about = await json(`${API}/about?fields=user(emailAddress)`);
      return about.user?.emailAddress || null;
    },
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
  account: 'cabetodo:driveAccount', // correo con el que este equipo sincronizó la última vez
};
const ls = {
  get: (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
  del: (k) => { try { localStorage.removeItem(k); } catch { /* sin almacenamiento */ } },
};

export const isConnected = () => Boolean(ls.get(KEYS.connected));
export const lastSync = () => ls.get(KEYS.last); // { at, summary } | null
export const markConnected = () => ls.set(KEYS.connected, true);
/** Correo de la cuenta de Google con que este equipo sincronizó (o null). */
export const syncedAccount = () => ls.get(KEYS.account);

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
    const drive = googleDrive(token);
    const images = local.images;
    // Primero las imágenes nuevas (así el archivo ya lleva solo sus referencias)
    if (images) await uploadPendingImages(drive, images);
    const forDrive = images ? { ...local, exportText: () => images.exportForDrive() } : local;
    const result = await runSync(drive, forDrive, { fileId: ls.get(KEYS.fileId), previousAccount: ls.get(KEYS.account) });
    if (images) {
      await downloadMissingImages(drive, images).catch(() => {});
      await trashUnusedImages(drive, images).catch(() => {});
    }
    ls.set(KEYS.fileId, result.fileId);
    if (result.email) ls.set(KEYS.account, result.email);
    ls.set(KEYS.last, { at: new Date().toISOString(), summary: result.summary });
    markConnected();
    return result;
  } catch (err) {
    if (err instanceof DriveAuthError) onAuthError();
    if (/\(404\)/.test(err.message)) ls.del(KEYS.fileId); // el archivo recordado ya no existe: buscarlo o crearlo de nuevo
    throw err;
  }
}
