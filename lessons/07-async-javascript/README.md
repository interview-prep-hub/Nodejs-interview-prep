# 07. Asynchronous JavaScript: Callbacks, Promises and async/await

> Level: Beginner   Time: about 150 minutes   Node: 24 (notes where older versions differ)

[Previous: 06. The File System (fs)](../06-file-system/README.md) | [All lessons](../../README.md) | [Next: 08. The Event Loop (the most asked Node.js topic)](../08-event-loop/README.md)

## What you will learn
- The difference between sync, async, blocking and non-blocking, in plain words.
- How callbacks and the error-first convention work, and why "callback hell" and "inversion of control" are real problems.
- Promises from scratch: the three states, `then` / `catch` / `finally`, chaining, error propagation and unhandled rejections.
- `async` / `await`: what it really is, `try` / `catch` / `finally`, `return` vs `return await`, and top-level `await`.
- The biggest beginner performance mistake (awaiting in a row) and the four combinators `Promise.all`, `allSettled`, `race` and `any`.
- Real-world patterns you can write by hand: a concurrency limit, retry with exponential backoff, timeouts and cancellation with `AbortController`.
- Node helpers (`util.promisify`, `timers/promises`, `events.once`), async iterators and `for await...of`.
- The common mistakes interviewers love (a missing `await`, `async` in `forEach`, async event listeners), and how to answer the typical questions.

You only need to know functions, arrow functions and `try` / `catch`. The lesson has four parts:

| Part | Sections | What you get |
|---|---|---|
| Foundations | 1 to 12 | the mental model, callbacks, promises, `async` / `await`, async error handling, unhandled rejections |
| Patterns | 13 to 19 | parallel work, concurrency limits, retry, timeouts, cancellation, Node helpers |
| Advanced | 20 to 22 | top-level `await`, async iterators, the classic mistakes |
| Revision | 23 and the end | how to answer, key takeaways, quick check, practice tasks |

All examples live in [examples/](examples/). Run every example from the repo root, for example `node lessons/07-async-javascript/examples/01-sync-vs-async.js`.

## 1. Blocking vs non-blocking, sync vs async

Four words that people mix up. In plain words:

| Word | Meaning | Kettle analogy |
|---|---|---|
| Synchronous (sync) | Steps run one after another. The next step waits for the current one to finish. | Start the kettle, stand and watch it, then make tea. |
| Asynchronous (async) | You start a task and move on. You get told later when it is done. | Start the kettle, chop vegetables, come back when it clicks. |
| Blocking | The thread is stuck. Nothing else can run on it until the call returns. | Staring at the kettle. |
| Non-blocking | The call returns at once. The result arrives later. | Pressing the button and walking away. |

In everyday Node talk, "sync" means blocking and "async" means non-blocking. Strictly, sync / async is about **how you get the result** (on the next line, or later), and blocking / non-blocking is about **whether the thread is stuck while it waits**.

Why this matters in Node: your JavaScript runs on **one main thread** (a thread is one line of execution). If that thread is busy or stuck waiting, nothing else in your program can run: no other request, no timer, nothing. Waiting for slow things like the disk or the network (called **I/O**, short for input and output) does not need your JavaScript, so Node can serve many requests while it waits. That only works if your code does not block the main thread.

File: [examples/01-sync-vs-async.js](examples/01-sync-vs-async.js). The key parts:

```js
function busyWait(ms) {                 // a deliberately bad function
  const end = Date.now() + ms;
  while (Date.now() < end) {}           // spins: nothing else can run
}

// B: a timer is asynchronous. We schedule it and keep going.
setTimeout(() => console.log('B3. timer callback (ran later)'), 20);
console.log('B2. timer scheduled, we did not wait for it');

// C: blocking read vs non-blocking read of the same file
const text = fs.readFileSync(__filename, 'utf8');          // blocks until done
fs.readFile(__filename, 'utf8', (err, data) => { /* ... */ }); // returns at once

// D: a blocked thread also delays every timer
setTimeout(() => { /* wanted 10 ms */ }, 10);
busyWait(100);
```

Output (the file runs the four parts one after another):

```text
A1. start
A2. we waited 50 ms and nothing else could run
B1. about to schedule a timer
B2. timer scheduled, we did not wait for it
B3. timer callback (ran later)
C1. readFileSync finished, got text: true
C2. readFile started, we did not wait for it
C3. readFile finished later, got text: true
D1. a 10 ms timer is scheduled, then we block for 100 ms
D2. blocking is over, the main code is finished
D3. the 10 ms timer fired late, after at least 100 ms: true
```

Why:
- `B2` prints before `B3`. `setTimeout` does not wait. It stores the callback and returns. Node runs the callback later, when the main code is finished and the 20 ms are over.
- `C1` / `C2` / `C3` show the same difference with real I/O: `readFileSync` blocks (you get the data on the next line), `readFile` returns at once and calls you back.
- `D3` shows the damage a blocking call does: the 10 ms timer could not fire until the 100 ms busy loop ended.

> **Remember:** `async` does not mean "runs on another thread" and does not make heavy computation fast. A long loop that calculates something blocks the main thread even if it is inside an `async` function. Async is about **not wasting the thread while waiting** for slow things (disk, network, timers).

> **Under the hood:** who does the waiting? For network sockets, the operating system tells Node when data has arrived. For file reads, `dns.lookup`, `crypto.pbkdf2` and compression, Node hands the job to a pool of helper threads (4 by default) and picks up the result later. Your JavaScript still runs on one thread. A heavy calculation has no helper, so it blocks: move it to `worker_threads` (lesson [18](../18-worker-threads-and-cluster/README.md)). Lesson [08](../08-event-loop/README.md) draws the full picture.

> **Interview tip:** "Why is `fs.readFileSync` inside a request handler bad?" Strong answer: it blocks the single main thread, so every other request waits until the read finishes. Sync calls are fine at startup (reading a config file once), not while serving requests.

## 2. Callbacks and the error-first convention

A **callback** is a function you pass to another function, to be called later. Not every callback is async (`[1, 2].map(fn)` calls `fn` immediately), but the ones that matter here are: "call me when the file is read".

Node has one convention for async callbacks, called **error-first** (or "Node-style"):
- The callback is the **last** argument.
- Its **first** parameter is the error. It is `null` (or `undefined`) when everything went fine.
- The following parameters are the results.

File: [examples/02-callbacks.js](examples/02-callbacks.js), part A. `getUser` is a fake async function written in this style:

```js
function getUser(id, callback) {
  setTimeout(() => {
    if (id <= 0) return callback(new Error('invalid user id: ' + id));
    callback(null, { id, name: 'user' + id });
  }, 5);
}

getUser(1, (err, user) => {
  if (err) return console.log('A error:', err.message);   // always check err FIRST
  console.log('A user:', user);
});
```

```text
--- A: error-first callback
A user: { id: 1, name: 'user1' }
A error: invalid user id: -5
A user2: undefined
```

The last two lines come from calling `getUser(-5, ...)`: the error is set and the result is `undefined`.

Why the convention exists: every async function looks the same, there is one obvious place to check for failure, and `util.promisify` (section 19) can convert any such function into a promise function automatically.

Rules to remember:
1. Check `err` first, every time.
2. After calling `callback(err)` **return**, or the success code below it runs too.
3. Call the callback **exactly once**.

```js
function getUserBad(id, callback) {
  if (id <= 0) callback(new Error('bad id')); // BUG: no return, so the next line runs as well
  callback(null, { id });                     // the callback is called twice
}
```

> **Common mistake:** forgetting `return` after `callback(err)`. The callback runs twice: once with the error and once with a result.

> **Interview tip:** "What is the error-first callback convention?" Strong answer: the callback is the last argument, its first parameter is the error (`null` on success) and the results follow. You check the error first, `return` after handling it, and call the callback exactly once. `util.promisify` relies on this shape.

## 3. Callback hell and inversion of control

When step 2 needs the result of step 1, and step 3 needs step 2, callbacks nest deeper and deeper. People call the shape the "pyramid of doom" or **callback hell**. Part B of the same file:

```js
getUser(2, (err, user) => {
  if (err) return console.log(err.message);
  getOrders(user, (err, orders) => {
    if (err) return console.log(err.message);
    getTotal(orders, (err, total) => {
      if (err) return console.log(err.message);
      console.log('B total for', user.name, '=', total);
    });
  });
});
```

```text
--- B: callback hell
B total for user2 = 50
```

Problems with this:
- The code drifts to the right and gets hard to read.
- Error handling is repeated at every level. Forget one `if (err)` and an error disappears.
- Running steps in a loop or in parallel is awkward to write.

You can flatten it by giving each step a name (part C: `onUser`, `onOrders`, `onTotal`). That helps a little, but it is still callbacks.

The deeper problem is **inversion of control**: when you pass your callback to someone else's function, you give away control. You must trust that function to call you once, not twice, not too early, not never, and not to swallow your errors. Part D shows a library bug that calls the callback twice (think: a payment charged twice):

```js
function badChargeCard(amount, callback) {
  setTimeout(() => {
    callback(null, 'charged ' + amount);
    callback(null, 'charged ' + amount); // bug in code we do not own
  }, 5);
}
```

```text
--- C: flattened with named functions
C total for user3 = 50
--- D: inversion of control
D callback was called 2 times without protection
D callback was called 1 time with the once() guard
```

`once(fn)` is a small wrapper that ignores every call after the first one. You should not have to write guards like this. A **promise** fixes the trust problem: it settles once, and you attach your handlers to the promise you receive instead of handing your function away.

One more trap (part E): `try` / `catch` cannot catch an error that is thrown inside a later callback, because by then the `try` block is long finished.

```js
try {
  setTimeout(() => { throw new Error('boom inside a timer'); }, 5);
  console.log('E try block finished without any error');
} catch (err) {
  console.log('never printed:', err.message);
}
```

```text
--- E: try/catch does not see async errors
E try block finished without any error
E nobody could catch this one locally, it became uncaught: boom inside a timer
```

The example installs `process.once('uncaughtException', ...)` only so that the demo can print the error and continue. (An **uncaught exception** is an error that nothing caught; without that handler Node crashes with exit code 1.)

**The last trap (part F): sometimes sync, sometimes async.** A function should call its callback **always later** or **always now**, never a mix. The `lookup` function below answers at once when the value is cached, and after a timer when it is not. The code after the call then runs in a different order depending on a hidden fact (the cache):

