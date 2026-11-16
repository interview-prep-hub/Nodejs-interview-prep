'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../../../_shared/load');
const { debounce } = load(__dirname, 'debounce.js');

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const fn = function (...args) {
    calls.push({ args, self: this });
    return args.length;
  };
  return { calls, fn, tick: (ms) => t.mock.timers.tick(ms) };
}

test('does not call before the quiet period has passed', (t) => {
  const { calls, fn, tick } = setup(t);
  const d = debounce(fn, 100);
  d(1);
  tick(99);
  assert.equal(calls.length, 0);
  tick(1);
  assert.equal(calls.length, 1);
});

test('a burst of calls produces one trailing call with the last arguments', (t) => {
  const { calls, fn, tick } = setup(t);
  const d = debounce(fn, 100);
  d('a');
  tick(50);
  d('b');
  tick(50);
  d('c');
  tick(99);
  assert.equal(calls.length, 0);
  tick(1);
  assert.deepEqual(calls.map((c) => c.args), [['c']]);
});

test('uses the this of the last call', (t) => {
  const { calls, fn, tick } = setup(t);
  const obj = { run: debounce(fn, 10) };
  obj.run(1);
  tick(10);
  assert.equal(calls[0].self, obj);
});

test('leading: true with trailing: false calls once at the start of a burst', (t) => {
  const { calls, fn, tick } = setup(t);
  const d = debounce(fn, 100, { leading: true, trailing: false });
  d(1);
  d(2);
  assert.deepEqual(calls.map((c) => c.args), [[1]]);
  tick(200);
  assert.equal(calls.length, 1);
  d(3);
  assert.equal(calls.length, 2);
});

test('leading and trailing: a single call fires only once', (t) => {
  const { calls, fn, tick } = setup(t);
  const d = debounce(fn, 100, { leading: true, trailing: true });
  d(1);
  tick(200);
  assert.equal(calls.length, 1);
});

test('leading and trailing: later calls in the burst fire once more at the end', (t) => {
  const { calls, fn, tick } = setup(t);
  const d = debounce(fn, 100, { leading: true, trailing: true });
  d('a');
  d('b');
  d('c');
  tick(100);
  assert.deepEqual(calls.map((c) => c.args), [['a'], ['c']]);
});

test('cancel drops the pending call', (t) => {
  const { calls, fn, tick } = setup(t);
  const d = debounce(fn, 100);
  d(1);
  d.cancel();
  tick(500);
  assert.equal(calls.length, 0);
});

test('flush runs the pending call right away and returns its result', (t) => {
  const { calls, fn, tick } = setup(t);
  const d = debounce(fn, 100);
  d('x', 'y');
  assert.equal(d.flush(), 2);
  assert.equal(calls.length, 1);
  tick(500);
  assert.equal(calls.length, 1);
});

test('flush with nothing pending does nothing', (t) => {
  const { calls, fn } = setup(t);
  const d = debounce(fn, 100);
  d.flush();
  assert.equal(calls.length, 0);
});

test('works again after a burst finished', (t) => {
  const { calls, fn, tick } = setup(t);
  const d = debounce(fn, 50);
  d(1);
  tick(50);
  d(2);
  tick(50);
  assert.deepEqual(calls.map((c) => c.args), [[1], [2]]);
});
