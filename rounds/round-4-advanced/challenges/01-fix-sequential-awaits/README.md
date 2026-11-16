# Debug it: the slow importer

Difficulty: Easy | Time box: 20 minutes | Skills: sequential vs parallel `await`, bounded concurrency

## Report from production

"The nightly import of 20 items takes 400 ms in tests and over 40 minutes in production. Each item is independent. We also cannot just use `Promise.all` on everything, because the downstream API allows only a few calls at a time."

## Task

Open `import-all.js`. `importAll(items, importOne, { concurrency = 5 })` awaits each item inside a `for` loop, and ignores `concurrency`. Fix it so that:

- items are imported in parallel, with at most `concurrency` at once;
- the result array is in input order;
- `importOne` is called exactly once per item;
- an error from `importOne` rejects the whole call;
- an invalid `concurrency` (not a positive integer) is a `RangeError`.

## Run

```bash
npm run challenge -- fix-sequential-awaits
npm run challenge -- fix-sequential-awaits --solution
```

## Hints

<details>
<summary>Hint 1</summary>

`await` inside a `for` loop waits for each item before starting the next one.
</details>

<details>
<summary>Hint 2</summary>

`Promise.all(items.map(...))` starts everything at once, which breaks the limit. You need a pool: see the promise pool challenge in round 3.
</details>

<details>
<summary>Hint 3</summary>

Start `concurrency` async worker loops that share one `next` index. Write each result to `results[i]`.
</details>

## Interviewer follow-ups

- When is sequential the right choice? (When order matters, or each step needs the previous result, or you must not overload a dependency.)
- What happens to the other in-flight items when one rejects? (They keep running. Their results are ignored. Use an `AbortSignal` if they should stop.)
