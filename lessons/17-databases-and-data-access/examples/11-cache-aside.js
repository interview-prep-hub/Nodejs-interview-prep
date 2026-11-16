// Cache-aside with TTL (the Redis pattern, in memory): hits, expiry, invalidation, negative caching, stampede
// Run: node lessons/17-databases-and-data-access/examples/11-cache-aside.js

const { DatabaseSync } = require('node:sqlite');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A tiny cache with a time-to-live per entry. "now" is a parameter so the demo can move time by hand.
// Redis does the same job over the network: SET key value EX 60, GET key, DEL key.
class TtlCache {
  #entries = new Map(); // key -> { value, expiresAt }
  constructor({ now = Date.now, maxEntries = 1000 } = {}) {
    this.now = now;
    this.maxEntries = maxEntries;
  }
  get(key) {
    const entry = this.#entries.get(key);
    if (!entry) return undefined; // miss
    if (entry.expiresAt <= this.now()) {
      this.#entries.delete(key); // expired: behave like a miss
      return undefined;
    }
    return entry.value;
  }
  set(key, value, ttlMs) {
    this.#entries.delete(key); // re-insert so this key becomes the newest
    this.#entries.set(key, { value, expiresAt: this.now() + ttlMs });
    if (this.#entries.size > this.maxEntries) {
      const oldest = this.#entries.keys().next().value; // Map keeps insertion order
      this.#entries.delete(oldest);
    }
  }
  delete(key) {
    this.#entries.delete(key);
  }
  get size() {
    return this.#entries.size;
  }
}

// ---- the "database" ----
const db = new DatabaseSync(':memory:');
db.exec("CREATE TABLE products (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price INTEGER NOT NULL)");
db.exec("INSERT INTO products (name, price) VALUES ('Pen', 200), ('Book', 1500), ('Lamp', 4000)");
let dbReads = 0;
const selectProduct = db.prepare('SELECT id, name, price FROM products WHERE id = ?');
async function readFromDb(id) {
  dbReads++;
  await sleep(10); // a real database call takes time
  const row = selectProduct.get(id);
  return row ? { ...row } : null;
}

// ---- the cache-aside pattern: the APPLICATION talks to both cache and database ----
const NOT_FOUND = Symbol('not found'); // "we asked the database and there is no such row"
const TTL_MS = 60_000;
let clock = 0; // our fake time in ms
const cache = new TtlCache({ now: () => clock });

async function getProduct(id) {
  const key = `product:${id}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached === NOT_FOUND ? null : cached; // 1. hit
  const row = await readFromDb(id); // 2. miss: ask the database
  cache.set(key, row ?? NOT_FOUND, row ? TTL_MS : 5_000); // 3. remember it (missing rows only briefly)
  return row;
}

async function updatePrice(id, price) {
  db.prepare('UPDATE products SET price = ? WHERE id = ?').run(price, id);
  cache.delete(`product:${id}`); // invalidate: the next read reloads fresh data
}

async function main() {
  console.log('1. first read is a miss, the next ones are hits');
  console.log('  read 1:', await getProduct(1), '| db reads so far:', dbReads);
  console.log('  read 2:', await getProduct(1), '| db reads so far:', dbReads);
  console.log('  read 3:', await getProduct(1), '| db reads so far:', dbReads);

  console.log('2. the TTL: after 60 seconds the entry expires');
  clock += 59_000;
  await getProduct(1);
  console.log('  at 59 s  -> db reads:', dbReads, '(still cached)');
  clock += 2_000;
  await getProduct(1);
  console.log('  at 61 s  -> db reads:', dbReads, '(expired, loaded again)');

  console.log('3. stale data: change the row behind the cache and forget to invalidate');
  db.prepare('UPDATE products SET price = 250 WHERE id = 1').run(); // changed outside our helper
  console.log('  cache says price:', (await getProduct(1)).price, '(database says 250)');
  await updatePrice(1, 300); // the correct way: write, then delete the cache key
  console.log('  after updatePrice + invalidate:', (await getProduct(1)).price);

  console.log('4. negative caching: remember that an id does NOT exist (for a short time)');
  dbReads = 0;
  for (let i = 0; i < 5; i++) await getProduct(999);
  console.log('  5 reads of a missing id -> db reads:', dbReads);

  console.log('5. a cache must have a size limit or it becomes a memory leak');
  const small = new TtlCache({ now: () => clock, maxEntries: 3 });
  for (const k of ['a', 'b', 'c', 'd']) small.set(k, k.toUpperCase(), 1000);
  console.log('  size:', small.size, '| "a" still there?', small.get('a') !== undefined, '| "d" there?', small.get('d') !== undefined);

  console.log('6. cache stampede: a hot key expires and 10 requests miss at the same moment');
  clock += TTL_MS + 1; // everything expired
  dbReads = 0;
  await Promise.all(Array.from({ length: 10 }, () => getProduct(2)));
  console.log('  10 concurrent requests -> db reads:', dbReads, '(all ten went to the database)');

  console.log('7. the fix: single flight, concurrent misses share ONE database call');
  const inFlight = new Map(); // key -> promise of the load that is already running
  async function getProductSingleFlight(id) {
    const key = `product:${id}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached === NOT_FOUND ? null : cached;
    if (!inFlight.has(key)) {
      const load = readFromDb(id)
        .then((row) => {
          cache.set(key, row ?? NOT_FOUND, row ? TTL_MS : 5_000);
          return row;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, load);
    }
    return inFlight.get(key);
  }
  clock += TTL_MS + 1;
  dbReads = 0;
  const results = await Promise.all(Array.from({ length: 10 }, () => getProductSingleFlight(3)));
  console.log('  10 concurrent requests -> db reads:', dbReads, '| all got the same product:', results.every((r) => r.name === 'Lamp'));

  console.log('8. spread the expiry: add random jitter to the TTL so keys do not all expire together');
  const jittered = (ttl) => Math.round(ttl * (0.9 + Math.random() * 0.2)); // 90% to 110% of ttl
  const samples = Array.from({ length: 1000 }, () => jittered(TTL_MS));
  console.log('  1000 TTLs all within 54000..66000?', samples.every((t) => t >= 54_000 && t <= 66_000));

  db.close();
}

main();
