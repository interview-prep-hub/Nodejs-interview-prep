// Test-driven development: the tests that drove parseDuration(), in the order they were written
// Run: node --test lessons/16-testing/examples/10-tdd-duration.test.js
//
// The README shows the full red-green-refactor walk-through. This file is where the tests ended up.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseDuration } = require('./_lib/duration.js');

describe('parseDuration()', () => {
  // Cycle 1: the first test. It was red (the function returned undefined), then green.
  it('parses seconds', () => {
    assert.equal(parseDuration('5s'), 5000);
  });

  // Cycle 2: a second test forced the code to stop returning a hard-coded 5000.
  it('parses minutes', () => {
    assert.equal(parseDuration('2m'), 120_000);
  });

  // Cycle 3: several parts in one string, written as a table of cases.
  const combined = [
    ['1h30m', 5_400_000],
    ['1m30s', 90_000],
    ['1d1h1m1s1ms', 90_061_001],
  ];
  for (const [text, expected] of combined) {
    it(`parses several parts: ${text}`, () => {
      assert.equal(parseDuration(text), expected);
    });
  }

  // Cycle 4: the other units, and the edge case zero.
  it('parses milliseconds, hours and days', () => {
    assert.equal(parseDuration('250ms'), 250);
    assert.equal(parseDuration('3h'), 10_800_000);
    assert.equal(parseDuration('1d'), 86_400_000);
  });

  it('parses zero', () => {
    assert.equal(parseDuration('0s'), 0);
  });

  // Cycle 5: error paths. Bad text is a RangeError, a wrong type is a TypeError.
  const invalid = ['', 'soon', '5', '1h30', 'h', '-5s', '1.5h', ' 5s', '5S'];
  for (const text of invalid) {
    it(`rejects ${JSON.stringify(text)}`, () => {
      assert.throws(() => parseDuration(text), { name: 'RangeError', message: `invalid duration: "${text}"` });
    });
  }

  it('rejects a value that is not a string', () => {
    assert.throws(() => parseDuration(42), TypeError);
    assert.throws(() => parseDuration(undefined), TypeError);
  });

  // Refactor step: the code was reorganised (a unit table and two regular expressions).
  // None of these tests changed, and that is how you know the refactor kept the behaviour.
});
