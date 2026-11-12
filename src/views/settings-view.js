// Vista "Ajustes": bloques del día, duración por defecto, avisos y atajo de teclado.

import { state, saveSettings, calibrationInfo, exportBackup, readBackup, restoreBackup, blockUsage } from '../services/store.js';
import { showToast, h } from '../utils/ui.js';
import { blocksOf, validateBlocks, nextFreeRange, neighborBlock, MAX_BLOCKS, MAX_TITLE, BLOCK_ICONS } from '../core/blocks.js';
import { TAB_IDS, TAB_NAMES, normalizeTabOrder, moveTab } from '../core/tabs.js';
import { validateTemplates, MAX_TEMPLATES } from '../core/templates.js';
import { todayISO } from '../utils/dates.js';
import { playCasio } from '../services/casio.js';

const form = () => document.getElementById('prefs-form');

/** "Guardado ✓" de una sección por 2 s. */
const savedTimers = new WeakMap();
function flashSaved(formEl) {
  const mark = formEl.querySelector('.settings-saved');
  if (!mark) return;
  mark.hidden = false;
  clearTimeout(savedTimers.get(mark));
  savedTimers.set(mark, setTimeout(() => { mark.hidden = true; }, 2000));
}

// ---------- Editor de bloques ----------

let blocksDirty = false; // hay cambios sin guardar en los bloques: no pisarlos al re-renderizar

function blockRow(b, count) {
  const icons = BLOCK_ICONS.includes(b.icon) ? BLOCK_ICONS : [b.icon, ...BLOCK_ICONS];
  return h('li', { class: 'block-row', dataset: { id: b.id } },
    h('select', { class: 'block-icon-select', name: 'block-icon', 'aria-label': 'Ícono del bloque', title: 'Ícono' },
      ...icons.map((icon) => h('option', { value: icon, selected: icon === b.icon }, icon))),
    h('input', {
      class: 'block-title-input', name: 'block-title', type: 'text', value: b.title, maxlength: MAX_TITLE,
      placeholder: 'Título', 'aria-label': 'Título del bloque', required: true,
    }),
    h('span', { class: 'block-times' },
      h('input', { type: 'time', name: 'block-start', value: b.start, 'aria-label': 'Desde', required: true }),
      h('span', { class: 'block-dash', 'aria-hidden': 'true' }, '–'),
      h('input', { type: 'time', name: 'block-end', value: b.end, 'aria-label': 'Hasta', required: true })),
    h('button', {
      type: 'button', class: 'block-remove', title: count > 1 ? 'Quitar bloque' : 'Necesitas al menos un bloque',
      'aria-label': `Quitar ${b.title}`, disabled: count <= 1,
    }, '✕'));
}

function renderBlockRows(blocks) {
  document.getElementById('block-rows').replaceChildren(...blocks.map((b) => blockRow(b, blocks.length)));
  document.getElementById('add-block').disabled = blocks.length >= MAX_BLOCKS;
  document.getElementById('add-block').title = blocks.length >= MAX_BLOCKS ? `Máximo ${MAX_BLOCKS} bloques` : '';
}

/** Bloques tal como están en el formulario (sin guardar). */
function readBlockRows() {
  return [...document.querySelectorAll('#block-rows .block-row')].map((li) => ({
    id: li.dataset.id,
    icon: li.querySelector('[name="block-icon"]').value,
    title: li.querySelector('[name="block-title"]').value,
    start: li.querySelector('[name="block-start"]').value,
    end: li.querySelector('[name="block-end"]').value,
  }));
}

/** Marca en rojo los bloques que se superponen y muestra el motivo. Devuelve el problema o null. */
function checkBlockRows(showError) {
  const blocks = readBlockRows();
  const problem = validateBlocks(blocks);
  const toMin = (t) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : NaN);
  const rows = [...document.querySelectorAll('#block-rows .block-row')];
  rows.forEach((li, i) => {
    const b = blocks[i];
    const bad = !(toMin(b.start) < toMin(b.end)) || blocks.some((o, j) => j !== i
      && toMin(b.start) < toMin(o.end) && toMin(o.start) < toMin(b.end));
    li.classList.toggle('invalid', bad);
  });
  if (showError) {
    const error = document.getElementById('settings-error');
    error.textContent = problem || '';
    error.hidden = !problem;
  }
  return problem;
}

