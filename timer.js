// Temporizador por tarea. El tiempo se guarda como tramos { start, end } (ISO);
// el último tramo con end = null está corriendo. Así sigue contando aunque el panel se cierre.

export function isRunning(task) {
  const entries = task.time_entries || [];
  return entries.length > 0 && !entries[entries.length - 1].end;
}

/** Milisegundos registrados (incluye el tramo en curso hasta `now`). */
export function trackedMs(task, now = Date.now()) {
  let total = 0;
  for (const e of task.time_entries || []) {
    const start = Date.parse(e.start);
    const end = e.end ? Date.parse(e.end) : now;
    if (end > start) total += end - start;
  }
  return total;
}

/** 754000 → "12:34" · 3723000 → "1:02:03" */
export function formatStopwatch(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Texto corto para la fila: "<1m", "25m", "1h05". */
export function formatTracked(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return '<1m';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

// ---------- Cuenta atrás desde la estimación de la tarea ----------

export function estimateMs(task) {
  return (task.minutes || 0) * 60000;
}

/** Tiempo que queda hasta la estimación (negativo = tiempo extra). */
export function remainingMs(task, now = Date.now()) {
  return estimateMs(task) - trackedMs(task, now);
}

/** Momento (ms) en que el temporizador en marcha llegará a cero; null si no corre o ya pasó. */
export function zeroAt(task, now = Date.now()) {
  if (!isRunning(task)) return null;
  const left = remainingMs(task, now);
  return left > 0 ? now + left : null;
}

/** Reloj de cuenta atrás: "29:54"; al pasarse, "+01:12". */
export function formatCountdown(ms) {
  if (ms > 0) return formatStopwatch(Math.ceil(ms / 1000) * 1000);
  return `+${formatStopwatch(-ms)}`;
}

/** Texto corto de lo que queda (redondea hacia arriba): "13m", "1h05", "<1m". */
export function formatLeft(ms) {
  if (ms < 60000) return '<1m';
  const min = Math.ceil(ms / 60000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}
