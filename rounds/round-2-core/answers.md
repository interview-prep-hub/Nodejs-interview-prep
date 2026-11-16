# Round 2: Core Node.js Technical: Answers

Say the **Short answer** aloud, then go deeper only if asked. Outputs below were checked by running the code on Node 24.

---

## Event loop and async (Lessons 07, 08)

### R2-LOOP-01 [Easy] [Must-know] Explain the event loop in plain words.

**Short answer:** The event loop is the loop that lets one JavaScript thread do many things. It runs your code until the call stack is empty, then picks the next finished task (a timer, an I/O result, a callback) and runs it. While waiting on I/O, the work happens in the OS or the libuv thread pool, not on your thread.

**Interviewer follow-ups:** What blocks it? What is the difference between microtasks and macrotasks?

### R2-LOOP-02 [Medium] [Must-know] Name the phases of the event loop and where `process.nextTick` and promises fit.

**Short answer:** Each turn goes through: timers (setTimeout/setInterval callbacks), pending callbacks, idle/prepare, poll (I/O callbacks, waits for I/O), check (`setImmediate`), close callbacks. After each callback, Node empties the `process.nextTick` queue first, then the promise (microtask) queue, before moving on.

**Go deeper:** So nextTick and promises are not phases, they run "between" callbacks. Recursive nextTick calls can starve the loop. See [Lesson 08](../../lessons/08-event-loop/README.md).

### R2-LOOP-03 [Medium] [Must-know] What is printed, and which part of the order is NOT guaranteed?

**Output:** `sync`, `nextTick`, `promise`, then `timeout` and `immediate` in either order.

**Why:** Sync code finishes first. Then the nextTick queue, then the promise queue. Whether `setTimeout(0)` (really 1 ms) or `setImmediate` runs first from the main module depends on how fast the process started, so it is not guaranteed. Do not rely on it.

### R2-LOOP-04 [Medium] What is printed here, and why is the order different from the previous puzzle?

**Output:** `immediate`, then `timeout`. This order is guaranteed.

**Why:** Inside an I/O callback you are in the poll phase. The next phase is check, where `setImmediate` runs, and the timer only runs when the loop comes back around to the timers phase.

### R2-LOOP-05 [Medium] What is printed?

**Output:** `1`, `3`, `5`, `2`, `4`.

**Why:** `a()` prints 1, calls `b()` (prints 3), then `await` queues the continuation of `a` as a microtask. That is queued before the `.then(4)` callback. `5` is synchronous. Then microtasks run in queue order: 2, then 4.

### R2-LOOP-06 [Hard] What is printed?

**Output:** `tick1`, `p1`, `p2`, `tick in p1`.

**Why:** After the main script, Node runs the nextTick queue (`tick1`), then drains the microtask queue completely: `p1` runs, and `p2` is queued by it and also runs before control returns. A nextTick added from inside a microtask waits until the microtask queue is empty, so it prints last.

### R2-LOOP-07 [Medium] What is printed?

**Output:** `A`, `D`, `B`, `C`, `timeout`.

**Why:** `A` and `D` are synchronous. `await null` queues the continuation first, then `queueMicrotask` queues C. Microtasks run in that order. The timer is a macrotask, so it comes last.

### R2-LOOP-08 [Medium] What is printed?

**Output:** `caught`, `finally`, `then undefined`.

**Why:** `catch` handles the rejection and returns `undefined`, so the chain is fulfilled. `finally` runs and passes the value through. `then` receives `undefined`.

### R2-LOOP-09 [Medium] [Must-know] What blocks the event loop, and how do you find and fix it?

**Short answer:** Anything synchronous and slow on the main thread: big loops, `JSON.parse` of huge input, sync `fs`/`crypto` calls, catastrophic regex backtracking. Symptoms: high latency for all requests while CPU is high on one core. Find it with `perf_hooks.monitorEventLoopDelay()` and a CPU profile (`node --cpu-prof`). Fix by chunking work with `setImmediate`, moving it to `worker_threads`, streaming, or using async APIs.

### R2-LOOP-10 [Hard] What is the libuv thread pool, how big is it by default, and which operations use it?

**Short answer:** It is a pool of 4 threads by default (`UV_THREADPOOL_SIZE`, up to 1024) for work that has no async OS interface: most `fs` calls, `dns.lookup`, `crypto.pbkdf2`/`scrypt`/`randomBytes`, `zlib`. Network sockets do NOT use it, they use OS polling (epoll, kqueue, IOCP). If you start more than 4 slow pool tasks, the rest queue.

### R2-ASY-01 [Medium] How do errors travel through a promise chain?

