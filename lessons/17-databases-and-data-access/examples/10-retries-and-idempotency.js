// Database errors: transient vs permanent, retry with exponential backoff and jitter, timeouts, idempotency keys
// Run: node lessons/17-databases-and-data-access/examples/10-retries-and-idempotency.js

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- 1. which errors are worth retrying? Only the ones that can go away by themselves ----
const SQLITE_BUSY = 5; // another connection holds the lock
const SQLITE_LOCKED = 6;
const NETWORK_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE']);
function isTransient(err) {
  if (NETWORK_CODES.has(err.code)) return true;
  return err.errcode === SQLITE_BUSY || err.errcode === SQLITE_LOCKED;
}

// ---- 2. retry with exponential backoff + full jitter ----
// sleep and random are parameters so the demo below is deterministic.
async function retry(fn, { retries = 3, baseDelayMs = 100, maxDelayMs = 1000, shouldRetry = isTransient, wait = sleep, random = Math.random, onRetry } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt > retries || !shouldRetry(err)) throw err; // out of tries, or retrying cannot help
      const ceiling = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.floor(random() * ceiling); // jitter: a random wait between 0 and the ceiling
      if (onRetry) onRetry({ attempt, delay, err });
      await wait(delay);
    }
  }
}

// ---- 3. a timeout wrapper (note: it stops WAITING, it does not stop the work) ----
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error(`timed out after ${ms} ms`), { code: 'ETIMEDOUT' })), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function main() {
  console.log('1. the waiting times: ceiling doubles each time, jitter picks a random point below it');
  const ceilings = [1, 2, 3, 4, 5].map((a) => Math.min(1000, 100 * 2 ** (a - 1)));
  console.log('  ceilings (ms):', ceilings);
  const seen = [];
  await retry(async (attempt) => {
    if (attempt <= 5) throw Object.assign(new Error('flaky'), { code: 'ECONNRESET' });
    return 'ok';
  }, { retries: 5, wait: async () => {}, random: () => 0.5, onRetry: ({ delay }) => seen.push(delay) });
  console.log('  delays with random() = 0.5 (ms):', seen);

  console.log('2. a REAL transient error: SQLITE_BUSY while another connection holds the write lock');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-demo-'));
  const file = path.join(dir, 'app.db');
  const holder = new DatabaseSync(file);
  const worker = new DatabaseSync(file);
  try {
    holder.exec('CREATE TABLE jobs (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
    holder.exec('BEGIN IMMEDIATE'); // the holder owns the write lock
    const result = await retry(
      (attempt) => {
        console.log(`  attempt ${attempt}: INSERT`);
        return worker.prepare('INSERT INTO jobs (name) VALUES (?)').run('send email');
      },
      {
        wait: async () => {},
        random: () => 0.5,
        onRetry: ({ attempt, err }) => {
          console.log(`    failed (${err.errstr}), will retry`);
          if (attempt === 2) holder.exec('COMMIT'); // pretend the other transaction finished meanwhile
        },
      },
    );
    console.log('  inserted, changes =', result.changes);
  } finally {
    // runs even if something above throws, so no temp folder is left behind
    holder.close();
    worker.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  console.log('3. a permanent error is NOT retried (retrying cannot fix bad data)');
  const mem = new DatabaseSync(':memory:');
  mem.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)');
  mem.prepare('INSERT INTO t (name) VALUES (?)').run('a');
  let tries = 0;
  try {
    await retry(() => {
      tries++;
      return mem.prepare('INSERT INTO t (name) VALUES (?)').run('a');
    }, { wait: async () => {} });
  } catch (err) {
    console.log(`  gave up after ${tries} try: ${err.message}`);
  }

  console.log('4. a timeout stops the waiting, but the work may still finish on the server');
  let slowFinished = false;
  const slowQuery = sleep(60).then(() => {
    slowFinished = true;
    return 'rows';
  });
  try {
    await withTimeout(slowQuery, 15);
  } catch (err) {
    console.log('  caller saw:', err.code, '|', err.message, '| finished yet?', slowFinished);
  }
  await sleep(80);
  console.log('  80 ms later the slow query finished anyway:', slowFinished);

  console.log('5. why retries need idempotency: the first attempt worked but the answer was lost');
  mem.exec(`
    CREATE TABLE payments (
      id              INTEGER PRIMARY KEY,
      idempotency_key TEXT UNIQUE,   -- many NULLs are allowed, but a real key may appear only once
      amount          INTEGER NOT NULL
    )
  `);
  const insertPayment = mem.prepare('INSERT INTO payments (idempotency_key, amount) VALUES (?, ?) ON CONFLICT (idempotency_key) DO NOTHING');
  const findByKey = mem.prepare('SELECT id, amount FROM payments WHERE idempotency_key = ?');
  const countPayments = () => {
    const r = mem.prepare('SELECT count(*) AS n, coalesce(sum(amount), 0) AS total FROM payments').get();
    return `${r.n} payment row(s), money taken: ${r.total}`;
  };

  // The "server": it writes the payment, and on the first call the response is lost on the way back.
  function makeServer(useKey) {
    let calls = 0;
    return async function charge(amount, key) {
      calls++;
      let saved;
      if (useKey) {
        const r = insertPayment.run(key, amount);
        saved = r.changes === 1 ? { id: r.lastInsertRowid, replayed: false } : { ...findByKey.get(key), replayed: true };
      } else {
        saved = { id: mem.prepare('INSERT INTO payments (amount) VALUES (?)').run(amount).lastInsertRowid, replayed: false };
      }
      if (calls === 1) throw Object.assign(new Error('response lost'), { code: 'ECONNRESET' }); // work done, answer lost
      return saved;
    };
  }

  const naive = makeServer(false);
  await retry(() => naive(50), { wait: async () => {} });
  console.log('  without a key  :', countPayments(), '<- charged twice!');

  mem.exec('DELETE FROM payments');
  const safe = makeServer(true);
  const key = 'order-1001-attempt'; // created ONCE by the client and sent again with every retry
  const answer = await retry(() => safe(50, key), { wait: async () => {} });
  console.log('  with a key     :', countPayments(), '<- charged once');
  console.log('  retry answer   :', answer, '(the saved result is replayed)');

  mem.close();
}

main();
