// Service worker: abre el side panel desde el ícono/atajo, avisa cuando termina cada bloque
// y suena la alarma cuando el temporizador de una tarea llega a cero (aunque el panel esté cerrado).

import { loadData } from '../services/storage.js';
import { todayISO, toMinutes } from '../utils/dates.js';
import { isRunning, zeroAt, remainingMs, timerConflicts } from '../core/timer.js';
import { activeBlockingMeeting, timerBlockedBy } from '../core/pert.js';
import { dueInstances } from '../core/routines.js';

/** Rutas absolutas desde la raíz de la extensión (el worker vive en src/background/). */
const ICON_URL = '/assets/icons/icon128.png';

const BLOCKS = ['am', 'pm'];
const BLOCK_NAME = { am: 'mañana', pm: 'tarde' };
const ALARM_PREFIX = 'block-end-';
// Si el computador estaba dormido y la alarma llega tarde, no avisar algo que ya no sirve.
const MAX_DELAY_MS = 60 * 60 * 1000;

function setupPanel() {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('Pert-day: no se pudo configurar el side panel', err));
}

/** Próxima vez (timestamp) que el reloj marca hh:mm. */
function nextOccurrence(hhmm, now = new Date()) {
  const minutes = toMinutes(hhmm);
  const d = new Date(now);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

async function scheduleAlarms() {
  const { settings } = await loadData();
  await Promise.all(BLOCKS.map((b) => chrome.alarms.clear(ALARM_PREFIX + b)));
  if (!settings.notify) return;
  for (const block of BLOCKS) {
    chrome.alarms.create(ALARM_PREFIX + block, { when: nextOccurrence(settings[block].end) });
  }
}

async function notifyBlockEnd(block) {
  const { tasks, settings } = await loadData();
  if (!settings.notify) return;
  const today = todayISO();
  const own = tasks.filter((t) => t.date === today && t.block === block);
  if (!own.length) return;
  const pending = own.filter((t) => !t.done);
  const name = BLOCK_NAME[block];

  let title;
  let message;
  if (pending.length) {
    const n = pending.length;
    title = `Terminó la ${name}`;
    const list = pending.slice(0, 3).map((t) => t.title).join(', ') + (n > 3 ? '…' : '');
    message = `${n === 1 ? 'Te queda 1 tarea' : `Te quedan ${n} tareas`}: ${list}`;
  } else {
    title = `Terminaste todo lo de la ${name}`;
    message = `${own.length} tarea${own.length > 1 ? 's' : ''} hecha${own.length > 1 ? 's' : ''}.`;
  }
  chrome.notifications.create(`pertday-${today}-${block}`, {
    type: 'basic',
    iconUrl: ICON_URL,
    title,
    message,
    priority: 0,
  });
}

// ---------- Temporizador: alarma al llegar a cero ----------

const TIMER_ALARM = 'timer-zero';
const OFFSCREEN_URL = '/src/pages/offscreen/offscreen.html';

/** Programa una alarma para el momento en que el temporizador en marcha llega a cero. */
async function scheduleTimerAlarm() {
  const { tasks } = await loadData();
  await chrome.alarms.clear(TIMER_ALARM);
  // Puede haber dos corriendo (una tarea y una reunión paralela): la que llegue antes a cero
  const when = tasks.filter(isRunning).map((t) => zeroAt(t)).filter(Boolean).sort((a, b) => a - b)[0];
  // Nota: Chrome no dispara alarmas antes de ~30 s; si queda menos, sonará con ese margen.
  if (when) chrome.alarms.create(TIMER_ALARM, { when });
}

/** Suena la alarma tipo Casio desde un documento offscreen (MV3 no tiene audio en el service worker). */
async function playAlarmSound() {
  try {
    if (await chrome.offscreen.hasDocument()) {
      chrome.runtime.sendMessage({ type: 'pertday-casio' });
    } else {
      // offscreen.js suena apenas carga
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ['AUDIO_PLAYBACK'],
        justification: 'Sonido de aviso cuando el temporizador de una tarea llega a cero',
      });
    }
    setTimeout(() => chrome.offscreen.closeDocument().catch(() => {}), 4000);
  } catch (err) {
    console.error('Pert-day: no se pudo reproducir el sonido', err);
  }
}

