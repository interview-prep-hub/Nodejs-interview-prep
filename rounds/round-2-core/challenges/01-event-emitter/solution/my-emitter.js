'use strict';
// Idea: a Map from event name to an array of listener functions.
// emit() loops over a COPY of the array, so adding or removing listeners while emitting
// does not change who runs for that emit (this is what Node does too).
// once() stores a wrapper that removes itself first, then calls the original; wrapper.listener
// remembers the original so off(original) and listeners() still work.
// Complexity: emit is O(listeners), off is O(listeners).

class MyEmitter {
  constructor() {
    this._events = new Map();
  }

  _add(name, fn, prepend) {
    if (typeof fn !== 'function') throw new TypeError('listener must be a function');
    const list = this._events.get(name) || [];
    if (prepend) list.unshift(fn);
    else list.push(fn);
    this._events.set(name, list);
    return this;
  }

  on(name, fn) {
    return this._add(name, fn, false);
  }

  addListener(name, fn) {
    return this._add(name, fn, false);
  }

  prependListener(name, fn) {
    return this._add(name, fn, true);
  }

  once(name, fn) {
    const self = this;
    function wrapper(...args) {
      self.off(name, wrapper);
      return fn.apply(this, args);
    }
    wrapper.listener = fn;
    return this._add(name, wrapper, false);
  }

  off(name, fn) {
    const list = this._events.get(name);
    if (!list) return this;
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i] === fn || list[i].listener === fn) {
        list.splice(i, 1);
        break;
      }
    }
    if (list.length === 0) this._events.delete(name);
    return this;
  }

  removeListener(name, fn) {
    return this.off(name, fn);
  }

  removeAllListeners(name) {
    if (name === undefined) this._events.clear();
    else this._events.delete(name);
    return this;
  }

  emit(name, ...args) {
    const list = this._events.get(name);
    if (!list || list.length === 0) {
      if (name === 'error') {
        throw args[0] instanceof Error ? args[0] : new Error(`Unhandled error: ${String(args[0])}`);
      }
      return false;
    }
    for (const fn of [...list]) fn.apply(this, args);
    return true;
  }

  listenerCount(name) {
    const list = this._events.get(name);
    return list ? list.length : 0;
  }

  listeners(name) {
    const list = this._events.get(name) || [];
    return list.map((fn) => fn.listener || fn);
  }
}

module.exports = { MyEmitter };
