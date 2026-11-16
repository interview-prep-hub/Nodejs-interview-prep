// process.nextTick vs promise microtasks (CommonJS file)
// Shows: both queues run before the event loop moves on, and nextTick goes first in CommonJS.
// Run: node lessons/08-event-loop/examples/02-nexttick-vs-promise.js

// Scenario A: all of these are scheduled from the main script.
function scenarioA() {
  console.log('A: sync 1');
  setTimeout(() => {
    console.log('A: setTimeout 0');
    setTimeout(scenarioB, 10); // start the next scenario after this one is finished
  }, 0);
  Promise.resolve().then(() => console.log('A: promise then'));
  queueMicrotask(() => console.log('A: queueMicrotask'));
  process.nextTick(() => console.log('A: nextTick'));
  console.log('A: sync 2');
}

// Scenario B: the same thing, but scheduled from inside a callback (a timer).
function scenarioB() {
  console.log('B: timer callback starts');
  Promise.resolve().then(() => console.log('B: promise then'));
  process.nextTick(() => console.log('B: nextTick'));
  console.log('B: timer callback ends');
  setTimeout(scenarioC, 10);
}

// Scenario C: queues that schedule more work into the other queue.
function scenarioC() {
  process.nextTick(() => {
    console.log('C: tick 1');
    Promise.resolve().then(() => console.log('C: promise made inside tick 1'));
    process.nextTick(() => console.log('C: tick made inside tick 1'));
  });
  Promise.resolve().then(() => {
    console.log('C: promise 1');
    process.nextTick(() => console.log('C: tick made inside promise 1'));
    Promise.resolve().then(() => console.log('C: promise made inside promise 1'));
  });
  process.nextTick(() => console.log('C: tick 2'));
}

scenarioA();
