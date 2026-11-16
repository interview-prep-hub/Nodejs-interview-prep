// assert (check things) and console (print things)
// Run: node lessons/05-core-modules-tour/examples/11-assert-and-console.js
// Lines written by console.error and console.assert go to stderr, the rest to stdout.
const assert = require('node:assert/strict'); // strict mode: the one you should use
const looseAssert = require('node:assert'); // the old default: equal() means ==

// Show what a failing assertion looks like without crashing the program.
function attempt(label, fn) {
  try {
    fn();
    console.log(`${label}: passed`);
  } catch (err) {
    console.log(`${label}: ${err.name} [${err.code}]`);
    return err;
  }
}

console.log('=== assert ===');
looseAssert.equal(1, '1'); // passes because 1 == '1'
console.log('legacy assert.equal(1, "1") passed (loose ==)');
const err = attempt('strict equal(1, "1")', () => assert.equal(1, '1'));
console.log('message:', JSON.stringify(err.message));
console.log('actual:', err.actual, '| expected:', err.expected, '| operator:', err.operator);

attempt('ok(true)', () => assert.ok(true));
attempt('notEqual(1, 2)', () => assert.notEqual(1, 2));
attempt('ok(0, "need a value")', () => assert.ok(0, 'need a value'));

console.log('\n--- deepStrictEqual compares inside objects and arrays ---');
attempt('same data', () => assert.deepStrictEqual({ a: 1, list: [1, 2] }, { a: 1, list: [1, 2] }));
const diff = attempt('different data', () =>
  assert.deepStrictEqual({ a: 1, list: [1, 2] }, { a: 1, list: [1, 3] })
);
console.log(diff.message);
console.log('actual:', diff.actual, '| expected:', diff.expected);

console.log('--- throws: check that code fails the way you expect ---');
const boom = () => {
  throw new TypeError('bad input');
};
attempt('by class', () => assert.throws(boom, TypeError));
attempt('by regex', () => assert.throws(boom, /bad/));
attempt('by object', () => assert.throws(boom, { name: 'TypeError', message: 'bad input' }));
attempt('by function', () => assert.throws(boom, (e) => e instanceof TypeError && e.message.includes('bad')));
attempt('wrong class', () => assert.throws(boom, RangeError));
attempt('nothing thrown', () => assert.throws(() => {}));

async function asyncChecks() {
  console.log('--- rejects: the same idea for promises (always await it) ---');
  await assert.rejects(Promise.reject(new Error('network down')), /network down/);
  console.log('rejects: passed');
  await assert.rejects(Promise.resolve('fine'), /anything/).catch((e) => console.log('rejects (but it resolved):', e.message));
}

function consoleTour() {
  console.log('\n=== console ===');
  console.log('%s has %d items costing %j', 'cart', 3, { total: 9.5 }); // printf-style

  console.log('--- table ---');
  const people = [
    { name: 'Ada', age: 36, city: 'London' },
    { name: 'Linus', age: 55, city: 'Helsinki' },
  ];
  console.table(people);
  console.table(people, ['name']); // only some columns

  console.log('--- group (indent) ---');
  console.group('Request 42');
  console.log('validating');
  console.group('Database');
  console.log('query ok');
  console.groupEnd();
  console.log('done');
  console.groupEnd();

  console.log('--- count ---');
  console.count();
  console.count();
  console.count('cache hit');
  console.countReset();
  console.count();

  console.log('--- dir: choose the depth ---');
  const deep = { a: { b: { c: { d: 'bottom' } } } };
  console.dir(deep, { depth: 0 });
  console.dir(deep, { depth: null });

  console.log('--- time (the numbers change on every run) ---');
  console.time('work');
  let n = 0;
  for (let i = 0; i < 1e6; i++) n += i;
  console.timeLog('work', 'halfway, n =', n); // print without stopping the timer
  console.timeEnd('work'); // print and stop

  console.log('--- stderr and assert ---');
  console.error('console.error writes to stderr');
  console.warn('console.warn also writes to stderr');
  console.assert(1 + 1 === 3, 'math is broken'); // prints a message, does NOT throw
  console.log('still running after a failed console.assert');
}

asyncChecks().then(consoleTour);
