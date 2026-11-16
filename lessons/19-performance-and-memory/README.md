# 19. Performance, Profiling and Memory

> Level: Advanced   Time: about 240 minutes   Node: 24 (notes where older versions differ)

[Previous: 18. worker_threads, cluster and Scaling on One Machine](../18-worker-threads-and-cluster/README.md) | [All lessons](../../README.md) | [Next: 20. Security and the crypto Module](../20-security-and-crypto/README.md)

## What you will learn
- How to think about performance: measure first, latency versus throughput, percentiles (p50, p95, p99) and Little's law
- How V8 uses memory (stack, heap, young and old generation, memory outside the heap) and what the heap limit and a container limit mean
- How garbage collection works (scavenge and mark-sweep-compact), how to read `--trace-gc`, and why allocation rate matters
- The classic memory leaks in Node (caches, globals, closures, listeners, timers, promises, shared Buffers), each with a runnable demo and a fix
- How to find a leak: `process.memoryUsage()`, heap snapshots, retainers, shallow versus retained size, and the three-snapshot technique
- How to find slow code: `--cpu-prof`, `--prof`, Chrome DevTools, flame graphs, and a worked example with before and after numbers
- How to measure event loop lag, benchmark without fooling yourself, and load test your own server
- The tactics that really matter in Node (batching, keep-alive, pagination, streams, worker threads, V8-friendly code) and a production checklist

All examples are in `lessons/19-performance-and-memory/examples/`. Run them from the repository root, for example `node lessons/19-performance-and-memory/examples/01-memory-model.js`. A few need a flag; the run line is at the top of each file.

How to read this lesson: sections 1 to 3 are the ideas (measuring, memory, garbage collection). Sections 4 and 5 are about memory leaks, sections 6 and 7 about slow code, sections 8 to 10 about measuring (event loop lag, benchmarks, load tests), and sections 11 and 12 about fixes and a production checklist. Run each example while you read: the numbers are more convincing when they come from your own machine.

> **Platform note:** the numbers in this lesson were measured on Windows 11 with Node 24.16.0 (12 CPU threads, 15 GiB of RAM). Your numbers will be different. What stays the same is the shape of the result: which version is faster, which number keeps growing. Timers are also coarse on Windows: a 10 ms timer often fires after about 16 ms.

---

## 1. Measure first

Performance work has one rule: **do not guess, measure.** Developers are bad at guessing where the time goes. The loop that works every time:

1. Decide what "fast enough" means (for example: p99 latency under 300 ms).
2. Measure the current state.
3. Find the biggest cost (profile, do not guess).
4. Change one thing.
5. Measure again. If the number did not improve, undo the change.

