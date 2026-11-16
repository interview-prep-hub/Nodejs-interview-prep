// Snapshot testing: t.assert.snapshot() compares a value with a saved copy in a .snapshot file
// Run: node --test lessons/16-testing/examples/11-snapshots.test.js
// Create or refresh the saved copy: node --test --test-update-snapshots lessons/16-testing/examples/11-snapshots.test.js
//
// The saved copy lives next to this file: 11-snapshots.test.js.snapshot  (commit it with your code)

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { renderReceipt, toApiShape } = require('./_lib/receipt.js');

const order = {
  id: 7,
  items: [
    { name: 'pen', priceCents: 150, qty: 2 },
    { name: 'book', priceCents: 1200, qty: 1 },
  ],
};

describe('snapshots', () => {
  it('receipt text (a raw string serializer keeps the .snapshot file readable)', (t) => {
    t.assert.snapshot(renderReceipt(order), { serializers: [(value) => value] });
  });

  it('API object (the default serializer writes JSON)', (t) => {
    t.assert.snapshot(toApiShape(order));
  });

  it('empty order', (t) => {
    t.assert.snapshot(toApiShape({ id: 8, items: [] }));
  });
});

describe('when NOT to use a snapshot', () => {
  it('a small, important value deserves a plain assertion that says what you mean', () => {
    assert.equal(toApiShape(order).totalCents, 1500);
  });
});
