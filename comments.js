// Sección de comentarios de una tarea (usada en el modal y en la pestaña de documentación).
// Guarda su propio estado (borrador, pestaña, comentario en edición) para sobrevivir a los re-render.

import { addComment, editComment, deleteComment } from './store.js';
import { h } from './ui.js';
import { markdownEditor, markdownView } from './md-editor.js';

const PLACEHOLDER = 'Escribe un comentario… (Markdown: **negrita**, *cursiva*, `código`, - listas, [enlace](https://…))';

function when(iso) {
  return new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** rerender: función que vuelve a dibujar la vista que contiene la sección. */
export function createComments({ rerender, keyPrefix = '' }) {
  let draft = '';
  let draftTab = 'code';
  let editing = null; // { id, text, tab }

  function footer({ onSubmit, submitLabel, onCancel }) {
    return h('div', { class: 'md-actions' },
      h('span', { class: 'md-hint' }, 'Markdown · ⌘/Ctrl + Enter para enviar'),
      onCancel ? h('button', { type: 'button', class: 'ghost small', onclick: onCancel }, 'Cancelar') : null,
      h('button', { type: 'button', class: 'primary small', onclick: onSubmit }, submitLabel));
  }

  function editor({ key, text, tab, onInput, onTab, onSubmit, onCancel, submitLabel }) {
    return markdownEditor({
      key: keyPrefix + key,
      text,
      tab,
      onInput,
      onTab,
      placeholder: PLACEHOLDER,
      label: 'Comentario en Markdown',
      onKeydown: (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onSubmit(); }
        if (e.key === 'Escape' && onCancel) { e.preventDefault(); e.stopPropagation(); onCancel(); }
      },
      footer: footer({ onSubmit, submitLabel, onCancel }),
    });
  }

  function section(task) {
    const items = task.comments.map((c) => {
      if (editing?.id === c.id) {
        return h('li', { class: 'comment editing' }, editor({
          key: `edit-${c.id}`,
          text: editing.text,
          tab: editing.tab,
          onInput: (v) => { editing.text = v; },
          onTab: (t) => { editing.tab = t; rerender(); },
          onSubmit: () => { if (editComment(task.id, c.id, editing.text)) editing = null; rerender(); },
          onCancel: () => { editing = null; rerender(); },
          submitLabel: 'Guardar',
        }));
      }
      return h('li', { class: 'comment' },
        h('div', { class: 'comment-head' },
          h('span', {}, when(c.created_at), c.updated_at ? ' · editado' : ''),
          h('button', { type: 'button', class: 'comment-action', onclick: () => { editing = { id: c.id, text: c.text, tab: 'code' }; rerender(); } }, 'Editar'),
          h('button', {
            type: 'button',
            class: 'comment-action danger',
            onclick: () => { if (window.confirm('¿Borrar este comentario?')) deleteComment(task.id, c.id); },
          }, 'Borrar')),
        markdownView(c.text));
    });

    return h('section', { class: 'detail-section comments' },
      h('h3', {}, `Comentarios${task.comments.length ? ` (${task.comments.length})` : ''}`),
      items.length ? h('ul', { class: 'comment-list' }, ...items) : null,
      editing ? null : editor({
        key: 'new-comment',
        text: draft,
        tab: draftTab,
        onInput: (v) => { draft = v; },
        onTab: (t) => { draftTab = t; rerender(); },
        onSubmit: () => {
          if (addComment(task.id, draft)) { draft = ''; draftTab = 'code'; rerender(); }
        },
        submitLabel: 'Comentar',
      }));
  }

  return {
    section,
    /** Al cambiar de tarea: limpiar borrador y edición. */
    reset() { draft = ''; draftTab = 'code'; editing = null; },
    /** Al cerrar: salir de la edición pero conservar el borrador. */
    stopEditing() { editing = null; },
  };
}
