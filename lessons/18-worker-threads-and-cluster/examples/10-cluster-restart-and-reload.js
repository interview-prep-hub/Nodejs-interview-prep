// cluster in production: restart a crashed worker, then reload all workers with zero downtime
// Shows: the 'exit' event + fork() pattern, and a rolling reload (start new worker, then retire old one) while traffic keeps flowing.
// Run: node lessons/18-worker-threads-and-cluster/examples/10-cluster-restart-and-reload.js

const cluster = require('node:cluster');
const http = require('node:http');
const { once } = require('node:events');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (cluster.isPrimary) {
  primary();
} else {
  worker();
}

// ---- the primary process ----

async function primary() {
  let shuttingDown = false;

  // Use round-robin on every platform (it is the default everywhere except Windows). With the Windows default
  // (SCHED_NONE) the operating system hands connections to workers, and now and then a connection reaches a
  // worker that is just leaving, which shows up as ECONNRESET (about 1 run in 8 on the test machine).
  // The policy must be set before the first fork().
  cluster.schedulingPolicy = cluster.SCHED_RR;

  // The self-healing rule: if a worker dies and we did not ask it to leave, start a new one.
  cluster.on('exit', (deadWorker, code) => {
    if (shuttingDown || deadWorker.exitedAfterDisconnect) return;
    console.log(`primary: a worker crashed (exit code ${code}), starting a replacement`);
    cluster.fork();
  });

  // Start two workers and wait until both accept connections.
  const first = [cluster.fork(), cluster.fork()];
  const addresses = await Promise.all(first.map((w) => once(w, 'listening')));
  const port = addresses[0][0].port;
  console.log(`primary: 2 workers are up (ids ${first.map((w) => w.id).join(', ')})`);

  // ---- Part 1: crash and recover ----
  console.log('\n--- Part 1: a worker crashes ---');
  const replacementReady = once(cluster, 'listening'); // register BEFORE the crash, so we cannot miss it
  let crashRequestFailed = false;
  await get(port, '/crash').catch(() => (crashRequestFailed = true)); // the worker dies, so this request cannot succeed
  const [replacement] = await replacementReady;
  console.log(`client: the request to /crash failed, as expected: ${crashRequestFailed}`);
  console.log(`primary: replacement worker ${replacement.id} is listening`);
  console.log(`primary: live workers now: ${Object.keys(cluster.workers).length}`);

  // ---- Part 2: rolling reload under traffic ----
  console.log('\n--- Part 2: rolling reload while requests keep arriving ---');
  const traffic = startTraffic(port);
  const slow = get(port, '/slow'); // a request that is still running when its worker is told to leave
  await sleep(100);

  const oldIds = new Set(Object.values(cluster.workers).map((w) => w.id));
  for (const oldWorker of Object.values(cluster.workers)) {
    const fresh = cluster.fork();
    await once(fresh, 'listening'); // 1) the new worker is ready ...
    const gone = once(oldWorker, 'exit');
    oldWorker.disconnect(); //          2) ... only then the old one stops taking new connections
    await gone; //                      3) and leaves after finishing what it is doing
    console.log(`primary: worker ${fresh.id} is up and an old worker has left`);
  }
  await sleep(100);
  const stats = await traffic.stop();

  const slowResult = await slow;
  console.log(`\nthe slow request that was running during the reload: ${slowResult.done ? 'finished normally' : 'broken'}`);
  console.log(`requests sent during the reload : ${stats.sent > 10 ? 'more than 10' : stats.sent}`);
  console.log(`requests that failed            : ${stats.failed}`);
  console.log(`some served by new workers      : ${[...stats.servedBy].some((id) => !oldIds.has(id))}`);

  // ---- shutdown ----
  shuttingDown = true;
  const exits = Object.values(cluster.workers).map((w) => once(w, 'exit'));
  for (const w of Object.values(cluster.workers)) w.disconnect();
  await Promise.all(exits);
  console.log('\nprimary: all workers gone, bye');
}

// One request on a new connection (agent: false means no keep-alive). Resolves with the parsed JSON body.
function get(port, path) {
  return new Promise((resolve, reject) => {
    http
      .get({ host: '127.0.0.1', port, path, agent: false }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve(JSON.parse(body)));
      })
      .on('error', reject);
  });
}

// Sends one request every 15 ms until stop() is called, and counts successes, failures and who answered.
function startTraffic(port) {
  const stats = { sent: 0, failed: 0, servedBy: new Set() };
  let running = true;
  const loop = (async () => {
    while (running) {
      stats.sent++;
      try {
        const { workerId } = await get(port, '/');
        stats.servedBy.add(workerId);
      } catch {
        stats.failed++;
      }
      await sleep(15);
    }
  })();
  return {
    async stop() {
      running = false;
      await loop;
      return stats;
    },
  };
}

// ---- a worker process ----

function worker() {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/crash') process.exit(1); // simulate a bug that kills the process
    if (req.url === '/slow') {
      setTimeout(() => res.end(JSON.stringify({ done: true })), 600);
      return;
    }
    res.end(JSON.stringify({ workerId: cluster.worker.id }));
  });
  server.listen(0);
  // No SIGTERM or disconnect code is needed here: when the primary calls worker.disconnect(), Node closes
  // this server (no new connections, running requests may finish) and the process exits when it is idle.
}
