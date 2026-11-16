// First tests: test(), describe()/it(), node:assert/strict, Arrange-Act-Assert, subtests, async
// Run: node --test lessons/16-testing/examples/01-first-tests.test.js

const { test, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { cartTotal, applyDiscount, formatMoney } = require('./_lib/cart.js');

// Part 1: the smallest test, written as Arrange, Act, Assert.
test('cartTotal adds up every line', () => {
  // Arrange: build the input
  const items = [
    { name: 'pen', priceCents: 150, qty: 2 },
    { name: 'book', priceCents: 1200, qty: 1 },
  ];

  // Act: call the code under test
  const total = cartTotal(items);

  // Assert: check the result
  assert.equal(total, 1500);
});

// Part 2: describe() groups related tests, it() is an alias of test().
describe('applyDiscount', () => {
  it('takes a percentage off', () => {
    assert.equal(applyDiscount(10000, 10), 9000);
  });

  it('rounds to a whole cent', () => {
    // 999 * 85 / 100 = 849.15, so the result is 849
    assert.equal(applyDiscount(999, 15), 849);
  });

  it('rejects a percent outside 0 to 100', () => {
    assert.throws(() => applyDiscount(1000, 150), RangeError);
    assert.throws(() => applyDiscount(1000, -1), {
      name: 'RangeError',
      message: /from 0 to 100/,
    });
  });
});

// Part 3: a tour of the assertions you will use every day.
describe('assertion tour', () => {
  it('equal is strict: no type conversion', () => {
    assert.equal(1, 1);
    assert.notEqual(1, '1'); // with the old loose assert, 1 == '1' would pass
  });

  it('deepEqual compares content, not identity', () => {
    assert.deepEqual({ a: 1, list: [1, 2] }, { a: 1, list: [1, 2] });
    assert.notDeepEqual([1, 2], [2, 1]); // order matters for arrays
  });

  it('ok, match and a custom message', () => {
    assert.ok(formatMoney(5).startsWith('$'), 'money should start with a dollar sign');
    assert.match(formatMoney(1999), /^\$\d+\.\d{2}$/);
  });

  it('floats are not exact, so use cents or a tolerance', () => {
    assert.notEqual(0.1 + 0.2, 0.3);
    assert.ok(Math.abs(0.1 + 0.2 - 0.3) < 1e-9);
  });
});

// Part 4: subtests with t.test(). One parent test, one subtest per table row.
test('formatMoney', async (t) => {
  const table = [
    [0, '$0.00'],
    [5, '$0.05'],
    [1999, '$19.99'],
  ];
  for (const [cents, expected] of table) {
    await t.test(`${cents} cents is ${expected}`, () => {
      assert.equal(formatMoney(cents), expected);
    });
  }
});

// Part 5: async tests. Return a promise (or use an async function) and the runner waits for it.
async function loadPrice(sku) {
  const prices = { pen: 150, book: 1200 };
  await new Promise((resolve) => setImmediate(resolve)); // pretend this is a database call
  if (!(sku in prices)) throw new Error(`unknown sku: ${sku}`);
  return prices[sku];
}

describe('loadPrice (async)', () => {
  it('resolves with the price', async () => {
    assert.equal(await loadPrice('pen'), 150);
  });

  it('rejects for an unknown sku', async () => {
    // Always await assert.rejects, or the test can pass before the check runs.
    await assert.rejects(loadPrice('car'), { message: 'unknown sku: car' });
  });
});
