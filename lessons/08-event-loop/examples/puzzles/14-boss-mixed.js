// Puzzle 14 (very hard): async function, I/O callback, timers, immediates and both microtask queues
// Predict the output first, then run it. The explanation is in the lesson README.
// Run: node lessons/08-event-loop/examples/puzzles/14-boss-mixed.js

const fs = require('node:fs');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function task() {
  console.log('task: start');
  await null;
  console.log('task: after first await');
  await sleep(0);
  console.log('task: after sleep(0)');
}

fs.readFile(__filename, () => {
  console.log('read: start');
  setTimeout(() => console.log('read: timeout'), 0);
  setImmediate(() => console.log('read: immediate'));
  task();
  process.nextTick(() => console.log('read: nextTick'));
  Promise.resolve().then(() => console.log('read: promise'));
  console.log('read: end');
});
