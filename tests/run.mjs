// Pruebas de la lógica pura (parser + PERT + épicas). Ejecutar: node tests/run.mjs
import assert from 'node:assert/strict';
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { parseQuickAdd: p, formatMinutes: f, formatClock, toQuickAddText } = await import(root + '/src/core/parser.js');
const P = await import(root + '/src/core/pert.js');
const T = (title, minutes, block = null, certainty = null, epicTag = null) => ({ title, minutes, block, certainty, epicTag, repeat: null, date: null, meeting: null });
const cases = [
  ['Responder correos', T('Responder correos', null)],
  ['Informe mensual 2h', T('Informe mensual', 120)],
  ['Llamar a Juan 15m pm', T('Llamar a Juan', 15, 'pm')],
  ['Llamar a Juan pm 15m', T('Llamar a Juan', 15, 'pm')],
  ['Revisión 1h30', T('Revisión', 90)],
  ['Revisión 1,5h am', T('Revisión', 90, 'am')],
  ['Reunión de la tarde', T('Reunión de la tarde', null)],
  ['Gimnasio tarde', T('Gimnasio', null, 'pm')],
  ['Comprar 2 kg', T('Comprar 2 kg', null)],
  ['Revisar PR 1h ?', T('Revisar PR', 60, null, 'unsure')],
  ['Revisar PR 1h? pm', T('Revisar PR', 60, 'pm', 'unsure')],
  ['Pagar luz 10m !', T('Pagar luz', 10, null, 'sure')],
  ['¿Llamo a Juan?', T('¿Llamo a Juan?', null)],
  ['2h', T('2h', null)],
  ['  ', null],
];
for (const [input, want] of cases) assert.deepEqual(p(input), want, input);
assert.equal(f(90), '1h30'); assert.equal(formatClock(645), '10:45');
assert.deepEqual(p(toQuickAddText({ title: 'Informe', minutes: 90, certainty: 'unsure' })), T('Informe', 90, null, 'unsure'));
// estimate
const e = P.estimate({ minutes: 60, certainty: 'normal' });
assert.equal(e.te, 67.5); assert.equal(e.o, 45); assert.equal(e.p, 120);
assert.ok(Math.abs(P.normalCdf(0) - 0.5) < 1e-7); assert.ok(Math.abs(P.normalCdf(1.96) - 0.975) < 1e-3);
// orden topológico: c depende de a; orden manual c(0) a(1) b(2) → a, c, b? (a es el menor disponible tras... )
const mk = (id, order, deps = [], extra = {}) => ({ id, title: id, order, minutes: 60, certainty: 'normal', dependencies: deps, done: false, block: 'am', ...extra });
const ord = P.orderBlock([mk('c', 0, ['a']), mk('a', 1), mk('b', 2)]).map((t) => t.id);
assert.deepEqual(ord, ['a', 'c', 'b']);
// schedule: 3 tareas de 60m normal en bloque de 5h desde el inicio
const range = { start: '08:00', end: '13:00' };
const s = P.scheduleBlock([mk('a', 0), mk('b', 1), mk('d', 2, [], { done: true })], range, null);
assert.equal(s.pendingCount, 2); assert.equal(s.mu, 135); assert.equal(s.items[0].start, 480); assert.equal(s.items[1].finish, 615);
assert.ok(s.probability > 0.99);
// sobrecargado: 5 × 60m → μ=337.5 > 300
const over = P.scheduleBlock([0,1,2,3,4].map((i) => mk('t'+i, i)), range, null);
assert.ok(over.probability < 0.2, over.probability); assert.ok(over.items[4].slack < 0);
// ya empezó: son las 12:00 → quedan 60m
const late = P.scheduleBlock([mk('a', 0)], range, 720);
assert.equal(late.remaining, 60); assert.ok(late.probability < 0.5);
// día pasado
assert.equal(P.scheduleBlock([mk('a', 0)], range, 1440).probability, 0);
// vacío
assert.equal(P.scheduleBlock([], range, null).probability, null);
// críticas, ciclos, reglas de bloque
const day = [mk('a', 0), mk('b', 1, ['a']), mk('c', 2, ['b'])];
assert.deepEqual([...P.criticalIds(day)].sort(), ['a', 'b']);
assert.equal(P.wouldCreateCycle(day, 'a', 'c'), true);
assert.equal(P.wouldCreateCycle(day, 'c', 'a'), false);
assert.equal(P.wouldCreateCycle(day, 'a', 'a'), true);
day[0].block = 'pm';
const moved = P.enforceBlockOrder(day);
assert.deepEqual(moved.map((m) => m.task.id), ['b', 'c']); assert.ok(day.every((t) => t.block === 'pm'));
// ----- Fase 3: épicas -----
const { slugify, tagKey } = await import(root + '/src/core/parser.js');
assert.deepEqual(p('Diseñar logo 2h #web'), T('Diseñar logo', 120, null, null, 'web'));
assert.deepEqual(p('Diseñar logo #web 2h ? pm'), T('Diseñar logo', 120, 'pm', 'unsure', 'web'));
assert.deepEqual(p('Arreglar issue #42'), T('Arreglar issue #42', null));
assert.deepEqual(p('#web'), T('#web', null));
assert.equal(slugify('Lanzar Web ¡ya!'), 'lanzar-web-ya'); assert.equal(slugify('Mudanza año'), 'mudanza-ano');
assert.equal(tagKey('lanzar-web'), tagKey('Lanzar web')); assert.equal(tagKey('LanzarWeb'), 'lanzarweb');
assert.deepEqual(p(toQuickAddText({ title: 'Logo', minutes: 60, certainty: 'normal' }, { name: 'Lanzar web' })), T('Logo', 60, null, null, 'lanzar-web'));
// canDepend / prune / blockers
const ep = (id, epic_id, date, extra = {}) => mk(id, 0, [], { epic_id, date, block: date ? 'am' : null, ...extra });
const x1 = ep('x1', 'e1', '2026-11-10'), x2 = ep('x2', 'e1', '2026-11-12'), x3 = ep('x3', 'e2', '2026-11-12'), x4 = ep('x4', null, '2026-11-10'), x5 = ep('x5', 'e1', null);
assert.equal(P.canDepend(x2, x1), true);   // misma épica, distinto día
assert.equal(P.canDepend(x3, x1), false);  // otra épica, otro día
assert.equal(P.canDepend(x4, x1), true);   // mismo día
assert.equal(P.canDepend(x5, x1), true);   // bandeja, misma épica
x3.dependencies = ['x1', 'x2', 'nope']; // x1 inválida (otra épica/otro día), x2 válida (mismo día), 'nope' rota
assert.equal(P.pruneInvalidDeps([x1, x2, x3]), 2); assert.deepEqual(x3.dependencies, ['x2']);
x2.dependencies = ['x1'];
const byId = new Map([x1, x2, x3, x5].map((t) => [t.id, t]));
assert.deepEqual(P.blockersOf(x2, byId).map((t) => t.id), ['x1']);
x1.done = true; assert.deepEqual(P.blockersOf(x2, byId), []);
// también bloquea una predecesora pendiente del mismo día
{ const a = mk('ba', 0), b = mk('bb', 1, ['ba']); const m = new Map([[a.id, a], [b.id, b]]);
  assert.deepEqual(P.blockersOf(b, m).map((t) => t.id), ['ba']); a.done = true; assert.deepEqual(P.blockersOf(b, m), []);
  assert.deepEqual(P.blockersOf({ ...b, done: true }, m), []); }
// epicForecast: 2 tareas pendientes de 4h normal (TE 4h30 c/u = 9h) con fecha objetivo mañana
const settings = { am: { start: '08:00', end: '13:00' }, pm: { start: '14:00', end: '19:00' } };
const now = new Date(2026, 10, 10, 7, 0); // 10 nov 07:00 → hoy completo + mañana = 4 bloques = 20h
const epic = { id: 'E', target_date: '2026-11-11' };
const et = [mk('p1', 0, [], { epic_id: 'E', minutes: 240, date: null }), mk('p2', 1, [], { epic_id: 'E', minutes: 240, date: null }), mk('p3', 2, [], { epic_id: 'E', done: true })];
let fc = P.epicForecast(epic, et, settings, now);
assert.equal(fc.total, 3); assert.equal(fc.doneCount, 1); assert.equal(fc.mu, 540); assert.equal(fc.capacity, 1200); assert.ok(fc.probability > 0.99);
assert.equal(fc.blocks, 540 / 300);
// otras épicas ocupan 3 bloques completos (5 × 60m normal = 337.5m > 300 → bloque lleno) → queda 1 bloque (5h) < 9h
const busy = [];
for (const [date, block] of [['2026-11-10', 'am'], ['2026-11-10', 'pm'], ['2026-11-11', 'am']])
  for (let i = 0; i < 5; i++) busy.push(mk(`b${date}${block}${i}`, i, [], { date, block, epic_id: 'OTRA' }));