**Short answer:** A `throw` or a rejection skips `.then` handlers until the next `.catch` (or the second argument of `.then`). A `.catch` that returns normally turns the chain back to fulfilled. Common bug: forgetting to `return` a promise inside `.then`, so the chain does not wait for it and its error is lost.

### R2-ASY-02 [Hard] What is printed? Why is this a trap?

**Output:** `emit returned`, then `unhandledRejection: boom`.

**Why:** `emit` calls the async listener synchronously and ignores the promise it returns. The throw becomes a rejected promise that nobody handles. `emit` does not await listeners. Without the `unhandledRejection` handler, modern Node would crash the process. Fix: catch inside the listener, or use `events.captureRejections`.

### R2-ASY-03 [Medium] How do you add a timeout and cancellation to an async operation?

**Short answer:** Use `AbortController`. `AbortSignal.timeout(ms)` gives a signal that aborts after a delay, and `fetch`, `fs/promises` and `timers/promises` accept a `signal` option. For your own code, check `signal.aborted` or listen for the `abort` event, and clean up timers.

```js
const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
```

**Gotcha:** `Promise.race` with a timer does not cancel the losing work, it only stops waiting for it.

---

## Events, buffers, streams (Lessons 09, 10, 11)

### R2-EV-01 [Easy] Are `EventEmitter` listeners synchronous or asynchronous? What is printed?

**Output:** `before`, `listener`, `after`.

**Why:** `emit` runs listeners synchronously, in the order they were added, before returning. Make a listener async yourself with `setImmediate` or `queueMicrotask` if you need that.

### R2-EV-02 [Medium] [Must-know] What happens if you emit `'error'` with no listener? What is the "possible EventEmitter memory leak" warning?

**Short answer:** An `'error'` event with no listener throws the error, which usually crashes the process. Always add an `error` listener on streams, sockets and emitters. The warning appears when more than 10 listeners (the default) are added to one event, which usually means a leak, for example adding a listener on every request and never removing it.

### R2-BUF-01 [Medium] What is a `Buffer`? How do `Buffer.alloc` and `Buffer.allocUnsafe` differ?

**Short answer:** A `Buffer` is a fixed-size chunk of raw bytes (a `Uint8Array` subclass), used for files, sockets and binary data. `alloc` zero-fills the memory. `allocUnsafe` skips zero-filling and may contain old data from the memory pool, so it is faster but you must overwrite it all before use or sending it.

**Go deeper:** Small `allocUnsafe`/`from` buffers come from a shared 8 KiB pool, so `buf.slice`/`subarray` views share memory with the original.

### R2-BUF-02 [Hard] Why can decoding a stream chunk by chunk corrupt text, and how do you prevent it?

**Short answer:** A multi-byte UTF-8 character (for example a Euro sign or emoji) can be split across two chunks. Calling `chunk.toString()` on each chunk produces replacement characters. Fix: set `stream.setEncoding('utf8')` or use `string_decoder.StringDecoder`, which buffers incomplete characters. Or concat all buffers first, then decode once.

### R2-STR-01 [Easy] [Must-know] What are the four kinds of streams, and why use streams at all?

**Short answer:** Readable, Writable, Duplex (both, independent) and Transform (duplex where output is derived from input). Streams process data in chunks, so memory stays small for big files and you can start sending data before it is all read. They also give you backpressure.

### R2-STR-02 [Medium] [Must-know] What is backpressure, and how does Node handle it?

**Short answer:** Backpressure is the slow consumer telling the fast producer to wait. `writable.write()` returns `false` when its internal buffer is above `highWaterMark`. The producer should stop and wait for the `'drain'` event. `pipe()` and `pipeline()` do this for you. Ignoring it makes memory grow without limit.

### R2-STR-03 [Medium] What is the difference between `pipe()` and `stream.pipeline()`?

**Short answer:** `pipe()` connects streams and handles backpressure, but it does not forward errors or close the other streams when one fails, which leaks file handles. `pipeline()` (or `stream/promises` pipeline) propagates errors, destroys all streams on failure, and gives you a callback or a promise.

### R2-STR-04 [Hard] What is `highWaterMark`, what are the defaults, and what changes in object mode?

**Short answer:** It is the buffer size threshold at which a stream signals backpressure. For byte streams the default is 16 KiB (16384) on Node 24 here, though it can differ by version and platform, so read it with `stream.getDefaultHighWaterMark(false)`. `fs.createReadStream` uses 64 KiB. In object mode it counts objects, and the default is 16.

---

## HTTP, processes, modules, errors, tests (Lessons 03, 12, 13, 14, 15, 16)

### R2-HTTP-01 [Medium] How do you read a request body with the plain `http` module? What can go wrong?

