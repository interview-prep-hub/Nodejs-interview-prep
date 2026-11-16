# Challenge: LRU cache

Difficulty: Medium | Time box: 30 minutes | Skills: data structures, `Map` ordering, O(1) operations

## Problem

A cache that holds at most `capacity` entries. When it is full and you add a new key, it throws away the Least Recently Used entry.

## API

```js
const c = new LRUCache(2, { onEvict: (key, value) => {} });
c.put('a', 1);
c.put('b', 2);
c.get('a');        // 1, and 'a' is now the most recently used
c.put('c', 3);     // evicts 'b'
c.keys();          // ['a', 'c']  (least to most recently used)
```

- `get(key)`: returns the value or `undefined`. A hit marks the key as most recently used.
- `put(key, value)`: inserts or updates, marks as most recently used, evicts the oldest when over capacity (and calls `onEvict(key, value)` if given).
- `has(key)`: does NOT change recency. `delete(key)` returns a boolean. `clear()`. `size` is a getter.
- `keys()` returns an array from least to most recently used.
- The constructor throws `RangeError` when `capacity` is not an integer >= 1.
- All of `get`, `put`, `has`, `delete` must be O(1) on average.

## Run

```bash
npm run challenge -- lru-cache
npm run challenge -- lru-cache --solution
```

## Hints

<details>
<summary>Hint 1</summary>

A `Map` keeps keys in insertion order. The first key is the oldest.
</details>

<details>
<summary>Hint 2</summary>

To refresh a key, delete it and set it again. That moves it to the end.
</details>

<details>
<summary>Hint 3</summary>

The oldest key is `map.keys().next().value`.
</details>

## Interviewer follow-ups

- How would you build it without relying on `Map` order? (A hash map plus a doubly linked list: the map gives O(1) lookup, the list gives O(1) move-to-front and remove-from-tail.)
- How would you add a TTL? (Store an expiry time with each value and check it on `get`.)
- How does this differ from LFU? (LFU evicts the least frequently used entry, which resists one-off scans but needs more bookkeeping.)
