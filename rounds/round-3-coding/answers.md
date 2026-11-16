# Round 3: Live Coding: Approach notes

Try the challenge first and run its tests. Each entry explains the approach, complexity, edge cases and follow-ups. Full reference solutions are in each challenge's `solution/` folder.

---

## Coding challenges: approach notes

### R3-CODE-01 [Medium] debounce

**Approach:** Keep one `timer`. Each call clears it and starts a new one. When it fires, call the function with the last arguments and `this`. `leading` calls at the start of a burst. A `pending` flag records whether a trailing call is owed. `cancel` clears the timer. `flush` runs the pending call now.

**Complexity:** O(1) per call.

**Edge cases people miss:** `this` and arguments of the LAST call; leading plus trailing with a single call must fire once; `flush` with nothing pending; returning the last result.

**What the interviewer looks for:** a normal function for `this`, no memory held after the burst (clear saved args), and the debounce vs throttle difference.

**Follow-ups:**

- Debounce vs throttle? Debounce waits for quiet, throttle limits the rate.
- Add `maxWait`? Track the first call time and force a call when it is exceeded.

Reference solution: [solution](challenges/01-debounce/solution/debounce.js)

### R3-CODE-02 [Medium] LRU cache

**Approach:** Use a `Map`, which keeps insertion order. On `get` and `put`, delete the key and set it again to move it to the end. When over capacity, delete the first key (`map.keys().next().value`).

**Complexity:** O(1) average for `get`, `put`, `has`, `delete`. O(n) for `keys()`.

**Edge cases people miss:** falsy stored values (`0`, `''`) are still hits; `put` on an existing key must refresh recency; `has` must not change recency; capacity validation.

**What the interviewer looks for:** O(1) operations and knowing why `Map` order works.

**Follow-ups:**

- No `Map` order? Hash map plus doubly linked list.
- TTL? Store an expiry time per entry and check on `get`.
- Multiple processes? Use a shared cache such as Redis.

Reference solution: [solution](challenges/02-lru-cache/solution/lru-cache.js)

### R3-CODE-03 [Medium] Concurrency-limited promise pool

**Approach:** Start `limit` worker loops. Each takes the next index from a shared counter, awaits that task, writes the result at the same index, and repeats until the tasks run out. A `failed` flag stops workers from starting new tasks in stop-on-error mode.

**Complexity:** O(n) time, O(n) result array.

**Edge cases people miss:** batching (`slice` into groups) is slower because each batch waits for its slowest task; result order; `limit` greater than the task count; empty list; validating `limit`.

**What the interviewer looks for:** a worker-pool shape, not batches, and understanding that `next++` is safe because JavaScript is single threaded.

**Follow-ups:**

- Cancellation? Pass an `AbortSignal` and check it before starting each task.
- Why not `Promise.all` on everything? Sockets, memory and rate limits.

Reference solution: [solution](challenges/03-promise-pool/solution/promise-pool.js)

### R3-CODE-04 [Medium] Retry with exponential backoff

**Approach:** Loop over attempts. On failure, stop if retries are used up or `shouldRetry` says no. Otherwise compute `min(maxDelay, baseDelay * factor^(n-1))`, multiply by `random()` with jitter, `await sleep(delay)`, and try again. Inject `sleep` and `random` so tests do not wait.

**Complexity:** O(retries).

**Edge cases people miss:** off-by-one (`retries: 3` means 4 calls); rethrow the LAST error; the first delay is exactly `baseDelay`; checking the abort signal.

**What the interviewer looks for:** testable design (injected sleep), jitter reasoning, and knowing which errors not to retry.

**Follow-ups:**

- Why jitter? To stop clients retrying in sync.
- Not safe to retry? Non-idempotent writes without an idempotency key.
- What else? Circuit breaker, per-attempt timeout, retry budget.

Reference solution: [solution](challenges/04-retry-backoff/solution/retry.js)
