// Fixture for 03-run-flags.js: a suite that fails on purpose, to show failure output and the exit code.
// (A helper, not run by itself.)
// Run: node --test lessons/16-testing/examples/_fixtures/failing-suite.js

const { test } = require('node:test');
const assert = require('node:assert/strict');

test('this one passes', () => {
  assert.equal(1 + 1, 2);
});

test('this one fails on a number', () => {
  assert.equal(2 + 2, 5, 'two plus two should be four');
});

test('this one fails on an object', () => {
  assert.deepEqual({ name: 'pen', tags: ['a', 'b'] }, { name: 'pen', tags: ['a', 'c'] });
});
