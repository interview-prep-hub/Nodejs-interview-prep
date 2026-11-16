# 08. The Event Loop (the most asked Node.js topic)

> Level: Intermediate   Time: about 150 minutes   Node: 24 (notes where older versions differ)

[Previous: 07. Asynchronous JavaScript: Callbacks, Promises and async/await](../07-async-javascript/README.md) | [All lessons](../../README.md) | [Next: 09. Events and EventEmitter](../09-events/README.md)

## What you will learn
- Why one JavaScript thread can serve thousands of clients at the same time
- What the call stack, the Node APIs and the callback queues are, and how the event loop connects them
- The six phases of the libuv event loop, in order, and which callback lands in which phase
- The two "fast lanes" that sit outside the phases: the `process.nextTick` queue and the promise (microtask) queue, and who wins
- `setTimeout(fn, 0)` versus `setImmediate(fn)`, and why timers are minimum delays, not promises
- The libuv thread pool (4 threads by default): what uses it, what does not, and how to see its effect
- How to block the loop, how to see it, how to starve it, how to break long work into pieces, and how Node decides when the process may exit (`unref()`)
- 14 "predict the output" puzzles, from easy to very hard, each with a step-by-step explanation

All examples are in `lessons/08-event-loop/examples/`. Run them from the repository root, for example `node lessons/08-event-loop/examples/01-stack-and-queue.js`. The best way to learn this topic is to **write your prediction first, then run the code**.

> **Platform note:** the numbers in this lesson were measured on Windows 11 with Node 24.16.0. Timings (and the winner of `setTimeout` versus `setImmediate` in the main module) can differ on Linux and macOS. Where an output is not guaranteed, the text says so.

---

## 1. Why one thread can serve many clients

A server spends most of its time **waiting**: for a disk to return a file, for a database to answer, for a client to send the next bytes. While it waits, it uses no CPU. The only question is: what should the program do during the wait?

There are two classic answers.

| Model | Idea | Cost |
|---|---|---|
| Thread per client | Every client gets its own thread. The thread blocks (sleeps) while it waits. | Every thread needs its own stack memory and the operating system must switch between them. Thousands of threads get heavy. Shared data needs locks. |
| Event loop (Node.js) | One thread runs your JavaScript. When code must wait, it hands the wait to the system and goes on to the next job. When the result is ready, it comes back as a **callback**. | One slow callback delays everybody. CPU-heavy work must be moved out of the loop. |

Think of a restaurant with **one waiter**. The waiter takes an order, gives it to the kitchen, and immediately serves the next table. When the kitchen rings a bell, the waiter picks up the food. The waiter never stands at the kitchen door waiting. This is why one waiter can look after many tables.

The system breaks down only if the waiter starts **cooking** (doing slow work personally). Then every table waits. In Node, "cooking" is CPU-heavy JavaScript, and it is a very common cause of slow Node servers. You will see it in section 8.

> **Common mistake:** saying "Node.js is single-threaded". It is only half true. Your JavaScript runs on one thread, but a Node process has several other threads (V8 helper threads, and the libuv thread pool that runs file system, DNS lookup, crypto and zlib work). A strong answer is: "Node runs JavaScript on a single-threaded event loop, and uses the operating system and a small thread pool to do the waiting and the heavy lifting in the background."

**Words used in this lesson (short definitions)**
- **Callback:** a function you give to Node so that Node calls it later, when something is ready.
- **I/O (input/output):** anything that talks to the world outside your program: files, the network, a database, a child process.
- **OS:** the operating system (Windows, Linux, macOS).
- **Blocking:** keeping the one JavaScript thread busy so nothing else can run.
- **Microtask:** a small job queued by a promise (`.then`, the code after an `await`) or by `queueMicrotask`. Microtasks run right after the current code finishes, before the loop moves on.
- **Handle:** an object in the loop that stays alive for a while (a timer, a server, a socket). The loop keeps running while handles are active.
- **Request:** a one-off job in progress, such as a single file read. The loop also keeps running until pending requests are finished.
- **libuv:** the C library inside Node that provides the event loop, timers, sockets and the thread pool.

---

## 2. The big picture: call stack, Node APIs and queues

Four parts work together.

1. **The call stack** is the list of functions that are running right now. The newest call is on top. JavaScript can only run the function on the top. When a function returns, it is removed.
2. **Node APIs** (libuv and the operating system) do the waiting: timers, sockets, files, DNS. Browsers call the same idea "Web APIs".
3. **Callback queues** are waiting rooms. When the waiting is over, the callback goes into a queue.
4. **The event loop** is a loop (written in C, in libuv) that takes the next callback from a queue and puts it on the call stack, but **only when the stack is empty**.

```text
   YOUR JAVASCRIPT (V8)                         NODE + libuv + OPERATING SYSTEM
 +----------------------+   "start this,     +--------------------------------+
 |     CALL STACK       |    call me later"  |  timers   sockets   files  DNS |
 |                      | -----------------> |  (the system and the thread    |
 |   c()                |                    |   pool do the waiting)         |
 |   b()                |                    +----------------+---------------+
 |   a()                |                                     |
 +----------^-----------+                                     | work is done,
            |                                                 | callback is ready
            | stack empty?  take the next one                 v
            |                                      +--------------------+
            +--------------------------------------|  CALLBACK QUEUES   |
                       EVENT LOOP                  +--------------------+
```

The most important rule of the whole lesson: **a callback never interrupts running code.** JavaScript runs each piece of code to the end (this is called *run to completion*). A callback has to wait until the stack is empty.

Example `01-stack-and-queue.js` shows this in three small parts. (A small helper at the top of the file, `stackNames()`, lists the function names on the stack. Part 3 is a loop that starts three `setTimeout(..., 100)` calls. Open the file to see both; the excerpt below shows the main idea.)

```js
function a() {
  b();
}
function b() {
  c();
}
function c() {
  console.log('stack inside c():', stackNames().join(' <- '));
}
// ...
function partTwo() {
  const start = Date.now();

  setTimeout(() => {
    const waited = Date.now() - start;
    console.log('stack inside the timer callback:', stackNames().join(' <- '));
    console.log('timer asked for 0 ms, but waited at least 100 ms:', waited >= 100);
    partThree();
  }, 0);

  // Keep the call stack busy for 100 ms. The timer is "due" after about 1 ms,
  // but nothing can run until this loop and the whole main script are finished.
  while (Date.now() - start < 100) {
    // busy
  }
  console.log('main script ends');
}
```

```text
stack inside c(): c <- b <- a <- Object.<anonymous>
main script ends
stack inside the timer callback: Timeout._onTimeout
timer asked for 0 ms, but waited at least 100 ms: true
task A finished
task B finished
task C finished
three 100 ms waits took less than 250 ms in total: true
```

Why this output?

- **Part 1.** `a()` calls `b()` which calls `c()`. Inside `c()` the stack holds `c <- b <- a <- Object.<anonymous>`. The last name is your whole file, which Node wraps in a function.
- **Part 2.** `setTimeout` does not run the callback. It only tells the timer system "call this after at least 1 ms" and returns immediately. Then our `while` loop keeps the stack busy for 100 ms. When the main script ends, the stack is empty and the timer callback runs. Its stack contains only `Timeout._onTimeout`: it starts on a **fresh stack**. The timer waited 100 ms even though we asked for 0 ms.
- **Part 3.** Three tasks that each wait 100 ms all finish together, because waiting is not work. One thread, no queue of waiting threads.

> **Remember:** a timer delay is a **minimum**, not a promise. "Run after 0 ms" really means "run as soon as the stack is empty and the loop gets to the timers phase".

> **Interview tip:** the 30-second answer to "What is the event loop?" is: "Node runs my JavaScript on one thread. Slow work like network and file access is handed to the operating system or to libuv's thread pool. When it finishes, a callback is queued. The event loop takes callbacks from the queues one at a time and runs them when the call stack is empty. Because there is only one thread, a slow synchronous callback blocks everything else."

### Is it the same as the browser's event loop?

The core idea is the same: one JavaScript thread, one call stack, callbacks that run to completion, and promise jobs that run right after the current code. The details differ, and interviewers sometimes ask:

| | Browser | Node.js |
|---|---|---|
| Who defines the loop | The HTML standard (each browser implements it) | libuv (a C library) plus Node's own rules |
| Queues | Task queues and a microtask queue | One queue per phase, the `nextTick` queue and the microtask queue |
| Extra steps | A rendering step (style, layout, paint, `requestAnimationFrame`) between tasks | No rendering. `process.nextTick` and the named phases exist only in Node |
| Who does the waiting | The browser's Web APIs (timers, `fetch`, DOM events) | The OS poller and the libuv thread pool |

---

## 3. The libuv event loop and its six phases

The loop is not one queue. It is a **cycle of phases**, and each phase has its own queue of callbacks. One full pass through the cycle is called a **turn** (some books say "tick" or "iteration"; this lesson says "turn" so it is not confused with `nextTick`).

```text
          +--------------------------------------------------+
          |                                                  |
          v                                                  |
   +--------------+                                          |
   |    timers    |  setTimeout and setInterval callbacks    |
   +------+-------+  whose time has come                     |
          v                                                  |
   +--------------+                                          |
   |   pending    |  a few system callbacks that were put    |
   |  callbacks   |  off from the previous turn              |
   +------+-------+                                          |
          v                                                  |
   +--------------+                                          |
   | idle,prepare |  used only inside Node and libuv         |
   +------+-------+                                          |
          v                                                  |
   +--------------+     new connections, incoming data,      |
   |     poll     | <-- finished file reads, ...             |
   +------+-------+  runs I/O callbacks, and may WAIT here   |
          v                                                  |
   +--------------+                                          |
   |    check     |  setImmediate callbacks                  |
   +------+-------+                                          |
          v                                                  |
   +--------------+                                          |
   |    close     |  some close callbacks, for example       |
   |  callbacks   |  socket.on('close', ...)                 |
   +------+-------+                                          |
          |                                                  |
          +--------------------------------------------------+

   Between ANY two callbacks, in ANY phase:
      1. run the whole process.nextTick queue
      2. run the whole promise (microtask) queue
      (repeat until both are empty, then continue)
```

### What each phase does and what lands in it

| Phase | What it runs | Typical callbacks |
|---|---|---|
| timers | Timer callbacks whose delay has passed | `setTimeout`, `setInterval` |
| pending callbacks | System callbacks postponed from the last turn | Some TCP errors such as `ECONNREFUSED` on some systems. You will rarely meet this phase. |
| idle, prepare | Internal housekeeping | Nothing you write |
| poll | Gets new I/O events and runs their callbacks. It is the phase where the loop **waits** when there is nothing to do. | `fs.readFile` callback, socket `'data'`, HTTP request handler, DNS lookup result, crypto result |
| check | Callbacks scheduled with `setImmediate` | `setImmediate` |
| close callbacks | Some close events | `socket.on('close')` for a destroyed socket |