function setupBlocksEditor() {
  const rows = document.getElementById('block-rows');
  document.getElementById('add-block').addEventListener('click', () => {
    const blocks = readBlockRows();
    if (blocks.length >= MAX_BLOCKS) return;
    const range = nextFreeRange(blocks);
    if (!range) {
      showToast('No quedan horas libres en el día: acorta un bloque primero.');
      return;
    }
    const icon = BLOCK_ICONS.find((i) => !blocks.some((b) => b.icon === i)) || BLOCK_ICONS[0];
    let id;
    do id = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`; while (blocks.some((b) => b.id === id));
    blocksDirty = true;
    renderBlockRows([...blocks, { id, icon, title: '', ...range }]);
    rows.querySelector(`[data-id="${id}"] [name="block-title"]`).focus();
    checkBlockRows(false);
  });
  rows.addEventListener('click', (e) => {
    const remove = e.target.closest('.block-remove');
    if (!remove) return;
    blocksDirty = true;
    const id = remove.closest('.block-row').dataset.id;
    renderBlockRows(readBlockRows().filter((b) => b.id !== id));
    checkBlockRows(true);
  });
  rows.addEventListener('input', () => {
    blocksDirty = true;
    checkBlockRows(true);
  });
}

/** Si se quitan bloques con tareas o rutinas, pedir confirmación indicando a dónde pasan. */
function confirmRemovedBlocks(next) {
  const old = blocksOf(state.settings);
  for (const b of old.filter((o) => !next.some((n) => n.id === o.id))) {
    const { tasks, routines } = blockUsage(b.id);
    if (!tasks && !routines) continue;
    const to = next.find((n) => n.id === neighborBlock(old, b.id, next));
    const what = [
      tasks ? `${tasks} tarea${tasks > 1 ? 's' : ''} pendiente${tasks > 1 ? 's' : ''}` : '',
      routines ? `${routines} rutina${routines > 1 ? 's' : ''}` : '',
    ].filter(Boolean).join(' y ');
    // eslint-disable-next-line no-alert
    if (!confirm(`"${b.title}" tiene ${what}. Pasarán a "${to.title.trim() || 'el bloque vecino'}". ¿Quitar el bloque?`)) return false;
  }
  return true;
}

// ---------- Orden del menú inferior ----------

let lastMoved = null; // { id, dir }: para dejar el foco en el mismo botón tras moverla
let tabDraft = null;   // orden elegido y aún sin guardar (null = el guardado)

function renderTabOrderList() {
  const list = document.getElementById('tab-order');
  const saved = normalizeTabOrder(state.settings.tab_order);
  const order = tabDraft || saved;
  const keep = lastMoved;
  lastMoved = null;
  list.replaceChildren(...order.map((id, i) => {
    const icon = document.querySelector(`.tabs .tab[data-tab="${id}"] svg`)?.cloneNode(true);
    return h('li', { class: 'tab-order-row', dataset: { tab: id } },
      h('span', { class: 'tab-order-icon', 'aria-hidden': 'true' }, icon || ''),
      h('span', { class: 'tab-order-name' }, TAB_NAMES[id]),
      h('button', {
        type: 'button', class: 'tab-order-btn', dataset: { move: '-1' }, disabled: i === 0,
        title: 'Más a la izquierda', 'aria-label': `Mover ${TAB_NAMES[id]} a la izquierda`,
      }, '↑'),
      h('button', {
        type: 'button', class: 'tab-order-btn', dataset: { move: '1' }, disabled: i === order.length - 1,
        title: 'Más a la derecha', 'aria-label': `Mover ${TAB_NAMES[id]} a la derecha`,
      }, '↓'));
  }));
  document.getElementById('tab-order-reset').hidden = order.join() === TAB_IDS.join();
  document.getElementById('tab-order-save').disabled = order.join() === saved.join(); // sin cambios
  // Seguir con el foco en el mismo botón de la pestaña que se movió (para moverla varias veces seguidas)
  if (keep) {
    const btn = list.querySelector(`[data-tab="${keep.id}"] [data-move="${keep.dir}"]`);
    (btn && !btn.disabled ? btn : list.querySelector(`[data-tab="${keep.id}"] [data-move]:not(:disabled)`))?.focus();
  }
}

function setupTabOrder() {
  const formEl = document.getElementById('tab-order-form');
  document.getElementById('tab-order').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-move]');
    if (!btn) return;
    lastMoved = { id: btn.closest('li').dataset.tab, dir: btn.dataset.move };
    tabDraft = moveTab(tabDraft || state.settings.tab_order, btn.closest('li').dataset.tab, Number(btn.dataset.move));
    renderTabOrderList();
  });
  document.getElementById('tab-order-reset').addEventListener('click', () => {
    tabDraft = [...TAB_IDS];
    renderTabOrderList();
  });
  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!tabDraft) return;
    const tab_order = tabDraft;
    tabDraft = null;
    saveSettings({ ...state.settings, tab_order });
    flashSaved(formEl);
  });
}

// ---------- Plantillas de documentación ----------

let tplDraft = null;   // { list: [{ id, name, body }], defaultId } mientras hay cambios sin guardar
let tplOpen = null;    // id de la plantilla abierta para editar

const tplSaved = () => ({ list: state.settings.templates.map((t) => ({ ...t })), defaultId: state.settings.default_template });
const tplCurrent = () => tplDraft || tplSaved();
const tplDirty = () => Boolean(tplDraft) && JSON.stringify(tplDraft) !== JSON.stringify(tplSaved());

function renderTemplates() {
  const { list, defaultId } = tplCurrent();
  const def = list.find((t) => t.id === defaultId) || list[0];
  document.getElementById('templates-summary').textContent =
    `${list.length} plantilla${list.length === 1 ? '' : 's'} · por defecto: ${def?.name || '—'}`;
  const typing = document.getElementById('templates-form').contains(document.activeElement)
    && document.activeElement.matches('input[type="text"], textarea');
  if (typing) return; // no pisar lo que se escribe
  document.getElementById('template-list').replaceChildren(...list.map((t) => {
    const open = tplOpen === t.id;
    return h('li', { class: `template-row${open ? ' open' : ''}`, dataset: { id: t.id } },
      h('div', { class: 'template-head' },
        h('label', { class: 'template-default', title: 'Usarla por defecto' },
          h('input', { type: 'radio', name: 'default-template', value: t.id, checked: t.id === def.id }),
          h('span', { class: 'template-name' }, t.name || 'Sin nombre'),
          t.id === def.id ? h('span', { class: 'template-badge' }, 'por defecto') : null),
        h('button', { type: 'button', class: 'link-btn', dataset: { tpl: 'toggle' } }, open ? 'Cerrar' : 'Editar'),
        h('button', {
          type: 'button', class: 'link-btn danger', dataset: { tpl: 'delete' }, disabled: list.length <= 1,
          title: list.length <= 1 ? 'Necesitas al menos una plantilla' : 'Eliminar plantilla',
        }, 'Eliminar')),
      open ? h('div', { class: 'template-edit' },
        h('input', { type: 'text', class: 'template-name-input', name: 'tpl-name', value: t.name, maxlength: 40, 'aria-label': 'Nombre de la plantilla', placeholder: 'Nombre' }),
        h('textarea', { class: 'template-body', name: 'tpl-body', rows: 12, spellcheck: 'false', 'aria-label': 'Contenido (Markdown)' }, t.body)) : null);
  }));
  document.getElementById('add-template').disabled = list.length >= MAX_TEMPLATES;
  document.getElementById('templates-save').disabled = !tplDirty();
}

function setupTemplates() {
  const formEl = document.getElementById('templates-form');
  const listEl = document.getElementById('template-list');
  const error = document.getElementById('templates-error');
  const edit = (fn) => {
    tplDraft = tplCurrent();
    fn(tplDraft);
    error.hidden = true;
  };
  listEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tpl]');
    if (!btn) return;
    const id = btn.closest('.template-row').dataset.id;
    if (btn.dataset.tpl === 'toggle') tplOpen = tplOpen === id ? null : id;
    else if (btn.dataset.tpl === 'delete') {
      const t = tplCurrent().list.find((x) => x.id === id);
      // eslint-disable-next-line no-alert
      if (!window.confirm(`¿Eliminar la plantilla "${t?.name}"? (se aplica al guardar)`)) return;
      edit((d) => {
        d.list = d.list.filter((x) => x.id !== id);
        if (d.defaultId === id) d.defaultId = d.list[0]?.id;
      });
      if (tplOpen === id) tplOpen = null;
    }
    renderTemplates();
  });
  listEl.addEventListener('change', (e) => {
    if (e.target.name !== 'default-template') return;
    edit((d) => { d.defaultId = e.target.value; });
    renderTemplates();
  });
  listEl.addEventListener('input', (e) => {
    const row = e.target.closest('.template-row');
    if (!row || !['tpl-name', 'tpl-body'].includes(e.target.name)) return;
    edit((d) => {
      const t = d.list.find((x) => x.id === row.dataset.id);
      if (e.target.name === 'tpl-name') t.name = e.target.value;
      else t.body = e.target.value;
    });
    row.querySelector('.template-name').textContent = row.querySelector('[name="tpl-name"]').value || 'Sin nombre';
    document.getElementById('templates-save').disabled = !tplDirty();
  });
  document.getElementById('add-template').addEventListener('click', () => {
    const id = `tpl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    edit((d) => { d.list.push({ id, name: 'Nueva plantilla', body: '# {{titulo}}\n\n## \n' }); });
    tplOpen = id;
    renderTemplates();
    const input = listEl.querySelector(`[data-id="${id}"] [name="tpl-name"]`);
    input?.focus();
    input?.select();
  });
  formEl.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!tplDraft) return;
    const list = tplDraft.list.map((t) => ({ ...t, name: t.name.trim() }));
    const problem = validateTemplates(list);
    error.textContent = problem || '';
    error.hidden = !problem;
    if (problem) return;
    const defaultId = list.some((t) => t.id === tplDraft.defaultId) ? tplDraft.defaultId : list[0].id;
    tplDraft = null;
    tplOpen = null;
    document.activeElement?.blur();
    saveSettings({ ...state.settings, templates: list, default_template: defaultId });
    flashSaved(formEl);
  });
}