async function onTimerZero(alarm) {
  const { tasks, settings } = await loadData();
  // Las que acaban de cruzar el cero (no las que ya llevaban rato pasadas)
  const task = tasks.find((t) => isRunning(t) && remainingMs(t) <= 1000 && remainingMs(t) > -2 * 60 * 1000);
  await scheduleTimerAlarm(); // la siguiente que llegue a cero (si hay dos corriendo)
  if (!task || Date.now() - alarm.scheduledTime > MAX_DELAY_MS) return;
  if (settings.timer_sound !== false) playAlarmSound();
  chrome.notifications.create(`pertday-timer-${task.id}`, {
    type: 'basic',
    iconUrl: ICON_URL,
    title: 'Tiempo cumplido',
    message: `"${task.title}" llegó a su estimado de ${task.minutes} min. El temporizador sigue corriendo.`,
    priority: 2,
    requireInteraction: true,
  });
}

// ---------- Rutinas: crear las tareas del día aunque el panel no se abra ----------
// (así una reunión diaria avisa y muestra su botón flotante sin abrir Pert-day)

const ROUTINES_ALARM = 'routines-daily';

async function ensureRoutinesToday() {
  const { tasks = [], routines = [] } = await chrome.storage.local.get(['tasks', 'routines']);
  if (!routines.length) return;
  const today = todayISO();
  const orderFor = (date, block) => {
    const orders = tasks.filter((t) => t.date === date && t.block === block).map((t) => t.order);
    return orders.length ? Math.max(...orders) + 1 : 0;
  };
  const newId = () => `t_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const due = dueInstances(routines, today, { newId, orderFor });
  if (!due.tasks.length) return;
  await chrome.storage.local.set({
    tasks: [...tasks, ...due.tasks], routines: due.routines, meta: { writer: 'background', at: Date.now() },
  });
}

/** Revisar justo después de medianoche (y al iniciar Chrome). */
function scheduleRoutinesAlarm() {
  const next = new Date();
  next.setHours(24, 0, 30, 0);
  chrome.alarms.create(ROUTINES_ALARM, { when: next.getTime() });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureRoutinesToday();
  scheduleRoutinesAlarm();
  setupPanel();
  scheduleAlarms();
  scheduleTimerAlarm();
  scheduleMeetingAlarm();
});
chrome.runtime.onStartup.addListener(() => {
  ensureRoutinesToday();
  scheduleRoutinesAlarm();
  scheduleAlarms();
  scheduleTimerAlarm();
  scheduleMeetingAlarm();
  enforceBlockingMeeting(); // Chrome se abrió en medio de una reunión que bloquea
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === TIMER_ALARM) {
    await onTimerZero(alarm);
    return;
  }
  if (alarm.name === MEETING_ALARM) {
    await onMeetingStart();
    return;
  }
  if (alarm.name === ROUTINES_ALARM) {
    await ensureRoutinesToday();
    scheduleRoutinesAlarm();
    return;
  }
  if (alarm.name === MEETING_END_ALARM) {
    await onMeetingEnd();
    await scheduleMeetingAlarm();
    return;
  }
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const block = alarm.name.slice(ALARM_PREFIX.length);
  if (Date.now() - alarm.scheduledTime < MAX_DELAY_MS) await notifyBlockEnd(block);
  await scheduleAlarms(); // reprogramar para el día siguiente
});

// Si cambian los horarios o se activan/desactivan los avisos, reprogramar.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.settings) scheduleAlarms();
  // Iniciar, pausar, reiniciar o cambiar la estimación mueve el momento del cero.
  if (changes.tasks) {
    scheduleTimerAlarm();
    scheduleMeetingAlarm(); // crear, mover o quitar reuniones cambia la próxima
  }
});

// ---------- Reuniones: al empezar, iniciar su temporizador ----------

const MEETING_ALARM = 'meeting-start';
// Margen para considerar "recién empezada" una reunión cuando la alarma llega (Chrome puede atrasarla)
const MEETING_GRACE_MS = 5 * 60 * 1000;

/** Fecha/hora local de una reunión → timestamp. */
function meetingAt(task, which) {
  const [y, m, d] = task.date.split('-').map(Number);
  const [h, mi] = task.meeting[which].split(':').map(Number);
  return new Date(y, m - 1, d, h, mi).getTime();
}

/** Cierra el tramo en curso en `atMs` (sin quedar antes de su propio inicio). */
function closeEntry(entries, atMs) {
  const last = entries[entries.length - 1];
  const end = new Date(Math.max(Date.parse(last.start), atMs)).toISOString();
  return [...entries.slice(0, -1), { ...last, end }];
}

/**
 * Inicia el temporizador de una tarea, pausando el que esté corriendo. Escribe directo al almacenamiento.
 * atMs: momento de inicio (por defecto ahora; al empezar una reunión, su hora exacta de inicio).
 * Devuelve false si no se pudo (no existe, ya corre o lo impide una reunión que bloquea).
 */
async function startTimerFor(taskId, atMs = Date.now()) {
  const { tasks = [] } = await chrome.storage.local.get('tasks');
  const target = tasks.find((t) => t.id === taskId);
  if (!target || isRunning(target)) return false;
  if (timerBlockedBy(target, tasks)) return false;
  const conflicts = timerConflicts(target, tasks);
  if (conflicts.blockedBy) return false;
  const pause = new Set(conflicts.pause.map((t) => t.id));
  const next = tasks.map((t) => {
    const entries = t.time_entries || [];
    if (t.id === taskId) return { ...t, time_entries: [...entries, { start: new Date(atMs).toISOString(), end: null }] };
    if (pause.has(t.id)) return { ...t, time_entries: closeEntry(entries, atMs) };
    return t;
  });
  await chrome.storage.local.set({ tasks: next, meta: { writer: 'background', at: Date.now() } });
  return true;
}

/**
 * Regla de la reunión que bloquea: mientras está en curso, solo corre su temporizador.
 * Pausa lo demás en la hora de inicio de la reunión (no cuando llegó la alarma) y, si la reunión
 * no tiene tiempo registrado desde que empezó, inicia el suyo también desde esa hora.
 * Devuelve la reunión (o null si no hay ninguna en curso).
 */
async function enforceBlockingMeeting() {
  const { tasks = [] } = await chrome.storage.local.get('tasks');
  const meeting = activeBlockingMeeting(tasks);
  if (!meeting) return null;
  const startMs = meetingAt(meeting, 'start');
  const entries = meeting.time_entries || [];
  // Si la persona ya la pausó a mano durante la reunión, respetarlo
  const trackedSinceStart = entries.some((e) => !e.end || Date.parse(e.end) > startMs);
  let changed = false;
  const next = tasks.map((t) => {
    const e = t.time_entries || [];
    if (t.id === meeting.id) {
      if (trackedSinceStart) return t;
      changed = true;
      return { ...t, time_entries: [...e, { start: new Date(startMs).toISOString(), end: null }] };
    }
    if (!t.meeting && e.length && !e[e.length - 1].end) { // las reuniones no se pausan
      changed = true;
      return { ...t, time_entries: closeEntry(e, startMs) };
    }
    return t;
  });
  if (changed) await chrome.storage.local.set({ tasks: next, meta: { writer: 'background', at: Date.now() } });
  return { meeting, startedNow: changed && !trackedSinceStart };
}

/** Alarma para la próxima reunión pendiente que todavía no empieza. */
async function scheduleMeetingAlarm() {
  const { tasks } = await loadData();
  await chrome.alarms.clear(MEETING_ALARM);
  const now = Date.now();
  const next = tasks
    .filter((t) => t.meeting && !t.done && t.date)
    .map((t) => meetingAt(t, 'start'))
    .filter((when) => when > now)
    .sort((a, b) => a - b)[0];
  if (next) chrome.alarms.create(MEETING_ALARM, { when: next });
  await scheduleMeetingEndAlarm(tasks);
}

// ---------- Reuniones: al llegar su hora de fin, terminarlas solas ----------

const MEETING_END_ALARM = 'meeting-end';

/** Reuniones con el temporizador corriendo que ya llegaron a su hora de fin. */
const overdueRunningMeetings = (tasks, now = Date.now()) =>
  tasks.filter((t) => t.meeting && !t.done && t.date && isRunning(t) && meetingAt(t, 'end') <= now + 1000);

/** Alarma para el próximo fin de una reunión en curso. Si alguna ya pasó su fin (Chrome dormido), cerrarla ya. */
async function scheduleMeetingEndAlarm(tasks) {
  await chrome.alarms.clear(MEETING_END_ALARM);
  if (overdueRunningMeetings(tasks).length) {
    await onMeetingEnd();
    return;
  }
  const next = tasks
    .filter((t) => t.meeting && !t.done && t.date && isRunning(t))
    .map((t) => meetingAt(t, 'end'))
    .sort((a, b) => a - b)[0];
  if (next) chrome.alarms.create(MEETING_END_ALARM, { when: next });
}

/**
 * Termina las reuniones en curso que llegaron a su hora de fin: su tiempo se registra hasta
 * esa hora exacta (aunque la alarma llegue tarde) y quedan hechas.
 */
async function onMeetingEnd() {
  const { tasks = [] } = await chrome.storage.local.get('tasks');
  const ending = overdueRunningMeetings(tasks);
  if (!ending.length) return;
  const ids = new Set(ending.map((t) => t.id));
  const next = tasks.map((t) => {
    if (!ids.has(t.id)) return t;
    const endMs = meetingAt(t, 'end');
    return { ...t, done: true, done_at: new Date(endMs).toISOString(), time_entries: closeEntry(t.time_entries || [], endMs) };
  });
  await chrome.storage.local.set({ tasks: next, meta: { writer: 'background', at: Date.now() } });
  for (const meeting of ending) {
    chrome.notifications.create(`pertday-meeting-end-${meeting.id}`, {
      type: 'basic',
      iconUrl: ICON_URL,
      title: `Terminó la reunión: ${meeting.title}`,
      message: `Su tiempo quedó registrado hasta las ${meeting.meeting.end}.`,
      priority: 1,
    });
  }
}

async function onMeetingStart() {
  // Reunión que bloquea: pausar lo demás y correr solo la reunión (las paralelas no pausan nada)
  const enforced = await enforceBlockingMeeting();
  const { tasks } = await loadData();
  const now = Date.now();
  const starting = tasks.filter((t) => t.meeting && !t.done && t.date
    && meetingAt(t, 'start') <= now + 1000 && now - meetingAt(t, 'start') < MEETING_GRACE_MS);
  for (const meeting of starting) {
    const started = enforced?.meeting.id === meeting.id && enforced.startedNow;
    chrome.notifications.create(`pertday-meeting-${meeting.id}`, {
      type: 'basic',
      iconUrl: ICON_URL,
      title: `Empezó la reunión: ${meeting.title}`,
      message: `${meeting.meeting.start}–${meeting.meeting.end}${started ? ' · su temporizador ya está corriendo' : ''}`,
      priority: 2,
    });
  }
  await scheduleMeetingAlarm();
}

// ---------- Botón flotante del temporizador (float-timer.js) ----------

/** Pausa el temporizador en marcha (lectura y escritura directa del almacenamiento). */
async function pauseRunningTimer() {
  const { tasks = [] } = await chrome.storage.local.get('tasks');
  const now = new Date().toISOString();
  let changed = false;
  const next = tasks.map((t) => {
    const entries = t.time_entries || [];
    if (t.meeting || !entries.length || entries[entries.length - 1].end) return t; // las reuniones no se pausan
    changed = true;
    return { ...t, time_entries: [...entries.slice(0, -1), { ...entries[entries.length - 1], end: now }] };
  });
  if (changed) await chrome.storage.local.set({ tasks: next, meta: { writer: 'background', at: Date.now() } });
}

/** Finalizar una reunión desde el botón flotante: marcarla hecha y cerrar su tiempo. */
async function finishMeetingFromFloat(taskId) {
  const { tasks = [] } = await chrome.storage.local.get('tasks');
  const now = new Date().toISOString();
  const next = tasks.map((t) => {
    if (t.id !== taskId || !t.meeting) return t;
    const entries = t.time_entries || [];
    const open = entries.length && !entries[entries.length - 1].end;
    return { ...t, done: true, done_at: now, time_entries: open ? closeEntry(entries, Date.now()) : entries };
  });
  await chrome.storage.local.set({ tasks: next, meta: { writer: 'background', at: Date.now() } });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'pertday-open-panel') {
    // Debe llamarse de inmediato (sin await antes) para que Chrome lo cuente como gesto del usuario
    const windowId = sender.tab?.windowId;
    if (windowId !== undefined) chrome.sidePanel.open({ windowId }).catch(() => {});
  }
  if (msg?.type === 'pertday-pause-timer') pauseRunningTimer();
  if (msg?.type === 'pertday-start-timer' && msg.taskId) startTimerFor(msg.taskId);
  if (msg?.type === 'pertday-finish-meeting' && msg.taskId) finishMeetingFromFloat(msg.taskId);
});

// Clic en el aviso: intentar abrir el panel en la ventana activa.
chrome.notifications.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  try {
    const win = await chrome.windows.getLastFocused();
    await chrome.sidePanel.open({ windowId: win.id });
  } catch {
    /* Chrome puede exigir un gesto del usuario: el aviso igual cumplió su función */
  }
});