Two things are **not** in any phase:

- The code at the top level of your file runs **before** the loop starts.
- `process.nextTick`, promise callbacks (`.then`, `await`) and `queueMicrotask` run **between** callbacks. Section 4 explains them.

### The poll phase rules

The poll phase decides how long the loop may sleep:

1. If there are I/O callbacks ready, run them (up to a system-dependent limit).
2. If nothing is ready and a `setImmediate` callback is waiting, do **not** wait. Go on to the check phase.
3. If nothing is ready and no immediate is waiting, **wait** for I/O, but only until the nearest timer is due. Then go back to the timers.

If there are no timers and no I/O at all, the loop has no work and the process can exit (section 10).

> **Under the hood:** the diagram starts at "timers" because the official docs draw it that way, but the loop is a circle, so where you start drawing is a choice. In the libuv source (the function `uv_run`, version 1.52.1, the one inside Node 24.16) timers run once before the first turn starts, and after that at the **end** of every turn, right after the close callbacks. This is the behaviour since libuv 1.45.0 (Node 20). Older versions ran the timers at the start of each turn. The circular order of the phases is the same either way, so everything in this lesson holds on both.
>
> We got this from the libuv source and from the official Node.js page "The Node.js Event Loop, Timers, and process.nextTick()". You cannot see it from JavaScript, so there is no demo for it.

### A tour of the phases in code

Example `05-phases.js` uses a timer callback to start in the timers phase, then shows what runs in the same turn and what has to wait for the next turn. (The lines at the end of the file, not shown here, start a tiny server and connect to it, only so that we have a socket to close.)

```js
// Part 2 starts at the end of part 1. It shows the poll phase leading into the check phase.
function partTwo() {
  console.log('\n--- part 2: start from an I/O callback ---');
  fs.readFile(__filename, () => {
    console.log('[poll]    fs.readFile callback (I/O)');
    setTimeout(() => console.log('[timers]  setTimeout 0 made in the I/O callback (next turn)'), 0);
    setImmediate(() => console.log('[check]   setImmediate made in the I/O callback (same turn)'));
  });
}

// Part 1 starts from a timer callback, so we know we are in the timers phase.
function partOne(clientSocket, serverSocket, server) {
  console.log('[timers]  a timer callback is running');

  clientSocket.on('close', () => {
    console.log('[close]   socket close event (close callbacks phase)');
    serverSocket.destroy();
    server.close();
  });
  clientSocket.destroy(); // the handle is closed in the close callbacks phase of this turn

  setTimeout(() => {
    console.log('[timers]  setTimeout 0 made in the timer callback (next turn)');
    partTwo();
  }, 0);
  setImmediate(() => console.log('[check]   setImmediate made in the timer callback (same turn)'));
  process.nextTick(() => console.log('          nextTick: runs right after the timer callback'));
  Promise.resolve().then(() => console.log('          promise: runs right after the nextTick queue'));
}
```

```text
--- part 1: start from a timer callback ---
[timers]  a timer callback is running
          nextTick: runs right after the timer callback
          promise: runs right after the nextTick queue
[check]   setImmediate made in the timer callback (same turn)
[close]   socket close event (close callbacks phase)
[timers]  setTimeout 0 made in the timer callback (next turn)

--- part 2: start from an I/O callback ---
[poll]    fs.readFile callback (I/O)
[check]   setImmediate made in the I/O callback (same turn)
[timers]  setTimeout 0 made in the I/O callback (next turn)
```

Read the output like a story:

1. A timer callback is running (**timers** phase). Inside it we schedule five things: a `nextTick`, a promise, a `setImmediate`, a socket close, and a `setTimeout(0)`.
2. The callback ends. Node runs the **nextTick** queue, then the **promise** queue, before the loop moves on.
3. The loop moves forward in the cycle: the **check** phase runs our `setImmediate`.
4. Next, the **close callbacks** phase runs the socket `'close'` event. (The socket handle was closed with `destroy()`, and libuv reports the finished close in this phase.)
5. A new turn begins. The `setTimeout(0)` we made in step 1 finally runs in the **timers** phase.
6. In part 2 we start from a file read. Its callback runs in the **poll** phase. The `setImmediate` made there runs in the **check** phase of the *same* turn, and the `setTimeout(0)` has to wait for the *next* turn. That is why inside an I/O callback `setImmediate` always wins (section 5).

> **Interview tip:** "Walk me through the phases of the event loop." A strong answer names the six phases in order (timers, pending callbacks, idle/prepare, poll, check, close callbacks) and says what lands where: `setTimeout` and `setInterval` in timers, I/O callbacks in poll (where the loop also waits when it is idle), `setImmediate` in check. Then it adds that `nextTick` and promise callbacks are **not** phases: they run between callbacks. Two common wrong answers come from the confusing names. `setImmediate` does not mean "run now" (it runs in the check phase of this turn), and `process.nextTick` does not wait for a "tick" of the loop (it runs as soon as the current callback ends). The names are historical and will not change.

---

## 4. Microtasks and process.nextTick: two queues outside the phases

Besides the phase queues there are two special queues that are drained **between callbacks**.

| Queue | Who owns it | What goes in |
|---|---|---|
| **nextTick queue** | Node | `process.nextTick(fn)` |
| **microtask queue** | V8 (the JavaScript engine) | Promise reactions (`.then`, `.catch`, `.finally`), the code after an `await`, and `queueMicrotask(fn)` |

### When are they drained?

- Once, right after your main script has finished.
- After **every callback** of every phase. Since Node 11 this is after each single timer callback and each single immediate callback (I/O callbacks already behaved this way). Before Node 11, the queues were only drained after *all* the timers (or all the immediates) of that phase had run. (The Node 11 changelog lists the change as "timers: run nextTicks after each immediate and timer", pull request 22842. We did not run Node 10 here, only Node 24.)
- Both queues are emptied completely, and the process repeats until both are empty.
- The official docs say it this way: the nextTick queue is processed after the current **operation** completes, whatever phase the loop is in. An operation is one trip from the C/C++ side into your JavaScript, for example one callback.

### Who wins when both are queued?

The rule, in simplified Node source code:

```js
// Simplified from lib/internal/process/task_queues.js
function processTicksAndRejections() {
  do {
    while (tickQueue.length > 0) {
      run(tickQueue.shift());   // ALL ticks first, including ticks added meanwhile
    }
    runMicrotasks();            // then ALL promise jobs, including ones added meanwhile
  } while (tickQueue.length > 0);
}
```

So the rules are:

1. In a CommonJS file and inside any callback: **nextTick first, then promises**.
2. A tick added by a promise job waits until the whole microtask queue is empty. A promise added by a tick job waits until the whole tick queue is empty.
3. **In an ES module (`.mjs`) the order flips** for the main script: promises first, then nextTick. The reason: Node runs an ES module as part of a promise job, so the microtask queue is already being drained when your code finishes. Inside callbacks (timers and so on) the normal rule holds again.

Example `02-nexttick-vs-promise.js` (CommonJS) has three scenarios:

```js
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
// ...
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
```

```text
A: sync 1
A: sync 2
A: nextTick
A: promise then
A: queueMicrotask
A: setTimeout 0
B: timer callback starts
B: timer callback ends
B: nextTick
B: promise then
C: tick 1
C: tick 2
C: tick made inside tick 1
C: promise 1
C: promise made inside tick 1
C: promise made inside promise 1
C: tick made inside promise 1
```

- **Scenario A (main script):** `sync 1`, `sync 2` run first. Then `nextTick`, then the promise and `queueMicrotask` (they share one queue where the first job in is the first job out, so they run in the order they were scheduled), and only then the timer.
- **Scenario B (inside a timer callback):** the callback runs to its end (`timer callback ends` comes before both queues). Then `nextTick`, then promise.
- **Scenario C (queues feeding each other):** `tick 1` and `tick 2` run, and also `tick made inside tick 1` because the whole tick queue is drained first. Only then the microtasks run: `promise 1`, then `promise made inside tick 1` (it was queued during `tick 1`), then `promise made inside promise 1`. The tick created inside a promise job (`tick made inside promise 1`) runs last, after the microtask queue is empty.

The same main-script test in an ES module, `03-nexttick-vs-promise.mjs`:

```js
console.log('A: sync 1');
setTimeout(() => {
  console.log('A: setTimeout 0');
  setTimeout(scenarioB, 10); // start the next scenario after this one is finished
}, 0);
Promise.resolve().then(() => console.log('A: promise then'));
queueMicrotask(() => console.log('A: queueMicrotask'));
process.nextTick(() => console.log('A: nextTick'));
console.log('A: sync 2');
```

```text
A: sync 1
A: sync 2
A: promise then
A: queueMicrotask
A: nextTick
A: setTimeout 0
B: timer callback starts
B: timer callback ends
B: nextTick
B: promise then
```

Compare scenario A of both files: in the module, `promise then` and `queueMicrotask` come **before** `nextTick`. Scenario B, inside a timer, is the same in both file types.

> **Under the hood:** `process.nextTick` is marked "Legacy" in the Node.js documentation, and the docs advise `queueMicrotask()` for new code. It is not deprecated, and Node itself still uses it a lot. A common use is to make an API always asynchronous, so the caller has time to attach listeners (puzzle 4 shows this). The official docs also recommend `setImmediate` over `nextTick` in most cases, and warn that recursive `nextTick` calls can starve I/O (section 9).

> **Interview tip:** "What is the difference between `process.nextTick` and `Promise.resolve().then`?" Strong answer: both run before the event loop continues, but the nextTick queue is drained first (in CommonJS), then the promise queue. They are different queues. Mention that this order is reversed for the top level of an ES module, and that a recursive `nextTick` or promise loop starves I/O and timers.

---

## 5. Timers: setTimeout, setImmediate and the "0 ms" puzzle

### Timers are minimum delays

- `setTimeout(fn, ms)` means "run `fn` **no sooner than** `ms` milliseconds from now". If the stack is busy or the loop is blocked, it runs later (section 2 showed a 0 ms timer that waited 100 ms).
- A delay below 1 (like `0`) is changed to **1 ms**. So `setTimeout(a, 1)` and `setTimeout(b, 0)` behave the same: they run in the order you created them (puzzle 3).
- A delay larger than 2147483647 ms (about 24.8 days) does not fit into 32 bits. Node prints `TimeoutOverflowWarning` and uses **1 ms** instead.
- Timers with the same delay are kept in creation order. Timers with different delays run in order of when they are due.

