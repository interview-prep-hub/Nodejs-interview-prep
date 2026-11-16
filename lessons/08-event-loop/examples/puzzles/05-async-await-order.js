// Puzzle 05 (medium): where does an async function pause?
// Predict the output first, then run it. The explanation is in the lesson README.
// Run: node lessons/08-event-loop/examples/puzzles/05-async-await-order.js

async function one() {
  console.log('one: start');
  await two();
  console.log('one: end');
}

async function two() {
  console.log('two');
}

console.log('script start');
one();
new Promise((resolve) => {
  console.log('promise executor');
  resolve();
}).then(() => console.log('promise then'));
console.log('script end');
