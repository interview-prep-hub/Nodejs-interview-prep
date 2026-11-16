# Challenge: write your own promisify

Difficulty: Easy | Time box: 15 minutes | Skills: closures, error-first callbacks, `this`, promises

## Problem

Node's older APIs take a callback as the last argument: `fn(arg1, arg2, (err, result) => {})`. Write `promisify(fn)`, which returns a new function that takes the same arguments (without the callback) and returns a promise.

## API

```js
const { promisify } = require('./promisify');
const readAsync = promisify(fs.readFile);
const text = await readAsync(path, 'utf8');
```

- `promisify(fn)` returns a function. It calls `fn` with the same arguments plus an error-first callback.
- If the callback gets a truthy `err`, the promise rejects with that exact error. Otherwise it resolves with the first result value (extra values are ignored).
- `this` is preserved, so `obj.method = promisify(obj.method)` works.
- If `fn` throws synchronously, the promise rejects with that error.
- If `fn` is not a function, `promisify` throws a `TypeError` immediately.

## Run

```bash
npm run challenge -- promisify
npm run challenge -- promisify --solution
```

## Hints

<details>
<summary>Hint 1</summary>

Return a function. Inside it, return `new Promise((resolve, reject) => { ... })`.
</details>

<details>
<summary>Hint 2</summary>

The callback you pass is `(err, value) => ...`. Reject on `err`, resolve on `value`.
</details>

<details>
<summary>Hint 3</summary>

Arrow functions do not have their own `this`. Return a normal function, and call `fn.call(this, ...args, callback)`.
</details>

## Interviewer follow-ups

- Why does the sync throw become a rejection without extra code? (Throwing inside a Promise executor rejects the promise.)
- What does the built-in `util.promisify` do that this one does not? (It honours `util.promisify.custom` and can return several values for APIs that define it.)
- Why is it a problem to promisify an API that calls the callback twice? (A promise settles only once, so later calls are silently lost.)
