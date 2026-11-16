// Fixture for 03-run-flags.js: a small suite used to show the runner flags. (A helper, not run by itself.)
// Run: node --test lessons/16-testing/examples/_fixtures/sample-suite.js

const { test, describe, it } = require('node:test');
const assert = require('node:assert/strict');

test('adds numbers', () => {
  assert.equal(1 + 2, 3);
});

test('adds negative numbers', () => {
  assert.equal(-1 + -2, -3);
});

describe('strings', () => {
  it('uppercases', () => {
    assert.equal('abc'.toUpperCase(), 'ABC');
  });

  it('trims', () => {
    assert.equal('  x '.trim(), 'x');
  });
});

test('slow test', async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
});

test('skipped test', { skip: 'not ready' }, () => {});

test('todo test', { todo: 'fix later' }, () => {});
