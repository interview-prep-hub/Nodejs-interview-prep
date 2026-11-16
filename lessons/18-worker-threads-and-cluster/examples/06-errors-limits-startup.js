// Worker life cycle: error and exit events, terminate, resourceLimits, startup cost
// Shows: what the parent sees when a worker throws, exits, is killed, runs out of memory, and how long a worker takes to start.
// Run: node lessons/18-worker-threads-and-cluster/examples/06-errors-limits-startup.js

const { Worker } = require('node:worker_threads');

// Starts a worker from a code string and resolves with the list of events the parent saw, in order.
function watch(code, options = {}) {
  const worker = new Worker(code, { eval: true, ...options });
  const events = [];
  worker.on('online', () => events.push('online'));
  worker.on('message', (m) => events.push(`message: ${m}`));
  worker.on('error', (err) => events.push(`error: ${err.code ? err.code + ' - ' : ''}${err.message}`));
  worker.on('exit', (code) => events.push(`exit: code ${code}`));
  const finished = new Promise((resolve) => worker.on('exit', () => resolve(events)));
  return { worker, finished };
}

function show(title, events) {
  console.log(title);
  for (const e of events) console.log('   ', e);
}

async function main() {
  show('1. the worker throws an error', await watch(`throw new Error('boom inside the worker');`).finished);

  show('2. the worker has an unhandled promise rejection', await watch(`Promise.reject(new Error('rejected inside the worker'));`).finished);

  show('3. the worker calls process.exit(3) (it ends the worker thread only)', await watch(`process.exit(3);`).finished);

  show('4. the worker ends normally', await watch(`require('node:worker_threads').parentPort.postMessage('all done');`).finished);

  // 5. terminate(): stop a worker that never ends by itself.
  const loop = watch(`setInterval(() => {}, 1000);`); // a timer keeps this worker alive forever
  await new Promise((resolve) => loop.worker.once('online', resolve));
  const exitCode = await loop.worker.terminate(); // returns a promise for the exit code
  show(`5. terminate() on a worker that never ends (terminate resolved with ${exitCode})`, await loop.finished);

  // 6. resourceLimits: give the worker a small heap and let it leak.
  const leak = watch(
    `const keep = []; while (true) keep.push(new Array(10000).fill('x'));`,
    { resourceLimits: { maxOldGenerationSizeMb: 16 } },
  );
  show('6. leaking worker with resourceLimits.maxOldGenerationSizeMb = 16', await leak.finished);
  console.log('    (the main thread did not crash, it just keeps running)');

  // 7. startup cost: time from "new Worker" until the worker's first message reaches us.
  const samples = [];
  for (let i = 0; i < 5; i++) {
    const started = performance.now();
    const w = new Worker(`require('node:worker_threads').parentPort.postMessage('hi');`, { eval: true });
    await new Promise((resolve) => w.once('message', resolve));
    samples.push(performance.now() - started);
    await w.terminate();
  }
  const average = samples.reduce((a, b) => a + b, 0) / samples.length;
  console.log(`\n7. startup: first message after about ${Math.round(average)} ms on average (a normal function call takes microseconds)`);

  // 8. memory cost: start 8 idle workers and look at the process memory.
  const before = process.memoryUsage.rss();
  const idle = [];
  for (let i = 0; i < 8; i++) {
    const w = new Worker(`setInterval(() => {}, 1000);`, { eval: true });
    await new Promise((resolve) => w.once('online', resolve));
    idle.push(w);
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  const perWorkerMb = (process.memoryUsage.rss() - before) / idle.length / 1024 / 1024;
  console.log(`8. memory: 8 idle workers added about ${perWorkerMb.toFixed(1)} MB each (very rough, varies by machine)`);
  await Promise.all(idle.map((w) => w.terminate()));
}

main();
