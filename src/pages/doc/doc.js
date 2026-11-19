// Documentación de una tarea (?task=…) o de una épica (?epic=…): documento Markdown (Código / Lectura con
// barra de formato) con guardado automático. En Lectura, las casillas "- [ ]" se marcan con un clic.
// Los comentarios viven solo en el modal de la tarea.

import {
  state, initStore, subscribe, setNotifier, findTask, findEpic, setDoc, setEpicDoc, refreshFromStorage, epicTasks,
  pruneDocImages,
} from '../../services/store.js';
import { formatMinutes } from '../../core/parser.js';
import { todayISO, shortLabel, formatDMY } from '../../utils/dates.js';
import { isRunning, remainingMs, formatCountdown } from '../../core/timer.js';
import { h, showToast, applyTheme } from '../../utils/ui.js';
import { blockName } from '../../core/blocks.js';
import { markdownEditor, markdownView } from '../../components/md-editor.js';
import { setupThemeToggle, renderThemeToggle } from '../../components/theme-toggle.js';
import { titleCase } from '../../utils/text.js';
import { fillTemplate, firstPlaceholder, defaultTemplate } from '../../core/templates.js';

const SAVE_DELAY = 700;
const params = new URLSearchParams(location.search);
const epicId = params.get('epic');
const taskId = epicId ? null : params.get('task');
const isEpic = Boolean(epicId);
/** Lo que se documenta: la épica o la tarea. */
const subject = () => (isEpic ? findEpic(epicId) : findTask(taskId));
const subjectTitle = (s) => titleCase(isEpic ? s.name : s.title);
const writeDoc = (value) => (isEpic ? setEpicDoc(epicId, value) : setDoc(taskId, value));
/** Imágenes de la documentación (se agregan desde la app web; aquí se muestran). */
const docImages = () => subject()?.images || null;
// Esqueleto opcional para empezar una documentación vacía

let text = '';          // contenido del editor (puede ir por delante de lo guardado)
let saved = '';         // último contenido guardado
let tab = 'code';
let saveTimer = null;
let savedAt = null;

// ---------- Guardado ----------

function setStatus() {
  const el = document.getElementById('doc-status');
  if (!el) return;
  if (text !== saved) el.textContent = 'Guardando…';
  else if (savedAt) el.textContent = `Guardado · ${savedAt.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}`;
  else el.textContent = 'Guardado automático';
}

let saving = Promise.resolve();

/** Guarda lo escrito. Antes relee el almacenamiento para no pisar cambios hechos en el panel. */
function flush() {
  clearTimeout(saveTimer);
  if (text === saved) return saving;
  const value = text;
  saving = saving.then(async () => {
    await refreshFromStorage();
    writeDoc(value);
    saved = value;
    savedAt = new Date();
    setStatus();
  });
  return saving;
}

function onInput(value) {
  text = value;
  setStatus();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, SAVE_DELAY);
}

// ---------- Render ----------

function whereText(task) {
  if (!task.date) return '⤓ backlog';
  const day = task.date === todayISO() ? 'hoy' : shortLabel(task.date);
  return `${day} · ${blockName(state.settings, task.block)}`;
}

/** Cabecera de una épica: color, tareas hechas/total y fecha objetivo. */
function renderEpicHead(epic) {
  const own = epicTasks(epic.id);
  const done = own.filter((t) => t.done).length;
  document.title = `${titleCase(epic.name)} · Documentación`;
  document.getElementById('doc-head').replaceChildren(
    h('p', { class: 'doc-kicker' }, 'Documentación de la épica'),
    h('h1', { class: 'doc-title' }, titleCase(epic.name)),
    h('p', { class: 'doc-meta' },
      h('span', { class: 'doc-chip' }, h('span', { class: 'dot', style: `background:${epic.color}` }), 'Épica'),
      h('span', { class: 'doc-chip' }, `${done}/${own.length} tareas hechas`),
      epic.target_date ? h('span', { class: 'doc-chip' }, `🎯 ${shortLabel(epic.target_date)}`) : null,
      h('span', { class: 'doc-status', id: 'doc-status' }),
      h('button', {
        type: 'button', class: 'doc-pdf-btn', id: 'doc-pdf',
        title: 'Exportar la vista Lectura a PDF, tamaño carta (en el diálogo de impresión, elige "Guardar como PDF")',
        onclick: () => exportPdf(subject()),
      }, '⤓ PDF')),
  );
  setStatus();
}

