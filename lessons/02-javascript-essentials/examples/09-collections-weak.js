// Map, Set, WeakMap, WeakSet and WeakRef (plus a small LRU cache built on Map)
// Run: node --expose-gc lessons/02-javascript-essentials/examples/09-collections-weak.js
// @flags --expose-gc

// 1. Map: keys of any type, insertion order, a size property.
const keyObj = { id: 1 };
const map = new Map();
map.set('a', 1).set(2, 'two').set(keyObj, 'object key');
console.log('1a.', map.get(keyObj), map.get({ id: 1 }), map.size, map.has('a'));
map.set(NaN, 'nan works as a key');
console.log('1b.', map.get(NaN));
console.log('1c.', [...map.keys()]);

// A plain object turns every key into a string. A Map keeps the real key.
const obj = {};
obj[1] = 'number';
obj['1'] = 'string';
const map2 = new Map().set(1, 'number').set('1', 'string');
console.log('1d.', obj, map2.size);

// Trap: a Map does not survive JSON.stringify. Convert it first.
const pairs = new Map([['x', 1], ['y', 2]]);
console.log('1e.', JSON.stringify(pairs), JSON.stringify(Object.fromEntries(pairs)));

// Looping over a Map gives [key, value] pairs. A Map can be built from an object, and entries deleted.
const scores = new Map(Object.entries({ ann: 3, bo: 5 }));
for (const [who, score] of scores) console.log('1f.', who, score);
console.log('1g.', scores.delete('ann'), scores.delete('nobody'), [...scores]);

// 2. Set: every value appears once.
const unique = [...new Set([1, 2, 2, 3, 3, 3])];
console.log('2a.', unique, new Set([NaN, NaN]).size, new Set([{}, {}]).size);

const s1 = new Set([1, 2, 3]);
const s2 = new Set([2, 3, 4]);
console.log('2b. union       :', [...s1.union(s2)]);
console.log('2c. intersection:', [...s1.intersection(s2)]);
console.log('2d. difference  :', [...s1.difference(s2)]);
console.log('2e. subset      :', s1.isSubsetOf(new Set([1, 2, 3, 4])));

// 3. WeakMap: keys must be objects, and the map does not keep them alive.
//    No size, no iteration, no clear: you could not do those safely.
const visits = new WeakMap();
const page = { url: '/home' };
visits.set(page, { count: 1 });
visits.get(page).count += 1;
console.log('3a.', visits.get(page), visits.has({ url: '/home' }));
console.log('3b.', typeof visits.size, typeof visits[Symbol.iterator]);
try {
  visits.set('not an object', 1);
} catch (err) {
  console.log('3c.', err.name + ':', err.message);
}

// 4. WeakSet: remember objects you have already seen, without leaking them.
const seen = new WeakSet();
function visit(node) {
  if (seen.has(node)) return 'skipped';
  seen.add(node);
  return 'first visit';
}
const node = {};
console.log('4. ', visit(node), visit(node));

// 5. A classic coding task: an LRU cache (least recently used). A Map remembers insertion
//    order, so its first key is always the oldest. Re-inserting a key makes it the newest.
class LRUCache {
  #max;
  #map = new Map();

  constructor(max) {
    this.#max = max;
  }

  get(key) {
    if (!this.#map.has(key)) return undefined;
    const value = this.#map.get(key);
    this.#map.delete(key); // move to the end: now the most recently used
    this.#map.set(key, value);
    return value;
  }

  set(key, value) {
    this.#map.delete(key);
    this.#map.set(key, value);
    if (this.#map.size > this.#max) this.#map.delete(this.#map.keys().next().value); // drop the oldest
  }

  keys() {
    return [...this.#map.keys()];
  }
}
const lru = new LRUCache(2);
lru.set('a', 1);
lru.set('b', 2);
lru.get('a'); // 'a' is now newer than 'b'
lru.set('c', 3); // over the limit: 'b' is the oldest, so it goes
console.log('5.  ', lru.keys(), '| b is gone:', lru.get('b'));

// 6. WeakRef: a reference that does NOT stop garbage collection.
//    Use it for caches that may lose their entries when memory is needed.
const cache = new Map();
let builds = 0;
function getReport(id) {
  const hit = cache.get(id)?.deref();
  if (hit) return hit;
  builds += 1;
  const report = { id, rows: new Array(1000).fill(id) };
  cache.set(id, new WeakRef(report));
  return report;
}

getReport(1);
getReport(1);
console.log('6a. builds before gc:', builds);

if (typeof global.gc !== 'function') {
  console.log('6b. run with: node --expose-gc <this file> to see the cache entry disappear');
} else {
  // A WeakRef target stays alive until the current turn of the event loop ends,
  // so wait one timer turn, force a collection, then ask again.
  setTimeout(() => {
    global.gc();
    setTimeout(() => {
      getReport(1);
      console.log('6b. builds after gc :', builds);
    }, 10);
  }, 10);
}