/** Descripción de la sección cerrada: "3 bloques: ☀︎ Mañana · ☾ Tarde · ✦ Noche" (horarios en el tooltip). */
function renderBlocksSummary() {
  const blocks = blocksOf(state.settings);
  const el = document.getElementById('blocks-summary');
  el.textContent = `${blocks.length} bloque${blocks.length === 1 ? '' : 's'}: ${blocks.map((b) => `${b.icon} ${b.title}`).join(' · ')}`;
  el.title = blocks.map((b) => `${b.icon} ${b.title}: ${b.start}–${b.end}`).join('\n');
}

// ---------- Permiso del botón flotante ----------
// Mostrarlo en las páginas necesita acceso a los sitios (permiso opcional): se pide al activarlo.

const FLOAT_ORIGINS = { origins: ['http://*/*', 'https://*/*'] };
const permissionsApi = typeof chrome !== 'undefined' && chrome.permissions ? chrome.permissions : null;
let floatGranted = !permissionsApi; // fuera de la extensión (pruebas) no hay permisos que pedir

async function refreshFloatPermission() {
  if (!permissionsApi) return;
  const granted = await permissionsApi.contains(FLOAT_ORIGINS).catch(() => false);
  if (granted === floatGranted) return;
  floatGranted = granted;
  renderSettings();
}

