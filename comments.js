// Comentarios de una tarea: texto simple (sin Markdown; el Markdown queda para la documentación).
// Guarda su propio estado (borrador, comentario en edición) para sobrevivir a los re-render del modal.

import { addComment, editComment, deleteComment } from './store.js';
import { h } from './ui.js';

function when(iso) {
  return new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** rerender: función que vuelve a dibujar la vista que contiene la sección. */
export function createComments({ rerender }) {
  let draft = '';
  let editing = null; // { id, text }

  /** Campo de texto clásico. ⌘/Ctrl + Enter envía; Escape cancela la edición. */
  function field({ key, value, placeholder, onInput, onSubmit, onCancel }) {
    const area = h('textarea', {
      class: 'comment-input',
      rows: '2',
      placeholder,
      dataset: { key },
      'aria-label': placeholder,
    });
    area.value = value;
    area.addEventListener('input', () => onInput(area.value));
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); }
      if (e.key === 'Escape' && onCancel) { e.preventDefault(); e.stopPropagation(); onCancel(); }
    });
    return area;
  }

  function section(task) {
    const items = task.comments.map((c) => {
      if (editing?.id === c.id) {
        const save = () => { if (editComment(task.id, c.id, editing.text)) editing = null; rerender(); };
        const cancel = () => { editing = null; rerender(); };
        return h('li', { class: 'comment editing' },
          field({
            key: `edit-${c.id}`,
            value: editing.text,
            placeholder: 'Editar comentario',
            onInput: (v) => { editing.text = v; },
            onSubmit: save,
            onCancel: cancel,
          }),
          h('div', { class: 'comment-actions' },
            h('button', { type: 'button', class: 'ghost small', onclick: cancel }, 'Cancelar'),
            h('button', { type: 'button', class: 'primary small', onclick: save }, 'Guardar')));
      }
      return h('li', { class: 'comment' },
        h('div', { class: 'comment-head' },
          h('span', {}, when(c.created_at), c.updated_at ? ' · editado' : ''),
          h('button', { type: 'button', class: 'comment-action', onclick: () => { editing = { id: c.id, text: c.text }; rerender(); } }, 'Editar'),
          h('button', {
            type: 'button',
            class: 'comment-action danger',
            onclick: () => { if (window.confirm('¿Borrar este comentario?')) deleteComment(task.id, c.id); },
          }, 'Borrar')),
        h('p', { class: 'comment-text' }, c.text)); // textContent: se muestra tal cual, con sus saltos de línea
    });

    const submit = () => {
      if (addComment(task.id, draft)) { draft = ''; rerender(); }
    };

    return h('section', { class: 'detail-section comments' },
      h('h3', {}, `Comentarios${task.comments.length ? ` (${task.comments.length})` : ''}`),
      items.length ? h('ul', { class: 'comment-list' }, ...items) : null,
      editing ? null : h('div', { class: 'comment-composer' },
        field({
          key: 'new-comment',
          value: draft,
          placeholder: 'Escribe un comentario…',
          onInput: (v) => { draft = v; },
          onSubmit: submit,
        }),
        h('div', { class: 'comment-actions' },
          h('span', { class: 'comment-hint' }, '⌘/Ctrl + Enter para enviar'),
          h('button', { type: 'button', class: 'primary small', onclick: submit }, 'Comentar'))));
  }

  return {
    section,
    /** Al cambiar de tarea: limpiar borrador y edición. */
    reset() { draft = ''; editing = null; },
    /** Al cerrar: salir de la edición pero conservar el borrador. */
    stopEditing() { editing = null; },
  };
}
