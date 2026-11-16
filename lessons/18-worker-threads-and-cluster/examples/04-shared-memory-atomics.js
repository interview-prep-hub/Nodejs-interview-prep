// SharedArrayBuffer and Atomics: a counter race, its fix, and wait/notify
// Shows: 4 workers adding to one shared number lose updates with "++" and lose none with Atomics.add.
// Run: node lessons/18-worker-threads-and-cluster/examples/04-shared-memory-atomics.js

const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

const WORKERS = 4;
const TIMES = 500_000; // increments per worker

// ---- main thread side ----

// Starts WORKERS workers that all add to the same shared number. Returns the final value.
async function runCounter(mode) {
  const shared = new SharedArrayBuffer(8); // 8 bytes, visible to every thread that receives it
  const cells = new Int32Array(shared); // cells[0] = the counter, cells[1] = a "start gate" (0 = closed, 1 = open)
  const ready = [];
  const exits = [];
  for (let i = 0; i < WORKERS; i++) {
    const worker = new Worker(__filename, { workerData: { mode, shared, times: TIMES } });
    ready.push(new Promise((resolve) => worker.once('message', resolve)));
    exits.push(new Promise((resolve) => worker.once('exit', resolve)));
  }
  await Promise.all(ready); // every worker has started and waits at the gate
  Atomics.store(cells, 1, 1); // open the gate ...
  Atomics.notify(cells, 1); // ... and wake all sleepers, so they really run at the same moment
  await Promise.all(exits);
  return cells[0];
}

async function main() {
  const expected = WORKERS * TIMES;

  console.log('--- Part 1: plain "counter[0]++" from 4 threads ---');
  const racy = await runCounter('plain');
  console.log(`expected ${expected}, got ${racy}, lost ${expected - racy} updates (the number changes every run)`);

  console.log('\n--- Part 2: Atomics.add(counter, 0, 1) ---');
  const safe = await runCounter('atomic');
  console.log(`expected ${expected}, got ${safe}, lost ${expected - safe} updates`);

  console.log('\n--- Part 3: Atomics.wait and Atomics.notify ---');
  const flag = new Int32Array(new SharedArrayBuffer(4)); // 0 = not ready, 1 = ready
  const waiter = new Worker(__filename, { workerData: { mode: 'wait', shared: flag.buffer } });
  const done = new Promise((resolve) => waiter.once('exit', resolve));
  waiter.on('message', async (msg) => {
    console.log('worker says:', msg);
    if (msg !== 'about to wait') return;
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the worker really start waiting
    Atomics.store(flag, 0, 1); // 1) change the value
    const woken = Atomics.notify(flag, 0); // 2) wake the sleeper(s)
    console.log('main: stored 1 and woke', woken, 'waiting thread');
  });
  await done;

  console.log('\n--- Part 4: Atomics.wait on the MAIN thread freezes the event loop ---');
  let ticks = 0;
  const heartbeat = setInterval(() => ticks++, 10);
  const started = performance.now();
  const result = Atomics.wait(flag, 0, 1, 100); // value is 1 and we expect 1, so it sleeps for the full 100 ms
  console.log(`Atomics.wait returned '${result}' after ${Math.round(performance.now() - started)} ms, ticks while blocked: ${ticks}`);
  await new Promise((resolve) => setTimeout(resolve, 55));
  clearInterval(heartbeat);
  console.log('ticks after the loop got its turn back:', ticks > 0 ? 'it ticks again' : 'still 0');
}

// ---- worker thread side ----

function workerMain() {
  const { mode, shared, times } = workerData;
  const counter = new Int32Array(shared);

  if (mode === 'plain' || mode === 'atomic') {
    parentPort.postMessage('ready');
    Atomics.wait(counter, 1, 0); // sleep while the gate (cell 1) is 0
    if (mode === 'plain') {
      for (let i = 0; i < times; i++) counter[0]++; // read, add, write: three steps, not one
    } else {
      for (let i = 0; i < times; i++) Atomics.add(counter, 0, 1); // one indivisible step
    }
  } else if (mode === 'wait') {
    parentPort.postMessage('about to wait');
    // Sleep while counter[0] is 0. Returns 'ok' when notified, 'not-equal' if the value was already different,
    // and 'timed-out' when the optional timeout (in ms) runs out.
    parentPort.postMessage(`first wait  -> ${Atomics.wait(counter, 0, 0)}`);
    parentPort.postMessage(`second wait -> ${Atomics.wait(counter, 0, 0)} (value is already ${counter[0]})`);
    parentPort.postMessage(`third wait  -> ${Atomics.wait(counter, 0, 1, 50)} (nobody notifies, 50 ms timeout)`);
  }
}

if (isMainThread) {
  main();
} else {
  workerMain();
}
