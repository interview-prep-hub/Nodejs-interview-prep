// Retry or fail? Fail-fast config checks, a retry helper with backoff, timeouts, a tiny circuit breaker, error budgets
// Shows: how to decide per error, and how to avoid wasting time on errors that retrying cannot fix.
// Run: node lessons/14-error-handling-and-debugging/examples/09-retry-and-fail-fast.js

const { setTimeout: sleep } = require('node:timers/promises');

// ---------------------------------------------------------------------------
console.log('1. Fail fast at startup: check ALL the configuration before doing any work');
function loadConfig(env) {
  const problems = [];
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) problems.push(`PORT must be 0-65535, got "${env.PORT}"`);
  if (!env.DATABASE_URL) problems.push('DATABASE_URL is required');
  if (problems.length > 0) {
    const err = new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    err.code = 'E_CONFIG';
    throw err;
  }
  return { port, databaseUrl: env.DATABASE_URL };
}
try {
  loadConfig({ PORT: 'abc' });
} catch (e) {
  console.log(' ', e.message.replaceAll('\n', '\n '));
  console.log('  (a real app would print this and call process.exit(1) right away)');
}
console.log('  good config:', loadConfig({ PORT: '8080', DATABASE_URL: 'postgres://localhost/app' }));

// ---------------------------------------------------------------------------
console.log('2. Decide per error: retry or fail?');
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE']);
const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504]);

function isRetryable(err) {
  if (err.name === 'TimeoutError') return true;
  if (RETRYABLE_CODES.has(err.code)) return true;
  if (RETRYABLE_STATUS.has(err.status)) return true;
  return false; // validation errors, 401/403/404, ENOENT, and every programmer error: retrying cannot help
}
const cases = [
  Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
  Object.assign(new Error('Service Unavailable'), { status: 503 }),
  Object.assign(new Error('Too Many Requests'), { status: 429 }),
  Object.assign(new Error('Not Found'), { status: 404 }),
  Object.assign(new Error('Bad Request'), { status: 400 }),
  Object.assign(new Error('no such file'), { code: 'ENOENT' }),
  new TypeError('x is not a function'),
];
for (const err of cases) {
  const label = err.code ?? err.status ?? err.name;
  console.log(`  ${String(label).padEnd(12)} ${err.message.padEnd(22)} -> ${isRetryable(err) ? 'retry' : 'fail now'}`);
}

// ---------------------------------------------------------------------------
// retry(): exponential backoff with "full jitter" (a random wait from 0 up to the cap).
// Jitter stops a thousand clients from retrying at the very same moment.
async function retry(fn, { retries = 3, baseMs = 10, maxMs = 100, random = Math.random, onRetry } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      const cap = Math.min(maxMs, baseMs * 2 ** attempt); // 10, 20, 40, 80, 100, 100 ...
      const wait = Math.floor(random() * cap);
      onRetry?.({ attempt: attempt + 1, error: err, cap, wait });
      await sleep(wait);
    }
  }
}

console.log('3. A flaky call that works on the third try');
async function main() {
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls < 3) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    return 'data';
  };
  const result = await retry(flaky, {
    random: () => 0.5, // fixed, so this demo prints the same numbers every time
    onRetry: ({ attempt, error, cap, wait }) => console.log(`  attempt ${attempt} failed (${error.code}), cap ${cap} ms, waiting ${wait} ms`),
  });
  console.log(`  result "${result}" after ${calls} calls`);

  console.log('4. A non-retryable error fails on the first call');
  let calls2 = 0;
  await retry(async () => {
    calls2++;
    throw Object.assign(new Error('Bad Request'), { status: 400 });
  }).catch((e) => console.log(`  gave up at once: "${e.message}" after ${calls2} call`));

  console.log('5. Give up after the retry limit (and keep the last error)');
  let calls3 = 0;
  await retry(
    async () => {
      calls3++;
      throw Object.assign(new Error('still down'), { code: 'ECONNREFUSED' });
    },
    { retries: 2, baseMs: 1, maxMs: 2 },
  ).catch((e) => console.log(`  gave up: "${e.message}" after ${calls3} calls (1 first try + 2 retries)`));

  console.log('6. A timeout per attempt, so a hung call cannot hang you');
  // Run fn with a signal that fires after ms. If it was the timeout that stopped fn, throw the TimeoutError.
  async function withTimeout(ms, fn) {
    const signal = AbortSignal.timeout(ms);
    try {
      return await fn(signal);
    } catch (err) {
      if (signal.aborted) throw signal.reason; // name "TimeoutError", which isRetryable() accepts
      throw err;
    }
  }
  const slowCall = (signal) => sleep(200, 'late data', { signal }); // rejects early when the signal fires
  const result6 = await retry(
    (attempt) => withTimeout(20, (signal) => (attempt === 0 ? slowCall(signal) : 'fast data on retry')),
    {
      baseMs: 1,
      maxMs: 2,
      onRetry: ({ attempt, error }) => console.log(`  attempt ${attempt} failed: ${error.name}`),
    },
  );
  console.log('  result:', result6);
  // Without withTimeout the raw error from timers/promises is an AbortError with the TimeoutError inside as cause.
  await sleep(200, null, { signal: AbortSignal.timeout(20) }).catch((e) => console.log(`  raw error: ${e.name}, cause: ${e.cause?.name}`));

  // -------------------------------------------------------------------------
  console.log('7. Circuit breaker: after repeated failures, fail FAST instead of waiting on a dead service');
  class CircuitBreaker {
    constructor({ threshold = 3, coolDownMs = 100 } = {}) {
      this.threshold = threshold;
      this.coolDownMs = coolDownMs;
      this.failures = 0;
      this.openedAt = 0;
    }
    async call(fn) {
      const open = this.failures >= this.threshold;
      if (open && Date.now() - this.openedAt < this.coolDownMs) {
        throw Object.assign(new Error('circuit open, not calling the service'), { code: 'E_CIRCUIT_OPEN' });
      }
      try {
        const value = await fn(); // after the cool-down one trial call is allowed ("half open")
        this.failures = 0;
        return value;
      } catch (err) {
        this.failures++;
        if (this.failures >= this.threshold) this.openedAt = Date.now();
        throw err;
      }
    }
  }
  const breaker = new CircuitBreaker({ threshold: 3, coolDownMs: 100 });
  let realCalls = 0;
  const deadService = async () => {
    realCalls++;
    throw new Error('service is down');
  };
  for (let i = 1; i <= 6; i++) {
    await breaker.call(deadService).catch((e) => console.log(`  call ${i}: ${e.message}`));
  }
  console.log(`  the service was really called ${realCalls} times, not 6`);
  await sleep(150); // cool-down over: one trial call is let through
  await breaker.call(async () => 'service is back').then((v) => console.log('  after cool-down:', v));

  // -------------------------------------------------------------------------
  console.log('8. Error budget: how many failures can we afford?');
  const slo = 0.999; // promise: 99.9% of requests succeed
  const requestsPerMonth = 1_000_000;
  const allowedFailures = Math.round(requestsPerMonth * (1 - slo));
  const failedSoFar = 640;
  console.log(`  SLO ${(slo * 100).toFixed(1)}% of ${requestsPerMonth} requests -> ${allowedFailures} failures allowed per month`);
  console.log(`  failed so far: ${failedSoFar}, budget left: ${allowedFailures - failedSoFar} (${(((allowedFailures - failedSoFar) / allowedFailures) * 100).toFixed(0)}%)`);
  console.log('  budget left -> ship features; budget gone -> freeze releases and fix reliability');
}

main();
