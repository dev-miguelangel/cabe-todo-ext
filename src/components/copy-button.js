// Botón ⧉ que copia al portapapeles el texto visible de un título (tarea o épica).
// Al copiar muestra ✓ un momento. Sirve en la extensión y en la app web.

import { h } from '../utils/ui.js';

const ICON = '⧉';
const DONE_MS = 1500;

/** Copia el texto. Sin la API del portapapeles (o sin permiso) usa un <textarea> temporal. */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = h('textarea', { readonly: true, style: 'position:fixed;top:0;left:0;opacity:0;pointer-events:none' });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* sin portapapeles */ }
    area.remove();
    return ok;
  }
}

/**
 * copyButton(() => 'Texto', { label: 'Copiar el título' })
 * getText se llama al hacer clic, para copiar siempre lo que se ve en ese momento.
 * El clic no llega al contenedor: no abre el detalle, no edita el título ni abre/cierra la épica.
 */
export function copyButton(getText, { label = 'Copiar el título', className = '' } = {}) {
  let timer;
  const btn = h('button', {
    type: 'button', class: `copy-btn${className ? ` ${className}` : ''}`, title: label, 'aria-label': label,
  }, ICON);
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  // Dentro de un <summary> también hay que frenar Enter / Espacio para que no abra la épica
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      stop(e);
      btn.click();
    }
  });
  btn.addEventListener('click', async (e) => {
    stop(e);
    const ok = await copyText(String(getText() ?? ''));
    clearTimeout(timer);
    btn.textContent = ok ? '✓' : '✕';
    btn.classList.toggle('copied', ok);
    btn.title = ok ? 'Copiado' : 'No se pudo copiar';
    btn.setAttribute('aria-label', btn.title);
    timer = setTimeout(() => {
      btn.textContent = ICON;
      btn.classList.remove('copied');
      btn.title = label;
      btn.setAttribute('aria-label', label);
    }, DONE_MS);
  });
  return btn;
}
