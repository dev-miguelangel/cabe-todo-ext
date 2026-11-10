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
