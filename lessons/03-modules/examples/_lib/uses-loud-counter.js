// A second module that also needs loud-counter.js.
const counter = require('./loud-counter.js');

module.exports = function bumpTwice() {
  counter.increment();
  return counter.increment();
};
