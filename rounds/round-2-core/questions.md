# Round 2: Core Node.js Technical: Questions

How to use this file: read a question, answer ALOUD in 1 to 3 minutes (definition, mechanism, example, gotcha), then compare with [answers.md](answers.md). Tags: `[Easy]`, `[Medium]`, `[Hard]`, `[Must-know]`. For predict-the-output puzzles, think out loud, then run the code to check.

---

## Event loop and async (Lessons 07, 08)

Lessons: [07 Async JavaScript](../../lessons/07-async-javascript/README.md), [08 Event loop](../../lessons/08-event-loop/README.md)

### R2-LOOP-01 [Easy] [Must-know] Explain the event loop in plain words.

### R2-LOOP-02 [Medium] [Must-know] Name the phases of the event loop and where `process.nextTick` and promises fit.

### R2-LOOP-03 [Medium] [Must-know] What is printed, and which part of the order is NOT guaranteed?

```js
setTimeout(() => console.log('timeout'), 0);
setImmediate(() => console.log('immediate'));
Promise.resolve().then(() => console.log('promise'));
process.nextTick(() => console.log('nextTick'));
console.log('sync');
```

### R2-LOOP-04 [Medium] What is printed here, and why is the order different from the previous puzzle?

```js
const fs = require('node:fs');
fs.readFile(__filename, () => {
  setTimeout(() => console.log('timeout'), 0);
  setImmediate(() => console.log('immediate'));
});
```

### R2-LOOP-05 [Medium] What is printed?

```js
async function a() { console.log(1); await b(); console.log(2); }
async function b() { console.log(3); }
a();
Promise.resolve().then(() => console.log(4));
console.log(5);
```

### R2-LOOP-06 [Hard] What is printed?

```js
Promise.resolve().then(() => {
  console.log('p1');
  process.nextTick(() => console.log('tick in p1'));
}).then(() => console.log('p2'));
process.nextTick(() => console.log('tick1'));
```

### R2-LOOP-07 [Medium] What is printed?

```js
setTimeout(() => console.log('timeout'), 0);
(async () => {
  console.log('A');
  await null;
  console.log('B');
})();
queueMicrotask(() => console.log('C'));
console.log('D');
```

### R2-LOOP-08 [Medium] What is printed?

```js
Promise.reject(new Error('x'))
  .catch(() => console.log('caught'))
  .finally(() => console.log('finally'))
  .then((v) => console.log('then', v));
```

### R2-LOOP-09 [Medium] [Must-know] What blocks the event loop, and how do you find and fix it?

### R2-LOOP-10 [Hard] What is the libuv thread pool, how big is it by default, and which operations use it?

### R2-ASY-01 [Medium] How do errors travel through a promise chain?

### R2-ASY-02 [Hard] What is printed? Why is this a trap?

```js
const EE = require('node:events');
const e = new EE();
e.on('ev', async () => { throw new Error('boom'); });
process.on('unhandledRejection', (r) => console.log('unhandledRejection:', r.message));
e.emit('ev');
console.log('emit returned');
```

### R2-ASY-03 [Medium] How do you add a timeout and cancellation to an async operation?

---

## Events, buffers, streams (Lessons 09, 10, 11)

Lessons: [09 Events](../../lessons/09-events/README.md), [10 Buffers](../../lessons/10-buffers/README.md), [11 Streams](../../lessons/11-streams/README.md)

### R2-EV-01 [Easy] Are `EventEmitter` listeners synchronous or asynchronous? What is printed?

```js
const EE = require('node:events');
const e = new EE();
e.on('x', () => console.log('listener'));
console.log('before');
e.emit('x');
console.log('after');
```

### R2-EV-02 [Medium] [Must-know] What happens if you emit `'error'` with no listener? What is the "possible EventEmitter memory leak" warning?

### R2-BUF-01 [Medium] What is a `Buffer`? How do `Buffer.alloc` and `Buffer.allocUnsafe` differ?

### R2-BUF-02 [Hard] Why can decoding a stream chunk by chunk corrupt text, and how do you prevent it?

### R2-STR-01 [Easy] [Must-know] What are the four kinds of streams, and why use streams at all?

### R2-STR-02 [Medium] [Must-know] What is backpressure, and how does Node handle it?

### R2-STR-03 [Medium] What is the difference between `pipe()` and `stream.pipeline()`?

### R2-STR-04 [Hard] What is `highWaterMark`, what are the defaults, and what changes in object mode?

---

## HTTP, processes, modules, errors, tests (Lessons 03, 12, 13, 14, 15, 16)

Lessons: [03 Modules](../../lessons/03-modules/README.md), [12 HTTP](../../lessons/12-http-and-networking/README.md), [13 Real-time](../../lessons/13-realtime-websockets-sse/README.md), [14 Errors](../../lessons/14-error-handling-and-debugging/README.md), [15 Processes](../../lessons/15-processes-and-cli/README.md), [16 Testing](../../lessons/16-testing/README.md)

### R2-HTTP-01 [Medium] How do you read a request body with the plain `http` module? What can go wrong?

### R2-HTTP-02 [Medium] What are `keepAliveTimeout`, `headersTimeout` and `requestTimeout`, and why do they matter?

### R2-HTTP-03 [Medium] [Must-know] Compare polling, Server-Sent Events and WebSockets.

### R2-PROC-01 [Medium] [Must-know] What is the difference between `exec`, `execFile`, `spawn` and `fork`? Which one risks command injection?

### R2-PROC-02 [Medium] How do you shut a Node.js server down gracefully?

### R2-MOD-01 [Medium] [Must-know] How does `require` find and load a module? What is cached, and what happens with circular dependencies?

### R2-MOD-02 [Medium] How do CommonJS and ES modules work together in Node 24?

### R2-ERR-01 [Medium] How do you design errors in a Node.js service?

### R2-TEST-01 [Medium] How do you test async code and timers with the built-in `node:test` runner?

---

## Coding challenges (hands-on)

### R2-CODE-01 [Medium] Build your own EventEmitter

Implement `on`, `once`, `off`, `emit`, `prependListener` and the awkward edge cases (changes during emit, the `error` event). Skills: observer pattern, closures. Time box: 30 minutes.
Folder: [challenges/01-event-emitter](challenges/01-event-emitter/README.md). Run: `npm run challenge -- event-emitter`
