// Ejemplos en el campo "+ Nueva tarea": el texto de siempre ("+ Nueva tarea en Mañana") se alterna con un
// ejemplo de cómo escribir ("Ej: Informe 2h tarde #ventas"), usando los bloques y épicas propios.
// En los ejemplos, la #épica va siempre al final (es lo que enseña la ayuda).
// Solo cambia el placeholder: con texto escrito no se ve. Compartido con la versión web.

import { blocksOf, fold } from '../core/blocks.js';
import { epicHandle } from '../core/parser.js';

const INTERVAL_MS = 4500;

/**
 * Ejemplos cortos (caben en el campo de un celular) con un bloque y una épica propios si tienen nombre
 * corto; si no, "pm" y "#web".
 */
export function quickAddExamples(settings, epics = []) {
  const block = blocksOf(settings).find((b) => fold(b.title) !== 'manana' && b.title.length <= 6);
  const blockWord = block ? block.title.toLowerCase() : 'pm';
  const epic = epics.find((e) => !e.archived && epicHandle(e.name).length <= 8);
  const tag = epic ? epicHandle(epic.name) : 'web';
  return [
    `Informe 2h ${blockWord} #${tag}`,
    'Llamar 15m mañana',
    `Logo 1h30 mañana #${tag}`,
    'Revisar PR 1h ?',
    'Correr cada lunes',
    'Reunión equipo 10am',
    'Ideas charla bl',
    'Pagar luz 10m vie',
    'Leer 45 min hábiles',
  ];
}

/**
 * Alterna el placeholder del campo entre su texto base (input.dataset.base, lo pone cada vista) y un
 * ejemplo. getExamples() se llama en cada vuelta (los bloques y épicas pueden cambiar).
 */
export function rotatePlaceholder(input, getExamples) {
  let showingExample = false;
  let i = 0;
  setInterval(() => {
    if (input.value || document.visibilityState === 'hidden') return;
    showingExample = !showingExample;
    if (showingExample) {
      const list = getExamples();
      input.placeholder = `Ej: ${list[i % list.length]}`;
      i += 1;
    } else {
      input.placeholder = input.dataset.base || input.placeholder;
    }
  }, INTERVAL_MS);
  // La vista cambia el texto base (otro día, otro bloque): si se está mostrando el base, actualizarlo ya
  return (base) => {
    input.dataset.base = base;
    if (!showingExample) input.placeholder = base;
  };
}
