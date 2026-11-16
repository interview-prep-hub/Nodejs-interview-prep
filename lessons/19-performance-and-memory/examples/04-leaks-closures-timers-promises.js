// Memory leaks 2: closures, forgotten listeners and timers, promises that never settle (and the fixes)
// @flags --expose-gc
// Run: node --expose-gc lessons/19-performance-and-memory/examples/04-leaks-closures-timers-promises.js
const EventEmitter = require('node:events');

if (typeof global.gc !== 'function') {
  console.log('Please run this example with the --expose-gc flag (see the Run line above).');
  process.exit(1);
}

// A tiny negative difference can happen (other garbage was freed meanwhile): show it as 0.
const mb = (bytes) => (Math.max(0, bytes) / 1024 / 1024).toFixed(2) + ' MB';
const heap = () => {
  global.gc();
  global.gc();
  global.gc();
  return process.memoryUsage().heapUsed;
};
// A meter remembers the heap size now and reports the growth since then, step by step.
function startMeter() {
  const base = heap();
  return (title) => console.log(title.padEnd(46), mb(heap() - base));
}
const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

// ---- 1. Closures: a function keeps everything in its scope alive -----------------------
// V8 stores the variables that ANY inner function uses in one shared "context" object.
// So `big` stays alive as long as ANY closure from the same call is alive, even one that never uses it.
function makeSessionLeaky(id) {
  const big = new Array(20_000).fill(id); // about 160 KB
  const debugSize = () => big.length; // uses `big`, and is never called
  return () => 'session ' + id; // does not use `big`, but shares the same context
}
function makeSessionFixed(id) {
  const size = new Array(20_000).fill(id).length; // keep only the number we really need
  return () => 'session ' + id + ' (' + size + ')';
}

function closuresDemo() {
  console.log('--- 1. closures (100 sessions of 160 KB each)');
  let sessions = [];
  let measure = startMeter();
  sessions = Array.from({ length: 100 }, (_, i) => makeSessionLeaky(i));
  measure('closures that share a scope with big');
  sessions = null;
  measure = startMeter();
  sessions = Array.from({ length: 100 }, (_, i) => makeSessionFixed(i));
  measure('closures that keep only a number');
  return sessions; // keep the second batch alive until the measurement is done
}

// ---- 2. Event listeners that are never removed ----------------------------------------
const bus = new EventEmitter();
function handleRequest(id) {
  const body = new Array(10_000).fill(id); // 80 KB per request
  bus.on('shutdown', () => body.length); // added for every request, never removed
}
function handleRequestFixed(id) {
  const body = new Array(10_000).fill(id);
  const onShutdown = () => body.length;
  bus.on('shutdown', onShutdown);
  return () => bus.off('shutdown', onShutdown); // the caller removes it when the request ends
}

async function listenersDemo() {
  console.log('\n--- 2. event listeners (100 requests of 80 KB each)');
  process.on('warning', (w) => console.log('   warning event:', w.name));
  const measure = startMeter();
  for (let i = 0; i < 100; i++) handleRequest(i);
  await nextTurn(); // Node prints the warning on the next turn of the loop (to stderr)
  measure('after 100 requests, listeners never removed');
  console.log('   listeners on the bus:', bus.listenerCount('shutdown'));
  bus.removeAllListeners('shutdown');
  measure('after removing them');

  for (let i = 0; i < 100; i++) handleRequestFixed(i)(); // each request cleans up after itself
  measure('100 more requests that clean up');
  console.log('   listeners on the bus:', bus.listenerCount('shutdown'));
}

// ---- 3. Timers that are never cleared --------------------------------------------------
function startPolling(id) {
  const lastResult = new Array(10_000).fill(id);
  return setInterval(() => lastResult.length, 3_600_000); // fires once an hour: the closure lives "forever"
}

function timersDemo() {
  console.log('\n--- 3. timers (100 intervals, each holding 80 KB)');
  const timers = [];
  const measure = startMeter();
  for (let i = 0; i < 100; i++) timers.push(startPolling(i));
  measure('after starting 100 intervals');
  for (const t of timers) t.unref(); // only changes whether the process may exit, not the memory
  measure('after unref() on all of them');
  for (const t of timers) clearInterval(t);
  measure('after clearInterval() on all of them');
}

// ---- 4. Promises that never settle -----------------------------------------------------
// A promise that nobody references is just garbage. The leak starts when something
// keeps the promise (or its resolve function) alive, for example a Map of waiting requests.
const waiting = new Map();
function askServiceNoTimeout(id) {
  const payload = new Array(5_000).fill(id);
  return new Promise((resolve) => waiting.set(id, { resolve, payload })); // the answer never comes
}
function askService(id, ms) {
  const payload = new Array(5_000).fill(id);
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, payload });
    setTimeout(() => {
      if (waiting.delete(id)) reject(new Error('timeout for request ' + id)); // clean up AND fail
    }, ms);
  });
}

async function promisesDemo() {
  console.log('\n--- 4. promises that never settle (1000 requests of 40 KB each)');
  let measure = startMeter();
  for (let i = 0; i < 1000; i++) (async () => { await new Promise(() => {}); })();
  measure('1000 pending promises, nobody holds them');

  measure = startMeter();
  for (let i = 0; i < 1000; i++) askServiceNoTimeout(i);
  measure('1000 pending promises, held by a Map');
  console.log('   waiting requests:', waiting.size);
  waiting.clear();

  measure = startMeter();
  const rejected = [];
  const calls = [];
  for (let i = 0; i < 1000; i++) calls.push(askService(i, 20).catch((e) => rejected.push(e.message)));
  console.log('   waiting requests right after the calls start:', waiting.size);
  await Promise.all(calls);
  console.log('   waiting requests after the 20 ms timeouts:', waiting.size, '| rejected:', rejected.length);
  measure('same 1000 requests, with a timeout');
}

(async () => {
  const keep = closuresDemo();
  await listenersDemo();
  timersDemo();
  await promisesDemo();
  console.log('\n(done, the last batch of sessions had', keep.length, 'entries)');
})();
