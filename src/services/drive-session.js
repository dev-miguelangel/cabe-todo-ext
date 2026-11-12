// Permiso de Google para sincronizar con Drive, en la extensión: chrome.identity.launchWebAuthFlow con el
// mismo cliente OAuth de la web. Google vuelve a https://<id de la extensión>.chromiumapp.org/, que debe
// estar en "URI de redireccionamiento autorizados" del cliente (Ajustes lo muestra si falta).
// La web tiene su propio drive-session.js (Google Identity Services); drive-ui.js usa cualquiera de los dos.

import {
  CLIENT_ID, SCOPE, DriveAuthError, syncWithToken, isConnected, forgetDrive, markConnected,
} from './drive-api.js';

export { isConnected, lastSync } from './drive-api.js';

const TOKEN_KEY = 'driveToken';
const hasIdentity = () => typeof chrome !== 'undefined' && Boolean(chrome.identity?.launchWebAuthFlow);

/** ¿Se puede conectar aquí? (fuera de la extensión, en pruebas, no) */
export const isAvailable = () => hasIdentity();

/** Dirección a la que Google vuelve tras dar el permiso (para configurarla en Google Cloud). */
export const redirectUrl = () => (hasIdentity() ? chrome.identity.getRedirectURL() : '');

/** Nada que cargar antes del toque (en la web, la librería de Google). */
export const prepare = () => Promise.resolve();

// El token vive en chrome.storage.session: se borra al cerrar Chrome y no queda en el disco.
async function storedToken() {
  try {
    const { [TOKEN_KEY]: t } = await chrome.storage.session.get(TOKEN_KEY);
    return t && t.expires > Date.now() + 60000 ? t.token : null;
  } catch {
    return null;
  }
}

async function forgetToken() {
  try { await chrome.storage.session.remove(TOKEN_KEY); } catch { /* ignorar */ }
}

async function getToken() {
  const cached = await storedToken();
  if (cached) return cached;
  if (!hasIdentity()) throw new Error('Sincronizar con Google Drive solo funciona dentro de la extensión.');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'token',
    redirect_uri: redirectUrl(),
    scope: SCOPE,
    include_granted_scopes: 'true',
    ...(isConnected() ? {} : { prompt: 'consent' }),
  }).toString();
  let result;
  try {
    result = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true });
  } catch (err) {
    const msg = String(err?.message || err);
    if (/did not approve|canceled|cancelled|closed/i.test(msg)) throw new DriveAuthError('Cerraste la ventana de Google sin dar el permiso.');
    throw new DriveAuthError(`No se pudo abrir la ventana de Google. Si dijo "redirect_uri_mismatch", agrega ${redirectUrl()} en Google Cloud.`);
  }
  const params = new URLSearchParams(new URL(result).hash.slice(1));
  const token = params.get('access_token');
  if (!token) {
    throw new DriveAuthError(params.get('error') === 'access_denied' ? 'No diste permiso para usar Google Drive.' : 'Google no entregó el permiso.');
  }
  if (!(params.get('scope') || '').split(' ').includes(SCOPE)) throw new DriveAuthError('Hace falta el permiso de Google Drive para sincronizar.');
  const expires = Date.now() + (Number(params.get('expires_in')) || 3600) * 1000;
  try { await chrome.storage.session.set({ [TOKEN_KEY]: { token, expires } }); } catch { /* sin storage.session */ }
  markConnected();
  return token;
}

/** Sincroniza ahora (pide el permiso si hace falta). local: ver runSync. Devuelve { summary, created }. */
export async function syncNow(local) {
  const token = await getToken();
  return syncWithToken(token, local, { onAuthError: forgetToken });
}

/** Desconectar: revoca el permiso en Google y olvida la conexión en este equipo (los datos quedan). */
export async function disconnect() {
  const token = await storedToken();
  if (token) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
  await forgetToken();
  forgetDrive();
}
