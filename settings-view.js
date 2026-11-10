// Vista "Ajustes": horarios de los bloques, duración por defecto, avisos y atajo de teclado.

import { state, saveSettings } from './store.js';

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
  f.elements.notify.checked = Boolean(s.notify);
  loadShortcut();
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
      notify: f.elements.notify.checked,
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

  document.getElementById('edit-shortcuts').addEventListener('click', () => {
    try {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    } catch {
      /* fuera de la extensión no hay chrome.tabs */
    }
  });
}
