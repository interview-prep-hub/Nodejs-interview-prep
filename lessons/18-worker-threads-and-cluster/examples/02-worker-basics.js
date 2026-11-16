// worker_threads basics: Worker, isMainThread, workerData, parentPort, postMessage
// Shows: the same file runs twice (main thread and worker thread), and the main event loop stays free while a worker computes.
// Run: node lessons/18-worker-threads-and-cluster/examples/02-worker-basics.js

const { Worker, isMainThread, parentPort, workerData, threadId } = require('node:worker_threads');

// CPU-bound job: count the primes below `limit` the slow way (about 200 ms for 600,000).
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

// ---- main thread side ----

// Wrap one worker in a promise: resolve with its first message, reject on error or a bad exit.
function runWorker(limit) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { limit } });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`worker stopped with exit code ${code}`));
    });
  });
}

async function main() {
  console.log('main: isMainThread =', isMainThread, ', threadId =', threadId);

  // Part 1: one worker, one answer.
  const one = await runWorker(100_000);
  console.log('worker answered:', one);

  // A heartbeat that counts how often the main event loop got a turn.
  let ticks = 0;
  const heartbeat = setInterval(() => ticks++, 10);

  // Part 2: the same 4 jobs, first on the main thread, one after another.
  ticks = 0;
  let started = performance.now();
  for (let i = 0; i < 4; i++) countPrimes(600_000);
  let took = Math.round(performance.now() - started);
  console.log(`\n4 jobs on the main thread : ${took} ms, heartbeat ticks during it: ${ticks}`);
  await new Promise((resolve) => setImmediate(resolve)); // let pending ticks settle

  // Part 3: the same 4 jobs, each in its own worker, all at once.
  ticks = 0;
  started = performance.now();
  const results = await Promise.all([600_000, 600_000, 600_000, 600_000].map(runWorker));
  took = Math.round(performance.now() - started);
  console.log(`4 jobs in 4 workers       : ${took} ms, heartbeat ticks during it: ${ticks}`);
  console.log('threadIds that did the work:', results.map((r) => r.threadId).sort((a, b) => a - b).join(', '));

  clearInterval(heartbeat);
}

// ---- worker thread side ----

function workerMain() {
  // workerData is a copy of the value the parent passed in the Worker options.
  const count = countPrimes(workerData.limit);
  parentPort.postMessage({ limit: workerData.limit, count, threadId, isMainThread });
}

if (isMainThread) {
  main();
} else {
  workerMain();
}