> **Under the hood:** Node keeps one list of timers for each delay value (all the 10 ms timers in one list, all the 100 ms timers in another) and a priority queue (a heap) that always knows which list is due first. Adding a timer to a list is cheap, and this is why timers with the same delay keep their creation order. The names in the Node source (`lib/internal/timers.js`) are `timerListMap` and `timerListQueue`.

### setTimeout(fn, 0) versus setImmediate(fn)

Both mean "do this soon, but after the current code". Which one runs first?

- **From the main module: not guaranteed.** It depends on how long the process took to start the loop. If at least 1 ms has passed when the loop begins, the timer is due and runs first. If less than 1 ms has passed, the loop goes through poll to the check phase first, and `setImmediate` runs first.
- **Inside an I/O callback: guaranteed.** The callback runs in the poll phase, and the check phase comes right after it, so `setImmediate` always runs before any timer.

Example `04-timeout-vs-immediate.js` starts fresh `node` processes many times and counts the winner. (It runs 4 child processes at a time, so it takes a few seconds.)

```js
// ---- Child mode: schedule both calls in one place and print which ran first ----
function child(where) {
  let first = null;
  const record = (name) => () => {
    if (first === null) first = name;
  };
  const schedule = () => {
    setTimeout(record('timeout'), 0);
    setImmediate(record('immediate'));
  };

  process.on('exit', () => console.log(first));

  if (where === 'main') {
    schedule();
  } else if (where === 'main-then-busy') {
    schedule();
    const end = Date.now() + 5; // 5 ms of work AFTER scheduling
    while (Date.now() < end) {
      // busy
    }
  } else if (where === 'io') {
    fs.readFile(__filename, () => schedule()); // inside an I/O callback
  } else if (where === 'timer') {
    setTimeout(() => schedule(), 5); // inside a timer callback
  }
}
```

```text
Each row starts 12 fresh node processes.

where both calls are made               immediate first   timeout first
main module                             12                0
main module, then 5 ms of busy work     0                 12
inside an I/O callback (fs.readFile)    12                0
inside a timer callback                 12                0
```

How to read the table (the first row changes from run to run, the other rows should not):

| Row | Result | Why |
|---|---|---|
| main module | Not guaranteed (varies) | It is a race between "1 ms has passed" and "the loop reached the check phase". On this Windows machine `setImmediate` won most runs; in 300 test runs it won 273 times. Many tutorials show the opposite on other systems. |
| main module, then 5 ms of busy work | Timeout first, every time | By the time the loop starts, the timer is already overdue. |
| inside an I/O callback | Immediate first, every time | The check phase comes right after the poll phase. |
| inside a timer callback | Immediate first, every time | After the timers phase the loop goes on to check before the next turn. |

> **Interview tip:** "Which runs first, `setTimeout(0)` or `setImmediate`?" Wrong answers: "always timeout" or "always immediate". Strong answer: "From the main module it is not deterministic, it depends on process performance. Inside an I/O callback `setImmediate` always runs first, because the check phase follows the poll phase." Bonus: mention that 0 becomes 1 ms.

### setInterval and slow callbacks

`setInterval(fn, 10)` never starts a new run while `fn` is still running, because there is only one thread. If `fn` takes 30 ms, the next run starts right after it ends, and the runs that were missed are **not** replayed. In a quick test on Node 24 (a 30 ms busy callback and a 10 ms interval) the runs started about 30 ms apart. So an interval drifts when its callbacks are slow.

If each run starts asynchronous work (a request, a database query) and you do not want runs to pile up, schedule the next run yourself when the work is finished:

```js
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let runs = 0;

async function poll() {
  runs++;
  console.log('run', runs, 'starts');
  await sleep(30); // pretend this is a slow database query
  console.log('run', runs, 'ends');
  if (runs < 3) setTimeout(poll, 10); // the next run starts 10 ms after this one has ended
}
poll();
```

```text
run 1 starts
run 1 ends
run 2 starts
run 2 ends
run 3 starts
run 3 ends
```

A plain `setInterval` with an `async` callback would start a new run every 10 ms whether or not the previous run had finished, so several runs could be in flight together. The `setTimeout` chain makes sure they never overlap.

---

## 6. The thread pool: where the waiting really happens

If JavaScript is one thread, who reads the file? Node uses **two different mechanisms** for background work:

1. **The operating system's own async I/O** for network sockets. The OS tells libuv when a socket is ready. No thread of ours is used. (Section 7.)
2. **The libuv thread pool** for work that has no good async OS version, or is heavy on the CPU. A small group of worker threads run the work in C/C++ and, when done, tell the loop. The callback then runs on the main thread in the poll phase.

The pool has **4 threads by default**. If 4 jobs are running, the 5th waits in a queue. One job runs on one thread: a single `pbkdf2` call is never split over several threads, so a bigger pool only helps when many jobs run at the same time.

| Uses the thread pool | Does NOT use the thread pool |
|---|---|
| Async file system calls: `fs.readFile`, `fs.stat`, `fs.promises.*` and so on (all except `fs.watch`) | Network sockets: `net`, `http`, `https`, `tls` (the OS poller does the waiting, see section 7) |
| `dns.lookup()` and `dns.lookupService()` | `dns.resolve*()` functions (they talk to a DNS server over the network) |
| `crypto.pbkdf2()`, `crypto.scrypt()`, `crypto.randomBytes()`, `crypto.randomInt()`, `crypto.randomFill()`, `crypto.generateKeyPair()` (the callback forms) | Timers (`setTimeout`, `setInterval`, `setImmediate`) |
| Async `zlib` functions | `child_process` (starting and talking to a child process) |
| C++ add-ons that submit their own work | `worker_threads` (they create their own threads, outside the pool) |

(The first column follows the official Node.js guide "Don't Block the Event Loop". On Node 24 we also checked that the callbacks of `crypto.randomBytes` and `crypto.randomInt` wait behind a pool that is full of `pbkdf2` jobs.)

> **Common mistake:** assuming that every async call "runs in a thread". A `setTimeout`, a socket read and a child process do not use the pool. And the synchronous versions (`fs.readFileSync`, `crypto.pbkdf2Sync`) run on the **main thread** and block the loop.

### Demo 1: the pool size changes the speed

Example `06-threadpool-size.js` starts 8 `crypto.pbkdf2` jobs at the same moment, with pool sizes 1, 2, 4 and 8. Each job takes roughly 100 ms of CPU time (between 70 and 150 ms on the test machine). The program prints when each job finished (in ms, rounded to 10).

```text
8 pbkdf2 jobs started at the same time. Finish times in ms (rounded to 10):

pool size 1                 180 330 480 620 770 940 1080 1230
pool size 2                 170 170 320 320 480 480 620 640
pool size 4 (the default)   150 150 150 150 290 300 300 310
pool size 8                 200 200 210 210 230 230 230 240
```

This run is a sample: your numbers will differ, but the **shape** should match.

- **Size 1:** the jobs finish one after another in a staircase.
- **Size 2:** four waves of 2 jobs.
- **Size 4 (the default):** two waves of 4 jobs. This is the famous "4 at a time" behaviour.
- **Size 8:** all 8 start together and finish close together. (More threads than CPU cores will not help CPU-heavy jobs, and each job runs a bit slower when they all share the CPU. On a computer with fewer than 8 cores, the size 8 row will look more like the size 4 row. The test machine has 12 logical cores.)

To set the size yourself, use an environment variable **before** Node starts (setting `process.env.UV_THREADPOOL_SIZE` inside the script is not guaranteed to work, according to the docs):

```bash
UV_THREADPOOL_SIZE=8 node lessons/08-event-loop/examples/07-threadpool-vs-sockets.js
```

On Windows PowerShell:

```powershell
$env:UV_THREADPOOL_SIZE=8; node lessons/08-event-loop/examples/07-threadpool-vs-sockets.js
```

(In PowerShell the variable stays set for the whole window. Remove it with `Remove-Item Env:UV_THREADPOOL_SIZE`.)

### Demo 2: what waits and what does not

Example `07-threadpool-vs-sockets.js` fills the pool with slow crypto jobs, then starts three more operations at the same moment: `fs.stat`, `dns.lookup('localhost')` and a TCP round trip over `127.0.0.1`.

```js
const POOL_SIZE = Number(process.env.UV_THREADPOOL_SIZE) || 4; // 4 is the default
const start = performance.now();
const since = () => `${Math.round(performance.now() - start)} ms`;

// A tiny echo server on a free port. We use 127.0.0.1 (not "localhost"), because
// the name "localhost" would need dns.lookup, and that uses the thread pool.
const server = net.createServer((socket) => socket.pipe(socket));

server.listen(0, '127.0.0.1', () => {
  // 1. Fill every thread of the pool with a slow crypto job.
  let jobsLeft = POOL_SIZE;
  for (let i = 0; i < POOL_SIZE; i++) {
    crypto.pbkdf2('password', 'salt', 300000, 64, 'sha512', () => {
      if (--jobsLeft === 0) console.log(`all ${POOL_SIZE} crypto jobs done after ${since()}`);
    });
  }
  console.log(`${POOL_SIZE} crypto jobs started, the pool is full\n`);

  // 2. Three more operations, started at the same moment.
  fs.stat(__filename, () => console.log(`fs.stat finished after ${since()} (thread pool, had to wait)`));

  dns.lookup('localhost', () => console.log(`dns.lookup finished after ${since()} (thread pool, had to wait)`));

  const client = net.connect(server.address().port, '127.0.0.1', () => client.write('ping'));
  client.on('data', () => {
    console.log(`TCP round trip finished after ${since()} (no thread pool, not affected)`);
    client.destroy();
    server.close();
  });
});
```

```text
4 crypto jobs started, the pool is full

TCP round trip finished after 44 ms (no thread pool, not affected)
fs.stat finished after 501 ms (thread pool, had to wait)
dns.lookup finished after 509 ms (thread pool, had to wait)
all 4 crypto jobs done after 520 ms
```

The numbers vary. What always held in our runs: the TCP round trip finishes almost at once, while `fs.stat` and `dns.lookup` have to **wait in the queue** for a free thread until the crypto jobs release one. The socket never needed the pool. The order of the last three lines can change from run to run (in 25 test runs, `all crypto jobs done` came before `dns.lookup` 4 times), because they all finish within a few milliseconds of each other.

Notice the example uses `127.0.0.1` instead of `localhost` for the TCP test. A host *name* needs a `dns.lookup`, and that would put the connection behind the pool too. Interviewers like this detail.

