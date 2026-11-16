# Cheatsheet: event loop and async

Full lessons: [07 Async](../lessons/07-async-javascript/README.md), [08 Event loop](../lessons/08-event-loop/README.md)

## Order of execution (CommonJS main script)

1. Synchronous code, to the end.
2. `process.nextTick` queue.
3. Promise / `queueMicrotask` queue (drained completely).
4. Event loop phases, round and round:

| Phase | Runs |
| --- | --- |
| timers | `setTimeout`, `setInterval` callbacks that are due |
| pending callbacks | some deferred system callbacks |
| poll | I/O callbacks; waits for new I/O |
| check | `setImmediate` callbacks |
| close | `close` events (for example `socket.on('close')`) |

After EVERY callback: nextTick queue, then microtasks.

```text
sync -> nextTick -> promise -> (timeout vs immediate: not guaranteed in main script)
Inside an I/O callback: setImmediate always runs before setTimeout(0)
```

## Rules of thumb

- `await` continues as a microtask. `await null` and an already-resolved promise both take one microtask tick.
- Never block the loop: no sync `fs`, big loops, huge JSON, risky regex in a server.
- Thread pool: 4 threads by default (`UV_THREADPOOL_SIZE`) for `fs`, `dns.lookup`, `crypto.pbkdf2`/`scrypt`, `zlib`. Sockets do not use it.
- Timers are "at least" delays, not exact.

## Promise combinators

| | Fulfils | Rejects |
| --- | --- | --- |
| `all` | all values | first rejection |
| `allSettled` | all outcomes | never |
| `race` | first settled | first settled if it rejects |
| `any` | first fulfilment | `AggregateError` if all reject |

## Patterns

```js
// parallel
const [a, b] = await Promise.all([getA(), getB()]);

// timeout + cancel
const res = await fetch(url, { signal: AbortSignal.timeout(2000) });

// sequential
for (const item of items) await process(item);

// async iteration
for await (const chunk of stream) { /* ... */ }
```

## Errors

- `await` + `try/catch`, or `.catch()`.
- A floating promise (no `await`, no `.catch`) escapes `try/catch` and may crash the process (unhandled rejection exits with code 1 on modern Node).
- `EventEmitter` does not await async listeners.
