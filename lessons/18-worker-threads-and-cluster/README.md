# 18. worker_threads, cluster and Scaling on One Machine

> Level: Advanced   Time: about 150 minutes   Node: 24 (notes where older versions differ)

[Previous: 17. Databases and Data Access](../17-databases-and-data-access/README.md) | [All lessons](../../README.md) | [Next: 19. Performance, Profiling and Memory](../19-performance-and-memory/README.md)

## What you will learn
- The difference between CPU-bound and I/O-bound work, and why the first kind freezes a Node server
- `worker_threads` in depth: `Worker`, `workerData`, `parentPort`, messages, transfer lists, `SharedArrayBuffer`, `Atomics`, channels, errors and limits
- How to build a reusable worker pool with a task queue (and when to use `piscina` instead)
- The `cluster` module: primary and workers, one shared port, scheduling on Linux/macOS versus Windows, restarting crashed workers, graceful reload
- Why scaling out needs stateless design, and what sticky sessions are for
- `child_process.fork` versus `cluster` versus `worker_threads` (a comparison table), plus PM2 and containers as alternatives
- How many workers to start, and the cases where threads do NOT help
- A decision flowchart and the interview questions on this topic

**How to run the examples.** Run them from the repo root, for example `node lessons/18-worker-threads-and-cluster/examples/02-worker-basics.js`. They use only core modules, talk only to localhost, and finish by themselves. Snippets in this lesson that use `await` live inside an `async function main()` in the example files.

**About the numbers.** The timings come from one Windows 11 machine with 12 logical CPUs that was also busy with other work, so your numbers will differ. Look at the shape of the results, not the exact milliseconds. When a result depends on the operating system, the lesson says so.

**Five words you need first.**

| Word | Plain meaning |
|---|---|
| process | a running program with its own memory. Two processes cannot see each other's variables |
| thread | a line of execution inside a process. A process can have several |
| CPU core | one unit that can run one thread at a given moment. 12 logical CPUs means 12 threads can run at the same time |
| V8 isolate | one JavaScript engine instance: its own heap (the memory where objects live), its own variables. Each `Worker` gets its own |
| IPC | inter-process communication: a private message pipe between two processes |

## 1. CPU-bound versus I/O-bound work

Think of a restaurant with one waiter. The waiter takes an order, hands it to the kitchen, and while the kitchen cooks, serves other tables. That waiter is your **main thread** and the waiting is **I/O-bound** work: the time is spent waiting for something else (a database, the network, the disk).

Now the waiter must chop 10 kg of onions personally. Nobody gets served until the onions are done. That is **CPU-bound** work: the time is spent calculating, and the CPU is busy the whole time.

| | I/O-bound | CPU-bound |
|---|---|---|
| Time is spent on | waiting | calculating |
| Examples | HTTP call, SQL query, reading a file | password hashing, image resize, parsing a 50 MB JSON, compression, a big loop, `crypto.pbkdf2Sync` |
| Node handles it | very well, thousands at once on one thread | badly, it blocks every other request |
| Typical fix | async I/O, connection pools, caching | another thread or process, or a cheaper algorithm |

Remember from [lesson 08](../08-event-loop/README.md): JavaScript runs on ONE thread, driven by the event loop. If a callback runs for 300 ms, nothing else runs for 300 ms: no other request, no timer.

`examples/01-blocked-loop.js` proves it with a **heartbeat**, a timer that should fire every 10 ms. It remembers the longest gap between two ticks. A free loop gives a gap of about 10 ms (15 to 16 ms on Windows). A blocked loop gives a big gap.

```js
let lastTick = performance.now();
let longestGap = 0;
setInterval(() => {
  const now = performance.now();
  longestGap = Math.max(longestGap, now - lastTick);
  lastTick = now;
}, 10);

// 1. CPU work: count primes below 600,000 with trial division, in plain JavaScript
countPrimes(600_000);
// 2. I/O: wait for a local HTTP server that answers after 150 ms
await fetch(`http://127.0.0.1:${port}/`).then((r) => r.text());
// 3. native async work: crypto.pbkdf2 with a callback (runs in the libuv thread pool)
crypto.pbkdf2('password', 'salt', 200_000, 64, 'sha512', callback);
// 4. the same hashing, synchronous version
crypto.pbkdf2Sync('password', 'salt', 200_000, 64, 'sha512');
```

```text
heartbeat: a timer every 10 ms

1. CPU: countPrimes(600,000) in JS             took  304 ms, heartbeat gap  300 ms
2. I/O: wait for a slow local HTTP answer      took  177 ms, heartbeat gap   40 ms
3. native async: crypto.pbkdf2 (libuv pool)    took  433 ms, heartbeat gap   30 ms
4. native sync: crypto.pbkdf2Sync (same job)   took  423 ms, heartbeat gap  420 ms
```

How to read it:
1. The heartbeat gap equals the work time (300 of 304 ms). The loop was frozen. This is the problem.
2. Waiting 177 ms for the network costs the loop almost nothing (the gap stays far below the waiting time). One thread can wait for thousands of things at once.
3. `crypto.pbkdf2` with a callback is also fine, even though it is heavy. Node hands the hashing to a native thread in the **libuv thread pool** (section 9) and the loop stays free.
4. The synchronous twin of the same hashing blocks the loop for the whole time.

Only rows 1 and 4 are guaranteed to look like this. The timings change on every run (V8 is still optimising the code while it runs, other programs use the CPU), and rows 2 and 3 can show gaps of 20 to 100 ms from plain operating-system noise. The point is that those gaps do not grow with the work, while rows 1 and 4 always do. On Windows a 10 ms timer usually ticks every 15 to 16 ms because of the coarse system timer, so a "free" loop shows gaps of about 16 ms there.

> **Remember:** "Node is single-threaded" is only half true. JavaScript runs on one main thread, but a Node process already has other threads (V8 helpers, the libuv pool). The accurate phrase is "a single-threaded event loop for JavaScript".

Why does this matter on a server? If one request handler burns 200 ms of CPU, that server can finish at most 5 such requests per second, and every other request (even a tiny `/health` check) waits behind them. In production this looks like latency spikes on every endpoint at the same time, while the CPU of one core sits at 100%. (Lesson 19 shows how to measure the "event loop delay" that reveals it.)

Node does not run your JavaScript in parallel by itself. To use more than one CPU core you need either **more threads** (`worker_threads`, sections 2 to 9) or **more processes** (`cluster` and friends, sections 10 to 14).

> **Interview tip:** the first sentence of a good answer to "how do you handle CPU-heavy work in Node?" is "I first check whether it is really CPU work, because I/O waits do not need threads". Then you offer worker threads, a pool, or moving the work to another service.

## 2. Your first Worker

A **worker thread** is a second JavaScript thread inside the same process. It has its own V8 isolate (its own heap and variables), its own event loop, and it runs in parallel with the main thread on another CPU core. The `worker_threads` module has been stable for a long time.

The idea: send the heavy job to a worker, keep the main thread free, get the answer back as a message.

Here is the core of `examples/02-worker-basics.js`. The same file runs twice: once as the main thread, once as the worker.

```js
const { Worker, isMainThread, parentPort, workerData, threadId } = require('node:worker_threads');

// CPU-bound job: count the primes below `limit`
function countPrimes(limit) { /* same loop as in example 01 */ }

// Main thread side: wrap one worker in a promise
function runWorker(limit) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { limit } });
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`worker stopped with exit code ${code}`));
    });
  });
}

if (isMainThread) {
  main(); // starts workers with runWorker(...)
} else {
  // Worker thread side: do the job, send the answer
  const count = countPrimes(workerData.limit);
  parentPort.postMessage({ limit: workerData.limit, count, threadId, isMainThread });
}
```

```text
main: isMainThread = true , threadId = 0
worker answered: { limit: 100000, count: 9592, threadId: 1, isMainThread: false }

4 jobs on the main thread : 1147 ms, heartbeat ticks during it: 0
4 jobs in 4 workers       : 441 ms, heartbeat ticks during it: 21
threadIds that did the work: 2, 3, 4, 5
```

The API in one table:

| Name | Where | Meaning |
|---|---|---|
| `new Worker(file, options)` | main | start a thread that runs `file` |
| `isMainThread` | both | `true` only in the main thread, so one file can hold both sides |
| `workerData` | worker | a copy of `options.workerData` |
| `parentPort` | worker | the channel to the parent (`null` in the main thread) |
| `threadId` | both | `0` for main, then `1`, `2`, `3`... in creation order |
| `worker.postMessage(value)` / `parentPort.postMessage(value)` | both | send a message to the other side |
| events `online`, `message`, `error`, `exit`, `messageerror` | main | the life of the worker |

What the output shows:
- Four jobs on the main thread ran one after another and the heartbeat got **0 ticks**: the loop was frozen.
- Four jobs in four workers ran at the same time and the heartbeat kept ticking (21 ticks). The time is not 4 times smaller because starting a worker costs time too (section 7). The exact numbers change on every run.

A worker is not a copy-paste of the main thread. Differences worth knowing:

- Variables are **not shared**. A global variable you set in the main thread is `undefined` in the worker (example 11 proves it). Each thread loads its own copy of every module.
- `process.pid` is the **same** as the parent (it is one process). `process.exit()` inside a worker ends only that worker.
- `process.chdir()` throws `ERR_WORKER_UNSUPPORTED_OPERATION` in a worker.
- `process.env` is a **copy**. Changes in the worker do not reach the parent unless you pass `env: SHARE_ENV` (exported by `worker_threads`).
- `console.log` in a worker is sent through the main thread, so lines from workers can interleave in a different order than you expect.
- Native add-ons (compiled `.node` files) can only be loaded in a worker if they were written to be "context-aware" (see the Node-API docs). If a package with a native part fails inside a worker, check that first.

The options of `new Worker(file, options)` you will meet most often (each one was checked on Node 24):

| Option | What it does |
|---|---|
| `workerData` | a value copied to the worker at startup (structured clone, section 3) |
| `transferList` | objects to move instead of copy (sections 4 and 6) |
| `env` | `process.env` of the worker. Default: a copy. `SHARE_ENV` shares the parent's object, so a change made in the worker shows in the parent |
| `argv` | extra values appended to `process.argv` in the worker |
| `execArgv` | Node command-line flags for this worker. Process-wide V8 flags such as `--max-old-space-size=64` are rejected (`ERR_WORKER_INVALID_EXEC_ARGV`); use `resourceLimits` (section 7) to limit memory |
| `stdout: true` | do not print the worker's `console.log` in the parent's terminal; read it from `worker.stdout` instead |
| `eval: true` | the first argument is JavaScript source code, not a file name |
| `resourceLimits` | caps on heap size and stack (section 7) |

> **Common mistake:** a relative path given to `new Worker('./job.js')` is resolved against the **current working directory**, not against the file that calls it. Build the path from `__dirname` (`path.join(__dirname, 'job.js')`), as every example here does.

> **Interview tip:** "What is the difference between a thread and a process in Node?" A strong answer: a `Worker` is a thread, so it lives inside the process (same pid) but has its own V8 isolate and event loop, and no JavaScript objects are shared. A process from `fork` or `cluster` has fully separate memory and its own pid. Workers are similar to Web Workers in the browser.

The same thing in an ES module (`__filename` does not exist there, so use `import.meta.url`):

```js
// main.mjs
import { Worker } from 'node:worker_threads';

