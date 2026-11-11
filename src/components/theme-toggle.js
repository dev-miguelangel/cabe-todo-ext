// Botón luna / sol para cambiar entre el tema oscuro y el claro (arriba a la derecha).
// Se usa en el panel y en la página de documentación; guarda la elección en Ajustes.

import { state, saveSettings } from '../services/store.js';
import { applyTheme } from '../utils/ui.js';

const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
const SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>';

const isDark = () => (state.settings?.theme || 'chrome') !== 'trello';
let button = null;

/** Muestra el ícono del tema al que se cambia: sol en el oscuro, luna en el claro. */
export function renderThemeToggle() {
  if (!button) return;
  const dark = isDark();
  const label = dark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro';
  if (button.dataset.mode !== (dark ? 'dark' : 'light')) {
    button.innerHTML = dark ? SUN : MOON;
    button.dataset.mode = dark ? 'dark' : 'light';
  }
  button.title = label;
  button.setAttribute('aria-label', label);
}

export function setupThemeToggle(el) {
  button = el;
  if (!button) return;
  button.addEventListener('click', () => {
    const theme = isDark() ? 'trello' : 'chrome';
    applyTheme(theme); // al instante, sin esperar a que se guarde
    saveSettings({ ...state.settings, theme });
    renderThemeToggle();
  });
  renderThemeToggle();
}
