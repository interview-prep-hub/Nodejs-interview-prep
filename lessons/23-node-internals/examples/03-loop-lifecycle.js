// What keeps Node alive: active resources, then beforeExit and exit
// Shows: process.getActiveResourcesInfo() as a window into the loop, proof that an idle loop sleeps, and the end-of-life sequence of a process.
// Run: node lessons/23-node-internals/examples/03-loop-lifecycle.js

const fs = require('node:fs');
const net = require('node:net');
const { once } = require('node:events');
const { performance } = require('node:perf_hooks');

// Count the things that currently keep the loop alive, by type.
// We hide PipeWrap and TTYWrap: those are just your terminal or pipe (process.stdout) and depend on how you run the file.
function active() {
  const counts = {};
  for (const type of process.getActiveResourcesInfo()) {
    if (type === 'PipeWrap' || type === 'TTYWrap') continue;
    counts[type] = (counts[type] || 0) + 1;
  }
  const keys = Object.keys(counts).sort();
  return keys.length === 0 ? '(nothing)' : keys.map((k) => `${k} x${counts[k]}`).join(', ');
}
const show = (label) => console.log(`  ${label.padEnd(36)} ${active()}`);

// A callback is still counted while it runs. Two trips through the check phase let finished things disappear.
const settle = async () => {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
};

// ---- The end of the process: beforeExit, then exit -------------------------------------
let beforeExitCount = 0;
process.on('beforeExit', () => {
  beforeExitCount++;
  console.log(`\n[beforeExit #${beforeExitCount}] the loop is empty. active: ${active()}`);
  if (beforeExitCount === 1) {
    console.log('  scheduling one more timer from beforeExit, so the loop wakes up again');
    setTimeout(() => console.log('  [timer] ran because beforeExit started new work'), 10);
  }
});
process.on('exit', (code) => {
  console.log(`[exit] code ${code}. Only synchronous work is possible now.`);
  setTimeout(() => console.log('this timer never runs'), 0);
});

// ---- Part 2: watch the resources come and go ---------------------------------------------
async function stages() {
  console.log('\nPart 2: active resources (what the loop is waiting for)');
  await settle(); // the timer that started this function is still counted while its callback runs
  show('at the start');

  const timer = setTimeout(() => {}, 100000);
  show('after setTimeout(..., 100000)');
  timer.unref();
  show('after timer.unref()');

  void new Promise(() => {}); // a promise that never settles
  show('after a never-settling promise');

  const immediate = setImmediate(() => {});
  show('after setImmediate()');
  clearImmediate(immediate);
  show('after clearImmediate()');

  const read = new Promise((resolve) => fs.readFile(__filename, resolve));
  show('after fs.readFile() was started');
  await read;
  await settle();
  show('after the readFile callback ran');

  const server = net.createServer().listen(0, '127.0.0.1');
  await once(server, 'listening');
  show('server is listening');

  const client = net.connect(server.address().port, '127.0.0.1');
  await Promise.all([once(server, 'connection'), once(client, 'connect')]);
  await settle();
  show('client and server socket connected');

  client.destroy();
  server.close();
  await once(server, 'close');
  await settle();
  show('everything closed');

  // ---- Part 3: when the loop has nothing to do, it sleeps inside the poller ----------------
  // eventLoopUtilization() says how much of a time window the loop spent working (active)
  // and how much it spent waiting in the poller (idle).
  console.log('\nPart 3: the loop sleeps when it has nothing to do');
  const waitStart = performance.eventLoopUtilization();
  await new Promise((resolve) => setTimeout(resolve, 150));
  const waited = performance.eventLoopUtilization(waitStart);
  console.log(`  waiting 150 ms for a timer: utilization below 10% (the loop was asleep): ${waited.utilization < 0.1}`);

  const busyStart = performance.eventLoopUtilization();
  const end = Date.now() + 100;
  while (Date.now() < end) {} // block the loop on purpose
  await new Promise((resolve) => setImmediate(resolve));
  const busy = performance.eventLoopUtilization(busyStart);
  console.log(`  blocking it for 100 ms in JavaScript: utilization above 90%: ${busy.utilization > 0.9}`);
}

// ---- Part 1: the order after the main module ---------------------------------------------
console.log('Part 1: what happens after the main module');
console.log('  [main module] runs first, from top to bottom');
setTimeout(stages, 0);
Promise.resolve().then(() => console.log('  [promise microtask] runs after the main module'));
process.nextTick(() => console.log('  [nextTick] runs before promise microtasks in a CommonJS main module'));
console.log('  [main module] reached its last line. Nothing async has run yet.');