fc = P.epicForecast(epic, [...et, ...busy], settings, now);
assert.equal(fc.capacity, 300); assert.ok(fc.probability < 0.01, fc.probability);
// fecha pasada
fc = P.epicForecast({ id: 'E', target_date: '2026-11-01' }, et, settings, now); assert.equal(fc.probability, 0);
// sin fecha
assert.equal(P.epicForecast({ id: 'E' }, et, settings, now).probability, null);
console.log('OK: parser + PERT + épicas');
// ----- Fase 4: sugerencias -----
{
  const range = { start: '08:00', end: '13:00' }, pmRange = { start: '14:00', end: '19:00' };
  const am = [mk('s1', 0, [], { minutes: 120 }), mk('s2', 1, [], { minutes: 120 }), mk('s3', 2, [], { minutes: 60 })]; // TE 5h37 > 5h
  const pm = [mk('s4', 0, [], { minutes: 60, block: 'pm' })];
  const sug = P.suggestMove({ tasks: am, range, nowMin: null }, [{ key: 'pm', tasks: pm, range: pmRange, nowMin: null }]);
  assert.ok(sug, 'debe sugerir algo');
  assert.ok(sug.sourceProbability >= 0.5 && sug.targetProbability >= 0.5 && sug.before < 0.5);
  // con s3 crítica y s1/s2 sin permiso de moverse → nada que sugerir
  const none = P.suggestMove({ tasks: am, range, nowMin: null }, [{ key: 'pm', tasks: pm, range: pmRange, nowMin: null }],
    { critical: new Set(['s3']), canMove: (t) => t.id === 's3' });
  assert.equal(none, null);
  // bloque sano → null
  assert.equal(P.suggestMove({ tasks: [am[2]], range, nowMin: null }, [{ tasks: pm, range: pmRange, nowMin: null }]), null);
  // destino lleno → null (no traslada el problema)
  const fullPm = [0, 1, 2, 3, 4].map((i) => mk('f' + i, i, [], { block: 'pm' }));
  assert.equal(P.suggestMove({ tasks: am, range, nowMin: null }, [{ tasks: fullPm, range: pmRange, nowMin: null }]), null);
  // bloque sin remedio (10h en 5h): mover 30m no se nota ("sube de 0% a 0%") → null
  const hopeless = [...Array(20)].map((_, i) => mk('h' + i, i, [], { minutes: 30 }));
  assert.equal(P.suggestMove({ tasks: hopeless, range, nowMin: null }, [{ tasks: [], range: pmRange, nowMin: null }]), null);
  console.log('OK: sugerencias');
}
// ----- Comentarios (markdown) y temporizador -----
{
  const { renderMarkdown: md } = await import(root + '/src/utils/markdown.js');
  const T = await import(root + '/src/core/timer.js');
  assert.equal(md('Hola **mundo** y *tú* y `x<y`'), '<p>Hola <strong>mundo</strong> y <em>tú</em> y <code>x&lt;y</code></p>');
  assert.equal(md('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>');
  assert.equal(md('[clic](javascript:alert(1))').includes('<a'), false, 'javascript: no debe ser enlace');
  assert.equal(md('[doc](https://a.com/x?a=1&b=2)'), '<p><a href="https://a.com/x?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">doc</a></p>');
  assert.ok(md('ver https://ejemplo.com.').includes('href="https://ejemplo.com"'));
  assert.equal(md('# Título'), '<h3>Título</h3>');
  assert.equal(md('- uno\n- dos'), '<ul><li>uno</li><li>dos</li></ul>');
  assert.equal(md('1. a\n2. b'), '<ol><li>a</li><li>b</li></ol>');
  assert.ok(md('- [x] hecho\n- [ ] falta').includes('<input type="checkbox" disabled checked> hecho'));
  assert.equal(md('```\n<b>hola</b>\n```'), '<pre><code>&lt;b&gt;hola&lt;/b&gt;</code></pre>');
  assert.equal(md('> cita'), '<blockquote><p>cita</p></blockquote>');
  assert.equal(md('línea 1\nlínea 2\n\notro'), '<p>línea 1<br>línea 2</p><p>otro</p>');
  assert.equal(md('snake_case_name'), '<p>snake_case_name</p>');
  assert.equal(md('"comillas" & <tags>'), '<p>&quot;comillas&quot; &amp; &lt;tags&gt;</p>');

  const t0 = Date.parse('2026-11-10T10:00:00Z');
  const task = { time_entries: [
    { start: '2026-11-10T10:00:00Z', end: '2026-11-10T10:10:00Z' },
    { start: '2026-11-10T10:20:00Z', end: null },
  ] };
  assert.equal(T.isRunning(task), true);
  assert.equal(T.trackedMs(task, t0 + 25 * 60000), 15 * 60000);
  assert.equal(T.isRunning({ time_entries: [] }), false);
  assert.equal(T.formatStopwatch(754000), '12:34'); assert.equal(T.formatStopwatch(3723000), '1:02:03');
  assert.equal(T.formatTracked(30000), '<1m'); assert.equal(T.formatTracked(65 * 60000), '1h05');
  console.log('OK: markdown + temporizador');
}
// ----- Cuenta atrás -----
{
  const T = await import(root + '/src/core/timer.js');
  const start = Date.parse('2026-11-10T10:00:00Z');
  const t = { minutes: 30, time_entries: [{ start: '2026-11-10T10:00:00Z', end: null }] };
  assert.equal(T.remainingMs(t, start + 6000), 30 * 60000 - 6000);
  assert.equal(T.formatCountdown(T.remainingMs(t, start)), '30:00');
  assert.equal(T.formatCountdown(T.remainingMs(t, start + 6000)), '29:54');
  assert.equal(T.formatCountdown(T.remainingMs(t, start + 30 * 60000)), '+00:00');
  assert.equal(T.formatCountdown(T.remainingMs(t, start + 31 * 60000 + 12000)), '+01:12');
  assert.equal(T.zeroAt(t, start + 6000), start + 30 * 60000);
  assert.equal(T.zeroAt(t, start + 31 * 60000), null, 'ya pasó: no hay alarma pendiente');
  assert.equal(T.zeroAt({ ...t, time_entries: [{ start: '2026-11-10T10:00:00Z', end: '2026-11-10T10:05:00Z' }] }, start), null, 'en pausa: sin alarma');
  // pausado 5 min y reanudado: el cero se corre
  const p = { minutes: 30, time_entries: [{ start: '2026-11-10T10:00:00Z', end: '2026-11-10T10:10:00Z' }, { start: '2026-11-10T10:15:00Z', end: null }] };
  assert.equal(T.zeroAt(p, start + 16 * 60000), start + 35 * 60000);
  assert.equal(T.formatLeft(12.3 * 60000), '13m'); assert.equal(T.formatLeft(30000), '<1m'); assert.equal(T.formatLeft(65 * 60000), '1h05');
  console.log('OK: cuenta atrás');
}
// ----- Sonido Casio (con un AudioContext simulado que registra lo programado) -----
{
  const { scheduleCasio } = await import(root + '/src/services/casio.js');
  const beeps = [];
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {} });
  const node = () => ({ gain: param(), connect(n) { return n; } });
  const ctx = {
    currentTime: 0, destination: {},
    createGain: node,
    createOscillator: () => {
      const o = { type: '', frequency: param(), connect(n) { return n; }, start(t) { beeps.push({ t, type: o.type, f: o.frequency.value }); }, stop() {} };
      return o;
    },
  };
  const dur = scheduleCasio(ctx, 0);
  assert.equal(beeps.length, 8, '2 rondas × 4 bips');
  assert.ok(beeps.every((b) => b.type === 'square' && b.f === 4096));
  const gaps = beeps.slice(1).map((b, i) => +(b.t - beeps[i].t).toFixed(3));
  assert.deepEqual(gaps, [0.13, 0.13, 0.13, 0.58, 0.13, 0.13, 0.13], 'bip-bip-bip-bip … bip-bip-bip-bip');
  assert.ok(dur > 1.4 && dur < 1.6, `duración ${dur}`);
  console.log(`OK: sonido Casio (8 bips cuadrados a 4096 Hz, ${dur.toFixed(2)} s)`);
}
// ----- Documentación: barra de formato y extracto -----
{
  const { applyFormat: F } = await import(root + '/src/utils/md-format.js');
  const { renderMarkdown: md, markdownExcerpt: ex } = await import(root + '/src/utils/markdown.js');
  const sel = (r) => r.text.slice(r.start, r.end);
  // Títulos: sobre la línea actual, reemplazan el prefijo previo y alternan
  let r = F('hola\nmundo', 7, 7, 'h2'); assert.equal(r.text, 'hola\n## mundo');
  r = F('# hola', 3, 3, 'h2'); assert.equal(r.text, '## hola');
  r = F('## hola', 3, 3, 'h2'); assert.equal(r.text, 'hola', 'mismo título = quitar');
  r = F('a\nb\nc', 0, 3, 'ul'); assert.equal(r.text, '- a\n- b\nc');
  r = F('- a', 0, 3, 'task'); assert.equal(r.text, '- [ ] a');
  // Enlaces
  r = F('ver docs', 4, 8, 'link'); assert.equal(r.text, 'ver [docs](https://)'); assert.equal(sel(r), 'https://');
  r = F('', 0, 0, 'link'); assert.equal(r.text, '[texto](https://)'); assert.equal(sel(r), 'texto');
  r = F('https://a.com', 0, 13, 'link'); assert.equal(r.text, '[texto](https://a.com)'); assert.equal(sel(r), 'texto');
  // Bloque de código: en líneas propias
  r = F('antes', 5, 5, 'codeblock'); assert.equal(r.text, 'antes\n```\n\n```');
  r = F('x = 1', 0, 5, 'codeblock'); assert.equal(r.text, '```\nx = 1\n```'); assert.equal(sel(r), 'x = 1');
  // Envolver y desenvolver
  r = F('hola', 0, 4, 'bold'); assert.equal(r.text, '**hola**'); assert.equal(sel(r), 'hola');
  r = F(r.text, r.start, r.end, 'bold'); assert.equal(r.text, 'hola');
  r = F('', 0, 0, 'code'); assert.equal(r.text, '`código`'); assert.equal(sel(r), 'código');
  // Títulos grandes en el documento
  assert.equal(md('# Doc', { headingBase: 1 }), '<h1>Doc</h1>'); assert.equal(md('# Doc'), '<h3>Doc</h3>');
  // Extracto
  assert.equal(ex('# Resumen\n\nEl **cliente** quiere [ver](https://a.com) el `informe`.\n\n```js\nx()\n```\n- [x] listo'), 'Resumen El cliente quiere ver el informe. listo');
  assert.equal(ex('a '.repeat(200), 20).length <= 20, true);
  assert.equal(ex(''), '');
  console.log('OK: documentación (barra de formato + extracto)');
}
// ----- Reuniones -----
{
  const range = { start: '08:00', end: '13:00' };
  const meet = (id, start, end, blocking = true, extra = {}) =>
    mk(id, 0, [], { meeting: { start, end, blocking }, certainty: 'fixed', ...extra });
  const sure = (id, order, minutes, extra = {}) => mk(id, order, [], { minutes, certainty: 'fixed', ...extra });
  // advance: 2h desde las 9:00 con reunión 10-11 → termina 12:00
  assert.equal(P.advance(540, 120, [{ start: 600, end: 660 }]), 720);
  assert.equal(P.advance(610, 30, [{ start: 600, end: 660 }]), 690, 'si empieza dentro de la reunión, arranca al terminar');
  // Bloque 8-13 con reunión 10-11 que bloquea: capacidad restante 4h
  let s = P.scheduleBlock([sure('a', 0, 120), meet('m', '10:00', '11:00'), sure('b', 1, 60)], range, null);
  assert.equal(s.remaining, 240); assert.equal(s.meetingMinutes, 60);
  assert.deepEqual(s.items.map((i) => i.task.id), ['a', 'm', 'b'], 'la reunión se ve en su horario');
  assert.equal(s.items[2].start, 660, 'b empieza al terminar la reunión');
  assert.equal(s.items[2].finish, 720);
  assert.equal(s.mu, 180, 'la reunión no suma al trabajo pendiente'); assert.equal(s.probability, 1);
  // Tarea que cruza la reunión: se pausa y sigue
  s = P.scheduleBlock([sure('a', 0, 180), meet('m', '10:00', '11:00')], range, null);
  assert.equal(s.items.find((i) => i.task.id === 'a').finish, 720);
  // No bloquea: no quita capacidad ni mueve tareas
  s = P.scheduleBlock([sure('a', 0, 180), meet('m', '10:00', '11:00', false)], range, null);
  assert.equal(s.remaining, 300); assert.equal(s.items.find((i) => i.task.id === 'a').finish, 660); assert.equal(s.meetingMinutes, 0);
  // Reunión que bloquea deja el bloque sin espacio → probabilidad baja
  s = P.scheduleBlock([sure('a', 0, 240), meet('m', '09:00', '11:00')], range, null);
  assert.equal(s.remaining, 180); assert.equal(s.probability, 0);
  // Ya pasada (son las 11:30): no descuenta
  s = P.scheduleBlock([sure('a', 0, 60), meet('m', '09:00', '10:00')], range, 690);
  assert.equal(s.remaining, 90);
  // Hecha: no bloquea
  s = P.scheduleBlock([sure('a', 0, 60), meet('m', '08:00', '12:00', true, { done: true })], range, null);
  assert.equal(s.remaining, 300);
  // Depender de una reunión: empieza cuando termina
  s = P.scheduleBlock([meet('m', '09:00', '10:00', false), mk('a', 0, ['m'], { minutes: 30, certainty: 'fixed' })], range, null);
  assert.equal(s.items.find((i) => i.task.id === 'a').start, 600);
  // Reuniones nunca se mueven ni se sugieren
  const day = [meet('m', '10:00', '11:00', true, { block: 'am', dependencies: ['x'] }), mk('x', 0, [], { block: 'pm' })];
  assert.equal(P.enforceBlockOrder(day).length, 0); assert.equal(day[0].block, 'am');
  assert.equal(P.blockForTime('12:30', { am: { end: '13:00' } }), 'am'); assert.equal(P.blockForTime('13:30', { am: { end: '13:00' } }), 'pm');
  console.log('OK: reuniones (bloqueo, pausa de tareas, orden por horario)');
}
// ----- Reloj de pruebas: mediodía de hoy -----
// Las pruebas del service worker crean reuniones reales "de hace 1 min a dentro de 59 min". Cerca de la
// medianoche cruzarían al día siguiente (fin antes del inicio), así que desde aquí el reloj marca las
// 12:00 de hoy y sigue avanzando en tiempo real. Es el mismo día: las pruebas de fechas no cambian.
{
  const RealDate = Date;
  const noon = new RealDate();
  noon.setHours(12, 0, 0, 0);
  const offset = noon.getTime() - RealDate.now();
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [RealDate.now() + offset]));
    }

    static now() {
      return RealDate.now() + offset;
    }
  };
}
// ----- Service worker: reuniones que empiezan (con la API de Chrome simulada) -----
{
  const { toISO } = await import(root + '/src/utils/dates.js');
  const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const now = new Date();
  const startD = new Date(now.getTime() - 60 * 1000); // empezó hace 1 min
  const endD = new Date(now.getTime() + 59 * 60 * 1000);
  const today = toISO(startD);
  const base = { minutes: 60, certainty: 'fixed', dependencies: [], done: false, block: 'am', order: 0, comments: [] };
  const mem = {
    settings: {},
    tasks: [
      { ...base, id: 'w', title: 'Trabajo', date: today, meeting: null, certainty: 'normal', time_entries: [{ start: new Date(now - 600000).toISOString(), end: null }] },
      { ...base, id: 'm', title: 'Daily', date: today, meeting: { start: hhmm(startD), end: hhmm(endD), blocking: true }, time_entries: [] },
      { ...base, id: 'p', title: 'Webinar', date: today, meeting: { start: hhmm(startD), end: hhmm(endD), blocking: false }, time_entries: [] },
    ],
  };
  const L = {};
  // Varios módulos pueden escuchar lo mismo (el store también escucha storage): L[name] los llama a todos
  const on = (name) => ({ addListener: (fn) => {
    const prev = L[name];
    L[name] = prev ? (...a) => { prev(...a); return fn(...a); } : fn;
  } });
  const alarms = {};
  const notes = [];
  globalThis.chrome = {
    storage: {
      local: {
        get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => k in mem).map((k) => [k, structuredClone(mem[k])])),
        set: async (obj) => { Object.assign(mem, structuredClone(obj)); },
      },
      onChanged: on('storage'),
    },
    alarms: { create: (n, o) => { alarms[n] = o; }, clear: async (n) => { delete alarms[n]; }, getAll: async () => Object.keys(alarms).map((name) => ({ name })), onAlarm: on('alarm') },
    notifications: { create: (id, o) => notes.push(o), clear() {}, onClicked: on('notif') },
    runtime: { onInstalled: on('installed'), onStartup: on('startup'), onMessage: on('message'), sendMessage() {} },
    sidePanel: { setPanelBehavior: async () => {}, open: async () => {} },
    offscreen: { hasDocument: async () => false, createDocument: async () => {}, closeDocument: async () => {} },
    windows: { getLastFocused: async () => ({ id: 1 }) },
    permissions: { contains: async () => perms.granted, onAdded: on('permAdded'), onRemoved: on('permRemoved') },
    scripting: {
      getRegisteredContentScripts: async ({ ids }) => scripts.filter((x) => ids.includes(x.id)),
      registerContentScripts: async (list) => { scripts.push(...list); },
      unregisterContentScripts: async ({ ids }) => { scripts.splice(0, scripts.length, ...scripts.filter((x) => !ids.includes(x.id))); },
      executeScript: async (o) => { injected.push(o.target.tabId); },
    },
    tabs: { query: async () => [{ id: 7 }, { id: 8 }], create() {} },
  };
  const perms = { granted: false };
  const scripts = [];
  const injected = [];
  await import(root + '/src/background/background.js');
  globalThis.__bg = { mem, L, perms, scripts, injected }; // para pruebas posteriores del service worker
  const running = (id) => { const e = mem.tasks.find((t) => t.id === id).time_entries; return e.length > 0 && !e.at(-1).end; };

  await L.alarm({ name: 'meeting-start', scheduledTime: Date.now() });
  assert.equal(running('m'), true, 'la reunión que bloquea inicia su temporizador');
  assert.equal(running('w'), false, 'y pausa la tarea que corría');
  assert.equal(running('p'), false, 'la paralela no se inicia sola');
  assert.equal(notes.length, 2, 'aviso de ambas reuniones');
  assert.ok(notes[0].message.includes('ya está corriendo'));
  // ▶ del botón celeste en la paralela mientras corre la reunión que bloquea → rechazado
  L.message({ type: 'cabetodo-start-timer', taskId: 'p' }, {});
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(running('p'), false, 'durante una reunión que bloquea no se inicia otra cosa');
  assert.equal(running('m'), true, 'la reunión sigue corriendo');
  // Programar la próxima reunión futura
  const future = new Date(now.getTime() + 2 * 3600 * 1000);
  if (toISO(future) === today) {
    mem.tasks.push({ ...base, id: 'f', title: 'Futura', date: today, meeting: { start: hhmm(future), end: hhmm(new Date(future.getTime() + 1800000)), blocking: true }, time_entries: [] });
    L.storage({ tasks: { newValue: mem.tasks } }, 'local');
    await new Promise((r) => setTimeout(r, 20));
    const [h, mi] = hhmm(future).split(':').map(Number);
    const expected = new Date(future); expected.setHours(h, mi, 0, 0);
    assert.equal(alarms['meeting-start']?.when, expected.getTime(), 'alarma a la hora de la próxima reunión');
  }
  // Alarma atrasada (o Chrome abierto en medio de la reunión): la tarea se pausa en la HORA DE INICIO
  const meetStart = new Date(startD); meetStart.setSeconds(0, 0);
  mem.tasks.find((t) => t.id === 'm').time_entries = [];
  mem.tasks.find((t) => t.id === 'w').time_entries = [{ start: new Date(now - 30 * 60000).toISOString(), end: null }];
  await L.alarm({ name: 'meeting-start', scheduledTime: Date.now() });
  const w = mem.tasks.find((t) => t.id === 'w').time_entries.at(-1);
  const m = mem.tasks.find((t) => t.id === 'm').time_entries.at(-1);
  assert.equal(Date.parse(w.end), meetStart.getTime(), 'la tarea se pausa justo cuando empezó la reunión');
  assert.equal(Date.parse(m.start), meetStart.getTime(), 'la reunión cuenta desde su inicio');
  assert.equal(running('m'), true);
  // Si la persona pausa la reunión a mano, no se vuelve a iniciar sola
  mem.tasks.find((t) => t.id === 'm').time_entries.at(-1).end = new Date().toISOString();
  await L.alarm({ name: 'meeting-start', scheduledTime: Date.now() });
  assert.equal(running('m'), false, 'respeta la pausa manual');
  console.log('OK: service worker (reuniones que empiezan, ▶ desde el botón, próxima alarma, pausa a la hora exacta)');
}
// ----- Reunión que bloquea en curso: quién puede iniciar su temporizador -----
{
  const at = new Date(2026, 10, 11, 15, 30); // 11 nov 15:30
  const m = (id, start, end, blocking = true, extra = {}) => ({ id, date: '2026-11-11', done: false, meeting: { start, end, blocking }, ...extra });
  const tasks = [m('daily', '15:00', '16:00'), m('web', '15:00', '17:00', false), { id: 't', date: '2026-11-11', meeting: null }];
  assert.equal(P.activeBlockingMeeting(tasks, at).id, 'daily');
  assert.equal(P.timerBlockedBy(tasks[2], tasks, at).id, 'daily', 'una tarea no puede iniciar');
  assert.equal(P.timerBlockedBy(tasks[1], tasks, at).id, 'daily', 'una reunión paralela tampoco');
  assert.equal(P.timerBlockedBy(tasks[0], tasks, at), null, 'la reunión en curso sí');
  assert.equal(P.timerBlockedBy(tasks[2], tasks, new Date(2026, 10, 11, 16, 0)), null, 'al terminar se libera');
  assert.equal(P.timerBlockedBy(tasks[2], [m('daily', '15:00', '16:00', true, { done: true })], at), null, 'marcada hecha: libera');
  assert.equal(P.timerBlockedBy(tasks[2], [m('mañana', '15:00', '16:00', true, { date: '2026-11-12' })], at), null, 'otro día: no bloquea');
  console.log('OK: reunión que bloquea en curso');
}
// ----- Las reuniones no se pausan: solo se finalizan o se reprograman -----
{
  const T = await import(root + '/src/core/timer.js');
  const run = (id, extra = {}) => ({ id, meeting: null, time_entries: [{ start: '2026-11-10T10:00:00Z', end: null }], ...extra });
  const idle = (id, extra = {}) => ({ id, meeting: null, time_entries: [], ...extra });
  const blockingM = { start: '10:00', end: '11:00', blocking: true };
  const parallelM = { start: '10:00', end: '11:00', blocking: false };
  // Tarea normal corriendo → se pausa al iniciar otra
  assert.deepEqual(T.timerConflicts(idle('b'), [run('a'), idle('b')]).pause.map((t) => t.id), ['a']);
  // Reunión paralela corriendo → sigue corriendo junto a la tarea
  assert.deepEqual(T.timerConflicts(idle('b'), [run('m', { meeting: parallelM }), idle('b')]).pause, []);
  // Reunión que bloquea corriendo (aunque ya pasó su hora) → hay que finalizarla
  assert.equal(T.timerConflicts(idle('b'), [run('m', { meeting: blockingM }), idle('b')]).blockedBy.id, 'm');
  // Iniciar una reunión paralela no pausa la tarea en curso
  assert.deepEqual(T.timerConflicts(idle('p', { meeting: parallelM }), [run('a'), idle('p', { meeting: parallelM })]).pause, []);
  // Iniciar una reunión que bloquea pausa la tarea pero no una reunión paralela
  assert.deepEqual(T.timerConflicts(idle('m', { meeting: blockingM }), [run('a'), run('p', { meeting: parallelM }), idle('m', { meeting: blockingM })]).pause.map((t) => t.id), ['a']);

  // Store (usa la API de Chrome simulada de la prueba anterior para guardar)
  const S = await import(root + '/src/services/store.js');
  const { toISO } = await import(root + '/src/utils/dates.js');
  const notes = []; S.setNotifier((m) => notes.push(m));
  const tomorrow = toISO(new Date(Date.now() + 86400000));
  S.state.settings = { am: { start: '08:00', end: '13:00' }, pm: { start: '14:00', end: '19:00' }, default_minutes: 30 };
  const task = (id, extra = {}) => ({ id, title: id, date: tomorrow, block: 'am', order: 0, minutes: 30, certainty: 'normal', dependencies: [], done: false, time_entries: [], comments: [], meeting: null, epic_id: null, ...extra });
  S.state.tasks = [task('m', { meeting: { start: '09:00', end: '10:00', blocking: false }, certainty: 'fixed', minutes: 60 }), task('a')];
  const isRun = (id) => T.isRunning(S.findTask(id));
  S.startTimer('m'); S.startTimer('a');
  assert.equal(isRun('m') && isRun('a'), true, 'reunión paralela + tarea corren a la vez');
  S.pauseTimer('m');
  assert.equal(isRun('m'), true, 'la reunión no se pausa'); assert.match(notes.at(-1), /no se pausan/);
  S.toggleTimer('m'); assert.equal(isRun('m'), true, 'tampoco con el chip/alternar');
  // Reprogramar (cambia la hora de inicio) detiene su temporizador
  assert.equal(S.setMeeting('m', { date: tomorrow, start: '11:00', end: '12:00', blocking: false }), null);
  assert.equal(isRun('m'), false, 'reprogramar detiene la reunión'); assert.equal(isRun('a'), true, 'la tarea sigue');
  // Reunión que bloquea corriendo fuera de su horario → no se puede iniciar otra cosa hasta finalizarla
  S.state.tasks.push(task('b'));
  S.setMeeting('m', { date: tomorrow, start: '11:00', end: '12:00', blocking: true });
  S.startTimer('m');
  assert.equal(isRun('a'), false, 'iniciar la reunión que bloquea pausa la tarea');
  S.startTimer('b'); assert.equal(isRun('b'), false); assert.match(notes.at(-1), /finalízala/);
  S.finishMeeting('m');
  assert.equal(S.findTask('m').done, true); assert.equal(isRun('m'), false, 'finalizar la detiene y la marca hecha');
  S.startTimer('b'); assert.equal(isRun('b'), true, 'después de finalizar ya se puede');

  // Service worker: ❚❚ del botón flotante no pausa reuniones; ■ las finaliza
  const { mem, L } = globalThis.__bg;
  mem.tasks = structuredClone(S.state.tasks);
  mem.tasks.find((t) => t.id === 'm').done = false;
  mem.tasks.find((t) => t.id === 'm').time_entries.push({ start: new Date().toISOString(), end: null });
  L.message({ type: 'cabetodo-pause-timer' }, {});
  await new Promise((r) => setTimeout(r, 20));
  const runM = (id) => { const e = mem.tasks.find((t) => t.id === id).time_entries; return e.length > 0 && !e.at(-1).end; };
  assert.equal(runM('m'), true, '❚❚ no pausa la reunión'); assert.equal(runM('b'), false, '❚❚ sí pausa la tarea');
  L.message({ type: 'cabetodo-finish-meeting', taskId: 'm' }, {});
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(runM('m'), false); assert.equal(mem.tasks.find((t) => t.id === 'm').done, true, '■ finaliza la reunión');
  console.log('OK: reuniones no se pausan (finalizar / reprogramar, paralela junto a una tarea)');
}

