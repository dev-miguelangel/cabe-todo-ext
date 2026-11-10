// Punto de entrada del side panel: carga datos, conecta las vistas y las pestañas.

import { state, initStore, subscribe, setNotifier, setView } from './store.js';
import { renderDay, setupDay, isDayBusy, closeDepsMenu } from './day-view.js';
import { renderEpics, setupEpics, isEpicsBusy } from './epics-view.js';
import { renderSettings, setupSettings } from './settings-view.js';
import { currentBlock } from './pert.js';
import { showToast } from './ui.js';
import { todayISO } from './dates.js';

const TAB_KEY = 'pertday:tab';
const TABS = ['day', 'epics', 'settings'];

function isBusy() {
  return isDayBusy() || isEpicsBusy();
}

function render() {
  document.querySelectorAll('.tab').forEach((btn) => {
    const active = btn.dataset.tab === state.tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  document.getElementById('view-day').hidden = state.tab !== 'day';
  document.getElementById('view-epics').hidden = state.tab !== 'epics';
  document.getElementById('view-settings').hidden = state.tab !== 'settings';
  if (state.tab === 'day') renderDay();
  else if (state.tab === 'epics') renderEpics();
  else renderSettings();
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      closeDepsMenu();
      try { localStorage.setItem(TAB_KEY, btn.dataset.tab); } catch { /* ignorar */ }
      setView({ tab: btn.dataset.tab });
    });
  });
}

async function init() {
  await initStore();
  try {
    const saved = localStorage.getItem(TAB_KEY);
    if (TABS.includes(saved)) state.tab = saved;
  } catch { /* sin almacenamiento */ }

  setNotifier(showToast);
  // Cambios propios: siempre re-render. Cambios de otra ventana: esperar si el usuario está editando o arrastrando.
  subscribe(({ external } = {}) => {
    if (external && isBusy()) return;
    render();
  });

  setupTabs();
  setupDay();
  setupEpics();
  setupSettings();
  setupKeyboard();
  render();

  // El pronóstico depende de la hora: se recalcula cada minuto.
  setInterval(() => {
    if (!isBusy()) render();
  }, 60 * 1000);

  if (state.tab === 'day') focusQuickAdd();
}

/** Foco en el quick-add del bloque en curso (o el de la mañana si es otro día). */
function focusQuickAdd() {
  const block = state.viewDate === todayISO() ? currentBlock(state.settings) : 'am';
  document.querySelector(`.block[data-block="${block}"] .quick-add input`)?.focus();
}

/** "N" (fuera de un campo de texto) = nueva tarea. */
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (state.tab !== 'day') setView({ tab: 'day' });
    focusQuickAdd();
  });
}

init();
