# Cheatsheet: interview quick answers

One-line answers to say first. Details are in the [rounds](../README.md).

| Question | Quick answer |
| --- | --- |
| What is Node.js? | A JavaScript runtime: V8 plus libuv plus built-in modules. |
| How does one thread serve many users? | Non-blocking I/O and the event loop; waiting happens in the OS or the thread pool. |
| What blocks the event loop? | Sync loops, sync `fs`/`crypto`, huge JSON, catastrophic regex. |
| `process.nextTick` vs promise? | nextTick runs first, then promise callbacks, both before the next event loop phase. |
| `setTimeout(0)` vs `setImmediate`? | In the main script: not guaranteed. In an I/O callback: immediate first. |
| `exports` vs `module.exports`? | `exports` is a shortcut to `module.exports`; reassigning `exports` breaks the link. |
| CommonJS vs ESM? | `require` sync and dynamic; `import` static, async, top-level await. |
| `dependencies` vs `devDependencies`? | Runtime vs development only. |
| `npm ci` vs `npm install`? | `ci` installs exactly the lockfile and fails on mismatch; use in CI. |
| `^1.2.3` vs `~1.2.3`? | Minor+patch updates vs patch updates only. |
| Stream types? | Readable, Writable, Duplex, Transform. |
| What is backpressure? | Slow consumer tells the producer to wait: `write()` returns false, wait for `drain`. |
| `pipe` vs `pipeline`? | `pipeline` forwards errors and cleans up all streams. |
| `exec` vs `execFile`? | `exec` uses a shell (injection risk); `execFile` takes an argument array. |
| worker_threads vs cluster? | Threads for CPU work; cluster for many processes on one port. |
| Thread pool size? | 4 by default (`UV_THREADPOOL_SIZE`). |
| Operational vs programmer error? | Expected runtime problem (handle) vs bug (fix, maybe restart). |
| 401 vs 403? | Not authenticated vs authenticated but not allowed. |
| Idempotent methods? | GET, PUT, DELETE (and HEAD, OPTIONS). Not POST. |
| How do you find a memory leak? | Compare heap snapshots over time and read the retainers. |
| How do you find a slow function? | CPU profile and flame graph (`--cpu-prof`). |
| Graceful shutdown? | On SIGTERM: stop accepting, finish in-flight, close pools, exit. |
| Liveness vs readiness? | Restart me? vs send me traffic? |
| Unhandled rejection? | Crashes the process (exit code 1) on modern Node. |
| Which Node version in production? | An LTS line (this course targets 24). |

## Numbers

- Event loop: 6 phases; thread pool 4.
- `EventEmitter` leak warning: more than 10 listeners per event.
- Server timeouts: keep-alive 5 s, headers 60 s, request 300 s.
- Stream buffer: 16 KiB (byte streams), 16 objects (object mode).
- HTTP: 200, 201, 204, 301, 302, 400, 401, 403, 404, 409, 422, 429, 500, 503.
