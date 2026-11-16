// Starving the loop, and breaking long work into chunks
// Shows: recursive nextTick/microtasks block timers, recursive setImmediate does not, and chunking keeps the loop alive.
// Run: node lessons/08-event-loop/examples/10-starvation-and-chunking.js

const LIMIT = 100000;

// ---------- Part 1: who starves the timer? ----------
// Start a 0 ms timer, then run LIMIT steps where each step schedules the next one.
// Did the timer get a turn before the steps were finished?
function race(label, schedule) {
  return new Promise((resolve) => {
    let steps = 0;

    setTimeout(() => {
      const early = steps < LIMIT;
      console.log(`${label.padEnd(36)} timer ran: ${early ? 'EARLY, in between the steps' : 'only after all the steps'}`);
    }, 0);

    function step() {
      steps++;
      if (steps < LIMIT) schedule(step);
      else setTimeout(resolve, 20); // all steps are done, wait a moment so the timer can print
    }
    step();
  });
}

async function partOne() {
  console.log(`Part 1: ${LIMIT} recursive steps, and one setTimeout(fn, 0) waiting\n`);
  await race('process.nextTick recursion', (fn) => process.nextTick(fn));
  await race('promise / queueMicrotask recursion', (fn) => queueMicrotask(fn));
  await race('setImmediate recursion', (fn) => setImmediate(fn));
}

// ---------- Part 2: one long job, blocking vs chunked ----------
const TOTAL = 50_000_000;
const CHUNK = 500_000;

// A heartbeat timer that remembers the longest gap between two ticks.
function startHeartbeat() {
  let last = performance.now();
  let longest = 0;
  const id = setInterval(() => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
  }, 10);
  return () => {
    clearInterval(id);
    return longest;
  };
}

function sumBlocking() {
  let sum = 0;
  for (let i = 0; i < TOTAL; i++) sum += i % 7;
  return sum;
}

function sumInChunks() {
  return new Promise((resolve) => {
    let i = 0;
    let sum = 0;
    function chunk() {
      const end = Math.min(i + CHUNK, TOTAL);
      for (; i < end; i++) sum += i % 7;
      if (i < TOTAL) setImmediate(chunk); // let the loop run other callbacks, then continue
      else resolve(sum);
    }
    chunk();
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const round10 = (n) => Math.round(n / 10) * 10;

async function partTwo() {
  console.log(`\nPart 2: add up ${TOTAL.toLocaleString('en-US')} numbers while a heartbeat ticks every 10 ms\n`);

  let stop = startHeartbeat();
  await sleep(30);
  const t1 = performance.now();
  const blockingSum = sumBlocking();
  const blockingMs = performance.now() - t1;
  await sleep(30); // let the heartbeat record the gap
  const blockingGap = stop();

  stop = startHeartbeat();
  await sleep(30);
  const t2 = performance.now();
  const chunkedSum = await sumInChunks();
  const chunkedMs = performance.now() - t2;
  const chunkedGap = stop();

  console.log(`blocking: took ${round10(blockingMs)} ms, longest heartbeat gap ${round10(blockingGap)} ms`);
  console.log(`chunked:  took ${round10(chunkedMs)} ms, longest heartbeat gap ${round10(chunkedGap)} ms`);
  console.log('same result:', blockingSum === chunkedSum);
  console.log('chunked gap is less than half of the blocking gap:', chunkedGap < blockingGap / 2);
}

partOne().then(partTwo);
