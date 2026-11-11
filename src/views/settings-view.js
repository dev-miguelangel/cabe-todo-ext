// Vista "Ajustes": bloques del día, duración por defecto, avisos y atajo de teclado.

import { state, saveSettings, calibrationInfo, exportBackup, readBackup, restoreBackup, blockUsage } from '../services/store.js';
import { showToast, h } from '../utils/ui.js';
import { blocksOf, validateBlocks, nextFreeRange, neighborBlock, MAX_BLOCKS, MAX_TITLE, BLOCK_ICONS } from '../core/blocks.js';
import { todayISO } from '../utils/dates.js';
import { playCasio } from '../services/casio.js';

const form = () => document.getElementById('settings-form');

// ---------- Editor de bloques ----------

let blocksDirty = false; // hay cambios sin guardar en los bloques: no pisarlos al re-renderizar

function blockRow(b, count) {
  const icons = BLOCK_ICONS.includes(b.icon) ? BLOCK_ICONS : [b.icon, ...BLOCK_ICONS];
  return h('li', { class: 'block-row', dataset: { id: b.id } },
    h('select', { class: 'block-icon-select', name: 'block-icon', 'aria-label': 'Ícono del bloque', title: 'Ícono' },
      ...icons.map((icon) => h('option', { value: icon, selected: icon === b.icon }, icon))),
    h('input', {
      class: 'block-title-input', name: 'block-title', type: 'text', value: b.title, maxlength: MAX_TITLE,
      placeholder: 'Título', 'aria-label': 'Título del bloque', required: true,
    }),
    h('span', { class: 'block-times' },
      h('input', { type: 'time', name: 'block-start', value: b.start, 'aria-label': 'Desde', required: true }),
      h('span', { class: 'block-dash', 'aria-hidden': 'true' }, '–'),
      h('input', { type: 'time', name: 'block-end', value: b.end, 'aria-label': 'Hasta', required: true })),
    h('button', {
      type: 'button', class: 'block-remove', title: count > 1 ? 'Quitar bloque' : 'Necesitas al menos un bloque',
      'aria-label': `Quitar ${b.title}`, disabled: count <= 1,
    }, '✕'));
}

function renderBlockRows(blocks) {
  document.getElementById('block-rows').replaceChildren(...blocks.map((b) => blockRow(b, blocks.length)));
  document.getElementById('add-block').disabled = blocks.length >= MAX_BLOCKS;
  document.getElementById('add-block').title = blocks.length >= MAX_BLOCKS ? `Máximo ${MAX_BLOCKS} bloques` : '';
}

/** Bloques tal como están en el formulario (sin guardar). */
function readBlockRows() {
  return [...document.querySelectorAll('#block-rows .block-row')].map((li) => ({
    id: li.dataset.id,
    icon: li.querySelector('[name="block-icon"]').value,
    title: li.querySelector('[name="block-title"]').value,
    start: li.querySelector('[name="block-start"]').value,
    end: li.querySelector('[name="block-end"]').value,
  }));
}

/** Marca en rojo los bloques que se superponen y muestra el motivo. Devuelve el problema o null. */
function checkBlockRows(showError) {
  const blocks = readBlockRows();
  const problem = validateBlocks(blocks);
  const toMin = (t) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : NaN);
  const rows = [...document.querySelectorAll('#block-rows .block-row')];
  rows.forEach((li, i) => {
    const b = blocks[i];
    const bad = !(toMin(b.start) < toMin(b.end)) || blocks.some((o, j) => j !== i
      && toMin(b.start) < toMin(o.end) && toMin(o.start) < toMin(b.end));
    li.classList.toggle('invalid', bad);
  });
  if (showError) {
    const error = document.getElementById('settings-error');
    error.textContent = problem || '';
    error.hidden = !problem;
  }
  return problem;
}

function setupBlocksEditor() {
  const rows = document.getElementById('block-rows');
  document.getElementById('add-block').addEventListener('click', () => {
    const blocks = readBlockRows();
    if (blocks.length >= MAX_BLOCKS) return;
    const range = nextFreeRange(blocks);
    if (!range) {
      showToast('No quedan horas libres en el día: acorta un bloque primero.');
      return;
    }
    const icon = BLOCK_ICONS.find((i) => !blocks.some((b) => b.icon === i)) || BLOCK_ICONS[0];
    let id;
    do id = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; while (blocks.some((b) => b.id === id));
    blocksDirty = true;
    renderBlockRows([...blocks, { id, icon, title: '', ...range }]);
    rows.querySelector(`[data-id="${id}"] [name="block-title"]`).focus();
    checkBlockRows(false);
  });
  rows.addEventListener('click', (e) => {
    const remove = e.target.closest('.block-remove');
    if (!remove) return;
    blocksDirty = true;
    const id = remove.closest('.block-row').dataset.id;
    renderBlockRows(readBlockRows().filter((b) => b.id !== id));
    checkBlockRows(true);
  });
  rows.addEventListener('input', () => {
    blocksDirty = true;
    checkBlockRows(true);
  });
}

/** Si se quitan bloques con tareas o rutinas, pedir confirmación indicando a dónde pasan. */
function confirmRemovedBlocks(next) {
  const old = blocksOf(state.settings);
  for (const b of old.filter((o) => !next.some((n) => n.id === o.id))) {
    const { tasks, routines } = blockUsage(b.id);
    if (!tasks && !routines) continue;
    const to = next.find((n) => n.id === neighborBlock(old, b.id, next));
    const what = [
      tasks ? `${tasks} tarea${tasks > 1 ? 's' : ''} pendiente${tasks > 1 ? 's' : ''}` : '',
      routines ? `${routines} rutina${routines > 1 ? 's' : ''}` : '',
    ].filter(Boolean).join(' y ');
    // eslint-disable-next-line no-alert
    if (!confirm(`"${b.title}" tiene ${what}. Pasarán a "${to.title.trim() || 'el bloque vecino'}". ¿Quitar el bloque?`)) return false;
  }
  return true;
}

export function renderSettings() {
  const f = form();
  // No pisar lo que el usuario está editando.
  if (f.contains(document.activeElement)) return;
  const s = state.settings;
  if (!blocksDirty) renderBlockRows(blocksOf(s));
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
    const blocks = readBlockRows();
    if (checkBlockRows(true)) return;
    if (!confirmRemovedBlocks(blocks)) return;
    const problem = saveSettings({
      blocks,
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
      blocksDirty = false;
      renderBlockRows(blocksOf(state.settings)); // ya ordenados por hora
      document.activeElement?.blur();
      saved.hidden = false;
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => { saved.hidden = true; }, 2000);
    }
  });

  setupBlocksEditor();

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
    a.download = `cabe-todo-${todayISO()}.json`;
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