const worker = new Worker(new URL('./worker.mjs', import.meta.url), { workerData: { name: 'Ada' } });
worker.on('message', (msg) => console.log('main got:', msg));
worker.on('exit', (code) => console.log('worker exited with code', code));
```

```js
// worker.mjs
import { parentPort, workerData } from 'node:worker_threads';

parentPort.postMessage(`hello ${workerData.name} from a worker written as an ES module`);
```

```text
main got: hello Ada from a worker written as an ES module
worker exited with code 0
```

## 3. Messages and the structured clone algorithm

When you call `postMessage(value)`, the value is **copied** with the **structured clone algorithm**. Sender and receiver never hold the same object. This is why two threads cannot corrupt each other's variables.

Structured clone is more powerful than JSON: it understands more types. It is also stricter. `examples/03-messages-and-transfer.js` (part 1) sends different values to a small "echo" worker (it sends back what it receives):

```js
const echo = new Worker(`
  const { parentPort } = require('node:worker_threads');
  parentPort.on('message', (value) => parentPort.postMessage(value));
`, { eval: true }); // eval: true means "the first argument is code, not a file name"
```

```text
Date stays a Date      : true 1970-01-01T00:00:00.000Z
Set and Map survive    : true true 1
circular reference     : true
it is a copy, not same : true
class instance         : { name: 'Ada' } instanceof User: false , has hello(): undefined
Buffer comes back as   : Uint8Array , isBuffer: false
Error comes back as    : RangeError too far
a function             : DataCloneError (code 25)
a Symbol               : DataCloneError (code 25)
an object with a method: DataCloneError (code 25)
```

| Value | What the receiver gets |
|---|---|
| numbers, strings, booleans, `null`, `undefined`, `BigInt` | the same value |
| plain objects and arrays (even circular) | a deep copy |
| `Date`, `RegExp`, `Map`, `Set`, `Error`, typed arrays, `ArrayBuffer` | the same kind of object, copied |
| a class instance | a **plain object**: the prototype and all methods are lost |
| a `Buffer` | a `Uint8Array` (not a `Buffer`) |
| a function, a `Symbol`, or an object that holds one | **error**: `postMessage` throws `DataCloneError` immediately, in the sender |

Three more facts:
- `postMessage` returns at once. Delivery is asynchronous and messages arrive **in the order they were sent**.
- The receiver gets a message only when its event loop is free. A worker stuck in a long loop cannot read its messages until the loop ends.
- The copy costs time and memory in proportion to the size of the data. Sending a 500 MB object to a worker can cost more than the work itself. For big binary data use a transfer or shared memory (sections 4 and 5).

> **Interview tip:** "functions cannot be sent to a worker, so how do you tell it what to do?" Send data (a task name plus arguments) and let the worker pick the function, as the pool in section 8 does.

## 4. Transfer lists and zero-copy ArrayBuffer

Copying 64 MiB just to hand it over is wasteful if the sender will not use it again. A **transfer list** (the second argument of `postMessage`) moves ownership of some objects instead of copying them. For an `ArrayBuffer` the memory block itself is handed over and **nothing is copied**. The sender's buffer becomes **detached**: length 0, unusable.

```js
const forCopy = new ArrayBuffer(64 * 1024 * 1024);
worker.postMessage(forCopy);              // no transfer list: the bytes are copied

const forMove = new ArrayBuffer(64 * 1024 * 1024);
worker.postMessage(forMove, [forMove]);   // transfer list: ownership moves, zero copy
console.log(forMove.byteLength, forMove.detached); // 0 true
```

Output of part 2 of the example (the worker replies with what it received):

```text
after copy    : sender byteLength = 67108864 , detached = false
worker saw    : { byteLength: 67108864, firstByte: 7 }
after transfer: sender byteLength = 0 , detached = true
worker saw    : { byteLength: 67108864, firstByte: 9 }
postMessage took about 51 ms to copy and under 1 ms to transfer (numbers vary)
```

Both ways the worker received all 64 MiB. The difference is the cost (a copy of 64 MiB versus moving a pointer) and what happens to the sender's buffer.

| Way | Cost | Sender afterwards | Use when |
|---|---|---|---|
| copy (default) | grows with the size | still has the data | small messages |
| transfer | almost free | buffer is detached (empty) | big binary data with one owner at a time |
| share (`SharedArrayBuffer`) | free | both see the same memory | many threads work on the same data (section 5) |

Things that can be transferred include `ArrayBuffer` and `MessagePort`. A typed array can be transferred by listing its `.buffer`.

> **Common mistake:** small Buffers (`Buffer.from('abc')`, `Buffer.allocUnsafe(10)`) live inside a shared 8 KiB pool, so `buf.buffer.byteLength` is 8192, not 3. Node marks the pool as not transferable, and trying throws:
>
> ```text
> small.buffer.byteLength = 8192 (the whole pool, not 3)
> transfer of a pooled Buffer fails: DataCloneError - Cannot transfer object of unsupported type.
> ```
>
> For data you plan to transfer, allocate it on its own: `Buffer.alloc(n)` or `new Uint8Array(n)`.

> **Interview tip:** "transfer or share?" Transfer gives ONE owner at a time (the sender loses access), so there is nothing to synchronise. Sharing gives several threads access at the same time, so you pay for it with `Atomics` and careful design. Pick transfer when data flows through stages (read, then process, then send); pick sharing when many threads must work on the same data at once.

## 5. Shared memory: SharedArrayBuffer and Atomics

A **`SharedArrayBuffer`** is a block of bytes that several threads can see at the same time. You send it with `postMessage` or `workerData` and the receiver gets a **view of the same memory**, not a copy. You read and write it through typed arrays such as `Int32Array`.

This is how threads share data without copying (a transfer also avoids the copy, but then only one thread owns the data). It is also dangerous. Two threads writing without coordination cause a **data race**. Here is the classic proof, `examples/04-shared-memory-atomics.js`. Four workers each add 1 to the same shared number 500,000 times. The right answer is 2,000,000.

```js
// worker side
if (mode === 'plain') {
  for (let i = 0; i < times; i++) counter[0]++;            // read, add, write: three steps
} else {
  for (let i = 0; i < times; i++) Atomics.add(counter, 0, 1); // one indivisible step
}
```

(The example also makes all workers wait at a "start gate", using `Atomics.wait` and `Atomics.notify`, so they really run at the same moment. Without the gate the workers often start so far apart that they do not overlap.)

```text
--- Part 1: plain "counter[0]++" from 4 threads ---
expected 2000000, got 1238704, lost 761296 updates (the number changes every run)

--- Part 2: Atomics.add(counter, 0, 1) ---
expected 2000000, got 2000000, lost 0 updates
```

(Part 1 needs at least 2 CPU cores that run workers at the same moment. On a one-core machine the workers take turns and you may see "lost 0 updates" even with the unsafe code. The unsafe code is still a bug; it is just hidden.)

Why updates are lost: `counter[0]++` is really three steps (read, add one, write). Two threads can interleave them:

```
time   thread A                 thread B
1      read counter -> 5
2                               read counter -> 5
3      write 6
4                               write 6       <- two increments, counter only went up by one
```

**`Atomics`** is a set of operations that happen as one indivisible step, even when many threads use the same memory:

| Function | What it does |
|---|---|
| `Atomics.add / sub / and / or / xor(arr, i, v)` | change `arr[i]` and return the OLD value |
| `Atomics.load(arr, i)` / `Atomics.store(arr, i, v)` | read / write with guaranteed ordering |
| `Atomics.exchange(arr, i, v)` | write `v`, return the old value |
| `Atomics.compareExchange(arr, i, expected, v)` | write `v` only if the current value is `expected`; returns the old value |
| `Atomics.wait(arr, i, expected, timeout?)` | **sleep the thread** while `arr[i] === expected` (the array must be an `Int32Array` or `BigInt64Array` on a `SharedArrayBuffer`) |
| `Atomics.notify(arr, i, count?)` | wake threads that are sleeping in `wait` on that cell |

### wait and notify

`Atomics.wait` puts the calling thread to sleep, using no CPU, until another thread calls `Atomics.notify` on the same cell (or the timeout ends). It returns a string. Part 3 of the example shows all three results:

```text
worker says: about to wait
main: stored 1 and woke 1 waiting thread
worker says: first wait  -> ok
worker says: second wait -> not-equal (value is already 1)
worker says: third wait  -> timed-out (nobody notifies, 50 ms timeout)
```

- `'ok'`: another thread called `notify`.
- `'not-equal'`: the cell was already different from `expected`, so it did not sleep at all. This is why you must change the value BEFORE you notify. It also removes the "notify arrived too early" race.
- `'timed-out'`: nobody woke it up before the timeout.

### A mutex built from Atomics (a favourite advanced question)

```js
const UNLOCKED = 0;
const LOCKED = 1;

