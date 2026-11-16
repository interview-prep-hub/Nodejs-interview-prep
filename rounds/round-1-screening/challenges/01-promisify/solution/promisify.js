'use strict';
// Idea: wrap the call in a Promise and pass an error-first callback that settles it.
// A normal function (not an arrow) is returned so `this` can be forwarded with fn.call(this, ...).
// Complexity: O(1) extra work per call.

function promisify(fn) {
  if (typeof fn !== 'function') throw new TypeError('fn must be a function');
  return function promisified(...args) {
    return new Promise((resolve, reject) => {
      // A synchronous throw inside the executor rejects the promise automatically.
      fn.call(this, ...args, (err, value) => {
        if (err) reject(err);
        else resolve(value); // extra callback values are ignored
      });
    });
  };
}

module.exports = { promisify };
