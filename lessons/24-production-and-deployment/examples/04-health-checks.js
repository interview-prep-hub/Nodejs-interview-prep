// Health checks: liveness vs readiness vs startup, as a runnable server whose state we change step by step
// Run: node lessons/24-production-and-deployment/examples/04-health-checks.js
'use strict';
const http = require('node:http');
const { once } = require('node:events');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A check must always answer fast, even when the thing it checks is stuck.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// A fake database. We can switch it to "down" (refuses) or "hang" (never answers).
const db = {
  mode: 'ok',
  async ping() {
    if (this.mode === 'down') throw new Error('connection refused');
    if (this.mode === 'hang') await new Promise(() => {}); // never settles
  },
};

const state = { started: false, shuttingDown: false };

// ---------- the three endpoints ----------
// liveness : "is the process itself alive?"            -> a failure means RESTART me.
// startup  : "has the slow start-up work finished?"    -> a failure means "not yet", the others wait.
// readiness: "can I take traffic right now?"            -> a failure means "stop sending requests", NO restart.
async function route(url) {
  if (url === '/livez') {
    // Only look at this process. Never check the database here: restarting the app does not fix the database.
    return { status: 200, body: { status: 'alive' } };
  }
  if (url === '/startupz') {
    return state.started ? { status: 200, body: { status: 'started' } } : { status: 503, body: { status: 'starting' } };
  }
  if (url === '/readyz') {
    if (state.shuttingDown) return { status: 503, body: { status: 'shutting-down' } };
    if (!state.started) return { status: 503, body: { status: 'starting' } };
    const checks = {};
    try {
      await withTimeout(db.ping(), 100);
      checks.database = 'ok';
    } catch (err) {
      checks.database = `failed: ${err.message}`;
    }
    const ready = Object.values(checks).every((value) => value === 'ok');
    return { status: ready ? 200 : 503, body: { status: ready ? 'ready' : 'not-ready', checks } };
  }
  return { status: 404, body: { error: 'not found' } };
}

const server = http.createServer(async (req, res) => {
  const { status, body } = await route(req.url);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
});

async function main() {
  server.listen(0, '127.0.0.1'); // the port is open at once, but the app is not ready yet
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  async function probe(path) {
    const reply = await fetch(base + path);
    return `${reply.status} ${JSON.stringify(await reply.json())}`;
  }
  async function report(title) {
    console.log(title);
    for (const path of ['/livez', '/startupz', '/readyz']) console.log(`   ${path.padEnd(10)} ${await probe(path)}`);
  }

  await report('1. Just started: the port is open, but warm-up is not finished');
  await sleep(50); // pretend to load caches and open the database pool
  state.started = true;
  await report('2. Warm-up finished');

  db.mode = 'down';
  await report('3. Database refuses connections: not ready, but still ALIVE (no restart helps)');

  db.mode = 'hang';
  const t0 = Date.now();
  await report('4. Database hangs: the readiness check gives up after its own 100 ms timeout');
  console.log('   the three probes together took less than 1 s:', Date.now() - t0 < 1000);

  db.mode = 'ok';
  await report('5. Database is back: ready again');

  state.shuttingDown = true;
  await report('6. Shutting down: readiness fails first so no new traffic arrives, liveness stays green');

  server.close();
  await once(server, 'close');
}

main();
