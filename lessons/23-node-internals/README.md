# 23. Node.js Internals: V8, libuv and How It All Fits

> Level: Advanced   Time: about 200 minutes   Node: 24 (notes where older versions differ)

[Previous: 22. Modern Node.js: What Changed in Node 18, 20, 22 and 24](../22-modern-node-features/README.md) | [All lessons](../../README.md) | [Next: 24. Production, Deployment and Observability](../24-production-and-deployment/README.md)

## What you will learn
- The layers of Node.js (your JS, Node's core JS library, C++ bindings, V8, libuv and the bundled C libraries) and which layer does which job
- How V8 turns your source into bytecode and machine code, why object shapes matter, and what an isolate and a context are
- How libuv's event loop, handles, requests and thread pool map to epoll, kqueue and IOCP, and why file I/O and network I/O are different
- Two end-to-end traces: one `fs.readFile` call and one HTTP request, from JavaScript down to the operating system and back
- What really happens when you run `node app.js`, and how to see what keeps a process alive
- How `require()` and the ES module loader work inside, with a runnable mini `require`
- `AsyncLocalStorage`, `AsyncResource` and `async_hooks`: request-scoped context that follows your `await`s
- `node:vm` (and why it is not a sandbox), the `v8` module, WebAssembly, native addons (Node-API), diagnostics and `perf_hooks`, plus honest answers to the deep-dive interview questions on all of the above

All examples are in `lessons/23-node-internals/examples/`. Run them from the repository root, for example `node lessons/23-node-internals/examples/01-layers.js`.

**Map of the lesson.** Sections 1-6 explain the machine (layers, V8, libuv, start-up, two traced calls). Sections 7-8 explain the module loaders. Sections 9-11 cover context and isolation tools (`AsyncLocalStorage`, `vm`, the `v8` module and Workers). Sections 12-15 are specialist topics (WebAssembly, diagnostics, native addons, Deno and Bun). Section 16 collects interview answers. **Short on time?** Read sections 1, 3, 4, 5, 7 and 9 first: they cover most of what interviewers ask.

> **Read this first (platform and honesty notes):**
> - Outputs come from Node 24.16.0 on Windows 11 (V8 13.6, libuv 1.52.1). Version numbers, thread counts and timings will differ on your machine. Windows-only details you may notice: the stdout resource type (`PipeWrap` or `TTYWrap`, which the examples hide), the 16 KiB default stream buffer, and slow Worker start-up.
> - Nothing was run on Linux, macOS or Node 26. Statements about `epoll` and `kqueue` come from documentation, not from tests.
> - Public, documented APIs: `process.getActiveResourcesInfo()`, `AsyncLocalStorage`, `node:vm`, `node:v8`, `diagnostics_channel`, `perf_hooks`, `WebAssembly`, `worker_threads`.
> - Internal or unstable (use them to learn, never in production code): `process.moduleLoadList`, `socket._handle`, `Module._load` and friends, `--expose-internals`, V8's `--trace-opt` text, the `%HaveSameMap` test function and resource type names such as `FSReqCallback`. Internals change between Node releases. For example, `module.register()` becomes runtime-deprecated in Node 26, so section 8 recommends `registerHooks()`.

**Words used in this lesson (short definitions)**
- **Binding:** C++ code that exposes a native feature to JavaScript. Node's core JS calls bindings.
- **Handle:** a long-lived object in libuv (a timer, a socket, a server). It keeps the loop alive while it is active.
- **Request:** a short-lived operation in libuv (read a file, connect, resolve a name). It keeps the loop alive until it finishes.
- **JIT (just-in-time) compiler:** a compiler that turns hot JavaScript into machine code while the program runs.
- **Isolate:** one independent copy of the V8 engine, with its own heap and garbage collector.
- **Context:** one global environment (its own `Object`, `Array`, `globalThis`) inside an isolate.
- **ABI (application binary interface):** the exact binary rules a compiled library follows. If the ABI changes, old binaries stop working.
- **Bytecode:** a compact list of simple instructions that V8's interpreter runs. It is not machine code.
- **Thread pool:** a small set of worker threads (4 in libuv by default) that run blocking jobs so the main thread does not have to.
- **Microtask:** a small job (a promise callback, an `await` continuation, a `queueMicrotask` callback) that V8 runs as soon as the current JavaScript finishes.
- **Native addon:** a compiled library (written in C, C++ or Rust) that you load with `require()`.

---

## 1. The big picture: seven layers

When you call `fs.readFile('a.txt', cb)`, seven different pieces of software work together. Advanced interviews ask you to name them and say who does what.

```text
+---------------------------------------------------------------+
| 1. YOUR CODE        app.js, express, your npm packages        |
+---------------------------------------------------------------+
| 2. NODE CORE JS     lib/*.js: fs, http, net, stream, events   |
|                     (plain JavaScript, stored in the binary)  |
+---------------------------------------------------------------+
| 3. C++ BINDINGS     internalBinding('fs'), ('tcp_wrap'),      |
|                     ('http_parser') ... glue JS <-> C/C++     |
+------------------+------------------+-------------------------+
| 4. V8            | 5. libuv         | 6. OTHER LIBRARIES      |
| parses and runs  | event loop,      | OpenSSL (TLS, crypto)   |
| JavaScript, JIT, | thread pool,     | zlib, llhttp (HTTP/1),  |
| garbage          | sockets, files,  | c-ares (DNS), ICU,      |
| collector, wasm  | timers           | nghttp2 (HTTP/2),       |
|                  |                  | undici (fetch; JS code) |
+------------------+------------------+-------------------------+
| 7. OPERATING SYSTEM   epoll / kqueue / IOCP, threads, files   |
+---------------------------------------------------------------+
```

One sentence per layer:
1. **Your code** is what you write.
2. **Node core JS** is the JavaScript part of Node itself. `require('node:fs')` gives you functions written in JavaScript that validate your arguments and then call a binding.
3. **Bindings** are the bridge. They convert JavaScript values to C++ values, call libuv or a C library, and turn results back into JavaScript.
4. **V8** is Google's JavaScript engine. It only knows the JavaScript language (and WebAssembly). It knows nothing about files, sockets, timers, `require` or `process`. All of that comes from Node.
5. **libuv** is a C library that gives Node its event loop, its thread pool and a portable way to do file, socket, timer and process work on Linux, macOS and Windows.
6. **Other libraries** do specialised work. Node ships them inside the binary.
7. **The operating system** finally does the real I/O.

Two names from Node's own source code come up in advanced interviews:
- **`internalBinding('name')`** is how Node's core JS asks for a C++ binding (`internalBinding('fs')`, `internalBinding('tcp_wrap')`). It exists only inside Node's core JS, so your code cannot call it. The "bonus peek" below uses a flag that is meant for Node's own tests.
- **Primordials** are saved copies of the JavaScript built-ins (`Array.prototype.push`, `Promise.prototype.then`, `Map` and so on) that Node's core JS captures at start-up and uses instead of the live globals. If your program replaces `Array.prototype.push` or `Promise.prototype.then`, Node's own `fs` and `http` code keeps working, because it never looks those functions up again.

Example `01-layers.js` shows these layers on your own machine. Part 1 prints what is compiled into the `node` binary:

```js
const parts = [
  ['v8', 'JavaScript engine: parser, interpreter, JIT compilers, garbage collector'],
  ['uv', 'libuv: event loop, thread pool, sockets, files, timers'],
  ['openssl', 'TLS and crypto'],
  // ... zlib, llhttp, ares, undici, icu, nghttp2
];
for (const [key, what] of parts) {
  console.log(`  ${key.padEnd(8)} ${String(process.versions[key]).padEnd(22)} ${what}`);
}
```

Part 2 proves that core functions are ordinary JavaScript: `Function.prototype.toString()` works on them, so you can read `fs.statSync` itself. Part 3 shows that loading `node:http` loads native bindings. Output (excerpt, the full source of `statSync` is left out here and shown below):

```text
Part 1: bundled parts (versions are from the node binary running this file)
  node     24.16.0                Node.js itself (core JS library + C++ bindings)
  v8       13.6.233.17-node.49    JavaScript engine: parser, interpreter, JIT compilers, garbage collector
  uv       1.52.1                 libuv: event loop, thread pool, sockets, files, timers
  openssl  3.5.6                  TLS and crypto
  zlib     1.3.1-e00f703          gzip and deflate (node:zlib)
  llhttp   9.4.1                  HTTP/1 parser used by node:http
  ares     1.34.6                 c-ares: asynchronous DNS queries (dns.resolve*)
  undici   7.25.0                 HTTP client behind the global fetch()
  icu      78.3                   Unicode, Intl, time zones
  nghttp2  1.68.0                 HTTP/2 framing (node:http2)

Part 3: what require("node:http") loaded
  native bindings added: uv, cares_wrap, stream_wrap, tcp_wrap, pipe_wrap, http_parser
  core JS files added  : 32

Part 4: numbers native addons care about
  process.versions.modules (NODE_MODULE_VERSION): 137
  process.versions.napi (highest Node-API version): 10

Part 5: build settings (process.config.variables)
  node_use_node_snapshot   true
  node_shared              false
  node_shared_libuv        false
  node_shared_openssl      false
  v8_enable_maglev         1
  v8_enable_webassembly    1
```

This is the real source of `fs.statSync` on Node 24.16 (Part 2 of the example prints it):

```js
function statSync(path, options = { bigint: false, throwIfNoEntry: true }) {
  const stats = binding.stat(
    getValidatedPath(path),
    options.bigint,
    undefined,
    options.throwIfNoEntry,
  );
  if (stats === undefined) {
    return undefined;
  }
  return getStatsFromBinding(stats);
}
```

Read it as the three layers in miniature: `getValidatedPath` is core JS checking your argument, `binding.stat` crosses into C++ (which asks libuv to run a `stat` for the file), and `getStatsFromBinding` turns the numbers back into a `Stats` object.

What Part 3 tells you: `require('node:http')` added `tcp_wrap`, `pipe_wrap` and `stream_wrap` (libuv sockets and streams), `http_parser` (the llhttp parser) and `cares_wrap` (DNS). Those names are the bridge between layers 2 and 5-6.

Part 5 shows two more facts about this binary. Node starts from a built-in startup snapshot (`node_use_node_snapshot`, more in section 4). And the libraries are linked into the binary (`node_shared*` are false), so the versions in `process.versions` are the versions you run.

A bonus peek at the real bindings. This flag is meant for Node's own tests, so it prints a warning, and the result can change in any release:

```bash
node --expose-internals -e "const { internalBinding } = require('internal/test/binding'); console.log(Object.keys(internalBinding('tcp_wrap')))"
```

```text
[ 'TCP', 'TCPConnectWrap', 'constants' ]
```

`TCP` is the C++ class behind every TCP `net.Socket`, and `TCPConnectWrap` is the request object for "connect". You will meet both in section 6.

Primordials can be seen the same way. Their names are the original names glued together, such as `ArrayPrototypePush`:

```bash
node --expose-internals --no-warnings -e "const { primordials: p } = require('internal/test/binding'); console.log(typeof p.ArrayPrototypePush, typeof p.PromisePrototypeThen)"
```

```text
function function
```

> **Interview tip:** "Is Node.js V8?" No. V8 is one part. A strong answer names the split: V8 runs JavaScript, libuv does I/O and the event loop, Node's C++ bindings and core JS connect them and provide `fs`, `http`, `require` and `process`. `setTimeout` is not part of the JavaScript language either; example `09-vm-not-a-sandbox.js` shows it is `undefined` inside a fresh V8 context.

---

## 2. V8 in plain words

V8 is the engine that runs your JavaScript. It does five jobs.

### 2.1 From text to something that runs
1. **Parse.** V8 reads your source text and builds a tree that describes the program. It is lazy: a function that was never called is only skimmed (a "pre-parse") and fully parsed the first time it runs. You can check the default: `node --v8-options` lists `--lazy` as on.
2. **Ignition (the interpreter).** V8 turns the tree into **bytecode**, a compact list of simple instructions, and runs it right away. Starting is fast, but running bytecode is slow compared to machine code.
3. **Collect feedback.** While running, V8 records what it sees: "this `+` only ever got small integers", "this property read always saw the same object shape". This is called **type feedback**.
4. **Compile hot code.** A function that runs often becomes **hot**, and V8 compiles it to machine code. Modern V8 has four tiers. A function usually climbs them in order, but V8 decides with its own counters (do not expect a fixed number of calls), and it can skip a tier:

| Tier | Name | What it is |
|---|---|---|
| 0 | Ignition | Bytecode interpreter. Always the first stop. |
| 1 | Sparkplug | Baseline compiler. Turns bytecode into machine code fast, with almost no optimization. |
| 2 | Maglev | Mid-tier optimizing compiler. Compiles quickly and uses type feedback. |
| 3 | TurboFan | Top-tier optimizing compiler. Slowest to compile, fastest result. |

5. **Deoptimize.** The optimizing tiers make bets from the feedback ("`a` and `b` are small integers") and put cheap checks (guards) in the machine code. If a bet fails, V8 throws the optimized code away and goes back to the interpreter. This is called **deoptimization** (a "bailout").

Maglev has been on by default since Node 22 (V8 12.4). On Node 24 you can confirm all the tier flags yourself, and even watch one function move up and down. Example `02-jit-and-shapes.js` (parts 1 and 2):

```js
function add(a, b) { return a + b; }
let sum = 0;
for (let i = 0; i < 300000; i++) sum = add(sum, i % 10); // always small numbers
add('x', 'y');                                      // a surprise: strings
for (let i = 0; i < 300000; i++) sum = add(sum, i % 10);
```

The `% 10` keeps the sum small: a huge sum would stop being a small integer and cause a deoptimization of its own, which would blur the lesson.

The example runs this in a child process with `node --trace-opt --trace-deopt` and summarises the trace lines for `add`. Part 4 of the same file is covered in 2.2. Output of parts 1 and 2 (the same on every run that was tried):

```text
Part 1: default value of the tier flags in this build (from node --v8-options)
  --sparkplug  on
  --maglev     on
  --turbofan   on

Part 2: trace of function add() in a child process (node --trace-opt --trace-deopt)
  V8 optimized add() with Maglev: true
  V8 threw the optimized code away because: not a Smi
```

A raw trace line looks like this (trimmed). "Smi" means "small integer", V8's fast representation for whole numbers. The strings are not small integers, so the guard "both inputs are Smis" fails:

```text
[marking ... <JSFunction add ...> for optimization to MAGLEV, ConcurrencyMode::kConcurrent, reason: hot and stable]
[bailout (kind: deopt-eager, reason: not a Smi): begin. deoptimizing ... <JSFunction add ...>, ... <Code MAGLEV> ...
```

After the bailout, `add` becomes hot again and is marked for optimization once more. In some runs the trace also contains `for optimization to TURBOFAN_JS`, in other runs of this short program it does not (the timing of the background compiler decides), so the example does not print that tier. The exact wording of these lines changes between V8 versions, and `--trace-opt` output is not a stable interface. The idea does not change: hot code climbs tiers, a broken assumption sends it back.

> **Remember:** the optimizing compilers compile in background threads (`--concurrent-recompilation` is on), so your JavaScript keeps running in the interpreter or baseline code while the optimized version is built. This is one reason a Node process has more threads than you might expect (about a dozen when idle, on the author's Windows machine).

> **Interview tip:** "How does V8 make JavaScript fast?" A strong short answer: it starts in an interpreter (Ignition) so start-up is quick, records type feedback while the code runs, and recompiles hot functions to machine code (Sparkplug, Maglev, TurboFan) using that feedback. If a guess turns out wrong, it deoptimizes and tries again. Then add the practical point: consistent types and object shapes in hot code help, but measure before you tune.

### 2.2 Hidden classes (shapes) and inline caches, in one paragraph
JavaScript objects look like dictionaries, but looking up `obj.x` in a dictionary on every access would be slow. So V8 gives every object a hidden **shape** (V8 calls it a *map*) that says "this object has `x` at slot 0 and `y` at slot 1". Objects built with the same properties in the same order share one shape. At every `obj.x` in your code, V8 keeps a small **inline cache** next to the bytecode: "last time the shape was S, so `x` lives at slot 0". The next time, it checks the shape and reads the slot directly. One shape seen is **monomorphic** (fastest), a few shapes (V8 keeps up to four; the flag `--max-valid-polymorphic-map-count` shows `4` in `node --v8-options`) is **polymorphic**, and more than that is **megamorphic**, where V8 gives up caching and uses a slower generic lookup.

Part 3 of the example asks V8 directly whether objects share a shape (it uses a V8 test function that is switched on at run time with `v8.setFlagsFromString`, which is fine for exploring and wrong for real code, see section 11):

```js
const a = { x: 1, y: 2 };
const b = { x: 5, y: 6 };         // same names, same order  -> same shape as a
const c = { y: 2, x: 1 };         // same names, other order -> a different shape
const d = { x: 1, y: 2, z: 3 };   // one more property       -> a different shape
```

Part 4 measures what many shapes cost. It reads `obj.x` in a hot loop over 1024 objects that have 1, 2, 4 or 8 different shapes (the other property name differs). Output of parts 3 and 4 from one run (part 3 is the same every time; the timings in part 4 are not):

```text
Part 3: do these objects share one hidden class?
  a {x,y} and b {x,y}   : true
  a {x,y} and c {y,x}   : false
  a {x,y} and d {x,y,z} : false
  a has fast properties : true
  e after delete e.x    : false (fast properties?)

Part 4: median time for 10000 passes over 1024 objects (lower is better, your numbers will differ)
   1 shape(s):   51 ms
   2 shape(s):   74 ms
   4 shape(s):  103 ms
   8 shape(s):  209 ms
```

What this shows: the time grew steadily from 1 to 4 shapes and then jumped at 8, which fits the "up to four, then megamorphic" story. Across several runs, 8 shapes were roughly 4 to 6 times slower than 1 shape (the machine was busy during some of them). The absolute numbers change on every run and every machine.

What it does not show: this is a micro-benchmark of one property read in a hot loop. In a real server most time goes to I/O, so shapes only matter in hot code paths. The practical rules are cheap to follow:
- Create objects of the same kind the same way: same properties, same order, ideally set in the constructor.
- Do not add or `delete` properties on hot objects after creation. Deleting usually moves an object to slow "dictionary mode" (the last line above).
- Do not pass wildly different object shapes through the same hot function.

> **Common mistake:** "Optimize for hidden classes everywhere." Do not. Write clear code first, measure with a profiler (lesson 19), and only then fix a hot function that sees many shapes.

### 2.3 Garbage collection in short
V8 allocates objects on a **heap** and frees them automatically. It is **generational**: most objects die young, so the heap is split into a small **new space** (collected often and quickly, survivors are copied and later promoted) and a big **old space** (collected less often with a mark-and-sweep method that runs partly in background threads to keep pauses short). Large objects, code and read-only data have their own spaces. Memory used by `Buffer` and other `ArrayBuffer`s lives outside the V8 heap but is counted by V8 as external memory. Example `10-v8-module.js` (section 11) lists the spaces on your machine. For leaks, heap limits (`--max-old-space-size`), GC tuning and heap snapshots, continue in [Lesson 19: Performance and Memory](../19-performance-and-memory/README.md).

### 2.4 Isolates and contexts
- An **isolate** is one running copy of V8: its own heap, its own garbage collector, its own microtask queue. Only one thread runs inside an isolate at a time. The main thread of a Node process has one isolate. Every `Worker` thread gets its own.
- A **context** is a global environment inside an isolate: its own `globalThis`, its own `Object`, `Array`, `Error`. One isolate can hold many contexts, and they all share the same heap and the same thread.

Section 10 (`vm`) shows contexts; section 11 shows an isolate in a Worker. For now remember: *an isolate separates memory and threads, a context only separates global names.*

---

## 3. libuv in plain words

libuv is a C library with one job: let a single thread wait for many things at once, on every operating system. Node uses it for the event loop, timers, sockets, pipes, child processes, file system calls and the thread pool. (The loop phases and the exact ordering rules are the topic of [Lesson 8: The Event Loop](../08-event-loop/README.md); this lesson looks at what sits underneath.)

### 3.1 The event loop in plain words
The **event loop** is a `while` loop that runs on the main thread. Each turn it does a fixed list of jobs in a fixed order, then goes round again. This is a simplified picture of libuv's `uv_run` function (the libuv design overview documents the order; the real C code has more bookkeeping):

```text
while (anything is still active) {
  1. update the loop's clock
  2. run timers that are due              your setTimeout and setInterval callbacks
  3. run "pending" callbacks              a few I/O callbacks that were postponed
  4. run idle and prepare handles         mostly internal bookkeeping
  5. POLL: ask the OS which sockets are ready and run their callbacks.
     If nothing is ready, SLEEP here until something is, or until the next timer is due.
  6. run check handles                    your setImmediate callbacks
  7. run close callbacks                  for example socket.on('close')
}
```

After every callback that Node's C++ runs in JavaScript, Node empties its `nextTick` queue and then the promise microtasks (section 5.4). Those two queues are not steps of the loop; they run between callbacks.

Step 5 is where an I/O-bound server spends nearly all of its life. The poll step works out how long it may sleep: not at all if other work is waiting, otherwise until the next timer is due, or without limit if there are no timers. Then it makes one blocking call to the operating system (in libuv's source: `epoll_wait` on Linux, `kevent` on macOS, `GetQueuedCompletionStatusEx` on Windows). The OS parks the thread, and a parked thread uses no CPU. Part 3 of example `03-loop-lifecycle.js` measures this with `performance.eventLoopUtilization()` (the share of a time window that the loop spent working instead of waiting):

```text
Part 3: the loop sleeps when it has nothing to do
  waiting 150 ms for a timer: utilization below 10% (the loop was asleep): true
  blocking it for 100 ms in JavaScript: utilization above 90%: true
```

What follows from this picture:
- While one callback runs, nothing else on the loop runs. A slow callback delays every timer and every socket. That is the real meaning of "do not block the event loop".
- The loop does not busy-wait. An idle server costs almost no CPU.
- The ordering puzzles (`setTimeout` against `setImmediate`, `nextTick`) are worked through in Lesson 8.

**How timers fit in.** Node does not create one libuv timer per `setTimeout`. From Node's source (`lib/internal/timers.js`): it keeps lists of timers grouped by duration (every 1000 ms timer joins the same list, which makes adding one cheap), orders the lists in a priority queue, and arms a single libuv timer for the earliest one. You can see the grouping with the test flag. Four timers of 1000 ms and one of 2000 ms give two lists:

```bash
node --expose-internals --no-warnings -e "const t = require('internal/timers'); for (let i = 0; i < 4; i++) setTimeout(() => {}, 1000).unref(); setTimeout(() => {}, 2000).unref(); console.log(Object.keys(t.timerListMap))"
```

```text
[ '1000', '2000' ]
```

### 3.2 Handles and requests
libuv has two kinds of objects:

| Kind | Lives | Examples | Node names you will see |
|---|---|---|---|
| **Handle** | for a long time, until closed | timer, TCP socket, TCP server, pipe, child process | `Timeout`, `TCPSocketWrap`, `TCPServerWrap`, `ProcessWrap` |
| **Request** | for one operation | read a file, connect, write, shut down, resolve a name | `FSReqCallback`, `ConnectWrap`, `GetAddrInfoReqWrap`, `SimpleShutdownWrap` |

(`Timeout` and `Immediate` are JavaScript objects from Node's own timer code; Node runs all JavaScript timers on top of a single libuv timer handle. They still count as active resources, which is why they appear in `getActiveResourcesInfo()`.)

The loop keeps running as long as there is at least one **active handle** or **active request**. A handle can be marked "not counted" with `unref()`. This rule is the whole story behind "why does my process not exit?" and "why did it exit too early?". Section 4 turns it into a tool.

### 3.3 How waiting works: epoll, kqueue and IOCP
Sockets are waited on by the operating system, not by threads. The loop asks the OS "wake me when any of these 10,000 sockets has something", sleeps, and handles whatever woke it:

| OS | Mechanism | Style |
|---|---|---|
| Linux | `epoll` | readiness: "this socket is now readable" |
| macOS, BSD | `kqueue` | readiness |
| Windows | IOCP (I/O completion ports) | completion: "your read finished, here are the bytes" |

libuv hides the difference, so your Node code looks the same on all three. In plain words: with **readiness** (epoll, kqueue) the OS says "this socket can be read now" and libuv does the read itself. With **completion** (IOCP) libuv hands the OS a buffer up front and the OS says "the read is finished, here are the bytes".

### 3.4 File I/O versus network I/O
This is a favourite interview question, because the two are handled completely differently.

| | Network (sockets) | File system |
|---|---|---|
| Waited on by | the OS poller (epoll, kqueue, IOCP), in the loop thread | **the libuv thread pool**: blocking calls on worker threads |
| Why | sockets can be made non-blocking | epoll refuses regular files and kqueue always reports them "ready" (so neither tells you anything useful, per their man pages), so libuv just runs the blocking call on another thread |
| Scales with | thousands of connections, no extra threads | the pool size (4 threads by default) |
| Node APIs | `net`, `http`, `tls`, `dgram`, `dns.resolve*` | `fs.*` (async versions), `dns.lookup`, `crypto.pbkdf2`/`scrypt`, `zlib` |
| Result comes back by | the poller reports the socket ready, libuv reads | the pool thread finishes, then **wakes the loop thread** with an async notification (`uv_async_send`) |

The thread pool has 4 threads unless you set the environment variable `UV_THREADPOOL_SIZE` before Node starts (verified on 24.16; setting it from inside the script is not guaranteed to work).

The pool is one shared queue served by those threads. If four slow jobs are running (say four `crypto.pbkdf2` calls), a fifth job waits in the queue, even if it is a tiny `fs.stat`. On the author's machine, 8 `pbkdf2` jobs started together finished in two waves of four, after about 365 ms and about 730 ms. Lesson 8 has two examples you can run and change: `06-threadpool-size.js` and `07-threadpool-vs-sockets.js`.

The table follows the libuv design overview: there is no portable, non-blocking primitive for regular files, so blocking file calls go to a thread pool, while network I/O always happens in the loop's own thread. The wake-up with `uv_async_send` comes from libuv's source, and you cannot observe it from JavaScript.

Details can differ by operating system and libuv version. For example, libuv also contains optional `io_uring` code for some file operations on some Linux kernels. Treat the table as the model to remember, not as a promise about every build.

Two details people get wrong:
- `dns.lookup()` (used by `net.connect('localhost', ...)` and `http.get('http://localhost')`) calls the operating system's `getaddrinfo` on the thread pool, while `dns.resolve*()` sends its own network queries (through c-ares) without the pool. The docs warn that heavy `dns.lookup` traffic can compete with `fs` for the 4 threads.
- The synchronous versions (`fs.readFileSync`, `fs.statSync`) do not use the pool at all. They run the system call right in the calling thread, which is exactly why they block the loop.

> **Common mistake:** "Node is single-threaded." Your JavaScript runs on one thread per isolate, but the process also has V8 helper threads (compiling, garbage collection), the libuv pool, and any Workers. On the author's Windows machine an idle `node` process already shows about a dozen OS threads. Say "single-threaded event loop for JavaScript, with threads working behind it".

> **Interview tip:** "How does Node do asynchronous file I/O if the OS cannot poll regular files?" A strong short answer: "It does not. libuv runs the blocking call on a thread pool thread and wakes the loop when it is done, so JavaScript sees an asynchronous API. Sockets are different: they are truly non-blocking and waited on by epoll, kqueue or IOCP." Follow-up questions to expect: the pool size (4, changed with `UV_THREADPOOL_SIZE`), which APIs use the pool (`fs`, `dns.lookup`, `crypto.pbkdf2`, `zlib`), and what happens when it is full (jobs wait in the queue).

---

## 4. What happens when you run `node app.js`

Here is the life of a process, in order. Steps 1 to 4 happen before any line of your code runs; steps 5 to 7 are the part you can see.

1. **Start-up of the platform.** The OS starts the `node` binary. Node reads the command line (some flags go to V8; list them with `node --v8-options`), sets up OpenSSL and ICU, starts V8's platform with a set of background worker threads, and creates the libuv loop.
2. **A V8 isolate is restored from a snapshot.** Running all of Node's own bootstrap JavaScript on every start would be slow, so the Node binary contains a **startup snapshot**: a saved copy of the V8 heap right after bootstrap. The isolate is created from that snapshot instead (your build setting `node_use_node_snapshot: true` from section 1).
3. **Pre-execution.** Node finishes setting up `process`, processes options like `--require` and `--import`, and prepares the module loaders.
4. **Choose CommonJS or ES module for the entry file.** In short: `.mjs` is ESM, `.cjs` is CommonJS; for `.js`, the nearest `package.json` `"type"` decides; with no `"type"`, Node first runs it as CommonJS and, if the code turns out to contain ESM syntax, runs it as ESM instead (syntax detection). The entry function is `executeUserEntryPoint` in the core file `internal/modules/run_main` (its name shows up when you list that file's exports with `--expose-internals`).
5. **Run the main module.** Your file runs from top to bottom, synchronously. Everything it starts (timers, I/O, promises) is only *scheduled*.
6. **Drain the two fast lanes.** When the main module ends, Node runs the `process.nextTick` queue and then the promise microtasks (in an ES module main file the order is the other way round, see lesson 8).
7. **Spin the event loop.** libuv runs the loop while there is any active handle or request. When nothing is left, Node emits `process.on('beforeExit')`. If a listener scheduled new work, the loop runs again and `beforeExit` fires again later. When the loop is empty and no `beforeExit` listener added work, Node emits `process.on('exit')`, tears down the environment and the process ends with the exit code. (`beforeExit` is not emitted when you call `process.exit()` or after an uncaught exception, and `exit` listeners may only do synchronous work.)

### A window into step 7: `process.getActiveResourcesInfo()`
This function (added in Node 17.3 and 16.14, stable since 24.0) returns an array of strings that names what is keeping the loop alive right now. It is the best debugging tool for "why won't my process exit?".

Example `03-loop-lifecycle.js` starts and stops resources one by one and prints the counts by type (it hides `PipeWrap` and `TTYWrap`, which are only your terminal or the pipe behind `process.stdout`). The key lines:

```js
const timer = setTimeout(() => {}, 100000);
show('after setTimeout(..., 100000)');   // Timeout x1
timer.unref();
show('after timer.unref()');             // (nothing)
```

Output (Part 3 was explained in section 3.1):

```text
Part 1: what happens after the main module
  [main module] runs first, from top to bottom
  [main module] reached its last line. Nothing async has run yet.
  [nextTick] runs before promise microtasks in a CommonJS main module
  [promise microtask] runs after the main module

Part 2: active resources (what the loop is waiting for)
  at the start                         (nothing)
  after setTimeout(..., 100000)        Timeout x1
  after timer.unref()                  (nothing)
  after a never-settling promise       (nothing)
  after setImmediate()                 Immediate x1
  after clearImmediate()               (nothing)
  after fs.readFile() was started      FSReqCallback x1
  after the readFile callback ran      (nothing)
  server is listening                  TCPServerWrap x1
  client and server socket connected   TCPServerWrap x1, TCPSocketWrap x2
  everything closed                    (nothing)

Part 3: the loop sleeps when it has nothing to do
  waiting 150 ms for a timer: utilization below 10% (the loop was asleep): true
  blocking it for 100 ms in JavaScript: utilization above 90%: true

[beforeExit #1] the loop is empty. active: (nothing)
  scheduling one more timer from beforeExit, so the loop wakes up again
  [timer] ran because beforeExit started new work

[beforeExit #2] the loop is empty. active: (nothing)
[exit] code 0. Only synchronous work is possible now.
```

Read it line by line:
- A **promise that never settles** is not a resource. It does not keep the process alive. A CommonJS script with only such a promise just ends silently with exit code 0. (In an ES module, a top-level `await` on a never-settling promise ends with the warning "unsettled top-level await" and exit code 13.)
- `unref()` removes a timer (or a server, or a socket) from the "keeps me alive" count. This is how libraries run background timers that must not block shutdown.
- A server needs `TCPServerWrap`, and each connection is another `TCPSocketWrap`. Here there are two sockets because the client and the accepted server-side socket are both in our process.
- `beforeExit` fired twice: the first listener added a timer, so the loop woke up again.
- The `setTimeout` inside the `exit` listener never runs, because nothing runs after `exit` listeners return.

> **Interview tip:** "Why does my script not exit?" Answer: something still counts as active (an open server, a socket, an interval, a child process, a pending request). Call `process.getActiveResourcesInfo()` to see the types. "Why did it exit too early?" Answer: you only have a promise or an `unref`'d handle, and a pending promise alone does not keep Node alive.

### Startup snapshots and single executable applications
The same snapshot idea is open to you. With `v8.startupSnapshot` you run your own start-up code **once at build time**, save the heap, and every later start skips that work. Example `10-v8-module.js` (part 4, section 11) builds and runs one.

**Single executable applications (SEA)** go one step further: you inject a script (and optionally a snapshot and a V8 code cache) into a copy of the `node` binary, so your program ships as one file with no separate Node install. On Node 24.16 SEA is still in active development (stability 1.1) and supports one CommonJS script. The build uses `node --experimental-sea-config` and the `postject` tool to inject the blob.

A common SEA trap: `postject` needs the "fuse" string (`NODE_SEA_FUSE_...`) that is stored inside the `node` binary, and the value in many older tutorials is out of date. A wrong one fails with "Could not find the sentinel". Search your own `node` binary for the text `NODE_SEA_FUSE_` and use what you find.

A smaller trick in the same family is the **compile cache**. `module.enableCompileCache()` (from `node:module`, no longer experimental since Node 24.15) saves V8's compiled code for your modules on disk, so the next start skips parsing and compiling them. It helps big command-line tools and apps that load many files.

---

## 5. Follow one call: `fs.readFile`

We follow a single call through every layer. Example `04-trace-readfile.js` does it with real data.

### 5.1 The JavaScript half
Part 1 prints the lines of `fs.readFile` that touch C++ (they are read from the function's real source):

```text
Part 1: lines of fs.readFile that cross into C++ (read from the real function)
  const req = new FSReqCallback();
  req.oncomplete = readFileAfterOpen;
  binding.open(getValidatedPath(path), flagsNumber, 0o666, req);
```

`FSReqCallback` is a C++ request object. `oncomplete` is the JavaScript function Node will call when the request finishes. `binding.open` hands the request to C++.

### 5.2 The chain of requests
Part 2 uses `async_hooks` to record every `FSREQCALLBACK` (the type name `async_hooks` gives to these request objects) that one `readFile` creates:

```js
const hook = asyncHooks.createHook({
  init(id, type) {
    if (type === 'FSREQCALLBACK') {
      events.push(`libuv request ${++requests} created (${steps[requests - 1] || 'more'})`);
    }
  },
}).enable();
fs.readFile(smallFile, 'utf8', (err, text) => { /* ... */ });
```

(The example records into an array and prints at the end, because printing inside a hook would itself create resources and trigger the hook again.) Output of Parts 2 to 4 (Part 1 was shown above, Part 5 is in section 5.4):

```text
Part 2: the timeline of one fs.readFile call
  1. JS: fs.readFile() is called
  2. libuv request 1 created (open), runs on a thread pool thread
  3. JS: fs.readFile() returned at once. Active resources: FSReqCallback
  4. libuv request 2 created (fstat), runs on a thread pool thread
  5. libuv request 3 created (read), runs on a thread pool thread
  6. libuv request 4 created (close), runs on a thread pool thread
  7. JS: callback runs on the main thread with 24 characters
  8. JS: process.nextTick inside the callback
  9. JS: promise microtask inside the callback

Part 3: reading a 32 MiB file
  libuv requests used by the async readFile: 67 (open, fstat, many reads, close)
  loop got turns while fs.readFile worked: true
  loop got turns during fs.readFileSync   : false

Part 4: resource types you see right after starting an operation
  fs.readFile                        FSReqCallback
  fs.promises.readFile               FSReqPromise
  dns.lookup("localhost")            GetAddrInfoReqWrap
  net.connect(port, "127.0.0.1")     TCPSocketWrap
  net.connect(port, "localhost")     GetAddrInfoReqWrap, TCPSocketWrap
  setTimeout                         Timeout
```

The labels `open`, `fstat`, `read`, `close` come from Node's source (`lib/fs.js` and `lib/internal/fs/read/context.js`), not from the hook: the hook only sees "a request was created". The order is fixed because each step is started from the completion callback of the previous one.

> **Version note:** the request count, the 512 KiB read size and the names `FSReqCallback`/`FSREQCALLBACK` are implementation details of Node 24.16. Other Node versions can read in other chunk sizes or use other helper classes. The shape of the story (a chain of small requests on the pool, each finishing on the main thread) is what stays true.

### 5.3 The full journey, step by step
1. **JS:** `fs.readFile(path, cb)` validates the arguments, creates a `ReadFileContext` and an `FSReqCallback`, sets `req.oncomplete`.
2. **Binding:** `binding.open(path, flags, mode, req)` crosses into C++. C++ asks libuv to open the file and passes a completion callback. Because a callback is given, libuv does not do the work now: it puts the job in its work queue and **returns immediately**. (Step 3 in the output: `readFile` returned at once.)
3. **Thread pool:** one of the 4 pool threads takes the job and makes the blocking system call (`open` on Linux and macOS, the equivalent on Windows).
4. **Wake-up:** when the call finishes, the pool thread records the result and notifies the loop thread with an async handle (`uv_async_send` in libuv's source).
5. **Back on the main thread:** in its next turn the loop runs the completion. Node's C++ calls the JavaScript function `req.oncomplete` (C++ calling into JS is named `MakeCallback` in Node's source). This is the `readFileAfterOpen` function, and it starts the next request, `fstat`.
6. **Repeat:** `fstat` (to learn the size), then `read` in chunks (the 32 MiB file needed 64 reads of 512 KiB, which with `open`, `fstat` and `close` makes the 67 requests in Part 3), then `close`.
7. **Your callback:** after the last request, `readFile` calls `cb(err, data)`. When a callback that came from C++ returns, Node drains the **nextTick queue and then the promise microtasks** before going back to the loop. That is why items 8 and 9 of the timeline come in that order.

Part 3 proves the claim "the loop stays free": a 1 ms interval got turns while the async read worked, and got none during `readFileSync`.

It does *not* claim the async version is faster. In quick tests on the author's Windows machine (the example does not print timings), reading the 32 MiB file asynchronously took 6 to more than 20 times longer than reading it synchronously, depending on how busy the machine was. The cause is the many round trips between the loop and the pool. The loop stayed responsive, though. Asynchronous means "does not block", not "finishes sooner".

Part 4 shows how request types differ. `dns.lookup` shows up as `GetAddrInfoReqWrap` (pool), the socket as `TCPSocketWrap` (no pool). Connecting to `localhost` by name first does a lookup, connecting to `127.0.0.1` does not.

> **Under the hood:** not every pool job appears in `getActiveResourcesInfo()`. In a test run for this lesson, `crypto.pbkdf2`, `crypto.randomBytes` and `zlib.gzip` added nothing to that list, even though `pbkdf2` and zlib work runs on the pool. Use it as a diagnostic aid, not as a complete inventory of pool work.

### 5.4 Where `nextTick` and promises wait
Step 7 of the journey in 5.3 said that Node empties "the nextTick queue and then the promise microtasks". These are two different queues with two different owners.

**The nextTick queue belongs to Node.** `process.nextTick(fn)` is plain JavaScript that pushes an object onto a queue Node keeps. Part 5 of example `04-trace-readfile.js` prints the lines of the real function that do this (an internal detail that can change between versions):

```text
Part 5: the real process.nextTick pushes onto a queue that Node owns
  if (queue.isEmpty())
  setHasTickScheduled(true);
  [async_context_frame]: AsyncContextFrame.current(),
  queue.push(tickObject);
```

Notice that each queued tick also remembers the current async context frame. That is one of the ways `AsyncLocalStorage` survives a `nextTick` (section 9).

**The promise queue belongs to V8.** `.then` callbacks, `await` continuations and `queueMicrotask` jobs wait in V8's microtask queue. Node's `task_queue` binding gives Node the controls it needs: `enqueueMicrotask` and `runMicrotasks`. You can list the binding with the test flag:

```bash
node --expose-internals --no-warnings -e "console.log(Object.keys(require('internal/test/binding').internalBinding('task_queue')))"
```

```text
[
  'enqueueMicrotask',
  'setTickCallback',
  'runMicrotasks',
  'tickInfo',
  'promiseRejectEvents',
  'setPromiseRejectCallback'
]
```

`setTickCallback` registers the function that Node runs after each callback. From Node's source (`lib/internal/process/task_queues.js`), that function loops: run every queued tick, then call `runMicrotasks()` so that V8 drains its queue, and repeat while ticks are still queued. The listing above shows that the pieces exist; the loop itself is described from the source, not printed at run time.

That loop explains three facts you can check in lesson 8: in a CommonJS callback `nextTick` runs before promises; a tick queued from inside a promise callback waits until V8's queue is empty; and endless recursive `nextTick` calls starve the event loop. In an ES module the whole main file runs inside a promise job, so V8's queue drains first and promises win.

> **Interview tip:** "Is `fs.readFile` really asynchronous if the OS cannot do it asynchronously?" A strong short answer: "From JavaScript it is asynchronous. libuv runs the blocking call on a pool thread and hands the result back to the loop thread, so the main thread is never blocked. The work is not asynchronous in the OS; it is moved off the main thread." Add that `readFile` is a chain of small requests (open, fstat, reads, close), and that the callback runs on the main thread.

---

## 6. Follow one HTTP request

Same idea, now with a socket. Example `05-trace-http.js` starts a server on port 0 (the OS picks a free port), makes one `http.get` request to it, and records every resource Node creates (it skips `TickObject`, the bookkeeping for `process.nextTick`). The output:

```text
Part 1: resources created for one request, in order (layer, type, meaning)
   1. [JS    ] http.get() is called (the server is already listening)
   2. [libuv ] TCPWRAP              a TCP socket handle (a libuv uv_tcp_t sits inside)
   3. [libuv ] TCPCONNECTWRAP       a connect request (libuv uv_connect_t)
   4. [llhttp] HTTPCLIENTREQUEST    the HTTP parser of the client side (it will parse the response)
   5. [libuv ] TCPWRAP              a TCP socket handle (a libuv uv_tcp_t sits inside)
   6. [llhttp] HTTPINCOMINGMESSAGE  the HTTP parser of the server side (it parses the request)
   7. [JS    ] your handler runs: GET /hello
   8. [timer ] Timeout              a JS timer that the http code created during the exchange
   9. [libuv ] SHUTDOWNWRAP         a shutdown request (libuv uv_shutdown_t): "I will send no more data"
  10. [JS    ] client callback runs: status 200
  11. [libuv ] SHUTDOWNWRAP         a shutdown request (libuv uv_shutdown_t): "I will send no more data"
  12. [timer ] Timeout              a JS timer that the http code created during the exchange

Part 2: what sits under the socket
  req.socket is a Socket; its _handle is a TCP (a C++ object from the tcp_wrap binding)

Part 3: what llhttp handed to JavaScript (the request head was parsed in C)
  method GET, url /hello, httpVersion 1.1, header names: Host, Connection
  the parser read straight from the socket handle, with no JS 'data' event: true

Part 4: did the thread pool help?
  thread pool request types seen: none
  (sockets are waited on by the operating system: epoll, kqueue or IOCP, not by pool threads)
```

How to read the table:
- The names in the second column are the type names `async_hooks` uses (C++ class names in upper case).
- The labels in the first column and the descriptions were added by the example to explain each item.
- Which parser is which was inferred from the order, not read from the C++ source. Item 4 appears when the client makes its request, before the server has accepted anything. Item 6 appears after the server accepted the connection.
- The two `Timeout` items are timers created inside the http code. Their purpose was not traced.
- The order between client-side and server-side items is the order on this machine. The example printed the same sequence on every run tried, but do not depend on the interleaving.

The journey of the request, from the network card up:
1. **Listening:** `server.listen(0)` creates a JavaScript `net.Server` that owns a C++ `TCP` handle (a libuv `uv_tcp_t`). libuv registers it with the poller. This handle shows up as `TCPServerWrap`.
2. **Connect:** `http.get` creates a client socket (item 2) and a connect request (item 3).
3. **Accept:** the OS reports the new connection. libuv accepts it, Node creates a second `TCP` handle for the server side of the connection (item 5), wraps it in a `net.Socket` and emits `'connection'`. The HTTP server then creates a parser object around llhttp (item 6).
4. **Bytes arrive:** the OS tells the poller the socket is readable; libuv reads into a buffer. For a plain TCP socket, Node hands the socket handle directly to the C++ parser (`parser.consume(socket._handle)` in `lib/_http_server.js`), so the bytes go straight from libuv into llhttp without a JavaScript `'data'` event. llhttp splits the text into method, URL and headers and calls back into JavaScript when the head is complete. Part 3 of the example reads the flag that records this (`socket._handle._consumed`, an internal detail).
5. **Your handler:** the JS callback `parserOnIncoming` builds the `req` and `res` objects and emits `'request'`. That is when your handler runs (item 7).
6. **The response:** `res.end('hello')` builds the response head and body and writes to the socket. Node first tries a direct, synchronous write; if the system accepts all bytes, no write request is needed (none appears in this trace, where the body is 5 bytes). If the kernel buffer is full, libuv queues the data and a write request completes later. That queue is the root of stream backpressure (lesson 11).
7. **Closing:** each side sends a shutdown request ("I will send no more data"), items 9 and 11.

> **Common mistake:** tracing a server by adding `socket.on('data', ...)` to look at the raw bytes. The core code wraps `socket.on` so that a `'data'` or `'readable'` listener makes Node *unconsume* the socket: the parser stops reading the handle directly and the bytes take the ordinary JavaScript stream path instead. An earlier version of example 05 did exactly this, so it traced a slightly different path than a normal server uses. Observing can change what you observe.

Part 4 states the key insight: no pool request types appear. The whole exchange was handled by one thread asking the OS to tell it when sockets were ready.

> **Interview tip:** "How can Node handle 10,000 connections with one thread?" Because each connection is a non-blocking socket registered with epoll, kqueue or IOCP. The thread sleeps until the OS reports activity, runs a small callback, and sleeps again. The thread pool is not involved in socket I/O. The limit is CPU time in your callbacks and memory per connection, not the number of threads.

---

## 7. How `require()` works inside

`require('./x')` looks like magic, but it is about 40 lines of logic. Four steps:

1. **Resolve:** turn the text into one absolute file name.
2. **Cache check:** if that file was loaded before, return the saved `module.exports` and stop.
3. **Wrap and compile:** the file's text becomes the body of a function with five parameters: `exports, require, module, __filename, __dirname`. That is why top-level `const`s in a file are private to the file and why those five names exist in every CommonJS file.
4. **Run:** call the function with `this` set to `module.exports`. Whatever ends up in `module.exports` is the result.

**Resolve rules** (`require(request)` called from a file in directory `D`):
- Starts with `node:` or is a core module name: return the core module.
- Starts with `./`, `../` or `/`: build the path, then try the exact file, then `.js`, `.json`, `.node`; if it is a directory, read `package.json` `"main"`, then try `index.js`.
- Otherwise it is a package name: look in `D/node_modules`, then `D/../node_modules`, and so on up to the root.
- Not found: throw an error with `code: 'MODULE_NOT_FOUND'`.

(Real Node does more: the `exports` and `imports` fields of `package.json`, symbolic links, `NODE_PATH`, and an ESM path for `.mjs` files. The mini version below skips them.)

Example `06-mini-require.js` implements these four steps (about 70 lines including comments), runs a small project through it, and then runs the same project through the real `require` and compares. The core of it:

```js
function load(request, parentDir) {
  if (request.startsWith('node:') || Module.isBuiltin(request)) return require(request);
  const filename = resolve(request, parentDir);            // step 1
  if (cache.has(filename)) return cache.get(filename).exports;   // step 2

  const mod = { id: filename, filename, exports: {}, loaded: false };
  cache.set(filename, mod);        // cached BEFORE running: this is what makes cycles work
  try {
    compileAndRun(mod);            // steps 3 and 4
  } catch (err) {
    cache.delete(filename);        // a module that threw is not cached
    throw err;
  }
  mod.loaded = true;
  return mod.exports;
}

function compileAndRun(mod) {
  const source = fs.readFileSync(mod.filename, 'utf8');
  if (mod.filename.endsWith('.json')) { mod.exports = JSON.parse(source); return; }
  const fn = vm.compileFunction(source, ['exports', 'require', 'module', '__filename', '__dirname'], { filename: mod.filename });
  const dir = path.dirname(mod.filename);
  fn.call(mod.exports, mod.exports, (id) => load(id, dir), mod, mod.filename, dir);
}
```

`vm.compileFunction` is the public cousin of what Node does internally: it compiles source text as the body of a function and gives it a file name for error stack traces. Older Node versions built the wrapper as a string and compiled that; `require('node:module').wrap('BODY')` still shows the classic shape. Output:

```text
The classic wrapper that Node used to put around every file (Module.wrap):
(function (exports, require, module, __filename, __dirname) { BODY
});

Order in which the files ran (mini require):
  1. entry starts
  2. counter.js evaluated
  3. a starts
  4. b starts
  5. b ends
  6. a sees b.sawA=keys of a so far: early
  7. entry ends

What entry.js exported (mini require):
{
  sameInstance: true,
  counterCalls: [ 1, 2 ],
  circular: 'keys of a so far: early',
  aDone: true,
  json: { answer: 42 },
  directory: 'util/index.js',
  nodeModules: 'hello world',
  core: 'function',
  trap: '{}',
  thisIsExports: true
}

require of a missing file fails with code: MODULE_NOT_FOUND
Modules in the mini cache: 8 (keys are absolute file names)
Same trace as the real require : true
Same exports as the real require: true
```

What each line teaches:
- `counter.js evaluated` appears once and `sameInstance` is `true`: the second `require` of the same file came from the **cache**. A module runs once per process. The real cache is `require.cache` (the same object as `Module._cache`), keyed by absolute file name. Deleting a key makes the next `require` run the file again.
- **Circular imports:** `a` requires `b`, and `b` requires `a`. Because `a` was put in the cache *before* it ran, `b` gets `a`'s **partial** `module.exports` (only `early`, because `a` had not finished). No infinite loop, but `b` sees an unfinished module.
- **`trap: '{}'`:** `lib/exports-trap.js` did `exports = { lost: true }`. That only rebinds the local parameter `exports`. `require` returns `module.exports`, which is still the original empty object. Assign to `module.exports` (or add properties to `exports`).
- **`thisIsExports: true`:** at the top level of a CommonJS file, `this === module.exports`.
- **Directories and packages:** `./lib/util` resolved to `lib/util/index.js`, and `greeter` resolved through `node_modules/greeter/package.json` `"main"`.

In real Node (`lib/internal/modules/cjs/loader.js`) the same steps have these names. All of them can be seen on `require('node:module')` (checked on 24.16):

| Step | In the mini version | In real Node |
|---|---|---|
| Entry point | `load()` | `Module._load(request, parent, isMain)` |
| 1. Resolve | `resolve()` | `Module._resolveFilename`, which uses `Module._findPath` and `Module._nodeModulePaths` |
| 2. Cache | a `Map` | `Module._cache`, the same object as `require.cache` |
| 3. Wrap and compile | `vm.compileFunction` | `module._compile` (and `Module.wrap` for the classic wrapper text) |
| 4. Run, by file extension | an `if` for `.json` | `Module._extensions['.js']`, `['.json']`, `['.node']` |

A `.node` file is a compiled native addon: its handler loads it with `process.dlopen` (section 14).

> **Common mistake:** relying on a partial export from a cycle, or assigning `exports = ...`. Another classic: expecting `require` of a changed file to pick up the change. It will not; the cache returns the first result.

> **Interview tip:** "What is the difference between `exports` and `module.exports`?" A strong short answer: `exports` is only a local variable that starts out pointing at the same object as `module.exports`, and `require` returns `module.exports`. Adding properties to `exports` works. Assigning a new value to `exports` changes nothing, because only the local variable moved. If you need to export a function or class, assign to `module.exports`.

---

## 8. The ES module pipeline

ES modules (`import`/`export`) load in a different way. The big difference: `import` statements are **static**. Node can read them from the source text *before running anything*, so it can build the whole graph first. The pipeline has four phases:

| Phase | Question it answers | Output |
|---|---|---|
| **Resolve** | what exact URL does this specifier mean? | an absolute `file:///...` URL |
| **Load** | what is in that URL, and which format is it? | source text + format (`module`, `commonjs`, `json`, `wasm`, `builtin`) |
| **Link** | which `export` does each `import` point to? | V8 parses the source, then connects every imported name to the exporter's variable |
| **Evaluate** | now run the code | modules run once each, dependencies first |

Resolve, load and parse repeat recursively for every import, until the whole graph is known. Only then does linking finish and evaluation start. Errors like "does not provide an export named X" are **link** errors: they happen before a single line of your code ran.

Node lets you hook the resolve and load phases. Example `07-esm-pipeline.mjs` uses `module.registerHooks()` (synchronous hooks that run on the thread that loads the modules; added in Node 22.15 and 23.5, a release candidate in the 24.16 docs, no warning printed) to log every step for a graph of five tiny files:

```js
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    console.log(`  resolve  ${specifier} -> ${name(result.url)}`);
    return result;
  },
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    console.log(`  load     ${name(url)} (format: ${result.format})`);
    if (name(url) === 'c.mjs') {
      return { ...result, source: "console.log('  EVALUATE c.mjs (source replaced by the load hook)'); export const c = 'C-patched';" };
    }
    return result;
  },
});
```

The graph is `main.mjs` importing `b.mjs`, `c.mjs` and `counter.mjs`, and `b.mjs` importing `d.mjs`. Output of Part 1 (Part 2, about CommonJS files, is explained after the notes below):

```text
Importing main.mjs. Lines starting with "resolve" and "load" come from the hooks.
Phases 3 and 4 (link, evaluate) have no hooks; we see them through the EVALUATE lines.

  resolve  main.mjs -> main.mjs
  load     main.mjs (format: module)
  resolve  ./b.mjs -> b.mjs
  load     b.mjs (format: module)
  resolve  ./d.mjs -> d.mjs
  load     d.mjs (format: module)
  resolve  ./c.mjs -> c.mjs
  load     c.mjs (format: module)
  resolve  ./counter.mjs -> counter.mjs
  load     counter.mjs (format: module)
  EVALUATE d.mjs
  EVALUATE b.mjs
  EVALUATE c.mjs (source replaced by the load hook)
  EVALUATE counter.mjs
  EVALUATE main.mjs, b = B+D , c = C-patched
  counter n before inc(): 0
  counter n after inc(): 1 (an import is a live view, not a copy)
```

What to see:
- **All `resolve` and `load` lines come before the first `EVALUATE`.** The whole graph was discovered first. (The relative order of sibling files in the first part is an implementation detail; what is guaranteed is "everything is loaded, then everything runs".)
- **Evaluation order is dependencies first:** `d` before `b`, and `main` last. Each module runs once.
- **A `load` hook can change the source.** That is how transpilers, test mocks and instrumentation plug in. Here `c.mjs` ran with different code than the file on disk.
- **Live bindings:** `main.mjs` imported `n` and `inc` from `counter.mjs`. After `inc()` the importer sees `n` as 1. An ES import is a read-only *view* of the exporter's variable. CommonJS `const { n } = require(...)` copies the value at that moment.

More facts to keep ready:
- The older `module.register()` hooks ran in a separate thread and are deprecated in the 24.16 docs (since 24.15). Use `registerHooks()`.
- `import()` (dynamic import) runs the same pipeline at the moment you call it and returns a promise.
- **Top-level `await`** makes evaluation asynchronous. Because of that, `require()` of an ES module works (no flag on Node 24) only if the module graph has no top-level `await`; otherwise it throws `ERR_REQUIRE_ASYNC_MODULE`.
- ES modules are always strict, have `this === undefined` at the top, and have no `__dirname` (use `import.meta.dirname`).

### Importing CommonJS from an ES module
When an `import` points at a CommonJS file, the load phase reports the format `commonjs`. Node runs the file the way `require` would, then builds an ES module view of the result. `default` is always `module.exports`. The **named exports are guessed by reading the source text** (with a parser called cjs-module-lexer) without running it, so only simple patterns are found. Example 07, Part 2:

```text
Part 2: importing CommonJS files (named exports are found by reading the source text)
  exports.p = 1; module.exports.q = 2;   named: p, q   default keys: p, q
  module.exports = { a, b: 2 };          named: a      default keys: a, b
  a loop that fills module.exports       named: (none) default keys: x, y
```

How to read it: `exports.p = 1` is a pattern the lexer recognises. In the object literal only `a` was found; `b: 2` was not. Names created in a loop cannot be found at all. Asking for a name that was not found is a link-phase error, so it appears before any of your code runs:

```text
SyntaxError: Named export 'b' not found. The requested module './lit.cjs' is a CommonJS module, which may not support all module.exports as named exports.
```

The safe way is the default import: `import pkg from './x.cjs'; const { b } = pkg;`. (Node 24 also adds an export called `module.exports` to this view; the example hides it.)

> **Interview tip:** "CommonJS vs ESM, internally?" CommonJS is dynamic: `require` is a function call that runs at that moment, loads synchronously and returns a copy of `module.exports`. ESM is static: imports are found by parsing, the graph is built and linked before anything runs, bindings are live, and evaluation can be asynchronous. More in [Lesson 3: Modules](../03-modules/README.md).

---

## 9. `AsyncLocalStorage`, `AsyncResource` and `async_hooks`

**The problem.** A server handles many requests at once. You want every log line to carry the request id, without passing `requestId` through every function. A global variable does not work: two requests are in flight at the same time and `await`s interleave them.

**The tool: `AsyncLocalStorage` (ALS).** It stores a value that follows the *asynchronous flow* of your code, not the call stack. Think of it as "thread-local storage, but for async code".

```js
const als = new AsyncLocalStorage();
als.run({ requestId: 'req-A' }, async () => {
  await doWork();            // inside doWork and everything it awaits, als.getStore() is { requestId: 'req-A' }
});
```

`run(store, fn)` makes `store` current for `fn` and for everything `fn` starts: promises, `await`, timers, `fs` callbacks, streams. `als.getStore()` reads it anywhere in that flow.

### 9.1 Request ids across awaits, timers and callbacks
Example `08-async-local-storage.js`, part 1: three concurrent HTTP requests with different delays. The `log()` function finds the id on its own; the "deep" `serviceLayer` function never sees `req` or `res`:

```js
function log(msg) {
  lines.push({ id: als.getStore()?.requestId ?? '(none)', msg });
}

async function serviceLayer(delayMs) {
  log('service starts');
  await sleep(delayMs);
  log('after await sleep()');
  await new Promise((resolve) => setTimeout(resolve, 1));
  log('after a setTimeout callback');
  await fs.promises.readFile(__filename);
  log('after fs.promises.readFile');
  await new Promise((resolve) => fs.stat(__filename, resolve));
  log('after a callback style fs.stat');
}

const server = http.createServer((req, res) => {
  const requestId = req.headers['x-request-id'];
  als.run({ requestId }, async () => {
    log('handler starts');
    await serviceLayer(Number(req.headers['x-delay']));
    res.end('done');
  });
});
```

Output of part 1 (the groups for `req-B` and `req-C` are identical to `req-A`'s and are left out here; the real output shows all three):

```text
Part 1: log lines grouped by the id that log() found on its own
  req-A
    handler starts
    service starts
    after await sleep()
    after a setTimeout callback
    after fs.promises.readFile
    after a callback style fs.stat
  ...
  lines that lost their id: 0 of 18
```

Every line, in every style of asynchronous code (`await`, timer, promise API, callback API), kept its request id, even though the three requests ran interleaved.

### 9.2 Where the context is not what you expect
A callback runs with the context of the code that **calls** it, not of the code that **stored** it. So a home-made queue, an event emitter, or a connection pool that stores callbacks and runs them later, runs them in the context of whoever triggers the run. Part 2 of the example shows five ways:

```js
als.run({ requestId: 'req-A' }, () => {
  jobs.push(() => log('plain function, queued inside req-A'));
  jobs.push(AsyncResource.bind(() => log('AsyncResource.bind, queued inside req-A')));
  jobs.push(AsyncLocalStorage.bind(() => log('AsyncLocalStorage.bind, queued inside req-A')));
  const snapshot = AsyncLocalStorage.snapshot();
  jobs.push(() => snapshot(() => log('AsyncLocalStorage.snapshot, queued inside req-A')));
  bus.on('ping', () => log('EventEmitter listener, registered inside req-A'));
});
for (const job of jobs) job();                              // run later, outside every request
als.run({ requestId: 'req-B' }, () => bus.emit('ping'));    // emitted from req-B
```

```text
Part 2: which request id does each callback see when it runs later?
  [(none)] plain function, queued inside req-A
  [req-A] AsyncResource.bind, queued inside req-A
  [req-A] AsyncLocalStorage.bind, queued inside req-A
  [req-A] AsyncLocalStorage.snapshot, queued inside req-A
  [req-B] EventEmitter listener, registered inside req-A
```

- The plain function lost the context (`(none)`).
- `AsyncResource.bind(fn)`, `AsyncLocalStorage.bind(fn)` and `AsyncLocalStorage.snapshot()` capture the context at the moment you call them and restore it when the function runs. Use them in queues, pools and any code that stores a callback to run from somewhere else. (`AsyncLocalStorage.bind` and `snapshot` became stable in Node 22.15 and 23.11.)
- An `EventEmitter` listener runs in the context of the code that calls `emit()`. That is usually what you want, but it surprises people who expect the registration context.

### 9.3 What is `AsyncResource`?
An **async resource** is any object that stands for a pending piece of asynchronous work: a timer, a request, a socket, a promise. Node creates them for you. **`AsyncResource`** is the public class for *your own* kinds of async work, such as a job in a worker pool.

Why it exists: a pool runs your job later, on whatever thread or turn is free. Without help, the job would run in the context of the code that happens to start it, not the code that queued it. The fix is to capture the context when the job is queued and re-enter it when the job runs:

```js
const resource = new AsyncResource('MyJob');            // at queue time: remembers the current context
queue.push(() => resource.runInAsyncScope(runTheJob));  // at run time: runs inside that context
```

`AsyncResource.bind(fn)` is the shortcut for exactly this. The Node docs use a `Worker` pool as their example and say that database connection pools follow the same model.

### 9.4 `async_hooks`: the low-level API behind it
`async_hooks.createHook({ init, before, after, destroy })` lets you watch every async resource being created, entered and destroyed. Each resource has an id (`asyncId`) and the id of the resource that caused it (`triggerAsyncId`). This is what the examples in sections 5 and 6 used to peek at requests. The Node 24 docs mark `async_hooks` as experimental and tell you to migrate away from `createHook`, because it has usability problems and costs performance. Use `AsyncLocalStorage` for context; use `createHook` only for debugging and learning.

In Node 24 `AsyncLocalStorage` is built on **`AsyncContextFrame`** by default (since Node 24.0). It is lighter than the hook-based mechanism used before. The `async_context` docs do not describe the internals, but two things are visible. The real `process.nextTick` stores an `AsyncContextFrame.current()` entry with each queued callback (example 04, Part 5). And Node 24 still has the flag `--no-async-context-frame` (listed in `node --help`) that switches back to the older implementation.

Running example 08 with that flag on the author's machine made even the *plain* awaits in Part 3 about four to five times slower (roughly 240 ms instead of 50 ms). The reason is not documented. A likely cause is that the older implementation needs `async_hooks` tracking switched on for the whole process once an `AsyncLocalStorage` exists. Treat the flag as a diagnostic, not as something to ship. The effect of the default is visible in Part 3 of the example.

### 9.5 Performance notes
Part 3 measures 200,000 `await`s plainly, inside `als.run`, and with an empty `createHook` hook switched on (median of 5 runs; your numbers will differ):

```text
Part 3: cost of 200000 awaits (median of 5, your numbers will differ)
  plain awaits                    :   40 ms
  awaits inside als.run()         :   30 ms
  plain awaits, empty init hook on:  106 ms
  one als.run() call              : about 1.3 microseconds
```

Read this as: on Node 24 the `AsyncLocalStorage` overhead is within the noise for this loop (in five runs the "inside" line was sometimes a little faster and sometimes a little slower than the plain line), a single `run()` costs about a microsecond (0.7 to 1.5 in the author's runs, after a warm-up), and the old way of tracking async work with a hook made `await`-heavy code roughly 2.5 to 4 times slower in those runs. Measure with your own workload before you decide. Other things to know:
- The store stays alive as long as pending async work references it. Keep it small (an id, a user, a logger), not a big object graph.
- `enterWith()`, `exit()` and `disable()` are marked experimental in the docs. Prefer `run()`: it scopes the context to a function and cleans up by itself.
- If context is lost, look for code that runs your callback from somewhere else (a queue, a pool, a custom thenable, or native code). Wrap the callback with `AsyncResource.bind` or `AsyncLocalStorage.bind`.

Related tracing tools are in section 13.

> **Interview tip:** "How do you add a request id to every log line without passing it everywhere?" Use `AsyncLocalStorage`: call `als.run({ requestId }, next)` in a middleware, and have the logger read `als.getStore()`. Mention the limit: context follows promises, timers and I/O callbacks automatically, but is lost in code that stores and later runs callbacks, which you fix with `AsyncResource.bind`.

---

## 10. `node:vm`: separate globals, not a sandbox

The `vm` module compiles and runs JavaScript text in a **context** (section 2.4). It exposes the same V8 features (compiling scripts, separate contexts) that Node uses internally, for example for the REPL.

Example `09-vm-not-a-sandbox.js`:

```js
const sandbox = { price: 10, quantity: 3 };
vm.createContext(sandbox);   // the object becomes the global object of a new context
vm.runInContext('total = price * quantity; var note = "set inside"', sandbox);

const script = new vm.Script('count = (typeof count === "number" ? count : 0) + 1');
const counterContext = vm.createContext({});
script.runInContext(counterContext);                  // compile once, run many times
vm.runInNewContext('while (true) {}', {}, { timeout: 50 });   // stopped after 50 ms
```

Output:

```text
Part 1: a new context
  values written by the script appear on the sandbox object: 30 | set inside
  inside the context, typeof process / require / console / setTimeout / URL:
    undefined / undefined / object / undefined / undefined
  console.log inside the context printed nothing: that console is V8's own, not Node's
  but the JavaScript language itself is there (JSON, Math, Array, Promise):
    object / object / function / function

Part 2: objects from another context
  foreignArray instanceof Array : false (different Array constructor)
  Array.isArray(foreignArray)   : true (works across contexts)
  foreignError instanceof Error : false

Part 3: vm.Script and timeout
  one compiled script run 3 times in one context, count = 3
  an endless loop was stopped by timeout: ERR_SCRIPT_EXECUTION_TIMEOUT

Part 4: escaping (we only read process.version, nothing harmful)
  untrusted code reached the host process object: true
  it can read host data, for example process.version = v24.16.0
  same trick through a function we handed in    : true

Conclusion: vm separates globals. It does not separate memory, CPU, or access to host objects.
```

What it shows:
- A new context has the **language** (`JSON`, `Math`, `Array`, `Promise`) but none of Node's world: no `process`, `require`, `setTimeout`, `URL`. Its `console` is V8's own, which does not print to your terminal.
- **Cross-context gotchas:** each context has its own `Array`, `Error`, `Object`. `instanceof Array` is false for an array from another context; use `Array.isArray`. This breaks libraries that check `instanceof Error` on errors thrown in a context.
- **`timeout`** stops *synchronous* endless loops (the docs say it starts new event loops and threads, which has a non-zero cost). It does not stop asynchronous work.

**Why it is not a security sandbox.** The Node docs say it plainly: `vm` is not a security mechanism and must not be used to run untrusted code. Part 4 shows why in three lines:

```js
vm.runInNewContext('this.constructor.constructor("return process")()', {});
```

Inside the context, `this` is the context's global object, which is backed by the sandbox object that the **host** created (`{}` here). Reading `constructor` through it finds the host's `Object`, and the `constructor` of that is the host's `Function`. A host `Function` builds code in the **host** realm, where `process` exists. Passing any host function in (even `console.log`) gives the same exit. You cannot fix this by deleting a few properties; there are many such paths. Also, a context shares the **same heap and thread**: a script can allocate until the whole process runs out of memory, or block the loop (`timeout` helps only with the second).

What to use when you must run code you do not trust:
- For *stopping runaway code* (not for security): run it in a `Worker` with `resourceLimits` and call `worker.terminate()` on a timeout. You will build exactly that in Try it yourself, task 3. This is a separate isolate, but still the same process.
- For *security*: a separate process under operating-system isolation (containers, VMs, a locked-down user), or a purpose-built isolate library. Node's own `--permission` flag is described in its docs as a "seat belt" approach, not as protection against malicious code.

> **Interview tip:** "Is `vm.runInNewContext` safe for user-supplied code?" No. It gives a different global object, not a security boundary: host objects leak the host's `Function` constructor, and the code shares your heap and thread. A good answer also names alternatives (Worker with limits for resource control; process and OS isolation for security).

---

## 11. The `v8` module, isolates, snapshots and Workers

The `v8` module is a window into the engine. Example `10-v8-module.js` has four parts.

**Part 1: heap numbers.** `v8.getHeapStatistics()` returns 14 numbers, among them `total_heap_size`, `used_heap_size`, `heap_size_limit`, `number_of_native_contexts` and `number_of_detached_contexts` (contexts that were dropped but not yet collected; a growing value points to a leak). `heap_size_limit` depends on the machine and flags: on a 15 GiB Windows machine with no flags it was about 4.2 GiB, and with `--max-old-space-size=512` it reports more than 512 MiB because it also counts the young generation. Do not hard-code it. `v8.getHeapSpaceStatistics()` lists the spaces (new, old, code, large object, read-only...).

**Part 2: `v8.serialize` / `v8.deserialize`.** They are built on V8's value serializer, the machinery behind the structured clone algorithm that `structuredClone` and `postMessage` also use. They keep what JSON loses:

```js
const loop = { name: 'loop' };
loop.self = loop;
const original = { map: new Map([['a', 1]]), set: new Set([1, 2]), date: new Date(0), big: 10n, bytes: new Uint8Array([1, 2, 3]), loop };
const copy = v8.deserialize(v8.serialize(original));
```

**Part 3: isolate versus context, with numbers.** Three `vm.createContext` calls added three native contexts to the *same* isolate. A Worker started with `resourceLimits: { maxOldGenerationSizeMb: 64 }` sees none of the main thread's globals and has its own, smaller heap limit: it is a different isolate.

**Part 4: a startup snapshot.** The example writes a tiny script, builds a snapshot with `node --snapshot-blob app.blob --build-snapshot entry.js`, and runs it with `node --snapshot-blob app.blob`. The build runs the script's top-level code *once*; the run restores the heap and calls only the function registered with `v8.startupSnapshot.setDeserializeMainFunction()`.

Output:

```text
Part 1: v8.getHeapStatistics()
  fields returned                     : 14
  used_heap_size <= total_heap_size   : true
  total_heap_size < heap_size_limit   : true
  500000 small objects grew the heap by more than 20 MiB: true (kept alive: 500000)
  heap spaces: read_only_space, new_space, old_space, code_space, new_large_object_space, large_object_space, code_large_object_space

Part 2: v8.serialize / v8.deserialize
  Map, Set, Date, BigInt, typed array survive: true true true bigint true
  a circular reference survives              : true
  JSON of a Map and a Date                   : {"map":{},"date":"1970-01-01T00:00:00.000Z"}
  a function cannot be serialized            : run() {} could not be cloned.
  a class instance comes back as             : Object

Part 3: isolates and contexts
  3 x vm.createContext() added 3 native contexts to THIS isolate (kept: 3)
  a Worker has its own isolate:
    typeof the main thread global, inside the worker: undefined
    worker heap limit smaller than main heap limit: true

Part 4: a user-land startup snapshot (two child processes)
  1. build: node --snapshot-blob app.blob --build-snapshot entry.js  (blob over 1 MiB: true)
  2. run  : node --snapshot-blob app.blob
    restored table: 0,1,4,9,16
    started later than the build: true
```

Notes:
- A class instance comes back as a plain `Object`: only data is serialized, not prototypes or functions. `structuredClone` behaves the same way.
- The snapshot blob is several MiB because it stores a whole heap. A deserialized application cannot be snapshotted again (docs), and the snapshot API is stable since Node 24.0.
- **`v8.setFlagsFromString(flags)`: be careful.** It sets V8 flags after the engine has started. The docs warn that this may behave unpredictably, including crashes and data loss, or simply do nothing. Pass real flags on the command line or in `NODE_OPTIONS` where they are allowed. Example 02 used it only to switch on a debugging syntax for exploring.

### Worker threads and isolates
A `Worker` ([Lesson 18](../18-worker-threads-and-cluster/README.md)) creates a new thread with a **new isolate**, its own event loop and its own copy of Node's built-in modules. The worker_threads docs say that a Worker is an independent JavaScript execution thread with its own JS engine instance and resource limits. Two more claims were checked by running code:
- A timer inside a Worker fired on time while the main thread was busy for 600 ms (separate loop, separate thread).
- A property added to `require('node:fs')` in the main thread was not visible from `require('node:fs')` inside a Worker (separate copy of the modules).

That explains what Part 3 showed and the usual rules. Workers do not share JavaScript objects: you copy data with `postMessage`, or share raw memory with `SharedArrayBuffer`. They start slower than a function call. A crash or out-of-memory in one Worker can be contained instead of killing the whole process.

| | Isolate | Context | Worker | Process (child or cluster) |
|---|---|---|---|---|
| Own heap and GC | yes | no (shares the isolate's) | yes (it has its own isolate) | yes |
| Own thread | one thread at a time | shares the thread | yes | yes |
| Separate globals | - | yes | yes | yes |
| Strong isolation from bugs and attacks | no | no | partly (memory), no (OS rights) | yes (OS level) |

> **Interview tip:** "What would you watch from `v8.getHeapStatistics()` in production?" A strong short answer: `used_heap_size` against `heap_size_limit` (how close you are to an out-of-memory crash), and `number_of_detached_contexts` (a value that keeps growing points to a leak). Compare with `process.memoryUsage()`, which also shows memory outside the V8 heap, such as Buffers (`external`, `arrayBuffers`). To find the leak itself, use heap snapshots ([Lesson 19](../19-performance-and-memory/README.md)).

---

## 12. WebAssembly in Node

**WebAssembly (wasm)** is a compact binary format for programs that run inside the engine, with near-native speed, in a sandboxed linear memory (one block of bytes that the module owns). You usually produce it from C, C++, Rust or Go with a compiler, and run it from JavaScript. V8 compiles it with a fast baseline compiler called Liftoff and can tier up hot functions to an optimizing compiler, like the JS tiers in section 2. `node --v8-options` lists `--liftoff` ("the baseline compiler for WebAssembly") and `--wasm-tier-up` ("enable tier up to the optimizing compiler"), both on by default. Those flags were read, but a tier-up was not observed.

You do not need a compiler to see how it works. Example `11-wasm-add.js` assembles the bytes of this module by hand:

```text
(module
  (func (export "add") (param i32 i32) (result i32)
    local.get 0
    local.get 1
    i32.add))
```

A `.wasm` file is an 8-byte header followed by **sections**, each with an id, a length and content. Here is the byte array, section by section (shortened; the file has a comment on every line):

```js
const addBytes = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic "\0asm" + version 1
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, // types: (i32, i32) -> i32
  0x03, 0x02, 0x01, 0x00, // functions: one function, type 0
  0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, // exports: "add" = function 0
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b, // code: local.get 0, local.get 1, i32.add, end
]);
const { add } = new WebAssembly.Instance(new WebAssembly.Module(addBytes)).exports;
```

The three steps are the vocabulary to know: **validate** (is it a legal module?), **compile** (`WebAssembly.Module`), **instantiate** (`WebAssembly.Instance`: create memory, link imports). The async forms `WebAssembly.compile` and `WebAssembly.instantiate` compile in the background and are the right choice for real, large modules. The second module in the example does the reverse: wasm *imports* a JavaScript function (`env.log`) and calls it. Output:

```text
Module 1: add
  WebAssembly.validate(bytes): true
  exports: [{"name":"add","kind":"function"}]  imports: []
  add(2, 3)              = 5
  add(2147483647, 1)     = -2147483648 (i32 wraps around, there is no overflow error)
  add(2.9, 3.9)          = 5 (JS numbers are converted to i32 first)

Module 2: calls back into JavaScript
  JavaScript received from wasm: [ 42 ]
  missing import -> TypeError: WebAssembly.instantiate(): Import #0 "env": module is not an object or function

WebAssembly.validate(three random bytes): false
```

Notes for the interview:
- In basic wasm the values that cross the boundary are numbers (`i32`, `i64`, `f32`, `f64`). Strings and objects are passed by writing bytes into the module's memory. Toolchains generate this glue for you.
- Crossing the JS/wasm boundary costs something, so a tiny function like `add` is *not* a reason to use wasm. It pays off when a lot of work stays inside wasm (image or video codecs, parsers, crypto, ports of existing C/C++/Rust libraries).
- **WASI** (the WebAssembly System Interface) lets wasm programs ask for files, clocks and arguments through a standard set of functions. Node has `node:wasi`, which on 24.16 is experimental (stability 1) and prints an `ExperimentalWarning` when you create a `WASI` object (merely requiring the module printed nothing). The docs say it does not provide the strong file system isolation that some other WASI runtimes give, and that you should not rely on it for untrusted code. Under the permission model there is a `--allow-wasi` flag.
- Wasm is memory-safe inside its own linear memory, and portable, which makes it an alternative to a native addon (section 14) when you need compiled speed without compiling per platform.

> **Interview tip:** "When would you use WebAssembly in Node?" A strong short answer: for CPU-heavy work that already exists as C, C++ or Rust code (codecs, parsers, crypto, image processing), when most of the work stays inside wasm so the cost of crossing between JavaScript and wasm stays small. Not for tiny functions like `add`. Compare the alternatives: a native addon (direct system access, but it must be built for each platform) and a Worker (plain JavaScript on another thread).

---

## 13. `diagnostics_channel` and `perf_hooks` at a glance

Two built-in ways to observe a running program with little cost and no monkey-patching (replacing library functions with your own wrappers).

**`diagnostics_channel`** is a publish/subscribe bus by name. Libraries publish events on named channels; monitoring tools subscribe. If nobody subscribes, publishing is almost free, and `channel.hasSubscribers` lets you skip building the message. Handlers run **synchronously** inside `publish()`. The module is stable; `tracingChannel` and the list of channels that Node itself publishes are marked experimental in the 24.16 docs. Built-in channels include `http.client.request.start`, `http.server.request.start` and `net.server.socket` (this is how APM tools, which are application performance monitoring products, can watch HTTP without patching it).

**`perf_hooks`** gives you timers and observers: `performance.mark/measure`, `performance.timerify(fn)` (every call becomes an entry), `PerformanceObserver` (which can also report garbage collections with entry type `'gc'`), `monitorEventLoopDelay()` (records how late the loop ran, in nanoseconds, as a histogram: counts per delay size, so you can read the median, the 99th percentile and the maximum) and `performance.eventLoopUtilization()`.

Example `12-diagnostics-and-perf-hooks.js` (run it with `--expose-gc` as its header says, so that it can force a collection):

```js
const channel = diagnosticsChannel.channel('app:db:query');
diagnosticsChannel.subscribe('app:db:query', (message) => console.log('subscriber got:', JSON.stringify(message)));
if (channel.hasSubscribers) channel.publish({ sql: 'SELECT 1', ms: 3 });

diagnosticsChannel.subscribe('http.server.request.start', ({ request }) => seen.push(`... ${request.method} ${request.url}`));
```

```text
Part 1: your own channel
  subscribers before subscribe(): false
  subscribers after subscribe() : true
  publishing... (handlers run synchronously, inside publish())
    subscriber got: {"sql":"SELECT 1","ms":3}
  publish() returned

Part 2: built-in channels, one request, no changes to the http code
  http.client.request.start  GET /ping
  net.server.socket          a Socket was accepted
  http.server.request.start  GET /ping

Part 3: perf_hooks
  measure "my-work": entryType=measure, duration>0: true
  entry types seen by the observer: function, gc, measure
  a 'gc' entry of kind MAJOR was reported: true
  monitorEventLoopDelay: the 100 ms block shows as a max delay of at least 80 ms: true
  eventLoopUtilization() fields: idle, active, utilization
```

The loop-delay histogram is the best single health number for a Node server: if the maximum or the 99th percentile grows, something is blocking the loop (compare the blocking demos in lesson 8). The `gc` entry type tells you how often and how long collections run without any flags.

> **Interview tip:** "How would you find out in production that the event loop is blocked?" A strong short answer: record `monitorEventLoopDelay()` and watch the 99th percentile and the maximum, and watch `eventLoopUtilization()` for the busy share. Alert on loop delay, not only on CPU. Then take a CPU profile to find the slow callback ([Lesson 19](../19-performance-and-memory/README.md)).

---

## 14. Native addons, Node-API and ABI stability

A **native addon** is a compiled library (a `.node` file, which is a shared library: a DLL on Windows, `.so` on Linux, `.dylib` on macOS) that you load with `require()`. Node's `.node` handler loads it with `process.dlopen`. Its code runs inside your process with full privileges, and a crash in it (a segmentation fault) takes down the whole process; `try/catch` cannot save you.

**When to use one:** to call an existing C, C++ or Rust library (image processing, databases, hardware, OS APIs that Node does not expose), or for a CPU-heavy hot loop. **When not to:** if pure JavaScript, a Worker, or WebAssembly is fast enough. Native code is harder to build, ship and debug.

### Why ABI stability matters
Node has had two ways to write addons.
- **Directly against V8 and Node's C++ headers** (including the old `nan` helper library). The compiled binary is tied to the engine version. Node records this as `process.versions.modules` (the "NODE_MODULE_VERSION"; `137` on Node 24.16 as printed in section 1). An addon built for one number refuses to load on another. Every new Node major means a rebuild, and every user needs a compiler or a prebuilt binary per Node version.
- **Node-API** (formerly N-API). A C API that is independent of the JavaScript engine and is guaranteed to stay **ABI stable**: a binary compiled once keeps working on later Node versions without recompilation (that is the promise in the Node docs). `process.versions.napi` is `10` on Node 24.16, and an addon states which Node-API version it needs.

**`node-addon-api`** is the official header-only C++ wrapper over Node-API. The usual build tool is **`node-gyp`** (it ships with npm, needs Python and a C/C++ toolchain; CMake.js is an alternative). Because compilers are a burden for users, popular packages publish **prebuilt binaries** (tools such as `prebuildify`, `prebuild` and `node-pre-gyp` exist for this) so `npm install` only downloads a file. Rust has a Node-API toolkit called `napi-rs`.

Here is the smallest useful addon, written in plain C against Node-API: `examples/_native/addon.c`. It exports one function, `add(a, b)`. (The folder name starts with `_`, so the example checker does not run it; building it needs a C compiler.)

```c
#include <node_api.h>

static napi_value Add(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);  // read the arguments
  double a = 0, b = 0;
  napi_get_value_double(env, args[0], &a);                // JS number -> C double
  napi_get_value_double(env, args[1], &b);
  napi_value result;
  napi_create_double(env, a + b, &result);                // C double -> JS number
  return result;
}

NAPI_MODULE_INIT() {                                      // runs once, when the addon is loaded
  napi_value fn;
  napi_create_function(env, "add", NAPI_AUTO_LENGTH, Add, NULL, &fn);
  napi_set_named_property(env, exports, "add", fn);
  return exports;
}
```

Every Node-API call takes the `env` handle and returns a status code (ignored here to keep the code short; real addons check it). Values cross the boundary one by one, through calls such as `napi_get_value_double`. This is the "binding" layer from section 1, written by hand.

**Building it.** The usual route is `node-gyp`, with the `binding.gyp` file that sits next to the C file. This route was not run here: on Windows it needs the Microsoft C++ build tools.

```bash
cd lessons/23-node-internals/examples/_native
npx node-gyp rebuild
node try-addon.js
```

What was run for this lesson: the C file compiled with MSYS2 gcc on Windows, using the Node 24.16.0 header files and `node.lib` that node-gyp had already downloaded into its cache, and then loaded with `try-addon.js`. In the command below, `<node-headers>` stands for node-gyp's header folder for your Node version (here `~/AppData/Local/node-gyp/Cache/24.16.0`). Other systems need other compiler flags, which is exactly the problem `node-gyp` solves. Put the resulting `addon.node` next to `try-addon.js`:

```bash
gcc -shared -O2 -DNAPI_VERSION=8 -I <node-headers>/include/node -o addon.node addon.c <node-headers>/x64/node.lib
node lessons/23-node-internals/examples/_native/try-addon.js
```

```text
loaded         : addon.node
exports        : [ 'add' ]
add(2, 3)      : 5
this Node runs Node-API version 10 and NODE_MODULE_VERSION 137
```

The addon was built with `NAPI_VERSION=8` ("I need at most Node-API 8") and it loaded on a Node that supports Node-API 10. That is the ABI promise in small. Only one Node version was available for testing, so the same binary was not tried on another Node major.

Most projects write C++ with **`node-addon-api`**, a header-only wrapper around the same C API. The same function looks like this (illustrative, not compiled here; it needs `npm install node-addon-api` and a `binding.gyp` that adds the package's include path):

```cpp
// Needs: npm install node-addon-api
#include <napi.h>

Napi::Number Add(const Napi::CallbackInfo& info) {
  double a = info[0].As<Napi::Number>().DoubleValue();
  double b = info[1].As<Napi::Number>().DoubleValue();
  return Napi::Number::New(info.Env(), a + b);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("add", Napi::Function::New(env, Add));
  return exports;
}

NODE_API_MODULE(addon, Init)
```

Under the permission model (`--permission`), loading an addon needs the `--allow-addons` flag.

> **Interview tip:** "What is N-API and why use it?" It is a stable C API (ABI) for native addons, independent of V8. An addon compiled once runs on later Node majors, so you do not rebuild for every release. Without it, an addon is bound to `process.versions.modules` and must be rebuilt per Node major.

---

## 15. How Node differs from Deno and Bun

Three honest points, no hype. They describe these projects in general terms and were not tested here, so check each project's current documentation before you decide.

- **Engines and system layer.** Node and Deno run JavaScript on V8. Bun uses JavaScriptCore, the engine of WebKit and Safari. Below the engine, Node's I/O layer is libuv (C). Deno's runtime is written in Rust and Bun's mostly in Zig. (This comes from the projects' public descriptions and was not tested here; projects rewrite parts of themselves, so check.) Different engines have different performance profiles per workload, so a benchmark that wins for one program can lose for another. Measure your own workload, and be wary of headline numbers.
- **Security defaults.** Deno denies access to files, network and environment unless you grant it. Node allows everything by default and offers an opt-in permission model (`--permission`), which its docs call a "seat belt" and not a defence against malicious code. Bun is open by default as well, according to its public documentation (not tested here).
- **Ecosystem and built-in tooling.** Node's strengths are its huge npm ecosystem, long-term support lines, and a very large body of production experience. Deno and Bun ship more tools in one binary (TypeScript, a bundler, a test runner, a package manager) and aim for compatibility with Node and npm, but not complete compatibility. Node has been closing the tooling gap itself: built-in test runner, `--watch`, `--env-file`, type stripping, `node:sqlite` (see [Lesson 22](../22-modern-node-features/README.md)).

> **Interview tip:** "Why would you still choose Node over Deno or Bun?" Give reasons you can defend: the size of the npm ecosystem, LTS release lines, your team's operational experience, and tooling that already works in your deployment. Add that you would benchmark your own workload before switching, because headline benchmark numbers rarely match real applications.

---

## 16. Deep-dive interview questions, answered

**1. Is Node.js single-threaded?**
The JavaScript of one isolate runs on one thread, on top of an event loop. The process also has V8 helper threads (compiling, GC), the libuv thread pool (4 threads by default, for `fs`, `dns.lookup`, `crypto.pbkdf2`/`scrypt`, `zlib`) and any Workers you start. A strong answer says "a single-threaded event loop for JavaScript, with threads working behind it".

**2. What are the roles of V8, libuv and Node itself?**
V8 compiles and runs JavaScript and manages its memory. libuv provides the event loop, timers, sockets, files and the thread pool across operating systems. Node adds the C++ bindings and the JavaScript core library (`fs`, `http`, `stream`...), the module loaders and `process`. Other C libraries (OpenSSL, zlib, llhttp, c-ares, ICU, nghttp2) do specialised work.

**3. How does Node do asynchronous file I/O when the OS cannot poll regular files?**
It does not make the OS do it asynchronously. libuv runs the blocking system call on a thread pool thread and wakes the loop thread when it finishes. `fs.readFile` is even a chain of such requests (`open`, `fstat`, several `read`s, `close`). Sockets are different: they are non-blocking and waited on by epoll, kqueue or IOCP.

**4. What happens when you run `node app.js`?**
Platform and V8 initialisation, restore the isolate from the built-in startup snapshot, pre-execution, choose CommonJS or ESM for the entry file, run it synchronously, drain `nextTick` and microtasks, spin the event loop while any ref'd handle or request is active, emit `beforeExit` (which may add more work), then emit `exit` and tear down.

**5. How does `require()` work, and why does a circular import see a partial object?**
Resolve to an absolute file, check `require.cache`, otherwise create a module object, put it in the cache *first*, compile the file as the body of a function with `(exports, require, module, __filename, __dirname)` and run it. Because the cache entry exists before the file finishes, a cycle gets the unfinished `module.exports`.

**6. How is ESM loading different?**
Static imports are found by parsing, so Node resolves and loads the whole graph, links imports to exporters' bindings (live views), and only then evaluates, dependencies first, possibly asynchronously because of top-level `await`. `require(esm)` works on Node 24 unless the graph uses top-level `await`.

**7. What are hidden classes and inline caches? What does "monomorphic" mean?**
V8 gives objects a shape based on their property names and order. An inline cache at each property access remembers the shapes seen. One shape is monomorphic (fastest), up to about four is polymorphic, more is megamorphic (slower generic lookup). Keep object creation consistent in hot code, and avoid `delete`.

**8. What is deoptimization?**
V8's optimizing compilers (Maglev, TurboFan) assume what type feedback shows, such as "only small integers". Guards in the machine code check the assumption. When one fails, V8 discards the optimized code and returns to the interpreter. Consistent types in hot functions avoid repeated deopts.

**9. Isolate vs context vs Worker?**
An isolate is a separate V8 instance with its own heap. A context is a separate global environment inside one isolate (sharing the heap). A Worker is a new thread with its own isolate and event loop. `vm` gives you contexts; `worker_threads` gives you isolates.

**10. Why is `vm` not a sandbox?**
It separates global objects only. Host objects expose the host's `Function` constructor (`this.constructor.constructor`), the code shares your heap and thread, and `timeout` only covers synchronous loops. Use a Worker with resource limits for runaway code and OS-level isolation for real security.

**11. How does `AsyncLocalStorage` work, and when does it lose context?**
`run(store, fn)` makes the store current for the async flow started by `fn`; on Node 24 the context is carried by `AsyncContextFrame`. It follows promises, timers and I/O callbacks. A callback stored and later run by other code runs in the caller's context, so queues and pools must capture it with `AsyncResource.bind`, `AsyncLocalStorage.bind` or `AsyncLocalStorage.snapshot()`.

**12. What is Node-API and why does ABI stability matter?**
A stable C ABI for native addons independent of V8. One binary keeps working across Node majors. Without it the addon is tied to `process.versions.modules` and must be rebuilt per Node major, which also forces users to have compilers or prebuilt binaries for each version.

**13. When would you use WebAssembly in Node?**
For CPU-heavy work that already exists as C, C++, Rust or Go code, or must be portable and memory-safe, when most of the work stays inside wasm so the cost of crossing the JS/wasm boundary is small. Not for tiny functions.

**14. A Node process will not exit. How do you find out why?**
Call `process.getActiveResourcesInfo()`. It lists the handle and request types that keep the loop alive (`Timeout`, `TCPServerWrap`, `TCPSocketWrap`, `FSReqCallback`...). Then close them, or `unref()` handles that must not keep the process alive.

**15. Why is Node good at I/O-heavy work but weak at CPU-heavy work?**
Waiting for I/O costs nothing: the OS wakes the loop when data is ready, so one thread serves thousands of sockets. But while one callback runs, nothing else on the loop runs, so a long computation in JavaScript delays every other request. Move such work to a Worker (a separate isolate), to a child process or to a native addon, or cut it into chunks. Measure the damage with `monitorEventLoopDelay()`.

**16. Does `async`/`await` create threads?**
No. `await` pauses the async function and registers a promise reaction. When the promise settles, V8 runs the rest of the function as a microtask on the same thread. Threads come only from the libuv pool (for the APIs that use it), V8's helper threads and Workers. Writing `async` does not make code run in parallel.

**17. Who runs `process.nextTick` callbacks, and who runs promise callbacks?**
Node owns the nextTick queue (plain JavaScript); V8 owns the promise microtask queue. After each callback Node runs all ticks, then asks V8 to run its microtasks, and repeats until both are empty (section 5.4). In an ES module main file the whole module runs inside a promise job, so promises run first.

**18. What does the event loop do when nothing is ready?**
It sleeps in the poll step (a blocking wait on epoll, kqueue or IOCP) for at most the time until the next timer, using no CPU. A socket event, a result from the thread pool or a due timer wakes it. If no ref'd handle or request is active, the process exits instead of sleeping.

---

## Summary / Key takeaways
- Node is layers: your JS, Node's core JS, C++ bindings, then V8 (runs JS), libuv (event loop, thread pool, I/O) and bundled C libraries, on top of the OS.
- V8 starts in the Ignition interpreter and moves hot functions up through Sparkplug, Maglev and TurboFan, using type feedback. A failed assumption causes deoptimization. Consistent object shapes keep inline caches fast.
- An isolate is a separate V8 engine with its own heap (the main thread, each Worker); a context is a separate global environment inside an isolate.
- libuv waits for sockets with epoll, kqueue or IOCP in the loop thread, and runs file system, `dns.lookup`, `crypto.pbkdf2`/`scrypt` and zlib work on a 4-thread pool.
- The event loop is a `while` loop: due timers, then the I/O poll (where an idle loop sleeps), then `setImmediate` callbacks, then close callbacks. A slow callback delays everything else.
- A process lives while it has active ref'd handles or requests (see them with `process.getActiveResourcesInfo()`); then `beforeExit` (may add work) and `exit` (synchronous only).
- `require` is resolve, cache, wrap, run, and the cache entry is created before the file runs. ESM is resolve, load, link, evaluate, with live bindings.
- `AsyncLocalStorage` carries request context through `await`s, timers and callbacks; stored callbacks need `AsyncResource.bind`. `vm` is not a sandbox. Node-API gives native addons a stable ABI.

---

## Quick check

1. When you call `fs.readFile`, which layers does the call pass through, and which of them is V8?
<details><summary>Answer</summary>

Your code, then Node's core JavaScript (`lib/fs.js`), then the C++ binding (it creates a request object), then libuv (queues the job on the thread pool), then the operating system. V8 runs the JavaScript parts only (your code, the core JS, and your callback at the end). Timers, files, sockets and `require` are not V8 features; they come from Node and libuv.

</details>

2. Name the four execution tiers in V8 and say what "deoptimization" means.
<details><summary>Answer</summary>

Ignition (bytecode interpreter), Sparkplug (baseline machine code), Maglev (mid-tier optimizing compiler) and TurboFan (top-tier optimizing compiler). Deoptimization means V8 throws away optimized code because an assumption made from type feedback (for example "this is always a small integer") failed, and continues in the interpreter. Example `02-jit-and-shapes.js` shows it with a function that suddenly gets strings.

</details>

3. Why can `{ x: 1, y: 2 }` and `{ y: 2, x: 1 }` be a performance problem when both flow through the same hot function?
<details><summary>Answer</summary>

They have different hidden classes (shapes) because the properties were added in a different order. The inline cache at `obj.x` then sees two shapes (polymorphic). With many shapes it becomes megamorphic and V8 uses a slower generic lookup. In the example, 8 shapes were several times slower than 1 shape for a hot property read.

</details>

4. Which of these use the libuv thread pool: `fs.readFile`, `net.connect('127.0.0.1', port)`, `dns.lookup`, `dns.resolve4`, `zlib.gzip`?
<details><summary>Answer</summary>

`fs.readFile`, `dns.lookup` (it calls `getaddrinfo`) and `zlib.gzip` use the pool (4 threads by default, `UV_THREADPOOL_SIZE` changes it). `net.connect` to an IP address uses a non-blocking socket waited on by epoll, kqueue or IOCP, and `dns.resolve4` sends its own network query through c-ares without the pool.

</details>

5. A script ends with a pending promise and an `unref()`'d interval. Does the process exit, how can you check what keeps a process alive, and what does the loop do while it waits for work that is not ready yet?
<details><summary>Answer</summary>

It exits (code 0): a pending promise is not a resource, and an `unref()`'d handle does not count. Call `process.getActiveResourcesInfo()` to list the handle and request types that currently keep the loop alive. `process.on('beforeExit')` fires when the loop empties and may schedule more work; `exit` fires after that and only allows synchronous code. While the loop waits, it sleeps in the poll step (epoll, kqueue or IOCP) and uses no CPU, until a socket event, a thread pool result or the next timer wakes it.

</details>

6. What are the four steps of `require()`, and why does a circular import see a partial `module.exports`?
<details><summary>Answer</summary>

Resolve the request to an absolute file name, check the cache, wrap and compile the file as the body of a function with `(exports, require, module, __filename, __dirname)`, then run it. The module object is put in the cache before the file runs, so when `b` requires `a` again during `a`'s own run, it gets the cached, unfinished `module.exports` of `a`.

</details>

7. In an ES module graph, when do the imported files run compared with when they are resolved and loaded?
<details><summary>Answer</summary>

Resolving, loading and parsing happen for the whole graph first, then linking, and only then do any modules run, dependencies first. That is why "does not provide an export named X" errors appear before any of your code runs, and why imports are live bindings to the exporter's variables.

</details>

8. Why does a callback stored in a custom queue log the wrong request id (or none), and how do you fix it?
<details><summary>Answer</summary>

A callback runs in the context of the code that calls it, not the code that stored it. When a queue runs the callback from outside a request, `als.getStore()` is `undefined` (or another request's store). Capture the context when queuing with `AsyncResource.bind(fn)`, `AsyncLocalStorage.bind(fn)` or `AsyncLocalStorage.snapshot()`.

</details>

9. Give two concrete reasons why `vm.runInNewContext` cannot safely run untrusted code, and one tool for stopping runaway code.
<details><summary>Answer</summary>

(1) Host objects in the context (even the default sandbox object) expose the host's `Function` constructor, for example `this.constructor.constructor('return process')()`, which reaches `process`. (2) The code shares your heap and thread, so it can exhaust memory and block the loop; the `timeout` option helps only with synchronous loops. For runaway code, run it in a Worker with `resourceLimits` and `terminate()` it; for security use OS-level isolation.

</details>

10. What does "Node-API is ABI stable" mean for a package that ships a native addon?
<details><summary>Answer</summary>

The addon is compiled once and keeps working on later Node versions without recompiling, so the maintainer can ship one prebuilt binary per platform instead of one per Node major, and users do not need a compiler. An addon that uses V8's C++ API directly is tied to `process.versions.modules` (137 on Node 24.16) and must be rebuilt for each Node major.

</details>

---

## Try it yourself

Run each solution from the repository root, for example by saving it as `scratch.js` somewhere outside the repo and running `node scratch.js`.

### Task 1 (easy): which native bindings does a module need?
Write a script that, for the core modules `node:zlib`, `node:crypto`, `node:dns` and `node:fs`, prints which native bindings (`Internal Binding ...` entries in `process.moduleLoadList`) each one adds. Each module must be tested in a fresh process, otherwise earlier requires hide the answer.

<details><summary>Hint</summary>

Spawn `process.execPath` with `-e` and a small program. Inside it: copy `process.moduleLoadList`, `require(process.argv[1])`, then keep the new entries that start with `'Internal Binding '`.

</details>

<details><summary>Solution</summary>

```js
const { execFileSync } = require('node:child_process');

// This code runs inside a fresh child process, so earlier requires cannot hide anything.
const childCode = `
  const before = process.moduleLoadList.slice();
  require(process.argv[1]);
  const added = process.moduleLoadList.filter((e) => !before.includes(e) && e.startsWith('Internal Binding '));
  console.log(added.map((e) => e.slice('Internal Binding '.length)).join(', ') || '(nothing new)');
`;

for (const name of ['node:zlib', 'node:crypto', 'node:dns', 'node:fs']) {
  const out = execFileSync(process.execPath, ['-e', childCode, name], { encoding: 'utf8' }).trim();
  console.log(`${name.padEnd(12)} adds: ${out}`);
}
```

```text
node:zlib    adds: zlib
node:crypto  adds: crypto
node:dns     adds: cares_wrap
node:fs      adds: (nothing new)
```

`node:fs` adds nothing because Node loads `fs` (and its `fs` binding) during start-up already. Each module is a thin JavaScript layer over one binding (`zlib`, `crypto`, `cares_wrap`), which is the layer picture from section 1.

</details>

### Task 2 (medium): keep the request id in a task queue
Write `withRequest(id, fn)` and `log(message)` with `AsyncLocalStorage`. Then write a `TaskQueue` with `add(fn)` and `drain()`: three simulated requests (with different delays) each `add` a task, and `drain()` is called later from outside every request. Each task must log the id of the request that queued it.

<details><summary>Hint</summary>

If you store the plain function, it runs with no context. Wrap it when it is added: `AsyncResource.bind(fn)`.

</details>

<details><summary>Solution</summary>

```js
const { AsyncLocalStorage, AsyncResource } = require('node:async_hooks');
const { setTimeout: sleep } = require('node:timers/promises');

const storage = new AsyncLocalStorage();

function withRequest(id, fn) {
  return storage.run({ id }, fn);
}
function log(message) {
  console.log(`[${storage.getStore()?.id ?? 'no request'}] ${message}`);
}

class TaskQueue {
  #tasks = [];
  add(fn) {
    // Remember the context of the code that calls add(), not the context of whoever runs the task.
    this.#tasks.push(AsyncResource.bind(fn));
  }
  drain() {
    for (const task of this.#tasks.splice(0)) task();
  }
}

const queue = new TaskQueue();

async function handle(id, delayMs) {
  await withRequest(id, async () => {
    log('request starts');
    await sleep(delayMs);
    queue.add(() => log('task runs later'));
    log('task queued');
  });
}

(async () => {
  await Promise.all([handle('A', 20), handle('B', 5), handle('C', 10)]);
  console.log('--- draining from outside every request');
  queue.drain();
})();
```

```text
[A] request starts
[B] request starts
[C] request starts
[B] task queued
[C] task queued
[A] task queued
--- draining from outside every request
[B] task runs later
[C] task runs later
[A] task runs later
```

The order of the "queued" lines follows the delays (B 5 ms, C 10 ms, A 20 ms), so it could differ on a very slow machine; what must hold is that each task prints its own request id. Remove `AsyncResource.bind` and all three tasks print `[no request]`.

</details>

### Task 3 (harder): stop runaway code with a Worker
Write `runWithLimits(code, { timeoutMs, maxOldGenerationSizeMb })` that evaluates JavaScript text in a Worker and returns a promise of `{ ok: true, value }` or `{ ok: false, reason }`. It must stop an endless loop (reason `'timeout'`), survive a memory hog (reason `'ERR_WORKER_OUT_OF_MEMORY'`), and report a thrown error. Show that the main thread keeps running while the endless loop is active.

<details><summary>Hint</summary>

`new Worker(source, { eval: true, resourceLimits: { maxOldGenerationSizeMb } })`. Post the result of `eval(code)` back with `parentPort.postMessage`. Start a `setTimeout` in the main thread that calls `worker.terminate()`, but start it when the Worker emits `'online'`: creating a Worker thread takes well over 100 ms on a slow or busy machine, and that start-up time must not eat your time limit. Listen for the Worker's `'error'` event for out-of-memory and thrown errors. Remember to clear the timer when the result comes back.

</details>

<details><summary>Solution</summary>

```js
const { Worker } = require('node:worker_threads');

// Runs JavaScript text in its own isolate (a Worker). The main thread stays free, and we can
// stop the worker on a timeout or when it uses too much memory.
// This protects against endless loops and memory hogs. It is still NOT a security boundary.
function runWithLimits(code, { timeoutMs = 1000, maxOldGenerationSizeMb = 32 } = {}) {
  return new Promise((resolve) => {
    const worker = new Worker(
      `const { parentPort } = require('node:worker_threads');
       parentPort.postMessage(eval(${JSON.stringify(code)}));`,
      { eval: true, resourceLimits: { maxOldGenerationSizeMb } },
    );
    let timer;
    // Start the clock when the worker is running, not while its thread is still starting up.
    worker.once('online', () => {
      timer = setTimeout(() => {
        worker.terminate();
        resolve({ ok: false, reason: 'timeout' });
      }, timeoutMs);
    });
    worker.once('message', (value) => {
      clearTimeout(timer);
      worker.terminate();
      resolve({ ok: true, value });
    });
    worker.once('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: err.code || err.message });
    });
    worker.once('exit', (exitCode) => {
      clearTimeout(timer);
      resolve({ ok: false, reason: `exit code ${exitCode}` }); // ignored if we already resolved
    });
  });
}

(async () => {
  console.log(await runWithLimits('6 * 7'));
  console.log(await runWithLimits('while (true) {}', { timeoutMs: 200 }));
  console.log(await runWithLimits('const keep = []; while (true) keep.push(new Array(100000).fill(1));'));
  console.log(await runWithLimits('throw new Error("boom")'));
  let ticks = 0;
  const heartbeat = setInterval(() => ticks++, 10);
  await runWithLimits('while (true) {}', { timeoutMs: 200 });
  clearInterval(heartbeat);
  console.log('main thread kept running during the endless loop:', ticks > 0);
})();
```

```text
{ ok: true, value: 42 }
{ ok: false, reason: 'timeout' }
{ ok: false, reason: 'ERR_WORKER_OUT_OF_MEMORY' }
{ ok: false, reason: 'boom' }
main thread kept running during the endless loop: true
```

**Gotcha:** starting a Worker is slow. On the author's Windows machine a Worker needed about 150 to 400 ms to come online. A timer started right after `new Worker(...)` would count that start-up against the limit, and even `6 * 7` could report a timeout. That is why the clock starts at `'online'`. The exact number of heartbeat ticks also depends on how busy the machine is, so the last line only claims that the main thread ticked at all, which a blocking `vm` call could never do.

Compare with `vm.runInNewContext('while (true) {}', {}, { timeout: 50 })` from section 10: the `vm` call blocks the main thread for those 50 ms, while the Worker runs in another thread and its own isolate. Neither is a security boundary: the Worker code can still use `require('node:fs')` unless you add more protection (OS isolation, or `--permission`).

</details>

---

## Where to go next

- Next lesson: [24. Production, Deployment and Observability](../24-production-and-deployment/README.md). It uses `diagnostics_channel`, `perf_hooks` and the loop-delay ideas from this lesson for monitoring.
- Related lessons: [Lesson 8: The Event Loop](../08-event-loop/README.md) (phases and ordering), [Lesson 18: Worker Threads and Cluster](../18-worker-threads-and-cluster/README.md) (isolates in practice) and [Lesson 19: Performance and Memory](../19-performance-and-memory/README.md) (GC, profiling, heap snapshots).
- Practise this topic in the interview rounds: [Round 4: advanced](../../rounds/round-4-advanced/questions.md), plus [Round 2: core Node.js](../../rounds/round-2-core/questions.md) for the event loop and module questions.
- Read the official docs: the `async_context`, `vm`, `v8`, `diagnostics_channel`, `perf_hooks`, `worker_threads`, `wasi` and Node-API pages on nodejs.org, and the libuv design overview at libuv.org.
- Re-run the examples with your own changes: add a property in a different order in example 02, add a fourth file to the graph in example 07, or queue work from a timer in example 08, and predict the output first. Or build the native addon in `examples/_native` and call it from your own script.
