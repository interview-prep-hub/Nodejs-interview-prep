# Challenge: concurrency-limited promise pool

Difficulty: Medium | Time box: 30 minutes | Skills: async control flow, concurrency, ordering, error handling

## Problem

`Promise.all` on 1000 tasks starts all 1000 at once. That can exhaust sockets, memory or a rate limit. Write `pool(tasks, limit)` that runs at most `limit` tasks at the same time.

## API

```js
const results = await pool([() => fetchA(), () => fetchB(), () => fetchC()], 2);
```

- `tasks` is an array of functions. Each returns a promise (or a value).
- At most `limit` tasks run at once. As soon as one finishes, the next one starts.
- The result array is in INPUT order.
- `stopOnError: true` (default): reject with the first error. No new task is started after a failure.
- `stopOnError: false`: never reject because of a task. Resolve with `{ status: 'fulfilled', value }` or `{ status: 'rejected', reason }` per task.
- `limit` must be a positive integer, otherwise reject with `RangeError`.

## Run

```bash
npm run challenge -- promise-pool
npm run challenge -- promise-pool --solution
```

## Hints

<details>
<summary>Hint 1</summary>

Do not slice the array into batches. Batches wait for the slowest task of each batch.
</details>

<details>
<summary>Hint 2</summary>

Start `limit` "workers". Each worker is an async loop that takes the next index, awaits that task, and repeats.
</details>

<details>
<summary>Hint 3</summary>

Write results with `results[index] = ...` so order is kept. Use a `failed` flag so workers stop picking new tasks.
</details>

## Interviewer follow-ups

- Why is `next++` safe without a lock? (JavaScript runs one piece of code at a time on the event loop. There is no preemption between `next < length` and `next++` because there is no `await` between them.)
- How would you add cancellation? (Pass an `AbortSignal` to the tasks and check `signal.aborted` before starting each one.)
- What does `p-limit` do differently? (It limits calls to a function and returns a promise per call, which suits tasks created over time.)
