// Puzzle 01 (easy): synchronous code and a timer
// Predict the output first, then run it. The explanation is in the lesson README.
// Run: node lessons/08-event-loop/examples/puzzles/01-sync-and-timer.js

console.log('A');

setTimeout(() => {
  console.log('B');
}, 0);

console.log('C');