// ---------- Calibración (real vs estimado) ----------
{
  const P = await import('../src/core/pert.js');
  const now = Date.parse('2026-11-11T18:00:00Z');
  const doneT = (min, real, daysAgo = 1, extra = {}) => ({
    minutes: min, done: true, done_at: new Date(now - daysAgo * 86400000).toISOString(), meeting: null,
    time_entries: [{ start: new Date(now - daysAgo * 86400000 - real * 60000).toISOString(), end: new Date(now - daysAgo * 86400000).toISOString() }],
    ...extra,
  });
  // Pocas muestras: sin ajuste
  assert.deepEqual(P.calibrationFrom([doneT(30, 60), doneT(30, 60)], now), { factor: 1, samples: 2 });
  // 10 tareas que tardan el doble → factor < 2 (acercado a 1) pero claramente > 1
  const slow = Array.from({ length: 10 }, () => doneT(30, 60));
  const c = P.calibrationFrom(slow, now);
  assert.equal(c.samples, 10);
  assert.ok(c.factor > 1.4 && c.factor < 2, `factor ${c.factor}`);
  // Se ignoran: reuniones, sin tiempo, pendientes y viejas (> 60 días)
  const noise = [doneT(30, 60, 1, { meeting: { start: '10:00', end: '11:00' } }), doneT(30, 0), { ...doneT(30, 60), done: false }, doneT(30, 60, 90)];
  assert.equal(P.calibrationFrom(noise, now).samples, 0);
  // Rápido → factor < 1
  assert.ok(P.calibrationFrom(Array.from({ length: 10 }, () => doneT(60, 30)), now).factor < 0.8);
  // El factor se aplica a las estimaciones (no a reuniones) y se puede quitar
  P.setCalibration(1.5);
  assert.equal(P.estimate({ minutes: 60, certainty: 'sure' }).m, 90);
  assert.equal(P.estimate({ minutes: 60, certainty: 'fixed', meeting: { start: '10:00', end: '11:00' } }).m, 60);
  const s15 = P.scheduleBlock([{ id: 'a', minutes: 60, certainty: 'sure', dependencies: [], order: 0, done: false }], { start: '09:00', end: '13:00' }, null);
  P.setCalibration(1);
  const s10 = P.scheduleBlock([{ id: 'a', minutes: 60, certainty: 'sure', dependencies: [], order: 0, done: false }], { start: '09:00', end: '13:00' }, null);
  assert.ok(s15.mu > s10.mu * 1.4);
  console.log('OK: calibración (aprende de real vs estimado)');
}

