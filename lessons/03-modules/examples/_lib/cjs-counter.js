// The same counter written as CommonJS.
// `count: count` copies the number 0 into the exports object at this moment.
let count = 0;

function increment() {
  count += 1;
}

function getCount() {
  return count;
}

module.exports = { count, increment, getCount };