> **Interview tip:** "A Node server gets slow when many users log in at once, even though CPU use looks low. Why?" One strong answer: password hashing with `crypto.pbkdf2` or `scrypt` fills the 4-thread pool, so other pool users (file reads, `dns.lookup`) queue up behind it. Fixes: raise `UV_THREADPOOL_SIZE` (up to about the number of CPU cores for CPU work), limit concurrent hashing, or use `dns.resolve` instead of `dns.lookup` for DNS (careful: `dns.resolve` asks a DNS server directly and ignores the operating system's resolver and the hosts file, so names like `localhost` may behave differently).

---

## 7. How Node handles 10,000 connections

Every open network connection is a **socket**. Node does not give each socket a thread. It uses the kernel's readiness API, which tells a program which of thousands of sockets have news:

| Operating system | Mechanism |
|---|---|
| Linux | `epoll` |
| macOS and BSD | `kqueue` |
| Windows | IOCP (I/O completion ports) |

This is what the **poll phase** does. libuv hands the kernel the whole list of sockets and asks "wake me when any of these has something". When data arrives, libuv gets a list of ready sockets, and Node runs the matching JavaScript callbacks, one by one.

An idle connection costs only some memory (a socket object and its buffers). It costs no thread and no CPU. That is why Node can keep 10,000 connections open on one thread. (The problem of serving 10,000 connections at once is known as the "C10k problem". Thread-per-client servers struggled with it, which was one reason event loops became popular.)

Example `12-many-connections.js` opens 500 connections to one Node server (in the same process). Each request "waits for a database" for 1.5 seconds. This is the server part; the client part is in the file.

```js
const WAIT_MS = 1500; // pretend each request waits for a database

let inFlight = 0; // requests the server has accepted but not yet answered
let peak = 0;

const server = net.createServer((socket) => {
  inFlight++;
  peak = Math.max(peak, inFlight);
  socket.on('error', () => {});
  socket.once('data', () => {
    // "Wait for the database". The wait costs no CPU, so the loop is free to do other things.
    setTimeout(() => {
      inFlight--;
      socket.end('done');
    }, WAIT_MS);
  });
});
```

```text
500 clients connect to ONE node process (one JavaScript thread).
Each request waits 1500 ms, like a slow database call.

all 500 requests answered
time taken, rounded to 100 ms: 2000 ms
time if the server did them one after another: 750000 ms
most requests were waiting together (peak in flight above 250): true
```

500 requests that each wait 1.5 seconds finish in about 2 to 3 seconds in total (about 0.5 s of that is the example connecting slowly, on purpose; the total changes from run to run). If the server handled them one after another, it would need 750 seconds. All the requests were "in flight" together on one JavaScript thread.

Why 500 and not 10,000? The example must run on any laptop in a few seconds. It also connects in small batches with a retry. A sudden burst of connection attempts is refused (`ECONNREFUSED`, "connection refused") when too many wait to be accepted at once. On this Windows machine a burst of roughly 230 or more simultaneous connects was refused.

The likely cause is the operating system's queue of connections that are not accepted yet (the "listen backlog"). We did not investigate further, and Linux and macOS were not measured. Either way, it is an operating system limit, not an event loop limit.

**The real limits of "10k connections":**

- The OS limit on open files and sockets (on Linux, `ulimit -n`).
- Memory per connection.
- CPU: 10,000 *open* connections are easy. 10,000 connections that all send a request *every second* are only possible if each callback is very short.
- Only one CPU core is used by the JavaScript thread. To use more cores you run several Node processes (cluster) or use worker threads (lesson 18).

> **Interview tip:** "How can Node handle 10,000 concurrent connections with one thread?" A strong answer has three parts. (1) A connection that is waiting costs memory but no thread and no CPU. (2) The OS poller (`epoll`, `kqueue` or IOCP) watches all the sockets for libuv, and the poll phase runs a callback only for the sockets that have news. (3) It works only while every callback is short, so CPU-heavy work must leave the loop. Then name the limits: file descriptors, memory, and one core per process.

---

## 8. Blocking the event loop

**Blocking the loop** means running one callback for a long time. While it runs, no other callback can start: no timer, no incoming request, no response. Every client waits.

A quick calculation: if each request needs 10 ms of CPU on the loop thread, one Node process can finish at most 100 requests per second, however many connections are open. And one request that needs 2 seconds of CPU makes **every other user** wait 2 seconds.

### Four classic blockers

| Blocker | Why it blocks | Better |
|---|---|---|
| A long CPU loop (big sort, image resize, hashing in a loop, a huge `for`) | JavaScript runs on the loop thread | Split into chunks (section 9), or use `worker_threads` or another process |
| Synchronous APIs: `fs.readFileSync`, `crypto.pbkdf2Sync`, `zlib.gzipSync`, `child_process.execSync` | They wait on the loop thread | Use the async version. Sync APIs are fine at startup, not inside request handlers |
| Huge `JSON.parse` or `JSON.stringify` | The time grows with the size of the data, and it all runs on the loop thread | Limit body size, stream the data, or parse in a worker |
| A catastrophic regular expression (ReDoS, "regular expression denial of service") | A pattern with nested repeats can take exponential time on bad input: each extra character can double the time | Avoid nested quantifiers like `(a+)+`, limit input length, or use a linear-time regex engine |

Example `08-blocking-the-loop.js` runs a **heartbeat**: a timer that ticks every 10 ms and remembers the longest gap between two ticks. If the loop is free, the gap stays small. If something blocks the loop, the gap grows by the same amount.

```js
const INTERVAL = 10; // the heartbeat should tick every 10 ms

// The heartbeat: a timer that remembers the longest gap between two ticks.
// If the loop is free, the gap is about 10 ms. If the loop is blocked, the gap grows.
let lastTick = performance.now();
let longestGap = 0;
const heartbeat = setInterval(() => {
  const now = performance.now();
  longestGap = Math.max(longestGap, now - lastTick);
  lastTick = now;
}, INTERVAL);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Runs one task, waits so the heartbeat can notice, then prints the longest gap it saw.
async function measure(label, task) {
  await sleep(50);
  longestGap = 0;
  lastTick = performance.now();
  await task(); // sync tasks block here, async tasks return a promise
  await sleep(50); // give the heartbeat a chance to tick once and record the gap
  const gap = Math.round(longestGap / 10) * 10; // rounded to 10 ms
  console.log(label.padEnd(44) + `longest gap between heartbeats: ${gap} ms`);
}
```

```text
heartbeat: a timer every 10 ms

1. while loop that runs for 200 ms                longest gap between heartbeats: 200 ms
2. crypto.pbkdf2Sync (sync, on the loop thread)   longest gap between heartbeats: 300 ms
3. crypto.pbkdf2 (async, thread pool)             longest gap between heartbeats: 20 ms
4. JSON.parse of a 15 MB string                   longest gap between heartbeats: 230 ms
5. regex /^(a+)+$/ on "aaaa...a!" (n = 22)        longest gap between heartbeats: 300 ms
```

The file runs five tests, one after another (their code is short, see the file; the labels are in the output). Reading the result (exact numbers vary from run to run, and a gap is only roughly as long as the work):

1. A 200 ms loop freezes the heartbeat for about 200 ms.
2. `crypto.pbkdf2Sync` runs on the loop thread, so it freezes the heartbeat for as long as the hashing takes (here 200 to 400 ms).
3. The async `crypto.pbkdf2` does **the same hashing** on the thread pool. The heartbeat shows only a small gap (here 20 to 90 ms), because the loop stays free. This is the whole point of the async versions.
4. `JSON.parse` of a 15 MB string freezes the heartbeat for a couple of hundred milliseconds.
5. The regex `/^(a+)+$/` on `aaaa...a!` has to try an exponential number of ways to split the `a` characters before it can say "no match". With 22 letters it already takes a fraction of a second, and **every extra letter roughly doubles the time**. In a separate test (one regex per fresh `node` process on this machine) 22 letters took about 0.6 s, 24 letters about 2.7 s and 26 letters about 10 s. The exact times jump around between runs and between setups, and they were shorter inside example 08 itself, so only the doubling is reliable. By the same rule, 40 letters would need more than a day (do not try it). One user sending a short, nasty string can freeze your whole server.

> **Common mistake:** thinking that any async file call is completely free. The waiting for the disk happens in the thread pool, but copying a very large result into a JavaScript buffer still happens on the loop thread. That is why this example uses hashing, where the whole job moves to the pool. For huge files, use streams.

On Windows the heartbeat gap in a healthy loop may show 15 to 20 ms instead of 10. This is most likely because the Windows system timer is coarse (about 15.6 ms by default); we measured the gaps but did not verify the cause. The pattern stays the same.

### How to see that the loop is blocked

1. **A heartbeat** like the one above. Cheap and works everywhere. Task 2 in "Try it yourself" asks you to build one.
2. **`perf_hooks.monitorEventLoopDelay()`** gives a histogram of the loop delay (a histogram counts how many measurements fell into each size range, so you can ask for the typical value, the worst value or the 99th percentile). **`performance.eventLoopUtilization()`** tells you how busy the loop is (0 to 1). Example `09-measure-loop-delay.js`:

```js
const RESOLUTION = 10; // the histogram samples the loop with a timer every 10 ms
const histogram = monitorEventLoopDelay({ resolution: RESOLUTION });
// ...
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ms = (nanoseconds) => (nanoseconds / 1e6).toFixed(0).padStart(3);
// ...
// Runs a phase and prints what the histogram and the utilization saw.
async function phase(label, work) {
  histogram.reset();
  const before = performance.eventLoopUtilization();
  await work();
  const used = performance.eventLoopUtilization(before);
  console.log(
    `${label.padEnd(26)} typical gap ${ms(histogram.percentile(50))} ms | ` +
      `worst gap ${ms(histogram.max)} ms | loop busy ${(used.utilization * 100).toFixed(0).padStart(3)}%`,
  );
}
// ...
  await phase('idle loop (sleeping)', () => sleep(300));

  await phase('three 100 ms CPU blocks', async () => {
    for (let i = 0; i < 3; i++) {
      busy(100);
      await sleep(20); // let the loop breathe so the histogram records the gap
    }
  });

  await phase('idle again', () => sleep(300));
```

```text
The histogram timer ticks every 10 ms. Small, steady gaps mean a healthy loop.
(Windows timers are coarse, so a healthy gap there can be 10 to 20 ms.)

idle loop (sleeping)       typical gap  16 ms | worst gap  18 ms | loop busy   0%
three 100 ms CPU blocks    typical gap  24 ms | worst gap 115 ms | loop busy  79%
idle again                 typical gap  16 ms | worst gap  23 ms | loop busy   0%
```

During the three 100 ms CPU blocks, the worst gap jumps to about 100 ms or a little more, and the loop is busy for most of the time (75 to 80% in our runs). While the program only sleeps, the loop is almost 0% busy. The histogram values are in nanoseconds (the example converts them to ms). Even in the idle phases the typical gap here is above the 10 ms resolution (see the Windows note above the table), so what matters is the jump of the worst gap.

3. **A CPU profile.** Run `node --cpu-prof app.js`. When the process exits, Node writes a `.cpuprofile` file into the current folder, which you can open in Chrome DevTools to see which functions used the time. For a running server you can also use `node --inspect`.

### How to fix a blocked loop

Once you have found the blocker, there are three kinds of fix:

1. **Use the async version** of the API (`crypto.pbkdf2` instead of `pbkdf2Sync`). The work moves to the thread pool.
2. **Cut the work into small pieces** and give the loop a turn between them (section 9).
3. **Move the work off the loop thread**: a `worker_threads` worker, a child process, or a separate service or job queue. Lesson [18](../18-worker-threads-and-cluster/README.md) shows a worker computing while a heartbeat like ours keeps ticking, and builds a worker pool.

> **Interview tip:** "Your Node API is fast on its own, but slow under load. How do you find out why?" A good answer names the event loop: measure event loop delay and utilization, take a CPU profile, look for synchronous calls, large JSON, regexes and loops in hot paths, and then fix them with the three options above.

---

## 9. Starving the loop and breaking work into chunks

**Starvation** is blocking in disguise. The phases are skipped because the loop never gets back to them.

`process.nextTick` and promise callbacks run **before the loop continues**, and both queues are drained completely. So if every callback schedules another tick (or another promise job), the queue never empties. The loop never reaches the timers, the poll phase or the check phase. Timers and incoming connections wait forever (and an endless version of such code freezes the process until you kill it).

The code after an `await` is also a microtask. So a loop like `while (true) { await somethingAlreadyDone(); }` starves the loop in the same way, although it looks asynchronous. (We tested a bounded version: a `setTimeout(fn, 0)` waited for all 100,000 steps.) `await` only helps when it waits for something that really takes time, such as a timer, a socket or the thread pool.

`setImmediate` is different. A `setImmediate` made inside an immediate callback runs in the **next** turn, so the loop still visits every other phase in between.

Part 1 of example `10-starvation-and-chunking.js` runs 100,000 recursive steps in each style, with one `setTimeout(fn, 0)` waiting. (The version is bounded, so it ends.)

```js
// ---------- Part 1: who starves the timer? ----------
// Start a 0 ms timer, then run LIMIT steps where each step schedules the next one.
// Did the timer get a turn before the steps were finished?
function race(label, schedule) {
  return new Promise((resolve) => {
    let steps = 0;

    setTimeout(() => {
      const early = steps < LIMIT;
      console.log(`${label.padEnd(36)} timer ran: ${early ? 'EARLY, in between the steps' : 'only after all the steps'}`);
    }, 0);

    function step() {
      steps++;
      if (steps < LIMIT) schedule(step);
      else setTimeout(resolve, 20); // all steps are done, wait a moment so the timer can print
    }
    step();
  });
}

async function partOne() {
  console.log(`Part 1: ${LIMIT} recursive steps, and one setTimeout(fn, 0) waiting\n`);
  await race('process.nextTick recursion', (fn) => process.nextTick(fn));
  await race('promise / queueMicrotask recursion', (fn) => queueMicrotask(fn));
  await race('setImmediate recursion', (fn) => setImmediate(fn));
}
```

### Breaking long work into chunks

If you must do a long job on the loop thread, cut it into small chunks and yield (give the loop a turn) between them. `setImmediate` is the right tool: it yields to every other phase, including I/O, and it comes back right after.

Part 2 of the same example adds up 50 million numbers, once in one go and once in chunks of 500,000, while a heartbeat ticks every 10 ms. The two functions that matter:

```js
const TOTAL = 50_000_000;
const CHUNK = 500_000;
// ...
function sumBlocking() {
  let sum = 0;
  for (let i = 0; i < TOTAL; i++) sum += i % 7;
  return sum;
}

function sumInChunks() {
  return new Promise((resolve) => {
    let i = 0;
    let sum = 0;
    function chunk() {
      const end = Math.min(i + CHUNK, TOTAL);
      for (; i < end; i++) sum += i % 7;
      if (i < TOTAL) setImmediate(chunk); // let the loop run other callbacks, then continue
      else resolve(sum);
    }
    chunk();
  });
}
```

Output of the whole file (part 1 first, then part 2; the millisecond numbers vary):

```text
Part 1: 100000 recursive steps, and one setTimeout(fn, 0) waiting

process.nextTick recursion           timer ran: only after all the steps
promise / queueMicrotask recursion   timer ran: only after all the steps
setImmediate recursion               timer ran: EARLY, in between the steps

Part 2: add up 50,000,000 numbers while a heartbeat ticks every 10 ms

blocking: took 130 ms, longest heartbeat gap 150 ms
chunked:  took 220 ms, longest heartbeat gap 20 ms
same result: true
chunked gap is less than half of the blocking gap: true
```

How to read it:

- **Part 1.** The timer waited for **all 100,000** `nextTick` steps, and also for all the promise steps. With `setImmediate` the timer ran in between, after about 1 ms.
- **Part 2.** In the blocking version the longest heartbeat gap is as long as the whole job: the loop was frozen. In the chunked version the gap stays at a couple of heartbeats (20 to 100 ms in our test runs). The cost: the chunked job usually takes **longer in total** (often 1.3 to 2 times as long here, but the times are noisy) because of the pauses. Chunking trades speed for responsiveness. For really heavy work, a worker thread is better because it does not use the loop thread at all.

> **Interview tip:** "How would you process a million items without freezing the server?" Answer: process them in batches and yield with `setImmediate` between batches (not `process.nextTick`, which would starve I/O), or send the work to a worker thread or a queue. Mention that stopping to check the clock (a time budget per slice, like 8 ms) is better than a fixed number of items. Task 3 builds that.

---

## 10. How the process knows when to exit

When your main script ends, Node does not exit right away. It runs the loop, and it keeps running while the loop is **alive**. The loop is alive while it has at least one thing that is *active* and *ref'd* (marked as "keep me alive"):

- a pending timer or an interval,
- an open server or socket,
- a running child process,
- a pending file, DNS or crypto request,
- a pending `setImmediate`.

When none is left, Node emits the `beforeExit` event. If a `beforeExit` listener schedules new work, the loop starts again. If not, Node emits `exit` and the process ends. (`beforeExit` is not emitted when you call `process.exit()` or when an uncaught exception ends the process.)

`process.exit()` is the other way out: it ends the process at once and throws away everything that is still waiting. Lesson [15](../15-processes-and-cli/README.md) covers exit codes and clean shutdown.

What does **not** keep the process alive:

- A pending **promise**. A promise that never settles is not a handle. In a CommonJS script, the process just exits (with code 0) while the promise is still pending. (In an ES module with a top-level `await` that never settles, Node prints a warning and exits with code 13.)
- Anything you called `unref()` on.

`unref()` says "do not keep the process alive just for this". It exists on timers, servers, sockets and other handles. `ref()` undoes it. Use `unref()` for background jobs such as a metrics timer or a lag monitor.

Example `11-exit-and-unref.js` shows all of this and uses `process.getActiveResourcesInfo()` (added in Node 17.3 and 16.14, marked stable in Node 24.0), which lists what is keeping the loop alive:

```js
const net = require('node:net');

// How stdout itself shows up in the list depends on where the output goes
// (a terminal, a pipe or a file), so we hide those entries to keep the output stable.
const HIDE = new Set(['PipeWrap', 'TTYWrap', 'FSReqCallback']);
const active = () =>
  process.getActiveResourcesInfo().filter((name) => !HIDE.has(name)).join(', ') || '(nothing)';

console.log('1. start of the script, active resources:', active());

// A normal timer is "ref'd": it keeps the loop (and the process) alive until it fires.
setTimeout(() => console.log('3. the ref\'d timer fired'), 100);

// An unref'd timer does not keep the process alive. Nothing else is waiting, so it never fires.
const patient = setTimeout(() => console.log('NEVER PRINTED: unref\'d timers cannot keep the process alive'), 5000);
patient.unref();

// A listening server is a handle that keeps the loop alive, until we unref it.
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  console.log('2a. server is listening, active resources:', active());
  server.unref();
  console.log('2b. after server.unref(), active resources:', active());
});

// A promise that never settles is not a handle. It does not keep the process alive.
new Promise(() => {});

// 'beforeExit' fires when the loop has run out of work. Adding work here keeps the process going.
let addedMoreWork = false;
process.on('beforeExit', () => {
  if (!addedMoreWork) {
    addedMoreWork = true;
    console.log('4. beforeExit: the loop is empty, adding one more timer');
    setTimeout(() => console.log('5. the timer added in beforeExit fired'), 20);
  } else {
    console.log('6. beforeExit again: no new work, so the process can end');
  }
});

process.on('exit', (code) => {
  console.log(`7. exit event, code ${code} (only synchronous work is possible here)`);
});
```

```text
1. start of the script, active resources: (nothing)
2a. server is listening, active resources: TCPServerWrap, Timeout
2b. after server.unref(), active resources: Timeout
3. the ref'd timer fired
4. beforeExit: the loop is empty, adding one more timer
5. the timer added in beforeExit fired
6. beforeExit again: no new work, so the process can end
7. exit event, code 0 (only synchronous work is possible here)
```

Step by step:

1. At the start nothing is registered yet. (We hide the entries for stdout itself, `PipeWrap` or `TTYWrap`, so the output is the same wherever you run it.)
2. The server is listening: `TCPServerWrap` is active, plus one `Timeout`. The 5-second timer is **not** listed because it is unref'd. After `server.unref()`, the server is gone from the list too.
3. After 100 ms the ref'd timer fires. Now nothing ref'd is left, so `beforeExit` fires and we add one more timer. The process stays alive for it. Then `beforeExit` fires a second time, and since we add nothing, the process ends with code 0. The 5-second timer, the listening server and the never-settling promise did not stop it.

> **Interview tip:** "My script finished its work but the process never exits. Why?" Something ref'd is still active: an open server, a socket, an interval, an open database connection. Use `process.getActiveResourcesInfo()` to see it, then close it or `unref()` it. The opposite question: "My script exited before the promise resolved?" Nothing in the loop was keeping it alive (no timer or socket), and a pending promise alone does not count.

---

## 11. Predict the output: 14 puzzles

Time to practise. Each puzzle is a real file in `lessons/08-event-loop/examples/puzzles/`. The method:

1. Read the code. Write your predicted output on paper.
2. Run it: `node lessons/08-event-loop/examples/puzzles/01-sync-and-timer.js` (use the file name shown above each puzzle).
3. Open the answer and compare. If you were wrong, find the step in the explanation where your picture differed.

Every puzzle was run many times, also while the computer was busy, and the output never changed. (That is why none of them compares `setTimeout(0)` with `setImmediate` in the main module: the honest answer there is "it depends".)

### The rules to use (keep these in front of you)

1. Synchronous code runs first, top to bottom, until the stack is empty.
2. Then Node drains the **nextTick queue**, then the **promise queue**, and repeats until both are empty. (In an ES module's main script: promises first.)
3. Then the event loop runs its phases: timers, pending, idle/prepare, poll, check, close callbacks.
4. After **every** callback, rule 2 applies again.
5. `setTimeout(fn, 0)` is 1 ms. Timers with the same delay run in creation order.
6. In an I/O callback, `setImmediate` runs before `setTimeout(0)`.
7. An `async` function runs synchronously until its first `await`. The code after an `await` is a microtask.

> **Interview tip:** "Predict the output" is the most common live question on this topic. Say your reasoning aloud, in the same order every time: (1) what runs synchronously, (2) what waits in the nextTick and microtask queues, (3) which phase each remaining callback belongs to, (4) what each callback schedules when it runs. Interviewers care more about a clear method than about a lucky answer.

### Puzzle 1 (easy): sync code and a timer

File: `puzzles/01-sync-and-timer.js`

```js
console.log('A');

setTimeout(() => {
  console.log('B');
}, 0);

console.log('C');
```

<details><summary>Answer and explanation</summary>

```text
A
C
B
```

1. `console.log('A')` runs: prints `A`.
2. `setTimeout` only registers the callback with the timer system and returns at once.
3. `console.log('C')` runs: prints `C`.
4. The main script ends and the stack is empty. The loop reaches the timers phase and runs the callback: prints `B`.

Even with `0` ms, a callback never runs before the current code is finished.

</details>

### Puzzle 2 (easy): nextTick, promise and timer

File: `puzzles/02-tick-promise-timer.js`

```js
setTimeout(() => console.log('timeout'), 0);
Promise.resolve().then(() => console.log('promise'));
process.nextTick(() => console.log('nextTick'));
console.log('sync');
```

<details><summary>Answer and explanation</summary>

```text
sync
nextTick
promise
timeout
```

1. During the main script: the timer is registered, the promise job goes to the microtask queue, the tick goes to the nextTick queue, and `sync` is printed.
2. The script ends. Node drains the nextTick queue first: `nextTick`.
3. Then the microtask queue: `promise`.
4. Only now does the loop start and reach the timers phase: `timeout`.

This is a CommonJS file. In an ES module the first two would swap (puzzle 11).

</details>

### Puzzle 3 (easy): four timers

File: `puzzles/03-timer-delays.js`

```js
setTimeout(() => console.log('A: 10 ms'), 10);
setTimeout(() => console.log('B: 1 ms'), 1);
setTimeout(() => console.log('C: 0 ms'), 0);
setTimeout(() => console.log('D: 5 ms'), 5);
```

<details><summary>Answer and explanation</summary>

```text
B: 1 ms
C: 0 ms
D: 5 ms
A: 10 ms
```

1. `0` is changed to `1`. So `B` (1 ms) and `C` (0, which becomes 1 ms) have the **same delay**.
2. Timers with the same delay run in the order they were created: `B` before `C`, although `C` has the "smaller" number.
3. `D` is due after 5 ms, `A` after 10 ms.

The order is: by delay, and for equal delays by creation order. The line order in the file only matters for ties.

</details>

### Puzzle 4 (medium): emitting an event from a constructor

File: `puzzles/04-emit-in-constructor.js`

```js
const { EventEmitter } = require('node:events');

class Job extends EventEmitter {
  constructor() {
    super();
    this.emit('ready');
  }
}

class SafeJob extends EventEmitter {
  constructor() {
    super();
    process.nextTick(() => this.emit('ready'));
  }
}

new Job().on('ready', () => console.log('Job: ready'));
new SafeJob().on('ready', () => console.log('SafeJob: ready'));
console.log('end of script');
```

<details><summary>Answer and explanation</summary>

```text
end of script
SafeJob: ready
```

1. `new Job()` runs the constructor. `emit('ready')` is **synchronous**: it calls the listeners that exist right now. There are none yet, so the event is lost (no error, because the event is not named `'error'`).
2. Only after the constructor returns can `.on('ready', ...)` attach the listener. Too late. `Job: ready` never prints.
3. `new SafeJob()` only *schedules* the emit with `process.nextTick` and returns. The `.on(...)` call runs right after, still in the main script.
4. `end of script` prints. The script ends and the tick queue is drained: the event is emitted and the listener runs: `SafeJob: ready`.

This is why many Node APIs emit their first event on `nextTick`: the caller gets a chance to attach listeners. Lesson 09 covers events in depth.

</details>

### Puzzle 5 (medium): where does an async function pause?

File: `puzzles/05-async-await-order.js`

```js
async function one() {
  console.log('one: start');
  await two();
  console.log('one: end');
}

async function two() {
  console.log('two');
}

console.log('script start');
one();
new Promise((resolve) => {
  console.log('promise executor');
  resolve();
}).then(() => console.log('promise then'));
console.log('script end');
```

<details><summary>Answer and explanation</summary>

```text
script start
one: start
two
promise executor
script end
one: end
promise then
```

1. `script start`.
2. `one()` runs synchronously until its first `await`: prints `one: start`. It calls `two()`, which also runs synchronously and prints `two`, and returns an already resolved promise.
3. `await` on that promise pauses `one`. Its continuation (`one: end`) is put in the microtask queue **now**. `one()` returns a pending promise to the caller.
4. `new Promise(...)`: the executor function runs synchronously: `promise executor`. `resolve()` is called, and `.then(...)` queues its job **second** in the microtask queue.
5. `script end`.
6. The stack is empty. Microtasks run in order: `one: end`, then `promise then`.

Rules: an async function runs synchronously up to the first `await`; a promise executor is synchronous; the code after an `await` is a microtask, queued at the moment of the `await`. Note that `await` never blocks the thread. It only pauses that one function and lets the caller carry on.

</details>

### Puzzle 6 (medium): two promise chains and a queueMicrotask

File: `puzzles/06-two-promise-chains.js`

```js
Promise.resolve()
  .then(() => console.log('A1'))
  .then(() => console.log('A2'))
  .then(() => console.log('A3'));

Promise.resolve()
  .then(() => console.log('B1'))
  .then(() => console.log('B2'));

queueMicrotask(() => console.log('Q'));
```

<details><summary>Answer and explanation</summary>

```text
A1
B1
Q
A2
B2
A3
```

Track the microtask queue:

1. After the main script: the first `.then` of each chain is queued, and the `queueMicrotask` job too. Queue: `[A1, B1, Q]`. (`A2` is attached to a promise that is still pending, so it is not queued yet.)
2. `A1` runs, which makes its promise resolve, so `A2` is queued. Queue: `[B1, Q, A2]`.
3. `B1` runs, `B2` is queued. Queue: `[Q, A2, B2]`.
4. `Q` runs.
5. `A2` runs, `A3` is queued. Queue: `[B2, A3]`.
6. `B2` runs. Then `A3` runs.

Each `.then` step goes to the **back** of the queue, so the two chains take turns. `queueMicrotask` uses the same queue as promise jobs.

</details>

### Puzzle 7 (medium): queues that feed each other

File: `puzzles/07-nested-tick-promise.js`

```js
process.nextTick(() => {
  console.log('tick 1');
  Promise.resolve().then(() => console.log('promise from tick 1'));
  process.nextTick(() => console.log('tick from tick 1'));
});

Promise.resolve().then(() => {
  console.log('promise 1');
  process.nextTick(() => console.log('tick from promise 1'));
});

process.nextTick(() => console.log('tick 2'));
console.log('sync');
```

<details><summary>Answer and explanation</summary>

```text
sync
tick 1
tick 2
tick from tick 1
promise 1
promise from tick 1
tick from promise 1
```

1. During the main script: tick queue `[tick 1, tick 2]`, microtask queue `[promise 1]`. `sync` prints.
2. Node drains the **whole tick queue** first. `tick 1` runs: it queues the microtask `promise from tick 1` and appends `tick from tick 1` to the tick queue (now `[tick 2, tick from tick 1]`).
3. `tick 2` runs, then `tick from tick 1` (the tick queue is drained until it is empty, including new ticks).
4. Now the microtask queue (`[promise 1, promise from tick 1]`) is drained. `promise 1` runs and queues the tick `tick from promise 1`. That tick must wait, because the microtask queue is not empty yet. `promise from tick 1` runs.
5. The microtask queue is empty, but the tick queue is not. The `do ... while` loop goes around once more: `tick from promise 1`.

</details>

### Puzzle 8 (medium): scheduling inside an I/O callback

File: `puzzles/08-io-callback-order.js`

```js
const fs = require('node:fs');

fs.readFile(__filename, () => {
  console.log('read done');
  setTimeout(() => console.log('timeout'), 0);
  setImmediate(() => console.log('immediate'));
  process.nextTick(() => console.log('nextTick'));
  Promise.resolve().then(() => console.log('promise'));
});
```

<details><summary>Answer and explanation</summary>

```text
read done
nextTick
promise
immediate
timeout
```

1. `fs.readFile` is handed to the thread pool. The main script ends with nothing to print.
2. When the file has been read, the callback runs in the **poll** phase: `read done`. It registers a timer (timers phase of the next turn), an immediate (check phase of this turn), a tick and a promise.
3. The callback ends. Node drains the tick queue (`nextTick`), then the promise queue (`promise`).
4. The loop goes on from poll to the **check** phase: `immediate`.
5. After the close phase, the next turn starts and the timer runs: `timeout`.

In an I/O callback the order `immediate` before `timeout` is guaranteed.

</details>

### Puzzle 9 (hard): two timers that are due together

File: `puzzles/09-two-timers-one-phase.js`

```js
setTimeout(() => {
  console.log('timer 1');
  Promise.resolve().then(() => console.log('promise from timer 1'));
  process.nextTick(() => console.log('tick from timer 1'));
}, 0);

setTimeout(() => {
  console.log('timer 2');
  Promise.resolve().then(() => console.log('promise from timer 2'));
  process.nextTick(() => console.log('tick from timer 2'));
}, 0);
```

<details><summary>Answer and explanation</summary>

```text
timer 1
tick from timer 1
promise from timer 1
timer 2
tick from timer 2
promise from timer 2
```

1. Both timers have the same delay and were created in the same millisecond, so both are due in the **same timers phase**.
2. `timer 1` runs. It queues a promise job and a tick.
3. Before `timer 2` may run, Node drains the tick queue (`tick from timer 1`) and then the promise queue (`promise from timer 1`).
4. `timer 2` runs, and the same thing happens after it.

Since Node 11, the queues are drained **between callbacks of the same phase**. Before that change the queues were drained only after both timers had run, so the output would have been `timer 1`, `timer 2`, `tick from timer 1`, `tick from timer 2`, `promise from timer 1`, `promise from timer 2`. (This old order follows from the Node 11 changelog entry quoted in section 4. We could not run Node 10, so treat it as background, not as something we measured.) The same "between callbacks" rule applies to `setImmediate` callbacks (puzzle 10).

</details>

### Puzzle 10 (hard): setImmediate inside setImmediate

File: `puzzles/10-nested-immediates.js`

```js
setImmediate(() => {
  console.log('immediate 1');
  setImmediate(() => console.log('immediate nested'));
  process.nextTick(() => console.log('tick from immediate 1'));
});

setImmediate(() => console.log('immediate 2'));
```

<details><summary>Answer and explanation</summary>

```text
immediate 1
tick from immediate 1
immediate 2
immediate nested
```

1. Both immediates are registered by the main script. In the check phase, the loop runs the immediates that were queued *when the phase started*.
2. `immediate 1` runs. It registers `immediate nested` (a **new** immediate) and a tick.
3. Before `immediate 2` runs, the tick queue is drained: `tick from immediate 1`.
4. `immediate 2` runs.
5. `immediate nested` was added while the check phase was running, so it waits for the **next turn**. That is why it prints last, and why recursive `setImmediate` does not starve the loop.

</details>

### Puzzle 11 (hard): the same queues in an ES module

File: `puzzles/11-esm-order.mjs`

```js
console.log('start');
process.nextTick(() => console.log('nextTick'));
Promise.resolve().then(() => console.log('promise'));
queueMicrotask(() => console.log('queueMicrotask'));
setTimeout(() => console.log('timeout'), 0);
console.log('end');
```

<details><summary>Answer and explanation</summary>

```text
start
end
promise
queueMicrotask
nextTick
timeout
```

1. `start` and `end` run synchronously.
2. In an ES module, Node runs the whole file inside a promise job. When your top-level code finishes, the microtask queue is already being drained, so V8 runs the remaining microtasks first: `promise`, then `queueMicrotask` (in the order they were queued).
3. Only then does Node get to the nextTick queue: `nextTick`.
4. Finally the timers phase: `timeout`.

If you rename this file to `.js` (CommonJS) the output becomes: `start`, `end`, `nextTick`, `promise`, `queueMicrotask`, `timeout`. This is a favourite trick question.

</details>

### Puzzle 12 (hard): returning a promise from an async function

File: `puzzles/12-async-return-promise.js`

```js
async function plain() {
  return 1;
}

async function wrapped() {
  return Promise.resolve(2);
}

plain().then(() => console.log('plain'));
wrapped().then(() => console.log('wrapped'));

Promise.resolve()
  .then(() => console.log('p1'))
  .then(() => console.log('p2'))
  .then(() => console.log('p3'))
  .then(() => console.log('p4'));
```

<details><summary>Answer and explanation</summary>

```text
plain
p1
p2
wrapped
p3
p4
```

Count the rounds of the microtask queue.

1. `plain()` returns `1`, so its promise is already resolved. `.then('plain')` queues a job at once.
2. `wrapped()` returns a **promise** (`Promise.resolve(2)`). Resolving the outer promise with another promise is not instant: JavaScript queues an extra job to "adopt" the inner promise, which in turn needs one more job to resolve the outer promise. So it takes **three** rounds instead of one.
3. The chain `p1 ... p4` queues one new step per round.

Queue at the start: `[plain, adopt-job, p1]`.

- Round 1: `plain` prints. The adopt job runs and queues the follow-up. `p1` prints and queues `p2`.
- Round 2: the follow-up resolves the outer promise, which queues the `wrapped` job. `p2` prints and queues `p3`.
- Round 3: `wrapped` prints. `p3` prints. `p4` follows.

The lesson: `return somePromise` in an async function costs extra microtask rounds compared with `return value`. It rarely matters in real code, but it is a classic interview puzzle.

</details>

### Puzzle 13 (hard): everything scheduled from inside a timer

File: `puzzles/13-work-from-a-timer.js`

```js
setTimeout(() => console.log('timeout 1'), 0);

setTimeout(() => {
  console.log('timeout 2');
  Promise.resolve().then(() => console.log('promise in timeout 2'));
  process.nextTick(() => console.log('tick in timeout 2'));
  setImmediate(() => console.log('immediate from timeout 2'));
  setTimeout(() => console.log('timeout from timeout 2'), 0);
}, 0);

setTimeout(() => console.log('timeout 3'), 0);
```

<details><summary>Answer and explanation</summary>

```text
timeout 1
timeout 2
tick in timeout 2
promise in timeout 2
timeout 3
immediate from timeout 2
timeout from timeout 2
```

1. All three timers have the same delay, so they sit in one list in creation order. All are due in the first timers phase.
2. `timeout 1` runs.
3. `timeout 2` runs. It queues a promise job, a tick, an immediate and a **new** timer. The new timer starts counting **now**, so it needs a fresh millisecond and is not due in this pass.
4. Before the next timer, Node drains the queues: `tick in timeout 2`, then `promise in timeout 2`.
5. `timeout 3` runs.
6. The timers phase ends. The loop moves on (nothing to poll, an immediate is waiting, so poll does not block) to the check phase: `immediate from timeout 2`.
7. In the next turn the new timer is due: `timeout from timeout 2`.

</details>

### Puzzle 14 (very hard): the boss

File: `puzzles/14-boss-mixed.js`

```js
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
```

<details><summary>Answer and explanation</summary>

```text
read: start
task: start
read: end
read: nextTick
task: after first await
read: promise
read: immediate
read: timeout
task: after sleep(0)
```

1. The main script only starts `fs.readFile`. The loop waits in the poll phase until the thread pool has read the file.
2. The read callback runs (**poll** phase): prints `read: start`. It registers a timer `T1` (`read: timeout`) and an immediate.
3. It calls `task()`. An async function runs synchronously until its first `await`: prints `task: start`. The `await null` queues the continuation as a microtask `M1`.
4. Back in the callback: a tick is queued, then a promise job `M2` (queued **after** `M1`), then `read: end` prints. The callback is done.
5. Drain: first the tick queue: `read: nextTick`. Then the microtasks in order. `M1`: prints `task: after first await`, then calls `sleep(0)`, which registers timer `T2` (after `T1`, same 1 ms list) and pauses `task` again. `M2`: prints `read: promise`.
6. The loop moves on to the **check** phase: `read: immediate`.
7. Next turn, **timers** phase: `T1` runs (`read: timeout`). Then `T2` runs; it resolves the sleep promise. Its continuation is a microtask, drained right after the timer: `task: after sleep(0)`.

If you got this one right, you understand the event loop at interview level.

</details>

---

## 12. The one-page mental model

```text
   YOUR FILE runs top to bottom on the CALL STACK. Nothing can interrupt it.
        |
        v   stack is empty
   +------------------------------------------------------------+
   |  1. process.nextTick queue   (all of it)                   |  repeat until
   |  2. promise / queueMicrotask (all of it)                   |  both are empty
   |     (in an ES module's main script: promises first)        |
   +------------------------------------------------------------+
        |
        v
   THE LOOP, turn after turn:
   timers --> pending --> idle,prepare --> poll --> check --> close --> (timers again)

      timers : setTimeout, setInterval
      poll   : I/O callbacks (the loop WAITS here when it is idle)
      check  : setImmediate
      close  : socket 'close' and similar

   After EVERY callback in EVERY phase: run steps 1 and 2 again.

   WHO DOES THE WAITING?
   sockets  -> the OS (epoll / kqueue / IOCP). No thread, no pool.
   fs, dns.lookup, crypto (pbkdf2, scrypt, randomBytes), zlib
            -> the libuv thread pool: 4 threads by default (UV_THREADPOOL_SIZE)
   timers   -> a timer list inside the loop

   WHEN DOES THE PROCESS EXIT?
   When no ref'd handle or request is left. A pending promise does not count.
   unref() removes a handle from that count.
```

**The rules in ten lines**

1. JavaScript runs on one thread. A callback runs to completion.
2. Callbacks of finished work wait in queues until the stack is empty.
3. nextTick queue, then promise queue, after the main script and after every callback.
4. Phases in order: timers, pending callbacks, idle/prepare, poll, check, close callbacks.
5. Timers are minimum delays. `0` means `1`. Equal delays keep creation order.
6. Main module: `setTimeout(0)` vs `setImmediate` is not guaranteed. Inside I/O: immediate first.
7. The thread pool has 4 threads by default and runs fs, `dns.lookup`, crypto and zlib. Sockets do not use it.
8. Blocking the loop (CPU, sync APIs, huge JSON, bad regex) delays every client. Measure it with a heartbeat or `monitorEventLoopDelay`.
9. Recursive `nextTick` or promises starve the loop. Recursive `setImmediate` does not.
10. The process exits when nothing ref'd is left.

**Likely interview questions and where to find the answer in this lesson:** "What is the event loop?" (section 2), "Phases?" (3), "nextTick vs promise vs setImmediate?" (4 and 5), "Is Node single-threaded? What is the thread pool?" (1 and 6), "How does Node handle many connections?" (7), "How do you find and fix a blocked loop?" (8 and 9), "Why does my process not exit?" (10).

---

## Summary / Key takeaways

- Node runs your JavaScript on one thread. It scales to many clients because waiting is handed to the operating system and the thread pool, and callbacks are short.
- The event loop has six phases: timers, pending callbacks, idle/prepare, poll, check, close callbacks. `setTimeout` lands in timers, I/O callbacks in poll, `setImmediate` in check.
- `process.nextTick` and promise callbacks run between callbacks, nextTick first (in CommonJS). In an ES module's main script, promises come first. Since Node 11 both are drained after every single callback.
- `setTimeout(fn, 0)` is really 1 ms and a minimum delay. Versus `setImmediate`: undefined order in the main module, immediate first inside an I/O callback.
- The libuv thread pool (4 threads, `UV_THREADPOOL_SIZE`) runs fs, `dns.lookup`, crypto and zlib. Network sockets use the kernel poller instead, which is why 10,000 connections do not need 10,000 threads.
- Anything long on the loop thread blocks every client: CPU loops, sync APIs, huge JSON, catastrophic regex. Detect it with a heartbeat, `monitorEventLoopDelay` or a CPU profile.
- Recursive `nextTick` or microtasks starve the loop. Split long work into chunks with `setImmediate` or move it to a worker.
- The process exits when no ref'd handle or request is left. A pending promise does not keep it alive. `unref()` removes a handle from the count.

---

## Quick check

1. Why can one JavaScript thread look after thousands of clients?
<details><summary>Answer</summary>

Because most of a server's time is waiting (for the network, a disk, a database), and waiting costs no CPU. Node hands the waiting to the operating system or the thread pool and only runs the short callbacks when results arrive. It works as long as every callback is short.

</details>

2. Name the event loop phases in order.
<details><summary>Answer</summary>

Timers, pending callbacks, idle/prepare, poll, check, close callbacks, then back to timers. Between any two callbacks Node runs the `process.nextTick` queue and then the promise microtask queue.

</details>

3. In a CommonJS file, in which order do `setTimeout(fn, 0)`, `Promise.resolve().then(fn)`, `process.nextTick(fn)` and a synchronous `console.log` run? What changes in an ES module?
<details><summary>Answer</summary>

Synchronous log, `nextTick`, promise, `setTimeout`. In an ES module's main script the promise runs before `nextTick`: synchronous log, promise, `nextTick`, `setTimeout`.

</details>

4. Why is the order of `setTimeout(fn, 0)` and `setImmediate(fn)` not guaranteed in the main module, but guaranteed inside an `fs.readFile` callback?
<details><summary>Answer</summary>

In the main module it depends on whether 1 ms has passed when the loop starts (then the timer is due and goes first) or not (then the loop reaches the check phase first). Inside an I/O callback you are in the poll phase, and the check phase comes right after it, before the next timers phase. So `setImmediate` always wins there.

</details>

5. What is the default size of the libuv thread pool, and which of these use it: `fs.readFile`, reading from a TCP socket, `dns.lookup`, `crypto.pbkdf2`?
<details><summary>Answer</summary>

4 threads (changed with the `UV_THREADPOOL_SIZE` environment variable, set before Node starts). `fs.readFile`, `dns.lookup` and `crypto.pbkdf2` use it. Reading from a TCP socket does not: the OS poller (epoll, kqueue or IOCP) handles sockets.

</details>

6. Give three ways to block the event loop and one way to detect it.
<details><summary>Answer</summary>

A long CPU loop, a synchronous API such as `fs.readFileSync` or `crypto.pbkdf2Sync`, a huge `JSON.parse`, or a catastrophic regex (any three). Detect it with a heartbeat `setInterval` that measures its own lateness, with `perf_hooks.monitorEventLoopDelay()`, or with a CPU profile (`node --cpu-prof`).

</details>

7. What happens if a function keeps calling itself with `process.nextTick`? What if it uses `setImmediate` instead?
<details><summary>Answer</summary>

With `nextTick` the tick queue never becomes empty, so the loop never moves on: timers, I/O and everything else starve. With `setImmediate` each call runs in a later turn, so the loop visits all the other phases in between and the process stays responsive.

</details>

8. How does Node decide that the process can exit? What does `unref()` do?
<details><summary>Answer</summary>

The process keeps running while there is at least one active, ref'd handle or request (timer, server, socket, pending fs or DNS request, pending immediate). When none is left, Node emits `beforeExit` and then `exit`. `unref()` marks a handle as "do not keep the process alive for this one". A pending promise alone never keeps the process alive.

</details>

9. Is Node.js single-threaded?
<details><summary>Answer</summary>

Your JavaScript runs on one thread (the event loop thread), but the Node process also has other threads: V8 helper threads and the libuv thread pool (4 threads by default). `worker_threads` can add more JavaScript threads. "Single-threaded event loop for JavaScript" is the accurate phrase.

</details>

10. Does `setTimeout(fn, 100)` run exactly after 100 ms?
<details><summary>Answer</summary>

No. 100 ms is the minimum. The callback runs when the timer is due **and** the call stack is empty **and** the loop reaches the timers phase. If a busy callback blocks the loop for 300 ms, `fn` runs about 300 ms after the timer was set.

</details>

---

## Try it yourself

### Task 1 (easy): three waits at the same time

Write `sleep(ms)` that returns a promise. Measure how long three 100 ms sleeps take (a) one after another and (b) together with `Promise.all`. Print whether each time is above or below a limit that you choose (exact timer values change from run to run, so do not print the raw numbers).

<details><summary>Hint</summary>

`sleep` is `new Promise((resolve) => setTimeout(resolve, ms))`. For the sequential version `await` each sleep in turn. For the parallel version start all three first and pass them to `Promise.all`.

</details>

<details><summary>Solution</summary>

```js
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sequential() {
  const start = Date.now();
  await sleep(100);
  await sleep(100);
  await sleep(100);
  return Date.now() - start;
}

async function parallel() {
  const start = Date.now();
  await Promise.all([sleep(100), sleep(100), sleep(100)]);
  return Date.now() - start;
}

async function main() {
  const one = await sequential();
  const together = await parallel();
  console.log('one after another took more than 250 ms:', one > 250);
  console.log('all together took less than 250 ms:     ', together < 250);
}

main();
```

```text
one after another took more than 250 ms: true
all together took less than 250 ms:      true
```

Sequential waits add up (three times 100 ms, so 300 ms or a bit more). Parallel waits overlap (about 100 ms) because waiting costs nothing: the same reason one thread can serve many clients. On the Windows test machine the real numbers were about 380 to 450 ms and 125 to 170 ms, because a 100 ms timer fires a little late there (a timer is a minimum delay). The shape is what matters: the first number is about three times the second.

</details>

### Task 2 (medium): build an event loop lag monitor

Write `monitorLag({ intervalMs, thresholdMs, onLag })`. It should use `setInterval` and call `onLag(ms)` when a tick is late by more than `thresholdMs`. It must return a `stop()` function and must **not** keep the process alive by itself. Test it by blocking the loop for 200 ms.

<details><summary>Hint</summary>

Remember the time of the last tick. On each tick, the lateness is `now - last - intervalMs`. Call `unref()` on the interval so the monitor alone does not keep Node running. In your test, keep the process alive with another timer.

</details>

<details><summary>Solution</summary>

```js
function monitorLag({ intervalMs = 10, thresholdMs = 50, onLag }) {
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const lag = now - last - intervalMs; // how much later than planned this tick ran
    last = now;
    if (lag > thresholdMs) onLag(Math.round(lag));
  }, intervalMs);
  timer.unref(); // monitoring alone must not keep the process alive
  return () => clearInterval(timer);
}

// Test: block the loop for 200 ms and see if the monitor notices.
const lags = []; // collect every lag the monitor reports
const stop = monitorLag({ onLag: (ms) => lags.push(ms) });

setTimeout(() => {
  const end = Date.now() + 200;
  while (Date.now() < end) {
    // busy
  }
}, 50);

setTimeout(() => {
  stop();
  const worst = Math.max(0, ...lags);
  console.log(`worst lag detected: about ${Math.round(worst / 100) * 100} ms`);
  console.log('done');
}, 400);
```

```text
worst lag detected: about 200 ms
done
```

The test prints only the **worst** lag. On a busy computer the monitor may also report a few smaller stalls that have nothing to do with your code, so the worst value is the stable one to print.

</details>

### Task 3 (harder): process a big list without freezing the loop

Write `async processInSlices(items, handler, budgetMs)` that calls `handler(item)` for every item but never runs for more than about `budgetMs` milliseconds without giving the loop a turn. Prove with a heartbeat that the loop stays responsive while it processes 100,000 items.

<details><summary>Hint</summary>

Take the time at the start of a slice. After each item, check the clock. When the budget is used up, `await` a `setImmediate` (the promise version is in `node:timers/promises`) and start a new slice.

</details>

<details><summary>Solution</summary>

```js
const { setImmediate: yieldToLoop } = require('node:timers/promises');

// Handles items one by one, but gives the loop a turn every `budgetMs` milliseconds.
async function processInSlices(items, handler, budgetMs = 8) {
  let sliceStart = performance.now();
  for (const item of items) {
    handler(item);
    if (performance.now() - sliceStart >= budgetMs) {
      await yieldToLoop(); // let timers, I/O and other callbacks run
      sliceStart = performance.now();
    }
  }
}

// Test: 100000 items, each costs a little CPU. A heartbeat shows if the loop stays alive.
async function main() {
  let last = performance.now();
  let longestGap = 0;
  const heartbeat = setInterval(() => {
    const now = performance.now();
    longestGap = Math.max(longestGap, now - last);
    last = now;
  }, 10);

  const items = Array.from({ length: 100000 }, (_, i) => i);
  let total = 0;
  await processInSlices(items, (n) => {
    for (let k = 0; k < 2000; k++) total += (n + k) % 7;
  });

  clearInterval(heartbeat);
  console.log('items processed, total =', total);
  console.log('loop stayed responsive (longest gap under 100 ms):', longestGap < 100);
}

main();
```

```text
items processed, total = 600000004
loop stayed responsive (longest gap under 100 ms): true
```

The time budget makes the slices equally long whatever the cost of one item. `setImmediate` (not `nextTick`) lets timers and I/O run between the slices.

</details>

---

## Where to go next

- Next lesson: [09. Events and EventEmitter](../09-events/README.md). Puzzle 4 was a preview: `emit` is synchronous.
- Practise this topic in the interview rounds: [Round 1: screening](../../rounds/round-1-screening/questions.md), [Round 2: core Node.js](../../rounds/round-2-core/questions.md) and [Round 4: advanced](../../rounds/round-4-advanced/questions.md).
- Going deeper later: [18. worker_threads, cluster and Scaling on One Machine](../18-worker-threads-and-cluster/README.md) (move CPU work off the loop), [19. Performance, Profiling and Memory](../19-performance-and-memory/README.md) (event loop lag in a real service) and [23. Node.js Internals](../23-node-internals/README.md) (what sits under libuv).
- Read the official pages: [The Node.js Event Loop, Timers, and process.nextTick()](https://nodejs.org/en/learn/asynchronous-work/event-loop-timers-and-nexttick) and [Don't Block the Event Loop](https://nodejs.org/en/learn/asynchronous-work/dont-block-the-event-loop).
- Run the puzzles again in a week, and try to predict them without looking at the answers.