function setupFloatPermission(f) {
  const box = f.elements['float-timer'];
  refreshFloatPermission();
  permissionsApi?.onAdded.addListener(refreshFloatPermission);
  permissionsApi?.onRemoved.addListener(refreshFloatPermission);
  box.addEventListener('change', async () => {
    if (!box.checked || floatGranted || !permissionsApi) return;
    // Debe pedirse dentro del clic (gesto del usuario)
    const granted = await permissionsApi.request(FLOAT_ORIGINS).catch(() => false);
    floatGranted = granted;
    box.checked = granted;
    document.getElementById('float-timer-note').hidden = granted;
    if (!granted) showToast('Sin el permiso, el temporizador se ve solo en el panel.');
  });
}

export function renderSettings() {
  renderTabOrderList();
  renderTemplates();
  renderBlocksSummary();
  const s = state.settings;
  // No pisar lo que el usuario está escribiendo en cada sección (abrir o cerrar una sección no cuenta)
  const typingIn = (el) => el.contains(document.activeElement) && document.activeElement.matches('input, select, textarea');
  if (!blocksDirty && !typingIn(document.getElementById('blocks-form'))) renderBlockRows(blocksOf(s));
  loadShortcut();
  const f = form();
  if (typingIn(f)) return;
  f.elements['default-minutes'].value = String(s.default_minutes);
  f.elements.theme.value = s.theme || 'chrome';
  f.elements.notify.checked = Boolean(s.notify);
  f.elements['timer-sound'].checked = s.timer_sound !== false;
  f.elements['float-timer'].checked = s.float_timer !== false && floatGranted;
  document.getElementById('float-timer-note').hidden = floatGranted;
  f.elements.calibrate.checked = s.calibrate !== false;
  document.getElementById('calibration-info').textContent = calibrationText(calibrationInfo);
  f.elements['meeting-lead'].value = String(s.meeting_lead ?? 10);
}

