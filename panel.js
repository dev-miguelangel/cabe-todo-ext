// Punto de entrada del side panel: carga datos, conecta las vistas y las pestañas.

import { state, initStore, subscribe, setNotifier, setView } from './store.js';
import { renderDay, setupDay, isDayBusy, closeDepsMenu } from './day-view.js';
import { renderEpics, setupEpics, isEpicsBusy } from './epics-view.js';
import { currentBlock } from './pert.js';
import { showToast } from './ui.js';

const TAB_KEY = 'pertday:tab';

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
  if (state.tab === 'day') renderDay();
  else renderEpics();
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
    if (saved === 'day' || saved === 'epics') state.tab = saved;
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
  render();

  // El pronóstico depende de la hora: se recalcula cada minuto.
  setInterval(() => {
    if (!isBusy()) render();
  }, 60 * 1000);

  if (state.tab === 'day') {
    document.querySelector(`.block[data-block="${currentBlock(state.settings)}"] .quick-add input`).focus();
  }
}

init();
