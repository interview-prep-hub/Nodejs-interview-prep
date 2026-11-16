// Resilience patterns, hand-written: timeout, retry with backoff and jitter, circuit breaker, bulkhead, and how they stack
// Run: node lessons/25-architecture-and-patterns/examples/10-resilience.js
const { FakeClock } = require('./_fake-clock');

class TimeoutError extends Error {}
class CircuitOpenError extends Error {}
class BulkheadFullError extends Error {}

const pad = (n) => String(n).padStart(4);

// ======================================================================
// 1. TIMEOUT: stop waiting after ms, and tell the operation to stop too (AbortSignal).
// ======================================================================
async function withTimeout(clock, ms, operation) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = clock.setTimeout(() => {
      const error = new TimeoutError(`timed out after ${ms} ms`);
      controller.abort(error);
      reject(error);
    }, ms);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    clock.clearTimeout(timer);
  }
}

async function timeoutDemo() {
  console.log('--- 1. Timeout');
  const clock = new FakeClock();
  const slowCall = (ms) => (signal) => clock.sleep(ms).then(() => `answered after ${ms} ms (aborted=${signal.aborted})`);

  const fast = withTimeout(clock, 100, slowCall(50));
  await clock.tickAsync(200);
  console.log('  fast call :', await fast);

  const slow = withTimeout(clock, 100, slowCall(300)).catch((e) => `${e.constructor.name}: ${e.message}`);
  await clock.tickAsync(400);
  console.log('  slow call :', await slow);
}

// ======================================================================
// 2. RETRY with exponential backoff and "full jitter": wait a random time between 0 and the growing ceiling.
// ======================================================================
async function retry(fn, { clock, retries = 4, baseMs = 100, maxMs = 2000, random = Math.random, shouldRetry = () => true, log = () => {} }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err;
      const ceiling = Math.min(maxMs, baseMs * 2 ** attempt); // 100, 200, 400, 800, ... capped at maxMs
      const delay = Math.round(random() * ceiling); //          jitter: spread the clients out
      log(`attempt ${attempt + 1} failed (${err.message}); ceiling ${ceiling} ms, waiting ${delay} ms`);
      await clock.sleep(delay);
    }
  }
}

async function retryDemo() {
  console.log('\n--- 2. Retry with backoff and jitter');
  const clock = new FakeClock();
  const randoms = [0.5, 0.9, 0.2]; // a fixed "random" sequence so the output is repeatable
  const flaky = async (attempt) => {
    if (attempt < 3) throw new Error('503 service unavailable');
    return 'success on attempt ' + (attempt + 1);
  };
  const done = retry(flaky, { clock, random: () => randoms.shift(), log: (m) => console.log('  ' + m) }).then((result) => `${result} at t=${clock.now()} ms`);
  await clock.tickAsync(5000);
  console.log('  result:', await done);

  const noRetry = retry(async () => { const e = new Error('400 bad request'); e.status = 400; throw e; }, {
    clock,
    shouldRetry: (e) => !(e.status >= 400 && e.status < 500), // never retry client mistakes
  }).catch((e) => `gave up at once: ${e.message}`);
  console.log('  4xx error:', await noRetry);

  const ceilings = Array.from({ length: 7 }, (_, attempt) => Math.min(2000, 100 * 2 ** attempt));
  console.log('  ceiling per attempt (base 100, cap 2000):', ceilings.join(', '));
}

