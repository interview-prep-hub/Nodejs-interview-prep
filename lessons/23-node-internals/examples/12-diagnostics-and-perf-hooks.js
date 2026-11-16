// diagnostics_channel and perf_hooks: official, low-cost ways to watch Node from the inside
// Shows: your own channel, the built-in http/net channels, a measure, a function timer, a GC observer and loop delay.
// Run: node --expose-gc lessons/23-node-internals/examples/12-diagnostics-and-perf-hooks.js
// @flags --expose-gc

const diagnosticsChannel = require('node:diagnostics_channel');
const http = require('node:http');
const { performance, PerformanceObserver, monitorEventLoopDelay, constants } = require('node:perf_hooks');
const { setTimeout: sleep } = require('node:timers/promises');

// ---- Part 1: a channel of your own -----------------------------------------------------------
// A library publishes events on a named channel. If nobody subscribes, publishing costs almost nothing.
function part1() {
  const channel = diagnosticsChannel.channel('app:db:query');
  console.log('Part 1: your own channel');
  console.log('  subscribers before subscribe():', channel.hasSubscribers);

  const onMessage = (message) => console.log('    subscriber got:', JSON.stringify(message));
  diagnosticsChannel.subscribe('app:db:query', onMessage);
  console.log('  subscribers after subscribe() :', channel.hasSubscribers);

  console.log('  publishing... (handlers run synchronously, inside publish())');
  if (channel.hasSubscribers) channel.publish({ sql: 'SELECT 1', ms: 3 }); // build the message only if someone listens
  console.log('  publish() returned');

  diagnosticsChannel.unsubscribe('app:db:query', onMessage);
}

// ---- Part 2: channels that Node itself publishes ----------------------------------------------
async function part2() {
  const seen = [];
  const onServer = ({ request }) => seen.push(`http.server.request.start  ${request.method} ${request.url}`);
  const onClient = ({ request }) => seen.push(`http.client.request.start  ${request.method} ${request.path}`);
  const onSocket = ({ socket }) => seen.push(`net.server.socket          a ${socket.constructor.name} was accepted`);
  diagnosticsChannel.subscribe('http.server.request.start', onServer);
  diagnosticsChannel.subscribe('http.client.request.start', onClient);
  diagnosticsChannel.subscribe('net.server.socket', onSocket);

  const server = http.createServer((req, res) => res.end('ok'));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  await new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path: '/ping', agent: false }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
  });
  server.close();

  diagnosticsChannel.unsubscribe('http.server.request.start', onServer);
  diagnosticsChannel.unsubscribe('http.client.request.start', onClient);
  diagnosticsChannel.unsubscribe('net.server.socket', onSocket);

  console.log('\nPart 2: built-in channels, one request, no changes to the http code');
  seen.forEach((line) => console.log('  ' + line));
}

// ---- Part 3: perf_hooks ---------------------------------------------------------------------------
async function part3() {
  console.log('\nPart 3: perf_hooks');

  const entries = [];
  const observer = new PerformanceObserver((list) => entries.push(...list.getEntries()));
  observer.observe({ entryTypes: ['measure', 'function', 'gc'] });

  // performance.mark / measure: name two moments and read the time between them.
  performance.mark('start');
  for (let i = 0; i < 1e6; i++); // some work
  performance.mark('end');
  const measure = performance.measure('my-work', 'start', 'end');
  console.log(`  measure "${measure.name}": entryType=${measure.entryType}, duration>0: ${measure.duration > 0}`);

  // performance.timerify wraps a function so every call becomes an entry.
  const timed = performance.timerify(function work() {
    for (let i = 0; i < 1e5; i++);
  });
  timed();

  // A forced major GC shows up as a 'gc' entry. (This needs node --expose-gc.)
  global.gc();
  await sleep(50); // observers are called asynchronously
  const forcedMajor = entries.some((e) => e.entryType === 'gc' && e.detail.kind === constants.NODE_PERFORMANCE_GC_MAJOR);
  console.log(`  entry types seen by the observer: ${[...new Set(entries.map((e) => e.entryType))].sort().join(', ')}`);
  console.log(`  a 'gc' entry of kind MAJOR was reported: ${forcedMajor}`);
  observer.disconnect();

  // Event loop delay: block the loop for 100 ms and see it in the histogram.
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  await sleep(50);
  const until = Date.now() + 100;
  while (Date.now() < until); // blocks the loop on purpose
  await sleep(50);
  histogram.disable();
  console.log(`  monitorEventLoopDelay: the 100 ms block shows as a max delay of at least 80 ms: ${histogram.max / 1e6 >= 80}`);

  const elu = performance.eventLoopUtilization();
  console.log(`  eventLoopUtilization() fields: ${Object.keys(elu).join(', ')}`);
}

(async () => {
  part1();
  await part2();
  await part3();
})();
