// Fixture for the concurrency note in README section 7: three tests that each sleep 100 ms,
// first one after another (the default), then inside a group that has { concurrency: true }.
// (A helper, not run by itself.)
// Run: node --test lessons/16-testing/examples/_fixtures/concurrency-suite.js

const { describe, it } = require('node:test');

const sleep100 = () => new Promise((resolve) => setTimeout(resolve, 100));

describe('sequential (default)', () => {
  it('first', sleep100);
  it('second', sleep100);
  it('third', sleep100);
});

describe('concurrent', { concurrency: true }, () => {
  it('first', sleep100);
  it('second', sleep100);
  it('third', sleep100);
});
