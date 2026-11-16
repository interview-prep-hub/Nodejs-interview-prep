// A worked example: profile a slow function, read the "flame graph", fix the top problem, repeat
// Run: node lessons/19-performance-and-memory/examples/07-flame-graph-worked.js
const inspector = require('node:inspector');
const { performance } = require('node:perf_hooks');
const { printTop, printTree } = require('./_profile-utils');

// ---- The data and the three versions of the same function ---------------------------------
const customers = Array.from({ length: 8000 }, (_, i) => ({ id: i, name: 'Customer ' + i }));
const orders = Array.from({ length: 2000 }, (_, i) => ({ id: i, customerId: (i * 7) % 8000, cents: 1000 + (i % 500) }));

// Version 1: the code as somebody first wrote it.
function findCustomer(id) {
  return customers.find((c) => c.id === id); // walks the list from the start every time
}
function formatMoney(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
function buildReportV1() {
  const lines = [];
  for (const order of orders) {
    const customer = findCustomer(order.customerId);
    lines.push(`${order.id},${customer.name},${formatMoney(order.cents)}`);
  }
  return lines.join('\n');
}

// Version 2: the formatter is created once, outside the loop.
const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
function buildReportV2() {
  const lines = [];
  for (const order of orders) {
    const customer = findCustomer(order.customerId);
    lines.push(`${order.id},${customer.name},${MONEY.format(order.cents / 100)}`);
  }
  return lines.join('\n');
}

// Version 3: customers are looked up in a Map.
const customersById = new Map(customers.map((c) => [c.id, c]));
function buildReportV3() {
  const lines = [];
  for (const order of orders) {
    const customer = customersById.get(order.customerId);
    lines.push(`${order.id},${customer.name},${MONEY.format(order.cents / 100)}`);
  }
  return lines.join('\n');
}

// ---- Tools: profile one call, and time a function fairly -------------------------------------
// NOTE: start the profiler BEFORE the code runs for the first time. On Node 24.16, when I profiled a
// function that had already been run many times, the time was blamed on the wrong function.
function profile(fn) {
  const session = new inspector.Session();
  session.connect();
  session.post('Profiler.enable');
  session.post('Profiler.setSamplingInterval', { interval: 100 }); // microseconds between samples
  session.post('Profiler.start');
  const result = fn();
  let data;
  session.post('Profiler.stop', (err, res) => (data = res.profile));
  session.disconnect();
  return { data, result };
}

function medianMs(fn, rounds) {
  fn(); // warm-up
  const times = [];
  for (let i = 0; i < rounds; i++) {
    const start = performance.now();
    fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

function round(label, fn, rootName) {
  const { data } = profile(fn);
  console.log(`\n${label}`);
  console.log(' call tree (percent of the whole call; "self" = time spent in that function itself):');
  printTree(data, rootName, 5);
  console.log(' top self time:');
  printTop(data, 4);
}

// ---- Round 1, 2, 3 ---------------------------------------------------------------------------
console.log(`report for ${orders.length} orders and ${customers.length} customers`);
round('ROUND 1: profile of version 1', buildReportV1, 'buildReportV1');
round('ROUND 2: profile of version 2 (formatter created once)', buildReportV2, 'buildReportV2');
// version 3 is so fast that one call gives too few samples, so profile 100 calls
function hundredCallsOfV3() {
  for (let i = 0; i < 100; i++) buildReportV3();
}
round('ROUND 3: profile of 100 calls of version 3 (Map lookup)', hundredCallsOfV3, 'hundredCallsOfV3');

// ---- Before / after, measured without the profiler ---------------------------------------------
console.log('\nmedian time of one call, profiler off:');
const v1 = medianMs(buildReportV1, 3);
const v2 = medianMs(buildReportV2, 5);
const v3 = medianMs(buildReportV3, 15);
console.log('  version 1 (formatter in the loop, array search):', v1.toFixed(1).padStart(7), 'ms');
console.log('  version 2 (formatter created once):             ', v2.toFixed(1).padStart(7), 'ms   ' + (v1 / v2).toFixed(0) + 'x faster than v1');
console.log('  version 3 (and a Map for the lookup):           ', v3.toFixed(1).padStart(7), 'ms   ' + (v1 / v3).toFixed(0) + 'x faster than v1');

// An optimization is only useful if the answer stays the same.
const sameReport = buildReportV1() === buildReportV2() && buildReportV2() === buildReportV3();
console.log('\nall three versions return exactly the same report:', sameReport, '(' + orders.length + ' lines)');