Why the biggest cost first? A part that takes 10% of the time can save you at most 10% of the total time, even if you make that part infinitely fast (this is Amdahl's law in one line). Work on the part that takes 70%.

**Latency and throughput** are the two basic numbers. They are not the same.

| Word | Question | Unit | Restaurant analogy |
|---|---|---|---|
| Latency | How long does ONE request take? | milliseconds | How long until my meal arrives |
| Throughput | How many requests do we finish per second? | requests/s | How many meals the kitchen serves per hour |

They often pull against each other. Collecting 100 jobs and doing them together can raise throughput, but the first job now waits longer.

**Percentiles.** Never describe latency with the average alone. The p95 is the time that 95% of the requests beat. The p50 is the median (the typical request). The p99 is the "slow tail": 1 request in 100 is slower than this.

```js
const times = [10, 11, 10, 12, 10, 11, 10, 10, 11, 1000]; // ms, ten requests
const sorted = [...times].sort((a, b) => a - b);
const percentile = (p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const average = times.reduce((a, b) => a + b, 0) / times.length;
console.log({ average, p50: percentile(50), p90: percentile(90), p99: percentile(99) });
```

```text
{ average: 109.5, p50: 10, p90: 12, p99: 1000 }
```

The average (109.5 ms) describes nobody: most users saw 10 ms and one user waited a full second. The p50 and p99 tell the real story. The tail matters more than it looks. If one page makes 10 backend calls and each call is slow 1% of the time, then 1 - 0.99^10 is about 10% of page loads hit at least one slow call.

Two rules for percentiles: report several (p50, p95, p99 and the maximum), and never average percentiles from different servers (merge the raw measurements or histograms instead).

**Little's law** in two lines: `L = lambda x W`. The average number of requests inside the system (L) equals the arrival rate (lambda, requests per second) times the average time one request spends inside (W, seconds).

Use it to size things. At 200 requests/s with 0.5 s per request, 200 x 0.5 = 100 requests are in flight at the same time. That means about 100 open sockets (network connections). If every request also needs a database connection, a pool of 20 connections (a fixed set of reusable connections) will make requests wait. Example `10-load-test.js` (section 10) checks the law with real numbers.

> **Interview tip:** "The app is slow, what do you do?" A strong answer starts with measuring, not with code: look at latency percentiles, CPU, memory trend and event loop lag. Decide if the problem is CPU (high CPU, high lag), waiting (low CPU, slow calls to a database or another service) or memory (a number that only grows). Then profile that one thing, fix it, and measure again.

---

## 2. How Node uses memory

Example: `examples/01-memory-model.js`. Run it with `node lessons/19-performance-and-memory/examples/01-memory-model.js`.

Your program's data lives in three places.

| Place | What is in it | Notes |
|---|---|---|
| The stack | Function calls, local numbers, references | Small (about 1 MB by default). Too deep recursion throws `RangeError: Maximum call stack size exceeded`. |
| The V8 heap | Objects, arrays, strings, closures | Managed by the garbage collector. This is what `--max-old-space-size` limits. |
| Outside the heap ("external") | `Buffer` and `ArrayBuffer` data, native (C++) memory | Not counted in the heap limit. Still counts towards the memory of the process. |

`process.memoryUsage()` gives five numbers:

| Field | Meaning |
|---|---|
| `rss` | Resident set size: all RAM the operating system really gave this process (heap, stacks, code, native memory, Buffers) |
| `heapTotal` | Memory V8 has reserved for the JavaScript heap |
| `heapUsed` | The part of the heap that holds objects now. It includes garbage that is not collected yet |
| `external` | Memory of C++ objects tied to JavaScript objects, mainly Buffers |
| `arrayBuffers` | Memory of `ArrayBuffer`s and `Buffer`s. It is a part of `external` |

The example allocates 300000 small objects, then a 50 MB buffer, and prints what changed:

```text
1. at start:
  rss            65.5 MB
  heapTotal       6.2 MB
  heapUsed        4.7 MB
  external        1.8 MB
  arrayBuffers    0.0 MB

2. what changed?
  after 300000 small objects: heapUsed   32.2 MB | external    0.0 MB
  after a 50 MB Buffer:       heapUsed    0.0 MB | external   50.0 MB | arrayBuffers   50.0 MB
  rss grew by    0.0 MB when the buffer was allocated, and by   50.1 MB after writing to every byte of it
```

Why? The objects live in the heap, so `heapUsed` grows. The buffer lives outside it, so only `external` and `arrayBuffers` grow and `heapUsed` stays flat. The `rss` of a fresh `Buffer.alloc(50 MB)` did not move until the example wrote to every byte: the operating system hands out zero-filled memory lazily, and `rss` only counts pages that were really used. (That is what happened on Windows; other systems may touch some pages earlier, so the "0.0 MB" can differ.)

> **Interview tip:** "My heap is 80 MB but the process uses 1.5 GB." The memory is outside the V8 heap: Buffers, native addons, the heaps of worker threads, or memory that the allocator has not given back to the operating system. Look at `external`, `arrayBuffers` and `rss` first, not only at `heapUsed`.

### The shape of the V8 heap

V8 splits the heap by object age, because of one observation: **most objects die young** (a temporary array in a request handler is garbage a millisecond later).

```text
 V8 heap
 +---------------------------+     +--------------------------------------------+
 | New space (young          |     | Old space                                  |
 | generation)               | --> | objects that survived; big; cleaned less  |
 | small, a few MB, fast to  |     | often                                      |
 | clean                     |     +--------------------------------------------+
 +---------------------------+     | Large object space: huge arrays and        |
                                   | strings, each with its own memory block    |
                                   | Code space: compiled machine code          |
                                   +--------------------------------------------+
```

`v8.getHeapSpaceStatistics()` shows these spaces. The example prints five of them (numbers change from run to run):

```text
3. heap spaces (exact numbers change from run to run):
  new_space               used  14.3 MB  reserved  32.0 MB
  old_space               used  14.0 MB  reserved  14.6 MB
  code_space              used   0.1 MB  reserved   0.3 MB
  new_large_object_space  used   6.0 MB  reserved   6.0 MB
  large_object_space      used   4.5 MB  reserved   4.6 MB
  (bigArray has 400000 elements and is kept alive on purpose)
```

Small new objects go to `new_space`, survivors move to `old_space`, and big arrays get a large object space of their own (new large objects start in `new_large_object_space` and move on later). The split depends on when the last GC ran: in another run of the same program `new_space` was almost empty and `old_space` held about 24 MB, because a scavenge had just moved the survivors.

### `v8.getHeapStatistics()`

`process.memoryUsage()` describes the whole process. `v8.getHeapStatistics()` describes the V8 heap only, and it also tells you the limit. The fields to know:

| Field | Meaning |
|---|---|
| `total_heap_size` | Heap memory that V8 has reserved (like `heapTotal`) |
| `used_heap_size` | Heap memory in use (like `heapUsed`) |
| `heap_size_limit` | The most the heap may grow to before V8 stops the program with an out-of-memory error |
| `total_available_size` | How much room is left before that limit |
| `malloced_memory` | Native memory that V8 itself allocated outside the heap |
| `external_memory` | Memory of external objects, mainly Buffers (the same idea as `external` above) |
| `number_of_detached_contexts` | Contexts (separate global environments, for example made by the `vm` module) that nobody uses any more but that are not freed yet. The Node docs say that a non-zero number can point to a leak. |

The example prints them:

```text
4. v8.getHeapStatistics() (the fields to know):
  total_heap_size         58.8 MB
  used_heap_size          40.0 MB
  total_available_size  4241.6 MB
  heap_size_limit       4288.0 MB
  malloced_memory          0.2 MB
  external_memory         51.8 MB
  number_of_native_contexts:    2 | number_of_detached_contexts: 0
```

(`external_memory` is 51.8 MB because the 50 MB Buffer from part 2 is still alive.)

### The heap limit and the container trap

V8 stops the program when the old generation is full. By default the limit depends on the machine: `heap_size_limit` was 4288 MB here (15 GiB of RAM). Do not hard-code it. You can set it with `--max-old-space-size=<MB>`:

```text
5. heap_size_limit of this process: 4288.0 MB (depends on your machine, do not hard-code it)
   with --max-old-space-size=64 the limit is  256.0 MB (more than the flag: it also counts the young generation)
   with --max-old-space-size=256 the limit is  448.0 MB (more than the flag: it also counts the young generation)
   process.constrainedMemory(): 0 (0 means: no limit known to Node, as on a normal PC)

6. child with a 32 MB limit and a leak: exit code 134
   FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
```

When the limit is reached, Node prints `FATAL ERROR: Reached heap limit ...` and aborts with exit code 134. There is no exception to catch.

Set the flag in the shell, or through the environment so that it also reaches child processes:

```bash
node --max-old-space-size=384 server.js
NODE_OPTIONS=--max-old-space-size=384 node server.js
```

```powershell
$env:NODE_OPTIONS="--max-old-space-size=384"; node server.js
```

In a container (Docker, Kubernetes) with a memory limit, two different things can end your process:

| Who stops the process | When | What you see |
|---|---|---|
| V8 | The old space reaches `heap_size_limit` | `FATAL ERROR: Reached heap limit ...` and exit code 134 |
| The operating system (the "OOM killer": out of memory) | The whole process (`rss`) reaches the container limit | The process is killed with SIGKILL and Node prints nothing. Docker shows exit code 137 (128 plus signal 9) |

> **Common mistake (the container trap):** a container has a 512 MB memory limit, and someone sets `--max-old-space-size=512`. The heap alone may now grow to the whole limit, but the process also needs memory for Buffers, the young generation, native code and thread stacks. So the operating system kills the process first, with no helpful message.

What to do instead:

- Leave room. A common starting point is to give the old space about 70-75% of the container limit, then watch `rss` and adjust. This is a rule of thumb, not a Node default.
- `process.constrainedMemory()` returns the limit that the operating system puts on the process, or 0 when there is none or it is unknown (stable since Node 24, added in 18.15 and 19.6). It returned 0 on the Windows PC used here; it was not run inside a Linux container.
- `--max-old-space-size-percentage=<n>` sets the limit as a percentage of the available system memory (the CLI docs say it wins over `--max-old-space-size` when both are given). What "available" means inside a container was not checked here.
- Always print `heap_size_limit` inside the real container and look at it.

> **Under the hood:** `--max-semi-space-size=<MB>` sets the maximum size of one "semi-space" (the young generation is made of semi-spaces, section 3). The Node docs say the young generation is three times the semi-space size, which fits the `heap_size_limit` above: it is the flag plus a fixed extra 192 MB in these runs. A bigger value can raise throughput for services that allocate many short-lived objects, but the docs also say the gain depends on your workload. In example `02-gc-pressure.js` it did not change the number of scavenges (about 47, with and without `--max-semi-space-size=64`), so measure on your own application before you adopt it.

---

## 3. Garbage collection and allocation pressure

Example: `examples/02-gc-pressure.js`.

**Garbage collection (GC)** is V8 finding objects that nobody can reach any more and freeing their memory. V8 uses two different collectors, one for each generation.

| | Scavenge ("minor GC") | Mark-sweep-compact ("major GC") |
|---|---|---|
| Cleans | young generation | old generation |
| How | copies the live objects to the other half of the young space (survivors that live on are moved to old space) | marks everything reachable, frees the rest (sweep), and packs the survivors together (compact) |
| Cost depends on | the number of LIVE objects (garbage is free: it is just left behind) | the size of the live heap |
| Pause for your JavaScript | usually a few milliseconds | V8 does most of the work in the background and in small steps, so pauses are short, but not zero |
| Runs when | new space is full | old space has grown enough |

Two things follow from this table.

1. **Allocation rate matters.** Each allocation fills the young space, so more allocation means more scavenges.
2. **Survivors cost more than garbage.** Objects that stay alive must be copied and later marked. A cache or a growing array makes every GC more expensive.

> **Under the hood:** the pieces behind the table (from the V8 team's posts about its garbage collector, called Orinoco):
> - The young generation is made of two halves, the **semi-spaces**. New objects are created in one half. A scavenge copies the live objects to the other half, and then the two halves swap roles. An object that survives two scavenges is moved ("promoted") to the old generation.
> - A scavenge must not scan the whole old generation to find old objects that point at young ones. V8 keeps a list of such pointers, which it updates with a small check on every pointer write (the **write barrier**).
> - Mark-sweep-compact marks in small steps (incremental) and on helper threads while your code keeps running (concurrent). Only short final steps stop JavaScript completely (a "stop-the-world" pause). The scavenger also uses several threads in parallel.
> - Compaction moves the surviving objects together, so that free memory is not chopped into tiny unusable holes (fragmentation).

The example watches the GC with a `PerformanceObserver` and runs the same work three ways:

```js
const { PerformanceObserver, constants } = require('node:perf_hooks');
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    // entry.detail.kind is one of constants.NODE_PERFORMANCE_GC_MINOR, ..._MAJOR, ..._INCREMENTAL
    // entry.duration is the pause in milliseconds
  }
});
observer.observe({ entryTypes: ['gc'] });
```

```text
1. 5 million short-lived records    406 ms   (result 12500061388890)
   GC runs: {"minor (scavenge)":46} | total GC pause about 65 ms
2. reuse one scratch array           78 ms   (result 12500061388890)
   GC runs: {} | total GC pause about 0 ms
3. like 1, but keep 1 record in 50  415 ms   (result 12500061388890)
   GC runs: {"minor (scavenge)":34,"incremental marking":1,"major (mark-sweep-compact)":1} | total GC pause about 70 ms
   records kept alive: 100000
```

Case 1 creates garbage and pays about 65 ms of GC pause out of 406 ms. Case 2 creates no garbage at all, so there is no GC (and it is about 4 to 5 times faster, because it also does less work). Case 3 keeps some records alive, so V8 also needed incremental marking and a major GC. The exact counts change from run to run; the pattern does not.

### Reading `--trace-gc`

`node --trace-gc app.js` prints one line for each GC. The example runs a small program with the flag and prints the first lines (the `[process id:address]` prefix is removed):

```text
--trace-gc: 13 scavenges (young generation), 1 mark-compact (old generation)
first scavenge line:
  35 ms: Scavenge 4.6 (5.7) -> 4.0 (6.7) MB, pooled: 0 MB, 0.78 / 0.00 ms  (average mu = 1.000, current mu = 1.000) allocation failure; 
first mark-compact line:
  109 ms: Mark-Compact 17.6 (47.2) -> 15.3 (49.1) MB, pooled: 0 MB, 4.15 / 0.00 ms  (+ 0.2 ms in 3 steps since start of marking, biggest step 0.1 ms, walltime since start of marking 14 ms) (average mu = 0.959, current mu = 0.959) finalize incremental marking via stack guard; GC in old space requested
```

How to read a line:

- `35 ms:` time since the process started.
- `Scavenge` or `Mark-Compact`: which collector ran.
- `4.6 (5.7) -> 4.0 (6.7) MB`: heap in use (and, in brackets, the heap size V8 has committed) before the GC, then after. The "after" number is the one to watch for leaks.
- `0.78 / 0.00 ms`: the first number is the time of this GC pause. The second is the time spent in "external" callbacks, code outside V8's own heap (for example Node's weak-reference callbacks). It is usually `0.00` and you can ignore it. (This reading comes from the V8 source, the function `GCTracer::Print`, not from an experiment. The layout of these lines can change between V8 versions.)
- `pooled: 0 MB`: memory pages V8 keeps ready for reuse. Ignore it.
- `mu` is "mutator utilization". The "mutator" is your program (it keeps changing the heap while the GC tries to clean it). So `mu` is the share of time your code, not the GC, was running. `1.000` is perfect; small values mean the GC is eating your time.
- The last words are the reason: `allocation failure` means the young space was full.

### How to reduce GC pressure

**Allocation rate** is how much new memory your code creates per second. You see it as many scavenges per second in `--trace-gc`, or in the `PerformanceObserver` output above. Lower it only where a CPU profile shows `(garbage collector)` as a big share of the time (in case 1 above the pauses were about 16% of the run).

Only do this in hot paths that a profile pointed at. Do not turn all your code into contortions.

- Do not create temporary objects, arrays or closures inside loops that run millions of times. Reuse a scratch object or buffer.
- Chains such as `.map().filter().map()` create a new array at each step. A single loop does not.
- Process large data as a stream instead of collecting it all (section 11).
- Keep caches bounded (section 4).

> **Interview tip:** "How does V8's garbage collector work?" A strong answer: generational (young and old), scavenge copies live objects and is cheap when most objects are dead, major GC marks from the roots then sweeps and compacts, and V8 does much of the work incrementally and concurrently to keep pauses short. Then add the practical part: allocation rate and survivors are what you can control.

---

## 4. Memory leaks and their fixes

Examples: `examples/03-leaks-cache-and-globals.js` and `examples/04-leaks-closures-timers-promises.js`. Both need a flag so that they can force a GC and measure honestly:

```bash
node --expose-gc lessons/19-performance-and-memory/examples/03-leaks-cache-and-globals.js
node --expose-gc lessons/19-performance-and-memory/examples/04-leaks-closures-timers-promises.js
```

A **memory leak** is memory that is still reachable (something points to it) but your program will never use again. The garbage collector only frees what is unreachable, so it cannot help. The signs: `heapUsed` after each major GC keeps climbing like a staircase, GC runs more often, latency gets worse, and finally the process dies with exit code 134 (or gets killed in a container).

> **Remember:** a leak is almost always a reference you forgot. To fix a leak, find what holds the reference.

(`--expose-gc` gives you a `global.gc()` function. It is for experiments like these. Never call it in production code.)

### 4.1 An unbounded cache and a global array

A `Map` used as a cache that never forgets, or a module-level array that every request appends to, grows forever. Fix: bound the size. Two small tools: an LRU cache (drops the least recently used entry) and a ring buffer (keeps the last N).

```js
class LruCache {
  constructor(maxEntries) { this.maxEntries = maxEntries; this.map = new Map(); }
  get(key, load) {
    if (this.map.has(key)) {
      const value = this.map.get(key);
      this.map.delete(key);       // delete and set again: the key becomes "most recently used"
      this.map.set(key, value);
      return value;
    }
    const value = load(key);
    this.map.set(key, value);
    if (this.map.size > this.maxEntries) this.map.delete(this.map.keys().next().value); // oldest key
    return value;
  }
}
```

(The example has the full class with hit counters. A `Map` remembers insertion order, so the first key is always the least recently used.)

```text
--- caches: 10000 requests, 5000 possible users
Map with no limit                  kept in memory: 13.53 MB
LRU with a limit of 200 entries    kept in memory: 1.57 MB
LRU hit rate: 79% | entries: 200

--- a global array: 10000 requests
global array, never trimmed        kept in memory: 16.26 MB
ring buffer of the last 100        kept in memory: 0.17 MB
```

The LRU kept memory small and still answered 79% of the requests from the cache, because in this test (as in much real traffic) 80% of the requests ask for a few popular users. Also think about a time limit (TTL) so that stale data disappears; you build that in Task 3 below.

**Accidental globals.** A variable in the global scope is reachable until the process ends, so everything it points to is never freed. The usual way to create one by mistake is to forget `const` in a file that is not in strict mode. CommonJS files are not strict by default (ES modules and classes always are). Example 03:

```js
function buildReportSloppy(id) {
  bigResult = new Array(100_000).fill(id);   // forgot const: this creates globalThis.bigResult
  return bigResult.length;
}
```

```text
--- an accidental global (forgot const)
sloppy mode: kept in memory:       0.76 MB | typeof globalThis.bigResult = object
strict mode: the same line gives ReferenceError: bigResultStrict is not defined
```

The array is not used after the call, yet it stays alive because the global points to it. Fix: declare variables with `const` or `let`, put `'use strict'` at the top of CommonJS files (or use ES modules), and let a linter report undeclared variables (the ESLint rule `no-undef`). The same applies to global variables you create on purpose: `globalThis.something = ...` and module-level variables (`const cache = new Map()` at the top of a file) live as long as the process, so treat them as long-lived memory that needs a limit.

### 4.2 Extra data about objects: WeakMap and WeakRef

You often want to attach data to an object you do not own (a connection, a request). If you use a `Map` keyed by that object, the map keeps the object alive forever. A **`WeakMap`** holds its keys weakly: when nobody else references the key, the entry disappears.

```text
--- extra data attached to objects that die soon: 2000 objects
Map keyed by the object            kept in memory: 7.84 MB
WeakMap keyed by the object        kept in memory: 0.07 MB
```

A **`WeakRef`** points to an object without keeping it alive; `ref.deref()` gives the object or `undefined`. It suits "a cache that the GC may empty". Be careful: the language gives no promise about when, or if, the object is collected.

```text
--- WeakRef
while we hold the object, deref() gives it back: true
same turn, after dropping it:                true (kept alive until the end of the current turn)
after a later turn and a GC:                 false (usually false; the language does not promise when)
```

> **Common mistake:** relying on `WeakRef` or `FinalizationRegistry` for program logic. Callbacks may run late or never. Use them only as an optimization on top of normal cleanup.

### 4.3 A small slice of a big string or Buffer

V8 does not copy a long substring (13 characters or more). It stores a view into the parent string. So 30 kept characters can keep a 2 MB page alive:

```text
--- a small slice of a big string: 20 pages of 2 MB
slice() kept as it is              kept in memory: 40.06 MB (for 20 pieces of 30 characters)
slice() copied to a new string     kept in memory: 0.00 MB (for 20 pieces of 30 characters)
```

If you keep small pieces of big inputs (a header cut from a big response, an id from a big log line) for a long time, copy them first. The example copies through a `Buffer`: `Buffer.from(piece).toString()`.

`Buffer` has the same trap. `buf.subarray()` (and the old `buf.slice()`) do not copy: they are a window onto the same memory. A 16-byte header cut from a 1 MB response keeps the whole 1 MB alive. That memory is outside the V8 heap, so `heapUsed` does not show it. Look at `arrayBuffers` instead:

```text
--- a small view of a big Buffer: 20 responses of 1 MB
subarray() kept as it is           kept in memory: 20.00 MB (for 20 headers of 16 bytes)
subarray() copied with Buffer.from kept in memory: 0.00 MB (for 20 headers of 16 bytes)
```

Fix: copy what you keep with `Buffer.from(view)`. (Small Buffers made by `Buffer.allocUnsafe` or `Buffer.from(string)` are cut from one shared 8 KB pool block, which is why tiny Buffers are cheap. The same rule applies: the whole block stays alive while any Buffer cut from it is alive. Lesson 10 covers Buffers.)

### 4.4 Closures hold on to their scope

Example 04, part 1. V8 puts every variable that any inner function uses into one shared "context" object. So a function that you return keeps that whole context alive, even if it does not use the big variable itself, as long as another inner function (even one you dropped) uses it.

```js
function makeSessionLeaky(id) {
  const big = new Array(20_000).fill(id);   // about 160 KB
  const debugSize = () => big.length;       // uses `big`, and is never called
  return () => 'session ' + id;             // does not use `big`, but shares the same context
}
function makeSessionFixed(id) {
  const size = new Array(20_000).fill(id).length;   // keep only the number we need
  return () => 'session ' + id + ' (' + size + ')';
}
```

```text
--- 1. closures (100 sessions of 160 KB each)
closures that share a scope with big           15.28 MB
closures that keep only a number               0.01 MB
```

Fix: copy out what you need (a number, an id) and keep the big object in a place where the long-lived function cannot see it.

### 4.5 Event listeners that are never removed

Each `emitter.on(...)` adds a function (and everything it closes over) to the emitter's list. If you add one per request to a long-lived emitter and never remove it, the list grows. Node warns you at the 11th listener: `MaxListenersExceededWarning: Possible EventEmitter memory leak detected`. **Do not silence that warning with `setMaxListeners(0)` before you understand it.** It is a leak alarm.

```text
--- 2. event listeners (100 requests of 80 KB each)
   warning event: MaxListenersExceededWarning
after 100 requests, listeners never removed    7.66 MB
   listeners on the bus: 100
after removing them                            0.02 MB
100 more requests that clean up                0.13 MB
   listeners on the bus: 0
```

(The warning text itself goes to stderr: `(node:<pid>) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 shutdown listeners added to [EventEmitter]. MaxListeners is 10. Use emitter.setMaxListeners() to increase limit`.) Fixes: `emitter.off(name, fn)` when the request ends, `emitter.once(...)` for one-shot events, or an `AbortSignal` (`addEventListener(..., { signal })` on an `EventTarget`).

### 4.6 Timers that are never cleared

A running `setInterval` keeps its callback, and everything the callback closes over, alive until you call `clearInterval`.

```text
--- 3. timers (100 intervals, each holding 80 KB)
after starting 100 intervals                   7.68 MB
after unref() on all of them                   7.68 MB
after clearInterval() on all of them           0.04 MB
```

> **Common mistake:** thinking that `timer.unref()` fixes a timer leak. `unref()` only tells Node "this timer alone must not keep the process alive". The timer still exists, still fires, and still holds its memory (the middle line above). Use `clearInterval` / `clearTimeout` to release the memory. Use `unref()` for background timers that should not block shutdown.

### 4.7 Promises that never settle

A pending promise that nobody references is just garbage; the first line below shows 1000 of them cost nothing. The leak starts when something keeps the promise or its `resolve` function: for example, a `Map` of "requests waiting for an answer". If the answer never comes, the entry stays.

```text
--- 4. promises that never settle (1000 requests of 40 KB each)
1000 pending promises, nobody holds them       0.01 MB
1000 pending promises, held by a Map           38.45 MB
   waiting requests: 1000
   waiting requests right after the calls start: 1000
   waiting requests after the 20 ms timeouts: 0 | rejected: 1000
same 1000 requests, with a timeout             0.18 MB
```

Fix: every wait gets a timeout that removes the entry and rejects the promise. For outgoing `fetch` calls use `fetch(url, { signal: AbortSignal.timeout(2000) })`.

> **Interview tip:** "What are the common memory leaks in Node?" Give the list from 4.1 to 4.7 in your own words, with the fix for each, and say how you would find one in a real system. That leads to the next section.

---

## 5. Finding a leak

Example: `examples/05-heap-snapshots.js`.

**Step 1: confirm the leak.** Watch memory over time: `process.memoryUsage()` or `v8.getHeapStatistics()` once a minute, written to your metrics system. What matters is the **floor**: the heap size right after a major GC. A leak shows as a floor that rises round after round, like a staircase. `--trace-gc` shows the same thing: the number after the arrow on `Mark-Compact` lines keeps growing. A sawtooth that always returns to the same floor is healthy.

The end of example 03 simulates six "minutes" with 400 new users each, and forces a GC at the end of each round to read the floor (run it with `--expose-gc`, section 4):

```text
--- confirming a leak: heapUsed after a full GC, once per round (400 new users per round)
round   leaky Map   bounded LRU
    1     3.10 MB       0.78 MB
    2     6.21 MB       0.78 MB
    3     9.32 MB       0.78 MB
    4    12.40 MB       0.78 MB
    5    15.49 MB       0.78 MB
    6    18.63 MB       0.78 MB
leaky floor rises every round: true | bounded floor stays flat after it is full: true
```

The Map adds about 3 MB every round and never gives it back. The bounded cache fills up to its limit and then stays flat. In production you cannot call `gc()`, so read the numbers from `--trace-gc`, from a `PerformanceObserver` for `gc` entries, or compare `heapUsed` at the same quiet moment every day. Two cautions: a floor that rises for ten minutes is not yet proof (caches fill up and then stop, so look over a longer time under steady load), and `rss` can stay high after the heap shrinks, because the process may keep freed memory for reuse.

**Step 2: take heap snapshots.** A **heap snapshot** is a file that lists every object in the heap and every reference between objects. Ways to get one:

| Way | Notes |
|---|---|
| `v8.writeHeapSnapshot()` in your code (for example on an admin endpoint) | Works everywhere. Blocks the event loop while it writes. |
| `node --heapsnapshot-signal=SIGUSR2 app.js`, then send that signal | Linux and macOS only. On Windows Node refuses to start: `ERR_UNKNOWN_SIGNAL: Unknown signal: SIGUSR2`. |
| `node --heapsnapshot-near-heap-limit=1 app.js` | Writes a snapshot just before the process runs out of memory (it printed `Wrote snapshot to ...Heap.<date>.<time>.<pid>...heapsnapshot` before the fatal error here). |
| `node --inspect app.js`, then Chrome DevTools, Memory tab, "Take heap snapshot" | Interactive. |

A snapshot pauses the process, and its cost grows with the heap. Our 5 MB snapshots took a few hundred milliseconds each; a big heap takes much longer, and writing the snapshot needs extra memory too, so leave headroom or a container may kill the process while you debug. In production, take it on one instance that is out of the load balancer.

**Step 3: read it.** Open the `.heapsnapshot` file in Chrome DevTools. First the vocabulary:

- **Shallow size:** the memory of the object itself (not what it points to).
- **Retained size:** the memory that would be freed if this object disappeared: itself plus everything that only it keeps alive. A small object can have a huge retained size (an array object that holds 100 MB of rows).
- **Distance:** how many references away from a GC root. A GC root is a starting point that is always alive, such as the global object or a variable on the stack; everything the GC can reach from the roots is kept.
- **Retainers:** the chain of references that keeps an object alive. This is the answer to "why is this still here?". You follow it up to the root and find the global, cache or listener list at the top.
- **Summary** view groups objects by constructor (class). **Comparison** view shows what changed between two snapshots.
- **Containment** view shows the object tree from the roots.

How to open one: in DevTools open the **Memory** panel and use its "Load" button for a `.heapsnapshot` file (or take a snapshot of a live process, section 6.4). Pick a view in the drop-down, click an object, and read the **Retainers** panel at the bottom. Panel and button names change a little between Chrome versions.

### The three-snapshot technique

Comparing two snapshots is noisy: some objects were just created and are about to die. The trick is to use three:

1. Warm up the app, then take **snapshot 1**.
2. Do the suspicious work (send 100 requests). Take **snapshot 2**.
3. Do the same work again. Take **snapshot 3**.
4. In snapshot 3, show the objects that were allocated between snapshot 1 and snapshot 2. In DevTools use the drop-down above the table in the Summary view ("Objects allocated between Snapshot 1 and Snapshot 2").

Objects created during the first round that are STILL alive after the second round were not temporary. They are the leak candidates.

DevTools does this with buttons. The example does the same in code, so you can see how it works: a heap snapshot is plain JSON, and object ids are stable between snapshots of the same process. The program has a leak (`sessions` is a `Map` that nothing cleans) and a lookalike that is not a leak (`lastReports` is replaced every round):

```text
wrote 3 snapshots in 983 ms; size of one file: 4.9 MB
nodes in snapshot 3: 58942 | edges: 256467

instances per snapshot (1, 2, 3):
  Session  10 110 210
  Report   10 100 100

alive in snapshot 3 but created between snapshot 1 and 2 (the biggest groups):
   100 x array (object elements)     41600 bytes (shallow)
   100 x object Session              4000 bytes (shallow)
   100 x object Array                3200 bytes (shallow)

shortest path from the roots to one leaked Session:
  (a GC root) -> global
  appState -> Object
  sessions -> Map
  table -> (internal table)
  162 -> Session
```

Read it like this. `Session` grows by 100 every round (10, 110, 210): a leak. `Report` stays at 100: not a leak. The suspect list in the middle contains only the session data (a `Report` created in round 2 was already gone in snapshot 3). The last block is the "Retainers" view: `global.appState.sessions` is a `Map`, and its internal `table` holds every session. The fix is a bounded or expiring map.

> **Interview tip:** the question "How would you debug a memory leak in production?" has a clear answer: confirm with metrics, reproduce under load if you can, take snapshots (three-snapshot technique) on one instance, follow the retainers to the owner, fix, and check that the floor stops rising. Mention the cost of snapshots.

Other tools, **not part of Node** (labelled, install separately): `clinic doctor` and `clinic heapprofiler` from the Clinic.js suite, and `memlab`. A built-in, cheaper option is `node --heap-prof`: a sampling profile of where memory is allocated (not of what is alive now), written as a `.heapprofile` file when the process exits (the `--heap-prof` flags are stable since Node 22.4 and 20.16; the default sampling interval is 512 KiB).

```bash
# Needs: npm install -g clinic
clinic doctor -- node server.js
```

---

## 6. CPU profiling

Example: `examples/06-cpu-profiling.js` (with helpers `_cpu-workload.js` and `_profile-utils.js`).

A CPU **profiler** answers "which functions use the CPU time?". It does this by **sampling**: about every millisecond it looks at the call stack and counts which function is on top. After thousands of samples the picture is statistically correct, with low overhead. (The interval you ask for is a request; on this Windows machine we got fewer samples than asked.)

Two vocabulary words you need:

- **Self time:** time spent in the function itself.
- **Total time:** self time plus the time of everything it called.

### 6.1 `--cpu-prof`

```bash
node --cpu-prof --cpu-prof-dir=profiles app.js
```

When the program exits, Node writes `profiles/CPU.<date>.<time>.<pid>.0.001.cpuprofile`. Other flags: `--cpu-prof-name` and `--cpu-prof-interval` (microseconds, default 1000). It also works through `NODE_OPTIONS`. The example runs a small workload with the flag, reads the file (it is JSON) and prints the functions with the most self time:

```text
--- 1. node --cpu-prof (program output follows)
   | primes below 800000: 63951
   | checksum of 150000 ids: 594452382

file written: CPU.<date>.<time>.<pid>.0.001.cpuprofile
keys in the file: nodes, startTime, endTime, samples, timeDeltas
call tree nodes: 48 | samples taken: 109

functions with the most SELF time (time with that function on top of the stack):
     648 ms  68%  countPrimes _cpu-workload.js:11
     229 ms  24%  (program)
      28 ms   3%  (garbage collector)
      18 ms   2%  makeIds _cpu-workload.js:19
      16 ms   2%  checksum _cpu-workload.js:25
(open the file in Chrome DevTools or VS Code to see the same data as a flame graph)
```

About two thirds of the time is in `countPrimes` (the small `isPrime` does not show up on its own, most likely because the optimizer copied its code into `countPrimes`, which is called inlining). That is where to look first. `(garbage collector)` is the GC and `(program)` is native work that has no JavaScript name, such as starting Node itself. This program is short, so the exact split changes from run to run (the PC was busy when this output was captured); the winner, `countPrimes`, does not change.

To see it as a picture, open the `.cpuprofile` file in Chrome DevTools (Performance panel, "Load profile"; older versions have a separate "JavaScript Profiler" panel), in VS Code (it opens the file with a built-in viewer), or in the web app speedscope.

### 6.2 `--prof` and `--prof-process`

This is the older V8 tick profiler. It writes a raw log (`isolate-<address>-<pid>-v8.log`) in the current folder. A second command turns the log into text:

```bash
node --prof app.js
node --prof-process isolate-*.log
```

(PowerShell does not expand `*` for programs such as node, and fails with `Cannot access log file: isolate*.log`. In PowerShell pass the real file name, or loop: `Get-ChildItem isolate*.log | ForEach-Object { node --prof-process $_.Name }`.) The report has sections `[JavaScript]`, `[C++]`, `[Summary]` and `[Bottom up (heavy) profile]`. The example prints two of the tables:

```text
--- 2. node --prof
log written: isolate-<address>-<pid>-v8.log | program exit code: 0
 [JavaScript]:
   ticks  total  nonlib   name
     30   56.6%   88.2%  JS: *countPrimes _cpu-workload.js:11:21
      1    1.9%    2.9%  JS: ^checksum _cpu-workload.js:25:18
      1    1.9%    2.9%  JS: +countPrimes _cpu-workload.js:11:21
      1    1.9%    2.9%  Builtin: ArrayPrototypePush
      1    1.9%    2.9%  Builtin: ArrayIteratorPrototypeNext

 [Summary]:
   ticks  total  nonlib   name
     34   64.2%  100.0%  JavaScript
      0    0.0%    0.0%  C++
      2    3.8%    5.9%  GC
     19   35.8%          Shared libraries
```

`ticks` are samples. `total` is the share of all samples; `nonlib` is the share without the shared libraries. The sign before a name tells which compiler made the code that was running. V8 compiles a hot function in steps, called **tiers**, from cheap and slow code to expensive and fast code:

| Sign | Tier | What it is |
|---|---|---|
| `~` | Ignition | The interpreter: starts at once, runs slowly |
| `^` | Sparkplug | A very quick baseline compiler: almost no compile time, somewhat faster code |
| `+` | Maglev | The mid-tier optimizing compiler (enabled since Node 22) |
| `*` | TurboFan | The top optimizing compiler: slow to compile, fastest code |

(The signs come from the V8 tool that prints this report, `tools/profile.mjs` in the V8 source, not from an experiment.) The same function can appear several times, once for each tier it went through: above, `countPrimes` shows as `+` and as `*`. The counts are tiny and change on every run. Use `--cpu-prof` for new work; you will meet `--prof` in older guides and tickets.

> **Common mistake:** profiling with a toy input. A profile of a function with 10 items says nothing about 100000 items. Profile with realistic data, and in a normal (optimized) run.

> **Interview tip:** "How do you find out why a Node service uses too much CPU?" Take a CPU profile of the running service under realistic load (`--cpu-prof` from process start, or the inspector on one instance). Read the widest boxes that have nothing on top of them, fix the biggest one, and profile again. Mention that you profile a production-like build with real data, and that profiling itself adds a little overhead.

### 6.3 Reading a flame graph

A **flame graph** draws the call tree as boxes. The rules:

- Each box is a function. The box below it is its caller; the boxes on top of it are what it called.
- **The width is time** (the share of the samples that had this function in their stack). The left to right order means nothing (boxes are often sorted by name).
- Look for **wide boxes with nothing on top of them**. A wide box that is completely covered by boxes on top of it only passes the time up to its children; the boxes on top are where the time is spent.

```text
 |-------------- formatMoney (57%) ---------|---- findCustomer (27%) ----|    |   <- top: the functions that ran
 |------------------------ buildReportV1 (100%) ----------------------------|   <- bottom: their caller
```

This picture is the same data as the text tree that example 07 prints (next section). Tools that draw it for you, **not part of Node** (install separately and check that they are maintained today): Clinic.js (`clinic flame`), `0x`, and speedscope as a viewer.

```bash
# Needs: npm install -g clinic
clinic flame -- node server.js
# Needs: npm install -g 0x
0x server.js
```

> **Common mistake:** starting the profiler late. On Node 24.16, an in-process profile (`node:inspector`) that was started after a function had already run many times blamed the wrong function: all the time went to the caller. Starting the profile before the code first runs, or using `--cpu-prof` from process start, gave correct results, and so did `node --no-maglev` (Maglev is V8's mid-tier optimizing compiler). The cause was not investigated; a possible reason is that code compiled before the profiler started is not mapped to its function names. When a profile looks strange, restart the process with `--cpu-prof`.

### 6.4 Profiling a running process with Chrome DevTools

Chrome DevTools can connect to a Node process and take CPU profiles and heap snapshots live. The steps (shown with an illustrative `server.js`):

1. Start the process with the inspector: `node --inspect server.js`. Node prints `Debugger listening on ws://127.0.0.1:9229/...`. (`--inspect-brk` also pauses on the first line.)
2. In Chrome open `chrome://inspect` (Edge: `edge://inspect`). Under "Remote Target" click "inspect" below your script. A DevTools window opens, connected to your process. If the target is not listed, click "Configure..." and add `localhost:9229`.
3. For a CPU profile use the panel that records one (called **Profiler** or "JavaScript Profiler" in some versions; the **Performance** panel in others, where you can also load a `.cpuprofile` file). Click record, send some load to the server, stop, and read the flame graph.
4. For a heap snapshot use the **Memory** panel, choose "Heap snapshot" and click "Take snapshot" (section 5).

Names of panels and buttons differ between Chrome versions, so look for the equivalent. The sampling and the files are the same ones that `--cpu-prof` and `v8.writeHeapSnapshot()` produce.

> **Common mistake:** exposing the inspector. `--inspect` opens a debugging port, and whoever can connect can run any code inside your process. The default `127.0.0.1` is safe; `--inspect=0.0.0.0:9229` is not. Reach a remote machine through an SSH tunnel instead. On Linux and macOS you can also start the inspector in a process that is already running by sending it `SIGUSR1` (documented in the Node debugging guide, not run here; SIGUSR1 does not exist on Windows).

---

## 7. A worked example: from flame graph to fix

Example: `examples/07-flame-graph-worked.js`. It builds a CSV report for 2000 orders and 8000 customers. The code looks innocent:

```js
function findCustomer(id) {
  return customers.find((c) => c.id === id);          // searches the list every time
}
function formatMoney(cents) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
}
function buildReportV1() {
  const lines = [];
  for (const order of orders) {
    const customer = findCustomer(order.customerId);
    lines.push(`${order.id},${customer.name},${formatMoney(order.cents)}`);
  }
  return lines.join('\n');
}
```

The example profiles it through `node:inspector` (the same profiler as `--cpu-prof`) and prints the call tree. **Round 1:**

```text
report for 2000 orders and 8000 customers

ROUND 1: profile of version 1
 call tree (percent of the whole call; "self" = time spent in that function itself):
  100% total  15% self  buildReportV1 07-flame-graph-worked.js:18
   57% total  57% self    formatMoney 07-flame-graph-worked.js:15
   27% total  21% self    findCustomer 07-flame-graph-worked.js:12
    6% total   6% self      (anonymous) 07-flame-graph-worked.js:13
 top self time:
     136 ms  56%  formatMoney 07-flame-graph-worked.js:15
      51 ms  21%  findCustomer 07-flame-graph-worked.js:12
      35 ms  14%  buildReportV1 07-flame-graph-worked.js:18
      16 ms   7%  (anonymous) 07-flame-graph-worked.js:13
```

Reading: 57% of the time is `formatMoney` itself. It creates a new `Intl.NumberFormat` (an expensive object) for every line. Nobody would find that by reading the code, and `findCustomer` (the "obvious" suspect) is only 27% in total (its `find` callback is the small `(anonymous)` box under it). Fix 1: create the formatter once. **Round 2:**

```text
ROUND 2: profile of version 2 (formatter created once)
 call tree (percent of the whole call; "self" = time spent in that function itself):
  100% total  22% self  buildReportV2 07-flame-graph-worked.js:29
   78% total  66% self    findCustomer 07-flame-graph-worked.js:12
   12% total  12% self      (anonymous) 07-flame-graph-worked.js:13
 top self time:
      47 ms  63%  findCustomer 07-flame-graph-worked.js:12
      16 ms  21%  buildReportV2 07-flame-graph-worked.js:29
       9 ms  11%  (anonymous) 07-flame-graph-worked.js:13
       1 ms   2%  (garbage collector)
```

The old second place is now first: 78% of the time is in `findCustomer` and the callback it runs, which walks up to 8000 customers per order (on average 4000, for each of 2000 orders). (In some runs a line `post node:inspector` also appears: it is the profiler's own overhead.) Fix 2: a `Map` from id to customer. **Round 3** profiles 100 calls of version 3, because one call is now too short to sample well:

```text
ROUND 3: profile of 100 calls of version 3 (Map lookup)
 call tree (percent of the whole call; "self" = time spent in that function itself):
  100% total   4% self  hundredCallsOfV3 07-flame-graph-worked.js:91
   96% total  96% self    buildReportV3 07-flame-graph-worked.js:40
 top self time:
     242 ms  91%  buildReportV3 07-flame-graph-worked.js:40
      11 ms   4%  hundredCallsOfV3 07-flame-graph-worked.js:91
       9 ms   3%  (garbage collector)
       3 ms   1%  post node:inspector:115
```

The profile is now flat: all the time is in the function that builds the strings and formats the numbers, which is the real work. Time to stop. The measured result, with the profiler off:

```text
median time of one call, profiler off:
  version 1 (formatter in the loop, array search):   207.6 ms
  version 2 (formatter created once):                 12.5 ms   17x faster than v1
  version 3 (and a Map for the lookup):                3.4 ms   61x faster than v1

all three versions return exactly the same report: true (2000 lines)
```

(The run-to-run noise on this PC is large: other runs gave version 2 as 10x to 18x and version 3 as 47x to 88x faster than version 1. The jumps are far bigger than the noise.)

(Round 2 is the fragile one. `findCustomer` has already run thousands of times in round 1, which is the situation of the "starting the profiler late" warning at the end of section 6.3. In most runs the tree looks like the one above; in a rare run, usually when the PC is busy, part of the time is charged to `buildReportV2` itself. The widest box is still the lookup, so the lesson is the same.)

The method to remember: profile, fix the widest box, profile again, stop when the graph is flat or the goal is reached. And always check that the output is still the same.

> **Interview tip:** this is the story to tell when asked "describe a performance problem you solved". Name the measurement, the surprise (the real cost was not where the code looked slow), the fix and the before and after numbers.

---

## 8. Event loop lag

Example: `examples/08-event-loop-lag.js`.

Everyone shares one event loop (lesson 08). If one callback runs for 300 ms, every other request waits 300 ms. This waiting is called **event loop lag** or delay, and it is one of the best health numbers of a Node service.

`perf_hooks.monitorEventLoopDelay()` measures it like a heartbeat: a timer asks to run every `resolution` ms, and Node records the real time between two beats in a histogram (values in nanoseconds).

```js
const { monitorEventLoopDelay } = require('node:perf_hooks');
const histogram = monitorEventLoopDelay({ resolution: 10 });
histogram.enable();
// ... later:
console.log(histogram.percentile(99) / 1e6, 'ms p99;', histogram.max / 1e6, 'ms max');
histogram.disable();
```

An idle loop does not show 0. It shows about the `resolution` (here 16 ms for a 10 ms heartbeat, because Windows timers are coarse). Compare with the idle baseline. `performance.eventLoopUtilization()` gives a second view: the share of time (0 to 1) the loop was busy instead of waiting.

The example measures five situations, each with about 300 ms of work:

```text
1. idle (just waiting)             work  310 ms | gap between beats: p50   16 p99   24 max   24 | loop busy   1%
2. busy loop, 300 ms               work  317 ms | gap between beats: p50   16 p99  317 max  317 | loop busy  95%
3. crypto.pbkdf2Sync               work  245 ms | gap between beats: p50   16 p99  245 max  245 | loop busy  94%
4. crypto.pbkdf2 (async)           work  271 ms | gap between beats: p50   16 p99   39 max   39 | loop busy   9%
5. busy loop in a worker thread    work  368 ms | gap between beats: p50   16 p99   20 max   20 | loop busy   2%

longest gap while the work ran on the main thread (rows 2 and 3): 317 and 245 ms
longest gap when the work was moved off the main thread (rows 4 and 5): 39 and 20 ms
longest gap when idle (the noise level of this machine): 24 ms
blocking made the gap at least 4 times bigger than idle: true
```

Rows 2 and 3 block the loop: one heartbeat gap equals the whole job (317 ms, 245 ms), and the loop was 95% busy. Row 4 does the same hashing, but with the asynchronous `crypto.pbkdf2`, which runs in the thread pool of libuv (the C library under Node that does the I/O; the pool has 4 threads by default), so the loop stayed free. Row 5 does the work in a worker thread (lesson 18). The exact numbers depend on the run; the contrast is the lesson.

What blocks the loop, and the usual fix:

| Blocker | Fix |
|---|---|
| A long loop or heavy computation | Move it to a worker thread, or another service, or split it into chunks and yield with `setImmediate` |
| `...Sync` APIs (`readFileSync`, `pbkdf2Sync`, `zlib.gzipSync`) in a request path | Use the async versions (they run in the thread pool). Sync is fine at startup. |
| `JSON.parse` / `JSON.stringify` of a huge object | Smaller payloads, pagination, streaming parsers |
| A regular expression with catastrophic backtracking (section 11.8) | Rewrite it, limit the input length |
| A huge `.sort()` or `.map()` on millions of items | Chunk it, or do it in the database |

### Slow without lag: a full thread pool

Not every slow call comes from a blocked loop. Node runs some work on a **thread pool**: a fixed group of helper threads inside libuv (the C library under Node). `fs` calls, `dns.lookup`, `crypto.pbkdf2` and `scrypt`, and `zlib` all use it, and it has **4 threads by default**. If 8 such jobs start at once, 4 run and 4 wait for a free thread. The event loop stays free, so `monitorEventLoopDelay` shows nothing wrong, but those calls are slow.

Example 08, part 6, starts 8 hashes at the same moment in a child process and prints the finish time of each (in ms), with a pool of 1, 4 (the default) and 8 threads:

```text
6. thread pool: 8 async pbkdf2 jobs started at the same moment (finish time of each, in ms)
  UV_THREADPOOL_SIZE=1       162 310 452 612 736 863 965 1072
  default pool (4 threads)   136 142 146 178 247 261 272 277
  UV_THREADPOOL_SIZE=8       140 140 145 150 166 172 175 181
  (1 thread: one job after the other. 4 threads: two waves, the second wave waits for a free thread.
   8 threads: one wave, if the machine has enough free CPU cores. On a busy machine the waves blur.)
```

With 1 thread the jobs finish one after the other. With 4 they finish in waves: the later jobs waited for a thread. With 8 they almost all finish together. The pool size is set with the environment variable `UV_THREADPOOL_SIZE` before the process starts (changing it later from inside your code is not guaranteed to work).

> **Common mistake:** raising `UV_THREADPOOL_SIZE` to a huge number "to be safe". More threads only help when there are free CPU cores, or when the jobs mostly wait (for a slow disk, for example). For CPU-heavy jobs the threads just fight for the same cores and use more memory.

> **Interview tip:** "How do you know the event loop is blocked in production?" Export `monitorEventLoopDelay` percentiles and `eventLoopUtilization` as metrics, alert when p99 is well above your budget (many teams start around 100 ms), and then profile (section 6) to find the blocker.

---

## 9. Benchmarking correctly

Example: `examples/09-benchmark-right.js`.

A **benchmark** compares speeds. It is easy to write one that gives a confident wrong answer.

**Clocks.** `performance.now()` is the right tool: milliseconds with fractions, from a monotonic clock (it never jumps backwards). `process.hrtime.bigint()` gives nanoseconds. Do not use `Date.now()` for short measurements: it is the wall clock, which can change and has 1 ms steps.

**The traps** the example shows, one by one:

1. **No warm-up.** V8 first runs your function in a slow interpreter and optimizes it later when it is hot (the **JIT**, just-in-time compiler; its steps, called tiers, are listed in section 6.2). The first run is the slowest.
2. **One number.** A single run is luck. Run several rounds, then report the median and the spread.
3. **Dead code.** If the result of the work is never used, the optimizer may delete the work.
4. **Changing types.** If the input type changes, optimized code is thrown away and rebuilt (a "deoptimization").
5. **Noise.** Other programs, power saving and GC all change timings. Repeat the test at another time.
6. **The wrong question.** A micro-benchmark answers a narrow question. Confirm with a measurement of the whole request.

```text
--- 1. the same work, 10 rounds in a row (ms per round)
  27.7  2.5  4.8  2.1  2.2  2.6  4.1  3.3  5.5  2.4
  round 1 is the slowest: V8 first runs the code in a slow interpreter and optimizes it later.
```

Round 1 is many times slower than the best rounds (the other rounds jump between 2 and 5 ms: that is noise). The helper in the example (`bench`) throws away a warm-up, runs 15 rounds, and reports the median, the fastest and the slowest:

```js
function bench(name, fn, { rounds = 15, iterations = 20_000 } = {}) {
  for (let i = 0; i < iterations; i++) fn(i); // warm-up
  const perOp = [];
  for (let r = 0; r < rounds; r++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn(i);
    perOp.push(((performance.now() - start) * 1e6) / iterations); // nanoseconds per call
  }
  perOp.sort((a, b) => a - b);
  // ... print perOp[Math.floor(rounds / 2)] as the median
}
```

```text
--- 2. is "is this id in the list?" faster with an Array or a Set? (1000 ids)
  Array.includes             median   2332 ns/op   (fastest 1461, slowest 4685)
  Set.has                    median     41 ns/op   (fastest 32, slowest 176)
  Set.has is about 57x faster here (found 32000 ids so the loops were not skipped)

--- 3. the dead-code trap (3 million calls of Math.sqrt)
  result unused: 1.7 ms | result used: 6.8 ms
  the first number is not "fast code", it is "no code".

--- 4. built-in timing tools
  timerify: sumOfSquares(1000000) took 8.88 ms
  timerify: sumOfSquares(1000000) took 0.94 ms
  timerify: sumOfSquares(1000000) took 0.92 ms
  mark/measure: "sumOfSquares(5 million)" took 4.86 ms
```

Part 2 is a real, useful result: the lookup of an id in a list is a different class of cost from a lookup in a `Set`. Part 3: the loop without a used result "ran" 4 times faster, but only because the optimizer removed the call. Part 4 shows the built-in tools. `performance.timerify(fn)` wraps a function so that each call is recorded as an entry for a `PerformanceObserver` (entry type `'function'`), and `performance.mark()` plus `performance.measure()` time a section by name. Notice that the first call took 8.88 ms and the next ones 0.94 and 0.92 ms for identical work. The warm-up used small numbers; here the sum no longer fits V8's small-integer type, so the optimized code was thrown away and built again. You can see it with `node --trace-deopt`, which prints a line such as `bailout (kind: deopt-eager, reason: overflow)` for `sumOfSquares`.

> **Remember:** benchmark libraries (labelled, **not part of Node**: `tinybench`, `mitata`) do the warm-up, rounds and statistics for you. They do not remove the other traps.

> **Interview tip:** "Is approach A faster than approach B?" The strong answer is "I would measure it": warm-up, several rounds, the median, a used result, realistic input sizes. Then add that a micro-benchmark only proves that one small operation is faster; the change matters only if a profile of the whole request shows that the operation is a big share of the time.

---

## 10. Load testing

Example: `examples/10-load-test.js`.

A **load test** sends many requests at your server and measures throughput, latency percentiles and errors. Ready-made tools (labelled, **not part of Node**):

```bash
# Needs: npm install -g autocannon
autocannon -c 100 -d 20 http://localhost:3000/
```

`autocannon` is a Node-based tool; `-c` is the number of connections and `-d` the duration in seconds. It prints a latency table (including the 99th percentile) and requests per second. `wrk` is a C tool with the same idea (`wrk -t4 -c100 -d30s --latency http://localhost:3000/`), for Linux and macOS (on Windows use WSL). `k6` and Artillery are also popular. You can also write a small load test yourself with the global `fetch`, which shows how the numbers come about.

The example starts a server in a worker thread (so it has its own event loop and the test client does not slow it down) with two routes: `/io` waits 30 ms (like a database call) and `/cpu` computes for 5 ms on the event loop. The client runs 1, 10 and 40 "users" who each send a request, wait for the answer, and send the next.

```js
async function loadTest(url, { concurrency, total }) {
  const latencies = [];
  let started = 0;
  async function lane() {                       // one "user"
    while (started < total) {
      started++;
      const start = performance.now();
      const res = await fetch(url);
      await res.text();                          // read the body, or the connection is not freed
      latencies.push(performance.now() - start);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, lane));
  // ... sort latencies and read the percentiles
}
```

```text
route   users  requests/s   p50 ms   p95 ms   p99 ms   | in flight = requests/s x avg seconds
/io         1          29       32       47       47   |   1.0 
/io        10         234       46       51       56   |   9.9 
/io        40         630       53       91      101   |  37.7 
/cpu        1         157        6        7        7   |   1.0 
/cpu       10         173       58       61       61   |   9.6 
/cpu       40         160      225      295      297   |  35.7 
```

This table is the central picture of Node performance.

- **`/io` (waiting):** more users means much more throughput (29, 234, 630 requests/s) while the latency stays in the same range (the p50 is 32, 46 and 53 ms). The event loop is free while requests wait, so it serves all of them in parallel.
- **`/cpu` (computing):** throughput does not grow (157, 173, 160 requests/s), and latency grows with the number of users (the p50 is 6, 58 and 225 ms). The CPU is the bottleneck, so extra users just stand in a queue.

The last column checks Little's law: requests per second times the average seconds is the number of requests in flight, and it is close to the number of users (1, 10 and 40). It is a bit lower for 40 users because a short test spends part of its time starting and finishing. In this "closed" test every user always has one request outstanding, so the match is expected; the law is a useful sanity check of your measurement and a sizing tool in design.

Load test rules:

- Warm up first (the example sends a few requests before measuring).
- Use many requests for a percentile. This demo uses 10 to 200 requests per row, so its p99 is just the slowest one or two. A real test uses thousands.
- The client must not be the bottleneck. Run it in another process or machine. Watch the client CPU too.
- **Coordinated omission:** in a closed test like this one, when the server stalls, the users also wait and stop sending, so the stall is hidden and your percentiles look better than reality. Tools that send at a fixed arrival rate (for example `wrk2`, or k6 with an arrival-rate executor) avoid this.
- Test with production-like data, hardware and settings, and watch the server's CPU, memory and event loop lag during the test.

> **Interview tip:** "How do you load test a service, and what do you look at?" Say: realistic data and traffic mix, a warm-up, a client that is not the bottleneck, and load that rises step by step. Watch latency percentiles (not the average), errors, and on the server the CPU, event loop lag and memory. Find the point where latency starts to climb sharply: that is your capacity. Fix the bottleneck and test again.

---

## 11. Optimization tactics that actually matter

Examples: `examples/11-tactics-io.js` and `examples/12-tactics-v8.js`.

In rough order of how much they help in real Node services (the first ones are about waiting less and doing less work; the CPU-level ones come last):

| Tactic | Why it helps |
|---|---|
| Do not block the event loop | One slow callback delays everybody (section 8) |
| Fix slow queries first: indexes, `EXPLAIN`, fewer columns | Many "slow Node" problems are slow databases; Node is only waiting |
| Do less work: pagination, field selection, `limit` | The fastest work is work you do not do |
| Batch calls, avoid N+1 | One call for 50 items instead of 50 calls |
| Reuse connections (keep-alive, pools) | Opening a connection is slow |
| Cache the right things, with a limit and a lifetime | Skip repeated work (section 4.1 for the rules) |
| Stream big data | Flat memory, first bytes sooner |
| Compress with care | Saves bandwidth, costs CPU |
| Use worker threads (or another service) for CPU work | Keeps the loop free |
| Avoid sync APIs in request paths | They block the loop |
| Log less in hot paths | Formatting and writing every line costs CPU, and a write to a terminal or a file can block |
| Write V8-friendly code in hot paths | Smaller effects, only where a profile points |

### 11.1 N+1, batching and the DataLoader idea

The **N+1 problem**: one query to get 50 posts, then 50 more queries to get each author. The example uses a pretend database (each query takes about 10 ms, only 5 queries run at the same time, like a connection pool):

```text
--- 1. 50 posts, each needs its author (5 different authors)
  N+1, one after the other       queries: 50   time:  795 ms   post 7 author: Cy
  N+1, all at once (pool of 5)   queries: 50   time:  157 ms   post 7 author: Cy
  one query for all authors      queries:  1   time:   16 ms   post 7 author: Cy
  DataLoader idea (automatic)    queries:  1   time:   16 ms   post 7 author: Cy
```

Sending the 50 queries at once helps, but the pool of 5 still makes them queue, and a real database now sees 50 queries per request. The real fix is one query (`WHERE id IN (...)`).

The **DataLoader idea** gets that batching automatically. Every `loader.load(key)` call in the same tick only collects the key and returns a promise. When the current code finishes (`process.nextTick`), the loader calls your batch function once with all keys, then hands each caller its own result. A per-request cache means the same key twice causes one lookup. The example has a 25-line `MiniLoader`. In real code use the `dataloader` package (labelled: **not part of Node**; `npm install dataloader`) or the batching built into your ORM or GraphQL server. Create one loader per request, so that one user's cached data is never shown to another.

### 11.2 Connection reuse: keep-alive and pools

Opening a TCP connection costs a round trip (and a TLS handshake for HTTPS). With **keep-alive** the connection is kept open and reused. The example sends 100 requests one after the other:

```text
--- 2. 100 requests one after the other to a local server
  new connection every time      261 ms   TCP connections opened: 100
  connections reused              71 ms   TCP connections opened: 1
```

Since Node 19, `http.globalAgent` and `https.globalAgent` have `keepAlive: true`. But `new http.Agent()` has `keepAlive: false` unless you ask for it, so a custom agent is a classic hidden cost. Databases work the same way with a **connection pool**: keep a fixed number of connections and share them. Do not make the pool huge: a database that gets 500 simultaneous queries can be slower than one that gets 20.

On the server side, Node closes an idle keep-alive connection after `server.keepAliveTimeout` (5000 ms by default). If a load balancer in front of Node keeps idle connections for longer and reuses one at the moment Node closes it, the client sees an occasional `502`. The usual fix is to set `server.keepAliveTimeout` higher than the idle timeout of the balancer.

### 11.3 Compression costs CPU

```text
--- 3. compressing a 110 KB JSON response (time for ONE response, on the main thread)
  no compression               111421 bytes
  gzip level 1                  12004 bytes       1.0 ms
  gzip level 6 (default)        11616 bytes       1.0 ms
  gzip level 9                  11557 bytes       3.5 ms
  brotli quality 4               3805 bytes       2.2 ms
  brotli quality 11 (default)    5091 bytes     188.3 ms
```

Compression shrinks JSON by about 10 times (and 30 times with brotli here), a big win for slow networks. But it costs CPU: gzip level 9 costs about 3 times level 1 for a tiny gain, and brotli at its default quality 11 took 188 ms for one 110 KB response, while quality 4 took 2.2 ms (other runs of the same code gave anything from 184 ms to over 2 seconds for quality 11 while this PC was busy). (For this repetitive test data quality 11 was not even smaller; sizes depend on the data.) Brotli quality 11 is meant for files compressed once, ahead of time. Rules: use level 4-6 for gzip or brotli quality 4-5 per request, use the async zlib functions (they run in the thread pool) and not `...Sync` in a request path, and compress at the reverse proxy or CDN when you can.

### 11.4 Streams keep memory flat

The example counts the lines of a 12 MB file in two ways, each in its own child process, and reports the peak memory (`process.resourceUsage().maxRSS`):

```text
--- 4. counting the lines of a 12 MB file: read it all, or stream it? (peak memory of a child process)
  an empty program (baseline)        lines:       0   peak memory:   65 MB
  readFile, whole file in memory     lines:  500000   peak memory:   92 MB
  createReadStream, chunk by chunk   lines:  500000   peak memory:   74 MB
```

Reading the whole file costs about 27 MB over the baseline for a 12 MB file (the bytes plus the string). Streaming costs far less, and that number does not grow with the file size. With a 5 GB file, `readFile` cannot hold the data (you get an error or run out of memory) and a stream still works (lesson 11). Streams stay flat because of **backpressure**: a fast reader waits when the writer is slow. Use `stream.pipeline()` so that the waiting, the errors and the cleanup are handled for you.

### 11.5 Caching

A cache removes repeated work. Three rules: **bound it** (size and lifetime, section 4.1), **know how it is invalidated**, and **protect against a stampede** (when an entry expires and 1000 requests all recompute it at once; the fix is to share one in-flight promise per key). You build exactly this in Task 3. For several processes or servers use a shared cache such as Redis, and HTTP caching (`Cache-Control`, `ETag`) so that clients and CDNs do not ask at all.

### 11.6 Pagination: send a page, not the table

An endpoint that returns "all orders" works with 100 rows and breaks with 1,000,000: the database reads them all, Node builds a huge array, `JSON.stringify` blocks the loop (section 11.8 shows the cost), and the client waits for megabytes. **Pagination** means returning the data in small pages. Example 11, part 5, shows the size difference and a classic trap of the simple method:

```text
--- 5. pagination
  whole table as JSON: 3201 KB | one page of 20 rows: 523 bytes
  page 1 (both styles):           50 49 48 47 46 45 44 43 42 41
  page 2 with OFFSET 10:          41 40 39 38 37 36 35 34 33 32  <- 41 again: a duplicate
  page 2 with "id < 41" (keyset): 40 39 38 37 36 35 34 33 32 31  <- no duplicate, no gap
```

The list is shown newest first. After the user looked at page 1, a new item (id 51) was added. With the offset method, "skip 10 items" now skips the wrong ones, so item 41 shows up twice. The two ways to ask for page 2:

| Style | The SQL idea | Good | Bad |
|---|---|---|---|
| Offset | `ORDER BY id DESC LIMIT 10 OFFSET 10` | Simple; you can jump to page 50 | The database must walk past every skipped row, so deep pages get slower. Items repeat or vanish when data changes while the user pages (the duplicate above) |
| Keyset (also called cursor) | `WHERE id < :lastSeenId ORDER BY id DESC LIMIT 10` | Fast on any page when `id` has an index; stable when data changes | No jumping to page 50; the sort column must be unique (add the id as a tie-breaker) |

The API returns the items plus a `nextCursor` (the last id, often encoded as an opaque string) and the client sends it back to get the next page. Also put a maximum on `limit` on the server (for example 100), or one client can still ask for everything. Be careful with "total number of pages": `COUNT(*)` over a big table is itself slow, so many APIs only say whether there is a next page.

> **Interview tip:** "How do you paginate a large table?" Offset is fine for small tables and admin screens. For feeds and big tables use keyset (cursor) pagination, because it stays fast on deep pages and does not repeat items. Mention the maximum page size and the cost of counting.

### 11.7 CPU-heavy work: worker threads

If a request needs real computation (resizing an image, parsing a big file, building a report), doing it on the main thread freezes every other request (section 8). The options, from the simplest to the heaviest:

1. **Make it cheaper.** A better algorithm or a cache. Section 7 gained about 60 times this way, with no threads at all.
2. **Chunk it.** Split the loop and `await` a `setImmediate` between chunks (Task 2 below). Good for work that takes up to about a second and cannot move.
3. **Use the async version of a built-in.** `crypto.pbkdf2`, `zlib` and `fs` calls run in the thread pool (section 8), so you only need to avoid the `...Sync` version.
4. **A worker thread.** A separate thread with its own event loop and its own V8 heap, running in parallel with the main thread. Example 08, row 5, does this in a few lines:

   ```js
   const { Worker } = require('node:worker_threads');
   const w = new Worker('const end = Date.now() + 300; while (Date.now() < end);', { eval: true });
   w.on('exit', () => console.log('worker finished; the main thread was never blocked'));
   ```

   In the table of section 8 the worst loop gap stayed at 20 ms with this worker, against 317 ms when the same busy loop ran on the main thread.
5. **Another process or service** (a job queue with separate worker processes). Use it when the work is big, must survive restarts, or should scale on its own.

What to know about workers:

- Starting a worker is not free (it gets its own copy of the engine, called an isolate, with its own heap and event loop): an empty worker took 55 to 90 ms on the busy PC used here. Create a **pool** of workers at startup and reuse them (the npm package `piscina` does this; **not part of Node**). Lesson 18 shows how.
- Data sent between threads is copied (structured clone), unless you transfer an `ArrayBuffer` or share a `SharedArrayBuffer`. Sending a huge object can cost more than the work itself.
- Workers help CPU-bound work only. Work that is just waiting (database, network) is already handled well by the main thread.
- `cluster` (lesson 18) is a different tool: it runs several copies of the whole server to use all cores. It does not make one slow request faster.

> **Interview tip:** "How do you handle CPU-heavy work in Node?" Check with a profile that it is really CPU. Then: a cheaper algorithm, the async built-in if one exists, a pool of worker threads, or a separate service with a queue. Mention the cost of copying data to a worker, and that the goal is to keep the event loop free.

### 11.8 Code that V8 likes (hot paths only)

Example 12 uses V8 internals (`%HasFastProperties` and friends, enabled with `--allow-natives-syntax`) so that you can see the engine state. They are for learning, never for production code. The timings are the best of 5 runs.

```bash
node --allow-natives-syntax lessons/19-performance-and-memory/examples/12-tactics-v8.js
```

**Object shapes (hidden classes).** V8 gives each object a hidden "shape" that describes its property names and order, so a property read becomes "take the value at position 2". Objects built in the same order share a shape.

```text
--- 1. object shapes ("hidden classes")
  { x, y } and { x, y }  share one shape:    true
  { x, y } and { y, x }  share one shape:    false (same keys, other order = other shape)
  fast properties before delete:              true
  after  delete o.x:                          false (the object turned into a slow dictionary)
  after  o.x = undefined:                     true
  reading b and c from 100000 objects (15 passes):
  after  o.a = undefined                              7.1 ms
  after  delete o.a                                  79.0 ms
  -> objects that went through delete were read 11x slower
```

So: create objects with the same properties in the same order (a class or a factory function does this), and avoid `delete` on hot objects. Set the property to `undefined` or `null` instead, or use a `Map` for data that really comes and goes. In repeated runs the slowdown after `delete` was between 6 and 13 times.

V8 also gets slower when one place in the code sees many different shapes. One shape is called monomorphic (the fastest), two to four shapes polymorphic, and more than four megamorphic: the property lookup can no longer be cached well. This is the V8 team's rule of thumb. Example 12 does not time it, because the effect was too unstable to show on one PC.

You may read that deleting only the property that was added last is cheap. On Node 24.16, `%HasFastProperties` said the object turned into a slow dictionary in every case tried: object literals, class instances built with `this.x = ...`, and objects built step by step, deleting the first, a middle or the last property. So do not count on it.

**Arrays with holes.** An array kind is "packed" when it has no empty slots, and "holey" if it ever had one. Holey arrays need an extra check on reads, and an array never goes back to packed.

```text
--- 2. arrays with holes
  [1, 2, 3] has holes:                         false
  [1, , 3] has holes:                          true
  new Array(3), then all 3 slots filled:       true (it stays "holey" forever)
  after delete arr[1]:                         true
  summing 500000 numbers (20 passes):
  packed array (built with push)                     11.2 ms
  holey array (built with new Array(n))              19.9 ms
  -> reading the holey array took 1.8x the time. A small effect: do not contort your code for it.
  building an array of 500000 numbers:
  push into []                                       10.9 ms
  new Array(n), then fill every slot                  3.4 ms
```

Do not `delete arr[i]` (use `splice`, or `filter`), and do not create sparse arrays. The read penalty is small and noisy (between 0.9 and 1.9 times in five repeated runs). Note the honest result: pre-sizing with `new Array(n)` and filling every slot was the fastest way to build the array in these runs, even though it gives a holey array. Holey is not "bad"; it only needs one extra check per read.

**Strings.** The old advice "never build strings with `+=`" is out of date:

```text
--- 3. building a big string (100000 lines)
  s += piece (in a loop)                              5.5 ms
  parts.push(piece), then parts.join()               13.7 ms
  -> the old advice "never use += for strings" is out of date: V8 joins the pieces lazily.
```

V8 stores `a + b` as a small tree node ("rope") and flattens it only when needed. Use whichever is clearer. For truly huge output, write to a stream instead of building one string (section 11.4).

**Regular expressions.** A regex with nested repetition can take exponential time on input that almost matches (**ReDoS**, regular expression denial of service). While it runs, the event loop is blocked. In the example, the time climbs steeply with every extra letter:

```text
--- 4. regular expressions
  /^(a+)+$/ on 16 letters a and then b:     1 ms
  /^(a+)+$/ on 18 letters a and then b:     2 ms
  /^(a+)+$/ on 20 letters a and then b:     9 ms
  /^(a+)+$/ on 22 letters a and then b:    49 ms
  /^a+$/    on 22 letters a and then b:  0.09 ms  (same question, no nested repetition)
  regex /\d+\.\d+/ on a short text, 300000 times     19.0 ms
  text.includes(".") the same way, 300000 times       0.5 ms
```

The growth is exponential, so an input of 40 letters would not finish in any reasonable time (this is an extrapolation; the example does not wait for it). Never run an untrusted pattern or an unbounded input through a risky regex. Prefer simple patterns, limit the input length, and use `includes` or `startsWith` for plain text checks (more than 25 times faster in every run).

**JSON.** `JSON.stringify` and `JSON.parse` are synchronous: the event loop stops while they run, and the cost grows with the size of the data.

```text
--- 5. the cost of JSON
  20000 users as JSON: 1.8 MB. The event loop is blocked while this runs:
  JSON.stringify(all 20000 users)                    12.7 ms
  JSON.parse(that text)                              14.7 ms
  hand-written serializer gives the same text: true
  hand-written serializer for this shape             13.6 ms
  JSON.stringify with only 2 fields per user          4.1 ms
  JSON.stringify of one page (20 users)               0.0 ms
```

The idea behind libraries such as `fast-json-stringify` (used by Fastify; labelled: **not part of Node**) is to build a function for one known shape, like `serializeUser` in the example, from a JSON schema. On Node 24 the built-in `JSON.stringify` is already quick: the hand-written version took 13.6 ms against 12.7 ms for the built-in one in the run above. In other runs it was somewhat faster (7.3 ms against 10.0 ms), and once it was much slower. So such a library is not a guaranteed win; measure with your own payloads before you add it. The big wins are in sending less: two fields per user cost about a third of the full objects, and one page of 20 users cost almost nothing (section 11.6). Avoid `JSON.parse(JSON.stringify(x))` as a deep copy on big objects: it pays both costs. `structuredClone` is the built-in deep copy, and not copying at all is better.

> **Interview tip:** "What would you check first in a slow Node API?" Give the ordered list: blocked event loop, N+1 and slow queries, no connection reuse, large payloads, then (only with a profile) CPU hot spots. Interviewers like hearing that micro-optimizations come last.

---

## 12. Production performance checklist

- [ ] **Metrics:** latency p50/p95/p99 per route, error rate, throughput, event loop lag p99, event loop utilization, heap used, `rss`, GC time.
- [ ] **Budgets and alerts:** a target for p99 latency and for memory growth, with alerts.
- [ ] **Timeouts everywhere:** for incoming requests, outgoing `fetch`/database calls (`AbortSignal.timeout`), and queues. Nothing may wait forever (section 4.7).
- [ ] **Bounded everything:** caches, queues, in-memory buffers, request body size, page size (`limit`).
- [ ] **Pool sizes chosen on purpose:** the database pool (size it with Little's law, section 1), the libuv thread pool (`UV_THREADPOOL_SIZE`, section 8) and the worker thread pool (section 11.7).
- [ ] **CPU limit known:** a CPU limit on a container (for example half a core) throttles the whole process, and it shows up as event loop lag and latency spikes even though your code is fine. Check the limit before you chase a "slow code" problem.
- [ ] **Memory limit set on purpose:** `--max-old-space-size` at roughly 70-75% of the container limit (a rule of thumb, confirm by watching `rss`); `--heapsnapshot-near-heap-limit` ready when you are hunting a leak.
- [ ] **No sync work in request paths:** no `...Sync` calls, no big `JSON.parse`, no unbounded regex; CPU work goes to worker threads or a job queue.
- [ ] **Connection reuse:** keep-alive for outgoing HTTP, pools for databases and caches.
- [ ] **Compression and caching** set up at the edge (reverse proxy or CDN) when possible.
- [ ] **Run in production mode** (`NODE_ENV=production`; some frameworks, such as Express, change behaviour with it) on a supported LTS version of Node (see lesson 01).
- [ ] **A way to look inside a running process:** the ability to take a heap snapshot or a CPU profile from one instance (an admin endpoint calling `v8.writeHeapSnapshot()`, protected by authentication, or an inspector port reachable only from a secure place). Never expose `--inspect` to the internet: whoever connects can run code in your process.
- [ ] **Load test before big releases,** with realistic data, and compare with the last release.
- [ ] **Graceful shutdown:** stop accepting connections, finish requests, close pools (lessons 12 and 15).

A small metrics reporter you can paste into a service. It logs one JSON line per second with the numbers that matter (send them to your metrics system instead of `console.log` in real life). The timer is `unref()`ed so that the reporter never keeps the process alive:

```js
const { monitorEventLoopDelay, PerformanceObserver } = require('node:perf_hooks');
const v8 = require('node:v8');

const lag = monitorEventLoopDelay({ resolution: 20 });
lag.enable();

let gcMs = 0;
new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) gcMs += entry.duration;
}).observe({ entryTypes: ['gc'] });

const mb = (bytes) => Math.round(bytes / 1024 / 1024);
const report = setInterval(() => {
  const mem = process.memoryUsage();
  console.log(JSON.stringify({
    lagP99Ms: Math.round(lag.percentile(99) / 1e6),
    lagMaxMs: Math.round(lag.max / 1e6),
    gcMs: Math.round(gcMs),
    heapUsedMb: mb(mem.heapUsed),
    heapLimitMb: mb(v8.getHeapStatistics().heap_size_limit),
    rssMb: mb(mem.rss),
  }));
  lag.reset();
  gcMs = 0;
}, 1000);
report.unref();
```

(The lag values include the 20 ms sampling interval, so a healthy service shows about 20 and up.)

> **Interview tip:** "What would you monitor for a Node service?" Four groups. The basics per route (latency percentiles, traffic, errors, and saturation: how full the shared resources are). The Node-specific health numbers (event loop lag and utilization, heap used after GC, `rss`, GC time). The pools and queues (database pool usage, queue length, thread pool waiting). And a way to look inside one running process (snapshot, CPU profile). Add that every number needs an alert threshold, or it is only decoration.

---

## Summary / Key takeaways

- Measure first. Use percentiles (p50, p95, p99), not the average. Little's law (`L = lambda x W`) tells you how many requests are in flight.
- Objects live in the V8 heap (young and old generation); `Buffer` data lives outside it. `rss` is everything. A heap limit crash is exit code 134; a container kill comes from the operating system (exit code 137 in Docker), so leave room below the container limit.
- Scavenge cleans the young generation and costs what survives; mark-sweep-compact cleans the old generation. Fewer allocations and fewer survivors mean less GC work.
- A leak is a forgotten reference: unbounded caches and arrays, accidental globals, closures sharing a scope, small views of big strings or Buffers, listeners, timers, promises held in a map. Bound things, remove listeners, clear timers (`unref()` is not a fix), add timeouts.
- Confirm a leak by watching the floor after GC rise like a staircase. Find it with snapshots: follow retainers, read retained size, use the three-snapshot technique. Find slow code with `--cpu-prof` and a flame graph: the widest box with nothing on top is the place to look. Fix, then measure again.
- Event loop lag (`monitorEventLoopDelay`) shows blocking. I/O-bound routes scale with concurrency; CPU-bound routes do not, and queue up instead. A full thread pool (4 threads) makes `fs`, `crypto` and `zlib` calls wait without any loop lag.
- Benchmark with warm-up, several rounds, the median, and a used result. Load test with a client that is not the bottleneck.
- The tactics that pay most: do not block the loop, fix slow queries, batch and avoid N+1, reuse connections, paginate, stream, send less data, compress carefully, cache with limits, and move CPU work to worker threads.

---

## Quick check

1. Why is the average a poor summary of latency?
<details><summary>Answer</summary>

A few very slow requests are hidden. Nine requests of about 10 ms and one of 1000 ms give an average of about 109 ms, which no user experienced. Percentiles show the typical request (p50) and the slow tail (p95, p99). Do not average percentiles across servers.

</details>

2. A service gets 300 requests per second and each takes 200 ms on average. How many requests are in flight, and why does it matter?
<details><summary>Answer</summary>

Little's law: L = lambda x W = 300 x 0.2 = 60 requests at the same time. It matters for sizing: about 60 sockets, and if every request needs a database connection, a pool of 20 will make requests wait.

</details>

3. A process has `heapUsed` of 80 MB but `rss` of 1.5 GB. Where can the rest be?
<details><summary>Answer</summary>

Outside the V8 heap: Buffers and ArrayBuffers (`external` and `arrayBuffers`), native addons, thread stacks and many worker threads, memory not yet returned to the operating system, and so on. Compare `rss`, `external` and `arrayBuffers` with `heapUsed`.

</details>

4. A container has a 1 GB limit. Someone sets `--max-old-space-size=1024`. What can go wrong?
<details><summary>Answer</summary>

The heap alone may grow to the container limit, but the process needs more memory than the old space (young generation, Buffers, native memory, stacks). The kernel's OOM killer ends the process with SIGKILL (exit code 137 in Docker) before V8 reports anything. Use about 70-75% of the limit and monitor `rss`. A V8 heap limit crash looks different: `FATAL ERROR: Reached heap limit` and exit code 134.

</details>

5. What is the difference between a scavenge and a mark-sweep-compact GC?
<details><summary>Answer</summary>

A scavenge cleans the young generation by copying the live objects, so its cost depends on how many objects survive, not on how much garbage there is. Mark-sweep-compact cleans the old generation: it marks what is reachable from the roots, frees the rest and packs the survivors; V8 does much of it incrementally and concurrently to keep pauses short.

</details>

6. Name four causes of memory leaks in a Node server and the fix for each.
<details><summary>Answer</summary>

For example: an unbounded cache (use an LRU with a size and time limit); listeners added per request and never removed (`off`, `once`, or an `AbortSignal`); intervals never cleared (`clearInterval`); pending promises or callbacks stored in a map with no timeout (add a timeout that deletes the entry). Also closures that share a scope with a big object, global arrays or accidental globals, and small slices of big strings or Buffers.

</details>

7. Does `timer.unref()` fix a leak from a forgotten `setInterval`?
<details><summary>Answer</summary>

No. `unref()` only lets the process exit while the timer is pending. The timer still exists, still fires and still holds the closure and its data. `clearInterval` releases the memory.

</details>

8. Explain the three-snapshot technique, and the difference between shallow and retained size.
<details><summary>Answer</summary>

Take snapshot 1 after warm-up, do the suspicious work, take snapshot 2, do the same work again, take snapshot 3. Objects created between 1 and 2 that are still alive in 3 are the leak candidates, because temporary data would be gone. Shallow size is the memory of the object itself; retained size is the memory that would be freed if the object were removed, including everything only it keeps alive.

</details>

9. In a flame graph, which box do you look at first?
<details><summary>Answer</summary>

The widest box that has little or nothing on top of it: wide means a large share of the time, and having nothing on top means the time is in that function itself (self time), not in something it calls. The left to right order means nothing. A box that is wide only because wider boxes sit on it just passes the time down.

</details>

10. Why can a micro-benchmark give a wrong answer even if it looks careful?
<details><summary>Answer</summary>

No warm-up (the first runs are slow), a single run, a result that is never used (the optimizer can delete the work), a changing input type (deoptimization), and noise from GC and other programs. Use warm-up, several rounds, the median, and use the result. Then confirm with a test of the whole request.

</details>

---

## Try it yourself

### Task 1 (easy): which function leaks?

Write a script that measures how much memory two functions keep after many calls. `trackA` adds each id to a module-level `Set`; `trackB` adds it to a `Set` created inside the call. Use `global.gc()` (run with `node --expose-gc`) before and after, call each function 50000 and then 100000 times with new ids, and print the retained megabytes.

<details><summary>Hint</summary>

Read `process.memoryUsage().heapUsed` right after `global.gc()`, before and after the calls. Give every call a new id with a counter, so the second round is comparable.

</details>

<details><summary>Solution</summary>

```js
// Run: node --expose-gc task1.js
const seen = new Set();
function trackA(id) {
  seen.add('user-' + id); // every id is remembered forever
  return seen.size;
}
function trackB(id) {
  const local = new Set();
  local.add('user-' + id); // lives only during the call
  return local.size;
}

let nextId = 0; // every call gets a new id, so the numbers are easy to compare
function retainedMb(fn, calls) {
  global.gc();
  const before = process.memoryUsage().heapUsed;
  for (let i = 0; i < calls; i++) fn(nextId++);
  global.gc();
  return (process.memoryUsage().heapUsed - before) / 1024 / 1024;
}

for (const calls of [50_000, 100_000]) {
  console.log(`${calls} calls -> trackA keeps ${retainedMb(trackA, calls).toFixed(2)} MB more, trackB keeps ${retainedMb(trackB, calls).toFixed(2)} MB more`);
}
```

```text
50000 calls -> trackA keeps 2.77 MB more, trackB keeps 0.00 MB more
100000 calls -> trackA keeps 6.80 MB more, trackB keeps 0.00 MB more
```

`trackA` keeps growing (it is the leak), `trackB` keeps nothing. (The exact megabytes of a growing `Set` jump in steps because the set grows its table by doubling.)

</details>

### Task 2 (medium): measure the lag, then fix it

Process 150000 items with a heavy per-item function in one synchronous loop. Use `monitorEventLoopDelay` to show that the loop is blocked. Then change the code to work in chunks and yield to the event loop between chunks, and show that the worst gap gets much smaller.

<details><summary>Hint</summary>

Put the work for a range of items into a plain (synchronous) function. Call it in a loop in an `async` function, and after each chunk `await new Promise((resolve) => setImmediate(resolve))`. Let the last heartbeat arrive before you call `histogram.disable()`, and warm up the code before you measure. (If the hot loop itself sits inside the `async` function, the first chunked run can be about twice as slow as the unchunked one. The cause was not investigated; a likely reason is that the code had not finished being optimized. Keeping the loop in a plain function avoided it.)

</details>

<details><summary>Solution</summary>

```js
// Run: node task2.js
const { monitorEventLoopDelay } = require('node:perf_hooks');

const items = Array.from({ length: 150_000 }, (_, i) => 'item-' + i);

function hashOne(text) {
  let h = 0;
  for (let round = 0; round < 40; round++) {
    for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return h;
}

// The real work, for the items from `start` up to (not including) `end`
function processRange(list, start, end) {
  let total = 0;
  for (let i = start; i < end; i++) total += hashOne(list[i]);
  return total;
}

// Version 1: one long synchronous loop
function processAllAtOnce(list) {
  return processRange(list, 0, list.length);
}

// Version 2: the same work, but after every 10000 items we let the event loop breathe
async function processInChunks(list, chunkSize = 10_000) {
  let total = 0;
  for (let start = 0; start < list.length; start += chunkSize) {
    total += processRange(list, start, Math.min(list.length, start + chunkSize));
    await new Promise((resolve) => setImmediate(resolve)); // other callbacks can run now
  }
  return total;
}

async function withLagReport(label, work) {
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  await new Promise((resolve) => setTimeout(resolve, 50)); // heartbeat starts
  const started = Date.now();
  const result = await work();
  const tookMs = Date.now() - started;
  await new Promise((resolve) => setTimeout(resolve, 50)); // let a late heartbeat arrive
  histogram.disable();
  console.log(`${label}: took ${tookMs} ms, worst gap between heartbeats ${(histogram.max / 1e6).toFixed(0)} ms (result ${result})`);
}

(async () => {
  // warm-up on a small part, so that the optimizer has done its work before we measure
  processAllAtOnce(items.slice(0, 30_000));
  await processInChunks(items.slice(0, 30_000));

  await withLagReport('all at once ', async () => processAllAtOnce(items));
  await withLagReport('in chunks   ', () => processInChunks(items));
})();
```

```text
all at once : took 152 ms, worst gap between heartbeats 167 ms (result 51382792520)
in chunks   : took 169 ms, worst gap between heartbeats 27 ms (result 51382792520)
```

The result is the same and the total time is similar, but the worst gap fell from about the whole job (167 ms) to about one chunk (27 ms). During the chunked run other requests could be served between chunks. A chunk should take a few milliseconds up to a few tens of milliseconds. For heavy work that lasts seconds, a worker thread is the better tool (lesson 18).

</details>

### Task 3 (harder): an async cache with a time limit, a size limit and no stampede

Write `memoizeAsync(fn, { ttlMs, maxEntries })`. It returns a function `cached(key)` with these rules: (1) 100 callers asking for the same key at the same moment cause ONE call of `fn`; (2) a result is reused for `ttlMs` milliseconds; (3) at most `maxEntries` entries are kept (drop the least recently used); (4) a failed call is not cached. Check each rule with `node:assert`.

<details><summary>Hint</summary>

Cache the promise itself, not the value. Then callers that arrive while the first call is still running share it. Store `{ promise, expiresAt }` in a `Map`; delete and set a key on every hit to keep the Map in "least recently used first" order. Remove the entry in a `.catch` if the promise fails.

</details>

<details><summary>Solution</summary>

```js
// Run: node task3.js
const assert = require('node:assert/strict');
const { setTimeout: sleep } = require('node:timers/promises');

function memoizeAsync(fn, { ttlMs, maxEntries }) {
  const entries = new Map(); // key -> { promise, expiresAt }  (Map order = least recently used first)
  return function cached(key) {
    const now = Date.now();
    const hit = entries.get(key);
    if (hit && hit.expiresAt > now) {
      entries.delete(key); // move to the end = most recently used
      entries.set(key, hit);
      return hit.promise; // a finished OR still running promise: both are shared
    }
    const promise = fn(key);
    entries.delete(key);
    entries.set(key, { promise, expiresAt: now + ttlMs });
    if (entries.size > maxEntries) entries.delete(entries.keys().next().value); // drop the oldest
    promise.catch(() => {
      if (entries.get(key)?.promise === promise) entries.delete(key); // do not cache failures
    });
    return promise;
  };
}

(async () => {
  let calls = 0;
  const slowSquare = async (n) => {
    calls++;
    await sleep(20);
    return n * n;
  };
  const cached = memoizeAsync(slowSquare, { ttlMs: 100, maxEntries: 2 });

  // 1. 100 callers at the same moment cause ONE real call
  const results = await Promise.all(Array.from({ length: 100 }, () => cached(7)));
  assert.equal(calls, 1);
  assert.ok(results.every((r) => r === 49));

  // 2. a later call inside the time limit is served from the cache
  await cached(7);
  assert.equal(calls, 1);

  // 3. after the time limit the function is called again
  await sleep(120);
  await cached(7);
  assert.equal(calls, 2);

  // 4. the size limit: with room for 2 entries, the oldest one is dropped
  await cached(1);
  await cached(2);
  await cached(3); // pushes out 7 (the oldest)
  const before = calls;
  await cached(7);
  assert.equal(calls, before + 1);

  // 5. failures are not cached
  let attempts = 0;
  const flaky = memoizeAsync(async () => {
    attempts++;
    if (attempts === 1) throw new Error('first call fails');
    return 'ok';
  }, { ttlMs: 1000, maxEntries: 10 });
  await assert.rejects(flaky('x'), /first call fails/);
  await sleep(0);
  assert.equal(await flaky('x'), 'ok');

  console.log('all checks passed, real calls made:', calls);
})();
```

```text
all checks passed, real calls made: 6
```

Caching the promise is the key idea: the 99 callers that arrive while the first call is running get the same promise, so there is no stampede. Expired entries are only replaced when asked for again; the size limit keeps memory bounded either way. A production version would also check `entries.size` on a timer to remove expired keys that are never asked for again.

</details>

---

## Where to go next

- Next lesson: [20. Security and the crypto Module](../20-security-and-crypto/README.md). It uses `pbkdf2`, `scrypt` and friends, which you now know cost CPU and belong in the thread pool.
- Practise this topic in the interview rounds: [Round 4: advanced questions](../../rounds/round-4-advanced/questions.md) (memory, GC, profiling, event loop lag), [Round 5: system design](../../rounds/round-5-system-design/questions.md) (capacity, caching, scaling), and [Round 3: coding](../../rounds/round-3-coding/questions.md).
- Related lessons: [08. The Event Loop](../08-event-loop/README.md), [11. Streams](../11-streams/README.md) and [18. worker_threads, cluster and Scaling on One Machine](../18-worker-threads-and-cluster/README.md).