class Mutex {
  constructor(cells, index = 0) {
    this.cells = cells; // an Int32Array on a SharedArrayBuffer
    this.index = index;
  }
  lock() {
    // Try to change UNLOCKED -> LOCKED in one indivisible step. compareExchange returns the OLD value.
    while (Atomics.compareExchange(this.cells, this.index, UNLOCKED, LOCKED) !== UNLOCKED) {
      Atomics.wait(this.cells, this.index, LOCKED); // somebody else holds it: sleep until notified
    }
  }
  unlock() {
    Atomics.store(this.cells, this.index, UNLOCKED);
    Atomics.notify(this.cells, this.index, 1); // wake one sleeper
  }
}
```

With four workers that each do `mutex.lock(); cells[1]++; mutex.unlock();` 50,000 times, the plain `cells[1]++` ends at exactly 200,000, because only one thread at a time is inside the lock. (For a plain counter `Atomics.add` is simpler and faster; a mutex is for protecting several steps together.)

> **Common mistake (Atomics.wait caution):** `Atomics.wait` **blocks the thread**. Browsers forbid it on the main thread. Node allows it, which makes it easy to freeze your own server. Part 4 of the example calls it on the main thread:
>
> ```text
> Atomics.wait returned 'timed-out' after 103 ms, ticks while blocked: 0
> ticks after the loop got its turn back: it ticks again
> ```
>
> The heartbeat got 0 ticks while the main thread slept. Use `Atomics.wait` only inside worker threads, always with a timeout, and never in code that serves requests. If the main thread has to wait, use messages, or `Atomics.waitAsync`, which does not block: it returns `{ async: true, value: <a promise> }` when it really has to wait, or `{ async: false, value: 'not-equal' | 'timed-out' }` when the answer is already known. One surprise measured on Node 24: a pending `waitAsync` that has a timeout does NOT keep the process alive, so keep something else (a timer, a worker) running while you wait.

A `SharedArrayBuffer` holds only bytes and numbers. You cannot put an object in it. To share structured data you must encode it into bytes yourself.

> **Under the hood:** two more facts that advanced interviewers like. (1) Plain reads and writes on shared memory give no promise about WHEN another thread sees them or in what order. Use `Atomics.load` and `Atomics.store` for flags and counters that other threads read. A plain `while (flag[0] === 0) {}` spin loop is a bug even when it seems to work. (2) In browsers `SharedArrayBuffer` only exists on pages that opt in to "cross-origin isolation" (special security headers). In Node it is always available, as every example here shows.

## 6. MessageChannel, BroadcastChannel and receiveMessageOnPort

By default a worker can only talk to its parent. To let two workers talk directly, or to send one message to many threads, use channels. `examples/05-channels.js` shows three tools.

### MessageChannel: a private pipe with two ends

```js
const { port1, port2 } = new MessageChannel();
// A port can only travel inside a message if it is also in the transfer list.
new Worker(__filename, { workerData: { role: 'ping', port: port1 }, transferList: [port1] });
new Worker(__filename, { workerData: { role: 'pong', port: port2 }, transferList: [port2] });
```

Worker A posts `'ping from A'` on its end. Worker B receives it on the other end and answers. The main thread never touches the messages. The example prints what each worker received (sorted, so the order is stable):

```text
A received: pong from B
B received: ping from A
```

Rules worth knowing:
- Messages posted on a port wait in a queue until the other side starts listening (`port.on('message', ...)`). Worker A can post before worker B has even started.
- A port with a `'message'` listener keeps its thread alive. Closing one end (`port.close()`) closes the other end too, which lets both workers finish.

### BroadcastChannel: one message, many listeners

Every thread (main or worker) that opens `new BroadcastChannel('news')` is on the same channel. A message posted on it reaches every OTHER instance with that name.

```text
thread 3 heard: hello everyone
thread 4 heard: hello everyone
thread 5 heard: hello everyone
did the sender hear its own post? false
```

(Threads 1 and 2 were used by part 1, so the listeners are 3, 4 and 5.) The sender does not hear its own message. In the example each listener sends `'ready'` to the main thread after subscribing, and the main thread posts only when all three are ready. Messages sent before a listener exists are lost: broadcast is "live", not queued. And an open `BroadcastChannel` keeps the process alive until you call `channel.close()`.

### receiveMessageOnPort: read without an event

```text
{ message: { n: 1 } }
{ message: { n: 2 } }
undefined
```

`receiveMessageOnPort(port)` returns the next queued message at once (or `undefined`). It does not need the event loop, which makes it useful together with `Atomics.wait`: sleep until notified, then read the message synchronously.

> **Interview tip:** "How can two workers talk without going through the main thread?" Create a `MessageChannel` in the main thread and move one port to each worker (`transferList`). "How do you tell every thread about a config change?" `BroadcastChannel`, or write it into a `SharedArrayBuffer`. Remember the trade-off: ports queue messages until someone listens, a broadcast does not.

## 7. Worker life cycle: errors, exit, limits and cost

`examples/06-errors-limits-startup.js` starts tiny workers from code strings and records what the parent sees:

```text
1. the worker throws an error
    online
    error: boom inside the worker
    exit: code 1
2. the worker has an unhandled promise rejection
    online
    error: rejected inside the worker
    exit: code 1
3. the worker calls process.exit(3) (it ends the worker thread only)
    online
    exit: code 3
4. the worker ends normally
    online
    message: all done
    exit: code 0
5. terminate() on a worker that never ends (terminate resolved with 1)
    online
    exit: code 1
6. leaking worker with resourceLimits.maxOldGenerationSizeMb = 16
    online
    error: ERR_WORKER_OUT_OF_MEMORY - Worker terminated due to reaching memory limit: JS heap out of memory
    exit: code 1
    (the main thread did not crash, it just keeps running)
```

| Event | When |
|---|---|
| `online` | the worker started running JavaScript |
| `message` | the worker called `parentPort.postMessage` |
| `error` | an uncaught exception or unhandled rejection inside the worker (the worker is then terminated) |
| `exit` | the thread is gone; the argument is the exit code (`0` = normal) |
| `messageerror` | a message arrived but could not be turned back into a JavaScript value |

Points to remember:
- An error in a worker does **not** crash the parent. It arrives as an `'error'` event on the `Worker` object. If you have no `'error'` listener, the parent throws it as an uncaught exception, so always add one.
- `'error'` is followed by `'exit'` with code 1. Treat `'exit'` as the final truth: a worker that exits without ever sending a message is a failure your promise wrapper must handle (see `runWorker` in section 2).
- `worker.terminate()` returns a promise for the exit code. It stops the worker at any point, with no cleanup, so use it as a last resort.
- A worker keeps running while it has work: an open port with a listener, a timer, a pending request. Use `worker.unref()` if an idle worker should not keep the process alive.
- Attach your listeners in the same synchronous block as `new Worker(...)`. Events always fire later, so that is safe. If you `await` something first, the `'message'` or `'exit'` event may already be gone, and a later `await once(worker, 'exit')` waits forever (the program then just ends silently, because nothing is left to keep it alive).

### resourceLimits

`new Worker(file, { resourceLimits: { maxOldGenerationSizeMb: 16 } })` caps the worker's heap. Other fields: `maxYoungGenerationSizeMb`, `codeRangeSizeMb`, `stackSizeMb`. A leaking worker is killed with `ERR_WORKER_OUT_OF_MEMORY` and the main thread lives on. Compare that with the main thread running out of memory, which aborts the whole process.

### What a worker costs

Starting a worker means creating a V8 isolate, an event loop, and loading your code again. Measured at the end of example 06:

```text
7. startup: first message after about 121 ms on average (a normal function call takes microseconds)
8. memory: 8 idle workers added about 9.1 MB each (very rough, varies by machine)
```

So a worker is cheap compared with a process but very expensive compared with a function call. The consequence is the most common interview point on this topic:

> **Interview tip:** never start a new `Worker` for every incoming request. Start a fixed number once and reuse them. That is a **worker pool**.

## 8. A worker pool with a task queue

A **pool** keeps N workers alive. A task goes to an idle worker. If all workers are busy, the task waits in a **queue**. When a worker finishes, it takes the next task.

```
tasks in -> [queue: t4 t5 t6 ...] -> idle worker? -> worker 1 (t1)
                                                  -> worker 2 (t2)
                                                  -> worker 3 (t3)
results out <- each task is a promise
```

The pool lives in `examples/_worker-pool.js` (about 100 lines with comments). Here is the heart of it. The fields `#file` and `#closed`, the `stats` getter, `close()` and `#fail()` are trimmed from this excerpt; they are in the file:

