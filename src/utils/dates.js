// Utilidades de fechas. Las fechas se manejan como "YYYY-MM-DD" en hora local.

export function toISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO(now = new Date()) {
  return toISO(now);
}

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function shiftDate(iso, days) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

/** "Miércoles, 11 nov" */
export function dayLabel(iso) {
  const label = parseISO(iso).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'short' });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "mié 11 nov" */
export function shortLabel(iso) {
  return parseISO(iso).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/[.,]/g, '');
}

/** "08:30" → 510 */
export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

export function nowMinutes(now = new Date()) {
  return now.getHours() * 60 + now.getMinutes();
}

/** "2026-11-11" → "11-11-2026" (dd-mm-aaaa) */
export function formatDMY(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}
