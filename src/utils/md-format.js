// Botones rápidos del editor Markdown: transforman el texto y la selección.
// Puro (sin DOM): applyFormat(texto, inicioSel, finSel, tipo) → { text, start, end }.

const LINE_PREFIX = {
  h1: '# ',
  h2: '## ',
  h3: '### ',
  ul: '- ',
  task: '- [ ] ',
  quote: '> ',
};
const WRAP = {
  bold: { mark: '**', placeholder: 'texto' },
  italic: { mark: '*', placeholder: 'texto' },
  code: { mark: '`', placeholder: 'código' },
};

/** Inicio y fin de las líneas que toca la selección. */
function lineBounds(text, s, e) {
  const start = text.lastIndexOf('\n', s - 1) + 1;
  // Si la selección termina justo al inicio de una línea, esa línea no cuenta
  const effectiveEnd = e > s && text[e - 1] === '\n' ? e - 1 : e;
  let end = text.indexOf('\n', effectiveEnd);
  if (end === -1) end = text.length;
  return { start, end };
}

/** Quita el prefijo de bloque que ya tenga la línea (título, lista, tarea o cita). */
function stripBlockPrefix(line) {
  return line.replace(/^(#{1,6}\s+|-\s\[[ xX]\]\s+|[-*+]\s+|>\s?)/, '');
}

function prefixLines(text, s, e, prefix) {
  const { start, end } = lineBounds(text, s, e);
  const lines = text.slice(start, end).split('\n');
  // Si todas las líneas ya tienen este prefijo, el botón lo quita (alternar)
  const all = lines.every((l) => l.startsWith(prefix));
  const next = lines.map((l) => (all ? l.slice(prefix.length) : prefix + stripBlockPrefix(l)));
  const block = next.join('\n');
  const out = text.slice(0, start) + block + text.slice(end);
  if (s === e && lines.length === 1) {
    // Sin selección: cursor al final de la línea
    const caret = start + block.length;
    return { text: out, start: caret, end: caret };
  }
  return { text: out, start, end: start + block.length };
}

function wrap(text, s, e, { mark, placeholder }) {
  const sel = text.slice(s, e);
  // Si la selección ya está envuelta con la marca, quitarla
  if (sel && text.slice(s - mark.length, s) === mark && text.slice(e, e + mark.length) === mark) {
    const out = text.slice(0, s - mark.length) + sel + text.slice(e + mark.length);
    return { text: out, start: s - mark.length, end: e - mark.length };
  }
  const inner = sel || placeholder;
  const out = text.slice(0, s) + mark + inner + mark + text.slice(e);
  return { text: out, start: s + mark.length, end: s + mark.length + inner.length };
}

function link(text, s, e) {
  const sel = text.slice(s, e);
  if (sel) {
    const isUrl = /^https?:\/\/\S+$/.test(sel);
    const label = isUrl ? 'texto' : sel;
    const url = isUrl ? sel : 'https://';
    const out = `${text.slice(0, s)}[${label}](${url})${text.slice(e)}`;
    // Seleccionar lo que falta completar: la URL, o el texto si ya había URL
    const urlStart = s + label.length + 3;
    return isUrl
      ? { text: out, start: s + 1, end: s + 1 + label.length }
      : { text: out, start: urlStart, end: urlStart + url.length };
  }
  const out = `${text.slice(0, s)}[texto](https://)${text.slice(e)}`;
  return { text: out, start: s + 1, end: s + 6 };
}

function codeBlock(text, s, e) {
  const sel = text.slice(s, e);
  const before = s > 0 && text[s - 1] !== '\n' ? '\n' : '';
  const after = e < text.length && text[e] !== '\n' ? '\n' : '';
  const inner = sel.replace(/\n$/, '');
  const block = `${before}\`\`\`\n${inner}\n\`\`\`${after}`;
  const out = text.slice(0, s) + block + text.slice(e);
  const innerStart = s + before.length + 4;
  return { text: out, start: innerStart, end: innerStart + inner.length };
}

/** Inserta un bloque en líneas propias (con una línea vacía antes y después si hace falta). */
function block(text, s, e, body, select) {
  const before = text.slice(0, s);
  const after = text.slice(e);
  const lead = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const tail = !after ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const out = before + lead + body + tail + after;
  const at = before.length + lead.length;
  return select ? { text: out, start: at + select[0], end: at + select[1] } : { text: out, start: at + body.length + tail.length, end: at + body.length + tail.length };
}

/** Línea horizontal (---) en su propia línea; el cursor queda después. */
function hr(text, s, e) {
  return block(text, s, e, '---', null);
}

/** Tabla de 3 columnas; si había texto seleccionado, va en la primera celda. Selecciona "Columna 1" para escribir. */
function table(text, s, e) {
  const first = text.slice(s, e).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '/').trim() || 'Columna 1';
  const body = `| ${first} | Columna 2 | Columna 3 |\n| --- | --- | --- |\n|  |  |  |`;
  return block(text, s, e, body, [2, 2 + first.length]);
}

export function applyFormat(text, s, e, kind) {
  if (LINE_PREFIX[kind]) return prefixLines(text, s, e, LINE_PREFIX[kind]);
  if (WRAP[kind]) return wrap(text, s, e, WRAP[kind]);
  if (kind === 'link') return link(text, s, e);
  if (kind === 'codeblock') return codeBlock(text, s, e);
  if (kind === 'hr') return hr(text, s, e);
  if (kind === 'table') return table(text, s, e);
  return { text, start: s, end: e };
}

/** Botones de la barra, en orden. */
export const TOOLBAR = [
  { kind: 'h1', label: 'H1', title: 'Título 1' },
  { kind: 'h2', label: 'H2', title: 'Título 2' },
  { kind: 'h3', label: 'H3', title: 'Título 3' },
  { sep: true },
  { kind: 'bold', label: 'B', title: 'Negrita (⌘B)', className: 'tb-bold' },
  { kind: 'italic', label: 'I', title: 'Cursiva (⌘I)', className: 'tb-italic' },
  { kind: 'link', label: 'Enlace', title: 'Enlace (⌘K)' },
  { sep: true },
  { kind: 'code', label: '`código`', title: 'Código en línea' },
  { kind: 'codeblock', label: '{ } Bloque', title: 'Bloque de código' },
  { sep: true },
  { kind: 'ul', label: '• Lista', title: 'Lista' },
  { kind: 'task', label: '☐ Tareas', title: 'Lista de tareas' },
  { kind: 'quote', label: '❝ Cita', title: 'Cita' },
  { sep: true },
  { kind: 'table', label: '▦ Tabla', title: 'Tabla' },
  { kind: 'hr', label: '― Línea', title: 'Línea horizontal' },
];

/** Atajos de teclado del editor. */
export const SHORTCUTS = { b: 'bold', i: 'italic', k: 'link' };