// ---------- Reunión que termina sola a su hora ----------
{
  const { mem, L } = globalThis.__bg;
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = new Date();
  const start = new Date(now.getTime() - 40 * 60000); start.setSeconds(0, 0);
  const end = new Date(now.getTime() - 5 * 60000); end.setSeconds(0, 0); // terminó hace ~5 min (alarma atrasada)
  if (start.getDate() === now.getDate()) {
    const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    mem.tasks = [
      { id: 'x', title: 'Planificación', date: day, block: 'am', order: 0, minutes: 35, certainty: 'fixed', dependencies: [], done: false, comments: [],
        meeting: { start: hm(start), end: hm(end), blocking: true }, time_entries: [{ start: start.toISOString(), end: null }] },
      { id: 'y', title: 'Sin iniciar', date: day, block: 'am', order: 1, minutes: 35, certainty: 'fixed', dependencies: [], done: false, comments: [],
        meeting: { start: hm(start), end: hm(end), blocking: false }, time_entries: [] },
    ];
    await L.alarm({ name: 'meeting-end', scheduledTime: Date.now() });
    const x = mem.tasks.find((t) => t.id === 'x');
    assert.equal(x.done, true, 'la reunión en curso queda hecha');
    assert.equal(Date.parse(x.time_entries.at(-1).end), end.getTime(), 'su tiempo se cierra a la hora exacta de fin');
    assert.equal(mem.tasks.find((t) => t.id === 'y').done, false, 'una reunión que no se inició no se toca');
  }
  console.log('OK: reunión que termina sola a su hora');
}

// ---------- Respaldo (exportar / importar) ----------
{
  const S = await import('../src/services/storage.js');
  const tasks = [{ id: 't1', title: 'Uno', minutes: 30, date: null, block: null, done: false, dependencies: [] }];
  const epics = [{ id: 'e1', name: 'Web', color: '#123456' }];
  const text = JSON.stringify(S.makeBackup({ tasks, epics, settings: { default_minutes: 45 } }));
  const back = S.parseBackup(text);
  assert.equal(back.tasks[0].title, 'Uno');
  assert.deepEqual(back.tasks[0].comments, [], 'se normalizan las tareas');
  assert.equal(back.epics[0].color, S.PALETTE[0], 'colores viejos pasan a la paleta');
  assert.equal(back.settings.default_minutes, 45);
  assert.equal(back.settings.blocks[0].start, '08:00', 'ajustes faltantes toman su valor por defecto');
  assert.throws(() => S.parseBackup('no es json'), /JSON válido/);
  assert.throws(() => S.parseBackup('{"tasks":[],"epics":[]}'), /no es un respaldo/);
  assert.throws(() => S.parseBackup(JSON.stringify({ app: 'cabe-todo', tasks: [{ id: 1 }], epics: [] })), /dañadas/);
  // respaldos de cuando se llamaba Pert-day siguen sirviendo
  assert.equal(S.parseBackup(JSON.stringify({ app: 'pert-day', tasks: [], epics: [] })).tasks.length, 0);
  console.log('OK: respaldo (exportar / importar)');
}

