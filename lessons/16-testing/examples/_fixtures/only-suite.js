// Fixture for 03-run-flags.js: shows the "only" option. (A helper, not run by itself.)
// Run: node --test --test-only lessons/16-testing/examples/_fixtures/only-suite.js

const { test } = require('node:test');

test('one', () => {});

test('two (focused)', { only: true }, () => {});

test('three', () => {});
