// Creating promises: new Promise, Promise.resolve/reject/withResolvers/try, and wrapping callbacks
// Shows how to make a promise yourself, and how to turn a callback API into a promise API.
// Run: node lessons/07-async-javascript/examples/04-creating-promises.js

// A tiny helper: a promise that fulfills with `value` after `ms` milliseconds.
const delay = (ms, value) => new Promise((resolve) => setTimeout(resolve, ms, value));

// 1. new Promise((resolve, reject) => { ... })
//    The function you pass (the "executor") runs IMMEDIATELY and synchronously.
console.log('1. before new Promise');
const p1 = new Promise((resolve) => {
  console.log('2. inside the executor (runs right now)');
  resolve('done');
});
console.log('3. after new Promise');

// 2. Promise.withResolvers (Node 22+): resolve/reject live OUTSIDE the executor.
function waitForSignal() {
  const { promise, resolve, reject } = Promise.withResolvers();
  return { promise, resolve, reject };
}

// 3. Promise.try (Node 24): run a function that may throw OR return a promise, always get a promise.
function maybeThrows(shouldThrow) {
  if (shouldThrow) throw new Error('sync throw');
  return 'sync value';
}

// 4. Wrapping a callback API by hand (this is what util.promisify does for you).
function oldStyleDouble(n, callback) {
  setTimeout(() => {
    if (typeof n !== 'number') return callback(new TypeError('n must be a number'));
    callback(null, n * 2);
  }, 5);
}

function doubleAsync(n) {
  return new Promise((resolve, reject) => {
    oldStyleDouble(n, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

// NOTE: in main() every rejecting promise gets its .catch right away, in the same step that
// creates it. A rejected promise with no handler attached in time crashes the process (see 12).
async function main() {
  console.log('p1:', await p1);

  // A promise settles only once. Later resolve/reject calls are ignored.
  const p2 = new Promise((resolve, reject) => {
    resolve('first');
    resolve('second'); // ignored
    reject(new Error('too late')); // ignored
  });
  console.log('p2:', await p2);

  // resolve(anotherPromise) "locks in": the outer promise now follows the inner one. A later
  // reject is ignored, but the outer promise stays pending until the inner one settles.
  // This is why "resolved" and "fulfilled" are not the same word.
  const inner = delay(20, 'inner value');
  const outer = new Promise((resolve, reject) => {
    resolve(inner);
    reject(new Error('ignored: already locked in'));
  });
  console.log('outer right after resolve(inner):', outer);
  console.log('outer later:', await outer);

  // A throw inside the executor turns into a rejection.
  const p3 = new Promise(() => {
    throw new Error('thrown in executor');
  });
  console.log('p3:', await p3.catch((e) => e.message));

  // Promise.resolve and Promise.reject: ready-made settled promises.
  const p4 = Promise.resolve(7);
  console.log('p4:', await p4);
  console.log('Promise.resolve(p4) === p4:', Promise.resolve(p4) === p4); // the same promise is reused
  console.log('p5:', await Promise.reject(new Error('already rejected')).catch((e) => e.message));

  // withResolvers: someone else (here a timer) settles the promise later.
  const signal = waitForSignal();
  setTimeout(() => signal.resolve('signal received'), 10);
  console.log('withResolvers:', await signal.promise);

  console.log('Promise.try (throws):', await Promise.try(maybeThrows, true).catch((e) => e.message));
  console.log('Promise.try (returns):', await Promise.try(maybeThrows, false));

  console.log('doubleAsync(21):', await doubleAsync(21));
  console.log('doubleAsync("x"):', await doubleAsync('x').catch((e) => e.message));
}

main();
