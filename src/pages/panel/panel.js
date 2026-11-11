// Punto de entrada del side panel: carga datos, conecta las vistas y las pestañas.

import { state, initStore, subscribe, setNotifier, setView, ensureRoutines, findTask } from '../../services/store.js';
import { renderEpics, setupEpics, isEpicsBusy } from '../../views/epics-view.js';
import { renderSettings, setupSettings } from '../../views/settings-view.js';
import { renderDocs, setupDocs } from '../../views/docs-view.js';
import { renderDone, setupDone } from '../../views/done-view.js';
import { renderMinimal, setupMinimal, isMinimalBusy } from '../../views/minimal-view.js';
import { updateTimerChip } from '../../components/cards.js';
import { setupThemeToggle, renderThemeToggle } from '../../components/theme-toggle.js';
import { showToast, applyTheme } from '../../utils/ui.js';

const TAB_KEY = 'cabetodo:tab';
const TABS = ['minimal', 'epics', 'done', 'docs', 'settings'];
const VIEWS = { minimal: renderMinimal, epics: renderEpics, done: renderDone, docs: renderDocs, settings: renderSettings };

function isBusy() {
  return isEpicsBusy() || isMinimalBusy();
}

function render() {
  applyTheme(state.settings.theme);
  renderThemeToggle();
  document.querySelectorAll('.tab').forEach((btn) => {
    const active = btn.dataset.tab === state.tab;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  for (const tab of TABS) document.getElementById(`view-${tab}`).hidden = state.tab !== tab;
  VIEWS[state.tab]();
}

function setupTabs() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
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
  setupThemeToggle(document.getElementById('theme-toggle'));
  setupMinimal();
  setupEpics();
  setupDone();
  setupDocs();
  setupSettings();
  setupKeyboard();
  ensureRoutines(); // tareas que se repiten y tocan hoy
  render();

  // El pronóstico depende de la hora: se recalcula cada minuto.
  setInterval(() => {
    if (ensureRoutines()) return; // cambió el día: ya re-renderizó
    if (!isBusy()) render();
  }, 60 * 1000);

  // Los chips de temporizador se actualizan solos (sin re-renderizar todo): el tiempo de los que
  // corren y el bloqueo de los pausados cuando una reunión que bloquea empieza o termina.
  setInterval(() => {
    document.querySelectorAll('.timer-btn:not([hidden])').forEach((chip) => {
      const task = findTask(chip.closest('.task')?.dataset.id);
      if (task) updateTimerChip(chip, task, state.tasks);
    });
  }, 5 * 1000);

  if (state.tab === 'minimal') focusQuickAdd();
}

/** Foco en el campo de nueva tarea de la vista Hoy. */
function focusQuickAdd() {
  document.querySelector('#minimal-add input')?.focus();
}

/** "N" (fuera de un campo de texto) = nueva tarea. */
function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
    if (document.querySelector('dialog[open]')) return;
    e.preventDefault();
    if (state.tab !== 'minimal') setView({ tab: 'minimal' });
    focusQuickAdd();
  });
}

init();
