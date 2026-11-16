// Puzzle 10 (hard): setImmediate inside setImmediate
// Predict the output first, then run it. The explanation is in the lesson README.
// Run: node lessons/08-event-loop/examples/puzzles/10-nested-immediates.js

setImmediate(() => {
  console.log('immediate 1');
  setImmediate(() => console.log('immediate nested'));
  process.nextTick(() => console.log('tick from immediate 1'));
});

setImmediate(() => console.log('immediate 2'));
