// Blocking the event loop
// Shows: four ways to freeze the loop (CPU loop, sync crypto, huge JSON.parse, bad regex) and how a heartbeat timer sees it.
// Run: node lessons/08-event-loop/examples/08-blocking-the-loop.js

const crypto = require('node:crypto');

const INTERVAL = 10; // the heartbeat should tick every 10 ms

// The heartbeat: a timer that remembers the longest gap between two ticks.
// If the loop is free, the gap is about 10 ms. If the loop is blocked, the gap grows.
let lastTick = performance.now();
let longestGap = 0;
const heartbeat = setInterval(() => {
  const now = performance.now();
  longestGap = Math.max(longestGap, now - lastTick);
  lastTick = now;
}, INTERVAL);

// The same hashing job as test 2, but on the libuv thread pool.
const pbkdf2Async = () =>
  new Promise((resolve, reject) => {
    crypto.pbkdf2('password', 'salt', 300000, 64, 'sha512', (err) => (err ? reject(err) : resolve()));
  });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs one task, waits so the heartbeat can notice, then prints the longest gap it saw.
async function measure(label, task) {
  await sleep(50);
  longestGap = 0;
  lastTick = performance.now();
  await task(); // sync tasks block here, async tasks return a promise
  await sleep(50); // give the heartbeat a chance to tick once and record the gap
  const gap = Math.round(longestGap / 10) * 10; // rounded to 10 ms
  console.log(label.padEnd(50) + `longest gap between heartbeats: ${gap} ms`);
}

async function main() {
  // Prepare test data (this part is not measured).
  const bigJson = JSON.stringify(Array.from({ length: 300000 }, (_, i) => ({ id: i, name: 'user' + i, tags: ['a', 'b'] })));

  console.log(`heartbeat: a timer every ${INTERVAL} ms\n`);

  await measure('1. while loop that runs for 200 ms', () => {
    const end = Date.now() + 200;
    while (Date.now() < end) {
      // busy
    }
  });

  await measure('2. crypto.pbkdf2Sync (sync, on the loop thread)', () => {
    crypto.pbkdf2Sync('password', 'salt', 300000, 64, 'sha512');
  });

  await measure('3. crypto.pbkdf2 (async, thread pool)', () => pbkdf2Async());

  await measure(`4. JSON.parse of a ${Math.round(bigJson.length / 1e6)} MB string`, () => {
    JSON.parse(bigJson);
  });

  await measure('5. regex /^(a+)+$/ on "aaaa...a!" (n = 22)', () => {
    /^(a+)+$/.test('a'.repeat(22) + '!');
  });

  clearInterval(heartbeat);
}

main();