```js
function lookup(key, callback) {
  if (cache.has(key)) return callback(null, cache.get(key)); // cached: the callback runs NOW
  slowLoad(key, callback);                                   // not cached: the callback runs LATER
}
```

```text
--- F: sometimes sync, sometimes async (Zalgo)
F lookup, first call (not cached): callback ran, code after the call had run = true
F lookup, second call (cached): callback ran, code after the call had run = false
F lookupFixed (cached): callback ran, code after the call had run = true
```

Code that reads a variable set after the call works the first time and breaks the second time. Bugs like this are hard to reproduce, and people nicknamed the problem "releasing Zalgo" (after a horror character). The fix, `lookupFixed`, delays the cached answer with `process.nextTick(callback, ...)` so the callback is **always** async (lesson [08](../08-event-loop/README.md) explains `nextTick`). Promises have this rule built in: a `then` callback never runs synchronously (section 8).

> **Interview tip:** "What is callback hell and how do you avoid it?" Name the cause (dependent async steps nest), the symptoms (pyramid, repeated error checks, trust issues) and the cure (promises and `async` / `await`; named functions as a stopgap). Mentioning inversion of control (and the sync-or-async trap above) shows depth.

## 4. Promises: what they are

A **promise** is an object that stands for a result that is not ready yet. Think of the buzzer a restaurant gives you: it is not your food, but it is a thing you can hold now, and it will tell you when the food is ready (or that the kitchen has run out of it).

A promise is always in one of three **states**:

| State | Meaning | Can it change? |
|---|---|---|
| pending | the work is still going on | yes, to fulfilled or rejected |
| fulfilled | the work succeeded; the promise holds a value | no, never again |
| rejected | the work failed; the promise holds a reason (normally an `Error`) | no, never again |

A promise that is fulfilled or rejected is called **settled**. Once settled, it keeps that state and value forever. This "settle once" rule is what fixes the "called twice" problem of callbacks.

File: [examples/03-promises.js](examples/03-promises.js), part 1:

```js
const delay = (ms, value) => new Promise((resolve) => setTimeout(resolve, ms, value));

const p = delay(10, 'hello');
console.log('right after creating it:', p);
p.then((value) => {
  console.log('then received:', value);
  console.log('the same promise now:', p);
});
```

```text
--- 1: states
right after creating it: Promise { <pending> }
then received: hello
the same promise now: Promise { 'hello' }
```

(`delay` is a tiny helper that we explain in section 7.)

> **Interview tip:** Be precise with words. "Fulfilled" means succeeded, "rejected" means failed, "settled" means either of them. People often say "resolved", which can also mean "locked in to follow another promise", so a promise that is "resolved" can still be pending (section 7 shows one). In an interview, say fulfilled / rejected.

## 5. then, catch, finally and chaining

Three methods attach handlers to a promise:

| Method | Runs when | Gets |
|---|---|---|
| `p.then(onFulfilled)` | `p` is fulfilled | the value |
| `p.catch(onRejected)` | `p` is rejected (same as `p.then(undefined, onRejected)`) | the reason |
| `p.finally(onSettled)` | `p` is settled, either way | nothing |

**Every one of them returns a new promise.** That is why you can chain them. And the new promise is decided by what your callback does:

| Your callback ... | The next promise ... |
|---|---|
| returns a plain value | is fulfilled with that value |
| returns nothing | is fulfilled with `undefined` |
| returns a promise | waits for it, then copies its result |
| throws an error | is rejected with that error |

File: [examples/03-promises.js](examples/03-promises.js), parts 2 and 3:

```js
Promise.reject(new Error('it broke'))
  .then(() => console.log('never printed: then is skipped on rejection'))
  .catch((err) => console.log('catch received:', err.message))
  .finally(() => console.log('finally runs in both cases and gets no argument'));

Promise.resolve(1)
  .then((n) => n + 1)                                 // returns a plain value
  .then((n) => { console.log('got', n); return delay(10, n * 10); }) // returns a promise
  .then((n) => { console.log('got', n); })            // returns nothing
  .then((n) => { console.log('got', n); });
```

```text
--- 2: then / catch / finally
catch received: it broke
finally runs in both cases and gets no argument
good fulfilled with 42
--- 3: chaining
got 2 (a plain value was passed on)
got 20 (the chain waited for the returned promise)
got undefined (forgot to return, so the next value is undefined)
```

About `finally`: it receives no argument and its return value is ignored, so it passes the original value (or error) through. If `finally` itself **throws**, that error replaces the result. Use it for cleanup (close a file, stop a spinner), not for transforming values.

> **Common mistake:** forgetting `return` inside a `then`. The next step then receives `undefined`, and a promise you started inside is not waited for. The second beginner mistake is nesting `.then` inside `.then`. That brings back the pyramid. Return the inner promise and keep the chain flat.

Three more `then` gotchas, from part 6 of the same file:

```js
const a = await Promise.resolve('one').then('two');   // a is 'one'
slow.then(console.log('b) wrong: ...'));              // console.log runs NOW
base.then(first);                                     // two separate branches,
base.then(second);                                    // not a chain
```

```text
--- 6: then gotchas
a) Promise.resolve("one").then("two") gives one
b) wrong: this ran at once, not after the promise
b) right: this ran after the promise
c) branch 1 got 10
c) branch 2 got 10
c) branch results: 11 20
```

- **a)** `then` ignores an argument that is not a function and passes the value on. `Promise.resolve('one').then('two').then(console.log)` prints `one`. This is a favourite quiz question.
- **b)** `.then(work())` calls `work` immediately and gives `then` the **result**. Write `.then(work)` or `.then(() => work(arg))`. (The "wrong" line prints before the "right" line even though the promise needs 20 ms.)
- **c)** A chain is `p.then(a).then(b)`: `b` receives what `a` returned. Two `then` calls on the **same** promise are two branches. Both receive `p`'s value, and what branch 1 returns never reaches branch 2 (that is why the results are `11` and `20`).

## 6. Error propagation

A rejection travels down the chain, skipping every `then`, until it meets a `catch`. A `catch` that returns normally **recovers**: the chain is fulfilled again. A throw inside any `then` or `catch` is turned into a rejection.

File: [examples/03-promises.js](examples/03-promises.js), part 4:

```js
Promise.resolve('start')
  .then((v) => { console.log('step 1 got', v); throw new Error('step 2 failed'); })
  .then(() => console.log('step 3 skipped'))
  .then(() => console.log('step 4 skipped'))
  .catch((err) => { console.log('caught:', err.message); return 'recovered'; })
  .then((v) => console.log('step 5 got', v))
  .catch(() => console.log('not reached'));
```

```text
--- 4: error propagation
step 1 got start
caught: step 2 failed
step 5 got recovered
```

Rules:
1. Put a `.catch` at the **end** of every chain you do not return to someone else.
2. To handle an error but keep failing, re-throw it inside the `catch`.
3. Prefer `.then(a).catch(b)` over `.then(a, b)`. In the two-argument form, `b` cannot catch an error thrown by `a`.

```js
Promise.resolve(1)
  .then(() => { throw new Error('in a'); }, () => 'b ran') // b only sees errors from BEFORE this then
  .catch((e) => console.log('escaped to the next catch:', e.message));
```

```text
escaped to the next catch: in a
```

> **Interview tip:** "What does `.catch()` return?" A new promise, like every other promise method. If the `catch` callback returns normally, that promise is **fulfilled**, so the chain carries on as if nothing had failed. To keep failing, re-throw inside the `catch`.

## 7. Creating promises

Most of the time you receive promises from other APIs (`fetch`, `fs.promises`). Sometimes you must make one. File: [examples/04-creating-promises.js](examples/04-creating-promises.js).

**`new Promise((resolve, reject) => { ... })`.** The function you pass is the **executor**. It runs **immediately and synchronously**. Call `resolve(value)` to fulfill and `reject(error)` to reject. If the executor throws, the promise is rejected. Only the first call counts; later calls are ignored.

```js
console.log('1. before new Promise');
const p1 = new Promise((resolve) => {
  console.log('2. inside the executor (runs right now)');
  resolve('done');
});
console.log('3. after new Promise');
```

The `delay` helper from section 4 is exactly this:

```js
const delay = (ms, value) => new Promise((resolve) => setTimeout(resolve, ms, value));
```

(`setTimeout(fn, ms, arg)` passes `arg` to `fn`, so `resolve` receives `value`.)

**Ready-made promises.** `Promise.resolve(value)` gives an already fulfilled promise and `Promise.reject(error)` an already rejected one. `Promise.resolve(p)` returns `p` itself if `p` is already a native promise. Useful to start a chain or to make a function always return a promise.

**Resolving with another promise.** `resolve(somePromise)` does not fulfill with the promise object. The new promise **locks in** to follow `somePromise`. It is already "resolved" (a later `reject` is ignored), but it stays **pending** until `somePromise` settles. This is why the word "resolved" is not the same as "fulfilled" (section 4):

```js
const inner = delay(20, 'inner value');
const outer = new Promise((resolve, reject) => {
  resolve(inner);
  reject(new Error('ignored: already locked in'));
});
console.log('outer right after resolve(inner):', outer);  // Promise { <pending> }
console.log('outer later:', await outer);                  // inner value
```

**`Promise.withResolvers()`** (available from Node 22, because of its V8 version; the examples were run on Node 24) returns `{ promise, resolve, reject }`, so you can settle the promise from outside, for example from an event handler. It replaces the old trick of copying `resolve` out of an executor.

```js
const { promise, resolve } = Promise.withResolvers();
setTimeout(() => resolve('signal received'), 10);
console.log('withResolvers:', await promise); // inside an async function
```

**`Promise.try(fn, ...args)`** calls `fn` right now and gives you a promise, whether `fn` returns a value, returns a promise or throws. It saves you from mixing `try` / `catch` and `.catch` for functions that may fail synchronously. It needs Node 23 or newer (so it works on Node 24, but by its V8 version it is missing on Node 22; check `typeof Promise.try` if you must support Node 22).

**Wrapping a callback function** (this is what `util.promisify` does for you, section 19):