```js
class WorkerPool {
  #idle = [];     // workers waiting for a task
  #queue = [];    // jobs waiting for a worker: { task, resolve, reject }
  #running = new Map(); // worker -> the job it is working on

  run(task) {   // returns a promise that settles when a worker has answered
    return new Promise((resolve, reject) => {
      this.#queue.push({ task, resolve, reject });
      this.#dispatch();
    });
  }

  #spawn() {
    const worker = new Worker(this.#file);
    worker.on('message', (reply) => {                  // a task finished
      const job = this.#running.get(worker);
      this.#running.delete(worker);
      if (reply.ok) job.resolve(reply.value); else job.reject(new Error(reply.error));
      this.#idle.push(worker);                         // the worker is free again
      this.#dispatch();
    });
    worker.on('error', (err) => this.#fail(worker, err)); // a crash: the job fails
    worker.on('exit', () => {
      this.#fail(worker, new Error('worker exited'));
      this.#idle = this.#idle.filter((w) => w !== worker);
      if (!this.#closed) this.#spawn();                // replace the dead worker
    });
    this.#idle.push(worker);
    this.#dispatch();
  }

  #dispatch() {  // match waiting jobs with idle workers
    while (this.#idle.length > 0 && this.#queue.length > 0) {
      const worker = this.#idle.shift();
      const job = this.#queue.shift();
      this.#running.set(worker, job);
      worker.postMessage(job.task);
    }
  }
}
```

The worker script (`examples/_pool-worker.js`) follows a tiny protocol: every message is ONE task, and it answers each task with exactly one `{ ok: true, value }` or `{ ok: false, error }` message. A function cannot be sent to a worker, so a task is plain data like `{ type: 'primes', limit: 100000 }` and the worker owns a table of functions.

`examples/07-worker-pool.js` makes a pool of 3 workers and throws 8 tasks at it, then a failing task, then a task that crashes its worker:

```text
new pool          : { workers: 3, idle: 3, running: 0, queued: 0 }

--- 8 tasks, 3 workers ---
just submitted 8  : { workers: 3, idle: 0, running: 3, queued: 5 }
task 1:  9592 primes below 100000
task 2: 17984 primes below 200000
task 3: 25997 primes below 300000
task 4: 33860 primes below 400000
task 5: 41538 primes below 500000
task 6: 49098 primes below 600000
task 7: 56543 primes below 700000
task 8: 63951 primes below 800000
threads used      : 1, 2, 3
all finished      : { workers: 3, idle: 3, running: 0, queued: 0 }

--- a task that fails (the worker survives) ---
rejected with    : unknown task type: nope
pool             : { workers: 3, idle: 3, running: 0, queued: 0 }

--- a task that crashes its worker ---
rejected with    : simulated bug in the worker
pool             : { workers: 3, idle: 3, running: 0, queued: 0 } (a new worker replaced the dead one)
still works      : 5133, 5133, 5133 primes (same answer 3 times)

pool closed: { workers: 0, idle: 0, running: 0, queued: 0 }
```

Read it like this:
- Right after submitting, 3 tasks run and 5 wait in the queue. This is the whole point of the pool: eight tasks, three threads.
- Which of the three threads ran which task can differ from run to run. What is guaranteed: all 3 threads are used and the results arrive in the order of the promises.
- An **expected** failure (unknown task type) is reported by the worker as `{ ok: false }` and the worker keeps living. An **unexpected** crash kills the worker; the pool rejects that one promise and starts a replacement, so the pool stays at full size.

Using the pool inside an HTTP server (save it next to `_worker-pool.js`; it was tested that way):

```js
const http = require('node:http');
const path = require('node:path');
const { WorkerPool } = require('./_worker-pool');

const pool = new WorkerPool(path.join(__dirname, '_pool-worker.js'), 2);

http.createServer(async (req, res) => {
  try {
    const result = await pool.run({ type: 'primes', limit: 200_000 });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.statusCode = 500;
    res.end(err.message);
  }
}).listen(3000);
```

The event loop only sends a message and awaits a promise. The heavy loop runs on another thread, so `/health` stays fast while the pool is busy.

A real production pool also needs these things, which the small pool above leaves out:

- **A task timeout.** You cannot interrupt a worker that is stuck inside a loop by sending it a message, because it never reads messages until the loop ends. The only tool is `worker.terminate()` (example 06, case 5). The pool rejects that task and starts a replacement, like the crash case above.
- **A queue size limit.** Without one, a traffic spike fills the queue (and memory) without bound. Better to reject at once, for example with HTTP 503, than to answer after 30 seconds.
- **Cancellation** (for example with an `AbortSignal`) for tasks nobody waits for any more.
- **Idle shutdown**, so the pool does not keep a short script alive.
- **Batching.** Every task costs a message each way, and waking an idle thread takes time. If one task takes microseconds, the messaging costs more than the work and the pool is SLOWER than a plain function call. Send bigger tasks (for example an array of 1,000 items) instead of one item per message.

You rarely write all that yourself. The usual choice is the `piscina` package. The snippet below is the minimal example from the project's own README:

```js
// Needs: npm install piscina   (illustrative snippet, not run in this repo)
// main.js
const path = require('node:path');
const Piscina = require('piscina');

const pool = new Piscina({ filename: path.resolve(__dirname, 'worker.js') });

(async () => {
  console.log(await pool.run({ a: 4, b: 6 })); // 10
})();
```

```js
// Needs: npm install piscina
// worker.js: export the function that does one task
module.exports = ({ a, b }) => a + b;
```

> **Under the hood:** this is the same design as the hand-written pool: a queue, a fixed set of workers, one task per worker at a time, and a promise per task. If you can explain the 40 lines above, you can explain `piscina`.

## 9. How many workers? And when threads do NOT help

### Pool size

`os.availableParallelism()` (added in Node 18.14 and 19.4) returns an estimate of how many threads a program should run in parallel. `os.cpus().length` is simply the number of logical CPUs of the machine, even if your process is not allowed to use all of them. On Linux, `availableParallelism()` respects such limits on the process (the libuv docs add that on Windows it can report too few on machines with more than 64 logical CPUs). Both gave 12 here.

For CPU-bound work, the best pool size is about **one worker per CPU**: more workers than CPUs just fight for the same cores. If the main thread also does real work, start with one fewer. Two more cautions:
- A logical CPU is not always a full core. With hyper-threading, 12 logical CPUs can be 6 physical cores, and heavy number crunching often gains little from the second logical CPU of a core. Treat the number as an upper bound and measure.
- Pools multiply. 8 cluster workers (section 10) that each own a pool of 8 threads can run 64 busy threads on 8 cores. Give each process a share: pool size is about cores divided by the number of processes.

`examples/08-pool-size-and-io.js` runs 24 identical CPU tasks with different pool sizes:

```text
os.availableParallelism() = 12, os.cpus().length = 12

--- Part 1: 24 CPU-bound tasks with different pool sizes ---
pool of  1 workers:   565 ms
pool of  2 workers:   277 ms
pool of  4 workers:   154 ms
pool of 12 workers:    92 ms  <- one worker per core
pool of 24 workers:   118 ms  <- more workers than cores
```

In a quiet run, two workers are about twice as fast as one, four about twice again, and the gain stops at one worker per core. Going to 24 workers on 12 CPUs gave no real gain: over several runs it was sometimes a little faster and sometimes a little slower. The timings are noisy (on a busy machine even the order of neighbouring rows can flip), so run it a few times and look at the overall shape: big gains at first, then a flat line. (Starting many workers is slow on a busy machine. If part 1 has used more than 3 seconds, the example skips the remaining, bigger pool sizes and says so, to stay inside the 10-second limit.)

> **Common mistake:** "more threads is always faster". Past the CPU count you only add memory (about 9 MB per worker here), startup time and context switching. In containers with a CPU limit, check what `os.availableParallelism()` reports on your platform and prefer a value from configuration.

### I/O-bound work does not need threads

Part 2 of the same example sends 16 requests to a local server that waits 200 ms before answering. First from the main thread alone, then through a pool of 4 workers where each worker handles one task at a time:

```text
--- Part 2: 16 I/O-bound tasks (each waits 200 ms for a local server) ---
one thread, 16 requests at once  : 355 ms
pool of 4 workers, 1 request each: 861 ms (each worker handles one task at a time)
```

The single thread was much faster (in other runs it took between 270 and 400 ms; once, on a very busy machine, it took longer, but the pool never got below about 800 ms). Waiting does not use the CPU, so one event loop can wait for all 16 answers at once (about 200 ms plus overhead). The workers added startup cost, message copying, and a limit of 4 waits at a time (16 / 4 = 4 rounds of 200 ms). Threads help when the CPU is the bottleneck, and they cannot make a database answer faster.

### The libuv thread pool is NOT worker_threads

This is a favourite trap. Node already uses threads internally, in a pool of native threads provided by **libuv** (the C library under the event loop). They are two different things:

| | libuv thread pool | `worker_threads` |
|---|---|---|
| What it is | 4 native threads by default | threads that run YOUR JavaScript |
| Used for | `fs` calls, `dns.lookup`, `crypto.pbkdf2`/`scrypt`, `zlib` (when called asynchronously) | whatever code you give a `Worker` |
| Who starts it | Node, automatically and lazily | you, with `new Worker` |
| Size | 4 unless you set the environment variable `UV_THREADPOOL_SIZE` before Node starts | as many as you create |
| Runs JavaScript | never | yes, each with its own event loop |

That is why case 3 in example 01 (`crypto.pbkdf2` with a callback) did not freeze the heartbeat, with no worker in sight. Lesson [08](../08-event-loop/README.md) measures the pool size of 4. Setting `process.env.UV_THREADPOOL_SIZE` inside the script is not guaranteed to work; set it in the environment that starts Node.

## 10. cluster: many processes, one port

`worker_threads` lets one process use several cores for CPU jobs. A different problem is a web server that gets many requests: with one process, only one core runs your JavaScript. The **`cluster`** module solves it by starting several copies of your program, as separate **processes**, that all listen on the **same port**.

- The first process is the **primary** (older code and articles say "master": `cluster.isMaster` still exists as a deprecated alias of `cluster.isPrimary`, which the docs list as added in Node 16.0.0; old code and tutorials use `isMaster`).
- `cluster.fork()` starts a **worker** process: a new Node process that runs the same file again. In it `cluster.isPrimary` is `false` and `cluster.isWorker` is `true`.
- Workers are real processes, with their own memory and their own pid. They talk to the primary over an IPC channel, a private message pipe (it is `child_process.fork` underneath).

