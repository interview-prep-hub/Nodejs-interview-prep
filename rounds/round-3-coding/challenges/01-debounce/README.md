# Challenge: debounce

Difficulty: Medium | Time box: 25 minutes | Skills: closures, timers, `this` and arguments

## Problem

`debounce(fn, wait)` returns a function that delays calling `fn` until `wait` ms have passed since the LAST call. Typical use: run a search only after the user stops typing.

## API

```js
const d = debounce(fn, 100, { leading: false, trailing: true });
d('a'); d('b'); d('c');   // after 100 ms of quiet: fn('c') runs once
d.cancel();               // drop the pending call
d.flush();                // run the pending call now and return its result
```

- `trailing` (default `true`): call `fn` at the end of a burst with the last arguments and the last `this`.
- `leading` (default `false`): also call `fn` immediately on the first call of a burst.
- With both on, the trailing call happens only if there was at least one more call after the leading one.
- The debounced function returns the result of the most recent `fn` call (or `undefined` if there was none yet).
- Tests use `node:test` mock timers, so no real waiting.

## Run

```bash
npm run challenge -- debounce
npm run challenge -- debounce --solution
```

## Hints

<details>
<summary>Hint 1</summary>

Keep one `timer` variable. Every call does `clearTimeout(timer)` and starts a new `setTimeout`.
</details>

<details>
<summary>Hint 2</summary>

Remember the last `args` and `this` in variables so the timer callback can use them.
</details>

<details>
<summary>Hint 3</summary>

Track whether a trailing call is owed (`pending`). A leading call clears that flag, a later call in the same burst sets it again.
</details>

## Interviewer follow-ups

- Debounce vs throttle? (Debounce waits for quiet and runs once per burst. Throttle runs at a steady maximum rate during the burst.)
- Why a normal function and not an arrow for the returned function? (So `this` is the caller's object.)
- What would you add for production use? (A `maxWait`, as lodash has, so a never-ending burst still fires.)
