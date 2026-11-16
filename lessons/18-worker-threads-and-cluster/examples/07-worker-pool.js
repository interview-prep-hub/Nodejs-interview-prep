// A reusable worker pool with a task queue
// Shows: 8 tasks on 3 workers (the rest wait in a queue), a failing task, a crashing worker that gets replaced.
// Run: node lessons/18-worker-threads-and-cluster/examples/07-worker-pool.js
// The pool itself lives in _worker-pool.js and the worker script in _pool-worker.js (same folder).

const path = require('node:path');
const { WorkerPool } = require('./_worker-pool');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const pool = new WorkerPool(path.join(__dirname, '_pool-worker.js'), 3);
  console.log('new pool          :', pool.stats);

  console.log('\n--- 8 tasks, 3 workers ---');
  const jobs = [];
  for (let i = 1; i <= 8; i++) {
    jobs.push(pool.run({ type: 'primes', limit: 100_000 * i }).then((result) => ({ task: i, ...result })));
  }
  console.log('just submitted 8  :', pool.stats);

  const results = await Promise.all(jobs); // results are in submit order, whatever order they finished in
  for (const r of results) console.log(`task ${r.task}: ${String(r.count).padStart(5)} primes below ${r.task * 100_000}`);
  console.log('threads used      :', [...new Set(results.map((r) => r.threadId))].sort((a, b) => a - b).join(', '));
  console.log('all finished      :', pool.stats);

  console.log('\n--- a task that fails (the worker survives) ---');
  await pool.run({ type: 'nope' }).catch((err) => console.log('rejected with    :', err.message));
  console.log('pool             :', pool.stats);

  console.log('\n--- a task that crashes its worker ---');
  await pool.run({ type: 'crash' }).catch((err) => console.log('rejected with    :', err.message));
  await sleep(200); // give the pool a moment to start the replacement worker
  console.log('pool             :', pool.stats, '(a new worker replaced the dead one)');

  const after = await Promise.all([1, 2, 3].map(() => pool.run({ type: 'primes', limit: 50_000 })));
  console.log('still works      :', after.map((r) => r.count).join(', '), 'primes (same answer 3 times)');

  await pool.close();
  console.log('\npool closed:', pool.stats);
}

main();
