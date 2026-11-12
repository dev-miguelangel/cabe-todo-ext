// "Importar respaldo": elegir entre Mezclar (lo del respaldo se suma a lo actual; en cada tarea queda la
// versión más reciente) o Reemplazar todo. Compartido con la versión web (scripts/sync-core.mjs).

import { h, openModal, closeModal } from '../utils/ui.js';

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sizeOf = ({ tasks, epics }) => `${count(tasks, 'tarea')}, ${count(epics, 'épica')}`;

/**
 * current / incoming: { tasks, epics } (cantidades). note: texto extra bajo "Reemplazar" (p. ej. si se
 * puede deshacer). Devuelve una promesa con 'merge' | 'replace' | null (cerró sin elegir).
 */
export function askImportMode(current, incoming, { note = '' } = {}) {
  return new Promise((resolve) => {
    let chosen = null;
    const pick = (mode) => () => {
      chosen = mode;
      closeModal();
    };
    openModal('Importar respaldo', [
      h('p', { class: 'modal-text' }, `Ahora tienes ${sizeOf(current)}. El respaldo trae ${sizeOf(incoming)}.`),
      h('div', { class: 'import-choices' },
        h('button', { type: 'button', class: 'import-choice primary-choice', onclick: pick('merge') },
          h('strong', {}, 'Mezclar'),
          h('span', {}, 'Suma lo del respaldo a lo tuyo. Si una tarea está en los dos, queda la versión más reciente; lo borrado en un lado se borra en el otro.')),
        h('button', { type: 'button', class: 'import-choice', onclick: pick('replace') },
          h('strong', {}, 'Reemplazar todo'),
          h('span', {}, `Deja solo lo del respaldo; lo actual se pierde.${note ? ` ${note}` : ''}`))),
    ], () => resolve(chosen));
  });
}
