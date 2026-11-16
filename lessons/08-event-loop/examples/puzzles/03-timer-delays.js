// Puzzle 03 (easy): four timers with different delays
// Predict the output first, then run it. The explanation is in the lesson README.
// Run: node lessons/08-event-loop/examples/puzzles/03-timer-delays.js

setTimeout(() => console.log('A: 10 ms'), 10);
setTimeout(() => console.log('B: 1 ms'), 1);
setTimeout(() => console.log('C: 0 ms'), 0);
setTimeout(() => console.log('D: 5 ms'), 5);
