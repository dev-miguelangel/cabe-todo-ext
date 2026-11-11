// Renderizador de Markdown pequeño y seguro (sin dependencias).
// Todo el texto se escapa ANTES de aplicar formato, así que no se puede inyectar HTML;
// los enlaces solo aceptan http(s) y mailto.
//
// Soporta: # títulos, **negrita**, *cursiva*, ~~tachado~~, `código`, bloques ```,
// listas con - * + y numeradas, tareas - [ ] / - [x], > citas, ---, [enlaces](https://…)
// y URLs sueltas. Los saltos de línea dentro de un párrafo se respetan (como en GitHub).

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ESC[c]);

function safeUrl(url) {
  const u = url.trim();
  return /^(https?:\/\/|mailto:)/i.test(u) ? u : null;
}

function inline(text) {
  const slots = [];
  const keep = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let s = escapeHtml(text);

  s = s.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${code}</code>`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    // url ya está escapada: se des-escapa &amp; para validar y se vuelve a escapar al emitir
    const safe = safeUrl(url.replace(/&amp;/g, '&'));
    return safe ? keep(`<a href="${escapeHtml(safe)}" target="_blank" rel="noopener noreferrer">${label}</a>`) : m;
  });
  s = s.replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (url) =>
    keep(`<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`));
  s = s.replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '<strong>$2</strong>');
  s = s.replace(/(^|[^*\w])\*(?=\S)(.+?)(?<=\S)\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_(?=\S)(.+?)(?<=\S)_(?![_\w])/g, '$1<em>$2</em>');
  s = s.replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '<del>$1</del>');

  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+(.*)$/;

/**
 * opts.headingBase: etiqueta para "#". 3 (por defecto) = comentarios (# → h3);
 * 1 = documento a página completa (# → h1).
 */
export function renderMarkdown(src, opts = {}) {
  const base = opts.headingBase ?? 3;
  const lines = (src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { i += 1; continue; }

    // Bloque de código ```
    if (/^\s*```/.test(line)) {
      const body = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
      i += 1; // cierre
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    // Título
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(6, heading[1].length + base - 1);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    // Línea horizontal
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    // Cita
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      out.push(`<blockquote>${renderMarkdown(body.join('\n'), opts)}</blockquote>`);
      continue;
    }

    // Lista
    const first = line.match(LIST_ITEM);
    if (first) {
      const ordered = /\d/.test(first[1]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST_ITEM);
        if (!m || /\d/.test(m[1]) !== ordered) break;
        items.push(m[2]);
        i += 1;
      }
      const lis = items.map((item) => {
        const task = item.match(/^\[([ xX])\]\s+(.*)$/);
        if (task) {
          const checked = task[1] !== ' ' ? ' checked' : '';
          return `<li class="task-item"><input type="checkbox" disabled${checked}> ${inline(task[2])}</li>`;
        }
        return `<li>${inline(item)}</li>`;
      });
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${lis.join('')}</${tag}>`);
      continue;
    }

    // Párrafo: hasta una línea vacía o el inicio de otro bloque
    const para = [];
    while (i < lines.length && lines[i].trim()
      && !/^\s*(```|#{1,6}\s|>)/.test(lines[i]) && !LIST_ITEM.test(lines[i])
      && !/^\s*([-*_])(\s*\1){2,}\s*$/.test(lines[i])) {
      para.push(inline(lines[i]));
      i += 1;
    }
    out.push(`<p>${para.join('<br>')}</p>`);
  }
  return out.join('');
}

/** Extracto en texto plano (sin sintaxis Markdown) para mostrar un adelanto. */
export function markdownExcerpt(src, max = 180) {
  const text = (src || '')
    .replace(/```[\s\S]*?(```|$)/g, ' ')            // bloques de código fuera
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')        // [texto](url) → texto
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]\s\[[ xX]\]|[-*+]|\d+[.)])\s+/gm, '') // marcas de bloque
    .replace(/^\s*([-*_])(\s*\1){2,}\s*$/gm, ' ')     // líneas ---
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(^|\W)[*_](\S[^*_]*\S|\S)[*_](?=\W|$)/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : text;
}

/** Títulos y subtítulos (# … ######) en texto plano, ignorando los bloques de código. */
export function markdownHeadings(src) {
  const out = [];
  let inCode = false;
  for (const line of (src || '').replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*```/.test(line)) { inCode = !inCode; continue; }
    if (inCode) continue;
    const m = line.match(/^\s*(#{1,6})\s+(.*)$/);
    if (!m) continue;
    const text = markdownExcerpt(m[2].replace(/\s#+\s*$/, ''), 200);
    if (text) out.push({ level: m[1].length, text });
  }
  return out;
}
