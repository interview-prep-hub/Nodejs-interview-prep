// Puzzle 07 (medium): queues that schedule work in the other queue
// Predict the output first, then run it. The explanation is in the lesson README.
// Run: node lessons/08-event-loop/examples/puzzles/07-nested-tick-promise.js

process.nextTick(() => {
  console.log('tick 1');
  Promise.resolve().then(() => console.log('promise from tick 1'));
  process.nextTick(() => console.log('tick from tick 1'));
});

Promise.resolve().then(() => {
  console.log('promise 1');
  process.nextTick(() => console.log('tick from promise 1'));
});

process.nextTick(() => console.log('tick 2'));
console.log('sync');
