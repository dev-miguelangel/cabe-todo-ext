// Sonido de alarma estilo reloj Casio antiguo: pitido agudo de onda cuadrada (~4 kHz),
// 2 rondas de 4 "bips" cortos. Sintetizado con Web Audio (sin archivos de audio).

const FREQ = 4096;      // tono del piezo de los relojes digitales
const BEEP = 0.07;      // duración de cada bip (s)
const GAP = 0.06;       // silencio entre bips
const BEEPS = 4;
const ROUNDS = 2;
const ROUND_PAUSE = 0.45;
const VOLUME = 0.08;    // la onda cuadrada es estridente: volumen bajo

/** Programa la alarma en un AudioContext (o OfflineAudioContext). Devuelve la duración en segundos. */
export function scheduleCasio(ctx, t0 = ctx.currentTime) {
  const out = ctx.createGain();
  out.gain.value = VOLUME;
  out.connect(ctx.destination);
  const roundLength = BEEPS * (BEEP + GAP);
  for (let r = 0; r < ROUNDS; r += 1) {
    for (let b = 0; b < BEEPS; b += 1) {
      const start = t0 + r * (roundLength + ROUND_PAUSE) + b * (BEEP + GAP);
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = FREQ;
      // Ataque y caída muy cortos para evitar "clics"
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(1, start + 0.004);
      env.gain.setValueAtTime(1, start + BEEP - 0.004);
      env.gain.linearRampToValueAtTime(0, start + BEEP);
      osc.connect(env).connect(out);
      osc.start(start);
      osc.stop(start + BEEP + 0.01);
    }
  }
  return ROUNDS * roundLength + (ROUNDS - 1) * ROUND_PAUSE;
}

/** Reproduce la alarma ahora. */
export async function playCasio() {
  const ctx = new AudioContext();
  if (ctx.state === 'suspended') await ctx.resume();
  const duration = scheduleCasio(ctx);
  setTimeout(() => ctx.close(), (duration + 0.3) * 1000);
  return duration;
}
