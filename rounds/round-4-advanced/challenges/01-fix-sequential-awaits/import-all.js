'use strict';
// BUGGY on purpose. Fix it. See README.md.
// 20 items of 20 ms each take about 400 ms, and the `concurrency` option is ignored.

async function importAll(items, importOne, { concurrency = 5 } = {}) {
  const results = [];
  for (const item of items) {
    results.push(await importOne(item));
  }
  return results;
}

module.exports = { importAll };