// ---------- Rutinas (tareas que se repiten) ----------
{
  const { parseQuickAdd } = await import('../src/core/parser.js');
  const R = await import('../src/core/routines.js');
  assert.deepEqual(parseQuickAdd('Standup 15m am cada día').repeat, [1, 2, 3, 4, 5, 6, 0]);
  assert.deepEqual(parseQuickAdd('Pagar 10m días hábiles ?').repeat, [1, 2, 3, 4, 5]);
  assert.equal(parseQuickAdd('Pagar 10m días hábiles ?').title, 'Pagar');
  assert.deepEqual(parseQuickAdd('Gym 1h pm cada lun,jue #salud').repeat, [1, 4]);
  assert.equal(parseQuickAdd('Informe diario').repeat, null, '"diario" es parte del título');
  assert.equal(parseQuickAdd('cada lunes').title, 'cada lunes', 'sin título no hay repetición');
  assert.equal(R.repeatLabel([1, 2, 3, 4, 5]), 'días hábiles');
  assert.equal(R.repeatLabel([4, 1]), 'lunes y jueves');

  // 2026-11-16 es lunes
  let n = 0;
  const opts = { newId: () => `x${n++}`, orderFor: () => 0 };
  const r = R.routineFrom({ title: 'Daily', minutes: 15, certainty: 'fixed', block: 'am', meeting: { start: '09:00', end: '09:15', blocking: true }, date: '2026-11-16' },
    { id: 'r1', days: [1, 2, 3, 4, 5], startDate: '2026-11-16' });
  assert.deepEqual(R.dueInstances([r], '2026-11-16', opts).tasks, [], 'el día en que se creó ya tiene su tarea');
  const tue = R.dueInstances([r], '2026-11-17', opts);
  assert.equal(tue.tasks.length, 1);
  assert.equal(tue.tasks[0].routine_id, 'r1');
  assert.deepEqual(tue.tasks[0].meeting, { start: '09:00', end: '09:15', blocking: true }, 'copia el horario de la reunión');
  assert.equal(R.dueInstances(tue.routines, '2026-11-17', opts).tasks.length, 0, 'no se duplica (aunque se mueva o borre)');
  assert.equal(R.dueInstances([r], '2026-11-21', opts).tasks.length, 0, 'sábado: no toca');
  assert.equal(R.dueInstances([r], '2026-11-13', opts).tasks.length, 0, 'antes de empezar: no');
  console.log('OK: rutinas (cada día / hábiles / cada lun,jue)');
}

// ---------- Bloques personalizables ----------
{
  const B = await import(root + '/src/core/blocks.js');
  const P = await import(root + '/src/core/pert.js');
  const { parseQuickAdd } = await import(root + '/src/core/parser.js');
  const S = await import(root + '/src/services/storage.js');
  const b = (id, title, start, end, icon = '●') => ({ id, title, icon, start, end });
  const three = { blocks: [b('am', 'Mañana', '08:00', '12:00'), b('x', 'Almuerzo', '12:00', '13:00'), b('pm', 'Tarde', '14:00', '18:00')] };

  // migración del formato antiguo { am, pm }
  const old = B.migrateBlocks({ am: { start: '07:00', end: '12:00' }, pm: { start: '13:00', end: '17:00' }, notify: true });
  assert.deepEqual(old.blocks.map((x) => [x.id, x.title, x.start, x.end]), [['am', 'Mañana', '07:00', '12:00'], ['pm', 'Tarde', '13:00', '17:00']]);
  assert.ok(!('am' in old) && old.notify === true, 'sin claves viejas, conserva el resto');
  assert.equal(S.parseBackup(JSON.stringify({ app: 'pert-day', tasks: [], epics: [], settings: { am: { start: '09:00', end: '12:00' } } })).settings.blocks[0].start, '09:00');

  // validación: superposición, máximo, títulos, horas
  assert.equal(B.validateBlocks(three.blocks), null);
  assert.match(B.validateBlocks([b('a', 'A', '08:00', '12:00'), b('b', 'B', '11:30', '13:00')]), /"A" \(08:00–12:00\) y "B" \(11:30–13:00\) se superponen/);
  assert.equal(B.validateBlocks([b('a', 'A', '08:00', '12:00'), b('b', 'B', '12:00', '13:00')]), null, 'pegados sí se puede');
  assert.match(B.validateBlocks([1, 2, 3, 4, 5, 6].map((i) => b('b' + i, 'B' + i, `0${i}:00`, `0${i}:30`))), /hasta 5/);
  assert.match(B.validateBlocks([]), /al menos un bloque/);
  assert.match(B.validateBlocks([b('a', '  ', '08:00', '09:00')]), /título/);
  assert.match(B.validateBlocks([b('a', 'A', '10:00', '09:00')]), /terminar después/);
  assert.match(B.validateBlocks([b('a', 'Foco', '08:00', '09:00'), b('b', 'foco', '10:00', '11:00')]), /dos bloques/);

  // hora → bloque; bloque en curso; orden por hora aunque se guarden desordenados
  assert.equal(B.blockForTime('12:30', three), 'x');
  assert.equal(B.blockForTime('13:30', three), 'pm', 'entre bloques: el siguiente');
  assert.equal(B.blockForTime('22:00', three), 'pm', 'después del último: el último');
  assert.equal(P.currentBlock(three, new Date(2026, 0, 5, 12, 10)), 'x');
  assert.deepEqual(B.blocksOf({ blocks: [three.blocks[2], three.blocks[0]] }).map((x) => x.id), ['am', 'pm']);
  assert.deepEqual(B.blocksAfter(three, 'am').map((x) => x.id), ['x', 'pm']);
  assert.equal(B.neighborBlock(three.blocks, 'x', [three.blocks[0], three.blocks[2]]), 'am', 'al borrar: el anterior');
  assert.equal(B.neighborBlock(three.blocks, 'am', three.blocks.slice(1)), 'x', 'si era el primero: el siguiente');
  assert.deepEqual(B.nextFreeRange(three.blocks), { start: '18:00', end: '19:00' });
  assert.deepEqual(B.nextFreeRange([b('a', 'A', '08:00', '23:59')]), { start: '00:00', end: '01:00' }, 'antes del primero');
  assert.deepEqual(B.nextFreeRange([b('a', 'A', '00:00', '12:00'), b('b', 'B', '12:30', '23:59')]), { start: '12:00', end: '12:30' }, 'hueco entre bloques');
  assert.equal(B.nextFreeRange([b('a', 'A', '00:00', '12:00'), b('b', 'B', '12:10', '23:59')]), null, 'sin huecos de 15 min');

  // quick-add: @bloque por título y palabras de siempre
  const w = B.blockWords({ blocks: [...three.blocks, b('g', 'Deep work', '19:00', '21:00')] });
  assert.equal(parseQuickAdd('Comer 30m @almuerzo', w).block, 'x');
  assert.equal(parseQuickAdd('Leer 1h @deep', w).block, 'g');
  assert.equal(parseQuickAdd('Leer 1h @DeepWork', w).block, 'g');
  assert.equal(parseQuickAdd('Llamar a Juan pm', w).block, 'pm');
  assert.equal(parseQuickAdd('Ir al almuerzo', w).block, null, '"al almuerzo" es parte del título');
  assert.equal(parseQuickAdd('Comer 30m almuerzo', w).block, 'x', 'el nombre del bloque al final, como am/pm');
  assert.deepEqual([parseQuickAdd('Leer paper deep work 1h', w).block, parseQuickAdd('Leer paper deep work 1h', w).title], ['g', 'Leer paper'], 'título de varias palabras');
  assert.equal(parseQuickAdd('Leer deep', w).block, null, 'sin @, solo el título completo');
  assert.equal(parseQuickAdd('Almuerzo', w).block, null, 'tiene que quedar título');
  assert.equal(parseQuickAdd('Entrenar Almuerzo cada día', w).block, 'x');
  // "bl" = backlog
  assert.deepEqual([parseQuickAdd('Ideas charla 1h bl', w).block, parseQuickAdd('Ideas charla 1h bl', w).title], ['backlog', 'Ideas charla']);
  assert.equal(parseQuickAdd('Ideas BL #web ?', w).block, 'backlog');
  assert.equal(parseQuickAdd('bl', w).title, 'bl', 'solo "bl": es el título');
  assert.equal(parseQuickAdd('Revisar tabla', w).block, null);
  assert.equal(parseQuickAdd('Ver @nada 1h', w).title, 'Ver @nada');
  const noDefaults = B.blockWords({ blocks: [b('g', 'Gym', '07:00', '08:00')] });
  assert.equal(parseQuickAdd('Correr tarde', noDefaults).block, null, 'sin bloque "pm", "tarde" no es bloque');

  // dependencias entre 3 bloques: la que depende pasa al bloque de su dependencia
  const t = (id, block, deps = [], order = 0) => ({ id, title: id, block, order, minutes: 30, certainty: 'normal', dependencies: deps, done: false });
  const day = [t('a', 'am', ['c']), t('m', 'x'), t('c', 'pm'), t('d', 'x', ['c'])];
  const moved = P.enforceBlockOrder(day, three);
  assert.deepEqual(moved.map((x) => x.task.id).sort(), ['a', 'd']);
  assert.ok(day.every((x) => x.id === 'm' || x.block === 'pm'));
  assert.equal(P.enforceBlockOrder([t('a', 'x', ['b']), t('b', 'am')], three).length, 0, 'depender de un bloque anterior está bien');

  // pronóstico de épica con 3 bloques: capacidad = suma de todos
  const fc = P.epicForecast({ id: 'e', target_date: '2026-01-05' }, [{ ...t('e1', null), epic_id: 'e', date: null }], three, new Date(2026, 0, 5, 0, 0));
  assert.equal(fc.capacity, 4 * 60 + 60 + 4 * 60);
  console.log('OK: bloques personalizables (hasta 5, sin superponerse, @bloque, migración)');
}

// ---------- Hechas: historial por día ----------
{
  const Hs = await import(root + '/src/core/history.js');
  const { formatDMY } = await import(root + '/src/utils/dates.js');
  const local = (y, m, d, hh) => new Date(y, m - 1, d, hh).toISOString();
  const tasks = [
    { id: 'a', done: true, done_at: local(2026, 11, 10, 9), date: '2026-11-10' },
    { id: 'b', done: true, done_at: local(2026, 11, 11, 8), date: '2026-11-10' }, // planificada ayer, terminada hoy
    { id: 'c', done: true, done_at: local(2026, 11, 11, 17), date: null },        // del backlog
    { id: 'd', done: false, date: '2026-11-11' },
    { id: 'e', done: true, done_at: null, date: '2026-11-01' },                  // sin hora: su día planificado
  ];
  assert.deepEqual(Hs.doneByDay(tasks).map((g) => [g.date, g.tasks.map((t) => t.id)]),
    [['2026-11-11', ['c', 'b']], ['2026-11-10', ['a']], ['2026-11-01', ['e']]]);
  assert.equal(formatDMY('2026-11-05'), '05-11-2026');
  console.log('OK: hechas (agrupadas por día de término, dd-mm-aaaa)');
}

