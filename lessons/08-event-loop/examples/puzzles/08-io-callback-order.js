// Puzzle 08 (medium): scheduling inside an I/O callback
// Predict the output first, then run it. The explanation is in the lesson README.
// Run: node lessons/08-event-loop/examples/puzzles/08-io-callback-order.js

const fs = require('node:fs');

fs.readFile(__filename, () => {
  console.log('read done');
  setTimeout(() => console.log('timeout'), 0);
  setImmediate(() => console.log('immediate'));
  process.nextTick(() => console.log('nextTick'));
  Promise.resolve().then(() => console.log('promise'));
});
