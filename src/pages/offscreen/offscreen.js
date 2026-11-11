// Documento offscreen: única forma de que una extensión MV3 reproduzca audio sin una página visible.
// El service worker lo crea para sonar la alarma y lo cierra al terminar.
import { playCasio } from '../../services/casio.js';

playCasio();

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'cabetodo-casio') playCasio();
});
