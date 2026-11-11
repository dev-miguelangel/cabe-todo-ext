// Bloques del día configurables (Ajustes → Bloques). Funciones puras: sin DOM ni chrome.*.
//
// Un bloque es { id, title, icon, start: 'HH:MM', end: 'HH:MM' }. Hay de 1 a 5, ordenados por hora
// y sin superponerse. Las tareas guardan el `id` del bloque (los de siempre son 'am' y 'pm',
// así las tareas anteriores siguen en su lugar).

import { toMinutes } from '../utils/dates.js';

export const MAX_BLOCKS = 5;
export const MAX_TITLE = 24;
export const BLOCK_ICONS = ['☀︎', '☾', '☕︎', '✦', '⚡︎', '◆', '●', '▲', '♥︎', '✎', '⌂', '♪', '⚑', '☘︎', '✈︎', '★'];

export const DEFAULT_BLOCKS = [
  { id: 'am', title: 'Mañana', icon: '☀︎', start: '08:00', end: '13:00' },
  { id: 'pm', title: 'Tarde', icon: '☾', start: '14:00', end: '19:00' },
];

const byStart = (a, b) => toMinutes(a.start) - toMinutes(b.start);

/**
 * Bloques de unos ajustes, ordenados por hora. Acepta el formato antiguo { am, pm }
 * (antes de los bloques personalizables) y lo convierte.
 */
export function blocksOf(settings) {
  if (Array.isArray(settings?.blocks) && settings.blocks.length) return [...settings.blocks].sort(byStart);
  return DEFAULT_BLOCKS.map((b) => ({ ...b, ...pickRange(settings?.[b.id]) }));
}

function pickRange(range) {
  if (!range || typeof range !== 'object') return {};
  const out = {};
  if (typeof range.start === 'string') out.start = range.start;
  if (typeof range.end === 'string') out.end = range.end;
  return out;
}

/** Ajustes guardados → ajustes con `blocks` (y sin las claves am/pm del formato antiguo). */
export function migrateBlocks(settings = {}) {
  const { am, pm, ...rest } = settings;
  const valid = Array.isArray(settings.blocks) && settings.blocks.length && !validateBlocks(settings.blocks);
  return { ...rest, blocks: valid ? blocksOf(settings) : blocksOf({ am, pm }) };
}

export const blockById = (settings, id) => blocksOf(settings).find((b) => b.id === id) || null;

/** Rango { start, end } del bloque; si el id no existe, el primero. */
export function blockRange(settings, id) {
  const blocks = blocksOf(settings);
  const b = blocks.find((x) => x.id === id) || blocks[0];
  return { start: b.start, end: b.end };
}

export const blockIndex = (settings, id) => blocksOf(settings).findIndex((b) => b.id === id);
export const firstBlock = (settings) => blocksOf(settings)[0];
export const lastBlock = (settings) => blocksOf(settings).at(-1);

/** "☀︎" del bloque (o "" si no existe). */
export const blockIcon = (settings, id) => blockById(settings, id)?.icon || '';

/** "☀︎ mañana" — para frases como "hoy · ☀︎ mañana". */
export function blockName(settings, id) {
  const b = blockById(settings, id);
  return b ? `${b.icon} ${b.title.toLowerCase()}` : '';
}

/** Bloques del mismo día que vienen después de `id`. */
export function blocksAfter(settings, id) {
  const blocks = blocksOf(settings);
  const i = blocks.findIndex((b) => b.id === id);
  return i < 0 ? [] : blocks.slice(i + 1);
}

/**
 * Bloque al que pertenece una hora: el primero que aún no termina a esa hora
 * (una hora entre dos bloques va al siguiente); después del último, el último.
 */
export function blockForTime(hhmm, settings) {
  const t = toMinutes(hhmm);
  const blocks = blocksOf(settings);
  return (blocks.find((b) => t < toMinutes(b.end)) || blocks.at(-1)).id;
}

