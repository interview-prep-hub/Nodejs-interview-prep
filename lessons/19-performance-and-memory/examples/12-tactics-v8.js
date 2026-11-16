// Tactics inside the engine: object shapes, delete, holey arrays, string building, regex cost, JSON cost
// @flags --allow-natives-syntax
// Run: node --allow-natives-syntax lessons/19-performance-and-memory/examples/12-tactics-v8.js
// The % functions below are V8 internals for LEARNING only. Never use them in real code.
const { performance } = require('node:perf_hooks');

// Read V8's internal state of a value. new Function is used so that this file still parses without the flag.
let ask = null;
try {
  ask = {
    sameShape: new Function('a', 'b', 'return %HaveSameMap(a, b)'),
    fastProps: new Function('o', 'return %HasFastProperties(o)'),
    holey: new Function('a', 'return %HasHoleyElements(a)'),
  };
  ask.fastProps({});
} catch {
  ask = null;
  console.log('(run with --allow-natives-syntax to see the V8 internals; timings still work)');
}

// Best (smallest) time of fn() in milliseconds out of 5 runs, after a few warm-up calls.
// For small benchmarks the minimum is a good estimate: noise from the machine can only ADD time.
function best(label, fn, rounds = 5) {
  for (let i = 0; i < 3; i++) fn(); // warm-up: V8 needs a few calls to finish optimizing
  let min = Infinity;
  for (let i = 0; i < rounds; i++) {
    const start = performance.now();
    fn();
    min = Math.min(min, performance.now() - start);
  }
  console.log(`  ${label.padEnd(46)} ${min.toFixed(1).padStart(8)} ms`);
  return min;
}

// =============================================================================================
console.log('--- 1. object shapes ("hidden classes")');
// =============================================================================================
if (ask) {
  const a = { x: 1, y: 2 };
  const b = { x: 1, y: 2 };
  const c = { y: 2, x: 1 };
  console.log('  { x, y } and { x, y }  share one shape:   ', ask.sameShape(a, b));
  console.log('  { x, y } and { y, x }  share one shape:   ', ask.sameShape(a, c), '(same keys, other order = other shape)');
  const withDelete = { x: 1, y: 2, z: 3 };
  const withUndefined = { x: 1, y: 2, z: 3 };
  console.log('  fast properties before delete:             ', ask.fastProps(withDelete));
  delete withDelete.x;
  withUndefined.x = undefined;
  console.log('  after  delete o.x:                         ', ask.fastProps(withDelete), '(the object turned into a slow dictionary)');
  console.log('  after  o.x = undefined:                    ', ask.fastProps(withUndefined));
}

function makeObjects(count, prepare) {
  const list = [];
  for (let i = 0; i < count; i++) {
    const o = { a: i, b: 2, c: 3 };
    prepare(o);
    list.push(o);
  }
  return list;
}
const afterDelete = makeObjects(100_000, (o) => { delete o.a; });
const afterUndefined = makeObjects(100_000, (o) => { o.a = undefined; });
// two copies of the same function, so that one list cannot change what V8 learned about the other
function sumBC1(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].b + list[i].c; return s; }
function sumBC2(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].b + list[i].c; return s; }
console.log('  reading b and c from 100000 objects (15 passes):');
const tUndef = best('after  o.a = undefined', () => { for (let k = 0; k < 15; k++) sumBC1(afterUndefined); });
const tDelete = best('after  delete o.a', () => { for (let k = 0; k < 15; k++) sumBC2(afterDelete); });
console.log(`  -> objects that went through delete were read ${(tDelete / tUndef).toFixed(0)}x slower`);

