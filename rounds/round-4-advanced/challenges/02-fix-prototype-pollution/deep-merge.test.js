'use strict';
const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../../../_shared/load');
const { deepMerge } = load(__dirname, 'deep-merge.js');

// Clean up in case a buggy implementation polluted the shared prototype, so one failure
// does not break every other test.
afterEach(() => {
  delete Object.prototype.polluted;
  delete Object.prototype.isAdmin;
});

test('merges nested objects and keeps keys from both sides', () => {
  const out = deepMerge({ a: 1, nested: { x: 1, y: 2 } }, { b: 2, nested: { y: 20, z: 30 } });
  assert.deepEqual(out, { a: 1, b: 2, nested: { x: 1, y: 20, z: 30 } });
});

test('arrays are replaced, not merged', () => {
  assert.deepEqual(deepMerge({ list: [1, 2, 3] }, { list: [9] }), { list: [9] });
});

test('returns the target object', () => {
  const target = {};
  assert.equal(deepMerge(target, { a: 1 }), target);
});

test('a JSON payload with "__proto__" does not pollute Object.prototype', () => {
  const payload = JSON.parse('{"__proto__": {"polluted": true}}');
  deepMerge({}, payload);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('a nested "__proto__" payload does not pollute either', () => {
  const payload = JSON.parse('{"user": {"__proto__": {"isAdmin": true}}}');
  deepMerge({}, payload);
  assert.equal({}.isAdmin, undefined);
});

test('"constructor.prototype" payloads do not pollute', () => {
  const payload = JSON.parse('{"constructor": {"prototype": {"polluted": true}}}');
  deepMerge({}, payload);
  assert.equal({}.polluted, undefined);
  assert.equal(Object.prototype.polluted, undefined);
});

test('values reachable only through the prototype chain are not copied from the source', () => {
  const source = Object.create({ inherited: 'nope' });
  source.own = 'yes';
  const out = deepMerge({}, source);
  assert.deepEqual(out, { own: 'yes' });
  assert.equal(Object.hasOwn(out, 'inherited'), false);
});

test('normal keys still merge after a blocked key was skipped', () => {
  const payload = JSON.parse('{"__proto__": {"polluted": true}, "safe": {"ok": 1}}');
  const out = deepMerge({}, payload);
  assert.deepEqual(out.safe, { ok: 1 });
});
