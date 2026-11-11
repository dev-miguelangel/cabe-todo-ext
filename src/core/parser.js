// Quick-add: convierte "Informe mensual 2h ? pm #web" en
// { title, minutes, block, certainty, epicTag, repeat, date, meeting }.
// "Standup 15m am cada día" / "hábiles" / "cada lun,jue" → repeat: días de la semana (0 = domingo).
// Bloque: su título al final ("… gym", "… foco profundo"), "@gym" o am / pm / tarde.
// "bl" = al backlog (block: 'backlog').
// Día: "hoy", "mañana" (siempre el día siguiente), "pasado mañana", "miércoles", "el viernes" → date ISO.
// Reunión: "Reunión proyecto 1 miércoles desde la 1pm 1h" → meeting { start: '13:00', end: '14:00' }.
// Los tokens se leen desde el final del texto; los que no se escribieron quedan en null.

import { takeRepeat } from './routines.js';
import { DEFAULT_BLOCK_WORDS, BACKLOG, fold } from './blocks.js';
import { todayISO, shiftDate, parseISO } from '../utils/dates.js';

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

// ---------- Días ----------
const WEEKDAY = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };
// Palabras que se van junto con el día: "para mañana", "el viernes", "este jueves"
const DATE_CONNECTORS = new Set(['para', 'el', 'este', 'esta', 'proximo', 'del']);

/** Próximo día de la semana `wd` desde `today` (si es hoy, hoy). */
function nextWeekday(today, wd) {
  const diff = (wd - parseISO(today).getDay() + 7) % 7;
  return shiftDate(today, diff);
}

// ---------- Reuniones ----------
// Primera palabra que convierte la tarea en reunión (si además tiene una hora de inicio)
const MEETING_WORDS = new Set(['reunion', 'reu', 'junta', 'meeting']);
// Palabras que acompañan a una hora: "desde la 1pm", "a las 15", "hasta las 2pm"
const TIME_CONNECTORS = new Set(['desde', 'a', 'de', 'la', 'las', 'hasta']);
const AMPM_TIME = /^(\d{1,2})(?::([0-5]\d))?(am|pm)$/;
const CLOCK_TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** "1pm" → 780, "1:30pm" → 810, "13:00" → 780, "15" (solo si va tras "la"/"las") → 900. */
function parseClock(word, prev) {
  let m = word.match(AMPM_TIME);
  if (m) {
    const h = Number(m[1]);
    if (h < 1 || h > 12) return null;
    return ((h % 12) + (m[3] === 'pm' ? 12 : 0)) * 60 + Number(m[2] || 0);
  }
  m = word.match(CLOCK_TIME);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  if (/^\d{1,2}$/.test(word) && (prev === 'la' || prev === 'las') && Number(word) <= 23) return Number(word) * 60;
  return null;
}

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

/**
 * blockWords: { tags, phrases, words } de blockWords(ajustes); por defecto, los bloques Mañana y Tarde.
 * opts.today: 'YYYY-MM-DD' desde el que se calculan "mañana", "miércoles"… (por defecto, hoy).
 */
export function parseQuickAdd(text, blockWords = DEFAULT_BLOCK_WORDS, { today = todayISO(), meetings = true } = {}) {
  let clean = text.trim();
  const isMeetingText = meetings && MEETING_WORDS.has(fold(clean.split(/\s+/)[0] || ''));
  // "1 pm" → "1pm" (solo en reuniones: en una tarea normal "2 am" puede ser parte del título)
  if (isMeetingText) clean = clean.replace(/\b(\d{1,2}(?::\d{2})?)\s+(am|pm)\b/gi, '$1$2');
  const words = clean.split(/\s+/).filter(Boolean);
  let minutes = null;
  let block = null;
  let certainty = null;
  let epicTag = null;
  let repeat = null;
  let date = null;
  const times = []; // horas de la reunión encontradas, del final al principio: { min, until }

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

    // Día: "hoy", "mañana", "pasado mañana", "miércoles" (después de "cada" ya lo tomó la repetición)
    if (date === null) {
      const key = fold(word);
      const prev = fold(words[words.length - 2] || '');
      let found = null;
      let used = 1;
      if (key === 'hoy') found = today;
      else if (key === 'manana' && prev === 'pasado' && words.length > 2) {
        found = shiftDate(today, 2);
        used = 2;
      } else if (key === 'manana' && prev !== 'la') found = shiftDate(today, 1); // "por la mañana" no es mañana
      else if (key in WEEKDAY && prev !== 'cada') found = nextWeekday(today, WEEKDAY[key]);
      if (found) {
        date = found;
        words.splice(-used);
        while (words.length > 1 && DATE_CONNECTORS.has(fold(words[words.length - 1]))) words.pop();
        continue;
      }
    }

    // Hora de la reunión: "1pm", "13:00", "desde la 1pm", "a las 15", "hasta las 2pm"
    if (isMeetingText && times.length < 2) {
      const min = parseClock(word, (words[words.length - 2] || '').toLowerCase());
      if (min !== null) {
        words.pop();
        let until = false;
        while (words.length > 1 && TIME_CONNECTORS.has(words[words.length - 1].toLowerCase())) {
          if (words.pop().toLowerCase() === 'hasta') until = true;
        }
        times.push({ min, until });
        continue;
      }
    }

    break;
  }

  // Reunión: hace falta la palabra al inicio y una hora de inicio; si no, es una tarea normal
  let meeting = null;
  if (isMeetingText && times.length) {
    const end = times.find((t) => t.until);
    const starts = times.filter((t) => !t.until);
    // Dos horas sin "hasta" ("de 1pm a 2pm"): la primera escrita es el inicio
    const start = starts.length ? starts[starts.length - 1].min : null;
    const endMin = end ? end.min : starts.length > 1 ? starts[0].min : null;
    if (start !== null) {
      if (words.length > 1) words.shift(); // "Reunión" no va en el título (salvo que sea lo único: "Junta 12pm")…
      // …ni lo que la une al nombre: "Reunión con Juan" → "Juan"
      while (words.length > 1 && ['con', 'de', 'del', 'sobre', 'para'].includes(words[0].toLowerCase())) words.shift();
      let finish = endMin;
      if (finish === null && minutes) finish = start + minutes;
      if (finish !== null) finish = Math.min(finish, 23 * 60 + 59);
      if (finish !== null && finish <= start) finish = null;
      if (finish !== null) minutes = finish - start;
      meeting = { start: hhmm(start), end: finish === null ? null : hhmm(finish) };
    }
  }
  // Tenía "reunión" y alguna hora, pero no quedó una reunión válida (p. ej. solo "hasta las 2pm"):
  // es una tarea normal y las horas quedan en el título.
  if (!meeting && times.length) return parseQuickAdd(text, blockWords, { today, meetings: false });

  const title = words.join(' ');
  if (!title) return null;
  return { title, minutes, block, certainty, epicTag, repeat, date, meeting };
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
