'use strict';
// Idea: a JavaScript Map remembers insertion order. To mark a key as "recently used",
// delete it and set it again (it moves to the end). The first key in the Map is the least recently used.
// Complexity: get, put, has, delete are O(1) on average. keys() is O(n).

class LRUCache {
  constructor(capacity, { onEvict } = {}) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('capacity must be an integer >= 1');
    }
    this.capacity = capacity;
    this.onEvict = onEvict;
    this.map = new Map();
  }

  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  put(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const [oldKey, oldValue] = this.map.entries().next().value;
      this.map.delete(oldKey);
      if (this.onEvict) this.onEvict(oldKey, oldValue);
    }
  }

  has(key) {
    return this.map.has(key); // does not change recency
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }

  get size() {
    return this.map.size;
  }

  keys() {
    return [...this.map.keys()]; // least to most recently used
  }
}

module.exports = { LRUCache };