/** Valida una lista de bloques. Devuelve un mensaje para mostrar, o null si está bien. */
export function validateBlocks(blocks) {
  if (!Array.isArray(blocks) || !blocks.length) return 'Necesitas al menos un bloque.';
  if (blocks.length > MAX_BLOCKS) return `Puedes tener hasta ${MAX_BLOCKS} bloques.`;
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  for (const b of blocks) {
    const name = b.title?.trim() ? `"${b.title.trim()}"` : 'Un bloque';
    if (!b.title?.trim()) return 'Cada bloque necesita un título.';
    if (b.title.trim().length > MAX_TITLE) return `${name}: el título puede tener hasta ${MAX_TITLE} caracteres.`;
    if (!b.icon) return `${name} necesita un ícono.`;
    if (!hhmm.test(b.start || '') || !hhmm.test(b.end || '')) return `${name}: completa las horas.`;
    if (toMinutes(b.start) >= toMinutes(b.end)) return `${name} debe terminar después de empezar.`;
  }
  const titles = new Set();
  for (const b of blocks) {
    const key = fold(b.title.trim());
    if (titles.has(key)) return `Hay dos bloques llamados "${b.title.trim()}".`;
    titles.add(key);
  }
  const sorted = [...blocks].sort(byStart);
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (toMinutes(cur.start) < toMinutes(prev.end)) {
      return `"${prev.title.trim()}" (${prev.start}–${prev.end}) y "${cur.title.trim()}" (${cur.start}–${cur.end}) se superponen.`;
    }
  }
  return null;
}

/**
 * Hueco libre para un bloque nuevo (hasta 1 h): después del último; si no cabe, el primer hueco
 * de al menos 15 min entre bloques o antes del primero. null si el día está lleno.
 */
export function nextFreeRange(blocks) {
  const MIN_GAP = 15;
  const LAST = 23 * 60 + 59;
  const hh = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const sorted = [...blocks].sort(byStart);
  if (!sorted.length) return { start: '08:00', end: '09:00' };
  const gaps = [{ from: toMinutes(sorted.at(-1).end), to: LAST }]; // después del último, primero
  for (let i = 1; i < sorted.length; i += 1) gaps.push({ from: toMinutes(sorted[i - 1].end), to: toMinutes(sorted[i].start) });
  gaps.push({ from: 0, to: toMinutes(sorted[0].start) });
  const gap = gaps.find((g) => g.to - g.from >= MIN_GAP);
  return gap ? { start: hh(gap.from), end: hh(Math.min(gap.from + 60, gap.to)) } : null;
}

/** Bloque que recibe las tareas de uno que se borra: el anterior, o el siguiente si era el primero. */
export function neighborBlock(oldBlocks, removedId, newBlocks) {
  const sorted = [...oldBlocks].sort(byStart);
  const i = sorted.findIndex((b) => b.id === removedId);
  const keep = new Set(newBlocks.map((b) => b.id));
  const before = sorted.slice(0, i).reverse().find((b) => keep.has(b.id));
  const after = sorted.slice(i + 1).find((b) => keep.has(b.id));
  return (before || after || [...newBlocks].sort(byStart)[0]).id;
}

/** Texto sin tildes y en minúsculas, sin espacios: "Mañana" → "manana", "Deep work" → "deepwork". */
export function fold(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Palabras del quick-add para elegir bloque:
 *  - tags: "@tarde", "@gym", "@deepwork" → id (título completo sin tildes ni espacios, o su primera palabra)
 *  - words: palabras sueltas de siempre (am, pm, mañana, tarde) para los bloques 'am' y 'pm'.
 */
export function blockWords(settings) {
  const blocks = blocksOf(settings);
  const tags = {};
  for (const b of blocks) {
    const full = fold(b.title);
    const first = fold(b.title.trim().split(/\s+/)[0] || '');
    if (first && !(first in tags)) tags[first] = b.id;
    if (full) tags[full] = b.id;
  }
  const words = {};
  const ids = new Set(blocks.map((b) => b.id));
  if (ids.has('am')) Object.assign(words, { am: 'am', 'mañana': 'am', manana: 'am' });
  if (ids.has('pm')) Object.assign(words, { pm: 'pm', tarde: 'pm' });
  return { tags, words };
}

export const DEFAULT_BLOCK_WORDS = blockWords({ blocks: DEFAULT_BLOCKS });
