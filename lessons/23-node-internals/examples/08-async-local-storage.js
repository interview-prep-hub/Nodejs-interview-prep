// AsyncLocalStorage: request-scoped context that follows await, timers, callbacks (and where it gets lost)
// Shows: a request id read from deep code without passing it around, the custom-queue trap and its fix, and the cost.
// Run: node lessons/23-node-internals/examples/08-async-local-storage.js

const { AsyncLocalStorage, AsyncResource, createHook } = require('node:async_hooks');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const http = require('node:http');
const { setTimeout: sleep } = require('node:timers/promises');

const als = new AsyncLocalStorage();
const lines = []; // { id, msg }

// A logger that finds the request id by itself. Nobody passes it in.
function log(msg) {
  lines.push({ id: als.getStore()?.requestId ?? '(none)', msg });
}

// ---- Part 1: three concurrent HTTP requests, one id each ---------------------------------
// This function is "deep code": it never sees req or res, only log().
async function serviceLayer(delayMs) {
  log('service starts');
  await sleep(delayMs);
  log('after await sleep()');
  await new Promise((resolve) => setTimeout(resolve, 1));
  log('after a setTimeout callback');
  await fs.promises.readFile(__filename);
  log('after fs.promises.readFile');
  await new Promise((resolve) => fs.stat(__filename, resolve));
  log('after a callback style fs.stat');
}

function startServer() {
  const server = http.createServer((req, res) => {
    const requestId = req.headers['x-request-id'];
    als.run({ requestId }, async () => {
      log('handler starts');
      await serviceLayer(Number(req.headers['x-delay']));
      res.end('done');
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function request(port, id, delay) {
  return new Promise((resolve) => {
    http
      .get({ host: '127.0.0.1', port, agent: false, headers: { 'x-request-id': id, 'x-delay': delay } }, (res) => {
        res.resume();
        res.on('end', resolve);
      })
      .end();
  });
}

async function part1() {
  const server = await startServer();
  const port = server.address().port;
  // Different delays, so the three requests interleave in time.
  await Promise.all([request(port, 'req-A', 30), request(port, 'req-B', 10), request(port, 'req-C', 20)]);
  server.close();

  console.log('Part 1: log lines grouped by the id that log() found on its own');
  for (const id of ['req-A', 'req-B', 'req-C']) {
    console.log(`  ${id}`);
    for (const line of lines.filter((l) => l.id === id)) console.log(`    ${line.msg}`);
  }
  const lost = lines.filter((l) => l.id === '(none)').length;
  console.log(`  lines that lost their id: ${lost} of ${lines.length}`);
}

// ---- Part 2: where the context is NOT what you expect ------------------------------------
// A callback runs with the context of the code that CALLS it, not the code that stored it.
async function part2() {
  lines.length = 0;
  const jobs = []; // a home-made queue
  const bus = new EventEmitter();

  als.run({ requestId: 'req-A' }, () => {
    jobs.push(() => log('plain function, queued inside req-A'));
    jobs.push(AsyncResource.bind(() => log('AsyncResource.bind, queued inside req-A')));
    jobs.push(AsyncLocalStorage.bind(() => log('AsyncLocalStorage.bind, queued inside req-A')));
    const snapshot = AsyncLocalStorage.snapshot();
    jobs.push(() => snapshot(() => log('AsyncLocalStorage.snapshot, queued inside req-A')));
    bus.on('ping', () => log('EventEmitter listener, registered inside req-A'));
  });

  // Later, from code that is in no request at all (for example a worker loop or a timer you own):
  for (const job of jobs) job();

  // The listener runs in the context of whoever calls emit().
  als.run({ requestId: 'req-B' }, () => bus.emit('ping'));

  console.log('\nPart 2: which request id does each callback see when it runs later?');
  for (const l of lines) console.log(`  [${l.id}] ${l.msg}`);
}

// ---- Part 3: what does it cost? --------------------------------------------------------------
async function awaits(n) {
  for (let i = 0; i < n; i++) await null;
}
async function median(fn) {
  const runs = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    await fn();
    runs.push(performance.now() - start);
  }
  return runs.sort((a, b) => a - b)[2];
}
async function part3() {
  const N = 200000;
  await awaits(N); // warm up
  const plain = await median(() => awaits(N));
  const inRun = await median(() => als.run({ requestId: 'x' }, () => awaits(N)));
  const hook = createHook({ init() {} }).enable(); // the old way: an async_hooks hook that does nothing
  const withHook = await median(() => awaits(N));
  hook.disable();
  for (let i = 0; i < 100000; i++) als.run({ requestId: i }, () => 1); // warm up, so the timing below is not dominated by compilation
  const start = performance.now();
  for (let i = 0; i < 100000; i++) als.run({ requestId: i }, () => 1);
  const perRun = ((performance.now() - start) * 1000) / 100000;

  console.log(`\nPart 3: cost of ${N} awaits (median of 5, your numbers will differ)`);
  console.log(`  plain awaits                    : ${plain.toFixed(0).padStart(4)} ms`);
  console.log(`  awaits inside als.run()         : ${inRun.toFixed(0).padStart(4)} ms`);
  console.log(`  plain awaits, empty init hook on: ${withHook.toFixed(0).padStart(4)} ms`);
  console.log(`  one als.run() call              : about ${perRun.toFixed(1)} microseconds`);
}

(async () => {
  await part1();
  await part2();
  await part3();
})();
