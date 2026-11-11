// Tooltip propio (no el gris del navegador) para cualquier elemento con data-tooltip="…".
// Aparece al pasar el mouse o con el foco del teclado; se ubica arriba (o abajo si no cabe)
// y nunca se sale de la ventana.

let tip = null;
let anchor = null;

function show(el) {
  const text = el.dataset.tooltip;
  if (!text || el.classList.contains('open')) return; // abierto con clic: ya muestra su propio detalle
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'app-tooltip';
    tip.setAttribute('role', 'tooltip');
    document.body.append(tip);
  }
  anchor = el;
  tip.textContent = text;
  tip.hidden = false;
  const r = el.getBoundingClientRect();
  const w = tip.offsetWidth;
  const hgt = tip.offsetHeight;
  const left = Math.min(Math.max(6, r.left + r.width / 2 - w / 2), window.innerWidth - w - 6);
  const above = r.top - hgt - 6;
  tip.style.left = `${left}px`;
  tip.style.top = `${above >= 6 ? above : r.bottom + 6}px`;
}

function hide() {
  if (tip) tip.hidden = true;
  anchor = null;
}

/** Se instala una vez por página. */
export function installTooltips() {
  const target = (e) => e.target.closest?.('[data-tooltip]');
  document.addEventListener('mouseover', (e) => {
    const el = target(e);
    if (el && el !== anchor) show(el);
    else if (!el && anchor) hide();
  });
  document.addEventListener('focusin', (e) => { const el = target(e); if (el) show(el); });
  document.addEventListener('focusout', hide);
  document.addEventListener('click', hide, true);
  window.addEventListener('scroll', hide, true);
}
