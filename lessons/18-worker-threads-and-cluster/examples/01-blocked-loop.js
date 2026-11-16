// CPU-bound vs I/O-bound: what freezes the event loop?
// Shows: a heartbeat timer ticks every 10 ms. Plain JavaScript work freezes it, waiting for I/O or native async work does not.
// Run: node lessons/18-worker-threads-and-cluster/examples/01-blocked-loop.js

const crypto = require('node:crypto');
const http = require('node:http');

const INTERVAL = 10; // the heartbeat should tick every 10 ms

// The heartbeat remembers the longest gap between two ticks.
// A free loop gives about 10 ms. A blocked loop gives a much bigger gap.
let lastTick = performance.now();
let longestGap = 0;
const heartbeat = setInterval(() => {
  const now = performance.now();
  longestGap = Math.max(longestGap, now - lastTick);
  lastTick = now;
}, INTERVAL);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// CPU-bound work: count the prime numbers below `limit` the slow way.
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

// Runs one task and prints how long the heartbeat was frozen while it ran.
async function measure(label, task) {
  await sleep(50); // let the heartbeat settle
  longestGap = 0;
  lastTick = performance.now();
  const started = performance.now();
  await task();
  const took = Math.round(performance.now() - started);
  await sleep(30); // one more chance for the heartbeat to record the gap
  const gap = Math.round(longestGap / 10) * 10;
  console.log(`${label.padEnd(46)} took ${String(took).padStart(4)} ms, heartbeat gap ${String(gap).padStart(4)} ms`);
}

async function main() {
  // A tiny local server that answers after 150 ms. It plays the role of "a slow database".
  const server = http.createServer((req, res) => setTimeout(() => res.end('done'), 150));
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text()); // warm-up: the first fetch loads some code

  console.log(`heartbeat: a timer every ${INTERVAL} ms\n`);

  await measure('1. CPU: countPrimes(600,000) in JS', () => {
    countPrimes(600_000);
  });

  await measure('2. I/O: wait for a slow local HTTP answer', () => fetch(`http://127.0.0.1:${port}/`).then((r) => r.text()));

  await measure('3. native async: crypto.pbkdf2 (libuv pool)', () => {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2('password', 'salt', 200_000, 64, 'sha512', (err) => (err ? reject(err) : resolve()));
    });
  });

  await measure('4. native sync: crypto.pbkdf2Sync (same job)', () => {
    crypto.pbkdf2Sync('password', 'salt', 200_000, 64, 'sha512');
  });

  clearInterval(heartbeat);
  server.close();
}

main();
