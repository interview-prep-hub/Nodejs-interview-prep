// process.nextTick vs promise microtasks (ES module file)
// Shows: in an ES module the promise queue runs BEFORE nextTick, the opposite of CommonJS.
// Run: node lessons/08-event-loop/examples/03-nexttick-vs-promise.mjs

console.log('A: sync 1');
setTimeout(() => {
  console.log('A: setTimeout 0');
  setTimeout(scenarioB, 10); // start the next scenario after this one is finished
}, 0);
Promise.resolve().then(() => console.log('A: promise then'));
queueMicrotask(() => console.log('A: queueMicrotask'));
process.nextTick(() => console.log('A: nextTick'));
console.log('A: sync 2');

// Inside a callback (here a timer) the rule is the same as in CommonJS:
// the nextTick queue is drained first, then the promise queue.
function scenarioB() {
  console.log('B: timer callback starts');
  Promise.resolve().then(() => console.log('B: promise then'));
  process.nextTick(() => console.log('B: nextTick'));
  console.log('B: timer callback ends');
}