`examples/09-cluster-basics.js` forks 2 workers, sends 8 requests, then shuts everything down:

```js
if (cluster.isPrimary) {
  for (let i = 0; i < 2; i++) cluster.fork();          // each fork() runs THIS file again
  cluster.on('listening', (worker, address) => { /* when both listen: send requests */ });
  // later: for (const worker of Object.values(cluster.workers)) worker.disconnect();
} else {
  http.createServer((req, res) => {
    res.end(JSON.stringify({ workerId: cluster.worker.id, pid: process.pid }));
  }).listen(0);   // port 0: any free port; ALL workers get the same one
}
```

```text
primary 16628: scheduling policy on win32 is the operating system decides (SCHED_NONE)
primary: 2 workers are listening, number of different ports: 1
primary: 8 requests were served like this: { 'worker 2': 8 }
primary: all workers exited (last one: code 0, exitedAfterDisconnect true)
```

The pid in the first line differs on every run. Line by line:
- Both workers called `listen(0)` and the primary reports **one** port in total. That is **port sharing**: the primary creates the listening socket and hands it to the workers. Nothing in the worker code knows about this.
- `exitedAfterDisconnect` is `true` because the primary asked the worker to leave with `worker.disconnect()`. When it is `false`, the worker died by itself or was stopped with `worker.kill()` (section 11).
- When the last worker is gone, the primary has nothing left to wait for and the program ends.

### The cluster API at a glance

| Name | Where | Meaning |
|---|---|---|
| `cluster.isPrimary` / `cluster.isWorker` | both | which side of the program am I on |
| `cluster.fork(env?)` | primary | start a worker process that runs the same file again; returns a `Worker` object |
| `cluster.workers` | primary | the live workers, as an object keyed by worker id |
| `cluster.worker` | worker | this process's own `Worker` object (`cluster.worker.id` is 1, 2, 3...) |
| `worker.process.pid` | primary | the operating-system pid of that worker |
| `worker.send(msg)` / `process.send(msg)` | primary / worker | an IPC message to the other side (the other side listens with `'message'`) |
| `worker.disconnect()` | primary | the graceful leave: close servers, finish running requests, then exit |
| `worker.kill(signal?)` | primary | the rough stop, no waiting for requests |
| `cluster.disconnect(callback?)` | primary | `disconnect()` on every worker; the callback runs when all are disconnected |
| `cluster.setupPrimary(settings)` | primary | change what `fork()` starts, for example `exec`, `args`, `execArgv`, `silent`, `serialization` |
| events `fork`, `online`, `listening`, `message`, `disconnect`, `exit` | primary | `fork`: process created. `online`: your code is running. `listening`: it called `listen()`. `message`: an IPC message arrived. `disconnect`: the IPC pipe closed. `exit`: the process is gone. For one worker, `fork`, `online`, `listening` come first in this order, `message` can arrive any time after `online`, and `disconnect` then `exit` come last |

Two details that interviewers like. `online` means "the worker process started running your code"; `listening` means "it called `listen()`, so it can accept connections". Wait for `listening`, not `online`, before you send traffic. And cluster messages between primary and worker are encoded as JSON by default, so a `Map` arrives as an empty object `{}`. `cluster.setupPrimary({ serialization: 'advanced' })` switches to structured clone, the same rules as section 3 (both modes were checked on Node 24).

### How are connections spread over the workers?

There are two scheduling policies:

| Policy | How it works | Default on |
|---|---|---|
| `SCHED_RR` (round-robin) | the primary accepts each connection and passes it to the next worker in turn | Linux, macOS and everything except Windows |
| `SCHED_NONE` | the primary shares the listening socket and the workers accept connections themselves, so the operating system decides | **Windows** |

This is documented behaviour; the numbers in this lesson were measured on Windows. In the run above the OS gave all 8 requests to one worker (`{ 'worker 2': 8 }`). On Windows that is normal: it often favours one worker. You can force a policy with the `NODE_CLUSTER_SCHED_POLICY` environment variable (`rr` or `none`):

```bash
# bash (Linux, macOS, Git Bash)
NODE_CLUSTER_SCHED_POLICY=rr node lessons/18-worker-threads-and-cluster/examples/09-cluster-basics.js
# PowerShell
$env:NODE_CLUSTER_SCHED_POLICY='rr'; node lessons/18-worker-threads-and-cluster/examples/09-cluster-basics.js
```

```text
primary 26912: scheduling policy on win32 is round-robin (SCHED_RR)
primary: 2 workers are listening, number of different ports: 1
primary: 8 requests were served like this: { 'worker 1': 4, 'worker 2': 4 }
primary: all workers exited (last one: code 0, exitedAfterDisconnect true)
```

(In PowerShell, run `Remove-Item Env:NODE_CLUSTER_SCHED_POLICY` afterwards to go back to the default.) The policy is a global setting that is fixed once the first worker is forked, so set it before `fork()`.

> **Interview tip:** round-robin balances **connections**, not requests. A browser with a keep-alive connection keeps talking to one worker, so one busy client can still load one worker more than the others. The docs also warn that the operating-system policy (`SCHED_NONE`) tends to distribute very unevenly "due to operating system scheduler vagaries", so round-robin is the default everywhere except Windows. The docs say Windows will switch to round-robin once libuv can do that efficiently on Windows.

Each worker is a full Node process: a copy of your code, its own heap, its own caches. 8 workers use roughly 8 times the memory of one. That leads to the central limit of this design: **workers share nothing.** A `Map` filled in worker 1 does not exist in worker 2 (section 12).

## 11. cluster in production: restart on crash and graceful reload

A worker can die: an uncaught exception, an out-of-memory kill, a bug in a native library. The primary should notice and start a replacement. Then, when you deploy new code, you want to replace all workers without dropping requests.

`examples/10-cluster-restart-and-reload.js` does both. First the self-healing rule:

```js
cluster.on('exit', (deadWorker, code) => {
  if (shuttingDown || deadWorker.exitedAfterDisconnect) return; // we asked it to leave: fine
  console.log(`primary: a worker crashed (exit code ${code}), starting a replacement`);
  cluster.fork();
});
```

Then the **rolling reload**: replace the workers one at a time, new one first:

```js
for (const oldWorker of Object.values(cluster.workers)) {
  const fresh = cluster.fork();
  await once(fresh, 'listening');        // 1) the new worker is ready ...
  const gone = once(oldWorker, 'exit');
  oldWorker.disconnect();                // 2) ... only then the old one stops taking new connections
  await gone;                            // 3) and leaves after finishing what it is doing
}
```

While this runs, the example sends a request every 15 ms and keeps one 600 ms request in flight. A `/crash` request makes a worker call `process.exit(1)` first. The example sets `cluster.schedulingPolicy = cluster.SCHED_RR` at the start, so it behaves the same on every platform (see the caution below). Output (it was identical in 30 repeated runs):

```text
primary: 2 workers are up (ids 1, 2)

--- Part 1: a worker crashes ---
primary: a worker crashed (exit code 1), starting a replacement
client: the request to /crash failed, as expected: true
primary: replacement worker 3 is listening
primary: live workers now: 2

--- Part 2: rolling reload while requests keep arriving ---
primary: worker 4 is up and an old worker has left
primary: worker 5 is up and an old worker has left

the slow request that was running during the reload: finished normally
requests sent during the reload : more than 10
requests that failed            : 0
some served by new workers      : true

primary: all workers gone, bye
```

Why no request failed: the new worker was already listening before any old one was told to leave, and `worker.disconnect()` is a **graceful** leave. In a worker it closes the servers (no new connections) and waits until the running requests are done, then closes the IPC channel, and the process exits when nothing is left to do. The slow request finished normally.

Details that matter in real life:
- `worker.disconnect()` is the graceful way. `worker.kill()` is the rough way: the docs say it kills the worker process "without waiting for a graceful disconnect" (it works like `worker.process.kill()`, default signal `SIGTERM`). In a test on Windows it stopped the worker at once, a request that was still running failed with `ECONNRESET`, and `exitedAfterDisconnect` stayed `false`. On Linux and macOS an unhandled `SIGTERM` also ends the process at once (not measured here). Use `disconnect()` first and `kill()` as the fallback after a timeout.
- Idle keep-alive connections can stop a worker from finishing. Since Node 19, `server.close()` also closes idle connections, and `server.closeIdleConnections()` does it explicitly. The docs note that `disconnect()` only closes the worker's servers: outgoing client connections are not closed for you.
- **Caution (Windows):** with the Windows default `SCHED_NONE`, a rolling reload is not fully clean. Without the `SCHED_RR` line, example 10 showed one failed request (`ECONNRESET`) in roughly 1 run out of 7 to 20 on the test machine, probably a connection that the operating system had already handed to a worker that was just leaving. With `SCHED_RR` there were 0 failures in 85 runs. This is measured, not documented. The lesson is general: test a reload under traffic on the platform and scheduling policy you deploy to, and let clients retry **idempotent** requests (requests that are safe to repeat, such as GET).
- Add a **backoff** to the restart rule: wait a bit longer after each failure, and give up after too many. If a worker crashes right at startup, `cluster.fork()` in the `exit` handler becomes an endless crash loop that burns CPU.
- **After an uncaught exception, do not carry on.** The process may be in a half-finished state (a locked resource, a request that will never be answered), and the Node docs say it is not safe to resume normal operation. The safe pattern: log the error, stop accepting connections, exit, and let the primary start a fresh worker with the `exit` rule above.
- **Stopping the whole cluster.** In the primary, call `cluster.disconnect(callback)` when your process manager asks you to stop. Every worker leaves gracefully, the callback runs when all are disconnected, and the primary ends by itself (checked on Node 24).