/** "Según tus últimas 12 tareas, tardas ~20 % más de lo que estimas." */
export function calibrationText({ factor, samples }) {
  if (samples < 3) return `Aprende de las tareas que terminas con el temporizador (${samples} de 3 para empezar).`;
  const pct = Math.round(Math.abs(factor - 1) * 100);
  const base = `Según tus últimas ${samples} tareas con tiempo registrado`;
  if (pct < 5) return `${base}, tus estimaciones son acertadas.`;
  return `${base}, tardas ~${pct} % ${factor > 1 ? 'más' : 'menos'} de lo que estimas.`;
}

async function loadShortcut() {
  const el = document.getElementById('shortcut-key');
  try {
    const commands = await chrome.commands.getAll();
    const cmd = commands.find((c) => c.name === '_execute_action');
    el.textContent = cmd?.shortcut || 'sin asignar';
  } catch {
    el.textContent = 'Alt+Shift+P';
  }
}

export function setupSettings() {
  const f = form();
  const error = document.getElementById('settings-error');

  // Bloques del día: guarda solo los bloques
  const blocksForm = document.getElementById('blocks-form');
  blocksForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const blocks = readBlockRows();
    if (checkBlockRows(true)) return;
    if (!confirmRemovedBlocks(blocks)) return;
    const problem = saveSettings({ ...state.settings, blocks });
    error.textContent = problem || '';
    error.hidden = !problem;
    if (problem) return;
    blocksDirty = false;
    renderBlockRows(blocksOf(state.settings)); // ya ordenados por hora
    document.activeElement?.blur();
    flashSaved(blocksForm);
  });

  // Preferencias: guarda solo las preferencias
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    saveSettings({
      ...state.settings,
      default_minutes: Number(f.elements['default-minutes'].value),
      theme: f.elements.theme.value,
      notify: f.elements.notify.checked,
      timer_sound: f.elements['timer-sound'].checked,
      float_timer: f.elements['float-timer'].checked,
      calibrate: f.elements.calibrate.checked,
      meeting_lead: Number(f.elements['meeting-lead'].value),
    });
    document.activeElement?.blur();
    flashSaved(f);
  });

  setupBlocksEditor();

  // El tema se aplica y guarda al elegirlo (sin esperar a "Guardar")
  f.elements.theme.addEventListener('change', () => {
    saveSettings({ ...state.settings, theme: f.elements.theme.value });
  });

  document.getElementById('test-sound').addEventListener('click', () => playCasio());
  setupFloatPermission(f);
  setupBackup();
  setupTabOrder();
  setupTemplates();

  document.getElementById('edit-shortcuts').addEventListener('click', () => {
    try {
      chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
    } catch {
      /* fuera de la extensión no hay chrome.tabs */
    }
  });
}

// ---------- Respaldo ----------

const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const sizeOf = (tasks, epics) => `${count(tasks, 'tarea')}, ${count(epics, 'épica')}`;

function setupBackup() {
  document.getElementById('export-data').addEventListener('click', () => {
    const blob = new Blob([exportBackup()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cabe-todo-${todayISO()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`Respaldo descargado: ${sizeOf(state.tasks.length, state.epics.length)}.`);
  });

  const file = document.getElementById('import-file');
  document.getElementById('import-data').addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const chosen = file.files[0];
    file.value = '';
    if (!chosen) return;
    let backup;
    try {
      backup = readBackup(await chosen.text());
    } catch (err) {
      showToast(err.message);
      return;
    }
    const { tasks, epics } = backup.summary;
    const ok = window.confirm(
      `¿Reemplazar todo lo actual (${sizeOf(state.tasks.length, state.epics.length)}) `
      + `por el respaldo (${sizeOf(tasks, epics)})?\n\nEsto no se puede deshacer: exporta primero si quieres conservar lo actual.`,
    );
    if (!ok) return;
    restoreBackup(backup.data);
    showToast(`Respaldo restaurado: ${sizeOf(tasks, epics)}.`);
  });
}
