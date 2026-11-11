// Ayuda del quick-add: ejemplos de cómo escribir tareas y la tabla de textos llave.
// Usa los bloques configurados del usuario para que los ejemplos sean los suyos.

import { state } from '../services/store.js';
import { h, openModal } from '../utils/ui.js';
import { blocksOf } from '../core/blocks.js';
import { currentBlock } from '../core/pert.js';
import { formatMinutes } from '../core/parser.js';

const code = (text) => h('code', { class: 'kw' }, text);

function examples() {
  const blocks = blocksOf(state.settings);
  const now = blocks.find((b) => b.id === currentBlock(state.settings)) || blocks[0];
  const other = blocks.find((b) => b.id !== now.id);
  const def = formatMinutes(state.settings.default_minutes || 30);
  const list = [
    ['Responder correos', `${def} (la duración por defecto), en ${now.icon} ${now.title}, el bloque en curso`],
    ['Informe mensual 2h', 'Dura 2 horas'],
    other
      ? [`Llamar a Juan 15m ${other.title.toLowerCase()}`, `15 minutos, en ${other.icon} ${other.title}`]
      : ['Llamar a Juan 15m', '15 minutos'],
    ['Revisar PR 1h ?', 'No estás seguro: el pronóstico deja más margen'],
    ['Pagar la luz 10m !', 'Muy seguro: menos margen'],
    ['Logo nuevo 3h #web', 'En la épica "web" (si no existe, se crea)'],
    ['Standup 15m cada día', 'Se repite todos los días'],
    ['Ideas para la charla bl', 'Al backlog, sin fecha ni bloque'],
    ['Diseño home 2h ? #web cada lun,jue', 'Todo junto, en cualquier orden'],
  ];
  return h('ul', { class: 'help-examples' }, ...list.map(([text, result]) =>
    h('li', {},
      h('code', { class: 'help-example-text' }, text),
      h('span', { class: 'help-example-result' }, result))));
}

function keywords() {
  const blocks = blocksOf(state.settings);
  const rows = [
    [[code('15m'), code('1h'), code('1h30'), code('1,5h')], 'Duración', 'Hasta 12 h. Sin duración, se usa la de Ajustes.'],
    [[code('?')], 'No estoy seguro', 'Más margen en el pronóstico. Puede ir pegado: 1h?'],
    [[code('!')], 'Muy seguro', 'Menos margen en el pronóstico.'],
    [[code('#épica')], 'Épica', 'Agrupa la tarea. El autocompletado sugiere las que tienes.'],
    [blocks.map((b) => code(b.title.toLowerCase())), 'Bloque', 'El nombre del bloque al final. También @nombre, am y pm.'],
    [[code('bl')], 'Backlog', 'La deja sin fecha ni bloque, para después.'],
    [[code('cada día'), code('hábiles'), code('cada lun,jue')], 'Se repite', 'Crea una rutina con esos días.'],
  ];
  return h('table', { class: 'help-table' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Texto'), h('th', { scope: 'col' }, 'Qué hace'))),
    h('tbody', {}, ...rows.map(([keys, what, detail]) => h('tr', {},
      h('td', { class: 'help-keys' }, ...keys),
      h('td', {}, h('strong', {}, what), h('span', {}, detail))))));
}

/** Abre el modal de ayuda para escribir tareas. */
export function showSyntaxHelp() {
  openModal('Cómo escribir tareas', [
    h('div', { class: 'syntax-help' },
      h('p', { class: 'help-lead' }, 'Escribe el título y, al final, lo que necesites. Todo es opcional y se puede combinar.'),
      h('h3', {}, 'Ejemplos'),
      examples(),
      h('h3', {}, 'Textos llave'),
      keywords(),
      h('p', { class: 'help-foot' },
        h('kbd', {}, 'Enter'), ' crea la tarea · ', h('kbd', {}, 'Esc'), ' borra el texto · ',
        h('kbd', {}, 'N'), ' nueva tarea desde cualquier vista')),
  ]);
}