```js
function doubleAsync(n) {
  return new Promise((resolve, reject) => {
    oldStyleDouble(n, (err, result) => {   // oldStyleDouble(n, callback) is error-first
      if (err) reject(err);
      else resolve(result);
    });
  });
}
```

Output of the whole file:

```text
1. before new Promise
2. inside the executor (runs right now)
3. after new Promise
p1: done
p2: first
outer right after resolve(inner): Promise { <pending> }
outer later: inner value
p3: thrown in executor
p4: 7
Promise.resolve(p4) === p4: true
p5: already rejected
withResolvers: signal received
Promise.try (throws): sync throw
Promise.try (returns): sync value
doubleAsync(21): 42
doubleAsync("x"): n must be a number
```

> **Common mistake:** wrapping something that is already a promise in `new Promise(...)` (the "explicit construction anti-pattern", section 22). Use `new Promise` only to wrap **callback or event based** code, never promise based code.

> **Interview tip:** "When does the function inside `new Promise(...)` run?" Immediately and synchronously, before the constructor returns. Only the `then` callbacks are asynchronous. A typical follow-up is "turn this callback API into a promise API": write the wrapper above, or use `util.promisify` (section 19).

## 8. Microtasks vs macrotasks: a small hint

When does a `then` callback run? **Never immediately**, not even if the promise is already fulfilled. It runs after the current synchronous code has finished, and **before** timers. Promise callbacks (and the code after an `await`) go into the **microtask queue**. Timers (`setTimeout`), I/O callbacks and `setImmediate` are **macrotasks**. After the current code ends, Node empties the microtask queue completely, and only then moves on to the next macrotask.

File: [examples/03-promises.js](examples/03-promises.js), part 5:

```js
console.log('1. sync: start');
setTimeout(() => console.log('6. timer callback (a "macrotask")'), 0);
Promise.resolve().then(() => console.log('4. promise callback (a "microtask")'));
(async () => {
  console.log('2. async function: the code before the first await is still sync');
  await null;
  console.log('5. async function: the code after an await is a microtask too');
})();
console.log('3. sync: end');
```

```text
--- 5: then is always async (microtasks run before timers)
1. sync: start
2. async function: the code before the first await is still sync
3. sync: end
4. promise callback (a "microtask")
5. async function: the code after an await is a microtask too
6. timer callback (a "macrotask")
```

One warning: Node empties the microtask queue **completely** before it moves on. A promise callback that keeps scheduling another promise callback forever would stop every timer and all I/O from running, just like an endless loop.

This is only the first taste. Lesson [08](../08-event-loop/README.md) (the event loop) covers the phases in detail, plus `process.nextTick` and `setImmediate`, starvation, and the differences between CommonJS and ES modules.

> **Interview tip:** for "what does this print?" questions, say the rule out loud and then trace the code line by line: all synchronous code first, then every queued microtask (promise callbacks and the code after an `await`) in the order they were queued, then timers and I/O.

## 9. async / await

`async` / `await` is **syntax on top of promises**. It does not add a new kind of async. It lets you write promise code so that it reads like normal top-to-bottom code. File: [examples/05-async-await.js](examples/05-async-await.js).

Four facts to learn by heart:

1. An `async` function **always returns a promise**. A returned value becomes a fulfilled promise; a thrown error becomes a rejected promise.
2. `await promise` pauses **only that function** until the promise settles. It gives you the fulfilled value, or throws the rejection reason.
3. The code before the first `await` runs **synchronously**, when you call the function.
4. `await` is allowed only inside `async` functions (and at the top level of ES modules, section 20).

```js
async function five() { return 5; }
async function broken() { throw new Error('oops'); }

const p = five();
console.log('five() is a promise:', p instanceof Promise);
console.log('await five():', await p);                                   // inside an async function
console.log('await broken() failed with:', await broken().catch((e) => e.message));
```

```js
async function pausing() {
  console.log('B. inside: runs synchronously until the first await');
  await delay(10);
  console.log('D. inside: resumed after the await');
}
console.log('A. before the call');
const p = pausing();
console.log('C. after the call: the caller was NOT paused');
await p;
```

```text
--- 1: async always returns a promise
five() is a promise: true
await five(): 5
await broken() failed with: oops
--- 2: await pauses only this function
A. before the call
B. inside: runs synchronously until the first await
C. after the call: the caller was NOT paused
D. inside: resumed after the await
```

Here is the same logic with `.then` and with `await`. Both do exactly the same thing:

```js
function withThen(id) {
  return fetchUser(id)
    .then((user) => user.name.toUpperCase())
    .catch((err) => 'then-style fallback: ' + err.message);
}

async function withAwait(id) {
  try {
    const user = await fetchUser(id);
    return user.name.toUpperCase();
  } catch (err) {
    return 'await-style fallback: ' + err.message;
  }
}
```

```text
--- 3: .then versus await
USER1
USER1
then-style fallback: user not found: 0
await-style fallback: user not found: 0
```

Good to know:
- `await 5` also works: a non-promise value is treated like an already fulfilled promise. Anything with a `then` method (a "thenable") works too.
- `async` can be put on function declarations, function expressions, arrow functions and methods: `const f = async () => {}`, `class A { async run() {} }`.
- Inside `array.map(async (x) => ...)` each callback returns a promise, so you get an **array of promises**. Pass it to `Promise.all` to wait for them.

> **Under the hood:** each `await` splits your function into pieces. The code after the `await` is put into the microtask queue when the awaited promise settles (section 8). That is also why `await` never blocks the thread: the function gives control back and the rest of the program continues.

## 10. try / catch / finally, and return vs return await

With `await`, a rejected promise becomes a normal thrown error, so ordinary `try` / `catch` / `finally` works. Part 4 of [examples/05-async-await.js](examples/05-async-await.js):

```js
for (const id of [1, 0]) {
  try {
    const user = await fetchUser(id);
    console.log('got', user.name);
  } catch (err) {
    console.log('catch:', err.name, '-', err.message);
  } finally {
    console.log('finally runs in both cases (id ' + id + ')');
  }
}
```

```text
--- 4: try / catch / finally
got user1
finally runs in both cases (id 1)
catch: NotFoundError - user not found: 0
finally runs in both cases (id 0)
```

### return vs return await

Inside an `async` function, `return promise` and `return await promise` give the caller the same result. They are **not the same inside `try`**:

- `return promise` leaves the `try` block immediately with a pending promise. A `catch` in this function never sees its failure, and `finally` runs **before** the promise settles.
- `return await promise` waits inside the `try` block. The `catch` can handle the failure and `finally` runs after the work is done.

Part 5 of the example makes the damage visible with a fake connection that must stay open until the query finishes:

```js
async function queryWithoutAwait(conn) {
  try {
    return conn.query();      // BUG: leaves the try block with a pending promise
  } finally {
    conn.close();             // runs NOW, before the query is done
  }
}

async function queryWithAwait(conn) {
  try {
    return await conn.query(); // waits inside the try block
  } finally {
    conn.close();              // runs after the query is done
  }
}
```

```text
--- 5: return vs return await
without await: FAILED: connection was closed before the query finished
with await   : rows
```

A second small benefit: with `return await`, the function shows up in the async stack trace, which makes debugging easier. Outside of `try` blocks the two forms behave the same, and many style guides allow plain `return promise` there.

> **Interview tip:** "What is the difference between `return` and `return await` in an async function?" Answer: the result is the same, but inside `try` / `catch` / `finally` only `return await` lets the `catch` see the error and delays the `finally` until the promise has settled.

## 11. Error handling patterns for async code

Part 6 of [examples/05-async-await.js](examples/05-async-await.js) shows four patterns you will use every day.

**a) Catch only what you can handle. Re-throw the rest.**

```js
async function userOrNull(id) {
  try {
    return await fetchUser(id);
  } catch (err) {
    if (err instanceof NotFoundError) return null; // expected case: "no such user" is normal
    throw err;                                      // unknown problem: do not hide it
  }
}
```

**b) Wrap with context, and keep the original as `cause`.** Every layer can say what it was doing, and nothing is lost:

```js
async function loadProfile(id) {
  try {
    return await fetchUser(id);
  } catch (err) {
    throw new Error('could not load profile ' + id, { cause: err });
  }
}
```

**c) The `[error, value]` helper.** Some teams like Go-style code that never throws. It avoids a `try` block per call, but you must remember to check the error:

```js
async function to(promise) {
  try { return [null, await promise]; } catch (err) { return [err, undefined]; }
}
const [err, user] = await to(fetchUser(0));
```

**d) One boundary at the top.** Catch everything that escapes, report it once, and set the exit code:

```js
main().catch((err) => {
  console.error('fatal:', err);
  process.exitCode = 1;
});
```

```text
--- 6: error handling patterns
a) missing user gives: null
b) message: could not load profile 0
b) cause  : NotFoundError - user not found: 0
c) err: user not found: 0 | user: undefined
c) err: null | user: user2
```

Guidelines:
- Do not wrap every `await` in its own `try`. Catch where you can do something useful (retry, fall back, add context, respond to the user).
- Use `finally` for cleanup (close files, release connections, clear timers).
- Never write an empty `catch {}`. If you really mean to ignore an error, write a comment that says why.
- Throw `Error` objects (or subclasses), never strings. Strings have no stack trace and Node reports them in a confusing way (section 12).
- Log an error **once**, at the place that handles it, not at every layer that re-throws it.

## 12. Unhandled rejections: what Node does by default

A rejected promise that nobody handles is a bug that would otherwise be silent. So Node watches for it: once the current microtasks have run (section 8), every rejected promise that still has no handler is reported. On Node 24 the default mode is `throw`: the rejection is raised as an uncaught exception, Node prints the error and the process **exits with code 1**. Timers that were still waiting never run.

File: [examples/12-mistakes-and-unhandled.js](examples/12-mistakes-and-unhandled.js). The crashing cases run in child processes (separate Node processes started by the example), so the example itself survives. The last part of its output:

```text
--- 5, 6 and the default behaviour (each case runs in its own child process)
5a floating async call           exit 1 | Error: boom | stdout: -
5b rejected with a string        exit 1 | UnhandledPromiseRejection: This error originated either  | stdout: -
5c handler attached too late     exit 1 | Error: boom | stdout: -
5d catch attached at once        exit 0 | (nothing on stderr) | stdout: caught boom
6a throw inside setTimeout       exit 1 | Error: boom | stdout: -
6b fix: reject from the timer    exit 0 | (nothing on stderr) | stdout: caught boom
6c async executor                exit 1 | Error: boom | stdout: -
6d async event listener          exit 1 | Error: boom | stdout: -
6e fix: captureRejections        exit 0 | (nothing on stderr) | stdout: error event got: boom / timer ran

Changing the default behaviour:
process.on('unhandledRejection')   exit 0 | stdout: handler got: boom / timer ran
--unhandled-rejections=warn        exit 0 | UnhandledPromiseRejectionWarning: Error: boom | stdout: timer ran
--unhandled-rejections=strict      exit 1 | Error: boom
```

What each line teaches:
- **5a** An `async` function that throws, called without `await` or `.catch`, crashes the process. No other timer runs afterwards (`timer ran` never appears).
- **5b** Rejecting with a non-`Error` value (here a string) is reported as `UnhandledPromiseRejection` with the code `ERR_UNHANDLED_REJECTION`. Always reject with an `Error`.
- **5c** Attaching the `.catch` **later**, in another turn of the event loop, is too late. Node already decided that the rejection was unhandled. Handlers must be attached in the same synchronous run, or at least before the microtask queue empties (**5d** works; a handler attached inside a microtask or a `process.nextTick` callback is still in time, one attached in `setImmediate` or `setTimeout` is not, checked on Node 24.16).
- **6a, 6c, 6d and 6e** are different problems (a throw in a callback, an `async` executor, an `async` event listener and its fix) and are covered in section 22.
- A `process.on('unhandledRejection', (reason, promise) => ...)` handler turns the crash into a callback. The process keeps running (exit code 0 here). If a `.catch` is attached to that promise after the event, Node emits one more event, `rejectionHandled`.

The `--unhandled-rejections=<mode>` flag selects the behaviour:

| Mode | What happens | Exit code (checked on Node 24.16) |
|---|---|---|
| `throw` (default) | emit `unhandledRejection`; if there is no handler for it, raise the rejection as an uncaught exception | 1 (0 if you registered a handler) |
| `strict` | raise as an uncaught exception at once; `unhandledRejection` is emitted only if that exception gets handled (even a registered `unhandledRejection` handler does not prevent the crash) | 1 |
| `warn` | always print a warning, even if you registered a handler (the handler runs too); keep running | 0 |
| `warn-with-error-code` | emit `unhandledRejection`; if there is no handler, print a warning and set the exit code to 1 | 1 (0 if you registered a handler) |
| `none` | print nothing and keep running (a registered handler still runs) | 0 |

The exit codes were run on Node 24.16 with and without a handler. The mode names and wording follow the Node CLI documentation (`--unhandled-rejections=mode`), which also says that `throw` became the default in Node 15 (before that, a warning was printed).

> **Remember:** the `unhandledRejection` event is a **safety net** for logging and a clean shutdown, not a place to "fix" the problem. After a bug like this your program is in an unknown state. Log it, close resources, and exit (let a process manager, a tool such as pm2 or systemd that restarts crashed apps, start you again). The right fix is always to attach a handler or `await` the promise.

If you also register `process.on('uncaughtException', ...)`, an unhandled rejection in the default mode is routed to that handler with `origin` set to `'unhandledRejection'`.

> **Interview tip:** "What happens when a promise rejects and nobody catches it?" Strong answer: on modern Node (15 and newer) the default is to throw: the process prints the error and exits with code 1; in older versions it only printed a warning. You can observe it with `process.on('unhandledRejection')`, and a handler attached too late still counts as unhandled.

## 13. Sequential vs parallel awaiting (the biggest beginner mistake)

Each `await` in a row waits for the previous one to finish, even if the calls do not depend on each other. Three independent 200 ms calls then take 600 ms instead of 200 ms.

File: [examples/06-sequential-vs-parallel.js](examples/06-sequential-vs-parallel.js). Every fake call takes 200 ms:

```js
// SLOW: 600 ms. Each call starts only after the previous one finished.
const a = await fetchThing('a');
const b = await fetchThing('b');
const c = await fetchThing('c');

// FAST: 200 ms. All three calls start now; we wait for all of them.
const [a2, b2, c2] = await Promise.all([fetchThing('a'), fetchThing('b'), fetchThing('c')]);

// ALSO FAST: start now, await later. The work starts when the function is CALLED.
const pa = fetchThing('a');
const pb = fetchThing('b');
const pc = fetchThing('c');
const result = [await pa, await pb, await pc];
```

```text
1. sequential awaits               took about 600 ms -> [ 'a', 'b', 'c' ]
2. Promise.all                     took about 200 ms -> [ 'a', 'b', 'c' ]
3. start now, await later          took about 200 ms -> [ 'a', 'b', 'c' ]
4. dependent + independent         took about 400 ms -> [ 'orders of user', 'settings' ]
5. for...of with await             took about 600 ms -> [ 'item1', 'item2', 'item3' ]
6. Promise.all(ids.map(...))       took about 200 ms -> [ 'item1', 'item2', 'item3' ]
7. results (input order): [ 'slow', 'fast', 'medium' ]
   finish order         : [ 'fast', 'medium', 'slow' ]
```

(The example rounds the times down to a multiple of 200 ms, because real timers are a few milliseconds late: on Windows, three 100 ms waits in a row were measured at 310 to 372 ms. Timing numbers differ between machines and operating systems, so never rely on exact values.)

The rule: **work starts when you call the function, not when you await it.** `await` only decides when you *wait*. So:
- Steps that **depend** on each other must be sequential (line 4: `orders` needs `user`).
- Steps that are **independent** should be started together and awaited together (lines 2, 3, 6).
- Mixed case (line 4): start the independent promises early, then `await` them when you need them.

Line 7 shows that `Promise.all` returns results in the **input order**, not in the order in which the promises finished.

> **Interview tip:** shown three `await` lines in a row, interviewers ask "what is slow here?". Strong answer: the calls do not depend on each other, but they run one after another, so the times add up (600 ms instead of 200 ms). Start them together with `Promise.all`. Keep sequential awaits only for dependent steps or when you must respect a rate limit.

> **Common mistake:** "start now, await later" has a trap. If a promise you started rejects **while you are still awaiting another one**, nobody has a handler on it yet, and Node crashes with an unhandled rejection (section 12) even though you would have awaited it a moment later:
>
> ```js
> const delay = (ms, value) => new Promise((resolve) => setTimeout(resolve, ms, value));
>
> async function main() {
>   const slow = delay(100, 'slow');
>   const failing = delay(10).then(() => { throw new Error('failing task failed'); });
>   await slow;     // we are waiting here when "failing" rejects with no handler yet
>   await failing;  // never reached
> }
> main();
> ```
>
> Running this on Node 24.16 prints the error (`Error: failing task failed`, with a stack trace) and exits with code 1. The `try` / `catch` you might have put around `await failing` would not help, because the crash happens before that line is reached.
>
> `Promise.all` and `Promise.allSettled` attach their handlers at once, so they do not have this problem. Use them when you start several promises together.

### await inside loops

A loop is where this mistake hides best. Lines 5 and 6 of the output above compare the two forms for `ids = [1, 2, 3]`:

```js
// sequential: one after another (600 ms)
for (const id of ids) {
  out.push(await fetchThing('item' + id));
}

// parallel: all at once (200 ms)
const results = await Promise.all(ids.map((id) => fetchThing('item' + id)));
```

Use `for...of` with `await` when order or dependency matters, when each step needs the previous result, or when you must go slowly on purpose (a rate limit). Use `map` + `Promise.all` when the items are independent. (Before `async` / `await`, sequential work was written as `tasks.reduce((chain, task) => chain.then(task), Promise.resolve())`. You will meet it in old code and in quiz questions; `for...of` is easier to read.) Two warnings:
- `array.forEach(async ...)` does **not** wait (section 22).
- `Promise.all(hugeArray.map(...))` starts everything at the same moment. With 10,000 items that can exhaust sockets, database connections or an API's rate limit. For that you need a concurrency limit (section 15).

## 14. The combinators: all, allSettled, race, any

Four static methods take an iterable of promises (plain values are allowed too) and return **one** promise. They differ in when they fulfill and when they reject. File: [examples/07-combinators.js](examples/07-combinators.js).

| | `Promise.all` | `Promise.allSettled` | `Promise.race` | `Promise.any` |
|---|---|---|---|---|
| Fulfills when | all fulfill | all have settled (it **always** fulfills) | the first promise to settle fulfills | the first promise to fulfill |
| Fulfilled value | array of values, in input order | array of `{ status, value }` or `{ status, reason }` | the winner's value | the winner's value |
| Rejects when | the **first** rejection | never | the first promise to settle rejects | **all** reject |
| Rejection value | that first reason | - | that reason | `AggregateError` (the reasons are in `err.errors`) |
| Empty array | fulfills with `[]` | fulfills with `[]` | stays **pending forever** | rejects with an empty `AggregateError` |
| Typical use | "I need all of these" | "do all, report each result" | timeouts, "first answer" | "first success wins" (mirrors, fallbacks) |

```text
--- Promise.all: all must succeed
all, everyone succeeds         fulfilled -> [ 'a', 'b', 'c' ]
all, one fails                 rejected  -> b failed

--- losers keep running
all rejects at 10 ms           rejected  -> b failed
slow task finished yet?        false
slow task finished later?      true

--- later failures are ignored, not unhandled
all, two failures              rejected  -> first failed
still alive after the second failure

--- Promise.allSettled: wait for everyone, never rejects
[{"status":"fulfilled","value":"a"},{"status":"rejected","reason":"b failed"},{"status":"fulfilled","value":"c"}]

--- Promise.race: the first to SETTLE wins (success or failure)
race, fast success             fulfilled -> fast
race, fast failure             rejected  -> fast failed

--- Promise.any: the first to FULFILL wins (failures are ignored)
any, fast failure ignored      fulfilled -> slow
any, everyone fails            rejected  -> AggregateError [ 'x failed', 'y failed' ]

--- extras
plain values are allowed       fulfilled -> [ 1, 2, 3 ]
all([])                        fulfilled -> []
allSettled([])                 fulfilled -> []
any([])                        rejected  -> AggregateError []
race([]) still pending?        true
```

