// Fixture for 03-run-flags.js: the classic async mistake, a promise that nobody waits for.
// (A helper, not run by itself.)
// Run: node --test lessons/16-testing/examples/_fixtures/forgot-await-suite.js

const { test } = require('node:test');
const assert = require('node:assert/strict');

function failsLater() {
  return new Promise((resolve, reject) => setTimeout(() => reject(new Error('late failure')), 20));
}

test('forgot to await assert.rejects', () => {
  assert.rejects(failsLater(), /something else/); // no await, no return: the test ends right away
});

test('a later test keeps the process alive for a moment', async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
});