> **Interview tip:** "How do you deploy a new version of a cluster app with no downtime?" Strong answer: start a new worker, wait until it is `listening`, then `disconnect()` one old worker (it finishes its running requests), repeat for each worker. Mention the restart rule with a backoff, and that clients should retry safe requests. `pm2 reload` or a rolling update in Kubernetes does the same thing for you.

### Graceful shutdown of one process

When a process manager or orchestrator wants a process to stop, it sends a signal first (usually `SIGTERM`) and kills the process later if it is still alive. Your job: stop taking new work, finish the running work, then exit. The code below was tested by calling `shutdown()` by hand. On Linux and macOS the signals come from the process manager. On Windows there are no real signals: a `SIGTERM` sent with `process.kill` terminates the process at once and the handler never runs (checked on Node 24; the docs say `SIGINT`, for example from Ctrl+C, is supported on all platforms), so test the handler on a Linux or macOS machine or in a container:

```js
const http = require('node:http');

const server = http.createServer((req, res) => res.end('ok'));
server.listen(0, () => {
  console.log('listening');
  shutdown('manual test'); // in real life this is called from a signal handler
});

function shutdown(reason) {
  console.log('shutting down:', reason);
  server.close(() => {
    console.log('all connections finished');
    process.exit(0);
  });
  server.closeIdleConnections(); // drop idle keep-alive sockets so close() can finish
  setTimeout(() => {
    console.error('forced exit: some connections did not finish in time');
    process.exit(1);
  }, 10_000).unref(); // unref: this timer alone must not keep the process alive
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

```text
listening
shutting down: manual test
all connections finished
```

## 12. Stateless design, sticky sessions and WebSockets

Starting more copies of your app only works if **any copy can answer any request**. If a copy keeps something in its own memory that the others need, scaling out breaks. `examples/12-state-and-sticky.js` shows it. It starts two server instances (worker threads, each with its own memory, like two cluster workers or two containers). One user visits 4 times through a round-robin **balancer** (a load balancer: a program in front of your servers that spreads the requests, here by alternating between the two). The app counts the visits.

```text
A) state in each process memory + round-robin balancer
  visit 1 went to server-1, the app says "you have visited 1 time(s)"
  visit 2 went to server-2, the app says "you have visited 1 time(s)"
  visit 3 went to server-1, the app says "you have visited 2 time(s)"
  visit 4 went to server-2, the app says "you have visited 2 time(s)"
  -> WRONG: 1,1,2,2 instead of 1,2,3,4

B) state in process memory + sticky routing (same user, same server)
  visit 1 went to server-1, the app says "you have visited 1 time(s)"
  visit 2 went to server-1, the app says "you have visited 2 time(s)"
  visit 3 went to server-1, the app says "you have visited 3 time(s)"
  visit 4 went to server-1, the app says "you have visited 4 time(s)"
  -> correct: 1,2,3,4

C) stateless servers + one shared store + round-robin balancer
  visit 1 went to server-1, the app says "you have visited 1 time(s)"
  visit 2 went to server-2, the app says "you have visited 2 time(s)"
  visit 3 went to server-1, the app says "you have visited 3 time(s)"
  visit 4 went to server-2, the app says "you have visited 4 time(s)"
  -> correct: 1,2,3,4
```

- **A** is the bug. Each instance counts alone, so the user sees a number that jumps around. A login session kept in a `Map` behaves the same way: log in on worker 1, the next request lands on worker 2, and you are logged out.
- **B** is a **sticky session**: the balancer always sends the same user to the same instance (the example picks the server from a hash of the session id). The counter is right, but the design is fragile. If that instance restarts, the count is gone. Load can become uneven. Reloads get harder.
- **C** is the real fix: **stateless servers**. The server keeps nothing between requests; the shared state lives outside. (The example uses a shared memory cell as a stand-in for a real shared store such as Redis or a database.)

What counts as "state in memory" that breaks when you scale: sessions, caches that must agree, rate-limit counters, WebSocket rooms, uploads in progress, locks, and also `setInterval` jobs (a daily report job would run once per instance).

| Kind of state | Where it should live |
|---|---|
| user sessions | a shared store (Redis, database) or a signed token such as a JWT in a cookie |
| caches | a shared cache, or accept that each instance has its own (and that is fine for pure caches) |
| rate limits, counters, locks | a shared store with atomic operations |
| uploaded files | object storage or a shared disk, not the local disk of one instance |
| scheduled jobs | one dedicated instance, or a queue with one consumer per job |

### Sticky sessions and WebSockets

`cluster` has no built-in sticky routing: round-robin hands connections out in turn. If you really need stickiness, put a balancer in front that supports it, for example nginx with `ip_hash` (it picks the server from the client IP). The catch: everybody behind one public IP (an office, a mobile network gateway) lands on the same server, so the load can become uneven. Balancers can also stick by a cookie instead.

```nginx
# Illustrative nginx configuration, not run in this repo
upstream app {
    ip_hash;
    server 127.0.0.1:3001;
    server 127.0.0.1:3002;
}
```

WebSockets need a closer look:
- One WebSocket is one long TCP connection, so it stays on one worker. That part works with plain cluster.
- Libraries that start with HTTP long-polling and upgrade later (Socket.IO does this) send several HTTP requests for one session. Those requests must reach the same worker, so sticky sessions are required there. The Socket.IO docs say that limiting the client to the WebSocket transport removes this requirement, at the price of clients on restrictive networks (some proxies block WebSockets) not being able to connect.
- Even then, a message sent to "everyone in room X" only reaches the clients connected to the SAME worker. To reach clients on other workers or other machines you need an **adapter**: a small piece that uses publish/subscribe (one instance publishes a message, every other instance receives it), for example with Redis, so that instances forward broadcasts to each other. The Socket.IO docs say the same.

> **Interview tip:** "what do you need to scale a Node app horizontally?" The real answer is **stateless services**, not a clever load balancer. Sticky sessions are a workaround, not a design.

## 13. child_process.fork versus cluster versus worker_threads

Node gives you three ways to run more JavaScript at the same time. `examples/11-fork-vs-worker.js` compares a forked child process and a worker thread side by side:

```text
--- Part 1: who runs where? ---
main thread    pid 30148  same process as main: true  sees main's global: set by the main thread
Worker         pid 30148  same process as main: true  sees main's global: undefined
fork() child   pid 10064  same process as main: false sees main's global: undefined
the forked child's parent pid is the main pid: true

--- Part 2: what happens to a Map and a Date in a message? ---
fork, default (JSON)   : Map stays Map: false, Date stays Date: false
fork, 'advanced'       : Map stays Map: true, Date stays Date: true
Worker postMessage     : Map stays Map: true, Date stays Date: true

--- Part 3: sharing memory ---
Worker wrote 99 into a SharedArrayBuffer, the parent now reads: 99
sending a SharedArrayBuffer to a fork() child fails: #<SharedArrayBuffer> could not be cloned.

--- Part 4: startup cost (average of 5 starts, time until the first message) ---
fork()  : about 234 ms
Worker  : about 120 ms
```

(The pids change on every run; the startup numbers come from a busy machine, so only the comparison matters.) What it shows:
- A worker thread has the same pid as the parent. A forked child is a separate process with its own pid. Neither sees the parent's global variable.
- `fork()` messages use JSON by default (so a `Map` turns into `{}` and a `Date` into a string). With `{ serialization: 'advanced' }` they use structured clone, like worker messages.
- Threads can share memory. Processes cannot: sending a `SharedArrayBuffer` to a child throws.
- A process is slower and heavier to start than a thread.

| | `worker_threads` | `child_process.fork` | `cluster` |
|---|---|---|---|
| Unit | thread in the same process | separate process | separate processes (built on `fork`) |
| Memory | own heap, but can share `SharedArrayBuffer` | fully isolated | fully isolated |
| Start cost | lower (roughly 70 to 200 ms and 9 MB each on this machine) | higher (roughly 230 to 450 ms here, a whole Node process) | higher (a whole Node process) |
| Share data | copy, transfer, or shared memory | messages only (JSON or structured clone) | messages only |
| A hard crash | an uncaught error is an event; but a crash in native code can take the whole process down | only the child dies | only that worker dies |
| Network port | not meant for sharing a server port | not shared | **shared automatically** |
| Typical use | CPU-bound jobs (hashing, parsing, image work), pools | run a separate script or other program, isolation, untrusted work | use all cores for an HTTP server |

How to choose in one line each: CPU job inside a request: `worker_threads`. Many copies of a server on one port: `cluster` (or the same idea in PM2 or containers). A job that must be isolated or is not Node at all: `child_process` (`fork` for Node scripts, `spawn` for other programs).

> **Remember:** `cluster` is not a different mechanism from `fork`; it is `fork` plus a shared server socket plus worker management helpers. And `worker_threads` is not a replacement for `cluster`: one speeds up CPU jobs, the other multiplies a server across cores.

Lesson [15](../15-processes-and-cli/README.md) covers `child_process` in more detail.

## 14. PM2 and containers as alternatives

Writing `cluster` code yourself is optional. Two common ways to get "one process per core" without it (snippets only, not run in this repo):

**PM2** is a process manager for servers on a VM or bare metal. Its cluster mode runs your app with Node's `cluster` module underneath, so the same rules apply: shared port, no shared memory, stateless design.

```bash
# Needs: npm install -g pm2   (illustrative)
pm2 start server.js -i max     # cluster mode, one process per CPU
pm2 reload server              # zero-downtime reload, one process at a time
pm2 scale server 4             # change the number of processes
```

```js
// ecosystem.config.js (illustrative)
module.exports = {
  apps: [{ name: 'server', script: './server.js', instances: 'max', exec_mode: 'cluster', max_memory_restart: '300M' }],
};
```

**Containers** (Docker, Kubernetes) are the usual modern answer: run ONE Node process per container, and scale by running more containers behind a load balancer.

```yaml
# Illustrative Kubernetes Deployment excerpt: 4 copies of one container
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
spec:
  replicas: 4
  selector:
    matchLabels: { app: api }
  template:
    metadata:
      labels: { app: api }
    spec:
      containers:
        - name: api
          image: example/api:1.0.0
          resources:
            limits: { cpu: "1", memory: 512Mi }
