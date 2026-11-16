# Round 4: Advanced and Senior Deep Dive: Answers

Say the **Short answer** aloud, then add depth on request.

---

## Internals (Lessons 08, 23)

### R4-INT-01 [Medium] How does V8 run your JavaScript? What are the stages?

**Short answer:** V8 parses the source into an AST and bytecode, and the interpreter (Ignition) starts running it at once. Hot functions are compiled to machine code by faster tiers (a baseline compiler, then optimizing compilers such as Maglev and TurboFan) using type feedback collected while running. If an assumption breaks (a number becomes a string), V8 "deoptimizes" back to bytecode. Memory is reclaimed by a generational garbage collector.

### R4-INT-02 [Hard] What are hidden classes (shapes) and inline caches, and what do they mean for how you write code?

**Short answer:** V8 gives objects with the same property names, added in the same order, a shared hidden class. Property access sites remember the shape they saw (inline cache), so lookups become a fixed offset. If one site sees many shapes it becomes slow ("megamorphic").

**Practical rules:** initialise all properties in the constructor in a consistent order, avoid adding or deleting properties later, and keep a function's argument types consistent. Measure before micro-optimising.

### R4-INT-03 [Hard] [Must-know] Trace what happens when you call `fs.readFile`, from your code to the callback.

**Short answer:** Your call goes through Node's JS layer into a C++ binding, which creates a request for libuv. libuv runs the blocking file operation on a thread-pool thread (4 by default), so the main thread is free. When the thread finishes, it queues the completion; the event loop's poll phase picks it up, and Node runs your callback (or resolves the promise).

**Follow-up:** What if you use `readFileSync`? The main thread does the work itself and nothing else runs meanwhile.

### R4-INT-04 [Hard] What is `AsyncLocalStorage`, and what is it used for?

**Short answer:** It keeps a value (a store) that follows the logical flow of async calls, through `await`, timers and callbacks, without passing it as an argument. Typical uses: a request id for logs, tracing context, a per-request database transaction or user. You call `als.run(store, fn)` at the entry (a middleware), and `als.getStore()` anywhere below.

### R4-INT-05 [Medium] Is the `vm` module a security sandbox?

**Short answer:** No. `vm` runs code in a separate context (own globals), but that is for isolation of variables, not security. Code can escape through shared objects and prototype chains. Docs say not to use it to run untrusted code. Use a separate process with the permission model, a container, or a real sandbox.

---

## Performance and memory (Lesson 19)

### R4-PERF-01 [Medium] [Must-know] What is the difference between latency and throughput, and why do you look at p99 instead of the average?

**Short answer:** Latency is how long ONE request takes. Throughput is how many requests per second the system completes. Averages hide slow outliers: if 1 percent of requests take 5 seconds, the average still looks fine, but 1 in 100 users has a bad time, and a page that makes 20 calls hits a slow one most of the time. Track p50, p95 and p99.

### R4-PERF-02 [Hard] [Must-know] A Node.js service is slow. How do you find out why?

**Short answer:** Measure, do not guess. (1) Check metrics: CPU, memory, event loop delay (`perf_hooks.monitorEventLoopDelay`), error rate, downstream latency. (2) If CPU is high, take a CPU profile (`node --cpu-prof` or `--inspect` with DevTools) and read the flame graph for wide frames. (3) If the CPU is low, the time is in waiting: slow database, external calls, pool queues. Trace a request end to end. (4) Change one thing, re-measure with a load test.

**Common wrong answer:** "Rewrite it in another language" or "add more servers" before any measurement.

### R4-PERF-03 [Medium] What are common ways to make a Node.js API faster?

**Short answer:** Fix the slow query or add an index first (it is usually the database). Cache hot data (in memory with a size limit, or Redis). Avoid sync calls and CPU work on the main thread (use workers). Stream large responses. Reuse connections (keep-alive agents, pools). Run several processes to use all cores. Compress and paginate payloads. Cut `JSON.stringify` cost for huge objects.

### R4-MEM-01 [Medium] How is memory organised in Node.js, and how does garbage collection work at a high level?

