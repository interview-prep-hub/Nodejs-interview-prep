// Metrics: a hand-written registry (counter, gauge, histogram), the Prometheus text format, and the RED method on a live server
// Run: node lessons/24-production-and-deployment/examples/08-metrics-registry.js
//
// The registry is about 90 lines. Real projects use the prom-client package, which works the same way.
'use strict';
const http = require('node:http');
const { once } = require('node:events');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------------------------
const NAME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/;
const escapeLabel = (value) => String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
const labelText = (labels) => {
  const parts = Object.entries(labels).map(([key, value]) => `${key}="${escapeLabel(value)}"`);
  return parts.length ? `{${parts.join(',')}}` : '';
};

class Metric {
  constructor(type, name, help, labelNames = []) {
    if (!NAME.test(name)) throw new Error(`bad metric name: ${name}`);
    Object.assign(this, { type, name, help, labelNames, series: new Map() });
  }
  // One "series" per distinct combination of label values. Every series costs memory, forever.
  seriesFor(labels) {
    const given = Object.keys(labels);
    if (given.length !== this.labelNames.length || !this.labelNames.every((label) => label in labels)) {
      throw new Error(`${this.name} needs labels [${this.labelNames}] but got [${given}]`);
    }
    const key = this.labelNames.map((label) => labels[label]).join('\u0001');
    if (!this.series.has(key)) this.series.set(key, this.create(Object.fromEntries(this.labelNames.map((label) => [label, labels[label]]))));
    return this.series.get(key);
  }
  size() {
    return this.series.size;
  }
}

class Counter extends Metric {
  constructor(name, help, labelNames) {
    super('counter', name, help, labelNames);
  }
  create(labels) {
    return { labels, value: 0 };
  }
  inc(labels = {}, by = 1) {
    if (by < 0) throw new Error('a counter can only go up');
    this.seriesFor(labels).value += by;
  }
  lines() {
    return [...this.series.values()].map((s) => `${this.name}${labelText(s.labels)} ${s.value}`);
  }
}

class Gauge extends Metric {
  constructor(name, help, labelNames) {
    super('gauge', name, help, labelNames);
  }
  create(labels) {
    return { labels, value: 0 };
  }
  set(labels, value) {
    this.seriesFor(labels).value = value;
  }
  inc(labels = {}, by = 1) {
    this.seriesFor(labels).value += by;
  }
  dec(labels = {}, by = 1) {
    this.seriesFor(labels).value -= by;
  }
  lines() {
    return [...this.series.values()].map((s) => `${this.name}${labelText(s.labels)} ${s.value}`);
  }
}

class Histogram extends Metric {
  constructor(name, help, labelNames, buckets) {
    super('histogram', name, help, labelNames);
    this.buckets = [...buckets].sort((a, b) => a - b);
  }
  create(labels) {
    return { labels, counts: new Array(this.buckets.length + 1).fill(0), sum: 0, count: 0 }; // last slot = +Inf
  }
  observe(labels, value) {
    const s = this.seriesFor(labels);
    let i = this.buckets.findIndex((upperBound) => value <= upperBound);
    if (i === -1) i = this.buckets.length;
    s.counts[i]++;
    s.sum += value;
    s.count++;
  }
  startTimer(labels) {
    const start = performance.now();
    return () => this.observe(labels, (performance.now() - start) / 1000);
  }
  lines() {
    const out = [];
    for (const s of this.series.values()) {
      let cumulative = 0; // Prometheus buckets are cumulative: "how many were <= this bound"
      this.buckets.forEach((upperBound, i) => {
        cumulative += s.counts[i];
        out.push(`${this.name}_bucket${labelText({ ...s.labels, le: upperBound })} ${cumulative}`);
      });
      out.push(`${this.name}_bucket${labelText({ ...s.labels, le: '+Inf' })} ${s.count}`);
      out.push(`${this.name}_sum${labelText(s.labels)} ${s.sum}`);
      out.push(`${this.name}_count${labelText(s.labels)} ${s.count}`);
    }
    return out;
  }
  // Estimate a percentile from the buckets (what PromQL's histogram_quantile does): linear guess inside one bucket.
  quantile(labels, q) {
    const s = this.seriesFor(labels);
    const target = q * s.count;
    let before = 0;
    for (let i = 0; i < this.buckets.length; i++) {
      if (before + s.counts[i] >= target && s.counts[i] > 0) {
        const lower = i === 0 ? 0 : this.buckets[i - 1];
        return lower + (this.buckets[i] - lower) * ((target - before) / s.counts[i]);
      }
      before += s.counts[i];
    }
    return this.buckets[this.buckets.length - 1]; // slower than the last bucket: all we know is "at least this"
  }
}

class Registry {
  constructor() {
    this.metrics = new Map();
  }
  add(metric) {
    if (this.metrics.has(metric.name)) throw new Error(`metric ${metric.name} is already registered`);
    this.metrics.set(metric.name, metric);
    return metric;
  }
  counter(name, help, labelNames) {
    return this.add(new Counter(name, help, labelNames));
  }
  gauge(name, help, labelNames) {
    return this.add(new Gauge(name, help, labelNames));
  }
  histogram(name, help, labelNames, buckets) {
    return this.add(new Histogram(name, help, labelNames, buckets));
  }
  // The Prometheus text exposition format, version 0.0.4
  render() {
    const out = [];
    for (const m of this.metrics.values()) {
      out.push(`# HELP ${m.name} ${m.help}`, `# TYPE ${m.name} ${m.type}`, ...m.lines());
    }
    return out.join('\n') + '\n';
  }
}

