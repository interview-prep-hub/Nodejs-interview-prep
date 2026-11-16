// Graceful shutdown done properly: fail readiness, stop intake, drain in-flight work, close dependencies, hard timeout, exit code, double signal
// Run: node lessons/24-production-and-deployment/examples/05-graceful-shutdown.js
// A real server you can stop with Ctrl+C: node lessons/24-production-and-deployment/examples/05-graceful-shutdown.js --serve
//
// Real signals are awkward to send on Windows, so the demo "sends" them with process.emit('SIGTERM').
// That runs exactly the same handlers a real signal would run.
'use strict';
const http = require('node:http');
const { once } = require('node:events');
const { createLogger } = require('./_logger');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- two fake dependencies that have to be closed in the right order ----------
class FakeDatabase {
  constructor(log) {
    this.log = log;
  }
  async close() {
    this.log.info('closing the database pool');
    await sleep(40);
    this.log.info('database pool closed');
  }
}

class FakeQueueWorker {
  constructor(log) {
    this.log = log;
    this.running = false;
    this.jobs = 0;
  }
  start() {
    this.running = true;
    this.loop = this.run();
  }
  async run() {
    while (this.running) {
      await sleep(60); // one job takes 60 ms, and we only look at the flag between jobs
      this.jobs++;
    }
    this.log.info('queue worker finished its current job and stopped');
  }
  async stop() {
    this.log.info('asking the queue worker to stop after its current job');
    this.running = false;
    await this.loop;
  }
}

// ---------- the application ----------
function createApp({ log, port = 0, timeoutMs = 10_000, readinessDelayMs = 0, exit }) {
  const db = new FakeDatabase(log);
  const worker = new FakeQueueWorker(log);
  let shuttingDown = false;
  let forced = false;
  let shutdownPromise = null;

  const forceExit = (code) => {
    forced = true;
    exit(code); // in production this is process.exit(code) and it never returns
  };

  function reply(res, status, text) {
    if (shuttingDown) res.setHeader('Connection', 'close'); // "after this answer, hang up", so no idle socket is left behind
    res.statusCode = status;
    res.end(text);
  }

  const server = http.createServer((req, res) => {
    if (req.url === '/readyz') return reply(res, shuttingDown ? 503 : 200, shuttingDown ? 'shutting down' : 'ready');
    if (req.url === '/slow') return void setTimeout(() => reply(res, 200, 'slow done'), 300);
    if (req.url === '/stuck') return; // a request that never finishes (a client that never reads, a bug)
    return reply(res, 200, 'ok');
  });

  async function drain(signal) {
    const started = Date.now();
    log.info({ signal }, 'shutdown started');
    shuttingDown = true; // 1. readiness answers 503 from now on

    const hardStop = setTimeout(() => {
      // 2. The escape hatch. It is armed before anything else can hang.
      log.error({ timeoutMs }, 'graceful shutdown took too long, forcing exit');
      forceExit(1);
    }, timeoutMs);
    hardStop.unref(); // this timer alone must never keep the process alive

    log.info({ readinessDelayMs }, 'readiness is failing, waiting for the load balancer to notice');
    await sleep(readinessDelayMs); // 3. keep serving while the traffic is being moved away

    const serverClosed = once(server, 'close');
    server.close(); // 4. stop accepting new connections, close the idle keep-alive ones
    const sweep = setInterval(() => server.closeIdleConnections(), 20); // connections that become idle later
    log.info('no longer accepting new connections, waiting for requests in flight');
    await Promise.all([
      serverClosed.then(() => log.info('http server closed: every request has finished')),
      worker.stop(), // 5. stop taking new jobs too
    ]);
    clearInterval(sweep);

    await db.close(); // 6. last, because both the server and the worker were using it
    clearTimeout(hardStop);
    log.info({ ms: Date.now() - started, forced }, 'shutdown complete');
    return forced ? 1 : 0; // 7. the exit code the process should end with
  }

  function shutdown(signal) {
    if (shutdownPromise) {
      // A second signal means "I am impatient": stop being graceful.
      log.warn({ signal }, 'second signal while shutting down, exiting now');
      forceExit(1);
      return shutdownPromise;
    }
    shutdownPromise = drain(signal);
    return shutdownPromise;
  }

  async function start() {
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
    worker.start();
    return server.address().port;
  }

  return { server, start, shutdown };
}

// Connects SIGTERM and SIGINT to shutdown. Note: it sets process.exitCode, it does NOT call process.exit().
function installSignalHandlers(shutdown) {
  const installed = [];
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const handler = () => {
      shutdown(signal).then((code) => {
        process.exitCode = code; // Node ends by itself, with this code, once nothing is left to do
      });
    };
    process.on(signal, handler);
    installed.push([signal, handler]);
  }
  return () => installed.forEach(([signal, handler]) => process.off(signal, handler)); // for the demo
}

