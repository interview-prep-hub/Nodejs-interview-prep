'use strict';
// Idea: loop attempts 1..retries+1. On failure, decide (shouldRetry, attempts left, abort signal),
// compute the delay, wait, and try again. Delay for retry n is min(maxDelay, baseDelay * factor^(n-1)),
// multiplied by random() when jitter is on ("full jitter", which spreads clients out).
// `sleep` and `random` are injected so tests can run without real waiting.
// Complexity: O(retries).

const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function retry(
  fn,
  {
    retries = 3,
    baseDelay = 100,
    factor = 2,
    maxDelay = 5000,
    jitter = false,
    shouldRetry = () => true,
    sleep = realSleep,
    random = Math.random,
    signal,
  } = {},
) {
  let attempt = 0;
  for (;;) {
    attempt++;
    if (signal && signal.aborted) throw signal.reason;
    try {
      return await fn(attempt);
    } catch (error) {
      const retriesUsed = attempt - 1;
      if (retriesUsed >= retries || !shouldRetry(error, attempt)) throw error;
      let delay = Math.min(maxDelay, baseDelay * factor ** (attempt - 1));
      if (jitter) delay *= random();
      await sleep(delay);
    }
  }
}

module.exports = { retry };
