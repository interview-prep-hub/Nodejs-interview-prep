// Fake time: t.mock.timers fakes setTimeout, setInterval, setImmediate and Date, so tests never wait for real.
// Run: node --test lessons/16-testing/examples/05-mock-timers.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { debounce, retry, withTimeout, createTtlCache } = require('./_lib/timing.js');

// Mocked timers do not run promise callbacks. After tick(), let the real event loop turn once
// so that code waiting on a promise can continue. setImmediate is NOT mocked in these tests.
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('debounce with a fake setTimeout', () => {
  it('calls the function once, after the quiet period', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fn = t.mock.fn();
    const search = debounce(fn, 300);

    search('a');
    t.mock.timers.tick(200); // 200 ms later the user types again
    search('ab');
    t.mock.timers.tick(299); // not yet 300 ms since the last call
    assert.equal(fn.mock.callCount(), 0);

    t.mock.timers.tick(1); // now it is exactly 300 ms
    assert.equal(fn.mock.callCount(), 1);
    assert.deepEqual(fn.mock.calls[0].arguments, ['ab']);
  });
});

describe('createTtlCache with a fake Date', () => {
  it('forgets an entry once its time to live has passed', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
    const cache = createTtlCache(5000);

    cache.set('token', 'abc');
    t.mock.timers.tick(4999);
    assert.equal(cache.get('token'), 'abc');

    t.mock.timers.tick(1);
    assert.equal(cache.get('token'), undefined);
  });

  it('gives you a fixed date to compare with', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-01-01T00:00:00Z') });

    assert.equal(new Date().toISOString(), '2030-01-01T00:00:00.000Z');
    t.mock.timers.tick(60_000);
    assert.equal(new Date().toISOString(), '2030-01-01T00:01:00.000Z');
  });
});

describe('retry with fake waiting', () => {
  it('waits 100 ms, then 200 ms, then succeeds', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const task = t.mock.fn((attempt) => {
      if (attempt < 2) throw new Error(`fail ${attempt}`);
      return 'ok';
    });

    const result = retry(task, { retries: 3, delayMs: 100 });

    await flush();
    assert.equal(task.mock.callCount(), 1); // first try failed, now "sleeping" 100 ms
    t.mock.timers.tick(99);
    await flush();
    assert.equal(task.mock.callCount(), 1); // still sleeping
    t.mock.timers.tick(1);
    await flush();
    assert.equal(task.mock.callCount(), 2); // second try failed, now sleeping 200 ms
    t.mock.timers.tick(200);

    assert.equal(await result, 'ok');
    assert.equal(task.mock.callCount(), 3);
  });

  it('gives up after the last retry and throws the last error', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const task = t.mock.fn(() => {
      throw new Error('always broken');
    });

    const result = retry(task, { retries: 1, delayMs: 50 });
    const check = assert.rejects(result, { message: 'always broken' }); // attach the handler first

    await flush();
    t.mock.timers.tick(50);
    await check;
    assert.equal(task.mock.callCount(), 2);
  });
});

describe('withTimeout', () => {
  it('rejects when the promise is too slow', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const neverEnds = new Promise(() => {});

    const check = assert.rejects(withTimeout(neverEnds, 1000), { message: 'timed out after 1000ms' });
    t.mock.timers.tick(1000);

    await check;
  });

  it('passes the value through when the promise is fast enough', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });

    assert.equal(await withTimeout(Promise.resolve('fast'), 1000), 'fast');
  });
});

describe('setInterval and runAll', () => {
  it('fires an interval once per period', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    let beats = 0;
    const id = setInterval(() => beats++, 100);

    t.mock.timers.tick(350);

    assert.equal(beats, 3); // at 100, 200 and 300 ms
    clearInterval(id);
  });

  it('runAll() jumps straight to the last pending timer', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fired = [];
    setTimeout(() => fired.push('one second'), 1000);
    setTimeout(() => fired.push('one minute'), 60_000);

    t.mock.timers.runAll();

    assert.deepEqual(fired, ['one second', 'one minute']);
  });
});