// ---------------------------------------------------------------------------------------------
// Mode 1: a real server
// ---------------------------------------------------------------------------------------------
async function serve() {
  const log = createLogger({ base: { service: 'demo-api' } }); // JSON lines on stdout
  const app = createApp({ log, port: Number(process.env.PORT ?? 3000), timeoutMs: 10_000, readinessDelayMs: 1000, exit: (code) => process.exit(code) });
  installSignalHandlers(app.shutdown);
  const port = await app.start();
  log.info({ port }, 'listening, press Ctrl+C to stop (try /slow and /readyz)');
}

// ---------------------------------------------------------------------------------------------
// Mode 2 (default): three scenarios that run by themselves
// ---------------------------------------------------------------------------------------------
function get(port, path, agent) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path, agent }, (res) => {
      const socket = res.socket; // res.socket becomes null after the response ends, so keep it now
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode, connection: res.headers.connection, body, socket }));
    });
    req.on('error', (err) => resolve({ error: err.code ?? err.message }));
  });
}

// The demo collects the server's log lines and prints them after each scenario, so they never mix with the narration.
// The "time" and "ms" fields change on every run, so the demo does not print them.
let collected = [];
const prettyLog = createLogger({
  level: 'debug',
  write: (line) => {
    const { level, msg, time, ms, ...rest } = JSON.parse(line);
    collected.push(`${level.padEnd(5)} ${msg}${Object.keys(rest).length ? ' ' + JSON.stringify(rest) : ''}`);
  },
});
function printServerLog() {
  console.log('   server log:');
  for (const line of collected) console.log('     ' + line);
  collected = [];
}

async function demo() {
  console.log('Scenario 1: a clean shutdown (SIGTERM)');
  {
    const app = createApp({ log: prettyLog, timeoutMs: 2000, readinessDelayMs: 100, exit: () => {} });
    const uninstall = installSignalHandlers(app.shutdown);
    const port = await app.start();

    const keepAlive = new http.Agent({ keepAlive: true });
    const idle = await get(port, '/fast', keepAlive); // leaves one idle keep-alive connection behind
    console.log('   idle keep-alive connection is open:', !idle.socket.destroyed);

    const slow = get(port, '/slow'); // takes 300 ms, will be in flight when the signal arrives
    await sleep(50);
    console.log('   >>> SIGTERM arrives while /slow is in flight');
    process.emit('SIGTERM', 'SIGTERM');
    await sleep(20);
    const during = await get(port, '/readyz');
    console.log('   during the readiness delay, /readyz says:', during.status, during.body);
    await sleep(120);
    const after = await get(port, '/readyz');
    console.log('   after the listener closed, a new request fails with:', after.error);

    const result = await slow;
    console.log('   the request that was in flight got:', result.status, JSON.stringify(result.body), '| connection header:', result.connection);
    await sleep(100); // let the signal handler store the exit code
    console.log('   idle keep-alive connection was closed by the server:', idle.socket.destroyed);
    console.log('   process.exitCode is now:', process.exitCode);
    printServerLog();
    process.exitCode = 0;
    uninstall();
    keepAlive.destroy();
  }

  console.log('Scenario 2: a request never finishes, so the hard timeout (300 ms) fires');
  {
    const exits = [];
    let app;
    app = createApp({
      log: prettyLog,
      timeoutMs: 300,
      exit: (code) => {
        exits.push(code);
        app.server.closeAllConnections(); // what process.exit would have done to the open sockets
      },
    });
    const uninstall = installSignalHandlers(app.shutdown);
    const port = await app.start();
    const stuck = get(port, '/stuck');
    await sleep(30);
    console.log('   >>> SIGTERM arrives while /stuck is in flight');
    process.emit('SIGTERM', 'SIGTERM');
    const result = await stuck;
    await sleep(150);
    console.log('   the stuck request ended with:', result.error);
    console.log('   exit(code) was requested with:', exits, '| process.exitCode:', process.exitCode);
    printServerLog();
    process.exitCode = 0;
    uninstall();
  }

  console.log('Scenario 3: the operator presses Ctrl+C twice (second signal = stop waiting)');
  {
    const exits = [];
    let app;
    app = createApp({
      log: prettyLog,
      timeoutMs: 5000,
      exit: (code) => {
        exits.push(code);
        app.server.closeAllConnections();
      },
    });
    const uninstall = installSignalHandlers(app.shutdown);
    const port = await app.start();
    const stuck = get(port, '/stuck');
    await sleep(30);
    console.log('   >>> first SIGINT');
    process.emit('SIGINT', 'SIGINT');
    await sleep(100);
    console.log('   >>> second SIGINT');
    process.emit('SIGINT', 'SIGINT');
    await stuck;
    await sleep(150);
    console.log('   exit(code) was requested with:', exits, '| process.exitCode:', process.exitCode);
    printServerLog();
    process.exitCode = 0; // this is the demo itself ending, so report success to the example runner
    uninstall();
  }
}

if (process.argv.includes('--serve')) serve();
else demo();