Things to notice:
- `Promise.all` rejected at 10 ms, but the slow task was **not cancelled**. It finished later. The combinators only decide what *you* wait for. The other work keeps running. (Real cancellation is section 18.)
- `Promise.race` cares about the first **settled** promise, even a failure. `Promise.any` ignores failures until all of them have failed.
- `Promise.all` attaches a handler to **every** input. After it has rejected once, a later failure of another input is silently dropped. It does not crash the process as an unhandled rejection (the "later failures" lines above). If you need to know about every failure, use `allSettled`.
- `Promise.race([])` never settles. If a list can be empty, handle that before calling it.
- For "give me whatever you managed to load" use `allSettled`, then filter on `status`.

> **Interview tip:** The classic question is "`all` vs `allSettled` vs `race` vs `any`". Answer with the table's two columns: "when does it fulfill, when does it reject". Then add the follow-ups: input order is preserved, losers are not cancelled, `any` gives an `AggregateError`.

## 15. Limiting concurrency (a pool of N)

`Promise.all(items.map(...))` starts everything at once. Real systems have limits: a database pool of 10 connections, an API that allows 5 requests at a time, a file-descriptor limit. You want "run at most N at the same time, and as soon as one finishes, start the next".

The idea: start N **workers**. Each worker is a loop that takes the next item nobody has taken yet, processes it, and repeats until the list is empty. File: [examples/08-limit-and-retry.js](examples/08-limit-and-retry.js).

```js
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;              // index of the next item nobody has taken yet
  let failed = false;

  async function worker() {
    while (!failed && next < items.length) {
      const index = next++;  // no await between reading and incrementing, so two workers never take the same item
      try {
        results[index] = await fn(items[index], index);
      } catch (err) {
        failed = true;       // tell the other workers to stop taking new items
        throw err;
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  await Promise.all(workers);
  return results;            // same order as `items`
}
```

Why `next++` is safe: JavaScript runs one piece of code at a time. Between `next < items.length` and `next++` there is no `await`, so no other worker can run in between.

Running 8 tasks of 200 ms each with a limit of 3 (part 1 of the example):

```text
--- Part 1: pool of 3 workers for 8 tasks (each takes 200 ms)
results (input order): 0 1 4 9 16 25 36 49
start order          : 0 1 2 3 4 5 6 7
max running at once  : 3
took about           : 600 ms (3 rounds of 200 ms; with no limit it would be 200 ms)
pool rejected with: task 2 failed
items that were started before the failure stopped the pool: [ 1, 2, 3 ]
```

- Never more than 3 tasks ran at the same time. 8 tasks in rounds of 3 take 3 rounds.
- The results are in input order, even though tasks finish in a different order.
- When task 2 failed, the pool stopped taking new items. Tasks already started (item 3 had just begun) are not cancelled.
- To make the pool cancellable, accept a `signal`, call `signal?.throwIfAborted()` at the top of the worker loop and pass the signal on to `fn` (sections 17 and 18), so tasks that are already running can stop too.

A simpler idea, "split the list into chunks of N and run `Promise.all` on each chunk", also limits concurrency, but it is slower: each chunk waits for its slowest task before the next chunk starts. A pool keeps N tasks busy all the time. In real projects people often use a small library for this (`p-limit` and `p-queue` are well known), but the interview version is the one above.

## 16. Retry with exponential backoff

Networks fail in small, temporary ways. Retrying often fixes it. But retrying **immediately** can make a struggling server worse, so we wait between attempts, and we wait **longer each time**: 10 ms, 20 ms, 40 ms ... This is **exponential backoff**. File: [examples/08-limit-and-retry.js](examples/08-limit-and-retry.js), part 2:

```js
async function retry(fn, options = {}) {
  const { retries = 3, baseMs = 10, factor = 2, maxMs = 1000, jitter = false, shouldRetry = () => true, onRetry } = options;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err;   // out of retries, or not worth retrying
      let wait = Math.min(maxMs, baseMs * factor ** attempt);   // 10, 20, 40, ... capped at maxMs
      if (jitter) wait = Math.random() * wait;                  // "full jitter"
      if (onRetry) onRetry(err, attempt + 1, wait);
      await delay(wait);
    }
  }
}
```

```text
--- Part 2: retry with exponential backoff (base 10 ms)
fails twice, then works:
  retry 1 after "temporary failure #1", waiting 10 ms
  retry 2 after "temporary failure #2", waiting 20 ms
  success on call 3
always fails, 3 retries allowed (4 calls in total):
  retry 1 after "temporary failure #1", waiting 10 ms
  retry 2 after "temporary failure #2", waiting 20 ms
  retry 3 after "temporary failure #3", waiting 40 ms
  gave up with: temporary failure #4
a validation error is not worth retrying:
  gave up at once with: bad input
the cap (maxMs) keeps waits from growing forever:
  retry 1 after "temporary failure #1", waiting 10 ms
  retry 2 after "temporary failure #2", waiting 20 ms
  retry 3 after "temporary failure #3", waiting 25 ms
  retry 4 after "temporary failure #4", waiting 25 ms
```

The details interviewers look for:
- **Retries vs attempts:** `retries: 3` means 1 first try + 3 retries = 4 calls.
- **Cap (`maxMs`):** without it the wait grows without limit (2 to the power of attempt).
- **Jitter:** add randomness (`Math.random() * wait`) so that 1,000 clients that failed together do not all retry at the same moment ("thundering herd"). The example keeps jitter off so the output is predictable.
- **Retry only transient errors:** network timeouts, `503`, `429`. Never retry bad input (`400`), wrong password or "not found". That is what `shouldRetry` is for.
- **Be careful with side effects:** retrying "charge the card" can charge twice unless the operation is **idempotent** (safe to repeat, for example by sending an idempotency key).
- Combine with a timeout (next section) so that one attempt cannot hang for ever.

## 17. Timeouts: Promise.race and AbortSignal.timeout

A promise that never settles blocks whoever awaits it. A timeout means "stop waiting after N ms". File: [examples/09-timeout-and-abort.js](examples/09-timeout-and-abort.js).

**Way 1: `Promise.race` with a timer.**

```js
function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  // clearTimeout in finally: otherwise the pending timer keeps the process alive until it fires.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
```

```text
--- 1: timeout wrapper with Promise.race
fast work : result
slow work : slow work timed out after 20 ms
slow work is still running? finished = false
...and it did finish later: finished = true (the timeout did not stop it)
```

Two lessons: (1) the timeout only stops **waiting**; the slow work carries on in the background. (2) Always clear the timer. A small check on Node 24: a `race` whose 1.5 second timer was never cleared kept an otherwise finished process alive for the whole 1.5 seconds.

**Way 2: `AbortSignal.timeout(ms)`.** It creates a signal that aborts by itself after `ms`. APIs that accept a `signal` (`fetch`, `timers/promises`, `events.once`, `fs` promises, ...) then stop for real. The example starts a tiny local HTTP server whose `/slow` route answers after 300 ms:

```js
const fast = await fetch(base + '/fast', { signal: AbortSignal.timeout(500) });
await fetch(base + '/slow', { signal: AbortSignal.timeout(50) }); // rejects after about 50 ms
```

```text
--- 2: AbortSignal.timeout
timers/promises sleep: AbortError | cause: TimeoutError
fetch /fast : hello from /fast
fetch /slow : TimeoutError - The operation was aborted due to timeout
```

Note the two error shapes: `fetch` rejects with an error named `TimeoutError`; the `timers/promises` functions reject with an `AbortError` whose `cause` is the `TimeoutError`. When you handle errors, check `err.name` (and `err.cause?.name`).

> **Common mistake:** the timer behind `AbortSignal.timeout()` does **not** keep the process alive. If the only thing left waiting is a promise guarded by that signal (for example `events.once(emitter, 'x', { signal: AbortSignal.timeout(50) })`), Node sees nothing to do and simply exits with code 0, silently, before your `catch` ever runs. In real programs a socket or server usually keeps the process alive, so you rarely notice. If you must wait on something with no other work pending, use a normal `setTimeout` plus an `AbortController`.

## 18. Cancellation with AbortController

A promise itself **cannot be cancelled**. Cancellation is **cooperative**: you create an `AbortController`, give its `signal` to the work, and the work agrees to stop when the signal aborts. File: [examples/09-timeout-and-abort.js](examples/09-timeout-and-abort.js), parts 3 and 4.

- `controller.abort(reason?)` sets `signal.aborted = true`, stores `signal.reason` and fires an `'abort'` event on the signal. The default reason is an `AbortError`.
- `signal.throwIfAborted()` throws the reason if the signal has already aborted. Use it between units of work.

Writing your own cancellable function means: check `signal.aborted` first, listen for `'abort'`, stop the real work (here `clearTimeout`), reject with `signal.reason`, and remove the listener when you finish normally:

```js
function cancellableSleep(ms, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);        // cancelled before we started
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve('slept ' + ms + ' ms');
    }, ms);
    function onAbort() {
      clearTimeout(timer);                                    // really stop the work
      reject(signal.reason);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
```

```text
--- 3: AbortController
cancelled sleep: AbortError - This operation was aborted
signal.aborted is now: true
custom reason: user pressed cancel
processItems stopped early with: AbortError
```

`processItems` is a loop that calls `signal.throwIfAborted()` before each item, so an abort in the middle stops it at the next item. Any value can be the reason (`controller.abort('user pressed cancel')`).

**`AbortSignal.any([a, b])`** makes one signal that aborts when **any** of them does. It is the clean way to combine a "Cancel" button with a timeout. The reason tells you which one happened:

```text
--- 4: AbortSignal.any (cancel button + timeout)
stopped because of: TimeoutError (a timeout, the user did not click)
stopped because of: AbortError (the user clicked cancel)
```

> **Interview tip:** "How do you cancel a promise?" Strong answer: you cannot cancel the promise object, you cancel the **work** behind it. Pass an `AbortSignal` into the operation (`fetch`, streams, your own code), and make the operation stop and reject when it aborts. A timeout that only uses `Promise.race` stops waiting, but the work keeps running and keeps using resources.

### Putting it together: retry, a timeout per attempt, and cancel

Senior interviewers like the combined question: "retry a flaky call, but never let one attempt hang, and let the user cancel the whole thing". The pieces are the ones you already know. Part 5 of [examples/09-timeout-and-abort.js](examples/09-timeout-and-abort.js):

