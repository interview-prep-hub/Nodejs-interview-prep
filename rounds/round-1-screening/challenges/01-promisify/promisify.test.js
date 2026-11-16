'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../../../_shared/load');
const { promisify } = load(__dirname, 'promisify.js');

test('resolves with the first result value', async () => {
  const add = (a, b, cb) => setImmediate(cb, null, a + b);
  assert.equal(await promisify(add)(2, 3), 5);
});

test('rejects with the error when the callback gets one', async () => {
  const boom = new Error('boom');
  const fail = (cb) => setImmediate(cb, boom);
  await assert.rejects(promisify(fail)(), (err) => err === boom);
});

test('works when the callback is called synchronously', async () => {
  const sync = (x, cb) => cb(null, x * 2);
  assert.equal(await promisify(sync)(21), 42);
});

test('ignores extra callback values', async () => {
  const many = (cb) => cb(null, 'first', 'second');
  assert.equal(await promisify(many)(), 'first');
});

test('preserves this for method calls', async () => {
  const obj = {
    base: 10,
    add(n, cb) {
      cb(null, this.base + n);
    },
  };
  obj.addAsync = promisify(obj.add);
  assert.equal(await obj.addAsync(5), 15);
});

test('a synchronous throw inside fn becomes a rejection', async () => {
  const bad = () => {
    throw new RangeError('sync');
  };
  await assert.rejects(promisify(bad)(), RangeError);
});

test('throws TypeError when fn is not a function', () => {
  assert.throws(() => promisify(42), TypeError);
  assert.throws(() => promisify(), TypeError);
});

test('each call gets its own promise', async () => {
  const echo = (x, cb) => setImmediate(cb, null, x);
  const p = promisify(echo);
  assert.deepEqual(await Promise.all([p(1), p(2), p(3)]), [1, 2, 3]);
});
