// Stateless design: why in-memory state breaks when you scale out
// Shows: two server instances behind a round-robin balancer. In-memory counters give wrong answers, sticky routing or a shared store fix it.
// Run: node lessons/18-worker-threads-and-cluster/examples/12-state-and-sticky.js
// The two "servers" are worker threads (each with its own memory, like two cluster workers or two containers).

const http = require('node:http');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

// ---- main thread: plays the load balancer and the user ----

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

async function startServers(store) {
  const servers = [];
  for (const name of ['server-1', 'server-2']) {
    const worker = new Worker(__filename, { workerData: { name, store } });
    const { port } = await new Promise((resolve) => worker.once('message', resolve));
    servers.push({ name, port, worker });
  }
  return servers;
}

// One user visits 4 times. `choose(visitNumber)` is the balancer's decision: which server gets this request?
async function scenario(title, sessionId, mode, choose) {
  console.log(title);
  const counts = [];
  for (let visit = 0; visit < 4; visit++) {
    const server = choose(visit);
    const reply = await get(server.port, `/visit?sid=${sessionId}&mode=${mode}`);
    counts.push(reply.count);
    console.log(`  visit ${visit + 1} went to ${reply.server}, the app says "you have visited ${reply.count} time(s)"`);
  }
  const correct = counts.join() === '1,2,3,4';
  console.log(`  -> ${correct ? 'correct: 1,2,3,4' : `WRONG: ${counts.join(',')} instead of 1,2,3,4`}\n`);
}

async function main() {
  const store = new SharedArrayBuffer(3 * 4); // 3 counters; stands in for Redis or a database
  const servers = await startServers(store);

  const roundRobin = (visit) => servers[visit % servers.length];
  const stickyBySession = (sid) => () => servers[[...sid].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % servers.length];

  await scenario('A) state in each process memory + round-robin balancer', 's0', 'memory', roundRobin);
  await scenario('B) state in process memory + sticky routing (same user, same server)', 's1', 'memory', stickyBySession('s1'));
  await scenario('C) stateless servers + one shared store + round-robin balancer', 's2', 'shared', roundRobin);

  await Promise.all(servers.map((s) => s.worker.terminate()));
}

// ---- worker thread: one server instance ----

function serverMain() {
  const { name, store } = workerData;
  const sessions = new Map(); // in-memory state: lives and dies with THIS instance only
  const shared = new Int32Array(store); // the shared store (here: shared memory, in real life: Redis, a database)

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const sid = url.searchParams.get('sid');
    let count;
    if (url.searchParams.get('mode') === 'memory') {
      count = (sessions.get(sid) || 0) + 1;
      sessions.set(sid, count);
    } else {
      count = Atomics.add(shared, Number(sid.slice(1)), 1) + 1; // the server keeps nothing itself
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ server: name, count }));
  });
  server.listen(0, () => parentPort.postMessage({ port: server.address().port }));
}

if (isMainThread) {
  main();
} else {
  serverMain();
}