function renderHead(task) {
  if (isEpic) {
    renderEpicHead(task);
    return;
  }
  const epic = findEpic(task.epic_id);
  const running = isRunning(task);
  document.title = `${titleCase(task.title)} · Documentación`;
  document.getElementById('doc-head').replaceChildren(
    h('p', { class: 'doc-kicker' }, 'Documentación de la tarea'),
    h('h1', { class: 'doc-title' }, titleCase(task.title)),
    h('p', { class: 'doc-meta' },
      epic ? h('span', { class: 'doc-chip' }, h('span', { class: 'dot', style: `background:${epic.color}` }), titleCase(epic.name)) : null,
      h('span', { class: 'doc-chip' }, whereText(task)),
      h('span', { class: 'doc-chip' }, `${formatMinutes(task.minutes)} estimadas`),
      running ? h('span', { class: 'doc-chip running' }, `● ${formatCountdown(remainingMs(task))}`) : null,
      task.done ? h('span', { class: 'doc-chip done' }, '✓ hecha') : null,
      h('span', { class: 'doc-status', id: 'doc-status' }),
      h('button', {
        type: 'button', class: 'doc-pdf-btn', id: 'doc-pdf',
        title: 'Exportar la vista Lectura a PDF, tamaño carta (en el diálogo de impresión, elige "Guardar como PDF")',
        onclick: () => exportPdf(subject()),
      }, '⤓ PDF')),
  );
  setStatus();
}

// ---------- Exportar a PDF ----------

/**
 * PDF = solo la vista Lectura de la documentación (lo mismo que se ve en esa pestaña, siempre sobre
 * blanco), en tamaño carta. Abre el diálogo de impresión de Chrome: ahí se elige "Guardar como PDF".
 * El nombre del archivo sale del título de la pestaña: "<Título> - Documentación".
 */
async function exportPdf(task) {
  if (!task) return;
  await flush(); // que el PDF tenga lo último que se escribió
  // El margen de 1 cm va dentro de la hoja (no depende de "Márgenes" del diálogo de impresión):
  // franjas de 1 cm arriba y abajo que Chrome repite en cada hoja (thead/tfoot) y 1 cm a los lados.
  const gap = () => h('tr', {}, h('td', { class: 'print-gap' }));
  document.getElementById('print-area').replaceChildren(
    h('table', { class: 'print-sheet', role: 'presentation' },
      h('thead', {}, gap()),
      h('tfoot', {}, gap()),
      h('tbody', {}, h('tr', {}, h('td', { class: 'print-body' },
        markdownView(text, { headingBase: 1, images: docImages(), empty: `Esta ${isEpic ? 'épica' : 'tarea'} todavía no tiene documentación.` }))))));
  const title = document.title;
  document.title = `${subjectTitle(task)} - Documentación`;
  const restore = () => {
    document.title = title;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  window.print();
}

// ---------- Plantillas ----------

/**
 * Inserta una plantilla con sus variables ya llenas: en una documentación vacía la llena; si ya hay
 * texto, la agrega donde está el cursor. Deja seleccionado el primer "[…]" para empezar a escribir ahí.
 */
function useTemplate(area, template) {
  const item = subject();
  const piece = fillTemplate(template.body, {
    title: (isEpic ? item?.name : item?.title) || '',
    date: formatDMY(todayISO()),
    epic: (isEpic ? item?.name : findEpic(item?.epic_id)?.name) || '',
  });
  let from;
  if (!text.trim()) {
    area.value = piece;
    from = 0;
  } else {
    const { selectionStart: s, selectionEnd: e, value } = area;
    const before = value.slice(0, s);
    const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    area.setRangeText(lead + piece, s, e, 'end');
    from = s + lead.length;
  }
  const mark = firstPlaceholder(piece);
  area.focus();
  if (mark) area.setSelectionRange(from + mark[0], from + mark[1]);
  else area.setSelectionRange(from + piece.length, from + piece.length);
  onInput(area.value);
  showToast(`Plantilla "${template.name}" insertada.`);
}

let tplMenu = null;
function closeTemplateMenu() {
  tplMenu?.remove();
  tplMenu = null;
}

/** Menú con las plantillas (la por defecto primero) bajo el botón ▤ Plantilla. */
function toggleTemplateMenu(button, area) {
  if (tplMenu) { closeTemplateMenu(); return; }
  const list = state.settings.templates || [];
  const def = defaultTemplate(list, state.settings.default_template);
  const ordered = def ? [def, ...list.filter((t) => t.id !== def.id)] : list;
  tplMenu = h('div', { class: 'tpl-menu', role: 'menu', 'aria-label': 'Plantillas' },
    ...ordered.map((t) => h('button', {
      type: 'button', class: 'tpl-item', role: 'menuitem',
      onmousedown: (e) => e.preventDefault(),
      onclick: () => { closeTemplateMenu(); useTemplate(area, t); },
    }, h('span', { class: 'tpl-item-name' }, t.name), t === def ? h('span', { class: 'tpl-item-badge' }, 'por defecto') : null)),
    h('p', { class: 'tpl-menu-note' }, 'Crea y edita plantillas en Ajustes → Plantillas.'));
  document.body.append(tplMenu);
  const r = button.getBoundingClientRect();
  tplMenu.style.left = `${Math.min(r.left, window.innerWidth - tplMenu.offsetWidth - 8)}px`;
  tplMenu.style.top = `${r.bottom + 4}px`;
  tplMenu.querySelector('.tpl-item')?.focus();
}

document.addEventListener('mousedown', (e) => {
  if (tplMenu && !tplMenu.contains(e.target) && !e.target.closest('.md-tb-template')) closeTemplateMenu();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tplMenu) closeTemplateMenu(); });

