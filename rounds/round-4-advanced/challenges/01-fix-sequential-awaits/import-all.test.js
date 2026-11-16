'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: sleep } = require('node:timers/promises');
const { load } = require('../../../_shared/load');
const { importAll } = load(__dirname, 'import-all.js');

function makeImporter(ms = 20) {
  const s = { running: 0, max: 0, calls: 0 };
  s.importOne = async (item) => {
    s.calls++;
    s.running++;
    s.max = Math.max(s.max, s.running);
    await sleep(ms);
    s.running--;
    return `done:${item}`;
  };
  return s;
}

const items = Array.from({ length: 20 }, (_, i) => i);

test('results keep the input order', async () => {
  const s = makeImporter();
  const out = await importAll(items, s.importOne);
  assert.deepEqual(out, items.map((i) => `done:${i}`));
});

test('runs items in parallel, up to the default limit of 5', async () => {
  const s = makeImporter();
  await importAll(items, s.importOne);
  assert.equal(s.max, 5);
});

test('honours a custom concurrency limit', async () => {
  const s = makeImporter();
  await importAll(items, s.importOne, { concurrency: 3 });
  assert.equal(s.max, 3);
  const s2 = makeImporter();
  await importAll(items, s2.importOne, { concurrency: 1 });
  assert.equal(s2.max, 1);
});

test('is much faster than one-by-one (400 ms sequential, about 80 ms with 5 at a time)', async () => {
  const s = makeImporter(20);
  const start = performance.now();
  await importAll(items, s.importOne);
  const elapsed = performance.now() - start;
  assert.ok(elapsed < 250, `took ${Math.round(elapsed)} ms`);
});

test('calls importOne exactly once per item', async () => {
  const s = makeImporter(5);
  await importAll(items, s.importOne);
  assert.equal(s.calls, 20);
});

test('empty input resolves to an empty array', async () => {
  assert.deepEqual(await importAll([], async () => 1), []);
});

test('the first error rejects the whole import', async () => {
  const importOne = async (item) => {
    await sleep(5);
    if (item === 7) throw new Error('bad item 7');
    return item;
  };
  await assert.rejects(importAll(items, importOne), /bad item 7/);
});
