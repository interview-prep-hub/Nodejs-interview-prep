// child_process.fork() vs worker_threads, side by side
// Shows: a child process has its own PID and memory, a worker thread lives inside the same process; plus message formats and startup cost.
// Run: node lessons/18-worker-threads-and-cluster/examples/11-fork-vs-worker.js
// The forked script is _fork-child.js (same folder).

const { fork } = require('node:child_process');
const { Worker } = require('node:worker_threads');
const path = require('node:path');

const childFile = path.join(__dirname, '_fork-child.js');

globalThis.shared = 'set by the main thread'; // a plain global variable in the main thread

// Code for a worker given as a string: it reports who it is, then answers kind-questions like the fork child does.
const workerCode = `
  const { parentPort, workerData } = require('node:worker_threads');
  parentPort.postMessage({ type: 'ready', pid: process.pid, sees: String(globalThis.shared) });
  parentPort.on('message', (msg) => {
    if (msg.sab) {
      new Int32Array(msg.sab)[0] = 99; // write into the memory we share with the parent
      parentPort.postMessage({ type: 'wrote' });
    } else {
      parentPort.postMessage({ type: 'kinds', mapIsMap: msg.map instanceof Map, dateIsDate: msg.date instanceof Date });
    }
  });
`;

function startFork(options) {
  const started = performance.now();
  const child = fork(childFile, [], options);
  const ready = new Promise((resolve) => child.once('message', (m) => resolve({ ...m, ms: performance.now() - started })));
  return { child, ready };
}

function startWorker() {
  const started = performance.now();
  const worker = new Worker(workerCode, { eval: true });
  const ready = new Promise((resolve) => worker.once('message', (m) => resolve({ ...m, ms: performance.now() - started })));
  return { worker, ready };
}

const nextMessage = (emitter) => new Promise((resolve) => emitter.once('message', resolve));

async function main() {
  console.log('--- Part 1: who runs where? ---');
  const f = startFork();
  const w = startWorker();
  const [forkInfo, workerInfo] = await Promise.all([f.ready, w.ready]);

  const row = (name, pid, same, sees) => console.log(`${name.padEnd(14)} pid ${String(pid).padEnd(6)} same process as main: ${String(same).padEnd(5)} sees main's global: ${sees}`);
  row('main thread', process.pid, true, globalThis.shared);
  row('Worker', workerInfo.pid, workerInfo.pid === process.pid, workerInfo.sees);
  row('fork() child', forkInfo.pid, forkInfo.pid === process.pid, forkInfo.sees);
  console.log(`the forked child's parent pid is the main pid: ${forkInfo.ppid === process.pid}`);

  console.log('\n--- Part 2: what happens to a Map and a Date in a message? ---');
  const sample = { map: new Map([['k', 1]]), date: new Date(0) };

  f.child.send(sample); // default fork serialization is JSON
  let kinds = await nextMessage(f.child);
  console.log(`fork, default (JSON)   : Map stays Map: ${kinds.mapIsMap}, Date stays Date: ${kinds.dateIsDate}`);

  const advanced = startFork({ serialization: 'advanced' }); // 'advanced' uses the structured clone algorithm
  await advanced.ready;
  advanced.child.send(sample);
  kinds = await nextMessage(advanced.child);
  console.log(`fork, 'advanced'       : Map stays Map: ${kinds.mapIsMap}, Date stays Date: ${kinds.dateIsDate}`);

  w.worker.postMessage(sample); // workers always use the structured clone algorithm
  kinds = await nextMessage(w.worker);
  console.log(`Worker postMessage     : Map stays Map: ${kinds.mapIsMap}, Date stays Date: ${kinds.dateIsDate}`);

  console.log('\n--- Part 3: sharing memory ---');
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  w.worker.postMessage({ sab });
  await nextMessage(w.worker);
  console.log(`Worker wrote 99 into a SharedArrayBuffer, the parent now reads: ${view[0]}`);
  try {
    advanced.child.send({ sab });
  } catch (err) {
    console.log(`sending a SharedArrayBuffer to a fork() child fails: ${err.message}`);
  }
  advanced.child.send('exit');

  console.log('\n--- Part 4: startup cost (average of 5 starts, time until the first message) ---');
  let forkMs = 0;
  let workerMs = 0;
  for (let i = 0; i < 5; i++) {
    const a = startFork();
    forkMs += (await a.ready).ms;
    a.child.send('exit');
    const b = startWorker();
    workerMs += (await b.ready).ms;
    await b.worker.terminate();
  }
  console.log(`fork()  : about ${Math.round(forkMs / 5)} ms`);
  console.log(`Worker  : about ${Math.round(workerMs / 5)} ms`);

  f.child.send('exit');
  await w.worker.terminate();
}

main();
