// Etiqueta de probabilidad de éxito ("85%") con su color y el tooltip "Probabilidad de éxito: 85%".
// Se usa en toda la app: línea de cada bloque (Hoy), épicas y "Pendientes → hoy".

import { h } from '../utils/ui.js';

/** good (≥ 80%) · warn (≥ 50%) · bad (< 50%) */
export const probLevel = (p) => (p >= 0.8 ? 'good' : p >= 0.5 ? 'warn' : 'bad');

/**
 * p: probabilidad 0–1. opts.tag: elemento ('span' por defecto; 'button' si se puede tocar),
 * opts.class: clases extra, opts.prefix: texto antes del % (p. ej. "✦ "), opts.tooltip: texto propio,
 * opts.attrs: más atributos (su dataset se suma al del tooltip).
 */
export function probTag(p, opts = {}) {
  const pct = Math.round(p * 100);
  const label = `Probabilidad de éxito: ${pct}%`;
  const { dataset = {}, ...attrs } = opts.attrs || {};
  return h(opts.tag || 'span', {
    ...attrs,
    class: `prob-tag ${probLevel(p)}${opts.class ? ` ${opts.class}` : ''}`,
    dataset: { ...dataset, tooltip: opts.tooltip || label },
    'aria-label': opts.ariaLabel || label,
  }, `${opts.prefix || ''}${pct}%`);
}
