// Memory leaks 1: an unbounded cache, a global array, an accidental global, a Buffer view, and the fixes
// (LRU, ring buffer, WeakMap, WeakRef, copying). The last part shows how a leak looks over time.
// @flags --expose-gc
// Run: node --expose-gc lessons/19-performance-and-memory/examples/03-leaks-cache-and-globals.js
const { setTimeout: sleep } = require('node:timers/promises');

if (typeof global.gc !== 'function') {
  console.log('Please run this example with the --expose-gc flag (see the Run line above).');
  process.exit(1);
}

// A tiny negative difference can happen (other garbage was freed meanwhile): show it as 0.
const mb = (bytes) => (Math.max(0, bytes) / 1024 / 1024).toFixed(2) + ' MB';
const heap = () => {
  global.gc(); // collect everything that is not reachable, so heapUsed shows only what is kept
  global.gc(); // more runs also clear things that the first run only marked as weak
  global.gc();
  return process.memoryUsage().heapUsed;
};

// pretend this is the result of a slow database query: about 8 KB per user
const loadUser = (id) => ({ id, history: new Array(1000).fill(id) });

// A tiny deterministic random generator, so that every run prints the same numbers.
function makeRandom(seed) {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}
// 80% of the requests ask for one of 50 popular users, 20% for any of 5000 users.
function nextUserId(random) {
  return random() < 0.8 ? Math.floor(random() * 50) : Math.floor(random() * 5000);
}

// ---- Leak 1: a cache without a limit --------------------------------------------------
const unboundedCache = new Map();
function getUserUnbounded(id) {
  if (!unboundedCache.has(id)) unboundedCache.set(id, loadUser(id));
  return unboundedCache.get(id);
}

// ---- Fix 1: a bounded cache that throws away the least recently used entry ------------
// A Map remembers the order in which keys were inserted, which is all an LRU needs.
class LruCache {
  constructor(maxEntries) {
    this.maxEntries = maxEntries;
    this.map = new Map();
    this.hits = 0;
    this.misses = 0;
  }
  get(key, load) {
    if (this.map.has(key)) {
      this.hits++;
      const value = this.map.get(key);
      this.map.delete(key); // delete and set again: the key becomes "most recently used"
      this.map.set(key, value);
      return value;
    }
    this.misses++;
    const value = load(key);
    this.map.set(key, value);
    if (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value; // first key in the Map = least recently used
      this.map.delete(oldestKey);
    }
    return value;
  }
}

function leakDemo(title, handler) {
  const random = makeRandom(42);
  const before = heap();
  for (let i = 0; i < 10_000; i++) handler(nextUserId(random));
  console.log(title.padEnd(34), 'kept in memory:', mb(heap() - before));
}

console.log('--- caches: 10000 requests, 5000 possible users');
leakDemo('Map with no limit', getUserUnbounded);
const lru = new LruCache(200);
leakDemo('LRU with a limit of 200 entries', (id) => lru.get(id, loadUser));
console.log('LRU hit rate:', ((lru.hits / (lru.hits + lru.misses)) * 100).toFixed(0) + '%', '| entries:', lru.map.size);
unboundedCache.clear();

// ---- Leak 2: a global array that every request appends to -----------------------------
const requestLog = [];
function handleAndLog(id) {
  requestLog.push({ id, at: id, payload: new Array(200).fill(id) }); // never trimmed
}

// ---- Fix 2: keep only the last N entries (a ring buffer) ------------------------------
class RingBuffer {
  constructor(size) {
    this.items = new Array(size);
    this.next = 0;
  }
  push(item) {
    this.items[this.next] = item; // overwrites the oldest entry once the buffer is full
    this.next = (this.next + 1) % this.items.length;
  }
}
const recent = new RingBuffer(100);
function handleAndKeepRecent(id) {
  recent.push({ id, at: id, payload: new Array(200).fill(id) });
}

console.log('\n--- a global array: 10000 requests');
leakDemo('global array, never trimmed', handleAndLog);
leakDemo('ring buffer of the last 100', handleAndKeepRecent);
requestLog.length = 0; // clean up before the next demo

// ---- Leak 3: extra data about objects stored in a Map ---------------------------------
// Fix 3: a WeakMap holds its keys weakly. When nobody else has the key, the entry disappears.
function metadataDemo(title, store) {
  const before = heap();
  for (let i = 0; i < 2000; i++) {
    const connection = { id: i }; // the key object: it is dropped at the end of every loop turn
    store.set(connection, new Array(500).fill(i)); // data we want to attach to it
  }
  console.log(title.padEnd(34), 'kept in memory:', mb(heap() - before));
}
console.log('\n--- extra data attached to objects that die soon: 2000 objects');
metadataDemo('Map keyed by the object', new Map());
metadataDemo('WeakMap keyed by the object', new WeakMap());