**Short answer:** The request is a readable stream. Collect the chunks and join them when `'end'` fires (or use `for await (const chunk of req)`), then `JSON.parse`. Things that go wrong: no size limit (memory attack, answer 413), wrong `Content-Type`, invalid JSON (answer 400), and forgetting that the body can be huge or arrive slowly.

### R2-HTTP-02 [Medium] What are `keepAliveTimeout`, `headersTimeout` and `requestTimeout`, and why do they matter?

**Short answer:** Defaults on Node 24: `keepAliveTimeout` 5 seconds (how long an idle keep-alive connection stays open), `headersTimeout` 60 seconds (time to receive the headers), `requestTimeout` 300 seconds (time to receive the whole request). They protect against slow clients holding sockets (slowloris). Behind a load balancer, set `keepAliveTimeout` higher than the balancer's idle timeout to avoid random `ECONNRESET`.

### R2-HTTP-03 [Medium] [Must-know] Compare polling, Server-Sent Events and WebSockets.

**Short answer:**

| | Direction | Notes |
| --- | --- | --- |
| Polling | client asks repeatedly | simplest, wasteful, delayed |
| SSE | server to client only | plain HTTP, auto-reconnect, text only |
| WebSocket | both ways | one TCP connection after an HTTP upgrade, binary or text, needs heartbeats and care when scaling |

### R2-PROC-01 [Medium] [Must-know] What is the difference between `exec`, `execFile`, `spawn` and `fork`? Which one risks command injection?

**Short answer:** `exec` runs a command string in a shell and buffers all output, so it is the risky one: user input in the string can inject commands. `execFile` runs a program with an argument array, no shell. `spawn` is like `execFile` but streams output, good for large output. `fork` starts another Node process with a message channel (IPC). Prefer `execFile`/`spawn` with arrays.

### R2-PROC-02 [Medium] How do you shut a Node.js server down gracefully?

**Short answer:** On `SIGTERM`/`SIGINT`: stop accepting new connections (`server.close()`), finish in-flight requests, close idle keep-alive connections (`server.closeIdleConnections()`), close database pools, then exit. Add a hard timeout that forces exit if something hangs.

### R2-MOD-01 [Medium] [Must-know] How does `require` find and load a module? What is cached, and what happens with circular dependencies?

**Short answer:** Resolution: core module first, then relative paths, then `node_modules` up the folder tree. The file is wrapped in a function (giving `exports`, `require`, `module`, `__filename`, `__dirname`), run once, and the result is cached in `require.cache`, so later requires get the same object. With a cycle, the second module receives the first module's partially filled `exports` at that moment.

### R2-MOD-02 [Medium] How do CommonJS and ES modules work together in Node 24?

**Short answer:** ESM can `import` CommonJS (you get `module.exports` as the default export). CommonJS can `require()` an ES module in Node 24 as long as that module does not use top-level `await`. Otherwise use dynamic `import()`. In ESM, use `import.meta.dirname` instead of `__dirname`.

### R2-ERR-01 [Medium] How do you design errors in a Node.js service?

**Short answer:** Separate operational errors (expected, handled, mapped to 4xx/5xx) from programmer errors (bugs). Throw `Error` objects, never strings. Create custom classes with a `code` and an HTTP status, and use `new Error(msg, { cause })` to keep the original error. Handle errors in one central place (error middleware) and log with context such as a request id.

### R2-TEST-01 [Medium] How do you test async code and timers with the built-in `node:test` runner?

**Short answer:** Write `async` test functions with `node:test` and `node:assert/strict`, run with `node --test`. For time, use `mock.timers.enable({ apis: ['setTimeout'] })` and `tick(ms)` so tests do not really wait. For dependencies, pass them in as parameters (dependency injection) and use `mock.fn()` to fake them. Servers listen on port 0 and close after each test.

---

## Coding challenges: approach notes

### R2-CODE-01 [Medium] Build your own EventEmitter

**Approach:** A `Map` of name to array of listeners. `emit` loops over a copy of the array, which makes changes during emit safe. `once` stores a wrapper that removes itself first and keeps the original on `wrapper.listener` so `off(original)` works. The `error` event throws when nobody listens.

**Complexity:** `emit` and `off` are O(listeners).

**Edge cases people miss:** removing a listener during emit, `once` with a re-entrant emit, `off` for a `once` listener, returning `this` for chaining, `emit` returning a boolean.

**What the interviewer looks for:** the copy-before-iterate idea, correct `this`, and the `error` rule.

**Follow-ups:** Why the 10-listener warning? (Leak detection.) Are async listeners awaited? (No.)

Reference solution: [solution](challenges/01-event-emitter/solution/my-emitter.js)
