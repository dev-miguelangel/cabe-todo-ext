// Ordenar una lista arrastrando desde una manija (⠿): con mouse (drag & drop de HTML5) y con el dedo
// (se toma la manija y se arrastra; la página se desplaza sola cerca de los bordes).
// Compartido con la versión web.

const EDGE = 72; // px desde el borde en que la página se desplaza sola al arrastrar con el dedo

/**
 * container: el elemento que contiene los ítems. opts:
 *  item: selector de los ítems que se ordenan · handle: selector de la manija dentro del ítem
 *  idOf(el): id del ítem · onSort(ids): orden nuevo (solo si cambió)
 * Devuelve { busy() }: true mientras se arrastra (para no re-renderizar a mitad).
 */
export function makeSortable(container, { item, handle, idOf, onSort }) {
  let dragging = null;
  let before = '';
  let point = { x: 0, y: 0 };
  let raf = null;

  const ids = () => [...container.querySelectorAll(item)].map(idOf);
  const place = (target, clientY) => {
    if (!dragging || !target || target === dragging || target.parentElement !== dragging.parentElement) return;
    const box = target.getBoundingClientRect();
    if (clientY < box.top + box.height / 2) target.before(dragging);
    else target.after(dragging);
  };
  const start = (el) => {
    dragging = el;
    before = ids().join();
    el.classList.add('sort-dragging');
    container.classList.add('is-sorting');
  };
  const finish = () => {
    if (!dragging) return;
    cancelAnimationFrame(raf);
    dragging.classList.remove('sort-dragging');
    dragging.draggable = false;
    container.classList.remove('is-sorting');
    dragging = null;
    const after = ids();
    if (after.join() !== before) onSort(after);
  };

  // ---------- Mouse: la manija activa el arrastre del ítem ----------
  container.addEventListener('mousedown', (e) => {
    const h = e.target.closest(handle);
    const el = h?.closest(item);
    if (el) el.draggable = true;
  });
  container.addEventListener('mouseup', (e) => {
    const el = e.target.closest(item);
    if (el && !dragging) el.draggable = false;
  });
  container.addEventListener('dragstart', (e) => {
    const el = e.target.closest?.(item);
    if (!el || !el.draggable) return;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', idOf(el));
    requestAnimationFrame(() => start(el));
  });
  container.addEventListener('dragover', (e) => {
    if (!dragging) return;
    e.preventDefault();
    place(e.target.closest(item), e.clientY);
  });
  container.addEventListener('drop', (e) => { if (dragging) e.preventDefault(); });
  container.addEventListener('dragend', finish);

  // ---------- Dedo: tomar la manija y arrastrar ----------
  const autoScroll = () => {
    if (!dragging) return;
    const navTop = document.querySelector('.tabs')?.getBoundingClientRect().top ?? window.innerHeight;
    let dy = 0;
    if (point.y < EDGE) dy = -Math.ceil((EDGE - point.y) / 6);
    else if (point.y > navTop - EDGE) dy = Math.ceil((point.y - (navTop - EDGE)) / 6);
    if (dy) {
      window.scrollBy(0, dy);
      place(document.elementFromPoint(point.x, point.y)?.closest(item), point.y);
    }
    raf = requestAnimationFrame(autoScroll);
  };
  container.addEventListener('touchstart', (e) => {
    const h = e.target.closest(handle);
    const el = h?.closest(item);
    if (!el || e.touches.length !== 1) return;
    point = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    start(el);
    navigator.vibrate?.(10);
    raf = requestAnimationFrame(autoScroll);
  }, { passive: true });
  container.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    e.preventDefault(); // arrastrando: la página no se desplaza con el dedo
    point = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    place(document.elementFromPoint(point.x, point.y)?.closest(item), point.y);
  }, { passive: false });
  container.addEventListener('touchend', finish);
  container.addEventListener('touchcancel', finish);

  return { busy: () => Boolean(dragging) };
}
