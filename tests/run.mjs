// Pruebas de la lógica pura (parser + PERT + épicas). Ejecutar: node tests/run.mjs
import assert from 'node:assert/strict';
const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { parseQuickAdd: p, formatMinutes: f, formatClock, toQuickAddText } = await import(root + '/parser.js');
const P = await import(root + '/pert.js');
const T = (title, minutes, block = null, certainty = null, epicTag = null) => ({ title, minutes, block, certainty, epicTag });
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
const { slugify, tagKey } = await import(root + '/parser.js');
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
  console.log('OK: sugerencias');
}
// ----- Comentarios (markdown) y temporizador -----
{
  const { renderMarkdown: md } = await import(root + '/markdown.js');
  const T = await import(root + '/timer.js');
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
  const T = await import(root + '/timer.js');
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
  const { scheduleCasio } = await import(root + '/casio.js');
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
  const { applyFormat: F } = await import(root + '/md-format.js');
  const { renderMarkdown: md, markdownExcerpt: ex } = await import(root + '/markdown.js');
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
// ----- Service worker: reuniones que empiezan (con la API de Chrome simulada) -----
{
  const { toISO } = await import(root + '/dates.js');
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
  const on = (name) => ({ addListener: (fn) => { L[name] = fn; } });
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
    alarms: { create: (n, o) => { alarms[n] = o; }, clear: async (n) => { delete alarms[n]; }, onAlarm: on('alarm') },
    notifications: { create: (id, o) => notes.push(o), clear() {}, onClicked: on('notif') },
    runtime: { onInstalled: on('installed'), onStartup: on('startup'), onMessage: on('message'), sendMessage() {} },
    sidePanel: { setPanelBehavior: async () => {}, open: async () => {} },
    offscreen: { hasDocument: async () => false, createDocument: async () => {}, closeDocument: async () => {} },
    windows: { getLastFocused: async () => ({ id: 1 }) },
  };
  await import(root + '/background.js');
  globalThis.__bg = { mem, L }; // para pruebas posteriores del service worker
  const running = (id) => { const e = mem.tasks.find((t) => t.id === id).time_entries; return e.length > 0 && !e.at(-1).end; };

  await L.alarm({ name: 'meeting-start', scheduledTime: Date.now() });
  assert.equal(running('m'), true, 'la reunión que bloquea inicia su temporizador');
  assert.equal(running('w'), false, 'y pausa la tarea que corría');
  assert.equal(running('p'), false, 'la paralela no se inicia sola');
  assert.equal(notes.length, 2, 'aviso de ambas reuniones');
  assert.ok(notes[0].message.includes('ya está corriendo'));
  // ▶ del botón celeste en la paralela mientras corre la reunión que bloquea → rechazado
  L.message({ type: 'pertday-start-timer', taskId: 'p' }, {});
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
  const T = await import(root + '/timer.js');
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
  const S = await import(root + '/store.js');
  const { toISO } = await import(root + '/dates.js');
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
  L.message({ type: 'pertday-pause-timer' }, {});
  await new Promise((r) => setTimeout(r, 20));
  const runM = (id) => { const e = mem.tasks.find((t) => t.id === id).time_entries; return e.length > 0 && !e.at(-1).end; };
  assert.equal(runM('m'), true, '❚❚ no pausa la reunión'); assert.equal(runM('b'), false, '❚❚ sí pausa la tarea');
  L.message({ type: 'pertday-finish-meeting', taskId: 'm' }, {});
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(runM('m'), false); assert.equal(mem.tasks.find((t) => t.id === 'm').done, true, '■ finaliza la reunión');
  console.log('OK: reuniones no se pausan (finalizar / reprogramar, paralela junto a una tarea)');
}
