'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../../../_shared/load');
const { LRUCache } = load(__dirname, 'lru-cache.js');

test('stores and returns values; missing keys give undefined', () => {
  const c = new LRUCache(2);
  c.put('a', 1);
  assert.equal(c.get('a'), 1);
  assert.equal(c.get('nope'), undefined);
  assert.equal(c.size, 1);
});

test('evicts the least recently used entry when over capacity', () => {
  const c = new LRUCache(2);
  c.put('a', 1);
  c.put('b', 2);
  c.put('c', 3);
  assert.equal(c.has('a'), false);
  assert.deepEqual(c.keys(), ['b', 'c']);
  assert.equal(c.size, 2);
});

test('get marks a key as recently used', () => {
  const c = new LRUCache(2);
  c.put('a', 1);
  c.put('b', 2);
  c.get('a');
  c.put('c', 3);
  assert.equal(c.has('b'), false);
  assert.deepEqual(c.keys(), ['a', 'c']);
});

test('put on an existing key updates the value and the recency', () => {
  const c = new LRUCache(2);
  c.put('a', 1);
  c.put('b', 2);
  c.put('a', 10);
  c.put('c', 3);
  assert.equal(c.get('a'), 10);
  assert.equal(c.has('b'), false);
});

test('has does not change recency', () => {
  const c = new LRUCache(2);
  c.put('a', 1);
  c.put('b', 2);
  c.has('a');
  c.put('c', 3);
  assert.equal(c.has('a'), false);
});

test('delete and clear', () => {
  const c = new LRUCache(3);
  c.put('a', 1);
  c.put('b', 2);
  assert.equal(c.delete('a'), true);
  assert.equal(c.delete('a'), false);
  assert.equal(c.size, 1);
  c.clear();
  assert.equal(c.size, 0);
  assert.deepEqual(c.keys(), []);
});

test('keys() lists least to most recently used', () => {
  const c = new LRUCache(3);
  c.put('a', 1);
  c.put('b', 2);
  c.put('c', 3);
  c.get('a');
  assert.deepEqual(c.keys(), ['b', 'c', 'a']);
});

test('onEvict receives the evicted key and value', () => {
  const evicted = [];
  const c = new LRUCache(1, { onEvict: (k, v) => evicted.push([k, v]) });
  c.put('a', 1);
  c.put('b', 2);
  assert.deepEqual(evicted, [['a', 1]]);
});

test('a falsy stored value is still a hit', () => {
  const c = new LRUCache(2);
  c.put('zero', 0);
  c.put('empty', '');
  assert.equal(c.get('zero'), 0);
  assert.equal(c.get('empty'), '');
  assert.equal(c.has('zero'), true);
});

test('invalid capacity throws RangeError', () => {
  assert.throws(() => new LRUCache(0), RangeError);
  assert.throws(() => new LRUCache(-1), RangeError);
  assert.throws(() => new LRUCache(1.5), RangeError);
  assert.throws(() => new LRUCache('3'), RangeError);
});

test('stays correct over many operations', () => {
  const c = new LRUCache(100);
  for (let i = 0; i < 10000; i++) c.put(i, i);
  assert.equal(c.size, 100);
  assert.equal(c.get(9999), 9999);
  assert.equal(c.has(0), false);
});