// ---- Leak 4: a tiny piece of a huge string keeps the whole string alive ---------------
// V8 does not copy a long substring. It stores "a view into the parent string".
// So keeping 30 characters can keep 2 MB alive. Copying the piece (here through a Buffer) breaks the link.
function takeNames(copy) {
  const names = [];
  for (let i = 0; i < 20; i++) {
    const page = ('payload ' + i + ' ').repeat(200_000); // about 2 MB of text
    const piece = page.slice(10, 40); // we only want 30 characters
    names.push(copy ? Buffer.from(piece).toString() : piece);
  }
  return names;
}
function sliceDemo(title, copy) {
  const before = heap();
  const names = takeNames(copy); // the big pages are out of scope when this returns
  console.log(title.padEnd(34), 'kept in memory:', mb(heap() - before), '(for', names.length, 'pieces of 30 characters)');
}
console.log('\n--- a small slice of a big string: 20 pages of 2 MB');
sliceDemo('slice() kept as it is', false);
sliceDemo('slice() copied to a new string', true);

// ---- Leak 5: a small view of a big Buffer keeps the whole Buffer alive -----------------
// buf.subarray() (and buf.slice()) do NOT copy. They are a window onto the same memory.
// Fix: copy the bytes you want with Buffer.from(view).
function takeHeaders(copy) {
  const headers = [];
  for (let i = 0; i < 20; i++) {
    const response = Buffer.alloc(1024 * 1024, 'x'); // a 1 MB response body (outside the V8 heap)
    const header = response.subarray(0, 16); // we only want the first 16 bytes
    headers.push(copy ? Buffer.from(header) : header);
  }
  return headers;
}
function bufferDemo(title, copy) {
  heap(); // full GC first
  const before = process.memoryUsage().arrayBuffers; // Buffer memory is NOT in heapUsed, so we read arrayBuffers
  const headers = takeHeaders(copy);
  heap(); // full GC again, so the 1 MB bodies that nobody keeps are really freed
  console.log(title.padEnd(34), 'kept in memory:', mb(process.memoryUsage().arrayBuffers - before), '(for', headers.length, 'headers of 16 bytes)');
}
console.log('\n--- a small view of a big Buffer: 20 responses of 1 MB');
bufferDemo('subarray() kept as it is', false);
bufferDemo('subarray() copied with Buffer.from', true);

// ---- Leak 6: an accidental global variable ------------------------------------------------
// Without 'use strict', assigning to a name that was never declared creates a global variable.
// A global is reachable for as long as the process lives, so what it points to is never freed.
// (CommonJS files are NOT strict by default. ES modules and classes always are.)
function buildReportSloppy(id) {
  // eslint-disable-next-line no-undef
  bigResult = new Array(100_000).fill(id); // forgot const: this creates globalThis.bigResult
  return bigResult.length;
}
function buildReportStrict(id) {
  'use strict';
  try {
    bigResultStrict = new Array(100_000).fill(id); // the same mistake in strict mode
  } catch (err) {
    return err.name + ': ' + err.message; // strict mode refuses to create the global
  }
}
function globalDemo() {
  const before = heap();
  buildReportSloppy(1); // the array is not used after this call, but it is still reachable
  console.log('sloppy mode: kept in memory:'.padEnd(34), mb(heap() - before), '| typeof globalThis.bigResult =', typeof globalThis.bigResult);
  delete globalThis.bigResult; // clean up
  console.log('strict mode: the same line gives', buildReportStrict(1));
}
console.log('\n--- an accidental global (forgot const)');
globalDemo();

// ---- WeakRef: a cache that may be emptied by the garbage collector ---------------------
(async () => {
  console.log('\n--- WeakRef');
  let report = { rows: new Array(10_000).fill('row') };
  const ref = new WeakRef(report);
  console.log('while we hold the object, deref() gives it back:', ref.deref() !== undefined);
  report = null; // drop our only normal reference
  console.log('same turn, after dropping it:               ', ref.deref() !== undefined, '(kept alive until the end of the current turn)');
  await sleep(10); // let the current turn end
  global.gc();
  console.log('after a later turn and a GC:                ', ref.deref() !== undefined, '(usually false; the language does not promise when)');

  // ---- How a leak looks over time: the "staircase" ----------------------------------------
  // In production you would log heapUsed once a minute. Here a "minute" is a round of 400 requests,
  // and every request asks for a NEW user (the worst case for a cache).
  console.log('\n--- confirming a leak: heapUsed after a full GC, once per round (400 new users per round)');
  let nextId = 100_000;
  function floorsOf(handler) {
    const start = heap();
    const floors = [];
    for (let round = 1; round <= 6; round++) {
      for (let i = 0; i < 400; i++) handler(nextId++);
      floors.push(heap() - start); // the "floor": what is still alive after a full GC
    }
    return floors;
  }
  const leakyMap = new Map(); // no limit
  const leakyFloors = floorsOf((id) => leakyMap.set(id, loadUser(id)));
  leakyMap.clear();
  const boundedCache = new LruCache(100); // limit of 100 entries
  const boundedFloors = floorsOf((id) => boundedCache.get(id, loadUser));
  console.log('round   leaky Map   bounded LRU');
  for (let round = 0; round < 6; round++) {
    console.log(String(round + 1).padStart(5), mb(leakyFloors[round]).padStart(11), mb(boundedFloors[round]).padStart(13));
  }
  const rises = leakyFloors.every((value, i) => i === 0 || value > leakyFloors[i - 1]);
  console.log('leaky floor rises every round:', rises, '| bounded floor stays flat after it is full:', boundedFloors[5] - boundedFloors[2] < 1024 * 1024);
})();
