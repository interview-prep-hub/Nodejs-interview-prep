// Rate limiting algorithms: token bucket, leaky bucket, fixed window, sliding window log, sliding window counter
// Run: node lessons/25-architecture-and-patterns/examples/11-rate-limiting.js
const { FakeClock } = require('./_fake-clock');

// Every limiter has one method: allow() -> true (let the request through) or false (reject it, HTTP 429).

// ---------- Token bucket: a bucket of tokens refills at a steady rate; each request takes one token.
// Allows a burst up to "capacity", then the long-run rate is "refillPerSec".
class TokenBucket {
  constructor({ clock, capacity, refillPerSec }) {
    Object.assign(this, { clock, capacity, refillPerSec });
    this.tokens = capacity;
    this.last = clock.now();
  }
  #refill() {
    const now = this.clock.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec);
    this.last = now; // lazy refill: no timer needed, we just do the maths when someone asks
  }
  allow() {
    this.#refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
  retryAfterSeconds() {
    this.#refill();
    return Math.max(0, Math.ceil((1 - this.tokens) / this.refillPerSec));
  }
}

// ---------- Leaky bucket (as a meter): each request adds water, water leaks out at a steady rate,
// the request is rejected if the bucket would overflow. (As a QUEUE it also smooths the output to a constant rate.)
class LeakyBucket {
  constructor({ clock, capacity, leakPerSec }) {
    Object.assign(this, { clock, capacity, leakPerSec });
    this.level = 0;
    this.last = clock.now();
  }
  allow() {
    const now = this.clock.now();
    this.level = Math.max(0, this.level - ((now - this.last) / 1000) * this.leakPerSec);
    this.last = now;
    if (this.level + 1 > this.capacity) return false;
    this.level += 1;
    return true;
  }
}

// ---------- Fixed window: one counter per clock window (0-999 ms, 1000-1999 ms, ...). Cheap, but see the boundary problem.
class FixedWindow {
  constructor({ clock, limit, windowMs }) {
    Object.assign(this, { clock, limit, windowMs });
    this.window = -1;
    this.count = 0;
  }
  allow() {
    const window = Math.floor(this.clock.now() / this.windowMs);
    if (window !== this.window) Object.assign(this, { window, count: 0 });
    if (this.count >= this.limit) return false;
    this.count++;
    return true;
  }
}

// ---------- Sliding window log: remember the time of every accepted request. Exact, but memory grows with the limit.
class SlidingLog {
  constructor({ clock, limit, windowMs }) {
    Object.assign(this, { clock, limit, windowMs });
    this.times = [];
  }
  allow() {
    const now = this.clock.now();
    while (this.times.length && this.times[0] <= now - this.windowMs) this.times.shift(); // forget old ones
    if (this.times.length >= this.limit) return false;
    this.times.push(now);
    return true;
  }
}

// ---------- Sliding window counter: keep two counters (previous window, current window) and weight the previous one.
// An estimate, but only two numbers per key.
class SlidingCounter {
  constructor({ clock, limit, windowMs }) {
    Object.assign(this, { clock, limit, windowMs });
    this.window = -1;
    this.prev = 0;
    this.curr = 0;
  }
  allow() {
    const now = this.clock.now();
    const window = Math.floor(now / this.windowMs);
    if (window !== this.window) {
      this.prev = window === this.window + 1 ? this.curr : 0;
      this.curr = 0;
      this.window = window;
    }
    const overlap = 1 - (now % this.windowMs) / this.windowMs; // how much of the previous window is still inside our sliding window
    const estimate = this.prev * overlap + this.curr;
    if (estimate + 1 > this.limit) return false;
    this.curr++;
    return true;
  }
}

function boundaryBurst() {
  console.log('--- 1. The same traffic through every algorithm: limit 5 per second');
  console.log('       traffic: 5 requests at t=900 ms, then 5 more at t=1100 ms   (A = allowed, D = denied)');
  const build = {
    'fixed window': (clock) => new FixedWindow({ clock, limit: 5, windowMs: 1000 }),
    'sliding log': (clock) => new SlidingLog({ clock, limit: 5, windowMs: 1000 }),
    'sliding counter': (clock) => new SlidingCounter({ clock, limit: 5, windowMs: 1000 }),
    'token bucket': (clock) => new TokenBucket({ clock, capacity: 5, refillPerSec: 5 }),
    'leaky bucket': (clock) => new LeakyBucket({ clock, capacity: 5, leakPerSec: 5 }),
  };
  for (const [name, make] of Object.entries(build)) {
    const clock = new FakeClock(0);
    const limiter = make(clock);
    clock.tick(900);
    const first = Array.from({ length: 5 }, () => (limiter.allow() ? 'A' : 'D')).join('');
    clock.tick(200);
    const second = Array.from({ length: 5 }, () => (limiter.allow() ? 'A' : 'D')).join('');
    const total = (first + second).replaceAll('D', '').length;
    console.log(`  ${name.padEnd(16)} t=900: ${first}   t=1100: ${second}   allowed in 200 ms: ${total}`);
  }
}

function tokenBucketTimeline() {
  console.log('\n--- 2. Token bucket timeline (capacity 3, refill 2 tokens per second)');
  const clock = new FakeClock(0);
  const bucket = new TokenBucket({ clock, capacity: 3, refillPerSec: 2 });
  const requests = [0, 0, 0, 0, 250, 500, 600, 1000, 1000, 3000];
  let last = 0;
  for (const t of requests) {
    clock.tick(t - last);
    last = t;
    const ok = bucket.allow();
    const note = ok ? '' : `  -> 429, Retry-After: ${bucket.retryAfterSeconds()}`;
    console.log(`  t=${String(t).padStart(4)} ms  ${ok ? 'allowed' : 'DENIED '}  tokens left: ${bucket.tokens.toFixed(2)}${note}`);
  }
}

function perKey() {
  console.log('\n--- 3. One limiter per key (for example per user or per IP)');
  const clock = new FakeClock(0);
  const buckets = new Map();
  const allow = (key) => {
    if (!buckets.has(key)) buckets.set(key, new TokenBucket({ clock, capacity: 2, refillPerSec: 1 }));
    return buckets.get(key).allow();
  };
  const results = ['1.1.1.1', '1.1.1.1', '1.1.1.1', '2.2.2.2'].map((ip) => `${ip}: ${allow(ip) ? 'allowed' : 'DENIED'}`);
  console.log('  ' + results.join(' | '));
  console.log('  keys being tracked:', buckets.size, '(this Map grows with every new key: real code must evict idle keys)');
}

boundaryBurst();
tokenBucketTimeline();
perKey();