```js
async function retryWithSignal(task, { retries = 2, baseMs = 10, attemptMs = 30, signal } = {}) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();                                    // cancelled before this attempt?
    const timeout = AbortSignal.timeout(attemptMs);              // a fresh timeout for every attempt
    const attemptSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      return await task(attemptSignal, attempt);                 // the task must obey the signal
    } catch (err) {
      if (signal?.aborted || attempt >= retries) throw err;      // cancelled by the caller, or out of retries
      const wait = baseMs * 2 ** attempt;
      console.log(`  attempt ${attempt + 1} failed (${err.cause?.name ?? err.name}), waiting ${wait} ms`);
      await sleep(wait, undefined, { signal });                  // the backoff wait stops on cancel too
    }
  }
}
```

```text
--- 5: retry + timeout per attempt + cancel
  attempt 1 failed (TimeoutError), waiting 10 ms
ok on attempt 2
  attempt 1 failed (TimeoutError), waiting 10 ms
  attempt 2 failed (TimeoutError), waiting 20 ms
gave up: AbortError | cause: TimeoutError
  attempt 1 failed (TimeoutError), waiting 10 ms
cancelled: AbortError | cause: AbortError
```

How to read it:
- Attempt 1 of `flaky` hangs. Its own 30 ms timeout aborts it, the function waits 10 ms and tries again, and attempt 2 works.
- `alwaysHangs` times out three times (the first try plus 2 retries), so the last error is thrown.
- In the last case the caller aborts at 55 ms, while attempt 2 is running. The error is a plain `AbortError`, and the loop stops at once instead of retrying. That is why the check `signal?.aborted` comes **before** the retry.
- A timeout (`TimeoutError`) is worth retrying. A cancel (`AbortError` from the caller) is not.

> **Interview tip:** the strong answer names three separate things: a **timeout per attempt** (so one attempt cannot hang), **backoff between attempts** (so you do not hammer a struggling server), and **one signal for the whole job** (so the caller can cancel the attempt and the waiting).

## 19. Node helpers: promisify, callbackify, timers/promises, events.once

Node has a lot of older callback APIs and some event based ones. These helpers connect them to promises. File: [examples/10-node-helpers.js](examples/10-node-helpers.js).

| You have | You want | Use |
|---|---|---|
| an error-first callback function | a promise function | `util.promisify(fn)` |
| an `async` function | a callback function (for old code) | `util.callbackify(fn)` |
| `setTimeout` / `setImmediate` / `setInterval` | promises | `require('node:timers/promises')` |
| an emitter, wait for one event | a promise | `events.once(emitter, 'name')` |
| an emitter, many events in a loop | an async iterator | `events.on(emitter, 'name')` (section 21) |
| `fs`, `dns`, `readline`, `stream` | promise versions | `node:fs/promises`, `node:dns/promises`, `node:readline/promises`, `node:stream/promises` |

**`util.promisify`** only works for functions that take an error-first callback as the **last** argument. Many core functions already have a promise version (`fs.promises.readFile`), so you mostly use `promisify` for older modules and libraries:

```js
const readFile = util.promisify(fs.readFile);
const text = await readFile(__filename, 'utf8');
await readFile(__dirname + '/does-not-exist.txt').catch((err) => console.log('missing file ->', err.code));
```

Gotchas the example shows:
- **A method loses `this`** when you promisify it on its own. Use `util.promisify(db.get.bind(db))`. Without `bind`, the call throws a `TypeError` inside the executor and you get a rejected promise.
- Some functions have a **custom** promisified version that Node picks automatically. `util.promisify(setTimeout)` is one: it returns the second argument as the value.
- A callback with **two success values** loses the second one by default (`callback(null, a, b)` gives only `a`). Define `fn[util.promisify.custom]` to decide the shape.

> **Interview tip:** "Write `promisify` yourself." Return a function that returns `new Promise`, call the original with your own error-first callback (`reject` on `err`, `resolve` otherwise), and forward `this`. Task 2 at the end of the lesson is exactly this. Mention that Node's version also handles custom promisified functions.

```text
--- 1: util.promisify
read some text with promisify(fs.readFile)
missing file -> ENOENT
detached: TypeError
bound   : db:a
promisify(setTimeout) resolves with the 2nd argument: woke up
default promisify keeps one value: first
custom promisify keeps both      : [ 'first', 'second' ]
```

**`util.callbackify`** goes the other way. Its gotcha: if the promise rejects with a **falsy** reason (`null`, `0`, `''`), the callback would receive a falsy error and look like a success, so Node wraps it in an `Error` with the code `ERR_FALSY_VALUE_REJECTION` and the original value in `err.reason`.

```text
--- 2: util.callbackify
callbackify success: err = null result = 42
callbackify failure: err = negative result = undefined
rejected with null -> ERR_FALSY_VALUE_REJECTION | original reason: null
```

**`timers/promises`.** `setTimeout(ms, value, { signal })` and `setImmediate(value)` return promises. `setInterval(ms, value)` returns an **async iterator**: one loop turn per tick, and `break` stops it.

```js
const value = await timersPromises.setTimeout(10, 'value after 10 ms');
for await (const label of timersPromises.setInterval(10, 'tick')) {
  ticks++;
  console.log(label, ticks);
  if (ticks === 3) break;
}
```

**`events.once(emitter, name)`** returns a promise for the **next** time the event fires. It is fulfilled with an **array** of the event's arguments, it rejects if the emitter emits `'error'` while you wait, and it accepts a `signal`.

```js
setTimeout(() => emitter.emit('ready', 'db', 5432), 10);
const args = await once(emitter, 'ready'); // [ 'db', 5432 ]
```

```text
--- 3: timers/promises
value after 10 ms
value from setImmediate
tick 1
tick 2
tick 3

--- 4: events.once
ready event arguments: [ 'db', 5432 ]
once rejected with: connection lost
once with a signal: AbortError
event emitted before once(): never arrived
```

The last line is the gotcha: **start listening before the event can happen.** An event that already fired is gone, so `once` called afterwards waits for a second one that never comes.

## 20. Top-level await

In an **ES module** you can use `await` directly at the top level of the file, outside any function. The module is not "finished loading" until the awaited promise settles, and modules that import it wait for it. File: [examples/11-async-iterators.mjs](examples/11-async-iterators.mjs):

```js
import { setTimeout as delay } from 'node:timers/promises';

const config = await delay(10, { port: 3000 });
console.log('config loaded before the next line runs:', config);
```

```text
--- 1: top-level await
config loaded before the next line runs: { port: 3000 }
```

