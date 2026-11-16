// Puzzle 12 (hard): returning a promise from an async function
// Predict the output first, then run it. The explanation is in the lesson README.
// Run: node lessons/08-event-loop/examples/puzzles/12-async-return-promise.js

async function plain() {
  return 1;
}

async function wrapped() {
  return Promise.resolve(2);
}

plain().then(() => console.log('plain'));
wrapped().then(() => console.log('wrapped'));

Promise.resolve()
  .then(() => console.log('p1'))
  .then(() => console.log('p2'))
  .then(() => console.log('p3'))
  .then(() => console.log('p4'));