// ======================================================================
// 3. CIRCUIT BREAKER: closed (normal) -> open (fail fast) -> half-open (one trial) -> closed again.
// ======================================================================
class CircuitBreaker {
  #state = 'closed';
  #failures = 0;
  #openedAt = 0;
  #trial = false;
  constructor({ clock, failureThreshold = 3, resetMs = 1000, onChange = () => {} }) {
    Object.assign(this, { clock, failureThreshold, resetMs, onChange });
  }
  get state() {
    return this.#state;
  }
  #change(next) {
    this.onChange(this.#state, next);
    this.#state = next;
  }
  async exec(fn) {
    if (this.#state === 'open') {
      if (this.clock.now() - this.#openedAt < this.resetMs) throw new CircuitOpenError('circuit is open, failing fast');
      this.#change('half-open');
    }
    if (this.#state === 'half-open') {
      if (this.#trial) throw new CircuitOpenError('half-open, trial call already running');
      this.#trial = true; // only ONE call may test the water
    }
    try {
      const result = await fn();
      this.#failures = 0;
      if (this.#state === 'half-open') this.#change('closed');
      return result;
    } catch (err) {
      this.#failures++;
      if (this.#state === 'half-open' || this.#failures >= this.failureThreshold) {
        this.#openedAt = this.clock.now();
        this.#change('open');
      }
      throw err;
    } finally {
      this.#trial = false;
    }
  }
}

async function breakerDemo() {
  console.log('\n--- 3. Circuit breaker (a service that is down until t=3000)');
  const clock = new FakeClock();
  let reachedService = 0;
  const service = async () => {
    reachedService++;
    if (clock.now() < 3000) throw new Error('service down');
    return 'ok';
  };
  const changes = [];
  const breaker = new CircuitBreaker({
    clock,
    failureThreshold: 3,
    resetMs: 1000,
    onChange: (from, to) => changes.push(`${from} -> ${to}`),
  });
  const caller = (async () => {
    for (let i = 0; i < 9; i++) {
      const t = clock.now();
      const result = await breaker.exec(service).catch((e) => e.message);
      const note = changes.length ? `   [state: ${changes.join(', then ')}]` : '';
      changes.length = 0;
      console.log(`  t=${pad(t)} ${result}${note}`);
      await clock.sleep(500);
    }
  })();
  await clock.tickAsync(5000);
  await caller;
  console.log(`  9 calls were made, but only ${reachedService} reached the service`);
}

// ======================================================================
// 4. BULKHEAD: a concurrency limit with a small waiting room. Too many callers are rejected at once.
// ======================================================================
class Bulkhead {
  #running = 0;
  #waiting = [];
  constructor({ maxConcurrent, maxQueue }) {
    Object.assign(this, { maxConcurrent, maxQueue });
  }
  async exec(fn) {
    if (this.#running < this.maxConcurrent) {
      this.#running++;
    } else if (this.#waiting.length < this.maxQueue) {
      await new Promise((resolve) => this.#waiting.push(resolve)); // wait for a slot to be handed over
    } else {
      throw new BulkheadFullError('too many calls in progress');
    }
    try {
      return await fn();
    } finally {
      const next = this.#waiting.shift();
      if (next) next(); // pass our slot straight to the next waiter
      else this.#running--;
    }
  }
}

async function bulkheadDemo() {
  console.log('\n--- 4. Bulkhead (2 at a time, 2 may wait, 6 calls arrive together)');
  const clock = new FakeClock();
  const bulkhead = new Bulkhead({ maxConcurrent: 2, maxQueue: 2 });
  let running = 0;
  let maxSeen = 0;
  const calls = Array.from({ length: 6 }, (_, i) =>
    bulkhead
      .exec(async () => {
        const start = clock.now();
        maxSeen = Math.max(maxSeen, ++running);
        await clock.sleep(100);
        running--;
        return `ran from t=${start} to t=${clock.now()}`;
      })
      .catch((e) => `rejected: ${e.constructor.name}`),
  );
  await clock.tickAsync(500);
  (await Promise.all(calls)).forEach((r, i) => console.log(`  call ${i + 1}: ${r}`));
  console.log('  most calls running at once:', maxSeen);
}

// ======================================================================
// 5. Stacking them: retry( breaker( timeout( call ) ) ), with a fallback at the very end.
// ======================================================================
async function stackDemo() {
  console.log('\n--- 5. All together (service answers in 300 ms until t=1000, then in 20 ms)');
  const clock = new FakeClock();
  const service = () => clock.sleep(clock.now() < 1000 ? 300 : 20).then(() => 'fresh data');
  const stamp = (m) => console.log(`        t=${pad(clock.now())} ${m}`);
  const breaker = new CircuitBreaker({ clock, failureThreshold: 2, resetMs: 500, onChange: (a, b) => stamp(`breaker: ${a} -> ${b}`) });

  const getData = () =>
    retry(() => breaker.exec(() => withTimeout(clock, 100, service)), {
      clock,
      retries: 3,
      baseMs: 100,
      random: () => 1, // always the full ceiling, to keep the numbers easy to read
      shouldRetry: (e) => !(e instanceof CircuitOpenError), // an open circuit means: stop, use the fallback
      log: stamp,
    }).catch((e) => `FALLBACK (cached data) because: ${e.constructor.name}`);

  const first = getData();
  await clock.tickAsync(1000);
  console.log('  call at t=0   :', await first);
  const second = getData();
  await clock.tickAsync(300);
  console.log('  call at t=1000:', await second);
}

async function main() {
  await timeoutDemo();
  await retryDemo();
  await breakerDemo();
  await bulkheadDemo();
  await stackDemo();
}

main();
