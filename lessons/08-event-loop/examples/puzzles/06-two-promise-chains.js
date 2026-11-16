// Puzzle 06 (medium): two promise chains and a queueMicrotask
// Predict the output first, then run it. The explanation is in the lesson README.
// Run: node lessons/08-event-loop/examples/puzzles/06-two-promise-chains.js

Promise.resolve()
  .then(() => console.log('A1'))
  .then(() => console.log('A2'))
  .then(() => console.log('A3'));

Promise.resolve()
  .then(() => console.log('B1'))
  .then(() => console.log('B2'));

queueMicrotask(() => console.log('Q'));
