// Service worker: abre el side panel desde el ícono/atajo, avisa cuando termina cada bloque
// y suena la alarma cuando el temporizador de una tarea llega a cero (aunque el panel esté cerrado).

import { loadData } from './storage.js';
import { todayISO, toMinutes } from './dates.js';
import { isRunning, zeroAt, remainingMs } from './timer.js';

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
    iconUrl: 'icons/icon128.png',
    title,
    message,
    priority: 0,
  });
}

// ---------- Temporizador: alarma al llegar a cero ----------

const TIMER_ALARM = 'timer-zero';
const OFFSCREEN_URL = 'offscreen.html';

/** Programa una alarma para el momento en que el temporizador en marcha llega a cero. */
async function scheduleTimerAlarm() {
  const { tasks } = await loadData();
  await chrome.alarms.clear(TIMER_ALARM);
  const running = tasks.find(isRunning);
  const when = running && zeroAt(running);
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
  const task = tasks.find(isRunning);
  if (!task) return;
  // Si cambió la estimación o hubo pausas, puede que todavía no llegue a cero: reprogramar.
  if (remainingMs(task) > 1000) {
    await scheduleTimerAlarm();
    return;
  }
  if (Date.now() - alarm.scheduledTime > MAX_DELAY_MS) return;
  if (settings.timer_sound !== false) playAlarmSound();
  chrome.notifications.create(`pertday-timer-${task.id}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Tiempo cumplido',
    message: `"${task.title}" llegó a su estimado de ${task.minutes} min. El temporizador sigue corriendo.`,
    priority: 2,
    requireInteraction: true,
  });
}

chrome.runtime.onInstalled.addListener(() => {
  setupPanel();
  scheduleAlarms();
  scheduleTimerAlarm();
});
chrome.runtime.onStartup.addListener(() => {
  scheduleAlarms();
  scheduleTimerAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === TIMER_ALARM) {
    await onTimerZero(alarm);
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
  if (changes.tasks) scheduleTimerAlarm();
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
