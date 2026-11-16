// Code under test for lesson 16: functions that depend on time (timers and the clock).
// They use the global setTimeout and Date.now() so that node:test mock timers can control them.

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Call fn only after `ms` milliseconds without a new call.
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// Run task(attempt). If it throws, wait and try again. Waits double each time: 100, 200, 400 ...
async function retry(task, { retries = 3, delayMs = 100 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < retries) await sleep(delayMs * 2 ** attempt);
    }
  }
  throw lastError;
}

// Reject if the promise takes longer than `ms`.
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// A key/value cache whose entries expire after ttlMs. It reads the clock with Date.now().
function createTtlCache(ttlMs) {
  const entries = new Map();
  return {
    set(key, value) {
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    get(key) {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (Date.now() >= entry.expiresAt) {
        entries.delete(key);
        return undefined;
      }
      return entry.value;
    },
  };
}

module.exports = { sleep, debounce, retry, withTimeout, createTtlCache };
