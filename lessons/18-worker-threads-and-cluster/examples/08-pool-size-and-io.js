// How many workers? And when threads do NOT help
// Shows: CPU-bound batches speed up until the pool size reaches the CPU count, and I/O-bound batches do not need threads at all.
// Run: node lessons/18-worker-threads-and-cluster/examples/08-pool-size-and-io.js
// Uses the pool from _worker-pool.js and the worker script _pool-worker.js (same folder).

const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { WorkerPool } = require('./_worker-pool');

const workerFile = path.join(__dirname, '_pool-worker.js');
const cores = os.availableParallelism();

// Make sure every worker of the pool has started, so startup time is not part of the measurement.
async function warmUp(pool, size, task) {
  await Promise.all(Array.from({ length: size }, () => pool.run(task)));
}

async function timeBatch(pool, tasks) {
  const started = performance.now();
  await Promise.all(tasks.map((task) => pool.run(task)));
  return Math.round(performance.now() - started);
}

async function main() {
  console.log(`os.availableParallelism() = ${cores}, os.cpus().length = ${os.cpus().length}`);

  console.log('\n--- Part 1: 24 CPU-bound tasks with different pool sizes ---');
  const cpuTasks = Array.from({ length: 24 }, () => ({ type: 'primes', limit: 80_000 }));
  const sizes = [...new Set([1, 2, 4, cores, cores * 2])].filter((s) => s <= 32).sort((a, b) => a - b);
  const part1Started = performance.now();
  for (const size of sizes) {
    // Safety net for slow or busy machines: starting many workers takes long there, and an example must end quickly.
    if (performance.now() - part1Started > 3000) {
      console.log('(this machine is slow right now, so the remaining pool sizes are skipped to stay under 10 seconds)');
      break;
    }
    const pool = new WorkerPool(workerFile, size);
    await warmUp(pool, size, { type: 'primes', limit: 10 });
    const ms = await timeBatch(pool, cpuTasks);
    const note = size === cores ? '  <- one worker per core' : size > cores ? '  <- more workers than cores' : '';
    console.log(`pool of ${String(size).padStart(2)} workers: ${String(ms).padStart(5)} ms${note}`);
    await pool.close();
  }

  console.log('\n--- Part 2: 16 I/O-bound tasks (each waits 200 ms for a local server) ---');
  const server = http.createServer((req, res) => setTimeout(() => res.end('ok'), 200));
  await new Promise((resolve) => server.listen(0, resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;

  await fetch(url).then((r) => r.text()); // warm-up: the first fetch loads some code
  const started = performance.now();
  await Promise.all(Array.from({ length: 16 }, () => fetch(url).then((r) => r.text())));
  console.log(`${'one thread, 16 requests at once'.padEnd(33)}: ${Math.round(performance.now() - started)} ms`);

  const pool = new WorkerPool(workerFile, 4);
  await warmUp(pool, 4, { type: 'fetch', url });
  const ioTasks = Array.from({ length: 16 }, () => ({ type: 'fetch', url }));
  const ms = await timeBatch(pool, ioTasks);
  console.log(`${'pool of 4 workers, 1 request each'.padEnd(33)}: ${ms} ms (each worker handles one task at a time)`);
  await pool.close();
  server.close();
}

main();
