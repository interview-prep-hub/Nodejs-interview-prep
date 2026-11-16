// Caching: cache-aside with TTL, LRU eviction, write-through vs write-behind, and stampede protection
// Run: node lessons/25-architecture-and-patterns/examples/08-caching.js
const { FakeClock } = require('./_fake-clock');

// A fake "database" that counts how often it is used and takes one event-loop turn per call.
function makeDb(initialPairs) {
  const rows = new Map(initialPairs);
  return {
    reads: 0,
    writes: 0,
    rows,
    async read(id) {
      this.reads++;
      await new Promise(setImmediate); // pretend this takes time
      return rows.get(id);
    },
    async write(id, value) {
      this.writes++;
      await new Promise(setImmediate);
      rows.set(id, value);
    },
  };
}

// A cache whose entries expire after a time to live (TTL). The clock is injected so tests are exact.
class TtlCache {
  #map = new Map();
  constructor(clock) {
    this.clock = clock;
  }
  get(key) {
    const entry = this.#map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.clock.now()) {
      this.#map.delete(key);
      return undefined;
    }
    return entry.value;
  }
  set(key, value, ttlMs) {
    this.#map.set(key, { value, expiresAt: this.clock.now() + ttlMs });
  }
  delete(key) {
    this.#map.delete(key);
  }
}

// ----------------------------------------------------------------------
async function cacheAside() {
  console.log('--- 1. Cache-aside with a 60 s TTL, and invalidation on write');
  const clock = new FakeClock();
  const cache = new TtlCache(clock);
  const db = makeDb([[1, 'Ada']]);

  // cache-aside: the APPLICATION checks the cache first, and fills it on a miss
  async function getUser(id) {
    const cached = cache.get(id);
    if (cached !== undefined) return `${cached} (from cache)`;
    const value = await db.read(id);
    cache.set(id, value, 60_000);
    return `${value} (from db)`;
  }
  async function renameUser(id, name) {
    await db.write(id, name); // 1. change the source of truth
    cache.delete(id); //         2. drop the stale copy; the next read refills it
  }

  console.log('  get #1      :', await getUser(1), '| db reads:', db.reads);
  console.log('  get #2      :', await getUser(1), '| db reads:', db.reads);
  clock.tick(61_000);
  console.log('  after 61 s  :', await getUser(1), '| db reads:', db.reads);
  await renameUser(1, 'Ada Lovelace');
  console.log('  after rename:', await getUser(1), '| db reads:', db.reads);
}

// ----------------------------------------------------------------------
// LRU = least recently used. A Map remembers insertion order, so the first key is the oldest.
class LruCache {
  #map = new Map();
  constructor(max) {
    this.max = max;
  }
  get(key) {
    if (!this.#map.has(key)) return undefined;
    const value = this.#map.get(key);
    this.#map.delete(key); // re-insert so this key becomes the NEWEST
    this.#map.set(key, value);
    return value;
  }
  set(key, value) {
    this.#map.delete(key);
    this.#map.set(key, value);
    if (this.#map.size > this.max) this.#map.delete(this.#map.keys().next().value); // evict the oldest
  }
  keys() {
    return [...this.#map.keys()];
  }
}

function lru() {
  console.log('\n--- 2. LRU cache with room for 3 entries');
  const cache = new LruCache(3);
  for (const key of ['a', 'b', 'c']) cache.set(key, key.toUpperCase());
  console.log('  after set a, b, c      :', cache.keys().join(' '), '(oldest first)');
  cache.get('a');
  console.log('  after get a            :', cache.keys().join(' '));
  cache.set('d', 'D');
  console.log('  after set d (b evicted):', cache.keys().join(' '));
}

// ----------------------------------------------------------------------
async function writePolicies() {
  console.log('\n--- 3. Write-through vs write-behind');
  const clock = new FakeClock();
  const cache = new TtlCache(clock);

  const db1 = makeDb([]);
  const writeThrough = async (id, value) => {
    await db1.write(id, value); // the caller waits for the database
    cache.set(id, value, 60_000);
  };
  await writeThrough('p', 1);
  await writeThrough('p', 2);
  await writeThrough('p', 3);
  console.log('  write-through: 3 writes ->', db1.writes, 'db writes, db has p =', db1.rows.get('p'));

  const db2 = makeDb([]);
  const dirty = new Map();
  let flushTimer = null;
  const writeBehind = (id, value) => {
    cache.set(id, value, 60_000); // the caller is done immediately
    dirty.set(id, value); //        only the LATEST value per key is kept
    flushTimer ??= clock.setTimeout(async () => {
      flushTimer = null;
      for (const [k, v] of dirty) await db2.write(k, v);
      dirty.clear();
    }, 1000);
  };
  writeBehind('p', 1);
  writeBehind('p', 2);
  writeBehind('p', 3);
  console.log('  write-behind : 3 writes -> db writes right now:', db2.writes, '(a crash here would lose them)');
  await clock.tickAsync(1000);
  console.log('  write-behind : after the 1 s flush -> db writes:', db2.writes + ', db has p =', db2.rows.get('p'));
}

// ----------------------------------------------------------------------
// Stampede (thundering herd): a hot key expires and many requests ask the database at the same moment.
async function stampede() {
  console.log('\n--- 4. Cache stampede: 10 requests for the same missing key at once');

  const db1 = makeDb([[1, 'Ada']]);
  const cache1 = new Map();
  const naive = async (id) => {
    if (cache1.has(id)) return cache1.get(id);
    const value = await db1.read(id);
    cache1.set(id, value);
    return value;
  };
  await Promise.all(Array.from({ length: 10 }, () => naive(1)));
  console.log('  naive cache-aside      : db reads =', db1.reads);

  // Promise coalescing: while a load is in flight, everybody shares the SAME promise.
  function coalesce(load) {
    const inflight = new Map();
    return (key) => {
      if (inflight.has(key)) return inflight.get(key);
      const promise = load(key).finally(() => inflight.delete(key));
      inflight.set(key, promise);
      return promise;
    };
  }
  const db2 = makeDb([[1, 'Ada']]);
  const cache2 = new Map();
  const loadOnce = coalesce(async (id) => {
    const value = await db2.read(id);
    cache2.set(id, value);
    return value;
  });
  const coalesced = (id) => (cache2.has(id) ? cache2.get(id) : loadOnce(id));
  await Promise.all(Array.from({ length: 10 }, () => coalesced(1)));
  console.log('  with promise coalescing: db reads =', db2.reads);

  // If the one shared load fails, every waiter gets the same error, and the next call tries again.
  const failing = coalesce(async () => {
    throw new Error('db is down');
  });
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => failing('x')));
  console.log('  failing load           :', results.filter((r) => r.status === 'rejected').length, 'callers rejected with:', results[0].reason.message);
}

async function main() {
  await cacheAside();
  lru();
  await writePolicies();
  await stampede();
}

main();
