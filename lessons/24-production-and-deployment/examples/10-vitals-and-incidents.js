// Incident toolkit: a "vitals" snapshot (CPU, event loop lag, memory, handles) and how each kind of trouble shows up in it
// Run: node --expose-gc lessons/24-production-and-deployment/examples/10-vitals-and-incidents.js
// @flags --expose-gc
//
// The numbers change on every run, so the demo prints conclusions (true / false), not raw values.
'use strict';
const net = require('node:net');
const { once } = require('node:events');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const busy = (ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end); // blocks the whole process: nothing else can run
};
const MB = 1024 * 1024;

// ---------------------------------------------------------------------------------------------
// The vitals sampler. Every call to take() describes the time since the previous call.
// ---------------------------------------------------------------------------------------------
function countResources() {
  const counts = {};
  for (const name of process.getActiveResourcesInfo()) counts[name] = (counts[name] ?? 0) + 1;
  return counts;
}

function createVitals() {
  const loopDelay = monitorEventLoopDelay({ resolution: 10 });
  loopDelay.enable();
  let lastCpu = process.cpuUsage();
  let lastTime = process.hrtime.bigint();
  let lastElu = performance.eventLoopUtilization();
  return {
    take() {
      const now = process.hrtime.bigint();
      const cpu = process.cpuUsage(lastCpu); // microseconds of CPU time since the last call
      const wallMicros = Number(now - lastTime) / 1000;
      const elu = performance.eventLoopUtilization(lastElu);
      const memory = process.memoryUsage();
      const snapshot = {
        // CPU time / wall time. It can pass 100 when several threads are busy. On Windows the operating system counts
        // CPU time in coarse steps (about 15 ms), so look at windows of many seconds there.
        cpuPercent: ((cpu.user + cpu.system) / wallMicros) * 100,
        eventLoopUtilization: elu.utilization, // 0 to 1: how much of the time the loop was running JavaScript
        loopDelayP99Ms: loopDelay.percentile(99) / 1e6, // how late timers fire: the best "is the loop stuck?" number
        heapUsedMB: memory.heapUsed / MB,
        rssMB: memory.rss / MB,
        resources: countResources(), // open sockets, timers, file requests...
      };
      lastCpu = process.cpuUsage();
      lastTime = process.hrtime.bigint();
      lastElu = performance.eventLoopUtilization();
      loopDelay.reset();
      return snapshot;
    },
    stop: () => loopDelay.disable(),
  };
}

// A first guess from the numbers. Real incidents need a human, but the first question is always the same.
function diagnose(s) {
  if (s.loopDelayP99Ms > 100 && s.eventLoopUtilization > 0.5) {
    return 'event loop saturated: some code runs for too long (high CPU%: take a CPU profile; low CPU%: look for synchronous I/O)';
  }
  if (s.loopDelayP99Ms > 100) return 'event loop delayed but not busy: check long GC pauses and CPU throttling by container limits';
  return 'nothing stands out in event loop lag';
}

async function main() {
  const vitals = createVitals();

  console.log('1. Quiet process');
  await sleep(100); // let start-up noise pass
  vitals.take(); // starts a fresh measuring window
  await sleep(300);
  const idle = vitals.take();
  console.log('   event loop delay p99 under 100 ms:', idle.loopDelayP99Ms < 100);
  console.log('   event loop utilization under 0.5:', idle.eventLoopUtilization < 0.5);
  console.log('   diagnosis:', diagnose(idle));

  console.log('2. High CPU: a 250 ms synchronous loop inside a timer callback');
  vitals.take();
  setTimeout(() => busy(250), 20);
  await sleep(320);
  const blocked = vitals.take();
  console.log('   event loop delay p99 over 200 ms:', blocked.loopDelayP99Ms > 200);
  console.log('   event loop utilization over 0.5 :', blocked.eventLoopUtilization > 0.5);
  console.log('   diagnosis:', diagnose(blocked));

  console.log('3. Memory growth: is the heap still big AFTER a full garbage collection?');
  if (typeof global.gc !== 'function') {
    console.log('   (skipped: start node with --expose-gc to run this part)');
  } else {
    const afterGc = () => {
      global.gc(); // a full collection: whatever is still in use afterwards is really retained
      return process.memoryUsage().heapUsed;
    };
    const makeObjects = (list) => {
      for (let i = 0; i < 100_000; i++) list.push({ id: i, payload: 'x'.repeat(20) });
    };
    const churn = () => {
      const temporary = [];
      makeObjects(temporary); // the list is created and thrown away when churn() returns
    };

    const baseline = afterGc();
    const noLeak = [];
    for (let round = 0; round < 4; round++) {
      churn();
      noLeak.push(afterGc());
    }
    console.log('   temporary objects: heap after GC stays near the start:', noLeak.every((bytes) => Math.abs(bytes - baseline) < 2 * MB));

    const retained = [];
    const leak = [];
    for (let round = 0; round < 4; round++) {
      makeObjects(retained); // kept forever, like a cache with no limit
      leak.push(afterGc());
    }
    console.log('   kept objects     : heap after GC grows every round    :', leak.every((bytes, i) => i === 0 || bytes > leak[i - 1] + MB));
    retained.length = 0;
  }

  console.log('4. Handles: connections that nobody closes');
  const server = net.createServer((socket) => socket.on('error', () => {}));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const before = countResources().TCPSocketWrap ?? 0;
  const clients = [];
  for (let i = 0; i < 20; i++) {
    const client = net.connect(server.address().port, '127.0.0.1');
    client.on('error', () => {});
    await once(client, 'connect');
    clients.push(client); // "forgotten": a leak would keep them forever
  }
  await sleep(50);
  const opened = countResources().TCPSocketWrap - before;
  console.log('   20 connections (both ends live in this process) add 40 socket handles:', opened === 40);
  clients.forEach((client) => client.destroy());
  await sleep(50);
  console.log('   after closing them the count goes back down                        :', (countResources().TCPSocketWrap ?? 0) === before);
  console.log('   On Linux every socket is a file descriptor, so a leak ends with EMFILE (too many open files).');

  server.close();
  vitals.stop();
}

main();
