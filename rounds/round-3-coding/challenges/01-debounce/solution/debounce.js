'use strict';
// Idea: keep one timer. Every call restarts it. When it fires (a quiet period of `wait` ms),
// run the trailing call with the LAST arguments and `this`.
// `leading` runs the function at the start of a burst. `pending` records whether a trailing call is owed.
// Complexity: O(1) per call.

function debounce(fn, wait, { leading = false, trailing = true } = {}) {
  let timer = null;
  let lastArgs;
  let lastThis;
  let pending = false;
  let result;

  function invokeTrailing() {
    const args = lastArgs;
    const ctx = lastThis;
    lastArgs = lastThis = undefined;
    pending = false;
    result = fn.apply(ctx, args);
    return result;
  }

  function debounced(...args) {
    const startsBurst = timer === null;
    if (timer !== null) clearTimeout(timer);
    if (startsBurst && leading) {
      result = fn.apply(this, args);
      pending = false;
    } else {
      lastArgs = args;
      lastThis = this;
      pending = trailing;
    }
    timer = setTimeout(() => {
      timer = null;
      if (pending) invokeTrailing();
    }, wait);
    return result;
  }

  debounced.cancel = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = false;
    lastArgs = lastThis = undefined;
  };

  debounced.flush = () => {
    if (timer === null) return result;
    clearTimeout(timer);
    timer = null;
    if (pending) invokeTrailing();
    return result;
  };

  return debounced;
}

module.exports = { debounce };
