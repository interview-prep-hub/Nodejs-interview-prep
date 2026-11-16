// Fixture for the coverage demo in 03-run-flags.js. It tests only some of grade.js. (A helper, not run by itself.)
// Run: node --experimental-test-coverage lessons/16-testing/examples/_fixtures/grade-suite.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { grade } = require('./grade.js');

test('90 and above is an A', () => {
  assert.equal(grade(95), 'A');
});

test('80 to 89 is a B', () => {
  assert.equal(grade(85), 'B');
});

test('below 70 is an F', () => {
  assert.equal(grade(10), 'F');
});