// ---------- "bl" en el store: crear y editar al backlog ----------
{
  const S = await import(root + '/src/services/store.js');
  const { todayISO } = await import(root + '/src/utils/dates.js');
  await S.initStore();
  const today = todayISO();
  const t = S.addFromText('Ideas para la charla 1h bl', { date: today, block: 'am' });
  assert.deepEqual([t.title, t.date, t.block, t.minutes], ['Ideas para la charla', null, null, 60]);
  const u = S.addFromText('Informe 30m', { date: today, block: 'pm' });
  assert.equal(u.date, today);
  S.editFromText(u.id, 'Informe 30m bl');
  assert.deepEqual([S.findTask(u.id).date, S.findTask(u.id).block], [null, null], 'editar con bl la manda al backlog');
  console.log('OK: "bl" deja la tarea en el backlog');
}

// ---------- Días y reuniones en el quick-add ----------
{
  const { parseQuickAdd: p } = await import(root + '/src/core/parser.js');
  const B = await import(root + '/src/core/blocks.js');
  const w = B.blockWords({ blocks: B.DEFAULT_BLOCKS });
  const o = { today: '2026-11-11' }; // miércoles
  const q = (s) => p(s, w, o);

  // el ejemplo pedido
  const r = q('reunion proyecto 1 miercoles desde la 1pm 1h');
  assert.deepEqual([r.title, r.date, r.meeting, r.minutes], ['proyecto 1', '2026-11-11', { start: '13:00', end: '14:00' }, 60]);
  // otras formas de hora
  assert.deepEqual(q('Reunión con Juan mañana a las 15 hasta las 16:30').meeting, { start: '15:00', end: '16:30' });
  assert.equal(q('Reunión con Juan mañana a las 15').title, 'Juan', '"con" no va en el título');
  assert.deepEqual(q('Reunión cliente viernes de 3pm a 4pm').meeting, { start: '15:00', end: '16:00' });
  assert.deepEqual(q('reu standup 9:30 am 15m').meeting, { start: '09:30', end: '09:45' }, '"9:30 am" con espacio');
  assert.deepEqual([q('Junta 12pm').title, q('Junta 12pm').meeting], ['Junta', { start: '12:00', end: null }], 'sin duración: la pone el store; sin nombre, se llama como la palabra');
  assert.equal(q('Junta 12am').meeting.start, '00:00');
  // sin hora o sin la palabra: tarea normal
  assert.deepEqual([q('Reunión de la tarde').title, q('Reunión de la tarde').meeting], ['Reunión de la tarde', null]);
  assert.deepEqual([q('Reunión sin hora mañana').title, q('Reunión sin hora mañana').date], ['Reunión sin hora', '2026-11-12']);
  assert.equal(q('reunion x hasta las 2pm').title, 'reunion x hasta las 2pm', 'solo fin: no es reunión');
  assert.equal(q('Llamar a Juan a las 3pm').meeting, null, 'sin "reunión" al inicio no hay reunión');
  // rutina de reunión
  const weekly = q('Reunión semanal lunes 10am 1h cada lunes');
  assert.deepEqual([weekly.title, weekly.date, weekly.repeat, weekly.meeting.start], ['semanal', '2026-11-16', [1], '10:00']);

  // "mañana" siempre es el día siguiente; am / pm / tarde, el bloque
  assert.deepEqual([q('tarea para mañana am').title, q('tarea para mañana am').date, q('tarea para mañana am').block], ['tarea', '2026-11-12', 'am']);
  assert.deepEqual([q('tarea para mañana tarde').date, q('tarea para mañana tarde').block], ['2026-11-12', 'pm']);
  assert.deepEqual([q('tarea para mañana pm').date, q('tarea para mañana pm').block], ['2026-11-12', 'pm']);
  assert.deepEqual([q('Informe mañana').block, q('Informe mañana').date], [null, '2026-11-12'], 'mañana ya no es el bloque');
  assert.deepEqual([q('Llamar por la mañana').title, q('Llamar por la mañana').date], ['Llamar por la mañana', null], '"la mañana" es parte del título');
  assert.equal(q('Informe pasado mañana').date, '2026-11-13');
  assert.equal(q('Informe hoy').date, '2026-11-11');
  assert.deepEqual([q('Informe de mañana').title, q('Informe de mañana').date], ['Informe', '2026-11-12'], '"de" se va con el día');
  assert.deepEqual([q('Enviar factura el viernes').title, q('Enviar factura el viernes').date], ['Enviar factura', '2026-11-13']);
  assert.equal(q('Informe miércoles').date, '2026-11-11', 'el mismo día de la semana: hoy');
  assert.equal(q('Informe martes').date, '2026-11-17', 'un día que ya pasó: la semana siguiente');
  assert.deepEqual([q('Standup 15m cada lunes').repeat, q('Standup 15m cada lunes').date], [[1], null], 'después de "cada" es repetición');
  assert.equal(q('Leer 2h viernes am #web ?').date, '2026-11-13');
  assert.equal(B.blockWords({ blocks: B.DEFAULT_BLOCKS }).tags.manana, 'am', '@mañana sigue eligiendo el bloque');
  console.log('OK: días (hoy, mañana, viernes) y reuniones en el quick-add');
}

// ---------- Store: reuniones y días desde el texto ----------
{
  const S = await import(root + '/src/services/store.js');
  const { todayISO, shiftDate } = await import(root + '/src/utils/dates.js');
  const today = todayISO();
  const m = S.addFromText('Reunión proyecto 1 mañana desde la 1pm 1h', { date: today, block: 'am' });
  assert.deepEqual([m.title, m.date, m.meeting.start, m.meeting.end, m.meeting.blocking, m.certainty, m.minutes, m.block],
    ['proyecto 1', shiftDate(today, 1), '13:00', '14:00', true, 'fixed', 60, 'pm']);
  const d = S.addFromText('Comprar pan 15m mañana', { date: today, block: 'pm' });
  assert.deepEqual([d.date, d.block], [shiftDate(today, 1), 'am'], 'otro día sin bloque: el primero');
  const short = S.addFromText('Junta corta 9am', { date: today, block: 'pm' });
  assert.equal(short.meeting.end, '09:30', 'sin duración: la de Ajustes (30m)');
  S.editFromText(d.id, 'Comprar pan 15m pasado mañana tarde');
  assert.deepEqual([S.findTask(d.id).date, S.findTask(d.id).block], [shiftDate(today, 2), 'pm']);
  console.log('OK: el store crea reuniones y tareas de otros días desde el texto');
}

// ---------- Rutinas: administrar (vista Rutinas y "¿solo esta o todas?") ----------
{
  const S = await import(root + '/src/services/store.js');
  const { todayISO, shiftDate, parseISO } = await import(root + '/src/utils/dates.js');
  const today = todayISO();
  const wd = (iso) => parseISO(iso).getDay();
  const names = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
  const short = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab'];
  const tomorrow = shiftDate(today, 1);

  // "cada <otro día>" escrito hoy: solo el molde, sin tarea de hoy
  const before = S.state.tasks.length;
  const r1 = S.addFromText(`Gimnasio 1h cada ${short[wd(tomorrow)]}`, { date: today, block: 'pm' });
  assert.equal(r1, true, 'devuelve true: solo se creó la rutina');
  assert.equal(S.state.tasks.length, before, 'no crea una tarea hoy si hoy no le toca');
  const gym = S.state.routines.find((r) => r.title === 'Gimnasio');
  assert.equal(S.nextOccurrence(gym), tomorrow);

  // al mirar mañana se crea su tarea (horizonte de 2 semanas; más allá no)
  assert.equal(S.ensureRoutines(true, [tomorrow, shiftDate(today, 30)]), true);
  const gymTomorrow = () => S.state.tasks.find((t) => t.routine_id === gym.id && t.date === tomorrow);
  assert.ok(gymTomorrow(), 'se creó la de mañana');
  assert.equal(S.state.tasks.filter((t) => t.routine_id === gym.id).length, 1);

  // editar la rutina: cambia el molde y la tarea pendiente ya creada
  assert.match(S.updateRoutine(gym.id, { title: ' ', days: gym.days }), /título/);
  assert.match(S.updateRoutine(gym.id, { title: 'Gym', days: [] }), /un día/);
  assert.equal(S.updateRoutine(gym.id, { title: 'Gimnasio fuerte', days: gym.days, minutes: 90, block: 'am' }), null);
  assert.deepEqual([gymTomorrow().title, gymTomorrow().minutes, gymTomorrow().block], ['Gimnasio fuerte', 90, 'am']);
  // quitarle el día de mañana: su tarea pendiente (sin tiempo registrado) se va
  const otherDay = [0, 1, 2, 3, 4, 5, 6].find((d) => d !== wd(tomorrow) && d !== wd(today));
  assert.equal(S.updateRoutine(gym.id, { days: [otherDay] }), null);
  assert.equal(gymTomorrow(), undefined, 'ya no le toca mañana');

  // reunión semanal escrita para mañana: "Aplicar a todas" desde una tarea
  const m = S.addFromText(`Reunión equipo ${names[wd(tomorrow)]} 10am 1h cada ${short[wd(tomorrow)]}`, { date: today, block: 'am' });
  assert.equal(m.date, tomorrow);
  const weekly = S.findRoutine(m.routine_id);
  S.setMeeting(m.id, { date: m.date, start: '11:00', end: '12:30', blocking: true });
  assert.equal(weekly.meeting.start, '10:00', 'reprogramar una vez no cambia la rutina');
  S.applyTaskToRoutine(m.id);
  assert.deepEqual([weekly.meeting.start, weekly.meeting.end, weekly.minutes], ['11:00', '12:30', 90], 'aplicar a todas sí');

  // eliminar la rutina: se van sus pendientes, las hechas se quedan sueltas
  const done = { ...m, id: 'hecha-1', date: shiftDate(today, -7), done: true, done_at: new Date().toISOString() };
  S.state.tasks.push(done);
  assert.equal(S.deleteRoutine(weekly.id), 1, 'borra la pendiente de mañana');
  assert.ok(!S.findRoutine(weekly.id), 'la rutina ya no existe');
  assert.equal(S.findTask(m.id), undefined);
  assert.equal(S.findTask('hecha-1').routine_id, null, 'la hecha queda en el historial, sin rutina');
  console.log('OK: rutinas (editar, eliminar, aplicar a todas, próxima fecha, ver días próximos)');
}

