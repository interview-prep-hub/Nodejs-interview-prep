// Build your own EventEmitter (a classic interview task) and prove it behaves like the real one
// Run: node lessons/09-events/examples/10-mini-emitter.js

const assert = require('node:assert/strict');
const EventEmitter = require('node:events');

// Step 1: the smallest useful version. A Map from event name to an array of functions.
class TinyEmitter {
  constructor() {
    this.listeners = new Map();
  }
  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(fn);
    return this;
  }
  emit(name, ...args) {
    const list = this.listeners.get(name);
    if (!list) return false;
    for (const fn of list) fn.apply(this, args);
    return true;
  }
}

// Steps 2 to 6: the complete version.
class MiniEmitter {
  constructor() {
    this.events = new Map(); // event name -> array of listener functions
  }

  // Step 2: on, plus prependListener, both chainable (they return this)
  on(name, fn) {
    if (typeof fn !== 'function') throw new TypeError('listener must be a function');
    if (!this.events.has(name)) this.events.set(name, []);
    this.events.get(name).push(fn);
    return this;
  }

  prependListener(name, fn) {
    if (!this.events.has(name)) this.events.set(name, []);
    this.events.get(name).unshift(fn);
    return this;
  }

  // Step 3: off removes ONE instance, the most recently added, like the real one.
  // A once() wrapper keeps the original function in wrapper.listener so off(name, original) works.
  off(name, fn) {
    const list = this.events.get(name);
    if (!list) return this;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i] === fn || list[i].listener === fn) {
        list.splice(i, 1);
        break;
      }
    }
    if (list.length === 0) this.events.delete(name);
    return this;
  }

  // Step 4: once wraps the function. The wrapper removes itself first, then calls the original.
  once(name, fn) {
    const wrapper = (...args) => {
      this.off(name, wrapper);
      return fn.apply(this, args);
    };
    wrapper.listener = fn;
    return this.on(name, wrapper);
  }

  // Step 5: emit loops over a COPY of the array, so changes made by listeners
  // do not affect the emit that is already running.
  emit(name, ...args) {
    const list = this.events.get(name);
    if (!list || list.length === 0) {
      // Step 6: the special error event
      if (name === 'error') {
        throw args[0] instanceof Error ? args[0] : new Error(`Unhandled error. (${String(args[0])})`);
      }
      return false;
    }
    for (const fn of [...list]) fn.apply(this, args);
    return true;
  }

  listenerCount(name) {
    const list = this.events.get(name);
    return list ? list.length : 0;
  }

  eventNames() {
    return [...this.events.keys()];
  }

  removeAllListeners(name) {
    if (name === undefined) this.events.clear();
    else this.events.delete(name);
    return this;
  }
}

console.log('1. TinyEmitter: on and emit only');
const tiny = new TinyEmitter();
tiny.on('hi', (name) => console.log('  hello,', name));
console.log('  emit returned:', tiny.emit('hi', 'Ann'));

// The same script runs against any class. It records what happened in an array.
function scenario(Emitter) {
  const log = [];
  const say = (text) => log.push(text);
  const e = new Emitter();

  e.on('hi', (name) => say(`first ${name}`));
  e.on('hi', function (name) {
    say(`second ${name}, this is the emitter: ${this === e}`);
  });
  e.prependListener('hi', (name) => say(`prepended ${name}`));
  say(`emit(hi) returned ${e.emit('hi', 'Ann')}`);

  e.once('one', (a, b) => say(`once got ${a} and ${b}`));
  say(`1st emit(one) returned ${e.emit('one', 1, 2)}`);
  say(`2nd emit(one) returned ${e.emit('one', 1, 2)}`);

  const neverCalled = () => say('should not run');
  e.once('removed', neverCalled);
  e.off('removed', neverCalled);
  say(`emit(removed) returned ${e.emit('removed')}`);

  function second() {
    say('snap: second');
  }
  e.on('snap', () => {
    say('snap: first');
    e.off('snap', second);
    e.on('snap', () => say('snap: late'));
  });
  e.on('snap', second);
  e.emit('snap');
  say('-- second emit(snap)');
  e.emit('snap');

  say(`listenerCount(hi) = ${e.listenerCount('hi')}`);
  say(`eventNames = ${e.eventNames().join(', ')}`);

  try {
    e.emit('error', new Error('boom'));
  } catch (err) {
    say(`error with no listener threw: ${err.message}`);
  }
  e.on('error', (err) => say(`error handled: ${err.message}`));
  e.emit('error', new Error('boom'));

  say(`on() returns the emitter: ${e.on('x', () => {}) === e}`);
  e.removeAllListeners();
  say(`eventNames after removeAllListeners = [${e.eventNames().join(', ')}]`);
  return log;
}

console.log('2. run the same scenario on MiniEmitter and on the real EventEmitter');
const mine = scenario(MiniEmitter);
const real = scenario(EventEmitter);
for (const line of mine) console.log('  ' + line);

assert.deepEqual(mine, real); // throws if even one line differs
console.log(`3. both logs are identical (${real.length} lines compared)`);
