// Botones flotantes (abajo a la derecha de la página activa):
//  · Temporizador (verde en cuenta atrás, rojo al pasarse) mientras una tarea tiene el temporizador corriendo.
//  · Reunión (celeste): aparece N min antes de que empiece una reunión (Ajustes, 10 por defecto), con cuenta regresiva.
//    Al empezar se puede cerrar; si bloquea, el service worker inicia su temporizador y el botón
//    verde pasa a mostrar el tiempo de la reunión.
//
// Se carga como content script en las páginas web y como <script> en la pestaña de documentación.
// Es un script clásico (los content scripts no pueden ser módulos), por eso repite unas pocas
// funciones de timer.js. Solo lee chrome.storage de la extensión; no lee nada de la página.
(() => {
  if (window.__cabetodoFloatTimer) return;
  window.__cabetodoFloatTimer = true;
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

  const TIMER_MIN_KEY = 'float_timer_min';          // botón del temporizador minimizado (todas las pestañas)
  const MEETING_MIN_KEY = 'float_meeting_min';      // botón de reunión minimizado
  const DISMISSED_KEY = 'float_meeting_dismissed';  // reuniones cuyo botón se cerró
  const DEFAULT_LEAD_MIN = 10;                      // aparece 10 min antes, salvo que Ajustes diga otra cosa
  const IDLE_CHECK_MS = 15 * 1000;                  // sin botones: revisar cada 15 s si se acerca una reunión

  let tasks = [];
  let enabled = true;
  let leadMs = DEFAULT_LEAD_MIN * 60000;
  const readSettings = (s = {}) => {
    enabled = s.float_timer !== false;
    const lead = Number(s.meeting_lead);
    leadMs = (Number.isFinite(lead) && lead >= 0 ? lead : DEFAULT_LEAD_MIN) * 60000;
  };
  let timerMin = false;
  let meetingMin = false;
  let dismissed = [];
  let host = null;
  let stack = null;
  const widgets = {}; // { timer, meeting }
  let tick = null;
  let idle = null;

  // ---------- Tiempo ----------
  const isRunning = (t) => {
    const e = t.time_entries || [];
    return e.length > 0 && !e[e.length - 1].end;
  };
  const trackedMs = (t, now) => (t.time_entries || []).reduce((sum, e) => {
    const start = Date.parse(e.start);
    const end = e.end ? Date.parse(e.end) : now;
    return end > start ? sum + (end - start) : sum;
  }, 0);
  const pad = (n) => String(n).padStart(2, '0');
  const clock = (ms) => {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    return h ? `${h}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}` : `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  };
  const ceilClock = (ms) => clock(Math.ceil(ms / 1000) * 1000);
  const at = (isoDate, hhmm) => {
    const [y, m, d] = isoDate.split('-').map(Number);
    const [h, mi] = hhmm.split(':').map(Number);
    return new Date(y, m - 1, d, h, mi).getTime();
  };

  // Si corren una tarea y una reunión paralela a la vez, el botón verde muestra la tarea
  const runningTask = () => tasks.find((t) => isRunning(t) && !t.meeting) || tasks.find(isRunning);

  /** Reunión más próxima que está a ≤N min de empezar o en curso (y cuyo botón no se cerró). */
  function nextMeeting(now) {
    return tasks
      .filter((t) => t.meeting && !t.done && t.date && !dismissed.includes(t.id))
      .map((t) => ({ task: t, start: at(t.date, t.meeting.start), end: at(t.date, t.meeting.end) }))
      .filter((m) => now >= m.start - leadMs && now < m.end)
      .sort((a, b) => a.start - b.start)[0] || null;
  }

  // ---------- Interfaz (Shadow DOM cerrado: los estilos de la página no la afectan) ----------
  const CSS = `
    :host { all: initial; }
    .stack {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
      font: 600 13px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .wrap {
      display: flex; align-items: center; gap: 2px; padding: 4px;
      border-radius: 999px; box-shadow: 0 6px 20px rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.15);
      color: #121212; background: #1db954;
      transition: transform .15s; animation: in .2s ease-out;
    }
    .wrap.over { background: #e5484d; color: #fff; }
    .wrap.meeting { background: #4fc3f7; color: #06232f; }
    .wrap:hover { transform: translateY(-1px); }
    button {
      all: unset; box-sizing: border-box; cursor: pointer; color: inherit;
      display: inline-flex; align-items: center; justify-content: center;
      border-radius: 999px; height: 32px;
    }
    button:focus-visible { outline: 2px solid currentColor; outline-offset: 1px; }
    .main { gap: 8px; padding: 0 12px 0 10px; max-width: 300px; }
    .main:hover, .icon:hover { background: rgba(0,0,0,.12); }
    .over .main:hover, .over .icon:hover { background: rgba(255,255,255,.18); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex: none; animation: blink 1s steps(1) infinite; }
    .label { font-weight: 600; opacity: .85; white-space: nowrap; }
    .time { font-size: 15px; font-weight: 700; font-variant-numeric: tabular-nums; letter-spacing: .01em; }
    .title { font-weight: 500; opacity: .85; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 150px; }
    .icon { width: 32px; font-size: 12px; }
    .pause { gap: 3px; }
    .pause::before, .pause::after { content: ""; width: 3px; height: 12px; border-radius: 1px; background: currentColor; }
    .stop::before { content: ""; width: 11px; height: 11px; border-radius: 2px; background: currentColor; }
    .play::before { content: ""; border-style: solid; border-width: 6px 0 6px 10px; border-color: transparent transparent transparent currentColor; margin-left: 2px; }
    .close { font-size: 16px; opacity: .75; }
    .close:hover { opacity: 1; }
    /* Minimizado: solo un círculo que parpadea */
    .expand { display: none; width: 28px; height: 28px; }
    .expand::before { content: ""; width: 12px; height: 12px; border-radius: 50%; background: currentColor; animation: blink 1s steps(1) infinite; }
    .wrap.min { padding: 4px; gap: 0; }
    .wrap.min > :not(.expand) { display: none; }
    .wrap.min .expand { display: inline-flex; }
    [hidden] { display: none !important; }
    @keyframes blink { 50% { opacity: .25; } }
    @keyframes in { from { opacity: 0; transform: translateY(8px); } }
    @media (prefers-reduced-motion: reduce) { .dot, .expand::before, .wrap { animation: none; } }
  `;

  function el(tag, cls, attrs = {}) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function mountHost() {
    if (host) return;
    host = document.createElement('cabetodo-timer');
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    stack = el('div', 'stack');
    shadow.append(style, stack);
    (document.body || document.documentElement).append(host);
  }

  function unmountHost() {
    host?.remove();
    host = null;
    stack = null;
    delete widgets.timer;
    delete widgets.meeting;
    clearInterval(tick);
    tick = null;
  }

  /** Crea un botón flotante. kind: 'timer' | 'meeting'. */
  function createWidget(kind) {
    const wrap = el('div', `wrap${kind === 'meeting' ? ' meeting' : ''}`, { role: 'timer', 'aria-live': 'off' });
    const main = el('button', 'main', { type: 'button', title: 'Abrir Cabe Todo' });
    const dot = el('span', 'dot', { 'aria-hidden': 'true' });
    const label = el('span', 'label');
    const time = el('span', 'time');
    const title = el('span', 'title');
    main.append(dot, label, time, title);
    const w = { kind, wrap, main, label, time, title };

    main.addEventListener('click', () => send({ type: 'cabetodo-open-panel' }));
    wrap.append(main);

    if (kind === 'timer') {
      w.pause = el('button', 'icon pause', { type: 'button', title: 'Pausar', 'aria-label': 'Pausar temporizador' });
      w.pause.addEventListener('click', () => send({ type: 'cabetodo-pause-timer' }));
      // Las reuniones no se pausan: en su lugar, ■ Finalizar
      w.stop = el('button', 'icon stop', { type: 'button', title: 'Finalizar reunión', 'aria-label': 'Finalizar reunión' });
      w.stop.addEventListener('click', () => w.taskId && send({ type: 'cabetodo-finish-meeting', taskId: w.taskId }));
      wrap.append(w.pause, w.stop);
    } else {
      // Reunión ya empezada sin temporizador (p. ej. paralela): permitir iniciarlo
      w.play = el('button', 'icon play', { type: 'button', title: 'Iniciar temporizador de la reunión', 'aria-label': 'Iniciar temporizador de la reunión' });
      w.play.addEventListener('click', () => w.taskId && send({ type: 'cabetodo-start-timer', taskId: w.taskId }));
      wrap.append(w.play);
    }

    w.close = el('button', 'icon close', { type: 'button' });
    w.close.textContent = '×';
    w.close.addEventListener('click', () => {
      // Reunión ya empezada: × la cierra. Antes de empezar (y en el temporizador): × minimiza.
      if (kind === 'meeting' && w.started) dismissMeeting(w.taskId);
      else setMin(kind, true);
    });
    w.expand = el('button', 'expand', { type: 'button', 'aria-label': 'Mostrar' });
    w.expand.addEventListener('click', () => setMin(kind, false));
    wrap.append(w.close, w.expand);
    return w;
  }

  function setMin(kind, value) {
    if (kind === 'timer') timerMin = value;
    else meetingMin = value;
    const w = widgets[kind];
    if (w) {
      update();
      (value ? w.expand : w.main).focus();
    }
    store({ [kind === 'timer' ? TIMER_MIN_KEY : MEETING_MIN_KEY]: value }); // las demás pestañas lo reciben
  }

  function dismissMeeting(taskId) {
    // Guardar solo ids de tareas que siguen existiendo, para que la lista no crezca sin fin
    dismissed = [...dismissed.filter((id) => tasks.some((t) => t.id === id)), taskId];
    render();
    store({ [DISMISSED_KEY]: dismissed });
  }

  function store(obj) {
    try {
      chrome.storage.local.set(obj);
    } catch {
      /* extensión recargada: el cambio queda solo en esta página */
    }
  }

  function send(msg) {
    try {
      chrome.runtime.sendMessage(msg);
    } catch {
      unmountHost(); // la extensión se recargó: este script quedó huérfano
    }
  }

  // ---------- Actualizar ----------

  function updateTimer(w, t, now) {
    w.taskId = t.id;
    w.pause.hidden = Boolean(t.meeting);
    w.stop.hidden = !t.meeting;
    const left = (t.minutes || 0) * 60000 - trackedMs(t, now);
    const over = left <= 0;
    w.wrap.classList.toggle('over', over);
    w.wrap.classList.toggle('min', timerMin);
    w.label.hidden = true;
    w.time.textContent = over ? `+${clock(-left)}` : ceilClock(left);
    w.title.textContent = t.title;
    const text = over ? `${t.title}: tiempo cumplido, ${clock(-left)} extra` : `${t.title}: quedan ${ceilClock(left)}`;
    w.wrap.setAttribute('aria-label', text);
    w.main.title = `${t.title} · ${over ? 'tiempo cumplido' : 'cuenta atrás'} · clic para abrir Cabe Todo`;
    w.close.title = 'Minimizar';
    w.close.setAttribute('aria-label', 'Minimizar temporizador');
    w.expand.title = `${text} · clic para mostrar`;
  }

  function updateMeeting(w, m, now) {
    const started = now >= m.start;
    w.taskId = m.task.id;
    w.started = started;
    w.wrap.classList.toggle('min', meetingMin);
    w.label.hidden = false;
    w.label.textContent = started ? '◷ Empezó' : '◷ En';
    w.time.hidden = started;
    w.time.textContent = started ? '' : ceilClock(m.start - now);
    w.title.textContent = m.task.title;
    w.play.hidden = !started || isRunning(m.task);
    const range = `${m.task.meeting.start}–${m.task.meeting.end}`;
    const text = started
      ? `La reunión "${m.task.title}" empezó (${range})`
      : `La reunión "${m.task.title}" empieza en ${ceilClock(m.start - now)} (${range})`;
    w.wrap.setAttribute('aria-label', text);
    w.main.title = `${text} · clic para abrir Cabe Todo`;
    w.close.title = started ? 'Cerrar' : 'Minimizar';
    w.close.setAttribute('aria-label', started ? 'Cerrar aviso de reunión' : 'Minimizar aviso de reunión');
    w.expand.title = `${text} · clic para mostrar`;
  }

  /** Recalcula qué botones deben verse y los actualiza. Devuelve si hay alguno visible. */
  function update() {
    const now = Date.now();
    const timerTask = enabled ? runningTask() : null;
    const meeting = enabled ? nextMeeting(now) : null;

    if (!timerTask && !meeting) {
      unmountHost();
      return false;
    }
    mountHost();

    // Reunión arriba, temporizador abajo
    for (const [kind, data] of [['meeting', meeting], ['timer', timerTask]]) {
      if (!data) {
        widgets[kind]?.wrap.remove();
        delete widgets[kind];
        continue;
      }
      if (!widgets[kind]) {
        widgets[kind] = createWidget(kind);
        if (kind === 'meeting') stack.prepend(widgets[kind].wrap);
        else stack.append(widgets[kind].wrap);
      }
      if (kind === 'timer') updateTimer(widgets.timer, data, now);
      else updateMeeting(widgets.meeting, data, now);
    }
    return true;
  }

  function render() {
    const visible = update();
    if (visible && !tick && document.visibilityState === 'visible') tick = setInterval(update, 1000);
    if (!visible) {
      clearInterval(tick);
      tick = null;
    }
  }

  // Sin botones visibles igual hay que notar cuando una reunión entra en su cuenta regresiva
  function startIdleCheck() {
    clearInterval(idle);
    idle = setInterval(() => {
      if (!host && document.visibilityState === 'visible') render();
    }, IDLE_CHECK_MS);
  }

  document.addEventListener('visibilitychange', () => {
    clearInterval(tick);
    tick = null;
    if (document.visibilityState === 'visible') render();
  });

  chrome.storage.local.get(['tasks', 'settings', TIMER_MIN_KEY, MEETING_MIN_KEY, DISMISSED_KEY]).then((data) => {
    tasks = data.tasks || [];
    readSettings(data.settings || {});
    timerMin = Boolean(data[TIMER_MIN_KEY]);
    meetingMin = Boolean(data[MEETING_MIN_KEY]);
    dismissed = data[DISMISSED_KEY] || [];
    render();
    startIdleCheck();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    let dirty = false;
    if (changes.tasks) { tasks = changes.tasks.newValue || []; dirty = true; }
    if (changes.settings) { readSettings(changes.settings.newValue || {}); dirty = true; }
    if (changes[TIMER_MIN_KEY]) { timerMin = Boolean(changes[TIMER_MIN_KEY].newValue); dirty = true; }
    if (changes[MEETING_MIN_KEY]) { meetingMin = Boolean(changes[MEETING_MIN_KEY].newValue); dirty = true; }
    if (changes[DISMISSED_KEY]) { dismissed = changes[DISMISSED_KEY].newValue || []; dirty = true; }
    if (dirty) render();
  });
})();