// ---------- Mover varias tareas (pendientes de un bloque terminado) ----------
{
  const S = await import(root + '/src/services/store.js');
  const { todayISO, shiftDate } = await import(root + '/src/utils/dates.js');
  const today = todayISO();
  const a = S.addFromText('Mover uno 20m', { date: today, block: 'am' });
  const b = S.addFromText('Mover dos 20m', { date: today, block: 'am' });
  const tail = S.addFromText('Ya en la tarde', { date: shiftDate(today, 1), block: 'pm' });
  S.moveTasks([a.id, b.id], shiftDate(today, 1), 'pm');
  assert.deepEqual([a, b].map((t) => [S.findTask(t.id).date, S.findTask(t.id).block]), [[shiftDate(today, 1), 'pm'], [shiftDate(today, 1), 'pm']]);
  assert.ok(S.findTask(a.id).order > S.findTask(tail.id).order && S.findTask(b.id).order > S.findTask(a.id).order, 'quedan al final, en su orden');
  console.log('OK: mover varias tareas a otro día y bloque');
}

// ---------- Orden del menú inferior ----------
{
  const K = await import(root + '/src/core/tabs.js');
  const S = await import(root + '/src/services/storage.js');
  assert.deepEqual(K.normalizeTabOrder(null), K.TAB_IDS);
  assert.deepEqual(K.normalizeTabOrder(['done', 'x', 'done', 'minimal']), ['done', 'minimal', 'epics', 'routines', 'docs', 'settings'], 'sin repetidas ni desconocidas; las que faltan al final');
  assert.deepEqual(K.moveTab(K.TAB_IDS, 'done', -1).slice(0, 3), ['minimal', 'done', 'epics']);
  assert.deepEqual(K.moveTab(K.TAB_IDS, 'minimal', -1), K.TAB_IDS, 'la primera no sube más');
  assert.deepEqual(K.moveTab(K.TAB_IDS, 'settings', 1), K.TAB_IDS, 'la última no baja más');
  const restored = S.parseBackup(JSON.stringify({ app: 'cabe-todo', tasks: [], epics: [], settings: { tab_order: ['settings'] } }));
  assert.equal(restored.settings.tab_order[0], 'settings');
  assert.equal(restored.settings.tab_order.length, K.TAB_IDS.length, 'ajustes viejos o incompletos: se completan');
  console.log('OK: orden del menú inferior');
}

// ---------- Docs: anclar arriba ----------
{
  const S = await import(root + '/src/services/store.js');
  const t = S.addFromText('Doc para anclar', { date: null, block: null, epicId: undefined });
  assert.equal(t.pinned_at, undefined, 'una tarea nueva no está anclada');
  assert.equal(S.togglePin(t.id), true);
  assert.ok(S.findTask(t.id).pinned_at, 'anclada con su fecha');
  assert.equal(S.togglePin(t.id), false);
  assert.equal(S.findTask(t.id).pinned_at, null);
  console.log('OK: anclar en Docs');
}

// ---------- Títulos en Titlecase (solo al mostrar) ----------
{
  const { titleCase } = await import(root + '/src/utils/text.js');
  assert.equal(titleCase('prueba dos tres cuatro cinco y seis'), 'Prueba Dos Tres Cuatro Cinco y Seis');
  assert.equal(titleCase('bloques del día'), 'Bloques del Día');
  assert.equal(titleCase('de la casa al trabajo'), 'De la Casa al Trabajo', 'la primera palabra siempre va en mayúscula');
  assert.equal(titleCase('revisar SEO del iPhone'), 'Revisar SEO del IPhone'.replace('IPhone', 'IPhone'), 'no baja a minúsculas el resto');
  assert.equal(titleCase('pendientes → hoy'), 'Pendientes → Hoy');
  assert.equal(titleCase('próximos 7 días'), 'Próximos 7 Días');
  assert.equal(titleCase('ñandú en ámsterdam'), 'Ñandú en Ámsterdam');
  assert.equal(titleCase('informe 2.0'), 'Informe 2.0');
  assert.equal(titleCase('abc').length, 3);
  assert.equal(titleCase(''), '');
  console.log('OK: títulos en Titlecase');
}

// ---------- Comentarios: URLs ----------
{
  const { normalizeUrl } = await import(root + '/src/components/comments.js').catch(() => ({}));
  if (normalizeUrl) {
    assert.equal(normalizeUrl('ejemplo.com/a?b=1'), 'https://ejemplo.com/a?b=1');
    assert.equal(normalizeUrl('http://x.org'), 'http://x.org');
    assert.equal(normalizeUrl('  https://docs.google.com/d/1  '), 'https://docs.google.com/d/1');
    assert.equal(normalizeUrl('hola'), null);
    assert.equal(normalizeUrl('javascript:alert(1)'), null, 'solo http(s)');
    assert.equal(normalizeUrl(''), null);
    console.log('OK: comentarios (URLs)');
  }
}

// ---------- Plantillas de documentación ----------
{
  const P = await import(root + '/src/core/templates.js');
  const S = await import(root + '/src/services/storage.js');
  const def = P.defaultTemplate(P.DEFAULT_TEMPLATES, P.DEFAULT_TEMPLATE_ID);
  assert.equal(def.name, 'Historia de usuario');
  const filled = P.fillTemplate(def.body, { title: 'login con google y github' });
  assert.ok(filled.startsWith('# Login con Google y Github\n'), 'el título de la tarjeta en Titlecase');
  assert.equal(P.fillTemplate('{{ Título }} · {{fecha}} · {{epica}} · {{otra}}', { title: 'x', date: '11-11-2026', epic: 'lanzar web' }), 'X · 11-11-2026 · Lanzar Web · {{otra}}');
  // primer marcador: salta las casillas y los enlaces
  const at = P.firstPlaceholder(filled);
  assert.equal(filled.slice(at[0], at[1]), '[Rol del usuario / tipo de usuario]');
  assert.equal(P.firstPlaceholder('* [ ] tarea\n[enlace](https://x.y)\nnada'), null);
  // guardar / restaurar: válidas o las de siempre
  assert.equal(P.normalizeTemplates([]).length, 2);
  assert.deepEqual(P.normalizeTemplates([{ id: 'a', name: ' A ', body: 'x' }, { id: 'a', name: 'B', body: 'y' }, { id: 'c', name: '', body: 'z' }]), [{ id: 'a', name: 'A', body: 'x' }]);
  assert.match(P.validateTemplates([{ name: 'A', body: 'x' }, { name: 'a', body: 'y' }]), /dos plantillas/);
  assert.match(P.validateTemplates([{ name: 'A', body: '  ' }]), /vacía/);
  const s = S.parseBackup(JSON.stringify({ app: 'cabe-todo', tasks: [], epics: [], settings: { templates: [{ id: 'x', name: 'Mía', body: '# {{titulo}}' }], default_template: 'nope' } })).settings;
  assert.deepEqual([s.templates.length, s.default_template], [1, 'x'], 'si la por defecto no existe, la primera');
  console.log('OK: plantillas de documentación');
}

// ---------- Markdown: tablas y línea horizontal ----------
{
  const { renderMarkdown: md } = await import(root + '/src/utils/markdown.js');
  const { applyFormat: F } = await import(root + '/src/utils/md-format.js');
  const html = md('| A | B |\n| :-- | --: |\n| **1** | x \\| y |\n| solo |');
  assert.match(html, /^<table><thead><tr><th>A<\/th><th style="text-align:right">B<\/th><\/tr><\/thead><tbody>/);
  assert.match(html, /<td><strong>1<\/strong><\/td><td style="text-align:right">x \| y<\/td>/, '"\\|" es una barra dentro de la celda');
  assert.match(html, /<tr><td>solo<\/td><td style="text-align:right"><\/td><\/tr>/, 'filas cortas se completan');
  assert.equal(md('a | b sin separador'), '<p>a | b sin separador</p>', 'sin línea separadora no es tabla');
  assert.equal(md('Texto\n| A |\n| --- |\n| 1 |'), '<p>Texto</p><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>', 'una tabla corta el párrafo');
  // botones
  const t = F('hola', 4, 4, 'table');
  assert.equal(t.text, 'hola\n\n| Columna 1 | Columna 2 | Columna 3 |\n| --- | --- | --- |\n|  |  |  |\n');
  assert.equal(t.text.slice(t.start, t.end), 'Columna 1', 'queda seleccionado el primer encabezado');
  assert.equal(F('x', 0, 1, 'table').text.split('\n')[0], '| x | Columna 2 | Columna 3 |', 'lo seleccionado va en la primera celda');
  const r = F('uno\ndos', 3, 3, 'hr');
  assert.deepEqual([r.text, r.start], ['uno\n\n---\n\ndos', 9]);
  assert.equal(F('', 0, 0, 'hr').text, '---\n');
  console.log('OK: markdown (tablas y línea horizontal)');
}

// ---------- Eliminar documentación (con deshacer) ----------
{
  const S = await import(root + '/src/services/store.js');
  const t = S.addFromText('Con doc', { date: null, block: null });
  S.setDoc(t.id, '# Hola');
  S.togglePin(t.id);
  const prev = S.clearDoc(t.id);
  assert.deepEqual([S.findTask(t.id).doc, S.findTask(t.id).pinned_at], ['', null], 'sin documentación ni anclaje');
  assert.equal(S.clearDoc(t.id), null, 'sin documentación no hay nada que eliminar');
  S.restoreDoc(t.id, prev);
  assert.equal(S.findTask(t.id).doc, '# Hola');
  assert.ok(S.findTask(t.id).pinned_at, 'deshacer devuelve también el anclaje');
  console.log('OK: eliminar documentación (con deshacer)');
}

// ---------- Botón flotante: content script solo con permiso y ajuste ----------
{
  const { mem, L, perms, scripts, injected } = globalThis.__bg;
  const settle = () => new Promise((r) => setTimeout(r, 20));
  mem.settings = { float_timer: true };
  L.installed();
  await settle();
  assert.equal(scripts.length, 0, 'sin permiso no se registra nada');
  perms.granted = true;
  L.permAdded({ origins: ['https://*/*'] });
  await settle();
  assert.deepEqual(scripts.map((x) => x.js[0]), ['src/content/float-timer.js'], 'con permiso se registra');
  assert.deepEqual(injected, [7, 8], 'y se carga en las pestañas ya abiertas');
  L.permAdded({});
  await settle();
  assert.equal(scripts.length, 1, 'no se registra dos veces');
  mem.settings = { float_timer: false };
  L.storage({ settings: { oldValue: { float_timer: true }, newValue: { float_timer: false } } }, 'local');
  await settle();
  assert.equal(scripts.length, 0, 'al apagarlo en Ajustes se quita');
  mem.settings = { float_timer: true };
  L.storage({ settings: { oldValue: { float_timer: false }, newValue: { float_timer: true } } }, 'local');
  await settle();
  assert.equal(scripts.length, 1, 'al encenderlo vuelve');
  perms.granted = false;
  L.permRemoved({});
  await settle();
  assert.equal(scripts.length, 0, 'si se revoca el permiso se quita');
  console.log('OK: botón flotante (permiso opcional)');
}

