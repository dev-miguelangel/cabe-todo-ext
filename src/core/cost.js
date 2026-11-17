// Costo de una épica en dinero (valor hora × tiempo). Funciones puras, compartidas con la web.
//
// Cada épica puede tener `rate` (valor hora) y `currency` (código ISO: CLP, USD, EUR…).
// - Trabajado: el tiempo del temporizador de cada tarea; en las hechas sin temporizador, su estimado.
// - Pendiente: lo que falta de las pendientes (estimado menos lo ya trabajado, nunca negativo).

import { trackedMs } from './timer.js';

export const CURRENCIES = ['CLP', 'USD', 'EUR', 'MXN', 'ARS', 'COP', 'PEN', 'BRL', 'UYU', 'GBP'];

/** Moneda propuesta según el idioma y país del navegador ("es-CL" → CLP); si no se sabe, USD. */
export function defaultCurrency(locale = (typeof navigator !== 'undefined' && navigator.language) || '') {
  const region = String(locale).split(/[-_]/)[1]?.toUpperCase();
  const byRegion = {
    CL: 'CLP', AR: 'ARS', MX: 'MXN', CO: 'COP', PE: 'PEN', BR: 'BRL', UY: 'UYU', GB: 'GBP', US: 'USD',
    ES: 'EUR', FR: 'EUR', DE: 'EUR', IT: 'EUR', PT: 'EUR', NL: 'EUR', IE: 'EUR', BE: 'EUR', AT: 'EUR',
  };
  return byRegion[region] || 'USD';
}

/** ¿La épica tiene valor hora? */
export const hasRate = (epic) => Boolean(epic && Number(epic.rate) > 0 && epic.currency);

/** Minutos trabajados de una tarea (temporizador; si está hecha sin temporizador, su estimado). */
export function workedMinutes(task, now = Date.now()) {
  const tracked = trackedMs(task, now) / 60000;
  if (tracked > 0) return tracked;
  return task.done ? task.minutes || 0 : 0;
}

/** Minutos que le faltan a una tarea pendiente (estimado − trabajado, mínimo 0). */
export function pendingMinutes(task, now = Date.now()) {
  if (task.done) return 0;
  return Math.max((task.minutes || 0) - trackedMs(task, now) / 60000, 0);
}

/** Dinero de unos minutos a un valor hora. */
export const amountOf = (minutes, rate) => (minutes / 60) * Number(rate || 0);

/** Costo de una épica: { worked, pending, total } en minutos y en dinero. */
export function epicCost(epic, tasks, now = Date.now()) {
  const own = tasks.filter((t) => t.epic_id === epic.id);
  const worked = own.reduce((n, t) => n + workedMinutes(t, now), 0);
  const pending = own.reduce((n, t) => n + pendingMinutes(t, now), 0);
  const rate = Number(epic.rate) || 0;
  return {
    minutes: { worked, pending, total: worked + pending },
    amount: { worked: amountOf(worked, rate), pending: amountOf(pending, rate), total: amountOf(worked + pending, rate) },
  };
}

/** "$285.000" (CLP) · "US$1,250.50" (USD) · con los decimales de cada moneda. */
export function formatMoney(amount, currency, locale) {
  const loc = locale || (typeof navigator !== 'undefined' && navigator.language) || 'es-CL';
  try {
    return new Intl.NumberFormat(loc, { style: 'currency', currency, maximumFractionDigits: currency === 'CLP' ? 0 : 2 })
      .format(Math.round(amount * 100) / 100);
  } catch {
    return `${Math.round(amount).toLocaleString(loc)} ${currency}`; // código de moneda desconocido
  }
}

/**
 * Monto escrito a mano → número. Entiende separador de miles y decimales en ambos estilos:
 * "25.000" y "25,000" → 25000 · "1.250,50" y "1,250.50" → 1250.5 · "1,5" → 1.5 · "$ 30.000" → 30000.
 */
export function parseAmount(text) {
  let s = String(text ?? '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    s = s.split(thousands).join('').replace(decimal, '.');
  } else {
    const sep = lastDot !== -1 ? '.' : lastComma !== -1 ? ',' : null;
    if (sep) {
      const parts = s.split(sep);
      // Un solo separador con 3 dígitos después (o varios separadores): son miles
      const thousands = parts.length > 2 || parts[parts.length - 1].length === 3;
      s = thousands ? parts.join('') : parts.join('.');
    }
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
