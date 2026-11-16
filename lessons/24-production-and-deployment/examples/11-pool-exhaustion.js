// Connection pool exhaustion: queueing, the leak that empties a pool for good (missing release), and the fix
// Run: node lessons/24-production-and-deployment/examples/11-pool-exhaustion.js
'use strict';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// A tiny connection pool. Real ones (pg, mysql2, mongodb) work the same way.
// ---------------------------------------------------------------------------------------------
class PoolTimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PoolTimeoutError';
  }
}

class Pool {
  constructor({ size, acquireTimeoutMs }) {
    this.size = size;
    this.acquireTimeoutMs = acquireTimeoutMs;
    this.free = Array.from({ length: size }, (_, i) => ({ id: i + 1 }));
    this.inUse = new Set();
    this.waiting = []; // callers that asked for a connection and have to wait
  }

  acquire() {
    const connection = this.free.pop();
    if (connection) {
      this.inUse.add(connection);
      return Promise.resolve(connection);
    }
    return new Promise((resolve, reject) => {
      const waiter = { resolve };
      waiter.timer = setTimeout(() => {
        this.waiting.splice(this.waiting.indexOf(waiter), 1);
        reject(new PoolTimeoutError(`waited ${this.acquireTimeoutMs} ms for a connection (${JSON.stringify(this.stats())})`));
      }, this.acquireTimeoutMs);
      this.waiting.push(waiter);
    });
  }

  release(connection) {
    const waiter = this.waiting.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(connection); // hand it straight to the next in line
    } else {
      this.inUse.delete(connection);
      this.free.push(connection);
    }
  }

  stats() {
    return { size: this.size, inUse: this.inUse.size, free: this.free.length, waiting: this.waiting.length };
  }
}

// ---------------------------------------------------------------------------------------------
// Request handlers: one correct, one with the classic bug
// ---------------------------------------------------------------------------------------------
async function queryOk(pool, ms, track) {
  const connection = await pool.acquire();
  try {
    track.running++;
    track.max = Math.max(track.max, track.running);
    await sleep(ms); // the query
  } finally {
    track.running--;
    pool.release(connection); // ALWAYS give it back, also when the query throws
  }
}

async function queryBuggy(pool, shouldFail) {
  const connection = await pool.acquire();
  if (shouldFail) throw new Error('query failed'); // BUG: the connection is never released on this path
  await sleep(10);
  pool.release(connection);
}

async function queryFixed(pool, shouldFail) {
  const connection = await pool.acquire();
  try {
    if (shouldFail) throw new Error('query failed');
    await sleep(10);
  } finally {
    pool.release(connection);
  }
}

async function main() {
  console.log('1. More work than connections: the extra callers wait in line');
  {
    const pool = new Pool({ size: 2, acquireTimeoutMs: 1000 });
    const track = { running: 0, max: 0 };
    const jobs = Array.from({ length: 6 }, () => queryOk(pool, 50, track)); // 6 queries at the same moment
    console.log('   right after starting 6 queries:', pool.stats());
    await Promise.all(jobs);
    console.log('   all 6 finished. Most queries running at once:', track.max);
    console.log('   afterwards:', pool.stats());
  }

  console.log('2. The leak: an error path that forgets release()');
  {
    const pool = new Pool({ size: 2, acquireTimeoutMs: 100 });
    await Promise.allSettled([queryBuggy(pool, true), queryBuggy(pool, true)]); // two failures, two lost connections
    console.log('   nothing is running, yet:', pool.stats());
    try {
      await queryBuggy(pool, false);
    } catch (err) {
      console.log('   the next, perfectly fine request fails with:');
      console.log(`     ${err.name}: ${err.message}`);
    }
    console.log('   The database looks idle, but every request waits for a connection that never comes back.');
  }

  console.log('3. The fix: try/finally');
  {
    const pool = new Pool({ size: 2, acquireTimeoutMs: 100 });
    await Promise.allSettled([queryFixed(pool, true), queryFixed(pool, true)]);
    console.log('   after two failures:', pool.stats());
    await queryFixed(pool, false);
    console.log('   the next request works:', pool.stats());
  }

  console.log('4. The arithmetic that is done too late');
  const instances = 10;
  const poolSize = 20;
  const databaseLimit = 100; // the default max_connections of PostgreSQL
  console.log(`   ${instances} app instances x pool of ${poolSize} = ${instances * poolSize} connections, the database allows ${databaseLimit}`);
  console.log(`   safe pool size per instance for a budget of 80 (leave room for admin tools and migrations): ${Math.floor(80 / instances)}`);
}

main();
