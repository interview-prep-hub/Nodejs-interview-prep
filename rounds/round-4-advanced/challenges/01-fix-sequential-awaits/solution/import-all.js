'use strict';
// The bug: `await` inside a for loop runs one item at a time.
// The fix: `concurrency` workers pull items from a shared index until none are left.
// Results are written by index, so the order stays the same as the input.

async function importAll(items, importOne, { concurrency = 5 } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency must be a positive integer');
  }
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await importOne(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

module.exports = { importAll };