function renderEditor() {
  const container = document.getElementById('doc-editor');
  const active = document.activeElement;
  const hadFocus = active?.classList?.contains('md-input') && container.contains(active);
  const sel = hadFocus ? [active.selectionStart, active.selectionEnd] : null;

  container.replaceChildren(markdownEditor({
    key: 'doc',
    text,
    tab,
    rows: 18,
    headingBase: 1,
    images: docImages(),
    className: 'doc-editor',
    label: 'Documentación en Markdown',
    placeholder: '# Objetivo\n\nDescribe la tarea, decisiones, enlaces y pasos…\n\nUsa la barra de arriba para títulos, enlaces y bloques de código.',
    onInput,
    onTab: (t) => {
      flush();
      tab = t;
      renderEditor();
      if (t === 'code') container.querySelector('.md-input')?.focus();
    },
    // Primer botón de la barra: elegir una plantilla (Ajustes → Plantillas)
    toolbarStart: (area) => [h('button', {
      type: 'button', class: 'md-tb md-tb-template', 'aria-haspopup': 'menu',
      title: 'Elegir una plantilla (se crean en Ajustes → Plantillas)', 'aria-label': 'Elegir plantilla',
      onmousedown: (e) => e.preventDefault(), // no perder la posición del cursor
      onclick: (e) => toggleTemplateMenu(e.currentTarget, area),
    }, '▤ Plantilla ▾')],
    onKeydown: (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        flush();
        showToast('Documentación guardada.');
      }
    },
  }));

  if (sel) {
    const area = container.querySelector('.md-input');
    area?.focus();
    area?.setSelectionRange(...sel);
  }
}

function renderMissing() {
  const what = isEpic ? 'épica' : 'tarea';
  document.title = `${what[0].toUpperCase()}${what.slice(1)} no encontrada · Cabe Todo`;
  document.querySelector('.doc-main').replaceChildren(
    h('div', { class: 'doc-card doc-missing' },
      h('h1', {}, `No se encontró la ${what}`),
      h('p', {}, 'Puede que se haya borrado. Cierra esta pestaña y vuelve al panel de Cabe Todo.')),
  );
}

// ---------- Inicio ----------

async function init() {
  await initStore();
  setNotifier(showToast);
  applyTheme(state.settings.theme);
  setupThemeToggle(document.getElementById('theme-toggle'));
  const task = subject();
  if (!task) {
    renderMissing();
    return;
  }
  pruneDocImages(isEpic ? 'epic' : 'task', isEpic ? epicId : taskId); // las que ya no se usan
  text = task.doc || '';
  saved = text;
  savedAt = task.doc_updated_at ? new Date(task.doc_updated_at) : null;
  tab = text ? 'read' : 'code'; // si ya hay documentación, abrir en lectura

  renderHead(task);
  renderEditor();
  if (tab === 'code') document.querySelector('#doc-editor .md-input')?.focus();

  subscribe(() => {
    applyTheme(state.settings.theme);
    renderThemeToggle();
    const current = subject();
    if (!current) {
      renderMissing();
      return;
    }
    renderHead(current);
    // Si la documentación cambió desde otra ventana y aquí no hay cambios sin guardar, mostrarla.
    if ((current.doc || '') !== saved && text === saved) {
      text = current.doc || '';
      saved = text;
      renderEditor();
    }
  });

  // El reloj del temporizador en la cabecera
  setInterval(() => {
    const current = isEpic ? null : findTask(taskId);
    if (current && isRunning(current)) {
      const chip = document.querySelector('.doc-chip.running');
      if (chip) chip.textContent = `● ${formatCountdown(remainingMs(current))}`;
    }
  }, 1000);

  // No perder lo último escrito al cerrar o cambiar de pestaña.
  // Al cerrar no hay tiempo para releer: se guarda directo (sincrónico).
  window.addEventListener('pagehide', () => {
    clearTimeout(saveTimer);
    if (text !== saved) {
      writeDoc(text);
      saved = text;
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

init();
