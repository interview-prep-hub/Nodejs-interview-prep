// cluster basics: one primary process, several worker processes, one shared port
// Shows: cluster.fork(), two workers listening on the SAME port, a few requests, then a clean shutdown.
// Run: node lessons/18-worker-threads-and-cluster/examples/09-cluster-basics.js

const cluster = require('node:cluster');
const http = require('node:http');

const WORKERS = 2;
const REQUESTS = 8;

if (cluster.isPrimary) {
  runPrimary();
} else {
  runWorker();
}

// ---- the primary process: forks workers, sends a few requests, shuts everything down ----

function runPrimary() {
  const policy = cluster.schedulingPolicy === cluster.SCHED_RR ? 'round-robin (SCHED_RR)' : 'the operating system decides (SCHED_NONE)';
  console.log(`primary ${process.pid}: scheduling policy on ${process.platform} is ${policy}`);

  for (let i = 0; i < WORKERS; i++) cluster.fork(); // each fork() starts a new Node process that runs THIS file again

  const ports = new Set();
  let listening = 0;
  cluster.on('listening', (worker, address) => {
    ports.add(address.port);
    if (++listening < WORKERS) return;
    console.log(`primary: ${WORKERS} workers are listening, number of different ports: ${ports.size}`);
    sendRequests(address.port);
  });

  let exited = 0;
  cluster.on('exit', (worker, code) => {
    // worker.exitedAfterDisconnect is true when the worker left because we asked it to (disconnect or kill)
    if (++exited === WORKERS) console.log(`primary: all workers exited (last one: code ${code}, exitedAfterDisconnect ${worker.exitedAfterDisconnect})`);
  });
}

// One request on a brand new connection, so the scheduler gets a fresh choice every time.
function getOnce(port) {
  return new Promise((resolve, reject) => {
    http
      .get({ port, host: '127.0.0.1', agent: false }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve(JSON.parse(body)));
      })
      .on('error', reject);
  });
}

async function sendRequests(port) {
  const servedBy = {};
  for (let i = 0; i < REQUESTS; i++) {
    const { workerId } = await getOnce(port);
    servedBy[`worker ${workerId}`] = (servedBy[`worker ${workerId}`] || 0) + 1;
  }
  console.log(`primary: ${REQUESTS} requests were served like this:`, Object.fromEntries(Object.entries(servedBy).sort()));

  // Ask every worker to finish its connections and leave. When the last worker is gone, the primary has
  // nothing left to wait for and the program ends by itself.
  for (const worker of Object.values(cluster.workers)) worker.disconnect();
}

// ---- a worker process: a normal HTTP server ----

function runWorker() {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ workerId: cluster.worker.id, pid: process.pid }));
  });
  // Port 0 means "any free port". The primary opens ONE listening socket and shares it with all workers.
  server.listen(0);
}