// =============================================================================================
console.log('\n--- 2. arrays with holes');
// =============================================================================================
if (ask) {
  console.log('  [1, 2, 3] has holes:                        ', ask.holey([1, 2, 3]));
  console.log('  [1, , 3] has holes:                         ', ask.holey([1, , 3]));
  const grown = new Array(3);
  grown[0] = 1; grown[1] = 2; grown[2] = 3;
  console.log('  new Array(3), then all 3 slots filled:      ', ask.holey(grown), '(it stays "holey" forever)');
  const deleted = [1, 2, 3];
  delete deleted[1];
  console.log('  after delete arr[1]:                        ', ask.holey(deleted));
}
const packed = [];
for (let i = 0; i < 500_000; i++) packed.push(i);
const holey = new Array(500_000);
for (let i = 0; i < 500_000; i++) holey[i] = i;
function sumP(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; }
function sumH(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i]; return s; }
console.log('  summing 500000 numbers (20 passes):');
const tp = best('packed array (built with push)', () => { for (let k = 0; k < 20; k++) sumP(packed); });
const th = best('holey array (built with new Array(n))', () => { for (let k = 0; k < 20; k++) sumH(holey); });
console.log(`  -> reading the holey array took ${(th / tp).toFixed(1)}x the time. A small effect: do not contort your code for it.`);
console.log('  building an array of 500000 numbers:');
best('push into []', () => { const a = []; for (let i = 0; i < 500_000; i++) a.push(i); return a; });
best('new Array(n), then fill every slot', () => { const a = new Array(500_000); for (let i = 0; i < 500_000; i++) a[i] = i; return a; });

// =============================================================================================
console.log('\n--- 3. building a big string (100000 lines)');
// =============================================================================================
best('s += piece (in a loop)', () => { let s = ''; for (let i = 0; i < 100_000; i++) s += 'line ' + i + '\n'; return s.length; });
best('parts.push(piece), then parts.join()', () => { const p = []; for (let i = 0; i < 100_000; i++) p.push('line ' + i + '\n'); return p.join('').length; });
console.log('  -> the old advice "never use += for strings" is out of date: V8 joins the pieces lazily.');

// =============================================================================================
console.log('\n--- 4. regular expressions');
// =============================================================================================
const evil = /^(a+)+$/; // nested repetition: on a failing input the work doubles with every extra character
evil.test('aab');
evil.test('aab'); // run it twice on short inputs first, so V8 has compiled the expression
for (const n of [16, 18, 20, 22]) {
  const input = 'a'.repeat(n) + 'b';
  const start = performance.now();
  evil.test(input);
  console.log(`  /^(a+)+$/ on ${n} letters a and then b: ${(performance.now() - start).toFixed(0).padStart(5)} ms`);
}
const safe = /^a+$/;
const start = performance.now();
safe.test('a'.repeat(22) + 'b');
console.log(`  /^a+$/    on 22 letters a and then b: ${(performance.now() - start).toFixed(2).padStart(5)} ms  (same question, no nested repetition)`);
const text = 'user-123 logged in from 10.0.0.1';
best('regex /\\d+\\.\\d+/ on a short text, 300000 times', () => { let c = 0; for (let i = 0; i < 300_000; i++) if (/\d+\.\d+/.test(text)) c++; return c; });
best('text.includes(".") the same way, 300000 times', () => { let c = 0; for (let i = 0; i < 300_000; i++) if (text.includes('.')) c++; return c; });

// =============================================================================================
console.log('\n--- 5. the cost of JSON');
// =============================================================================================
const users = Array.from({ length: 20_000 }, (_, i) => ({ id: i, name: 'user-' + i, email: `user${i}@example.com`, active: i % 2 === 0, score: i * 1.5 }));
const json = JSON.stringify(users);
console.log('  20000 users as JSON:', (json.length / 1024 / 1024).toFixed(1), 'MB. The event loop is blocked while this runs:');
best('JSON.stringify(all 20000 users)', () => JSON.stringify(users));
best('JSON.parse(that text)', () => JSON.parse(json));
// the idea behind fast-json-stringify: a function written for ONE known shape
function serializeUser(u) {
  return '{"id":' + u.id + ',"name":' + JSON.stringify(u.name) + ',"email":' + JSON.stringify(u.email) + ',"active":' + (u.active ? 'true' : 'false') + ',"score":' + u.score + '}';
}
function serializeAll(list) {
  let out = '[';
  for (let i = 0; i < list.length; i++) out += (i ? ',' : '') + serializeUser(list[i]);
  return out + ']';
}
console.log('  hand-written serializer gives the same text:', serializeAll(users) === json);
best('hand-written serializer for this shape', () => serializeAll(users));
const twoFields = users.map(({ id, name }) => ({ id, name }));
best('JSON.stringify with only 2 fields per user', () => JSON.stringify(twoFields));
best('JSON.stringify of one page (20 users)', () => JSON.stringify(users.slice(0, 20)), 15);
