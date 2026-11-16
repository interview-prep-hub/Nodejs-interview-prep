// CPU-heavy work blocks the one JavaScript thread. A worker thread fixes that.
// Run: node lessons/01-introduction/examples/11-cpu-vs-worker.js

const { Worker, isMainThread, parentPort } = require('node:worker_threads');

const LIMIT = 1_000_000;

// Deliberately slow, plain CPU work: count the prime numbers below `limit`.
function countPrimes(limit) {
  let count = 0;
  for (let n = 2; n < limit; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) {
      if (n % d === 0) {
        prime = false;
        break;
      }
    }
    if (prime) count++;
  }
  return count;
}

async function main() {
  // A heartbeat: a timer that wants to run every 10 ms, as long as the event loop is free.
  let ticks = 0;
  const heartbeat = setInterval(() => ticks++, 10);

  // A) Do the work on the main thread. While it runs, no timer callback can run.
  const primes = countPrimes(LIMIT);
  console.log(`A. main thread counted ${primes} primes`);
  console.log('   heartbeat ticks while the main thread was busy:', ticks);

  // B) Do the same work in a worker thread. The main thread stays free.
  ticks = 0;
  const fromWorker = await new Promise((resolve, reject) => {
    const worker = new Worker(__filename); // runs THIS file again, in a new thread
    worker.once('message', resolve);
    worker.once('error', reject);
  });
  console.log(`\nB. worker thread counted ${fromWorker} primes`);
  console.log('   heartbeat kept ticking (3 or more ticks):', ticks >= 3);

  clearInterval(heartbeat);
}

if (isMainThread) {
  main();
} else {
  // This branch runs inside the worker thread.
  parentPort.postMessage(countPrimes(LIMIT));
}
