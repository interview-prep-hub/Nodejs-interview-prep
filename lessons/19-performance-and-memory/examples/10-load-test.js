// A self-made load test with fetch: throughput, latency percentiles, and Little's law
// Run: node lessons/19-performance-and-memory/examples/10-load-test.js
// The server runs in a worker thread (its own event loop), so the test client does not slow it down.
const http = require('node:http');
const { Worker, isMainThread, parentPort } = require('node:worker_threads');
const { performance } = require('node:perf_hooks');
const { setTimeout: sleep } = require('node:timers/promises');

// ---------------------------------------------------------------------------------------------
// SERVER SIDE (runs inside the worker thread)
// ---------------------------------------------------------------------------------------------
function busyFor(milliseconds) {
  const end = performance.now() + milliseconds;
  while (performance.now() < end); // CPU work: the JavaScript thread cannot do anything else
}

function startServer() {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/io') {
      await sleep(30); // waiting for a database or another service: no CPU used
      res.end('ok');
    } else if (req.url === '/cpu') {
      busyFor(5); // 5 ms of real computing
      res.end('ok');
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  server.listen(0, '127.0.0.1', () => parentPort.postMessage({ port: server.address().port }));
  parentPort.on('message', (message) => {
    if (message === 'stop') server.close(() => process.exit(0)); // closes idle keep-alive sockets too
  });
}

// ---------------------------------------------------------------------------------------------
// CLIENT SIDE (the main thread)
// ---------------------------------------------------------------------------------------------
// percentile of an ascending list: the value below which p percent of the requests fall
function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

// `concurrency` workers each send one request after the other until `total` requests were sent.
async function loadTest(url, { concurrency, total }) {
  const latencies = [];
  let started = 0;
  let failed = 0;
  const t0 = performance.now();
  async function lane() {
    while (started < total) {
      started++;
      const start = performance.now();
      try {
        const res = await fetch(url);
        await res.text(); // read the whole body, otherwise the connection is not freed
        if (!res.ok) failed++;
      } catch {
        failed++;
      }
      latencies.push(performance.now() - start);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, lane));
  const seconds = (performance.now() - t0) / 1000;
  latencies.sort((a, b) => a - b);
  const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  return {
    throughput: total / seconds, // requests per second
    avg, p50: percentile(latencies, 50), p95: percentile(latencies, 95), p99: percentile(latencies, 99),
    failed,
  };
}

async function main() {
  const worker = new Worker(__filename);
  const { port } = await new Promise((resolve) => worker.once('message', resolve));
  const base = `http://127.0.0.1:${port}`;

  await loadTest(base + '/io', { concurrency: 5, total: 20 }); // warm-up: connections, JIT
  console.log('route   users  requests/s   p50 ms   p95 ms   p99 ms   | in flight = requests/s x avg seconds');
  for (const route of ['/io', '/cpu']) {
    for (const concurrency of [1, 10, 40]) {
      // a short test: just enough requests that every row shows its pattern
      const total = route === '/io' ? [10, 100, 200][[1, 10, 40].indexOf(concurrency)] : [40, 100, 200][[1, 10, 40].indexOf(concurrency)];
      const r = await loadTest(base + route, { concurrency, total });
      const inFlight = r.throughput * (r.avg / 1000); // Little's law: L = lambda x W
      console.log(
        route.padEnd(7), String(concurrency).padStart(5), r.throughput.toFixed(0).padStart(11),
        r.p50.toFixed(0).padStart(8), r.p95.toFixed(0).padStart(8), r.p99.toFixed(0).padStart(8),
        '  |', inFlight.toFixed(1).padStart(5), r.failed ? '(' + r.failed + ' failed)' : '',
      );
    }
  }
  worker.postMessage('stop');
}

if (isMainThread) main();
else startServer();
