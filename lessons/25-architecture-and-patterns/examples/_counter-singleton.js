// Helper (not run by itself): a module whose exports object is a singleton thanks to the module cache.
// Used by 04-creational-structural.js.
let count = 0; // module-level state: created once, when the file is first loaded

console.log('  (_counter-singleton.js is executing now)');

module.exports = {
  next() {
    count += 1;
    return count;
  },
};
