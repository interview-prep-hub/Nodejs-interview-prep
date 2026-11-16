# Challenge: build your own EventEmitter

Difficulty: Medium | Time box: 30 minutes | Skills: observer pattern, closures, edge cases of the core `EventEmitter`

## Problem

Write a class `MyEmitter` that behaves like Node's `events.EventEmitter` for the methods below. The edge cases are the point: they are what interviewers probe.

## API

| Method | Behaviour |
| --- | --- |
| `on(name, fn)` / `addListener` | Add a listener at the end. Returns the emitter (chainable). Non-function throws `TypeError`. |
| `prependListener(name, fn)` | Add at the front. |
| `once(name, fn)` | Run at most once. The listener is removed BEFORE it runs. |
| `off(name, fn)` / `removeListener` | Remove one listener. Must also work with the original function passed to `once`. |
| `removeAllListeners([name])` | Remove all listeners of one event, or of every event. |
| `emit(name, ...args)` | Call listeners synchronously in order. Returns `true` if there were listeners, else `false`. |
| `listenerCount(name)` | Number of listeners. |
| `listeners(name)` | Array of the original functions (not internal wrappers). |

Rules:

- `this` inside a normal-function listener is the emitter.
- Adding or removing listeners while an emit is running does not change which listeners run for that emit.
- `emit('error', err)` with no `error` listener throws `err` (if it is an `Error`), or a new `Error` if the argument is not an `Error`.

## Run

```bash
npm run challenge -- event-emitter
npm run challenge -- event-emitter --solution
```

## Hints

<details>
<summary>Hint 1</summary>

Keep a `Map` from event name to an array of functions.
</details>

<details>
<summary>Hint 2</summary>

To make emit safe against changes, loop over a copy: `for (const fn of [...list])`.
</details>

<details>
<summary>Hint 3</summary>

For `once`, store a wrapper function. Give it a property such as `wrapper.listener = fn` so `off` and `listeners` can see through it.
</details>

## Interviewer follow-ups

- Why does Node warn after 10 listeners on one event? (A common sign of a listener leak. `setMaxListeners` changes the limit.)
- What happens if a listener throws? (The exception travels up through `emit` to the caller, and later listeners do not run.)
- Are async listeners awaited by `emit`? (No. `emit` is synchronous. `events.once` and `events.on` give promise and async-iterator forms.)
