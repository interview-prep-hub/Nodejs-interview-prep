// Connection config from the environment (validate, redact) and graceful shutdown (stop traffic, drain, close the database)
// Run: node lessons/17-databases-and-data-access/examples/12-config-and-shutdown.js

const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const util = require('node:util');
const { DatabaseSync } = require('node:sqlite');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------- configuration: read once, validate everything, fail fast ----------
function loadConfig(env) {
  const problems = [];
  let url = null;
  if (!env.DATABASE_URL) {
    problems.push('DATABASE_URL is required');
  } else {
    try {
      url = new URL(env.DATABASE_URL); // note: a MongoDB URL with several hosts (h1,h2) is not a valid URL, pass it to the driver as text
    } catch {
      problems.push('DATABASE_URL is not a valid URL');
    }
  }
  const poolMax = Number(env.DB_POOL_MAX ?? 10); // env values are always strings, convert them
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 100) problems.push('DB_POOL_MAX must be a whole number from 1 to 100');
  const timeoutMs = Number(env.DB_TIMEOUT_MS ?? 5000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100) problems.push('DB_TIMEOUT_MS must be a whole number, at least 100');
  if (problems.length > 0) throw new Error('invalid configuration:\n    - ' + problems.join('\n    - '));
  return Object.freeze({
    db: Object.freeze({
      host: url.hostname,
      port: url.port ? Number(url.port) : 5432,
      database: url.pathname.slice(1),
      user: decodeURIComponent(url.username), // special characters in a password must be percent-encoded in the URL
      password: decodeURIComponent(url.password),
      ssl: url.searchParams.get('sslmode') === 'require',
      poolMax,
      timeoutMs,
    }),
  });
}

// Never write a password to a log. Show the URL with the secret replaced.
function redact(urlText) {
  const url = new URL(urlText);
  if (url.password) url.password = '***';
  return url.toString();
}

// ---------- graceful shutdown ----------
function createShutdown({ server, db, log, graceMs = 3000 }) {
  let running = null;
  const state = {
    shuttingDown: false,
    whenDone: () => running,
    start(reason) {
      if (running) {
        log(`shutdown already running, ignoring ${reason}`);
        return running; // a second signal must not start a second shutdown
      }
      running = (async () => {
        log(`shutdown requested (${reason})`);
        state.shuttingDown = true;
        const closed = new Promise((resolve) => server.close(resolve)); // 1. stop accepting NEW connections
        server.closeIdleConnections(); // drop keep-alive sockets that are waiting and idle right now
        const force = setTimeout(() => {
          log('grace period over, closing the remaining connections');
          server.closeAllConnections();
        }, graceMs);
        force.unref(); // this timer alone must not keep the process alive
        await closed; // resolves when every running request has finished
        clearTimeout(force);
        log('http server closed');
        db.close(); // 2. only now close the database: nobody is using it any more
        log('database closed');
      })();
      return running;
    },
  };
  return state;
}

async function main() {
  console.log('1. a .env file is just text; util.parseEnv turns it into an object');
  const envText = [
    '# database settings',
    'DATABASE_URL=postgres://app_user:p%40ss%2Fword@db.internal:5432/appdb?sslmode=require',
    'DB_POOL_MAX=20',
  ].join('\n');
  const env = util.parseEnv(envText);
  console.log('  keys:', Object.keys(env));

  console.log('2. loadConfig converts and validates once, then the config is frozen');
  const config = loadConfig(env);
  console.log('  host/db   :', config.db.host, '/', config.db.database);
  console.log('  poolMax   :', config.db.poolMax, '(a number now, default timeout', config.db.timeoutMs, 'ms)');
  console.log('  password  :', config.db.password, '(decoded from p%40ss%2Fword)');
  console.log('  safe to log:', redact(env.DATABASE_URL));
  console.log('  frozen?', Object.isFrozen(config), Object.isFrozen(config.db));

  console.log('3. fail fast: report ALL problems at startup, not one crash per deploy');
  try {
    loadConfig({ DB_POOL_MAX: 'lots', DB_TIMEOUT_MS: '5' });
  } catch (err) {
    console.log(' ', err.message);
  }

  console.log('4. process.loadEnvFile reads a real file, but variables already set in the shell win');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'config-demo-'));
  const envFile = path.join(dir, '.env');
  fs.writeFileSync(envFile, 'DATABASE_URL=postgres://localhost/fromfile\nDB_POOL_MAX=50\n');
  process.env.DB_POOL_MAX = '3'; // pretend the shell or the hosting platform set this
  process.loadEnvFile(envFile);
  console.log('  DB_POOL_MAX is', process.env.DB_POOL_MAX, '(shell wins), DATABASE_URL is', process.env.DATABASE_URL);
  console.log('  poolMax in config:', loadConfig(process.env).db.poolMax);
  delete process.env.DB_POOL_MAX;
  delete process.env.DATABASE_URL;

  console.log('5. graceful shutdown: finish running requests, then close the database');
  const dbFile = path.join(dir, 'app.db');
  const db = new DatabaseSync(dbFile);
  db.exec('CREATE TABLE visits (id INTEGER PRIMARY KEY, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  db.exec('INSERT INTO visits DEFAULT VALUES; INSERT INTO visits DEFAULT VALUES');

  const log = (text) => console.log('  ' + text);
  let requestStarted;
  const gotRequest = new Promise((resolve) => (requestStarted = resolve));
  const server = http.createServer(async (req, res) => {
    log('request started (a slow one)');
    requestStarted();
    await sleep(50); // pretend the work takes a while
    db.exec('INSERT INTO visits DEFAULT VALUES');
    const { n } = db.prepare('SELECT count(*) AS n FROM visits').get();
    // While shutting down, tell the client not to reuse this connection. Otherwise the socket would sit idle
    // (keep-alive) after the answer and server.close() would wait for it to time out.
    if (shutdown.shuttingDown) res.setHeader('connection', 'close');
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ visits: n }));
    log('request finished');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  const shutdown = createShutdown({ server, db, log });
  process.on('SIGTERM', () => shutdown.start('SIGTERM')); // what a container platform sends on a deploy
  process.on('SIGINT', () => shutdown.start('SIGINT')); // Ctrl+C

  const pending = fetch(`http://127.0.0.1:${port}/slow`).then((r) => r.json());
  await gotRequest;
  // process.emit runs the handlers like a real signal would. (On Windows a real SIGTERM kills the process without
  // running handlers, so we trigger them by hand in this demo.)
  process.emit('SIGTERM');
  process.emit('SIGINT'); // the impatient second signal
  await shutdown.whenDone();
  log('the in-flight request still got its answer: ' + JSON.stringify(await pending));

  try {
    await fetch(`http://127.0.0.1:${port}/slow`);
  } catch (err) {
    log('a new request after shutdown fails: ' + err.cause.code);
  }

  process.removeAllListeners('SIGTERM');
  process.removeAllListeners('SIGINT');
  fs.rmSync(dir, { recursive: true, force: true });
  log('nothing left running, so the process ends by itself (no process.exit needed)');
}

main();
