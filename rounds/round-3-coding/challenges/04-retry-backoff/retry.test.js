'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../../../_shared/load');
const { retry } = load(__dirname, 'retry.js');

function flaky(failTimes) {
  const f = async (attempt) => {
    f.calls.push(attempt);
    if (f.calls.length <= failTimes) throw new Error(`fail ${f.calls.length}`);
    return 'ok';
  };
  f.calls = [];
  return f;
}

function fakeSleep() {
  const delays = [];
  const sleep = async (ms) => {
    delays.push(ms);
  };
  return { sleep, delays };
}

test('returns the value without sleeping when the first call works', async () => {
  const { sleep, delays } = fakeSleep();
  const f = flaky(0);
  assert.equal(await retry(f, { sleep }), 'ok');
  assert.deepEqual(f.calls, [1]);
  assert.deepEqual(delays, []);
});

test('passes the attempt number (starting at 1) to fn', async () => {
  const { sleep } = fakeSleep();
  const f = flaky(2);
  await retry(f, { sleep });
  assert.deepEqual(f.calls, [1, 2, 3]);
});

test('uses exponential backoff delays', async () => {
  const { sleep, delays } = fakeSleep();
  await retry(flaky(3), { retries: 3, baseDelay: 100, factor: 2, sleep });
  assert.deepEqual(delays, [100, 200, 400]);
});

test('caps delays at maxDelay', async () => {
  const { sleep, delays } = fakeSleep();
  await retry(flaky(4), { retries: 4, baseDelay: 100, factor: 10, maxDelay: 500, sleep });
  assert.deepEqual(delays, [100, 500, 500, 500]);
});

test('gives up after `retries` extra attempts and rethrows the last error', async () => {
  const { sleep } = fakeSleep();
  const f = flaky(100);
  await assert.rejects(retry(f, { retries: 2, sleep }), /fail 3/);
  assert.equal(f.calls.length, 3);
});

test('retries: 0 means a single attempt', async () => {
  const { sleep, delays } = fakeSleep();
  const f = flaky(1);
  await assert.rejects(retry(f, { retries: 0, sleep }), /fail 1/);
  assert.equal(f.calls.length, 1);
  assert.deepEqual(delays, []);
});

test('jitter multiplies each delay by random()', async () => {
  const { sleep, delays } = fakeSleep();
  await retry(flaky(2), { baseDelay: 100, factor: 2, jitter: true, random: () => 0.5, sleep });
  assert.deepEqual(delays, [50, 100]);
});

test('shouldRetry(error, attempt) can stop retrying immediately', async () => {
  const { sleep, delays } = fakeSleep();
  const seen = [];
  const f = flaky(100);
  await assert.rejects(
    retry(f, {
      sleep,
      shouldRetry: (error, attempt) => {
        seen.push(attempt);
        return false;
      },
    }),
    /fail 1/,
  );
  assert.equal(f.calls.length, 1);
  assert.deepEqual(seen, [1]);
  assert.deepEqual(delays, []);
});

test('an aborted signal stops retrying with an AbortError', async () => {
  const controller = new AbortController();
  const f = flaky(100);
  const sleep = async () => controller.abort();
  await assert.rejects(retry(f, { sleep, signal: controller.signal }), (err) => err.name === 'AbortError');
  assert.equal(f.calls.length, 1);
});

test('works with the real timer too (small delays)', async () => {
  const f = flaky(1);
  assert.equal(await retry(f, { baseDelay: 5 }), 'ok');
  assert.equal(f.calls.length, 2);
});
