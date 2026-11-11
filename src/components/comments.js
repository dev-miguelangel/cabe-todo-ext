// Comentarios de una tarea: texto simple (sin Markdown; el Markdown queda para la documentación),
// con enlaces: "🔗 Enlace" inserta una URL (o [texto](url)) donde está el cursor, y al mostrarse son clicables.
// Guarda su propio estado (borrador, comentario en edición) para sobrevivir a los re-render del modal.

import { addComment, editComment, deleteComment } from '../services/store.js';
import { h } from '../utils/ui.js';

// [texto](https://…) o https://… suelto (sin la puntuación final: "ver https://x.com." → "https://x.com")
const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>]+[^\s<>.,;:!?)\]'"])/gi;

/** Texto del comentario → nodos (texto y enlaces). Nunca usa innerHTML. */
export function linkify(text) {
  const nodes = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    if (m.index > last) nodes.push(document.createTextNode(text.slice(last, m.index)));
    const url = m[2] || m[3];
    nodes.push(h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', title: url }, m[1] || url));
    last = m.index + m[0].length;
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
  return nodes;
}

/** "ejemplo.com/a" → "https://ejemplo.com/a"; null si no parece una URL. */
export function normalizeUrl(input) {
  let url = input.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) {
    if (!/^[\w-]+(\.[\w-]+)+(\/|$|[?#:])/.test(url)) return null;
    url = `https://${url}`;
  }
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) && parsed.hostname.includes('.') ? url : null;
  } catch {
    return null;
  }
}

function when(iso) {
  return new Date(iso).toLocaleString('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/** rerender: función que vuelve a dibujar la vista que contiene la sección. */
export function createComments({ rerender }) {
  let draft = '';
  let editing = null; // { id, text }
  let linkForm = null; // { key, url, label, error }: insertar un enlace en el campo `key`
  const carets = new Map(); // key → [inicio, fin] de la última selección en ese campo

  const textOf = (key) => (key === 'new-comment' ? draft : editing?.text ?? '');
  const setText = (key, value) => { if (key === 'new-comment') draft = value; else if (editing) editing.text = value; };

  /** Inserta el enlace donde estaba el cursor (reemplaza lo seleccionado) y deja el cursor después. */
  function insertLink() {
    const url = normalizeUrl(linkForm.url);
    if (!url) {
      linkForm.error = 'Escribe una URL válida, por ejemplo https://ejemplo.com';
      rerender();
      document.querySelector('#modal .comment-link-url')?.focus();
      return;
    }
    const { key } = linkForm;
    const label = linkForm.label.trim();
    const piece = label ? `[${label}](${url})` : url;
    const value = textOf(key);
    const [start, end] = carets.get(key) || [value.length, value.length];
    const before = value.slice(0, start);
    const after = value.slice(end);
    // Un espacio a cada lado si hace falta, para que no quede pegado al texto
    const left = before && !/\s$/.test(before) ? ' ' : '';
    const right = after && !/^\s/.test(after) ? ' ' : '';
    setText(key, `${before}${left}${piece}${right}${after}`);
    const caret = before.length + left.length + piece.length + right.length;
    carets.set(key, [caret, caret]);
    linkForm = null;
    rerender();
    const area = document.querySelector(`#modal [data-key="${key}"]`);
    area?.focus();
    area?.setSelectionRange(caret, caret);
  }

  function linkButton(key) {
    return h('button', {
      type: 'button', class: 'ghost small comment-link-btn', title: 'Insertar un enlace (URL) donde está el cursor',
      onclick: () => {
        const value = textOf(key);
        const [start, end] = carets.get(key) || [value.length, value.length];
        linkForm = { key, url: '', label: value.slice(start, end), error: '' };
        rerender();
        document.querySelector('#modal .comment-link-url')?.focus();
      },
    }, '🔗 Enlace');
  }

  function linkRow() {
    const url = h('input', {
      type: 'url', class: 'comment-link-url', value: linkForm.url, placeholder: 'https://…', 'aria-label': 'URL del enlace', dataset: { key: 'link-url' },
    });
    const label = h('input', {
      type: 'text', class: 'comment-link-label', value: linkForm.label, placeholder: 'Texto (opcional)', 'aria-label': 'Texto del enlace', dataset: { key: 'link-label' },
    });
    url.addEventListener('input', () => { linkForm.url = url.value; });
    label.addEventListener('input', () => { linkForm.label = label.value; });
    const keys = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); insertLink(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); linkForm = null; rerender(); }
    };
    url.addEventListener('keydown', keys);
    label.addEventListener('keydown', keys);
    return h('div', { class: 'comment-link-form' },
      h('div', { class: 'comment-link-fields' }, url, label),
      linkForm.error ? h('p', { class: 'settings-error' }, linkForm.error) : null,
      h('div', { class: 'comment-actions' },
        h('button', { type: 'button', class: 'ghost small', onclick: () => { linkForm = null; rerender(); } }, 'Cancelar'),
        h('button', { type: 'button', class: 'primary small', onclick: insertLink }, 'Insertar')));
  }

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
    const remember = () => carets.set(key, [area.selectionStart, area.selectionEnd]);
    area.addEventListener('input', () => { onInput(area.value); remember(); });
    ['select', 'keyup', 'click', 'blur'].forEach((ev) => area.addEventListener(ev, remember));
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
          linkForm?.key === `edit-${c.id}` ? linkRow() : h('div', { class: 'comment-actions' },
            linkButton(`edit-${c.id}`),
            h('span', { class: 'comment-spacer' }),
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
        h('p', { class: 'comment-text' }, ...linkify(c.text))); // texto tal cual (con sus saltos de línea) y enlaces clicables
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
        linkForm?.key === 'new-comment' ? linkRow() : h('div', { class: 'comment-actions' },
          linkButton('new-comment'),
          h('span', { class: 'comment-hint' }, '⌘/Ctrl + Enter para enviar'),
          h('button', { type: 'button', class: 'primary small', onclick: submit }, 'Comentar'))));
  }

  return {
    section,
    /** Al cambiar de tarea: limpiar borrador y edición. */
    reset() { draft = ''; editing = null; linkForm = null; },
    /** Al cerrar: salir de la edición pero conservar el borrador. */
    stopEditing() { editing = null; linkForm = null; },
  };
}
