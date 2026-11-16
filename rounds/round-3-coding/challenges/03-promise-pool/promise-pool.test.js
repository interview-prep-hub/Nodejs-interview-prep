'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: sleep } = require('node:timers/promises');
const { load } = require('../../../_shared/load');
const { pool } = load(__dirname, 'promise-pool.js');

function tracker() {
  const t = { running: 0, max: 0, started: [] };
  t.task = (id, ms, result = id, fail = false) => async () => {
    t.started.push(id);
    t.running++;
    t.max = Math.max(t.max, t.running);
    await sleep(ms);
    t.running--;
    if (fail) throw new Error(`task ${id} failed`);
    return result;
  };
  return t;
}

test('returns results in input order, not completion order', async () => {
  const t = tracker();
  const out = await pool([t.task(0, 30), t.task(1, 5), t.task(2, 15)], 3);
  assert.deepEqual(out, [0, 1, 2]);
});

test('never runs more than `limit` tasks at once, and does use the full limit', async () => {
  const t = tracker();
  const tasks = Array.from({ length: 10 }, (_, i) => t.task(i, 10));
  await pool(tasks, 3);
  assert.equal(t.max, 3);
});

test('starts the next task as soon as one finishes', async () => {
  const t = tracker();
  const tasks = [t.task('slow', 60), t.task('fast1', 5), t.task('fast2', 5), t.task('fast3', 5)];
  await pool(tasks, 2);
  assert.deepEqual(t.started, ['slow', 'fast1', 'fast2', 'fast3']);
  assert.equal(t.max, 2);
});

test('limit larger than the number of tasks is fine', async () => {
  const t = tracker();
  assert.deepEqual(await pool([t.task(0, 1), t.task(1, 1)], 50), [0, 1]);
});

test('empty task list resolves to an empty array', async () => {
  assert.deepEqual(await pool([], 3), []);
});

test('stopOnError (default) rejects with the first error and starts nothing new', async () => {
  const t = tracker();
  const tasks = [t.task(0, 5, 0, true), t.task(1, 40), t.task(2, 5), t.task(3, 5)];
  await assert.rejects(pool(tasks, 2), /task 0 failed/);
  await sleep(80);
  assert.deepEqual(t.started, [0, 1]);
});

test('stopOnError: false collects fulfilled and rejected outcomes in order', async () => {
  const t = tracker();
  const out = await pool([t.task(0, 5), t.task(1, 5, 1, true), t.task(2, 5)], 2, { stopOnError: false });
  assert.equal(out.length, 3);
  assert.deepEqual(out[0], { status: 'fulfilled', value: 0 });
  assert.equal(out[1].status, 'rejected');
  assert.equal(out[1].reason.message, 'task 1 failed');
  assert.deepEqual(out[2], { status: 'fulfilled', value: 2 });
});

test('invalid limit rejects with RangeError', async () => {
  for (const bad of [0, -1, 1.5, NaN, '2', undefined]) {
    await assert.rejects(pool([async () => 1], bad), RangeError);
  }
});
