'use strict';
// Idea: start `limit` workers. Each worker loops: take the next task index, run it, store the
// result at that index, repeat until no tasks are left. Shared state is just two variables
// (`next` and `failed`), and JavaScript is single threaded so `next++` is safe.
// Complexity: O(n) time overall, O(n) for the results array.

async function pool(tasks, limit, { stopOnError = true } = {}) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError('limit must be a positive integer');
  }
  const results = new Array(tasks.length);
  let next = 0;
  let failed = false;

  async function worker() {
    while (!failed && next < tasks.length) {
      const i = next++;
      try {
        const value = await tasks[i]();
        results[i] = stopOnError ? value : { status: 'fulfilled', value };
      } catch (reason) {
        if (stopOnError) {
          failed = true; // no worker starts a new task after this
          throw reason;
        }
        results[i] = { status: 'rejected', reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, worker);
  await Promise.all(workers);
  return results;
}

module.exports = { pool };
