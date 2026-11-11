// Aplica el tema guardado antes de pintar (evita un destello del tema oscuro al abrir).
// Script clásico y externo: las páginas de la extensión no permiten scripts en línea.
try {
  const theme = localStorage.getItem('pertday:theme');
  if (theme && theme !== 'chrome') document.documentElement.dataset.theme = theme;
} catch { /* sin almacenamiento: tema por defecto */ }
