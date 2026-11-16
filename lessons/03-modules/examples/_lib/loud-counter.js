// A module that announces when its code runs, and keeps private state.
console.log('  [loud-counter.js] the module code is running');

let count = 0;

module.exports = {
  increment() {
    count += 1;
    return count;
  },
  get() {
    return count;
  },
};