**Short answer:** Memory has the V8 heap (JavaScript objects), the stack, and "external" memory such as Buffers. The heap is generational: a small young space where most objects die quickly (cheap, frequent scavenges) and an old space for survivors (slower, mostly concurrent mark-and-sweep). Objects that are still reachable are never collected, which is what a leak is. The old-space limit depends on system memory and can be set with `--max-old-space-size`.

### R4-MEM-02 [Hard] [Must-know] How do you find a memory leak?

**Short answer:** Confirm it: `heapUsed` keeps growing after GC. Then take heap snapshots at two or three points (DevTools via `--inspect`, or `v8.writeHeapSnapshot()`), compare them, and look at which object types grow and what retains them (the "retainers" path). Typical causes: unbounded `Map`/array caches, listeners added per request and never removed, closures holding big objects, timers never cleared, global state. Fix: bounded caches (LRU with TTL), remove listeners, clear timers.

### R4-MEM-03 [Hard] `heapUsed` is small but the process uses a lot of memory (RSS). How is that possible?

**Short answer:** RSS includes more than the JS heap: Buffers and typed arrays (external memory), native addons, code, thread stacks, and memory the allocator has not returned to the OS. Compare `rss`, `heapTotal`, `heapUsed`, `external` and `arrayBuffers` from `process.memoryUsage()`. Large `external` or `arrayBuffers` points at buffers, for example reading whole files into memory or unbounded stream buffers.

---

## Scaling and security (Lessons 18, 20)

### R4-SCALE-01 [Medium] [Must-know] Compare `worker_threads`, `cluster` and `child_process`. When do you use each?

**Short answer:**

| | What it is | Use for |
| --- | --- | --- |
| `worker_threads` | threads inside one process, own event loop and heap, can share memory | CPU-heavy tasks (image work, hashing, parsing) |
| `cluster` | several Node processes sharing one server port | using all cores for an HTTP server on one machine |
| `child_process` | separate programs or Node scripts | running other executables, isolation |

For production you often skip `cluster` and run one process per container, scaled by the orchestrator.

### R4-SCALE-02 [Medium] What makes a service easy to scale horizontally? When do you need sticky sessions?

**Short answer:** Keep each instance stateless: no sessions, uploads or caches that only live in one process's memory. Put shared state in a database, Redis or object storage. Then a load balancer can send any request to any instance. Sticky sessions are needed when state must stay on one instance, for example WebSocket connections or in-memory sessions, but they make scaling and deploys harder.

### R4-SCALE-03 [Hard] How can worker threads share memory safely?

**Short answer:** With `SharedArrayBuffer` and typed arrays that several threads can see. Because threads can read and write at the same time, use `Atomics` (`add`, `compareExchange`, `wait`/`notify`) for safe updates. A plain `counter++` on shared memory loses updates. Normal `postMessage` copies data (or transfers an `ArrayBuffer`), which is safer but slower for big data.

### R4-SEC-01 [Medium] [Must-know] What are the most important security risks in a Node.js backend, and how do you defend against them?

**Short answer:** Injection (SQL, NoSQL, command): use parameterised queries and `execFile` with arrays. Broken authentication: hash passwords, short-lived tokens, rate limit logins. Prototype pollution: validate input, block `__proto__`. ReDoS: avoid risky regexes, cap input size. SSRF: validate URLs and block internal addresses. Path traversal: resolve paths and check the prefix. XSS/CSRF: escape output, cookie flags, CSRF tokens. Dependencies: lockfile, `npm audit`, minimal packages. Secrets: environment variables or a secret manager, never in git.

### R4-SEC-02 [Medium] How should you store and check passwords?

**Short answer:** Never store plain text or a fast hash like SHA-256. Use a slow, salted password hash: `crypto.scrypt` (built in), argon2 or bcrypt. Store the salt and parameters with the hash. Compare in constant time (`crypto.timingSafeEqual`) and give the same error for "unknown user" and "wrong password".

### R4-SEC-03 [Medium] What are the pitfalls of JWTs?

