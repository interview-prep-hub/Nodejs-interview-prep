// An in-memory job queue with retries, exponential backoff and a dead-letter list, plus delivery guarantees
// Run: node lessons/25-architecture-and-patterns/examples/06-job-queue.js
const { FakeClock } = require('./_fake-clock');

class QueueFullError extends Error {}

class JobQueue {
  #waiting = [];
  #active = 0;
  #handler = null;
  #seq = 0;

  constructor({ clock, attempts = 3, backoffMs = 100, concurrency = 1, maxWaiting = Infinity, log = () => {} }) {
    Object.assign(this, { clock, attempts, backoffMs, concurrency, maxWaiting, log });
    this.done = []; // ids of finished jobs
    this.dead = []; // the dead-letter list: jobs that ran out of attempts
  }

  add(name, data) {
    if (this.#waiting.length >= this.maxWaiting) throw new QueueFullError(`queue is full (${this.maxWaiting} waiting)`);
    const job = { id: ++this.#seq, name, data, attemptsMade: 0 };
    this.#waiting.push(job);
    this.#pump();
    return job.id;
  }

  process(handler) {
    this.#handler = handler;
    this.#pump();
  }

  #pump() {
    while (this.#handler && this.#active < this.concurrency && this.#waiting.length > 0) {
      const job = this.#waiting.shift();
      this.#active++;
      this.#run(job).finally(() => {
        this.#active--;
        this.#pump();
      });
    }
  }

  async #run(job) {
    job.attemptsMade++;
    const at = `t=${String(this.clock.now()).padStart(3)}`;
    try {
      await this.#handler(job);
      this.done.push(job.id);
      this.log(`${at} job ${job.id} (${job.name}) attempt ${job.attemptsMade}: success`);
    } catch (err) {
      if (job.attemptsMade >= this.attempts) {
        this.dead.push({ id: job.id, name: job.name, error: err.message, attempts: job.attemptsMade });
        this.log(`${at} job ${job.id} (${job.name}) attempt ${job.attemptsMade}: failed, out of attempts -> dead-letter list`);
        return;
      }
      const delay = this.backoffMs * 2 ** (job.attemptsMade - 1); // 100, 200, 400, ...
      this.log(`${at} job ${job.id} (${job.name}) attempt ${job.attemptsMade}: failed (${err.message}), retry in ${delay} ms`);
      this.clock.setTimeout(() => {
        this.#waiting.push(job);
        this.#pump();
      }, delay);
    }
  }
}

async function retriesAndDeadLetters() {
  console.log('--- Part 1: retries with exponential backoff, then the dead-letter list');
  const clock = new FakeClock();
  const queue = new JobQueue({ clock, attempts: 3, backoffMs: 100, log: (m) => console.log('  ' + m) });

  queue.process(async (job) => {
    if (job.name === 'flaky' && job.attemptsMade < 3) throw new Error('temporary glitch');
    if (job.name === 'broken') throw new Error('always fails');
  });
  queue.add('ok');
  queue.add('flaky');
  queue.add('broken');

  await clock.tickAsync(1000); // move fake time forward; retries fire on the way
  console.log('  finished job ids:', queue.done);
  console.log('  dead-letter list:', queue.dead);
}

async function boundedQueue() {
  console.log('\n--- Part 2: a bounded queue pushes back instead of growing forever');
  const clock = new FakeClock();
  const queue = new JobQueue({ clock, concurrency: 1, maxWaiting: 2 });
  queue.process(() => clock.sleep(100)); // each job "takes" 100 ms of fake time
  for (let i = 1; i <= 4; i++) {
    try {
      queue.add('work', i);
      console.log(`  job ${i}: accepted`);
    } catch (err) {
      console.log(`  job ${i}: rejected (${err.constructor.name}: ${err.message}) -> the API would answer 503 or 429`);
    }
  }
  await clock.tickAsync(1000);
  console.log('  jobs finished:', queue.done.length);
}

// ----------------------------------------------------------------------
// Delivery guarantees. The "broker" keeps a message until it is acknowledged (acked).
// A consumer can crash between its two steps: doing the work, and sending the ack.
// ----------------------------------------------------------------------
function runBroker(messages, consumer) {
  for (const msg of messages) {
    let acked = false;
    for (let delivery = 1; delivery <= 3 && !acked; delivery++) {
      try {
        consumer(msg, () => (acked = true), delivery);
      } catch {
        // The consumer crashed. If it had not acked yet, the broker delivers the message again.
      }
    }
  }
}

function deliveryGuarantees() {
  console.log('\n--- Part 3: at-most-once, at-least-once, and an idempotent consumer');
  const messages = ['m1', 'm2', 'm3'];
  const crashOnce = (msg, delivery) => {
    if (msg === 'm2' && delivery === 1) throw new Error('process died here');
  };

  // At-most-once: ack FIRST, then work. A crash in between loses the message.
  let effects = [];
  runBroker(messages, (msg, ack, delivery) => {
    ack();
    crashOnce(msg, delivery);
    effects.push(msg);
  });
  console.log('  at-most-once  (ack, then work):', effects.join(', '), ' <- m2 is LOST');

  // At-least-once: work FIRST, then ack. A crash in between means a redelivery, so the work runs twice.
  effects = [];
  runBroker(messages, (msg, ack, delivery) => {
    effects.push(msg);
    crashOnce(msg, delivery);
    ack();
  });
  console.log('  at-least-once (work, then ack):', effects.join(', '), ' <- m2 is DUPLICATED');

  // Idempotent consumer: remember which message ids were already handled, and skip repeats.
  // (In a real system this "processed ids" table lives in the database and is updated in the same transaction as the work.)
  effects = [];
  const processed = new Set();
  runBroker(messages, (msg, ack, delivery) => {
    if (!processed.has(msg)) {
      effects.push(msg);
      processed.add(msg);
    }
    crashOnce(msg, delivery);
    ack();
  });
  console.log('  at-least-once + idempotent    :', effects.join(', '), ' <- every message handled once');
}

async function main() {
  await retriesAndDeadLetters();
  await boundedQueue();
  deliveryGuarantees();
}

main();
