// Fixture for 03-run-flags.js and 12-flaky-tests.test.js: tests that secretly depend on each other.
// Test B only passes because test A ran first. (A helper, not run by itself.)
// Run: node --test lessons/16-testing/examples/_fixtures/order-dependent-suite.js

const { test } = require('node:test');
const assert = require('node:assert/strict');

const cart = []; // shared state that lives as long as the file

test('A puts a pen in the cart', () => {
  cart.push('pen');
  assert.equal(cart.length, 1);
});

test('B expects the pen from A', () => {
  assert.equal(cart.length, 1);
});