Rules and gotchas (all checked on Node 24.16):
- It works only in **ES modules**: a `.mjs` file, or a `.js` file in a package with `"type": "module"`. Why: ES modules are loaded asynchronously, so the loader can wait for you. `require()` in CommonJS is synchronous and cannot wait. In a CommonJS file such as a `.cjs` file it is a `SyntaxError: await is only valid in async functions and the top level bodies of modules`.
- A plain `.js` file with no `"type"` setting that uses `await` at the top level (and no `require`) is detected as an ES module by Node 24 and runs. That detection needs Node 22.7 or newer (or 20.19+). It is convenient but easy to misread. When the nearest `package.json` has no `"type"` field (like this repo's), Node 24.16 also prints a `MODULE_TYPELESS_PACKAGE_JSON` warning on stderr and parses the file a second time. So prefer `.mjs` or `"type": "module"`, so everybody can see the module format.
- If the same file uses both `require` and top-level `await`, Node refuses: "Cannot determine intended module format because both 'require' and top-level await are present".
- A top-level `await` on a promise that **never settles** does not hang: Node notices that nothing is left to wait for, prints `Warning: Detected unsettled top-level await at ...` and exits with code **13**.
- A module graph that contains top-level `await` cannot be loaded with `require()`; that fails with `ERR_REQUIRE_ASYNC_MODULE`.
- In a CommonJS file, wrap your code in an `async` function instead: `async function main() { ... } main().catch(...)`.

> **Interview tip:** "Can you use `await` outside a function?" Strong answer: yes, at the top level of an ES module (not in CommonJS, where you wrap the code in an `async` function). The module finishes loading only when the awaited promise settles, and a never-settling one makes Node exit with code 13.

## 21. Async iterators, async generators and for await...of

Sometimes values do not arrive all at once: lines of a big file, pages of an API, chunks of a stream, messages from a socket. An **async iterable** hands out values one at a time, and each value may take time. You read it with **`for await...of`**, which is the `for...of` loop you know, except that it waits for each value. The easiest way to write one is an **async generator**: a function written as `async function*`, which can use both `await` and `yield` (`yield` hands one value to the loop and pauses the generator until the loop asks for the next one).

```js
async function* countdown(from) {
  for (let n = from; n >= 1; n--) {
    await delay(5);
    yield n;
  }
  return 'liftoff'; // a return value is NOT seen by for await...of
}

for await (const n of countdown(3)) {
  console.log('got', n);
}
```

The full output of [examples/11-async-iterators.mjs](examples/11-async-iterators.mjs):

```text
--- 1: top-level await
config loaded before the next line runs: { port: 3000 }

--- 2: async generator + for await...of
got 3
got 2
got 1

--- 3: pull-based (the slow consumer sets the pace)
  producing 1
  consumed 1
  producing 2
  consumed 2
  producing 3
  consumed 3

--- 4: paging, with an early break
  (page 1 fetched)
item a
item b
  (page 2 fetched)
item c
  cleanup ran (connection closed)

--- 5: for await over an array of promises
value slow-1
value fast-2
value plain-3

--- 6: streams are async iterable
chunks: [ 'x', 'y', 'z' ]

--- 7: events.on
message: hello
message: world

--- 8: Array.fromAsync
[ 3, 2, 1 ]

--- 9: the protocol, by hand
range value 1
range value 2
range value 3

all done
```

What to take from it:
- **Pull-based (3).** The generator code runs only when the loop asks for the next value. Producer and consumer take turns, so a slow consumer automatically slows the producer down. This is the idea behind **backpressure** (the receiver telling the sender to slow down) in streams, see lesson [11](../11-streams/README.md).
- **Early exit runs cleanup (4).** When you `break` (or `return`, or throw) out of the loop, JavaScript calls the generator's `return()`, so its `finally` block runs. Put cleanup (close connection, release lock) in `finally`.
- **Arrays of promises (5).** `for await` also accepts a normal iterable and awaits each element in turn. Careful: all those promises are already running, so this has the same trap as "start now, await later" in section 13. If a later promise rejects while the loop is still waiting for an earlier one, the process crashes with an unhandled rejection (checked on Node 24.16).
- **Streams and events (6, 7).** Node `Readable` streams are async iterable, and `events.on(emitter, name, { close: [...] })` turns repeated events into an async iterator.
- **`Array.fromAsync` (8)** collects an async iterable into an array.
- **The protocol (9).** An async iterable is an object with a `[Symbol.asyncIterator]()` method that returns an object with `next()`. Each `next()` returns a **promise** of `{ value, done }`. `for await` just calls `next()` again and again until `done` is true.

> **Remember:** `for await` handles values **one at a time, in order**. If you want items processed in parallel, collect them first (`Array.fromAsync`) and use `Promise.all` or the pool from section 15.

> **Interview tip:** "What is the difference between `for...of` and `for await...of`?" Strong answer: `for await` works on async iterables (objects with `[Symbol.asyncIterator]`) and awaits each `next()` promise, so the producer can take time between values. It is pull-based, so a slow consumer slows the producer, and `break` runs the generator's `finally` for cleanup. The loop can only be used inside an `async` function or at the top level of an ES module.

## 22. Common mistakes (and their fixes)

File: [examples/12-mistakes-and-unhandled.js](examples/12-mistakes-and-unhandled.js). The first half of its output shows four mistakes with their fixes:

```text
--- 1: forgetting await
wrong : Promise { <pending> } | name.toUpperCase is undefined
right : ALICE
wrong : "admin" branch ran, because a Promise is truthy
right : not an admin

--- 2: async function inside forEach
wrong : right after forEach, done = []
        later,               done = [ 1, 2, 3 ]
right : for...of waits (one by one), done = [ 1, 2, 3 ]
right : Promise.all + map waits (in parallel), done = [ 1, 2, 3 ]

--- 3: new Promise wrapper anti-pattern
wrapper : Alice
direct  : Alice

--- 4: swallowing errors
  (logged and forgotten): config file is missing
wrong : the real problem is gone, we only see: Cannot read properties of undefined (reading 'port')
right : cannot start: config file is missing
```

**1. Forgetting `await`.** You get a `Promise` instead of the value, so `name.toUpperCase` is `undefined`. Worse: `if (isAdmin())` is **always true**, because a Promise object is truthy. This bug passes code review easily. Fix: `if (await isAdmin())`.

**2. An `async` callback in `forEach` (or `filter`, `some`, `reduce`).** `forEach` ignores the promises its callback returns, so it finishes at once, and the code after it runs before the work is done. Any error inside becomes an unhandled rejection (section 12). Fix: `for...of` with `await` (sequential) or `await Promise.all(items.map(async ...))` (parallel).

**3. The `new Promise` wrapper anti-pattern.** Wrapping a promise in `new Promise((resolve, reject) => p.then(resolve).catch(reject))` adds nothing and is easy to get wrong (forget `reject` and errors vanish; forget `return` and the caller gets `undefined`). Just return the promise. The related trap is an **async executor**: `new Promise(async (resolve) => { ... })`. A throw inside it cannot reject the outer promise. The outer promise stays pending forever and the error becomes an unhandled rejection (case 6c in section 12).

**4. Swallowing errors.** `catch (err) { console.log(err) }` with no re-throw and no return value turns a failure into `undefined`. Something fails far away, much later, with a confusing message (`Cannot read properties of undefined`). Fix: handle it for real (fallback value, retry) or throw again, adding context with `cause`.

**5. Floating promises.** Calling an `async` function and ignoring the result (`save(user);`) means nobody waits for it and nobody catches its error (case 5a in section 12). Fix: `await` it, return it, or attach `.catch()`. If you really want fire-and-forget, write `save(user).catch(logError)` so it is a visible decision.

**6. Throwing inside a `setTimeout` (or any callback).** A promise executor only catches errors thrown **synchronously** while it runs. A callback runs later on a fresh call stack, so a `throw` there is not caught by the promise, and it crashes the process (case 6a in section 12).

```js
// WRONG: the throw happens later, outside the executor. The process crashes.
new Promise(() => {
  setTimeout(() => { throw new Error('boom'); }, 5);
}).catch(() => console.log('never'));

// RIGHT: catch inside the callback and call reject.
new Promise((_, reject) => {
  setTimeout(() => {
    try { throw new Error('boom'); } catch (e) { reject(e); }
  }, 5);
}).catch((e) => console.log('caught', e.message));
```

**7. An `async` function where a plain callback is expected.** `setTimeout(async () => ...)`, `setInterval(async () => ...)` and `emitter.on('job', async () => ...)` all ignore the promise the function returns. A `try` / `catch` around the `setTimeout` or `emit` call cannot see the failure, so a throw inside becomes an unhandled rejection and crashes the process (case 6d in section 12). Fix: put the `try` / `catch` **inside** the async callback. For event emitters you can also create them with `new EventEmitter({ captureRejections: true })` and add an `'error'` listener, so a rejected listener is routed to it (case 6e; lesson [09](../09-events/README.md)). Frameworks differ: Express 5 passes a rejected promise from a route handler to its error middleware for you, but plain callbacks and listeners never get that help.

Other mistakes worth a line each:
- `await` inside a loop for independent work (section 13).
- Mixing styles: a function that both takes a callback and returns a promise, or that sometimes returns a promise and sometimes a plain value. Choose one.
- Not clearing timers (section 17).
- Rejecting with strings instead of `Error` objects.
- Using `await` where you wanted `Promise.all` to start tasks together.

Linters catch many of these: `@typescript-eslint/no-floating-promises` and `@typescript-eslint/no-misused-promises` (for example an `async` function passed where a plain callback is expected) need TypeScript type information, while the core ESLint rules `no-async-promise-executor` and `require-await` work on plain JavaScript.

> **Interview tip:** "Spot the bug" questions use exactly these seven patterns: a missing `await`, an `async` callback in `forEach`, a floating promise, an `async` executor, a throw inside `setTimeout`, an empty `catch`, an `async` event listener. For each one, name the symptom (wrong order, `undefined`, or a crash with exit code 1) and give the one-line fix.

## 23. How to answer in interviews

| Question | A strong answer in one breath |
|---|---|
| Callbacks vs promises vs async/await? | Same async mechanism at three levels. Callbacks pass your function away (inversion of control, nesting). Promises are values you hold and chain, settle once and propagate errors. `async` / `await` is sugar over promises so async code reads top to bottom. |
| What are the states of a promise? | Pending, then fulfilled or rejected. Settled means either. A settled promise never changes. |
| What does `then` return? | A new promise. It is fulfilled with the callback's return value (or follows a returned promise) and rejected if the callback throws. |
| Does `await` block? | It pauses the async function, not the thread. The rest of the program keeps running. |
| `Promise.all` vs `allSettled` vs `race` vs `any`? | The table in section 14: when does it fulfill, when does it reject; input order; losers are not cancelled. |
| How do you run N tasks with at most K at a time? | A pool of K workers that pull the next item until the list is empty (section 15). |
| How do you retry a flaky call? | Exponential backoff with a cap and jitter, retry only transient errors, make sure the operation is idempotent (section 16). |
| How do you time out or cancel? | `Promise.race` stops waiting; `AbortController` / `AbortSignal.timeout` tell the work to stop (sections 17 and 18). |
| Retry, timeout and cancel in one function? | A fresh `AbortSignal.timeout` per attempt, backoff between attempts, and one caller signal combined with `AbortSignal.any` that also stops the waiting (end of section 18). |
| Why must a callback API be always sync or always async? | If it is sometimes sync, the code after the call runs in an unpredictable order. Defer with `process.nextTick`, or return a promise, whose `then` is never synchronous (section 3). |
| What goes wrong with an `async` function in `forEach`, `setInterval` or an event listener? | The caller ignores the returned promise: nobody waits for the work, and a throw becomes an unhandled rejection (section 22). |
| What happens on an unhandled rejection? | Node 24: the process prints the error and exits with code 1. The `unhandledRejection` event is a safety net only (section 12). |
| Output-order puzzles | Sync code first, then all microtasks (promise callbacks, code after `await`), then timers and I/O (section 8). |

## Summary / Key takeaways
- Node runs your JavaScript on one main thread. Blocking calls (sync I/O, long loops) stop everything; async calls let the thread do other work while waiting.
- Callbacks are error-first: `(err, result)`. Check `err` first, `return` after reporting an error, call the callback exactly once.
- A promise settles once: pending, then fulfilled or rejected. `then` / `catch` / `finally` each return a new promise, which is why chains work and why errors skip down to the next `catch`.
- `async` / `await` is sugar over promises. An `async` function always returns a promise, `await` pauses only that function, and inside `try` you need `return await` for the `catch` and `finally` to behave.
- Awaiting independent calls one after another is the most common performance bug. Start them together (`Promise.all`) and add a concurrency limit when the list is large.
- `all` fails fast, `allSettled` never fails, `race` takes the first settled result, `any` takes the first success. None of them cancels the losers.
- Real cancellation needs `AbortController`; a `Promise.race` timeout only stops waiting. Retry with exponential backoff, a cap and jitter.
- An unhandled rejection crashes a Node 24 process with exit code 1. Never forget `await`, never use `async` callbacks in `forEach`, never swallow errors, and never throw inside a plain callback.

## Quick check

1. Why is `fs.readFileSync` a problem inside a web server's request handler, but fine at startup?
<details><summary>Answer</summary>

JavaScript runs on one main thread. `readFileSync` blocks that thread until the read is done, so every other request waits. At startup nobody is waiting yet, so a short blocking read is harmless.

</details>

2. What does an error-first callback look like, and what is `err` when the operation succeeds?
<details><summary>Answer</summary>

`function callback(err, result) { ... }`: the error is the first argument and the result comes after it. On success `err` is `null` (or `undefined`). You must check `err` first and `return` after handling it.

</details>

3. Name the three states of a promise. Can a fulfilled promise become rejected later?
<details><summary>Answer</summary>

Pending, fulfilled and rejected. No: once a promise is settled (fulfilled or rejected) its state and value never change. Extra `resolve` or `reject` calls are ignored.

</details>

4. What does the next `.then` receive if the previous callback (a) returned `5`, (b) returned a promise for `7`, (c) returned nothing, (d) threw an error? And what does `Promise.resolve('one').then('two').then(console.log)` print?
<details><summary>Answer</summary>

(a) `5`. (b) `7`: the chain waits for the returned promise. (c) `undefined`. (d) Nothing: the next promise is rejected, so the next `.then` is skipped and the next `.catch` runs. The last snippet prints `one`: `then` ignores an argument that is not a function, so the value passes through.

</details>

5. What does this print, and why?
```js
console.log('A');
setTimeout(() => console.log('B'), 0);
Promise.resolve().then(() => console.log('C'));
console.log('D');
```
<details><summary>Answer</summary>

`A`, `D`, `C`, `B`. `A` and `D` are synchronous. The promise callback `C` is a microtask and runs as soon as the synchronous code ends. The timer callback `B` is a macrotask and runs later, even with a delay of 0.

</details>

6. What is the difference between `return fetchData()` and `return await fetchData()` inside an `async` function?
<details><summary>Answer</summary>

The caller gets the same result. Inside `try` / `catch` / `finally` they differ: without `await`, the function leaves the `try` block at once, so its `catch` never sees the failure and `finally` runs before the promise settles. With `await` the `catch` handles the error and `finally` runs afterwards.

</details>

7. You start four requests. You want whatever succeeded even if some failed. Which combinator? And which one for "use the first mirror that answers"?
<details><summary>Answer</summary>

`Promise.allSettled`: it never rejects and tells you the status of each promise. `Promise.any` for the first mirror: it fulfills with the first success and ignores failures until all have failed (then it rejects with an `AggregateError`).

</details>

8. What does Node 24 do by default when a promise is rejected and nobody handles it? How can a late `.catch` be "too late"?
<details><summary>Answer</summary>

It prints the error and exits with code 1 (the default mode is `throw`). Node checks for unhandled rejections once the microtask queue is empty. A handler attached in a later turn of the event loop (for example inside a `setTimeout`) is too late, because the rejection was already reported.

</details>

9. You need to call an API for 10,000 ids. Why is `ids.forEach(async (id) => ...)` wrong, why is `Promise.all(ids.map(...))` risky, and what do you do instead?
<details><summary>Answer</summary>

`forEach` does not wait for the async callbacks, so you cannot know when the work is done and errors go unhandled. `Promise.all(ids.map(...))` works but starts 10,000 requests at once, which can exhaust sockets or hit rate limits. Use a concurrency limit: a pool of N workers that take the next id until none is left.

</details>

10. Can you cancel a promise? How do you stop a slow `fetch`?
<details><summary>Answer</summary>

You cannot cancel the promise object. You cancel the work behind it by passing an `AbortSignal`: `fetch(url, { signal: AbortSignal.timeout(5000) })` or a signal from an `AbortController` you call `abort()` on. `fetch` then rejects (`TimeoutError` or `AbortError`) and stops the request. `Promise.race` with a timer only stops waiting while the request keeps running.

</details>

## Try it yourself

Save each task in a scratch file (for example `task1.js`, outside the repo or in a temporary folder) and run it with `node task1.js`.

### Task 1 (easy): make it faster

This page loader takes about 300 ms. The three calls do not depend on each other. Change `loadPage` so the whole thing takes about 100 ms. The last line should print `true`.

```js
const sleep = (ms, value) => new Promise((resolve) => setTimeout(resolve, ms, value));

async function getUser() {
  await sleep(100);
  return { name: 'Ada' };
}
async function getPosts() {
  await sleep(100);
  return ['post 1', 'post 2'];
}
async function getFriends() {
  await sleep(100);
  return ['Bob', 'Cleo'];
}

async function loadPage() {
  const user = await getUser();
  const posts = await getPosts();
  const friends = await getFriends();
  return { user, posts, friends };
}

const start = Date.now();
loadPage().then((page) => {
  console.log(page);
  console.log('faster than 200 ms:', Date.now() - start < 200);
});
```

<details><summary>Hint</summary>

The three calls are independent, so start them all first and wait for all of them together. Which combinator returns an array of results in input order?

</details>

<details><summary>Solution</summary>

Change only `loadPage`:

```js
async function loadPage() {
  // The three calls do not depend on each other, so start them together.
  const [user, posts, friends] = await Promise.all([getUser(), getPosts(), getFriends()]);
  return { user, posts, friends };
}
```

Output with the fix:

```text
{
  user: { name: 'Ada' },
  posts: [ 'post 1', 'post 2' ],
  friends: [ 'Bob', 'Cleo' ]
}
faster than 200 ms: true
```

</details>

### Task 2 (medium): write your own promisify

Write `myPromisify(fn)`. It takes a function whose last argument is an error-first callback and returns a function that returns a promise. It must also keep `this`, so `obj.method(...)` keeps working. Test it with the function below.

```js
function addLater(a, b, callback) {
  setTimeout(() => {
    if (typeof a !== 'number' || typeof b !== 'number') return callback(new TypeError('numbers only'));
    callback(null, a + b);
  }, 10);
}
```

<details><summary>Hint</summary>

Return a normal `function` (not an arrow, so it has its own `this`). Inside it, `return new Promise(...)`, and call `fn.call(this, ...args, callback)`. The callback decides: `err` set means `reject(err)`, otherwise `resolve(value)`.

</details>

<details><summary>Solution</summary>

```js
function myPromisify(fn) {
  return function (...args) {
    return new Promise((resolve, reject) => {
      fn.call(this, ...args, (err, value) => {
        if (err) reject(err);
        else resolve(value);
      });
    });
  };
}

function addLater(a, b, callback) {
  setTimeout(() => {
    if (typeof a !== 'number' || typeof b !== 'number') return callback(new TypeError('numbers only'));
    callback(null, a + b);
  }, 10);
}

const addAsync = myPromisify(addLater);

async function main() {
  console.log('2 + 3 =', await addAsync(2, 3));
  try {
    await addAsync(2, 'x');
  } catch (err) {
    console.log('failed with:', err.name, '-', err.message);
  }

  // `this` is forwarded, so methods work when called as obj.method(...)
  const calc = {
    base: 100,
    addToBase(n, callback) {
      setTimeout(() => callback(null, this.base + n), 5);
    },
  };
  calc.addToBaseAsync = myPromisify(calc.addToBase);
  console.log('100 + 5 =', await calc.addToBaseAsync(5));
}

main();
```

Output:

```text
2 + 3 = 5
failed with: TypeError - numbers only
100 + 5 = 105
```

Like Node's own `promisify`, this keeps only the first success value.

</details>

### Task 3 (harder): build Promise.all and Promise.race

Without using `Promise.all` or `Promise.race`, write `myPromiseAll(iterable)` and `myPromiseRace(iterable)`. Requirements for `myPromiseAll`: results keep the **input order**; plain (non-promise) values are allowed; an empty input fulfills with `[]`; the first rejection rejects the result. Check your work with `node:assert`.

<details><summary>Hint</summary>

Wrap each item with `Promise.resolve(item)` so plain values work. For `all`: keep a `results` array, store each value at its own index, count how many are still missing, and resolve when the count reaches zero. Pass `reject` straight to `.then(onFulfilled, reject)`. For `race`: pass the outer `resolve` and `reject` to every item. The first call wins and the rest are ignored.

</details>

<details><summary>Solution</summary>

```js
const assert = require('node:assert/strict');
const sleep = (ms, value) => new Promise((resolve) => setTimeout(resolve, ms, value));

function myPromiseAll(iterable) {
  return new Promise((resolve, reject) => {
    const items = Array.from(iterable);
    const results = new Array(items.length);
    let remaining = items.length;
    if (remaining === 0) return resolve(results); // nothing to wait for

    items.forEach((item, index) => {
      Promise.resolve(item).then((value) => {
        results[index] = value; // keep the INPUT position, not the finish order
        remaining--;
        if (remaining === 0) resolve(results);
      }, reject); // the first rejection rejects the whole thing (later calls are ignored)
    });
  });
}

function myPromiseRace(iterable) {
  return new Promise((resolve, reject) => {
    for (const item of iterable) {
      Promise.resolve(item).then(resolve, reject); // first to settle wins, the rest are ignored
    }
  });
}

async function main() {
  assert.deepEqual(await myPromiseAll([sleep(30, 'a'), sleep(10, 'b'), 'plain', Promise.resolve('d')]), ['a', 'b', 'plain', 'd']);
  assert.deepEqual(await myPromiseAll([]), []);
  await assert.rejects(myPromiseAll([sleep(30, 'a'), Promise.reject(new Error('nope'))]), { message: 'nope' });
  assert.equal(await myPromiseRace([sleep(30, 'slow'), sleep(5, 'fast')]), 'fast');
  console.log('all checks passed');
}

main();
```

Output:

```text
all checks passed
```

Idea: a promise can be settled only once, so calling `resolve` / `reject` many times is harmless. Complexity: O(n) time to attach handlers. Real `Promise.all` also accepts any iterable, as the `Array.from` call does here.

</details>

## Where to go next
- Next lesson: [08. The Event Loop (the most asked Node.js topic)](../08-event-loop/README.md). It explains the microtask and macrotask order from section 8 in full, with `process.nextTick`, `setImmediate` and the phases of the loop.
- Practise this topic in the interview rounds: [Round 1 questions (screening)](../../rounds/round-1-screening/questions.md), [Round 2 questions (core)](../../rounds/round-2-core/questions.md), [Round 3 questions (coding)](../../rounds/round-3-coding/questions.md) and [Round 4 questions (advanced)](../../rounds/round-4-advanced/questions.md).
- Related lessons: [09. Events and EventEmitter](../09-events/README.md) (async listeners, `once` and `on`), [11. Streams and Backpressure](../11-streams/README.md) (streams are async iterables), [14. Error Handling and Debugging](../14-error-handling-and-debugging/README.md) and [18. worker_threads, cluster and Scaling on One Machine](../18-worker-threads-and-cluster/README.md) (CPU-heavy work).
- Come back to sections 13 to 18 before a coding round. A concurrency pool, a retry helper and a timeout wrapper are very common live-coding tasks.