// ---------- Mezclar datos de dos equipos ----------
{
  const M = await import(root + '/src/core/merge.js');
  const T = (id, at, extra = {}) => ({ id, title: id, minutes: 30, date: '2026-11-12', block: 'am', done: false, dependencies: [], comments: [], time_entries: [], epic_id: null, routine_id: null, updated_at: at, ...extra });
  const base = { epics: [], routines: [], settings: { theme: 'chrome', updated_at: '2026-11-10T00:00:00Z' }, deleted: {} };

  // Gana la edición más reciente, tarea por tarea; lo que existe en un solo lado se agrega
  let r = M.mergeData(
    { ...base, tasks: [T('a', '2026-11-12T10:00:00Z', { title: 'A local' }), T('b', '2026-11-12T09:00:00Z', { title: 'B local' })] },
    { ...base, tasks: [T('a', '2026-11-12T09:00:00Z', { title: 'A remota' }), T('b', '2026-11-12T11:00:00Z', { title: 'B remota' }), T('c', '2026-11-12T08:00:00Z')] },
  );
  assert.deepEqual(r.data.tasks.map((t) => t.title).sort(), ['A local', 'B remota', 'c']);
  assert.deepEqual([r.summary.added, r.summary.updated, r.summary.removed], [1, 1, 0]);
  assert.equal(M.mergeSummaryText(r.summary), '1 tarea nueva, 1 tarea actualizada');

  // Borrada en un equipo: no revive; editada después de borrarse en el otro: sí
  r = M.mergeData(
    { ...base, tasks: [T('a', '2026-11-12T08:00:00Z'), T('b', '2026-11-12T12:00:00Z')] },
    { ...base, tasks: [], deleted: { a: '2026-11-12T09:00:00Z', b: '2026-11-12T09:00:00Z' } },
  );
  assert.deepEqual(r.data.tasks.map((t) => t.id), ['b'], 'a se borró después de su última edición; b se editó después');
  assert.equal(r.summary.removed, 1);
  assert.ok(r.data.deleted.a, 'el borrado se conserva para el próximo equipo');

  // Datos de antes (sin updated_at) pierden contra los nuevos
  r = M.mergeData({ ...base, tasks: [T('a', undefined, { title: 'vieja' })] }, { ...base, tasks: [T('a', '2026-11-01T00:00:00Z', { title: 'nueva' })] });
  assert.equal(r.data.tasks[0].title, 'nueva');

  // Comentarios: se unen aunque gane la otra versión; los borrados no vuelven
  const c = (id, text, at) => ({ id, text, created_at: at, updated_at: null });
  r = M.mergeData(
    { ...base, tasks: [T('a', '2026-11-12T10:00:00Z', { comments: [c('c1', 'uno', '2026-11-12T08:00:00Z'), c('c3', 'tres', '2026-11-12T09:30:00Z')] })] },
    { ...base, tasks: [T('a', '2026-11-12T11:00:00Z', { comments: [c('c1', 'uno', '2026-11-12T08:00:00Z'), c('c2', 'dos', '2026-11-12T09:00:00Z')] })], deleted: { c3: '2026-11-12T10:30:00Z' } },
  );
  assert.deepEqual(r.data.tasks[0].comments.map((x) => x.text), ['uno', 'dos']);

  // Rutinas: `generated` se une y no cuenta como edición; tareas de la misma rutina y día se juntan
  const R = (at, generated, title = 'Standup') => ({ id: 'r1', title, days: [1, 2, 3, 4, 5], minutes: 15, block: 'am', generated, updated_at: at });
  r = M.mergeData(
    { ...base, routines: [R('2026-11-12T10:00:00Z', ['2026-11-11'], 'Standup equipo')], tasks: [T('t_azar1', '2026-11-12T08:00:00Z', { routine_id: 'r1', done: true })] },
    { ...base, routines: [R('2026-11-12T07:00:00Z', ['2026-11-12'])], tasks: [T('t_azar2', '2026-11-12T08:30:00Z', { routine_id: 'r1' })] },
  );
  assert.equal(r.data.routines[0].title, 'Standup equipo', 'la edición más reciente de la rutina');
  assert.deepEqual(r.data.routines[0].generated, ['2026-11-11', '2026-11-12']);
  assert.deepEqual(r.data.tasks.map((t) => t.id), ['t_azar1'], 'queda una por rutina y día (la hecha)');
  assert.ok(r.data.deleted.t_azar2, 'la repetida no vuelve desde el otro equipo');

  // Referencias a lo borrado: épica, dependencias
  r = M.mergeData(
    { ...base, epics: [{ id: 'e1', name: 'Web', updated_at: '2026-11-12T08:00:00Z' }], tasks: [T('a', '2026-11-12T08:00:00Z', { epic_id: 'e1', dependencies: ['x'] })] },
    { ...base, tasks: [], deleted: { e1: '2026-11-12T09:00:00Z', x: '2026-11-12T09:00:00Z' } },
  );
  assert.deepEqual([r.data.epics.length, r.data.tasks[0].epic_id, r.data.tasks[0].dependencies], [0, null, []]);

  // Ajustes: el más reciente
  r = M.mergeData({ ...base, tasks: [] }, { ...base, tasks: [], settings: { theme: 'trello', updated_at: '2026-11-12T00:00:00Z' } });
  assert.equal(r.data.settings.theme, 'trello');

  // Mezclar dos veces lo mismo no cambia nada
  const once = M.mergeData({ ...base, tasks: [T('a', '2026-11-12T08:00:00Z')] }, { ...base, tasks: [T('b', '2026-11-12T08:00:00Z')] }).data;
  assert.equal(M.mergeSummaryText(M.mergeData(once, once).summary), 'ya estaba al día');

  // Borrados viejos se olvidan
  assert.deepEqual(Object.keys(M.pruneTombstones({ viejo: '2020-01-01T00:00:00Z', nuevo: new Date().toISOString() })), ['nuevo']);
  console.log('OK: mezclar datos (más reciente gana, borrados, comentarios, rutinas, referencias)');
}

// ---------- updated_at y borrados automáticos en el store ----------
{
  const S = await import(root + '/src/services/store.js');
  const { mergeSummaryText: mergeText } = await import(root + '/src/core/merge.js');
  const t = S.addFromText('Para sincronizar 30m', { date: null, block: null });
  assert.ok(S.findTask(t.id).updated_at, 'una tarea nueva trae updated_at');
  const other = S.state.tasks.find((x) => x.id !== t.id);
  const otherStamp = other?.updated_at;
  await new Promise((r) => setTimeout(r, 5));
  S.updateTask(t.id, { minutes: 45 });
  assert.ok(S.findTask(t.id).updated_at > t.created_at, 'editar la marca de nuevo');
  if (other) assert.equal(other.updated_at, otherStamp, 'las que no cambiaron conservan su marca');
  S.deleteTask(t.id);
  assert.ok(S.state.deleted[t.id], 'borrar la recuerda');
  const backup = JSON.parse(S.exportBackup());
  assert.equal(backup.version, 2);
  assert.ok(backup.deleted[t.id], 'el respaldo lleva los borrados');

  // Mezclar un respaldo: agrega lo nuevo sin tocar lo demás
  const before = S.state.tasks.length;
  const incoming = S.readBackup(JSON.stringify({
    ...backup,
    tasks: [...backup.tasks, { id: 'remota-1', title: 'Desde el celular', minutes: 20, date: null, block: null, done: false, order: 0, updated_at: new Date().toISOString() }],
  })).data;
  const summary = S.mergeBackup(incoming);
  assert.equal(mergeText(summary), '1 tarea nueva');
  assert.equal(S.state.tasks.length, before + 1);
  assert.equal(S.findTask(t.id), undefined, 'lo borrado sigue borrado');
  console.log('OK: updated_at y borrados automáticos; mezclar un respaldo');
}

// ---------- Rutinas: id fijo por rutina y día ----------
{
  const { dueInstances, routineTaskId } = await import(root + '/src/core/routines.js');
  const routine = { id: 'r9', title: 'Standup', days: [0, 1, 2, 3, 4, 5, 6], minutes: 15, block: 'am', start_date: '2026-01-01', generated: [], certainty: 'normal', epic_id: null, meeting: null };
  const a = dueInstances([routine], '2026-11-12', { orderFor: () => 0 }).tasks[0];
  const b = dueInstances([routine], '2026-11-12', { orderFor: () => 0 }).tasks[0];
  assert.equal(a.id, routineTaskId('r9', '2026-11-12'));
  assert.equal(a.id, b.id, 'dos equipos crean la misma tarea');
  console.log('OK: tareas de rutina con id fijo');
}

// ---------- Google Drive: la secuencia y los mensajes de error ----------
{
  const { runSync, googleDrive, DriveAuthError } = await import(root + '/src/services/drive-api.js');
  const S = await import(root + '/src/services/store.js');
  const d = { file: null, version: 0, uploads: 0 };
  const drive = {
    find: async () => (d.file ? { id: 'f1' } : null),
    download: async () => d.file,
    modified: async () => `v${d.version}`,
    create: async (text) => { d.file = text; d.version += 1; return { id: 'f1' }; },
    update: async (id, text) => { d.file = text; d.version += 1; d.uploads += 1; },
  };
  const local = { exportText: () => S.exportBackup(), read: (t) => S.readBackup(t), merge: (x) => S.mergeBackup(x), saveUndo: async () => {} };
  assert.equal((await runSync(drive, local)).created, true, 'sin archivo: se crea');
  const remote = JSON.parse(d.file);
  remote.tasks.push({ id: 'desde-web', title: 'Desde la web', minutes: 15, date: null, block: null, done: false, order: 0, updated_at: new Date(Date.now() + 1000).toISOString() });
  d.file = JSON.stringify(remote);
  const r = await runSync(drive, local, { fileId: 'f1' });
  assert.equal(r.summary.tasks.added, 1);
  assert.ok(S.findTask('desde-web'));

  // Errores de Google → mensajes claros
  const reply = (status, body) => async () => ({ ok: false, status, json: async () => body });
  const failWith = (status, body) => googleDrive('t', reply(status, body)).find();
  await assert.rejects(failWith(401, {}), (e) => e instanceof DriveAuthError);
  await assert.rejects(failWith(403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }), (e) => e instanceof DriveAuthError);
  await assert.rejects(failWith(403, { error: { errors: [{ reason: 'accessNotConfigured' }], message: 'Google Drive API has not been used in project 1 before or it is disabled.' } }), /no está activada/);
  await assert.rejects(failWith(429, {}), /esperar un momento/);
  console.log('OK: Google Drive (secuencia y mensajes de error)');
}