```

| | `cluster` / PM2 | containers + orchestrator |
|---|---|---|
| Restart a crashed process | your code or PM2 | the orchestrator |
| Rolling deploy | `pm2 reload`, or your reload code | built in |
| Scale beyond one machine | no | yes |
| Resource limits per copy | little | CPU and memory limits per container |
| Cost | simple, one machine | more moving parts |

The need for stateless design is the same in all of them. In an interview, the strongest answer names the trade-off: "cluster or PM2 on one box, containers when we need several machines, stateless services either way".

> **Interview tip:** "Should I run PM2 cluster mode inside a Docker container?" Usually not. The orchestrator already restarts crashed containers and scales them, so a second supervisor inside the container only hides problems. Run one Node process per container, give the container a CPU limit, and scale the number of containers. PM2 cluster mode fits best on a plain server or VM that you manage yourself. (The PM2 commands above match the PM2 docs; they were not run here.)

## 15. Decision flowchart (in text)

```
Is the slow part WAITING (database, network, disk)?
|
+-- yes -> do NOT add threads. Use async I/O, connection pools, caching, batching.
|          (Need more throughput on one machine? Run several processes, see below.)
|
+-- no, it is CPU work (hashing, parsing, image resize, compression, big loops)
     |
     +-- Is it short (a few ms) and rare?     -> keep it on the main thread, or split it into chunks.
     |
     +-- Many tiny tasks (microseconds each)? -> do NOT send them one by one. Batch many items into
     |                                           one task, or keep them inline.
     |
     +-- Does it happen on many requests?     -> worker pool (hand-made or piscina),
     |                                           size about os.availableParallelism().
     |
     +-- Is it one rare, very long job?       -> a single Worker, or another service.
     |
     +-- Must the threads share big data?     -> SharedArrayBuffer + Atomics (careful!).
     |                                           Otherwise transfer ArrayBuffers.

Need to use all CPU cores for an HTTP server?
|
+-- is the app stateless (sessions in Redis or tokens, no shared in-memory data)?
|    |
|    +-- no  -> fix that first. (Sticky sessions only as a short-term workaround.)
|    +-- yes -> run N copies: cluster / PM2 on one machine, or N containers behind a balancer.
|
+-- Need isolation, a separate program, or code that can crash hard? -> child_process.
```

## 16. Common interview questions

**1. Is Node.js single-threaded?**
JavaScript runs on a single main thread driven by one event loop, but the process has more threads: V8 helper threads, the libuv thread pool (4 threads by default) for `fs`, `dns.lookup`, `crypto` and `zlib`, and any `Worker` you start. Say "single-threaded event loop", not "single-threaded".

**2. How do you do CPU-heavy work without blocking the event loop?**
First confirm it is CPU work. Then run it off the main thread: a `worker_threads` pool for hot paths (reuse workers, queue tasks, size about the CPU count), or move it to another service or a job queue. Chunking with `setImmediate` helps only for work that can be split.

**3. `worker_threads` or `cluster` or `child_process`?**
Threads: CPU jobs, can share memory, light start. `cluster`: many copies of one server sharing a port, processes with isolated memory. `child_process`: separate programs or strong isolation. Mention that `cluster` is built on `fork`.

**4. How does `cluster` share one port, and how are connections distributed?**
The primary owns the listening socket. With round-robin (default except on Windows) it accepts connections and passes each to the next worker. With `SCHED_NONE` (Windows default) workers accept from the shared socket and the OS decides, which can be uneven. It balances connections, not requests.

**5. How do you reload a cluster without dropping requests?**
Start a new worker, wait for its `listening` event, then `disconnect()` one old worker (it stops taking connections, finishes running requests, exits). Repeat for each worker. Restart crashed workers from the `exit` event, with a backoff.

**6. What do you need to scale a Node service horizontally?**
Stateless instances: sessions, caches, counters, rooms and files live outside the process (Redis, a database, object storage, tokens). Then any instance can serve any request. Sticky sessions are a workaround.

**7. What is a `SharedArrayBuffer`, and why do you need `Atomics`?**
It is memory visible to several threads without copying. Plain reads and writes can interleave and lose updates (`counter++` is three steps), so you use `Atomics.add`, `compareExchange`, and `wait`/`notify` for indivisible operations and signalling. `Atomics.wait` blocks, so never on the main thread of a server.

**8. What is the difference between the libuv thread pool and worker threads?**
The pool is native threads that Node uses internally for some async operations (default size 4, `UV_THREADPOOL_SIZE`). They never run your JavaScript. Workers are threads that run your JavaScript, each with its own isolate and event loop.

**9. Would worker threads speed up an API that mostly calls a database?**
No. That work is I/O-bound; the event loop already overlaps the waits. Threads would add startup cost, memory and message copying. Look at queries, indexes, pooling and caching instead.

**10. What happens when a worker thread throws?**
The parent gets an `'error'` event, then `'exit'` with code 1; the parent process keeps running. A pool must reject the task that was running and start a replacement. `resourceLimits` turns an out-of-memory worker into an error instead of a crash of the whole process.

### Follow-up questions after the basics

**11. Transfer or share?**
Transfer moves ownership of an `ArrayBuffer`: no copy, one owner at a time, the sender's buffer is detached. A `SharedArrayBuffer` is visible to several threads at once, so it needs `Atomics` to avoid races. Transfer for hand-offs between stages, sharing for many threads working on the same data.

**12. How do you add a timeout to a task in a worker pool?**
A worker stuck in a loop never reads messages, so a message cannot stop it. Start a timer when the task starts; when it fires, call `worker.terminate()`, reject that task, and let the pool start a replacement. A timer plus `terminate()` is the only hard stop.

**13. Can you use `cluster` and `worker_threads` together?**
Yes: cluster gives several copies of the server, and each copy may own a small pool for CPU jobs. Keep an eye on the total: processes times pool size should stay near the CPU count, or the threads fight for the cores.

**14. Why does a Socket.IO app need sticky sessions with several servers?**
Its default transport starts with several HTTP long-polling requests for one session, and they must reach the same server. With only the WebSocket transport the requirement goes away. For broadcasting to rooms across servers you still need an adapter (for example Redis pub/sub).

**15. A worker crashes right after it starts. What does `cluster.on('exit', () => cluster.fork())` do?**
It forks again at once, the new worker crashes too, and you get an endless crash loop that burns CPU and fills the logs. Add a backoff (wait longer after each crash), a limit on restarts per minute, and an alert.

**16. Walk me through a graceful shutdown.**
On `SIGTERM`: stop accepting new connections (`server.close()`), close idle keep-alive sockets (`server.closeIdleConnections()`), wait for running requests, then exit. Set a deadline timer (with `unref()`) that forces exit if something hangs. In a cluster, the primary calls `cluster.disconnect()` and every worker does the same in turn.

**17. How do cluster workers share a cache?**
They cannot share memory. Options: each worker keeps its own cache (fine for pure caches, but they can disagree), a shared cache such as Redis, or the primary holds the data and workers ask over IPC (works, but the primary becomes a bottleneck and a single point of failure).

## Summary / Key takeaways
- CPU-bound JavaScript freezes the one event loop; waiting for I/O does not. Do not add threads for I/O-bound work.
- A `Worker` is a thread with its own isolate and event loop. Messages are copied with structured clone (no functions, no class prototypes); `transferList` moves an `ArrayBuffer` without copying; a `SharedArrayBuffer` is real shared memory.
- Shared memory needs `Atomics`. `counter++` loses updates; `Atomics.add` does not. `Atomics.wait` blocks, so keep it off the main thread.
- Never start a worker per request. Use a pool with a queue, size about `os.availableParallelism()`, and replace workers that crash. `piscina` is the ready-made option.
- `cluster` starts several processes that share one port. The default scheduling is round-robin everywhere except Windows, where the OS decides. Restart crashed workers from `exit` and reload with `worker.disconnect()` one at a time.
- Scaling out needs stateless services. In-memory sessions break across workers; sticky sessions are a workaround, and WebSocket broadcasts need a pub/sub adapter.
- The libuv thread pool is not `worker_threads`. Threads share memory; processes do not. PM2 cluster mode and containers solve the same problem as `cluster`.
- A stuck task can only be stopped by `terminate()`, so a pool needs timeouts, a queue limit and bigger (batched) tasks. With cluster plus pools, processes times threads per process should stay near the CPU count.

## Quick check

1. Why does one slow `for` loop in a request handler slow down every other request, while an `await fetch(...)` that takes the same time does not?
<details><summary>Answer</summary>

The loop is JavaScript running on the single main thread, so the event loop cannot run anything else until it ends. While `fetch` waits, the thread is free and the loop serves other work. CPU-bound work occupies the thread; I/O-bound work only waits.

</details>

2. What does `worker.postMessage(obj)` do with `obj`, and what happens to a class instance sent this way?
<details><summary>Answer</summary>

It copies `obj` with the structured clone algorithm, so the worker gets its own deep copy. A class instance arrives as a plain object: the prototype and its methods are gone. Functions and symbols cannot be cloned and make `postMessage` throw `DataCloneError`.

</details>

3. After `worker.postMessage(buf, [buf])`, what is `buf.byteLength` in the sender, and why is this faster than a normal send?
<details><summary>Answer</summary>

It is `0`: the `ArrayBuffer` is detached because ownership moved to the worker. Nothing is copied, only the ownership of the memory block, so it costs almost nothing even for 64 MiB.

</details>

4. Four workers run `counter[0]++` 500,000 times each on a shared `Int32Array`. Why is the final number below 2,000,000, and how do you fix it?
<details><summary>Answer</summary>

`counter[0]++` is read, add, write. Two threads can read the same old value and both write the same new value, losing one increment. Use `Atomics.add(counter, 0, 1)` so each increment is one indivisible step.

</details>

5. Why should a server use a worker pool instead of `new Worker()` per request?
<details><summary>Answer</summary>

A worker costs tens of milliseconds to start and several MB of memory, and many at once compete for the CPUs. A pool starts a fixed number once, reuses them, and queues extra tasks, so cost and concurrency stay bounded.

</details>

6. How does `cluster` spread connections on Linux and on Windows?
<details><summary>Answer</summary>

On Linux and macOS the default is round-robin (`SCHED_RR`): the primary accepts each connection and gives it to the next worker. On Windows the default is `SCHED_NONE`: workers accept from the shared socket and the operating system decides, which can be very uneven. `NODE_CLUSTER_SCHED_POLICY=rr` or `none` overrides it.

</details>

7. You store logged-in sessions in a `Map` and run 4 cluster workers. What goes wrong, and what are the fixes?
<details><summary>Answer</summary>

Each worker has its own `Map`, so a request that lands on another worker does not find the session and the user looks logged out. Fixes: keep sessions in a shared store (Redis, a database) or in a signed token, which makes the services stateless. Sticky sessions can hide the problem but lose sessions on restart.

</details>

8. In a cluster, what is the difference between `worker.disconnect()` and `worker.kill()`, and what does `worker.exitedAfterDisconnect` tell you?
<details><summary>Answer</summary>

`disconnect()` is graceful: the worker stops taking new connections, finishes the running requests, closes the IPC channel and exits. `kill()` stops the process without waiting. `exitedAfterDisconnect` is `true` only if the worker left because of `disconnect()`, so the `exit` handler uses it to tell "we asked it to leave" from "it crashed", and only restarts in the second case.

</details>

9. You call `worker.postMessage(small, [small.buffer])` where `small = Buffer.from('abc')`. Why does it throw?
<details><summary>Answer</summary>

Small Buffers live inside a shared 8 KiB pool (`buf.buffer.byteLength` is 8192), and Node marks that pool as not transferable, so you get a `DataCloneError`. Allocate data you want to transfer on its own: `Buffer.alloc(n)` or `new Uint8Array(n)`.

</details>

10. What does `Atomics.wait` do, and why is calling it on the main thread of a server a bad idea?
<details><summary>Answer</summary>

It puts the calling thread to sleep while a shared cell has an expected value, until `Atomics.notify` or a timeout. On the main thread it blocks the event loop completely, so no requests or timers run (the heartbeat in the example got 0 ticks). Use it only in workers, with a timeout.

</details>

## Try it yourself

**Task 1 (easy): compute in a worker.** Write one file that, when run, starts a `Worker` (same file) to compute `fib(38)` with the slow recursive version, prints the result, and also shows that a timer on the main thread kept ticking while the worker worked.

<details><summary>Hint</summary>

Use `isMainThread` to choose the side. Pass 38 with `workerData`, send the answer with `parentPort.postMessage`. Start a `setInterval` that counts ticks before creating the worker, and clear it in the `message` handler.

</details>

<details><summary>Solution</summary>

```js
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

