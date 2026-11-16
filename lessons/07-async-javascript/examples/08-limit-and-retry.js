// Concurrency limit (a pool of N workers) and retry with exponential backoff
// Shows two hand-written helpers that real services need, using only promises and timers.
// Run: node lessons/07-async-javascript/examples/08-limit-and-retry.js

const delay = (ms, value) => new Promise((resolve) => setTimeout(resolve, ms, value));

// ---------------------------------------------------------------------------
// Part 1: run fn on every item, but never more than `limit` calls at the same time.
// Idea: start `limit` workers. Each worker keeps taking the next unprocessed item until none is left.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0; // index of the next item nobody has taken yet
  let failed = false;

  async function worker() {
    while (!failed && next < items.length) {
      const index = next++; // no await between reading and incrementing, so two workers never take the same item
      try {
        results[index] = await fn(items[index], index);
      } catch (err) {
        failed = true; // tell the other workers to stop taking new items
        throw err;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results; // same order as `items`
}

async function demoPool() {
  console.log('--- Part 1: pool of 3 workers for 8 tasks (each takes 200 ms)');
  const items = [0, 1, 2, 3, 4, 5, 6, 7];
  let running = 0;
  let maxRunning = 0;
  const startOrder = [];

  const task = async (n) => {
    running++;
    maxRunning = Math.max(maxRunning, running);
    startOrder.push(n);
    await delay(200);
    running--;
    return n * n;
  };

  const start = performance.now();
  const results = await mapLimit(items, 3, task);
  // Timers fire a little late, so round DOWN to a multiple of 200 ms to keep the output stable.
  const took = Math.floor((performance.now() - start + 5) / 200) * 200;

  console.log('results (input order):', results.join(' '));
  console.log('start order          :', startOrder.join(' '));
  console.log('max running at once  :', maxRunning);
  console.log('took about           :', took, 'ms (3 rounds of 200 ms; with no limit it would be 200 ms)');

  // A failing task stops the pool from taking new items.
  const seen = [];
  await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
    seen.push(n);
    await delay(10);
    if (n === 2) throw new Error('task 2 failed');
    return n;
  }).catch((err) => console.log('pool rejected with:', err.message));
  await delay(40);
  console.log('items that were started before the failure stopped the pool:', seen);
}

// ---------------------------------------------------------------------------
// Part 2: retry with exponential backoff.
// Wait baseMs, then baseMs*2, then baseMs*4 ... between attempts, capped at maxMs.
async function retry(fn, options = {}) {
  const { retries = 3, baseMs = 10, factor = 2, maxMs = 1000, jitter = false, shouldRetry = () => true, onRetry } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err; // out of retries, or not worth retrying
      let wait = Math.min(maxMs, baseMs * factor ** attempt);
      if (jitter) wait = Math.random() * wait; // "full jitter": spreads out many clients that fail together
      if (onRetry) onRetry(err, attempt + 1, wait);
      await delay(wait);
    }
  }
}

// A fake service that fails `failTimes` times, then works.
function makeFlaky(failTimes) {
  let calls = 0;
  return async () => {
    calls++;
    await delay(1);
    if (calls <= failTimes) throw new Error('temporary failure #' + calls);
    return 'success on call ' + calls;
  };
}

async function demoRetry() {
  console.log('\n--- Part 2: retry with exponential backoff (base 10 ms)');
  const onRetry = (err, n, wait) => console.log(`  retry ${n} after "${err.message}", waiting ${wait} ms`);

  console.log('fails twice, then works:');
  console.log(' ', await retry(makeFlaky(2), { retries: 3, baseMs: 10, onRetry }));

  console.log('always fails, 3 retries allowed (4 calls in total):');
  await retry(makeFlaky(99), { retries: 3, baseMs: 10, onRetry }).catch((err) => console.log('  gave up with:', err.message));

  console.log('a validation error is not worth retrying:');
  await retry(
    async () => {
      throw new TypeError('bad input');
    },
    { retries: 3, shouldRetry: (err) => !(err instanceof TypeError), onRetry },
  ).catch((err) => console.log('  gave up at once with:', err.message));

  console.log('the cap (maxMs) keeps waits from growing forever:');
  await retry(makeFlaky(99), { retries: 4, baseMs: 10, maxMs: 25, onRetry }).catch(() => {});
}

demoPool().then(demoRetry);
