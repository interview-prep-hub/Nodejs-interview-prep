// The libuv thread pool: how its size changes the speed of 8 crypto jobs
// Shows: crypto.pbkdf2 runs on the thread pool, so with 4 threads 8 jobs finish in two waves of 4.
// Run: node lessons/08-event-loop/examples/06-threadpool-size.js

const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const JOBS = 8;
const ITERATIONS = 100000; // one job takes roughly 100 to 150 ms of CPU time

// ---- Child mode: start 8 jobs at once and print when each one finished ----
function child() {
  const start = performance.now();
  const finished = [];
  for (let i = 0; i < JOBS; i++) {
    crypto.pbkdf2('password', 'salt', ITERATIONS, 64, 'sha512', () => {
      finished.push(performance.now() - start);
      if (finished.length === JOBS) {
        // round to the nearest 10 ms so the pattern is easy to see
        console.log(JSON.stringify(finished.map((ms) => Math.round(ms / 10) * 10)));
      }
    });
  }
}

// ---- Parent mode: run the child with different pool sizes ----
function runChild(poolSize) {
  const env = { ...process.env };
  delete env.UV_THREADPOOL_SIZE; // start clean so a value in your own shell does not interfere
  if (poolSize) env.UV_THREADPOOL_SIZE = String(poolSize);
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [__filename, 'child'], { env }, (err, stdout) => {
      if (err) reject(err);
      else resolve(JSON.parse(stdout));
    });
  });
}

async function parent() {
  console.log(`${JOBS} pbkdf2 jobs started at the same time. Finish times in ms (rounded to 10):\n`);
  for (const [label, size] of [['1', 1], ['2', 2], ['4 (the default)', null], ['8', 8]]) {
    const times = await runChild(size);
    console.log(`pool size ${label}`.padEnd(28) + times.join(' '));
  }
}

if (process.argv[2] === 'child') child();
else parent();
