// Service worker: abre el side panel desde el ícono/atajo y avisa cuando termina cada bloque.

import { loadData } from './storage.js';
import { todayISO, toMinutes } from './dates.js';

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

chrome.runtime.onInstalled.addListener(() => {
  setupPanel();
  scheduleAlarms();
});
chrome.runtime.onStartup.addListener(scheduleAlarms);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) return;
  const block = alarm.name.slice(ALARM_PREFIX.length);
  if (Date.now() - alarm.scheduledTime < MAX_DELAY_MS) await notifyBlockEnd(block);
  await scheduleAlarms(); // reprogramar para el día siguiente
});

// Si cambian los horarios o se activan/desactivan los avisos, reprogramar.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) scheduleAlarms();
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
