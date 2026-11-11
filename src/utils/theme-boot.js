// Aplica el tema guardado antes de pintar (evita un destello del tema oscuro al abrir).
// Script clásico y externo: las páginas de la extensión no permiten scripts en línea.
try {
  // La app antes se llamaba Pert-day: pasar una sola vez sus preferencias locales (pertday:*) a cabetodo:*
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith('pertday:')) continue;
    const next = 'cabetodo:' + key.slice('pertday:'.length);
    if (localStorage.getItem(next) === null) localStorage.setItem(next, localStorage.getItem(key));
    localStorage.removeItem(key);
  }
  const theme = localStorage.getItem('cabetodo:theme');
  if (theme && theme !== 'chrome') document.documentElement.dataset.theme = theme;
} catch { /* sin almacenamiento: tema por defecto */ }
