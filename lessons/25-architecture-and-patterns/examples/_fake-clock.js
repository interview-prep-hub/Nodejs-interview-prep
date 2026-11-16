// Helper (not run by itself): a fake clock so that timing examples are deterministic.
// Used by examples 06, 07, 08, 10 and 11 with: const { FakeClock } = require('./_fake-clock');

class FakeClock {
  constructor(start = 0) {
    this.time = start;
    this.timers = [];
    this.nextId = 1;
  }

  // Current fake time in milliseconds (like Date.now(), but under our control).
  now() {
    return this.time;
  }

  // Like setTimeout: the callback runs when the fake time reaches now() + ms.
  setTimeout(fn, ms) {
    const id = this.nextId++;
    this.timers.push({ id, at: this.time + ms, fn });
    return id;
  }

  clearTimeout(id) {
    this.timers = this.timers.filter((t) => t.id !== id);
  }

  // A promise that resolves after ms of FAKE time (use with tickAsync).
  sleep(ms) {
    return new Promise((resolve) => this.setTimeout(resolve, ms));
  }

  // Move time forward by ms and run every timer that becomes due, in order.
  // Synchronous: fine for code that does not use promises.
  tick(ms) {
    const target = this.time + ms;
    for (let timer = this.#nextDue(target); timer; timer = this.#nextDue(target)) {
      this.timers = this.timers.filter((t) => t !== timer);
      this.time = timer.at;
      timer.fn();
    }
    this.time = target;
  }

  // Same as tick, but after each timer it lets pending promise callbacks run,
  // so code like "await sleep(100); doMore()" can continue and schedule new timers.
  async tickAsync(ms) {
    const target = this.time + ms;
    await flushPromises();
    for (let timer = this.#nextDue(target); timer; timer = this.#nextDue(target)) {
      this.timers = this.timers.filter((t) => t !== timer);
      this.time = timer.at;
      timer.fn();
      await flushPromises();
    }
    this.time = target;
  }

  #nextDue(target) {
    let best = null;
    for (const t of this.timers) {
      if (t.at > target) continue;
      if (!best || t.at < best.at || (t.at === best.at && t.id < best.id)) best = t;
    }
    return best;
  }
}

// One trip through the real event loop is enough to run all queued promise callbacks.
function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve));
}

module.exports = { FakeClock, flushPromises };
