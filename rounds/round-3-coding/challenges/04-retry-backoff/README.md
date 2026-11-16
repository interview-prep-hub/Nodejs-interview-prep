# Challenge: retry with exponential backoff

Difficulty: Medium | Time box: 30 minutes | Skills: async loops, backoff and jitter, injecting dependencies for tests

## Problem

Calls to other services fail sometimes. Write `retry(fn, options)` that calls `fn` again after a growing delay, and gives up after a limit.

## API

```js
const data = await retry((attempt) => fetchSomething(), {
  retries: 3, baseDelay: 100, factor: 2, maxDelay: 5000, jitter: false,
  shouldRetry: (error, attempt) => true,
  sleep, random, signal,
});
```

- `fn(attempt)` gets the attempt number, starting at 1. A rejection counts as a failure.
- Up to `retries` EXTRA attempts (so `retries: 3` means at most 4 calls). After the last failure, rethrow the last error.
- Delay before retry `n` (1-based): `min(maxDelay, baseDelay * factor^(n-1))`. With `jitter: true`, multiply that by `random()` ("full jitter").
- `shouldRetry(error, attempt)` returning `false` stops at once and rethrows that error.
- `sleep(ms)` is injectable (default: a real timer) so tests can record delays without waiting. `random` is injectable too.
- If `signal` is aborted, stop and reject with `signal.reason` (an `AbortError`).

Defaults: `retries = 3`, `baseDelay = 100`, `factor = 2`, `maxDelay = 5000`, `jitter = false`.

## Run

```bash
npm run challenge -- retry-backoff
npm run challenge -- retry-backoff --solution
```

## Hints

<details>
<summary>Hint 1</summary>

A `for (;;)` loop with `try { return await fn(attempt) } catch { ... }` is the simplest shape.
</details>

<details>
<summary>Hint 2</summary>

Decide whether to retry BEFORE sleeping: out of retries, or `shouldRetry` says no, then `throw error`.
</details>

<details>
<summary>Hint 3</summary>

The first retry uses `factor ** 0`, so its delay is exactly `baseDelay`.
</details>

## Interviewer follow-ups

- Why add jitter? (If many clients fail together and retry on the same schedule, they hit the server in waves. Randomness spreads the load.)
- Which errors should you NOT retry? (Client errors such as 400 or 404, and non-idempotent operations unless you use an idempotency key.)
- What else protects a struggling service? (A circuit breaker, timeouts on each attempt, and a retry budget.)
