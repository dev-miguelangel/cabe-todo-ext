// Vista "Ajustes": horarios de los bloques, duración por defecto, avisos y atajo de teclado.

import { state, saveSettings, calibrationInfo, exportBackup, readBackup, restoreBackup } from '../services/store.js';
import { showToast } from '../utils/ui.js';
import { todayISO } from '../utils/dates.js';
import { playCasio } from '../services/casio.js';

const form = () => document.getElementById('settings-form');

export function renderSettings() {
  const f = form();
  // No pisar lo que el usuario está editando.
  if (f.contains(document.activeElement)) return;
  const s = state.settings;
  f.elements['am-start'].value = s.am.start;
  f.elements['am-end'].value = s.am.end;
  f.elements['pm-start'].value = s.pm.start;
  f.elements['pm-end'].value = s.pm.end;
  f.elements['default-minutes'].value = String(s.default_minutes);
  f.elements.theme.value = s.theme || 'chrome';
  f.elements.notify.checked = Boolean(s.notify);
  f.elements['timer-sound'].checked = s.timer_sound !== false;
  f.elements['float-timer'].checked = s.float_timer !== false;
  f.elements.calibrate.checked = s.calibrate !== false;
  document.getElementById('calibration-info').textContent = calibrationText(calibrationInfo);
  f.elements['meeting-lead'].value = String(s.meeting_lead ?? 10);
  loadShortcut();
}

/** "Según tus últimas 12 tareas, tardas ~20 % más de lo que estimas." */
export function calibrationText({ factor, samples }) {
  if (samples < 3) return `Aprende de las tareas que terminas con el temporizador (${samples} de 3 para empezar).`;
  const pct = Math.round(Math.abs(factor - 1) * 100);
  const base = `Según tus últimas ${samples} tareas con tiempo registrado`;
  if (pct < 5) return `${base}, tus estimaciones son acertadas.`;
  return `${base}, tardas ~${pct} % ${factor > 1 ? 'más' : 'menos'} de lo que estimas.`;
}

async function loadShortcut() {
  const el = document.getElementById('shortcut-key');
  try {
    const commands = await chrome.commands.getAll();
    const cmd = commands.find((c) => c.name === '_execute_action');
    el.textContent = cmd?.shortcut || 'sin asignar';
  } catch {
    el.textContent = 'Alt+Shift+P';
  }
}

export function setupSettings() {
  const f = form();
  const error = document.getElementById('settings-error');
  const saved = document.getElementById('settings-saved');
  let savedTimer;

  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const values = ['am-start', 'am-end', 'pm-start', 'pm-end'].map((n) => f.elements[n].value);
    if (values.some((v) => !v)) {
      error.textContent = 'Completa todas las horas.';
      error.hidden = false;
      return;
    }
    const [amStart, amEnd, pmStart, pmEnd] = values;
    const problem = saveSettings({
      am: { start: amStart, end: amEnd },
      pm: { start: pmStart, end: pmEnd },
      default_minutes: Number(f.elements['default-minutes'].value),
      theme: f.elements.theme.value,
      notify: f.elements.notify.checked,
      timer_sound: f.elements['timer-sound'].checked,
      float_timer: f.elements['float-timer'].checked,
      calibrate: f.elements.calibrate.checked,
      meeting_lead: Number(f.elements['meeting-lead'].value),
    });
    error.textContent = problem || '';
    error.hidden = !problem;
    if (!problem) {
      document.activeElement?.blur();
      saved.hidden = false;
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => { saved.hidden = true; }, 2000);
    }
  });

  // El tema se aplica y guarda al elegirlo (sin esperar a "Guardar")
  f.elements.theme.addEventListener('change', () => {
    saveSettings({ ...state.settings, theme: f.elements.theme.value });
  });

  document.getElementById('test-sound').addEventListener('click', () => playCasio());
  setupBackup();

  document.getElementById('edit-shortcuts').addEventListener('click', () => {
    try {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    } catch {
      /* fuera de la extensión no hay chrome.tabs */
    }
  });
}

// ---------- Respaldo ----------

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sizeOf = (tasks, epics) => `${count(tasks, 'tarea')}, ${count(epics, 'épica')}`;

function setupBackup() {
  document.getElementById('export-data').addEventListener('click', () => {
    const blob = new Blob([exportBackup()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pert-day-${todayISO()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Respaldo descargado: ${sizeOf(state.tasks.length, state.epics.length)}.`);
  });

  const file = document.getElementById('import-file');
  document.getElementById('import-data').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const chosen = file.files[0];
    file.value = '';
    if (!chosen) return;
    let backup;
    try {
      backup = readBackup(await chosen.text());
    } catch (err) {
      showToast(err.message);
      return;
    }
    const { tasks, epics } = backup.summary;
    const ok = window.confirm(
      `¿Reemplazar todo lo actual (${sizeOf(state.tasks.length, state.epics.length)}) `
      + `por el respaldo (${sizeOf(tasks, epics)})?\n\nEsto no se puede deshacer: exporta primero si quieres conservar lo actual.`,
    );
    if (!ok) return;
    restoreBackup(backup.data);
    showToast(`Respaldo restaurado: ${sizeOf(tasks, epics)}.`);
  });
}
