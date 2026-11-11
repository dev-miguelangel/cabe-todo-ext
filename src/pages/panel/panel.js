// Punto de entrada del side panel: carga datos, conecta las vistas y las pestañas.

import { state, initStore, subscribe, setNotifier, setView, ensureRoutines } from '../../services/store.js';
import { renderDay, setupDay, isDayBusy, closeDepsMenu } from '../../views/day-view.js';
import { renderEpics, setupEpics, isEpicsBusy } from '../../views/epics-view.js';
import { renderSettings, setupSettings } from '../../views/settings-view.js';
import { renderDocs, setupDocs } from '../../views/docs-view.js';
import { renderDone, setupDone } from '../../views/done-view.js';
import { renderMinimal, setupMinimal, isMinimalBusy } from '../../views/minimal-view.js';
import { currentBlock } from '../../core/pert.js';
import { firstBlock } from '../../core/blocks.js';
import { showToast, applyTheme } from '../../utils/ui.js';
import { todayISO } from '../../utils/dates.js';

const TAB_KEY = 'cabetodo:tab';
const TABS = ['day', 'minimal', 'epics', 'done', 'docs', 'settings'];

function isBusy() {
  return isDayBusy() || isEpicsBusy() || isMinimalBusy();
}

function render() {
  applyTheme(state.settings.theme);
  document.querySelectorAll('.tab').forEach((btn) => {
    const active = btn.dataset.tab === state.tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  document.getElementById('view-day').hidden = state.tab !== 'day';
  document.getElementById('view-epics').hidden = state.tab !== 'epics';
  document.getElementById('view-minimal').hidden = state.tab !== 'minimal';
  document.getElementById('view-done').hidden = state.tab !== 'done';
  document.getElementById('view-docs').hidden = state.tab !== 'docs';
  document.getElementById('view-settings').hidden = state.tab !== 'settings';
  if (state.tab === 'day') renderDay();
  else if (state.tab === 'epics') renderEpics();
  else if (state.tab === 'minimal') renderMinimal();
  else if (state.tab === 'done') renderDone();
  else if (state.tab === 'docs') renderDocs();
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
  setupDocs();
  setupDone();
  setupMinimal();
  setupKeyboard();
  ensureRoutines(); // tareas que se repiten y tocan hoy
  render();

  // El pronóstico depende de la hora: se recalcula cada minuto.
  setInterval(() => {
    if (ensureRoutines()) return; // cambió el día: ya re-renderizó
    if (!isBusy()) render();
  }, 60 * 1000);

  if (state.tab === 'day' || state.tab === 'minimal') focusQuickAdd();
}

/** Foco en el quick-add: el de la vista Hoy, o en Plan el del bloque en curso (el primero si es otro día). */
function focusQuickAdd() {
  if (state.tab === 'minimal') {
    document.querySelector('#minimal-add input')?.focus();
    return;
  }
  const block = state.viewDate === todayISO() ? currentBlock(state.settings) : firstBlock(state.settings).id;
  document.querySelector(`.block[data-block="${block}"] .quick-add input`)?.focus();
}

/** "N" (fuera de un campo de texto) = nueva tarea. */
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (state.tab !== 'day' && state.tab !== 'minimal') setView({ tab: 'minimal' });
    focusQuickAdd();
  });
}

init();
