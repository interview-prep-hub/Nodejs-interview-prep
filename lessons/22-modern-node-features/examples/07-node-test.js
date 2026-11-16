// The built-in test runner: node:test + node:assert. No jest or mocha install needed for basic tests.
// Shows: test(), async tests, subtests, mock.fn, fake timers, skip and todo. Timings in the report change from run to run.
// Run: node lessons/22-modern-node-features/examples/07-node-test.js
// (A real project names files *.test.js and runs them all with: node --test)

const test = require('node:test');
const assert = require('node:assert/strict');

function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

test('slugify makes a url-friendly string', () => {
  assert.equal(slugify('  Hello, Modern Node!  '), 'hello-modern-node');
});

test('an async test just returns a promise', async () => {
  const value = await Promise.resolve(42);
  assert.equal(value, 42);
});

test('subtests group related checks', async (t) => {
  await t.test('empty text', () => assert.equal(slugify(''), ''));
  await t.test('only symbols', () => assert.equal(slugify('?!?'), ''));
  await t.test('numbers are kept', () => assert.equal(slugify('Node 24'), 'node-24'));
});

test('mock.fn records every call', (t) => {
  const double = t.mock.fn((n) => n * 2);
  assert.deepEqual([1, 2, 3].map((n) => double(n)), [2, 4, 6]);
  assert.equal(double.mock.callCount(), 3);
  assert.deepEqual(double.mock.calls[1].arguments, [2]);
});

test('mock timers make time pass instantly', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const done = t.mock.fn();
  setTimeout(done, 60_000); // one minute, but we never wait for it
  t.mock.timers.tick(59_999);
  assert.equal(done.mock.callCount(), 0);
  t.mock.timers.tick(1);
  assert.equal(done.mock.callCount(), 1);
});

test('assert.partialDeepStrictEqual checks only the keys you name', () => {
  assert.partialDeepStrictEqual({ id: 1, name: 'Sam', extra: true }, { id: 1, name: 'Sam' });
});

test('a skipped test', { skip: 'shows how skip is reported' }, () => {
  throw new Error('never runs');
});

test.todo('a test we still have to write');