**Short answer:** A JWT is signed, not encrypted: anyone can read it. Pitfalls: accepting the `none` algorithm or letting the token choose the algorithm (fix the allowed algorithms in code); long expiry; no way to revoke before expiry (use short life plus refresh tokens, or a denylist); storing tokens where scripts can read them; putting secrets in the payload; weak signing secrets.

### R4-SEC-04 [Hard] What is the Node.js permission model, and how do you reduce supply-chain risk?

**Short answer:** Running with `--permission` denies file system, child process and worker access unless you allow it with flags such as `--allow-fs-read=...` and `--allow-fs-write=...`. A denied call throws `ERR_ACCESS_DENIED`. Network access is not restricted by this model on Node 24. Supply chain: commit the lockfile, use `npm ci`, review new dependencies, use `npm audit`, consider `--ignore-scripts` in CI, pin versions, and prefer built-ins over tiny packages.

---

## Production (Lesson 24)

### R4-PROD-01 [Medium] [Must-know] What does a good graceful shutdown look like?

**Short answer:** On `SIGTERM`: mark the instance not ready (readiness fails so the balancer stops sending traffic), stop accepting new connections (`server.close()`), let in-flight requests finish, close idle keep-alive connections, drain queues and close database pools, then exit with code 0. Add a timeout (shorter than the orchestrator's kill grace period) that forces exit.

### R4-PROD-02 [Medium] What is the difference between a liveness and a readiness check?

**Short answer:** Liveness answers "is the process stuck and should be restarted?" so it should be cheap and not depend on the database. Readiness answers "can this instance take traffic right now?" so it may check dependencies and fails during startup and shutdown. Mixing them up can cause restart storms when the database is down.

### R4-PROD-03 [Medium] What do you do differently when you run Node.js in Docker?

**Short answer:** Use a small LTS base image and a multi-stage build; `npm ci --omit=dev`; run as a non-root user; set `NODE_ENV=production`; start Node directly with the exec form (`CMD ["node", "server.js"]`) so it receives `SIGTERM`, or use an init process; set memory limits and make sure `--max-old-space-size` fits below them; log to stdout; add health checks.

---

## Incident scenarios (Lessons 14, 19, 24)

### R4-INC-01 [Hard] CPU is pinned at 100 percent on one core, and latency for every endpoint has grown. What do you do?

**First five minutes:** Check recent deploys and traffic. If you can, remove the instance from rotation, and keep a copy for diagnosis. Restart if users are hurt.

**Measure:** Event loop delay, a CPU profile from the bad instance (`--cpu-prof`, or `--inspect`), request rate by endpoint.

**Narrow down:** Read the flame graph for one wide function. Match it to an endpoint.

**Likely causes:** a synchronous loop or huge `JSON.parse`/`stringify`; a regex with catastrophic backtracking (ReDoS) on user input; sync crypto or `fs` calls; an accidental infinite retry loop.

**Fix:** Make the code async or chunked, move work to a worker thread, fix or replace the regex and cap input length.

**Prevent:** Alert on event loop delay, add input size limits, load-test hot paths.

### R4-INC-02 [Hard] Memory climbs steadily for hours until the container is killed (OOM). What do you do?

**First five minutes:** Restart gradually or add capacity to buy time. Check whether it correlates with a deploy or a traffic type.

**Measure:** `process.memoryUsage()` over time: is it `heapUsed` (JS objects), `external` (Buffers) or RSS only?

**Narrow down:** Take heap snapshots 10 to 15 minutes apart and compare. Look at the object types that grow and their retainers.

**Likely causes:** unbounded cache or `Map`; listeners added per request; closures or timers holding data; queues that grow faster than they drain; buffering whole bodies.

**Fix:** Bound caches (LRU and TTL), remove listeners, clear timers, stream data, apply backpressure.

**Prevent:** Memory graphs and alerts, soak tests, set `--max-old-space-size` below the container limit so you get a JS heap error and a heap snapshot rather than a silent kill.

### R4-INC-03 [Hard] Average latency is fine, but p99 spikes every few minutes. What do you check?

**First five minutes:** Look at the spike times. Do they match a schedule?

**Measure:** Percentile histograms, `--trace-gc` output, event loop delay, database slow-query logs, pool wait time.

**Narrow down:** Correlate spikes with cron jobs or batch tasks on the same process, GC pauses, connection reconnects, cache expiry (a stampede), noisy neighbours, or CPU throttling in the container.

**Likely causes:** a periodic job blocking the event loop; a large heap causing long GC; cache expiring for a hot key so many requests hit the database at once; DNS or TLS reconnects.

**Fix:** Move the job to a worker or another service, add jitter to expirations, use single-flight for cache misses, size the heap.

**Prevent:** Alert on p99, not only the average.

### R4-INC-04 [Hard] After a deploy, clients behind a load balancer see bursts of `ECONNRESET`. What is going on?

**First five minutes:** Check if errors align with deploy or restart times, and whether only idle-then-reused connections fail.

**Likely causes:** (1) The Node server's `keepAliveTimeout` (default 5 seconds) is shorter than the load balancer's idle timeout, so Node closes an idle connection just as the balancer reuses it. (2) Instances being killed without a graceful shutdown, dropping in-flight requests.

**Fix:** Set `server.keepAliveTimeout` above the balancer's idle timeout (and `headersTimeout` above that). Implement graceful shutdown with readiness failing first. Clients should retry idempotent requests.

**Prevent:** Test rolling deploys under load.

### R4-INC-05 [Hard] The logs show `EMFILE: too many open files` under load. What do you do?

**Measure:** Count open file descriptors for the process (`lsof -p` or `/proc/<pid>/fd` on Linux), and compare to the limit (`ulimit -n`).

**Likely causes:** leaked handles: streams or sockets never closed on error (`pipe` without `pipeline`), no connection reuse (a new HTTP agent per request, no keep-alive), opening thousands of files at once with `Promise.all`.

**Fix:** Use `pipeline`, close in `finally`, reuse agents and pools, limit concurrency. Raise the limit only as the last step, since it hides leaks.

**Prevent:** Track open handles as a metric.

### R4-INC-06 [Hard] Requests hang until they time out. CPU is low and the event loop is not lagging. What do you check?

**Narrow down:** The process is idle, so it is waiting for something: a database pool, a downstream call with no timeout, or a lock.

**Likely causes:** the database connection pool is exhausted because connections are not released on an error path; an outbound call with no timeout to a stalled service; DNS problems; a queue consumer stuck.

**Fix:** Release connections in `finally`, set pool acquire timeouts and per-call timeouts (`AbortSignal.timeout`), add retries with backoff and a circuit breaker.

**Prevent:** Metrics for pool in-use and waiting counts, and a timeout on every outbound call.

---

## Coding challenges: approach notes

### R4-CODE-01 [Easy] Debug it: the slow importer

**Approach:** `await` in a `for` loop is sequential. Start `concurrency` worker loops that share a `next` index, and write results by index to keep order.

**Complexity:** O(n) work, wall time about n / concurrency times the task time.

**Edge cases people miss:** `Promise.all` on everything breaks the limit; order of results; calling each item once; an error should reject.

**What the interviewer looks for:** knowing when sequential is right, and bounded concurrency over unbounded.

**Follow-ups:** What happens to the other running items on an error? (They keep running; pass an `AbortSignal` to stop them.)

Reference solution: [solution](challenges/01-fix-sequential-awaits/solution/import-all.js)

### R4-CODE-02 [Medium] Debug it: the polluted merge

**Approach:** `JSON.parse` creates an own key named `__proto__`. The buggy code reads `target['__proto__']` (the real prototype) and merges into `Object.prototype`. Skip `__proto__`, `constructor` and `prototype`, iterate own keys only, and recurse only into own plain objects.

**Complexity:** O(size of source).

**Edge cases people miss:** nested payloads; `constructor.prototype` paths; inherited keys; arrays.

**What the interviewer looks for:** understanding why the attack works, and defence in depth (schema validation, `Object.create(null)`, `Map`).

**Follow-ups:** Other defences? (`--disable-proto=delete`, freezing `Object.prototype`, using `Map`.)

Reference solution: [solution](challenges/02-fix-prototype-pollution/solution/deep-merge.js)
