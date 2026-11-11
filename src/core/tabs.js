// Pestañas del menú inferior y su orden (Ajustes → Menú inferior). Funciones puras.

export const TAB_IDS = ['minimal', 'epics', 'done', 'routines', 'docs', 'settings'];
export const TAB_NAMES = { minimal: 'Hoy', epics: 'Épicas', done: 'Hechas', routines: 'Rutinas', docs: 'Docs', settings: 'Ajustes' };

/** Orden guardado → orden válido: sin repetidas ni desconocidas, y con las que falten al final. */
export function normalizeTabOrder(order) {
  const seen = new Set();
  const valid = (Array.isArray(order) ? order : []).filter((id) => TAB_IDS.includes(id) && !seen.has(id) && seen.add(id));
  return [...valid, ...TAB_IDS.filter((id) => !seen.has(id))];
}

/** Mueve una pestaña una posición (dir = -1 arriba/izquierda, +1 abajo/derecha). */
export function moveTab(order, id, dir) {
  const list = normalizeTabOrder(order);
  const i = list.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return list;
  [list[i], list[j]] = [list[j], list[i]];
  return list;
}