// ---------------------------------------------------------------------------------------------
// A small server that is measured with the RED method: Rate, Errors, Duration (per route)
// ---------------------------------------------------------------------------------------------
const registry = new Registry();
const requestsTotal = registry.counter('http_requests_total', 'Requests served, by method, route and status.', ['method', 'route', 'status']);
const duration = registry.histogram('http_request_duration_seconds', 'Request duration in seconds.', ['method', 'route'], [0.1, 0.5, 1, 2.5]);
const inFlight = registry.gauge('http_requests_in_flight', 'Requests being handled right now.');

// USE method for the process itself: Utilization, Saturation, Errors
const rss = registry.gauge('process_resident_memory_bytes', 'Resident memory of the process (utilization of memory).');
const heapUsed = registry.gauge('nodejs_heap_used_bytes', 'V8 heap in use.');
const loopUtilization = registry.gauge('nodejs_eventloop_utilization_ratio', 'Share of time the event loop was busy since the last scrape (utilization).');
const loopDelay = registry.gauge('nodejs_eventloop_delay_p99_seconds', 'p99 event loop delay since the last scrape (saturation: work is waiting).');
const delay = monitorEventLoopDelay({ resolution: 10 });
delay.enable();
let lastElu = performance.eventLoopUtilization();

function collectProcessMetrics() {
  rss.set({}, process.memoryUsage.rss());
  heapUsed.set({}, process.memoryUsage().heapUsed);
  const elu = performance.eventLoopUtilization(lastElu);
  lastElu = performance.eventLoopUtilization();
  loopUtilization.set({}, Number(elu.utilization.toFixed(3)));
  loopDelay.set({}, delay.percentile(99) / 1e9); // the histogram reports nanoseconds
  delay.reset();
}

// The "route" label is the route TEMPLATE, never the raw URL. Raw URLs would create endless series.
const routes = [
  { method: 'GET', pattern: /^\/users\/(\d+)$/, name: '/users/:id', handler: async (res, [id]) => {
    await sleep(2);
    if (id === '0') return send(res, 404, 'no such user');
    send(res, 200, `user ${id}`);
  } },
  { method: 'GET', pattern: /^\/report$/, name: '/report', handler: async (res) => {
    await sleep(250); // a slow endpoint
    send(res, 200, 'report');
  } },
  { method: 'GET', pattern: /^\/boom$/, name: '/boom', handler: async (res) => send(res, 500, 'something broke') },
];

function send(res, status, text) {
  res.statusCode = status;
  res.end(text);
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/metrics') {
    collectProcessMetrics();
    res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
    return void res.end(registry.render());
  }
  inFlight.inc();
  res.on('close', () => inFlight.dec());
  let route = null;
  let match = null;
  for (const candidate of routes) {
    match = candidate.method === req.method ? candidate.pattern.exec(req.url) : null;
    if (match) {
      route = candidate;
      break;
    }
  }
  const routeName = route ? route.name : 'unmatched'; // one label value for ALL unknown URLs
  const stop = duration.startTimer({ method: req.method, route: routeName });
  res.on('finish', () => {
    stop();
    requestsTotal.inc({ method: req.method, route: routeName, status: res.statusCode });
  });
  if (!route) return send(res, 404, 'not found');
  await route.handler(res, match.slice(1));
});

async function main() {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  console.log('1. Send some traffic (one request at a time, so the order is fixed)');
  const traffic = ['/users/1', '/users/2', '/users/3', '/users/0', '/report', '/report', '/boom', '/no/such/page'];
  for (const path of traffic) {
    const reply = await fetch(base + path);
    await reply.text();
    console.log(`   GET ${path.padEnd(14)} -> ${reply.status}`);
  }

  console.log('2. What a scraper (Prometheus) reads from GET /metrics. Selected lines:');
  const text = await (await fetch(base + '/metrics')).text();
  const wanted = (line) =>
    /^http_requests_total/.test(line) ||
    /^http_requests_in_flight /.test(line) ||
    /^http_request_duration_seconds_(bucket|count)\{method="GET",route="\/(report|users\/:id)"/.test(line); // _sum changes on every run
  for (const line of text.split('\n').filter(wanted)) console.log('   ' + line);
  console.log('   (the *_sum lines, memory and event loop gauges are in the output too; their values change on every run)');

  console.log('3. The same text also describes the process itself (USE method)');
  console.log('   gauges present:', ['process_resident_memory_bytes', 'nodejs_heap_used_bytes', 'nodejs_eventloop_utilization_ratio', 'nodejs_eventloop_delay_p99_seconds'].every((name) => text.includes(`# TYPE ${name} gauge`)));

  console.log('4. Percentiles are estimated from buckets');
  const p95 = duration.quantile({ method: 'GET', route: '/report' }, 0.95);
  console.log(`   estimated p95 of GET /report: ${p95.toFixed(4)} s (2 requests fell in the 0.1 to 0.5 s bucket)`);
  console.log('   the answer can only be as exact as the bucket edges you chose');

  console.log('5. Labels and cardinality');
  const byRawUrl = registry.counter('bad_requests_total', 'Do not do this: one series per URL.', ['url']);
  for (let id = 1; id <= 50; id++) byRawUrl.inc({ url: `/users/${id}` });
  console.log('   labelled by raw URL   :', byRawUrl.size(), 'series after 50 users');
  console.log('   labelled by route name:', requestsTotal.series.size, 'series in total for all the traffic above (method x route x status)');
  try {
    requestsTotal.inc({ method: 'GET' }); // forgot two labels
  } catch (err) {
    console.log('   wrong label set is rejected:', err.message);
  }

  delay.disable();
  server.close();
  await once(server, 'close');
}

main();
