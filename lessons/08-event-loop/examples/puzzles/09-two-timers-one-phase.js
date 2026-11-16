// Puzzle 09 (hard): two timers that are due at the same time
// Predict the output first, then run it. The explanation is in the lesson README.
// Run: node lessons/08-event-loop/examples/puzzles/09-two-timers-one-phase.js

setTimeout(() => {
  console.log('timer 1');
  Promise.resolve().then(() => console.log('promise from timer 1'));
  process.nextTick(() => console.log('tick from timer 1'));
}, 0);

setTimeout(() => {
  console.log('timer 2');
  Promise.resolve().then(() => console.log('promise from timer 2'));
  process.nextTick(() => console.log('tick from timer 2'));
}, 0);
