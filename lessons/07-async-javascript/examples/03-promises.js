// Promises: states, then/catch/finally, chaining, error propagation, and "then is always async"
// Shows what a promise is, what a then callback may return, and how errors travel down a chain.
// Run: node lessons/07-async-javascript/examples/03-promises.js

// A tiny helper: a promise that fulfills with `value` after `ms` milliseconds.
const delay = (ms, value) => new Promise((resolve) => setTimeout(resolve, ms, value));

// Part 1: the three states.
function part1() {
  console.log('--- 1: states');
  const p = delay(10, 'hello');
  console.log('right after creating it:', p); // pending: no value yet
  return p.then((value) => {
    console.log('then received:', value);
    console.log('the same promise now:', p); // fulfilled: it keeps its value forever
  });
}

// Part 2: then, catch and finally.
function part2() {
  console.log('--- 2: then / catch / finally');
  const good = delay(5, 42).then((n) => console.log('good fulfilled with', n));
  const bad = Promise.reject(new Error('it broke'))
    .then(() => console.log('never printed: then is skipped on rejection'))
    .catch((err) => console.log('catch received:', err.message))
    .finally(() => console.log('finally runs in both cases and gets no argument'));
  return Promise.all([good, bad]);
}

// Part 3: chaining. Whatever a then callback returns becomes the value of the NEXT promise.
function part3() {
  console.log('--- 3: chaining');
  return Promise.resolve(1)
    .then((n) => n + 1) // returns a plain value
    .then((n) => {
      console.log('got', n, '(a plain value was passed on)');
      return delay(10, n * 10); // returns a promise: the chain WAITS for it
    })
    .then((n) => {
      console.log('got', n, '(the chain waited for the returned promise)');
      // no return here
    })
    .then((n) => {
      console.log('got', n, '(forgot to return, so the next value is undefined)');
    });
}

// Part 4: errors skip down the chain to the nearest catch. A catch can recover.
function part4() {
  console.log('--- 4: error propagation');
  return Promise.resolve('start')
    .then((v) => {
      console.log('step 1 got', v);
      throw new Error('step 2 failed'); // a throw inside then = a rejection
    })
    .then(() => console.log('step 3 skipped'))
    .then(() => console.log('step 4 skipped'))
    .catch((err) => {
      console.log('caught:', err.message);
      return 'recovered'; // returning a value makes the chain fulfilled again
    })
    .then((v) => console.log('step 5 got', v))
    .catch(() => console.log('not reached'));
}

// Part 5: then callbacks are ALWAYS asynchronous, even if the promise is already settled.
function part5() {
  console.log('--- 5: then is always async (microtasks run before timers)');
  console.log('1. sync: start');
  setTimeout(() => console.log('6. timer callback (a "macrotask")'), 0);
  Promise.resolve().then(() => console.log('4. promise callback (a "microtask")'));
  (async () => {
    console.log('2. async function: the code before the first await is still sync');
    await null;
    console.log('5. async function: the code after an await is a microtask too');
  })();
  console.log('3. sync: end');
  return delay(20); // keep the chain waiting so the output stays in order
}

// Part 6: three gotchas with then().
async function part6() {
  console.log('--- 6: then gotchas');

  // a) then() ignores an argument that is not a function. The value simply passes through.
  const a = await Promise.resolve('one').then('two');
  console.log('a) Promise.resolve("one").then("two") gives', a);

  // b) then(work()) CALLS work() right now and hands its RESULT (here undefined) to then.
  //    Pass the function itself (or an arrow function that calls it).
  const slow = delay(20, 'data');
  slow.then(console.log('b) wrong: this ran at once, not after the promise')); // BUG
  await slow.then(() => console.log('b) right: this ran after the promise'));

  // c) Calling then() twice on the same promise makes two branches, not one chain.
  //    Both branches get the original value. What branch 1 returns never reaches branch 2.
  const base = Promise.resolve(10);
  const branch1 = base.then((n) => {
    console.log('c) branch 1 got', n);
    return n + 1;
  });
  const branch2 = base.then((n) => {
    console.log('c) branch 2 got', n);
    return n * 2;
  });
  console.log('c) branch results:', await branch1, await branch2);
}

part1().then(part2).then(part3).then(part4).then(part5).then(part6);
