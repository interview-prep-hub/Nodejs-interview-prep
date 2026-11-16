// Scheduling: setInterval overlap and drift, how a cron matcher works, and a lock so only one instance runs a job
// Run: node lessons/25-architecture-and-patterns/examples/07-scheduling.js
const { FakeClock } = require('./_fake-clock');

// ----------------------------------------------------------------------
// Part 1: three ways to "run every 100 ms" when the job itself takes time
// ----------------------------------------------------------------------
async function intervalStyles() {
  console.log('--- Part 1: interval styles (fake clock, job takes 30 ms)');

  // A. setInterval style: start a run every 100 ms, no matter what. Slow runs OVERLAP.
  {
    const clock = new FakeClock();
    let running = 0;
    let maxRunning = 0;
    const slowJob = async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await clock.sleep(150); // slower than the interval
      running--;
    };
    const loop = () => {
      clock.setTimeout(loop, 100);
      slowJob();
    };
    clock.setTimeout(loop, 100);
    await clock.tickAsync(600);
    console.log('  A. setInterval style, job takes 150 ms: most runs at the same time =', maxRunning);
  }

  const job = (clock) => clock.sleep(30);

  // B. "wait after finishing": no overlap, but every run starts 30 ms later than the last (drift).
  {
    const clock = new FakeClock();
    const starts = [];
    (async () => {
      for (let i = 0; i < 5; i++) {
        starts.push(clock.now());
        await job(clock);
        await clock.sleep(100);
      }
    })();
    await clock.tickAsync(1000);
    console.log('  B. wait 100 ms after each run  starts at:', starts.join(', '));
  }

  // C. self-correcting: compute the next IDEAL start time and sleep only the difference.
  {
    const clock = new FakeClock();
    const starts = [];
    (async () => {
      const t0 = clock.now();
      for (let i = 0; i < 5; i++) {
        starts.push(clock.now());
        await job(clock);
        await clock.sleep(Math.max(0, t0 + (i + 1) * 100 - clock.now()));
      }
    })();
    await clock.tickAsync(1000);
    console.log('  C. self-correcting             starts at:', starts.join(', '));
  }
}

// ----------------------------------------------------------------------
// Part 2: what a cron library does. A 5-field expression is checked against the current minute.
// fields: minute hour day-of-month month day-of-week   (supports *, 5, 1-5, */15, 1,15)
// ----------------------------------------------------------------------
function fieldMatches(field, value, min, max) {
  return field.split(',').some((part) => {
    const [range, step] = part.split('/');
    let lo;
    let hi;
    if (range === '*') [lo, hi] = [min, max];
    else if (range.includes('-')) [lo, hi] = range.split('-').map(Number);
    else [lo, hi] = [Number(range), step ? max : Number(range)];
    return value >= lo && value <= hi && (value - lo) % (step ? Number(step) : 1) === 0;
  });
}

function cronMatches(expr, date) {
  const [minute, hour, dom, month, dow] = expr.trim().split(/\s+/);
  const domOk = fieldMatches(dom, date.getUTCDate(), 1, 31);
  const dowOk = fieldMatches(dow, date.getUTCDay(), 0, 6);
  // Classic cron rule: if BOTH day fields are restricted, a day matches when EITHER one matches.
  const dayOk = dom !== '*' && dow !== '*' ? domOk || dowOk : domOk && dowOk;
  return (
    fieldMatches(minute, date.getUTCMinutes(), 0, 59) &&
    fieldMatches(hour, date.getUTCHours(), 0, 23) &&
    fieldMatches(month, date.getUTCMonth() + 1, 1, 12) &&
    dayOk
  );
}

function cronDemo() {
  console.log('\n--- Part 2: a mini cron matcher (UTC), counting runs during Monday 2026-11-09');
  const expressions = [
    ['* * * * *', 'every minute'],
    ['*/15 * * * *', 'every 15 minutes'],
    ['0 9 * * 1-5', '09:00 on weekdays'],
    ['30 2 * * 0', '02:30 on Sundays'],
    ['0 0 13 * 1', '00:00 on the 13th OR on Mondays'],
  ];
  const clock = new FakeClock(Date.UTC(2026, 10, 9, 0, 0)); // Monday, midnight UTC
  const fires = new Map(expressions.map(([expr]) => [expr, []]));
  const checkEveryMinute = () => {
    clock.setTimeout(checkEveryMinute, 60_000); // a real scheduler wakes up once a minute
    const now = new Date(clock.now());
    for (const [expr] of expressions) if (cronMatches(expr, now)) fires.get(expr).push(now.toISOString().slice(11, 16));
  };
  checkEveryMinute();
  clock.tick(24 * 60 * 60 * 1000 - 1);
  for (const [expr, label] of expressions) {
    const times = fires.get(expr);
    const first = times.length ? `first ${times[0]}` : 'never';
    console.log(`  ${expr.padEnd(13)} ${label.padEnd(32)} ${String(times.length).padStart(4)} run(s), ${first}`);
  }
}

// ----------------------------------------------------------------------
// Part 3: three app instances all wake up at 09:00. A lock with a time limit (TTL) lets only one run the job.
// This class plays the role of Redis:  SET lock:daily-report <owner> NX PX 30000
// ----------------------------------------------------------------------
class LockStore {
  #locks = new Map();
  constructor(clock) {
    this.clock = clock;
  }
  tryAcquire(key, owner, ttlMs) {
    const held = this.#locks.get(key);
    if (held && held.expiresAt > this.clock.now()) return false; // someone else holds a live lock
    this.#locks.set(key, { owner, expiresAt: this.clock.now() + ttlMs });
    return true;
  }
  release(key, owner) {
    // Only the owner may release. Otherwise a slow instance could delete the lock of the instance that took over.
    if (this.#locks.get(key)?.owner !== owner) return false;
    this.#locks.delete(key);
    return true;
  }
}

function lockDemo() {
  console.log('\n--- Part 3: a lock with a TTL so only one instance runs the job');
  const clock = new FakeClock();
  const locks = new LockStore(clock);
  const tryRun = (instance) => {
    const got = locks.tryAcquire('daily-report', instance, 30_000);
    console.log(`  t=${String(clock.now()).padStart(5)} instance ${instance}: ${got ? 'got the lock, runs the job' : 'lock is held, skips'}`);
    return got;
  };
  tryRun('A');
  tryRun('B');
  tryRun('C');
  console.log('  ...instance A freezes (crash or long GC pause) and never releases the lock');
  clock.tick(10_000);
  tryRun('B');
  clock.tick(20_000); // total 30 000 ms: the TTL has passed
  tryRun('C');
  console.log('  instance A wakes up and tries to release:', locks.release('daily-report', 'A') ? 'released' : 'refused (C owns it now)');
}

async function main() {
  await intervalStyles();
  cronDemo();
  lockDemo();
}

main();
