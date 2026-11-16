// Helper (not run by itself): the worker script used by the pool examples.
// It waits for task messages, runs them one at a time and sends back { ok, value } or { ok: false, error }.

const { parentPort, threadId } = require('node:worker_threads');

// CPU-bound job: count the primes below `limit` the slow way.
function countPrimes(limit) {
  let count = 0;
  for (let n = 2; n < limit; n++) {
    let isPrime = true;
    for (let d = 2; d * d <= n; d++) {
      if (n % d === 0) {
        isPrime = false;
        break;
      }
    }
    if (isPrime) count++;
  }
  return count;
}

// One function per task type. A task is a plain object like { type: 'primes', limit: 100000 }.
const handlers = {
  primes: ({ limit }) => ({ count: countPrimes(limit), threadId }),
  // I/O-bound job: ask a local server and wait for the answer.
  fetch: async ({ url }) => {
    const res = await fetch(url);
    await res.text();
    return { status: res.status, threadId };
  },
};

parentPort.on('message', async (task) => {
  // A real bug that nobody catches: it kills this worker, and the pool must cope with that.
  if (task.type === 'crash') throw new Error('simulated bug in the worker');
  try {
    const handler = handlers[task.type];
    if (!handler) throw new Error(`unknown task type: ${task.type}`);
    parentPort.postMessage({ ok: true, value: await handler(task) });
  } catch (err) {
    // An expected failure: report it, keep the worker alive for the next task.
    parentPort.postMessage({ ok: false, error: err.message });
  }
});
