// Puzzle 11 (hard): the same queues in an ES module
// Predict the output first, then run it. The explanation is in the lesson README.
// Run: node lessons/08-event-loop/examples/puzzles/11-esm-order.mjs

console.log('start');
process.nextTick(() => console.log('nextTick'));
Promise.resolve().then(() => console.log('promise'));
queueMicrotask(() => console.log('queueMicrotask'));
setTimeout(() => console.log('timeout'), 0);
console.log('end');
