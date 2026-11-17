// Costo de una épica en dinero (valor hora × tiempo). Funciones puras, compartidas con la web.
//
// Cada épica puede tener `rate` (valor hora) y `currency` (código ISO: CLP, USD, EUR…).
// - Trabajado: el tiempo del temporizador de cada tarea; en las hechas sin temporizador, su estimado.
// - Pendiente: lo que falta de las pendientes (estimado menos lo ya trabajado, nunca negativo).

import { trackedMs } from './timer.js';

/** Monedas disponibles (código ISO y cómo se muestran en el selector). */
export const CURRENCIES = ['CLP', 'USD', 'EUR'];
export const CURRENCY_LABEL = { CLP: 'CLP ($)', USD: 'USD (US$)', EUR: 'EUR (€)' };
const EURO_REGIONS = ['ES', 'FR', 'DE', 'IT', 'PT', 'NL', 'IE', 'BE', 'AT', 'FI', 'GR', 'LU', 'SK', 'SI', 'EE', 'LV', 'LT', 'MT', 'CY', 'HR'];

const CHILE_ZONES = ['America/Santiago', 'America/Punta_Arenas', 'Pacific/Easter'];
const EURO_ZONES = ['Madrid', 'Paris', 'Berlin', 'Rome', 'Lisbon', 'Amsterdam', 'Brussels', 'Vienna', 'Dublin', 'Helsinki',
  'Athens', 'Luxembourg', 'Bratislava', 'Ljubljana', 'Tallinn', 'Riga', 'Vilnius', 'Malta', 'Nicosia', 'Zagreb'].map((c) => `Europe/${c}`);
const localZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; }
};

/**
 * Moneda propuesta: Chile → CLP, zona euro → EUR, el resto → USD. Mira el país del idioma ("es-CL") y,
 * como Chrome en español latino suele decir solo "es-419", también la zona horaria (America/Santiago).
 */
export function defaultCurrency(locale = (typeof navigator !== 'undefined' && navigator.language) || '', zone = localZone()) {
  const region = String(locale).split(/[-_]/)[1]?.toUpperCase();
  if (region === 'CL' || CHILE_ZONES.includes(zone)) return 'CLP';
  if (EURO_REGIONS.includes(region) || EURO_ZONES.includes(zone)) return 'EUR';
  return 'USD';
}

/** Decimales de cada moneda: el peso chileno no usa. */
export const decimalsOf = (currency) => (currency === 'CLP' ? 0 : 2);

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

/**
 * Costo de una épica, en minutos y en dinero:
 * - estimated: la suma de todas sus tareas (hechas y pendientes) por su estimado: lo que muestra el chip
 *   de la épica y lo mismo que suman los detalles de cada tarea.
 * - worked / pending: lo trabajado y lo que falta; total = worked + pending.
 */
export function epicCost(epic, tasks, now = Date.now()) {
  const own = tasks.filter((t) => t.epic_id === epic.id);
  const estimated = own.reduce((n, t) => n + (t.minutes || 0), 0);
  const worked = own.reduce((n, t) => n + workedMinutes(t, now), 0);
  const pending = own.reduce((n, t) => n + pendingMinutes(t, now), 0);
  const rate = Number(epic.rate) || 0;
  return {
    minutes: { estimated, worked, pending, total: worked + pending },
    amount: {
      estimated: amountOf(estimated, rate), worked: amountOf(worked, rate), pending: amountOf(pending, rate), total: amountOf(worked + pending, rate),
    },
  };
}

/** Formato de cada moneda, igual en cualquier navegador: CLP "$285.000" · USD "US$1.250,50" · EUR "1.250,50 €". */
const MONEY_LOCALE = { CLP: 'es-CL', USD: 'es-CL', EUR: 'es-ES' };

export function formatMoney(amount, currency, locale) {
  const loc = locale || MONEY_LOCALE[currency] || 'es-CL';
  const digits = decimalsOf(currency);
  try {
    return new Intl.NumberFormat(loc, { style: 'currency', currency, minimumFractionDigits: digits, maximumFractionDigits: digits })
      .format(amount);
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
