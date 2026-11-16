// A hand-written async connection pool: acquire, release, wait queue, timeout, leak, shutdown
// Run: node lessons/17-databases-and-data-access/examples/07-connection-pool.js

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---- a fake database connection (opening one is slow, a query takes a little time) ----
let opened = 0;
let closed = 0;
async function connect() {
  await sleep(5); // TCP handshake, TLS, login: opening a real connection costs a lot
  const id = ++opened;
  return {
    id,
    async query(sql) {
      await sleep(10);
      return `result of "${sql}" from connection #${id}`;
    },
    async close() {
      closed++;
    },
  };
}

// ---- the pool ----
class Pool {
  #idle = []; // connections that are open and free
  #leased = new Set(); // connections handed out and not yet returned
  #waiters = []; // callers waiting in line: { resolve, reject, timer }
  #total = 0; // open connections + connections being opened
  #closed = false;
  #drained = null;

  constructor({ create, max = 3, acquireTimeoutMs = 1000 }) {
    this.create = create;
    this.max = max;
    this.acquireTimeoutMs = acquireTimeoutMs;
  }

  get stats() {
    return { total: this.#total, idle: this.#idle.length, busy: this.#total - this.#idle.length, waiting: this.#waiters.length };
  }

  async acquire() {
    if (this.#closed) throw new Error('pool is closed');
    let conn;
    if (this.#idle.length > 0) {
      conn = this.#idle.pop(); // 1. reuse a free connection
    } else if (this.#total < this.max) {
      this.#total++; // 2. open a new one (reserve the slot first, because creating takes time)
      try {
        conn = await this.create();
      } catch (err) {
        this.#total--;
        throw err;
      }
    } else {
      conn = await new Promise((resolve, reject) => {
        // 3. the pool is full: wait in line, but not forever
        const waiter = { resolve, reject, timer: null };
        waiter.timer = setTimeout(() => {
          this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
          reject(new Error(`acquire timed out after ${this.acquireTimeoutMs} ms, the pool is exhausted`));
        }, this.acquireTimeoutMs);
        this.#waiters.push(waiter);
      });
    }
    this.#leased.add(conn);
    return conn;
  }

  release(conn) {
    if (!this.#leased.delete(conn)) throw new Error('release() called with a connection that is not leased');
    if (this.#closed) return void this.#closeOne(conn);
    const waiter = this.#waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(conn); // hand it straight to the next caller in line
    } else {
      this.#idle.push(conn);
    }
  }

  // The safe way: the connection ALWAYS goes back, even when fn throws.
  async use(fn) {
    const conn = await this.acquire();
    try {
      return await fn(conn);
    } finally {
      this.release(conn);
    }
  }

  async end() {
    this.#closed = true;
    for (const waiter of this.#waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error('pool is closing'));
    }
    for (const conn of this.#idle.splice(0)) await this.#closeOne(conn);
    if (this.#total > 0) await new Promise((resolve) => (this.#drained = resolve)); // wait for leased ones
  }

  async #closeOne(conn) {
    await conn.close();
    this.#total--;
    if (this.#total === 0 && this.#drained) this.#drained();
  }
}

async function main() {
  console.log('1. no pool: every request opens its own connection');
  for (let i = 1; i <= 6; i++) {
    const conn = await connect();
    await conn.query('SELECT 1');
    await conn.close();
  }
  console.log(`  6 requests, connections opened: ${opened}`);
  opened = 0;
  closed = 0;

  console.log('2. a pool of 2: 6 requests share 2 connections, the others wait in line');
  const pool = new Pool({ create: connect, max: 2 });
  let peakBusy = 0;
  const jobs = [];
  for (let i = 1; i <= 6; i++) {
    jobs.push(
      pool.use(async (conn) => {
        peakBusy = Math.max(peakBusy, pool.stats.busy);
        return conn.query(`SELECT ${i}`);
      }),
    );
  }
  console.log('  right after starting all 6:', pool.stats);
  const results = await Promise.all(jobs);
  console.log('  a result      :', results[0]);
  const usedIds = [...new Set(results.map((text) => text.match(/#(\d+)/)[1]))].sort();
  console.log('  connections that did the work:', usedIds);
  console.log(`  connections opened: ${opened}, most in use at once: ${peakBusy}`);
  console.log('  when idle again:', pool.stats);
  await pool.end();
  console.log(`  after end(): opened ${opened}, closed ${closed}`);

  console.log('3. a leak: code that forgets to release exhausts the pool');
  const leaky = new Pool({ create: connect, max: 2, acquireTimeoutMs: 50 });
  async function buggyHandler() {
    const conn = await leaky.acquire();
    await conn.query('SELECT 1');
    throw new Error('something failed'); // release() below is never reached
    // leaky.release(conn);
  }
  for (let i = 0; i < 2; i++) await buggyHandler().catch(() => {});
  console.log('  after 2 failed requests:', leaky.stats);
  try {
    await leaky.use((conn) => conn.query('SELECT 1'));
  } catch (err) {
    console.log('  3rd request:', err.message);
  }

  console.log('4. the fix: use() releases in a finally block');
  const healthy = new Pool({ create: connect, max: 2, acquireTimeoutMs: 50 });
  for (let i = 0; i < 5; i++) {
    await healthy.use(async (conn) => {
      await conn.query('SELECT 1');
      throw new Error('something failed');
    }).catch(() => {});
  }
  console.log('  after 5 failed requests:', healthy.stats);
  try {
    healthy.release({ id: 'stranger' });
  } catch (err) {
    console.log('  releasing a stranger:', err.message);
  }

  console.log('5. shutdown: end() closes idle connections and refuses new work');
  await healthy.end();
  try {
    await healthy.acquire();
  } catch (err) {
    console.log('  acquire after end():', err.message);
  }
}

main();