function fib(n) {
  return n < 2 ? n : fib(n - 1) + fib(n - 2);
}

if (isMainThread) {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 50);

  const worker = new Worker(__filename, { workerData: 38 });
  worker.on('message', (result) => {
    clearInterval(timer);
    console.log('fib(38) =', result);
    console.log('the main thread kept ticking while the worker worked:', ticks > 0);
  });
  worker.on('error', (err) => {
    clearInterval(timer);
    console.error('worker failed:', err.message);
  });
} else {
  parentPort.postMessage(fib(workerData));
}
```

```text
fib(38) = 39088169
the main thread kept ticking while the worker worked: true
```

</details>

**Task 2 (medium): parallel work on shared memory.** Put 1,000,000 numbers in a `SharedArrayBuffer` (use `(i * 2654435761) % 5_000_000` so the data is the same every run). Count how many are prime, first on one thread, then with 4 workers that each take one quarter of the array. Check that both answers are equal and print both timings. Nothing may be copied between threads.

<details><summary>Hint</summary>

Create `new Int32Array(sharedBuffer)` in the main thread and fill it. Send the `SharedArrayBuffer` plus `start` and `end` indexes through `workerData`. Each worker builds its own `Int32Array` view over the same memory and sends back one number (its count). Add the 4 counts in the main thread.

</details>

<details><summary>Solution</summary>

```js
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

const COUNT = 1_000_000; // how many numbers
const WORKERS = 4;

function isPrime(n) {
  if (n < 2) return false;
  for (let d = 2; d * d <= n; d++) if (n % d === 0) return false;
  return true;
}

function countPrimes(numbers, start, end) {
  let count = 0;
  for (let i = start; i < end; i++) if (isPrime(numbers[i])) count++;
  return count;
}

if (isMainThread) {
  // Fill a shared array with fixed, repeatable "random" numbers below 5 million.
  const shared = new SharedArrayBuffer(COUNT * 4);
  const numbers = new Int32Array(shared);
  for (let i = 0; i < COUNT; i++) numbers[i] = (i * 2654435761) % 5_000_000;

  let started = performance.now();
  const expected = countPrimes(numbers, 0, COUNT);
  console.log(`one thread : ${expected} primes in ${Math.round(performance.now() - started)} ms`);

  started = performance.now();
  const slice = Math.ceil(COUNT / WORKERS);
  const parts = [];
  for (let w = 0; w < WORKERS; w++) {
    parts.push(
      new Promise((resolve, reject) => {
        const worker = new Worker(__filename, {
          workerData: { shared, start: w * slice, end: Math.min(COUNT, (w + 1) * slice) },
        });
        worker.once('message', resolve);
        worker.once('error', reject);
      }),
    );
  }
  Promise.all(parts).then((counts) => {
    const total = counts.reduce((a, b) => a + b, 0);
    console.log(`${WORKERS} workers : ${total} primes in ${Math.round(performance.now() - started)} ms`);
    console.log('same answer:', total === expected);
  });
} else {
  const { shared, start, end } = workerData;
  parentPort.postMessage(countPrimes(new Int32Array(shared), start, end)); // reads shared memory, nothing is copied
}
```

```text
one thread : 69446 primes in 1272 ms
4 workers : 69446 primes in 543 ms
same answer: true
```

The counts are always the same; the timings depend on how busy your machine is. Workers only read the array, so no `Atomics` are needed. With a smaller `COUNT` the 4 workers can even be slower, because starting threads costs more than the work saves.

</details>

**Task 3 (harder): count requests across cluster workers.** Write a `cluster` program with 2 workers that each run an HTTP server on a shared port. Every time a worker serves a request, it tells the primary with `process.send({ type: 'hit' })`. The primary sends 20 requests, then disconnects the workers, and when the last worker has exited it prints how many hits each worker reported and the total (it must be 20). The program must end by itself.

<details><summary>Hint</summary>

In the primary, attach `worker.on('message', ...)` right after each `cluster.fork()` and keep a `Map` from `worker.id` to a count. Wait for both `listening` events before sending requests (use `http.get` with `agent: false`). Send the IPC message BEFORE ending the response. Count `exit` events to know when the last worker is gone.

</details>

<details><summary>Solution</summary>

```js
const cluster = require('node:cluster');
const http = require('node:http');

const WORKERS = 2;
const REQUESTS = 20;

if (cluster.isPrimary) {
  const hits = new Map(); // worker id -> number of requests it reported
  let listening = 0;
  let exited = 0;

  for (let i = 0; i < WORKERS; i++) {
    const worker = cluster.fork();
    worker.on('message', (msg) => {
      if (msg.type === 'hit') hits.set(worker.id, (hits.get(worker.id) || 0) + 1);
    });
  }

  cluster.on('listening', async (worker, address) => {
    if (++listening < WORKERS) return;
    for (let i = 0; i < REQUESTS; i++) await get(address.port);
    for (const w of Object.values(cluster.workers)) w.disconnect();
  });

  cluster.on('exit', () => {
    if (++exited < WORKERS) return;
    const total = [...hits.values()].reduce((a, b) => a + b, 0);
    console.log('hits per worker:', Object.fromEntries([...hits].sort()));
    console.log('total:', total, total === REQUESTS ? '(correct)' : '(wrong)');
  });
} else {
  http
    .createServer((req, res) => {
      process.send({ type: 'hit' }); // tell the primary
      res.end('ok');
    })
    .listen(0);
}

function get(port) {
  return new Promise((resolve, reject) => {
    http.get({ port, host: '127.0.0.1', agent: false }, (res) => res.resume().on('end', resolve)).on('error', reject);
  });
}
```

```text
hits per worker: { '2': 20 }
total: 20 (correct)
```

On Windows the default scheduling often gives all requests to one worker, as in this run (which worker, `'1'` or `'2'`, differs between runs). With `NODE_CLUSTER_SCHED_POLICY=rr` the same program printed `{ '1': 10, '2': 10 }` on Windows; on Linux or macOS (round-robin by default, not measured here) you should see the 20 hits split about evenly. The total is 20 either way. This is the standard pattern for shared numbers in a cluster: workers report, the primary (or a shared store) adds up.

</details>

## Where to go next
Next lesson: [19. Performance, Profiling and Memory](../19-performance-and-memory/README.md). It teaches how to measure what you saw in this lesson (event loop delay, CPU profiles, memory) so you know whether you need threads at all.

Practise this topic in the interview rounds:
- [Round 4: advanced questions](../../rounds/round-4-advanced/questions.md) (threads, cluster, shared memory, event loop blocking)
- [Round 5: system design](../../rounds/round-5-system-design/questions.md) (horizontal scaling, stateless services, sticky sessions)
