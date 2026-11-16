// Event loop lag: measure it with monitorEventLoopDelay and see what blocks the loop (and what does not).
// Part 6 shows a full libuv thread pool: slow calls without any event loop lag.
// Run: node lessons/19-performance-and-memory/examples/08-event-loop-lag.js
const { monitorEventLoopDelay, performance } = require('node:perf_hooks');
const { Worker } = require('node:worker_threads');
const { setTimeout: sleep } = require('node:timers/promises');
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');

// The histogram works like a heartbeat: a timer asks to run every `resolution` ms and
// Node records how long it REALLY took between two beats. Idle loop: about `resolution`.
// A blocked loop: a very long gap. Values are in nanoseconds.
const ms = (ns) => (ns / 1e6).toFixed(0).padStart(4);

async function measure(label, work) {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  await sleep(50); // let the heartbeat start
  const loopBefore = performance.eventLoopUtilization();
  const start = performance.now();
  await work();
  const took = performance.now() - start;
  const elu = performance.eventLoopUtilization(loopBefore).utilization; // share of time the loop was busy
  await sleep(50); // let a late heartbeat arrive
  histogram.disable();
  console.log(
    label.padEnd(34),
    'work', took.toFixed(0).padStart(4), 'ms | gap between beats: p50', ms(histogram.percentile(50)),
    'p99', ms(histogram.percentile(99)), 'max', ms(histogram.max), '| loop busy', (elu * 100).toFixed(0).padStart(3) + '%',
  );
  return histogram.max / 1e6;
}

function busyFor(milliseconds) {
  const end = performance.now() + milliseconds;
  while (performance.now() < end); // keeps the one JavaScript thread busy
}

const PBKDF2_ITERATIONS = 350_000; // chosen so that one hash takes a few hundred ms

(async () => {
  const idle = await measure('1. idle (just waiting)', () => sleep(300));
  const busy = await measure('2. busy loop, 300 ms', async () => {
    await sleep(0);
    busyFor(300);
  });
  const syncHash = await measure('3. crypto.pbkdf2Sync', async () => {
    await sleep(0);
    crypto.pbkdf2Sync('password', 'salt', PBKDF2_ITERATIONS, 64, 'sha512'); // runs on the main thread
  });
  const asyncHash = await measure('4. crypto.pbkdf2 (async)', () =>
    new Promise((resolve, reject) => {
      // the hash runs in libuv's thread pool, the event loop stays free
      crypto.pbkdf2('password', 'salt', PBKDF2_ITERATIONS, 64, 'sha512', (err) => (err ? reject(err) : resolve()));
    }),
  );
  const worker = await measure('5. busy loop in a worker thread', () =>
    new Promise((resolve) => {
      const w = new Worker('const end = Date.now() + 300; while (Date.now() < end);', { eval: true });
      w.on('exit', resolve);
    }),
  );

  console.log('\nlongest gap while the work ran on the main thread (rows 2 and 3):', Math.round(busy), 'and', Math.round(syncHash), 'ms');
  console.log('longest gap when the work was moved off the main thread (rows 4 and 5):', Math.round(asyncHash), 'and', Math.round(worker), 'ms');
  console.log('longest gap when idle (the noise level of this machine):', Math.round(idle), 'ms');
  console.log('blocking made the gap at least 4 times bigger than idle:', busy > idle * 4 && syncHash > idle * 4);

  threadPoolDemo();
})();

// ---- Part 6: a full thread pool is slowness WITHOUT event loop lag -----------------------
// libuv's thread pool has 4 threads by default (fs, dns.lookup, crypto.pbkdf2/scrypt, zlib use it).
// Start 8 hashes at the same moment: 4 run, 4 wait for a free thread. The loop itself stays free.
// The pool size can only be set from the environment BEFORE the process starts (UV_THREADPOOL_SIZE),
// so each run below is a child process.
function threadPoolDemo() {
  const childCode = `
    const crypto = require('node:crypto');
    const start = performance.now();
    const done = [];
    for (let i = 0; i < 8; i++) {
      crypto.pbkdf2('password', 'salt', 100000, 64, 'sha512', () => {
        done.push(Math.round(performance.now() - start));
        if (done.length === 8) console.log(done.join(' '));
      });
    }`;
  console.log('\n6. thread pool: 8 async pbkdf2 jobs started at the same moment (finish time of each, in ms)');
  for (const [label, poolSize] of [['UV_THREADPOOL_SIZE=1', '1'], ['default pool (4 threads)', undefined], ['UV_THREADPOOL_SIZE=8', '8']]) {
    const env = { ...process.env };
    delete env.UV_THREADPOOL_SIZE;
    if (poolSize) env.UV_THREADPOOL_SIZE = poolSize;
    const out = spawnSync(process.execPath, ['-e', childCode], { env, encoding: 'utf8' });
    console.log('  ' + label.padEnd(26), out.stdout.trim());
  }
  console.log('  (1 thread: one job after the other. 4 threads: two waves, the second wave waits for a free thread.');
  console.log('   8 threads: one wave, if the machine has enough free CPU cores. On a busy machine the waves blur.)');
}
