// Puzzle 13 (hard): everything scheduled from inside a timer callback
// Predict the output first, then run it. The explanation is in the lesson README.
// Run: node lessons/08-event-loop/examples/puzzles/13-work-from-a-timer.js

setTimeout(() => console.log('timeout 1'), 0);

setTimeout(() => {
  console.log('timeout 2');
  Promise.resolve().then(() => console.log('promise in timeout 2'));
  process.nextTick(() => console.log('tick in timeout 2'));
  setImmediate(() => console.log('immediate from timeout 2'));
  setTimeout(() => console.log('timeout from timeout 2'), 0);
}, 0);

setTimeout(() => console.log('timeout 3'), 0);
