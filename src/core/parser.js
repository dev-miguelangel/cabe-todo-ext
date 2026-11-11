// Quick-add: convierte "Informe mensual 2h ? pm #web" en { title, minutes, block, certainty, epicTag, repeat }.
// "Standup 15m am cada día" / "hábiles" / "cada lun,jue" → repeat: días de la semana (0 = domingo).
// Bloque: su título al final ("… gym", "… foco profundo"), "@gym" o las de siempre am/pm/mañana/tarde.
// "bl" = al backlog (block: 'backlog').
// Los tokens se leen desde el final del texto; los que no se escribieron quedan en null.

import { takeRepeat } from './routines.js';
import { DEFAULT_BLOCK_WORDS, BACKLOG, fold } from './blocks.js';

const DURATION = /^(\d+(?:[.,]\d+)?)(m|min|mins|h|hr|hrs)$/;
const HOURS_MINUTES = /^(\d+)h(\d{1,2})m?$/;
// Debe empezar con letra: "Issue #42" no crea una épica.
const EPIC_TAG = /^#(\p{L}[\p{L}\p{N}_-]*)$/u;
const BLOCK_TAG = /^@(\p{L}[\p{L}\p{N}_-]*)$/u;
const CERTAINTY_MARKS = { '?': 'unsure', '!': 'sure' };
// Los nombres de bloque suelen ser palabras normales ("tarde", "gym"): no se toman como bloque
// si van precedidos de estas palabras ("Reunión de la tarde", "Ir al gym", "Llamar en la mañana").
const NATURAL_PREFIX = new Set(['la', 'el', 'los', 'las', 'de', 'del', 'en', 'por', 'esta', 'este', 'cada', 'toda', 'todo', 'al', 'a', 'mi', 'tu', 'su', 'para', 'con']);
const MAX_MINUTES = 12 * 60;

function parseDuration(word) {
  let m = word.match(HOURS_MINUTES);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = word.match(DURATION);
  if (m) {
    const n = parseFloat(m[1].replace(',', '.'));
    return Math.round(m[2].startsWith('h') ? n * 60 : n);
  }
  return null;
}

/** blockWords: { tags, words } de blockWords(ajustes); por defecto, los bloques Mañana y Tarde. */
export function parseQuickAdd(text, blockWords = DEFAULT_BLOCK_WORDS) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  let minutes = null;
  let block = null;
  let certainty = null;
  let epicTag = null;
  let repeat = null;

  while (words.length > 1) {
    const original = words[words.length - 1];
    const word = original.toLowerCase();

    if (epicTag === null) {
      const m = original.match(EPIC_TAG);
      if (m) {
        epicTag = m[1];
        words.pop();
        continue;
      }
    }

    // "?" o "!" sueltos
    if (certainty === null && CERTAINTY_MARKS[word]) {
      certainty = CERTAINTY_MARKS[word];
      words.pop();
      continue;
    }

    // Duración, opcionalmente pegada a la marca: "1h?" "30m!"
    if (minutes === null) {
      const mark = word.slice(-1);
      const attached = certainty === null && CERTAINTY_MARKS[mark] ? CERTAINTY_MARKS[mark] : null;
      const d = parseDuration(attached ? word.slice(0, -1) : word);
      if (d !== null && d > 0 && d <= MAX_MINUTES) {
        minutes = d;
        if (attached) certainty = attached;
        words.pop();
        continue;
      }
    }

    // "bl": dejarla en el backlog
    if (block === null && word === 'bl') {
      block = BACKLOG;
      words.pop();
      continue;
    }

    if (block === null) {
      const tag = original.match(BLOCK_TAG);
      const id = tag && blockWords.tags[fold(tag[1])];
      if (id) {
        block = id;
        words.pop();
        continue;
      }
    }

    // El título del bloque escrito tal cual al final: "Leer paper foco profundo"
    if (block === null) {
      const phrase = (blockWords.phrases || []).find((ph) => {
        const n = ph.words.length;
        if (words.length <= n) return false; // tiene que quedar título
        const tail = words.slice(-n).map(fold);
        if (!tail.every((w, i) => w === ph.words[i])) return false;
        return !NATURAL_PREFIX.has(words[words.length - n - 1].toLowerCase());
      });
      if (phrase) {
        block = phrase.id;
        words.splice(-phrase.words.length);
        continue;
      }
    }

    if (block === null && blockWords.words[word]) {
      const isAbbrev = word === 'am' || word === 'pm';
      const prev = words[words.length - 2].toLowerCase();
      if (isAbbrev || !NATURAL_PREFIX.has(prev)) {
        block = blockWords.words[word];
        words.pop();
        continue;
      }
    }

    if (repeat === null) {
      const days = takeRepeat(words);
      if (days) {
        repeat = days;
        continue;
      }
    }

    break;
  }

  const title = words.join(' ');
  if (!title) return null;
  return { title, minutes, block, certainty, epicTag, repeat };
}

/** "Lanzar Web!" → "lanzar-web" (sin tildes, para usar como #etiqueta). */
export function slugify(text) {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Clave para comparar etiquetas: #lanzar-web, #LanzarWeb y "Lanzar web" son la misma épica. */
export function tagKey(text) {
  return slugify(text).replace(/-/g, '');
}

/** Texto para el input de edición: "Informe 2h ? #web" (lo inverso de parseQuickAdd). */
export function toQuickAddText(task, epic = null) {
  const mark = task.certainty === 'unsure' ? ' ?' : task.certainty === 'sure' ? ' !' : '';
  const tag = epic ? ` #${slugify(epic.name)}` : '';
  return `${task.title} ${formatMinutes(task.minutes)}${mark}${tag}`;
}

export function formatMinutes(total) {
  const min = Math.round(total);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

/** Minutos desde medianoche → "10:45". */
export function formatClock(minutesOfDay) {
  const min = Math.round(minutesOfDay);
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
