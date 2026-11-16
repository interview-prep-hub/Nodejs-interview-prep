# 14. Error Handling and Debugging

> Level: Intermediate   Time: about 150 minutes   Node: 24 (notes where older versions differ)

[Previous: 13. Real-Time: WebSockets, Server-Sent Events and Polling](../13-realtime-websockets-sse/README.md) | [All lessons](../../README.md) | [Next: 15. Processes, Signals, child_process and Building CLIs](../15-processes-and-cli/README.md)

## What you will learn
- What an `Error` object really contains (`name`, `message`, `stack`, `cause`, `code`) and the built-in error types
- How `try`, `catch` and `finally` behave, including the surprising `return` inside `finally`
- The difference between operational errors (the world misbehaved) and programmer errors (your code is wrong), and what to do with each
- How errors travel through callbacks, promises, `async`/`await`, event emitters and streams, and why `try/catch` misses some of them
- How to write custom error classes with a `code`, a `statusCode` and a `cause` chain
- What Node does when nobody catches an error, how `uncaughtException` and `unhandledRejection` work, and the rule: log, then exit
- How to handle errors in one central place of an HTTP server, how to validate input, when to retry, and what "fail fast" and "error budget" mean
- The debugging toolbox (logging, `util.debuglog`, the inspector with Chrome DevTools and VS Code, stack traces, source maps, diagnostic reports) and the runtime errors you will meet again and again (`ECONNREFUSED`, `EADDRINUSE`, `ENOENT`, `EMFILE`, `ERR_MODULE_NOT_FOUND`, "heap out of memory")

**How the lesson is organised.** It is long, so use this map and take it in sittings:

| Sections | Topic |
|---|---|
| 1 to 5 | what an error is, the built-in kinds, throwing, `try/catch/finally`, operational vs programmer errors |
| 6 to 12 | how errors travel: callbacks, promises, `async`/`await`, custom classes, `cause`, emitters and streams |
| 13 to 15 | what Node does when nobody catches an error, the process-level events, "log, then exit" |
| 16 to 19 | servers and resilience: one central handler, validation, fail fast, error budgets, retries |
| 20 to 27 | debugging: logs, `debuglog`, the debugger, stack traces, source maps, reports, common errors, a method |
| 28 | the interview questions in one table |

**How to run the examples.**
- Run them from the repo root, for example `node lessons/14-error-handling-and-debugging/examples/01-error-anatomy.js`. They use only core modules and finish by themselves.
- Example `07` ends with exit code 1 **on purpose** (it shows a controlled crash).
- Files that start with an underscore (`_process-child.js`, `_debug-me.js`) are helpers that other files start, or practice files for the debugger.
- Snippets that use `await` live inside an `async function main()` in the example files.
- Some outputs contain a timing number or a process id that differs on every run. The text says so where it matters.

## 1. What an Error is

An **Error** is an object that describes something that went wrong. JavaScript creates errors for you (for example when you read a property of `undefined`), and you create your own with `new Error('message')`.

An error is just an object, so it has properties. These five matter:

| Property | What it holds | Notes |
|---|---|---|
| `name` | the kind of error, such as `"TypeError"` | lives on the prototype (the shared parent object that all errors of one type inherit from), so every `TypeError` shares it |
| `message` | a sentence for humans | what you pass to the constructor |
| `stack` | text: a header line, then one `at ...` line per function call | a V8 feature (V8 is the JavaScript engine inside Node), not part of the language standard |
| `cause` | the lower-level error that led to this one | set with `new Error('msg', { cause })` |
| `code` | a short, stable string such as `"ENOENT"` | not part of JavaScript. Node adds it to its errors, and you add it to yours |

```js
const err = new Error('Could not load profile', { cause: new Error('disk is full') });
err.code = 'E_PROFILE'; // custom extra property

console.log('  name    :', err.name);
console.log('  message :', err.message);
console.log('  code    :', err.code);
console.log('  cause   :', err.cause.message);
console.log('  stack[0]:', err.stack.split('\n')[0]);
console.log('  toString():', String(err));
console.log('  Object.keys:', Object.keys(err));
console.log('  JSON.stringify:', JSON.stringify(err));
console.log('  instanceof Error:', err instanceof Error, '| Error.isError:', Error.isError(err));
```

```text
  name    : Error
  message : Could not load profile
  code    : E_PROFILE
  cause   : disk is full
  stack[0]: Error: Could not load profile
  toString(): Error: Could not load profile
  Object.keys: [ 'code' ]
  JSON.stringify: {"code":"E_PROFILE"}
  instanceof Error: true | Error.isError: true
```

This is part 1 of `examples/01-error-anatomy.js`.

Look at the last three lines. `message`, `stack` and `cause` are **own but non-enumerable** properties. "Own" means they sit on the error object itself. "Non-enumerable" means loops, `Object.keys` and `JSON.stringify` skip them. Only `code`, which we added by plain assignment, shows up. That is why `JSON.stringify(err)` often gives `{}` and why logging an error with `JSON.stringify` loses the useful parts. Section 20 shows how to log errors properly.

The first line of `stack` is always `name: message`. Every line after it is one function call, newest call first. Together these lines are the **call stack**: the list of functions that were running at that moment, each one waiting for the function it called.

> **Interview tip:** match errors by `err.code` or by class (`instanceof`), never by `err.message`. Messages are written for humans and change between Node versions.

> **Remember:** `Error.isError(value)` (Node 24 and newer) is the reliable "is this a real error?" check. It also works for errors that come from another realm (section 11). On older Node versions use `value instanceof Error`.

## 2. Built-in error types, system errors and `ERR_` codes

JavaScript has a small family of error classes. All of them extend `Error`.

| Type | When it happens | A real message |
|---|---|---|
| `TypeError` | a value has the wrong type, or you call something that is not a function | `Cannot read properties of undefined (reading 'name')` |
| `RangeError` | a number is outside the allowed range, or functions call each other too deeply | `Invalid array length`, `Maximum call stack size exceeded` |
| `SyntaxError` | code or JSON text cannot be parsed | `Expected property name or '}' in JSON at position 1 (line 1 column 2)` |
| `ReferenceError` | you use a variable that does not exist | `notDefinedAnywhere is not defined` |
| `URIError` | bad input to `decodeURIComponent` and friends | `URI malformed` |
| `AggregateError` | several errors bundled in one (made by `Promise.any`) | `errors` is an array of the inner errors |
| `EvalError` | exists for history, modern engines never throw it | |

Here is how the example triggers them for real:

```js
const triggers = {
  TypeError: () => {
    const user = undefined;
    return user.name;
  },
  RangeError: () => new Array(-1),
  SyntaxError: () => JSON.parse('{bad json}'),
  ReferenceError: () => notDefinedAnywhere + 1,
  URIError: () => decodeURIComponent('%'),
};
for (const [label, run] of Object.entries(triggers)) {
  try {
    run();
  } catch (e) {
    console.log(`  ${label.padEnd(14)} name=${e.name} | ${e.message}`);
  }
}
const group = new AggregateError([new Error('first'), new TypeError('second')], 'Several things failed');
console.log('  AggregateError name=%s | %s | errors=%d', group.name, group.message, group.errors.length);
```

```text
  TypeError      name=TypeError | Cannot read properties of undefined (reading 'name')
  RangeError     name=RangeError | Invalid array length
  SyntaxError    name=SyntaxError | Expected property name or '}' in JSON at position 1 (line 1 column 2)
  ReferenceError name=ReferenceError | notDefinedAnywhere is not defined
  URIError       name=URIError | URI malformed
  AggregateError name=AggregateError | Several things failed | errors=2
```

Three more kinds show up all the time in Node code. The last part of `examples/01-error-anatomy.js` triggers them:

```js
function endless() {
  return endless() + 1;
}
try {
  endless();
} catch (e) {
  console.log(`  stack overflow: ${e.name}: ${e.message} (a normal error, you can catch it)`);
}
try {
  assert.equal(1, 2);
} catch (e) {
  console.log(`  assert        : ${e.name} | code ${e.code} | instanceof Error: ${e instanceof Error}`);
}
const controller = new AbortController();
controller.abort(); // cancel on purpose
const reason = controller.signal.reason;
console.log(`  abort         : ${reason.name} | code ${reason.code} | DOMException: ${reason instanceof DOMException} | Error: ${reason instanceof Error}`);
```

```text
  stack overflow: RangeError: Maximum call stack size exceeded (a normal error, you can catch it)
  assert        : AssertionError | code ERR_ASSERTION | instanceof Error: true
  abort         : AbortError | code 20 | DOMException: true | Error: true
```

- **Stack overflow** is a `RangeError` thrown when functions call each other too deeply (usually a recursion with no stop condition). It is an ordinary error, so `catch` works. Compare with "heap out of memory" in section 26, which cannot be caught.
- **`AssertionError`** is what `node:assert` throws (code `ERR_ASSERTION`). Tests and sanity checks use it.
- **`DOMException`** is the web-platform error class. Node uses it for cancellation: an aborted `AbortController` gives `AbortError` (code 20), and `AbortSignal.timeout()` gives `TimeoutError` (code 23, section 19). Both are `instanceof Error`.

### System errors

When the operating system says no (a file is missing, a port is busy), Node wraps that in a **system error**. It is a normal `Error` with extra properties:

| Property | Meaning |
|---|---|
| `code` | the symbolic name, such as `ENOENT` (no such file or directory) |
| `errno` | the same error as a negative number. The number depends on the operating system (it is `-4058` for `ENOENT` on Windows), so never compare it, use `code` |
| `syscall` | which operation failed, such as `open`, `listen`, `connect` |
| `path` | the file path involved (file system errors) |

```js
try {
  fs.readFileSync(path.join(os.tmpdir(), 'no-such-folder-14', 'missing.txt'));
} catch (e) {
  console.log('  code   :', e.code);
  console.log('  syscall:', e.syscall);
  console.log('  errno is a negative number:', e.errno < 0, '| name by number:', util.getSystemErrorName(e.errno));
}
```

```text
  code   : ENOENT
  syscall: open
  errno is a negative number: true | name by number: ENOENT
```

The codes you will see most often:

| Code | Meaning |
|---|---|
| `ENOENT` | no such file or directory (also: command not found when you start a program) |
| `EACCES` | permission denied |
| `EEXIST` | the file already exists |
| `EMFILE` | this process has too many open files |
| `EADDRINUSE` | the port is already taken |
| `ECONNREFUSED` | nothing is listening at that address and port |
| `ECONNRESET` | the other side closed the connection abruptly |
| `ETIMEDOUT` | the operation took too long |
| `ENOTFOUND` | DNS could not find the host name |
| `EPIPE` | you wrote to a pipe or socket whose reader is gone |

### Errors made by Node itself

Errors thrown by Node's own APIs carry a `code` that starts with `ERR_`. They are stable, documented, and safe to match on.

```js
try {
  fs.readFileSync({ not: 'a path' });
} catch (e) {
  console.log('  name   :', e.name);
  console.log('  code   :', e.code);
}
```

```text
  name   : TypeError
  code   : ERR_INVALID_ARG_TYPE
```

The stack header shows both: `TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must b...`. `ERR_INVALID_ARG_TYPE` always means you passed the wrong kind of value, so it is a programmer error (section 5).

> **Interview tip:** "How do you recognise a Node system error?" Strong answer: "It is a normal `Error` with a `code` such as `ENOENT` or `EADDRINUSE`, plus `errno`, `syscall` and often `path`. I branch on `err.code`, never on the message or the `errno` number (which differs per operating system). Errors thrown by Node's own APIs use stable `ERR_...` codes."

## 3. You can throw anything, but always throw an Error

JavaScript lets you `throw` any value: a string, a number, an object, even `null`. Do not.

```js
for (const thrown of ['oops', 42, { code: 7 }, null]) {
  try {
    throw thrown;
  } catch (e) {
    console.log(`  threw ${JSON.stringify(thrown)}: typeof=${typeof e}, has stack=${Boolean(e && e.stack)}`);
  }
}
```

```text
  threw "oops": typeof=string, has stack=false
  threw 42: typeof=number, has stack=false
  threw {"code":7}: typeof=object, has stack=false
  threw null: typeof=object, has stack=false
```

A thrown string has **no stack**, so you cannot tell where it came from. Code that does `catch (e) { console.log(e.message) }` prints `undefined`. And Node reports a rejected promise with a non-error as `UnhandledPromiseRejection` with the code `ERR_UNHANDLED_REJECTION` (section 13). If you ever have to find who threw a plain string, section 23 shows the flag `--trace-uncaught`.

> **Interview tip:** "Can you throw a string in JavaScript?" Strong answer: "Yes, any value can be thrown, but you should not. A string has no `stack`, no `name` and no `cause`, so logs are useless and `instanceof` checks fail. Always `throw new Error(...)` or a subclass, and reject promises with `Error` objects too."

Because a library might still throw a non-error, many codebases normalize in one place:

```js
function toError(value) {
  if (Error.isError(value)) return value;
  return new Error(typeof value === 'string' ? value : `Non-error thrown: ${util.inspect(value)}`);
}
console.log('  toError({ code: 7 }).message =', toError({ code: 7 }).message);
```

```text
  toError({ code: 7 }).message = Non-error thrown: { code: 7 }
```

### The stack is captured at creation, not at throw

```js
function makeIt() {
  return new Error('made here');
}
function throwIt(e) {
  throw e;
}
try {
  throwIt(makeIt());
} catch (e) {
  const frames = e.stack.split('\n').slice(1, 3).map((line) => line.trim().split(' ')[1]);
  console.log('  top frames:', frames);
}
```

```text
  top frames: [ 'makeIt', 'Object.<anonymous>' ]
```

The top frame is `makeIt`, where `new Error` ran, not `throwIt`, where `throw` ran. Creating an error without throwing it does nothing at all: `new Error('x');` alone is a no-op, a common beginner bug.

## 4. `try`, `catch` and `finally`

`try` runs code that might fail. If it throws, `catch` runs with the error. `finally` runs **always**, success or failure.

```js
function flow(fail) {
  const steps = [];
  try {
    steps.push('try');
    if (fail) throw new Error('boom');
    steps.push('try end');
  } catch (e) {
    steps.push(`catch(${e.message})`);
  } finally {
    steps.push('finally');
  }
  steps.push('after');
  return steps.join(' > ');
}
console.log('  no error:', flow(false));
console.log('  error   :', flow(true));
```

```text
  no error: try > try end > finally > after
  error   : try > catch(boom) > finally > after
```

This is part 1 of `examples/02-try-catch-finally.js`. Parts 2 to 4 show the gotchas interviewers love.

### `finally` runs even when `try` returns

```js
function returnInTry() {
  try {
    return 'value from try';
  } finally {
    console.log('  (finally still ran before the function returned)');
  }
}
console.log('  result:', returnInTry());
```

```text
  (finally still ran before the function returned)
  result: value from try
```

JavaScript computes the return value, runs `finally`, and then returns. That makes `finally` the right place to close files, stop timers and release locks.

### A `return` inside `finally` wins and hides the error

```js
function swallow() {
  try {
    throw new Error('this error is lost');
  } finally {
    return 'finally won';
  }
}
console.log('  result:', swallow());
```

```text
  result: finally won
```

The error is **gone**: no crash, no log. A `return` (or `break` or `continue`) in `finally` overrides whatever `try` or `catch` did, including a throw. A `throw` inside `finally` replaces the original error in the same way (part 4 of the example prints `caught: from finally`). A **linter** (a tool that scans code for likely bugs and style problems) flags this with the rule `no-unsafe-finally`. Keep `finally` for cleanup only.

> **Interview tip:** "What does `try { return 1 } finally { return 2 }` return?" Strong answer: "`2`. `finally` always runs last and its `return` wins. A `return` in `finally` even cancels a pending `throw`, which is why you never put one there."

### Catch only what you can handle

```js
function parseConfig(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    if (e instanceof SyntaxError) return {}; // expected problem: fall back to defaults
    throw e; // anything else is a surprise: do not hide it
  }
}
console.log('  bad json  ->', parseConfig('{oops'));
console.log('  good json ->', parseConfig('{"port":3000}'));
try {
  parseConfig(Symbol('not text')); // a TypeError: a bug in the caller, so parseConfig rethrows it
} catch {
  console.log('  catch without (e) works when you do not need the error object');
}
```

```text
  bad json  -> {}
  good json -> { port: 3000 }
  catch without (e) works when you do not need the error object
```

`catch { ... }` without `(e)` is called an **optional catch binding**. Use it when you do not need the error. The rule of thumb: check what kind of error you got, handle the ones you expect, and `throw e` again for the rest.

> **Common mistake:** `catch (e) {}` with an empty body. It swallows the error and the bug becomes invisible. Either handle it, log it, or rethrow it.

### Cleanup in `finally`, and the `using` shortcut

```js
let fd;
try {
  fd = fs.openSync(file, 'r');
  console.log('  opened the file, reading...');
  throw new Error('read failed halfway');
} catch (e) {
  console.log('  caught:', e.message);
} finally {
  if (fd !== undefined) fs.closeSync(fd);
  console.log('  file closed in finally');
}
```

```text
  opened the file, reading...
  caught: read failed halfway
  file closed in finally
```

Node 24 (V8 13.6) also supports **explicit resource management**: a `using` declaration calls `[Symbol.dispose]()` when the block ends, even if an error was thrown, in reverse order.

```js
class Connection {
  constructor(name) {
    this.name = name;
    console.log(`  open ${name}`);
  }
  [Symbol.dispose]() {
    console.log(`  close ${this.name}`);
  }
}
function runQuery() {
  using db = new Connection('db'); // closed automatically, even if an error is thrown
  using cache = new Connection('cache'); // closed first (reverse order)
  throw new Error('query failed');
}
try {
  runQuery();
} catch (e) {
  console.log('  caught:', e.message);
}
```

```text
  open db
  open cache
  close cache
  close db
  caught: query failed
```

This is part 8 of `examples/02-try-catch-finally.js`. Use `await using` with `[Symbol.asyncDispose]` for async cleanup.

## 5. Operational errors vs programmer errors

This split decides what you do with every error, so learn it well.

| | Operational error | Programmer error |
|---|---|---|
| Meaning | the program is right, the world is not | the program is wrong |
| Examples | file missing, network down, database busy, user sent bad input, timeout | calling `undefined()`, wrong argument type, typo in a variable name, reading a property of `undefined` |
| Typical types | system errors (`ENOENT`, `ECONNREFUSED`), your own `ValidationError`, `NotFoundError` | `TypeError`, `ReferenceError`, `RangeError`, `ERR_INVALID_ARG_TYPE` |
| Will a retry help? | often yes | never: the same code fails the same way |
| What to do | handle it: retry, fall back, or tell the user clearly | log it with the stack, then crash and restart (section 15). Fix the code |

```js
function classify(e) {
  if (e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError) {
    return 'programmer bug: log it, fix the code';
  }
  if (e instanceof SyntaxError) return 'depends: bad input is operational, a typo in your code is a bug';
  if (typeof e.code === 'string' && /^E[A-Z]+$/.test(e.code)) return 'operational: handle it';
  return 'unknown: treat as a bug until proven otherwise';
}
```

```text
  Error ENOENT                   -> operational: handle it
  TypeError                      -> programmer bug: log it, fix the code
  TypeError ERR_INVALID_ARG_TYPE -> programmer bug: log it, fix the code
  SyntaxError                    -> depends: bad input is operational, a typo in your code is a bug
  Error                          -> unknown: treat as a bug until proven otherwise
```

This is part 7 of `examples/02-try-catch-finally.js`.

The type is only a hint. The real question is **where did the bad value come from?** A `SyntaxError` from `JSON.parse(userInput)` is operational (the user sent bad JSON). A `SyntaxError` from your own `new Function(...)` is a bug. In your own code, make it explicit with a flag such as `isOperational` (section 10).

> **Interview tip:** this is a classic question: "How do you handle errors in Node?" A strong answer separates the two kinds. Operational errors are expected and handled close to where they happen. Programmer errors mean the process is in an unknown state, so you log and restart instead of trying to continue.

## 6. Error-first callbacks

Before promises, Node used **callbacks**: you pass a function that Node calls when the work is done. By convention the first argument is the error (or `null`) and the second is the result. This is the **error-first callback** pattern.

```js
fs.readFile(missing, 'utf8', (err, data) => {
  if (err) {
    console.log('  callback got err.code =', err.code, '| data =', data);
    return; // "return" stops the function: a classic bug is forgetting it
  }
  console.log(data);
});
```

```text
  callback got err.code = ENOENT | data = undefined
```

This is part 1 of `examples/03-async-errors.js`. The rules:

1. Check `err` first, always.
2. `return` right after you handle it. Without `return`, the code below runs with `data` undefined.
3. Call the callback **once**. Calling it twice (once in an `if`, once after) is a common bug.
4. Never `throw` inside the callback of an async API: nobody can catch it (next section).

`util.promisify(fs.readFile)` turns an error-first function into one that returns a promise: the `err` becomes a rejection. Most core modules also have a ready-made promise version, such as `fs/promises`.

> **Interview tip:** "Why is the error the first argument?" Strong answer: "So it can never be forgotten or confused with the result: the callback always has the same shape, `(err, result)`, and the first thing you do is check `err`. On success `err` is `null`. A callback should be called exactly once, and it should never `throw`, because the caller's `try/catch` is long gone (next section)."

## 7. Why `try/catch` misses errors thrown later

A `try/catch` only catches errors thrown **while its block is running**, on the same call stack. A timer callback runs later, on a fresh call stack, after the `try` block is long finished.

```js
process.once('uncaughtException', (err, origin) => {
  console.log(`  process-level handler got: "${err.message}" (origin: ${origin})`);
});
try {
  setTimeout(() => {
    throw new Error('thrown from a timer');
  }, 5);
  console.log('  try block finished normally, the timer has not fired yet');
} catch (e) {
  console.log('  never printed:', e.message);
}
```

```text
  try block finished normally, the timer has not fired yet
  process-level handler got: "thrown from a timer" (origin: uncaughtException)
```

This is part 2 of `examples/03-async-errors.js`. We registered an `uncaughtException` handler only to prove who receives the error: without it, the process would crash. The `catch` never runs.

> **Under the hood:** a `try/catch` only works while its block is on the call stack. When the timer fires, the event loop starts your callback with an empty call stack (lesson 08), so there is no `try` underneath it to catch anything. The same is true for `setImmediate`, `process.nextTick`, I/O callbacks and listeners that Node fires for you (such as a stream's `'data'` event). Put the `try/catch` **inside** the callback, or use promises.

## 8. Promises and `async`/`await`

With promises, a thrown error inside a `.then` callback becomes a **rejection**, and `.catch` handles it. The chain jumps over `.then` steps until it finds a `.catch`.

```js
const result = await Promise.resolve(1)
  .then((n) => {
    if (n === 1) throw new Error('step 1 failed');
    return n;
  })
  .then(() => console.log('  skipped: the chain jumps over this'))
  .catch((e) => {
    console.log('  .catch got:', e.message);
    return 'recovered value'; // returning a value turns the chain back to success
  })
  .finally(() => console.log('  .finally runs either way'));
console.log('  chain result:', result);
```

```text
  .catch got: step 1 failed
  .finally runs either way
  chain result: recovered value
```

Two details: a `.catch` that returns a value **recovers** the chain, and `.finally` runs either way but does not change the result. Also, `.then(onOk, onFail)` is not the same as `.then(onOk).catch(onFail)`: with the two-argument form, `onFail` cannot catch an error thrown by `onOk`.

With `async`/`await`, errors look like normal synchronous code: `try/catch` around an `await` catches the rejection.

```js
try {
  await fs.promises.readFile(missing, 'utf8');
} catch (e) {
  console.log('  caught:', e.code);
}
```

```text
  caught: ENOENT
```

### An `async` function never throws synchronously

```js
async function broken() {
  throw new Error('inside async');
}
let promise;
try {
  promise = broken(); // no await here, so try/catch has nothing to catch
  console.log('  no sync error. broken() returned a promise:', promise instanceof Promise);
} catch {
  console.log('  never printed');
}
await promise.catch((e) => console.log('  but .catch sees it:', e.message));
```

```text
  no sync error. broken() returned a promise: true
  but .catch sees it: inside async
```

A throw inside an `async` function becomes a rejected promise. If you forget `await`, the `try/catch` around the call is useless, and if nobody attaches a `.catch` the rejection is **unhandled** and crashes the process on Node 24 (section 13).

### `return promise` versus `return await promise`

```js
const failLater = async () => {
  await sleep(1);
  throw new Error('failed later');
};
async function withoutAwait() {
  try {
    return failLater(); // the promise leaves the try block before it fails
  } catch {
    return 'caught inside';
  }
}
async function withAwait() {
  try {
    return await failLater(); // waits inside the try, so catch can see the error
  } catch {
    return 'caught inside';
  }
}
console.log('  without await:', await withoutAwait().catch((e) => `NOT caught inside (caller got: ${e.message})`));
console.log('  with await   :', await withAwait());
```

```text
  without await: NOT caught inside (caller got: failed later)
  with await   : caught inside
```

Outside of `try`, `return promise` and `return await promise` behave the same. **Inside** a `try` block you need `return await` if you want the `catch` to run. This is a favorite interview trap.

> **Common mistake:** `array.forEach(async (x) => { await work(x); })`. `forEach` ignores the promises its callback returns, so errors become unhandled rejections and nothing waits for the work. Use `for ... of` with `await`, or `await Promise.all(array.map(async (x) => ...))`.

### A promise executor catches a throw while it runs, but not a later one

The function you pass to `new Promise((resolve, reject) => ...)` is called the **executor**. If it throws while it is running, the promise rejects, and `.catch` sees it. But if the throw happens later, from a timer or another callback that the executor started, the executor is already finished. Nothing catches it, and it behaves like section 7.

```js
await new Promise((resolve, reject) => {
  throw new Error('thrown while the executor runs'); // turned into a rejection for us
}).catch((e) => console.log('  .catch received:', e.message));

new Promise(() => {
  setTimeout(() => {
    throw new Error('thrown from a timer inside an executor');
  }, 1);
}).catch((e) => console.log('  never printed:', e.message));
```

```text
  .catch received: thrown while the executor runs
  uncaughtException received: "thrown from a timer inside an executor" (origin: uncaughtException)
```

This is part 8 of `examples/03-async-errors.js`. The second line comes from a one-time `uncaughtException` handler that the example registers to catch the stray error (without it the process would crash). The fix inside an executor is to call `reject(err)` from the callback instead of throwing. Better still, wrap the callback API once with `util.promisify` or use the promise version of the API (`timers/promises`, `fs/promises`).

## 9. Many promises: `all`, `allSettled`, `any`

| Combinator | Succeeds when | Fails when |
|---|---|---|
| `Promise.all` | all succeed | the **first** one rejects (the rest keep running, their results are ignored) |
| `Promise.allSettled` | always (never rejects) | never. You get `{ status, value }` or `{ status, reason }` for each |
| `Promise.any` | the first one succeeds | all reject: you get an `AggregateError` with `errors` |
| `Promise.race` | the first one settles with success | the first one settles with failure |

```js
await Promise.all([ok('a'), bad('b failed'), ok('c')]).catch((e) => console.log('  all        -> rejects fast with:', e.message));

const settled = await Promise.allSettled([ok('a'), bad('b failed'), ok('c')]);
console.log('  allSettled ->', settled.map((s) => (s.status === 'fulfilled' ? s.value : `x(${s.reason.message})`)));

await Promise.any([bad('first'), bad('second')]).catch((e) => {
  console.log(`  any        -> ${e.name} with ${e.errors.length} errors:`, e.errors.map((x) => x.message));
});
```

```text
  all        -> rejects fast with: b failed
  allSettled -> [ 'a', 'x(b failed)', 'c' ]
  any        -> AggregateError with 2 errors: [ 'first', 'second' ]
```

This is part 6 of `examples/03-async-errors.js` (`ok` and `bad` are tiny helpers that resolve or reject after a short sleep). Use `allSettled` when you want every result even if some fail, for example when sending 10 independent emails and reporting which ones failed.

> **Interview tip:** "`Promise.all` rejected. What happened to the other promises?" Strong answer: "Nothing stops them. They keep running and their results are ignored, and if one of them rejects later, that rejection is already handled by `all`, so it does not crash the process. If I need every outcome, or want to clean up after the ones that succeeded, I use `allSettled`."

## 10. Custom error classes

The built-in types are too vague for a real application. "Something threw a `TypeError`" does not tell the caller what to do. A **custom error class** gives each failure its own name, a stable `code`, and (in a server) the HTTP status to answer with.

```js
class AppError extends Error {
  constructor(message, { code = 'E_APP', statusCode = 500, details, cause, isOperational = true } = {}) {
    super(message, cause === undefined ? undefined : { cause }); // the 2nd argument stores err.cause
    this.name = new.target.name; // "NotFoundError", not just "Error"
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, new.target);
  }

  // JSON.stringify(err) normally drops message and stack. This makes the error safe to send to a client.
  toJSON() {
    return { name: this.name, code: this.code, message: this.message, details: this.details };
  }
}

class NotFoundError extends AppError {
  constructor(what, options) {
    super(`${what} was not found`, { code: 'E_NOT_FOUND', statusCode: 404, ...options });
  }
}
```

```js
const nf = new NotFoundError('User 42');
console.log('  name      :', nf.name);
console.log('  message   :', nf.message);
console.log('  code      :', nf.code, '| statusCode:', nf.statusCode);
console.log('  stack[0]  :', nf.stack.split('\n')[0]);
console.log('  toString():', String(nf));
console.log('  JSON      :', JSON.stringify(nf));
```

```text
  name      : NotFoundError
  message   : User 42 was not found
  code      : E_NOT_FOUND | statusCode: 404
  stack[0]  : NotFoundError: User 42 was not found
  toString(): NotFoundError: User 42 was not found
  JSON      : {"name":"NotFoundError","code":"E_NOT_FOUND","message":"User 42 was not found"}
```

This is part 1 of `examples/04-custom-errors.js` (the full class hierarchy with `ValidationError` and `DatabaseError` is in the file). Points to notice:

- `extends Error` and `super(message)` are required. Without `super` the class does not work.
- `new.target` is the class that `new` was called on, so `new.target.name` is the name of the class that was actually created (`NotFoundError`). One line in the base class names every subclass. If your build tool renames classes (minifiers do), set the name as a plain string in each class instead.
- Set `this.name`. If you forget, logs and stack traces just say `Error`:

```js
class Forgetful extends Error {} // no this.name
class Named extends Error {
  constructor(message) {
    super(message);
    this.name = 'Named'; // named, and no captureStackTrace call
  }
}
function createIt() {
  return new Named('x');
}
const firstLine = (e) => e.stack.split('\n')[0];
const topFrame = (e) => e.stack.split('\n')[1].trim().split(' ')[1];
console.log('  forgot the name      :', firstLine(new Forgetful('x')));
console.log('  set the name         :', firstLine(createIt()));
console.log('  top frame, no capture:', topFrame(createIt()), '(V8 already hides the constructor frame)');
```

```text
  forgot the name      : Error: x
  set the name         : Named: x
  top frame, no capture: createIt (V8 already hides the constructor frame)
```

This is part 3 of the example. The last line shows that the top frame is `createIt`, the code that wrote `new Named`, and not the constructor of `Named`.

`instanceof` walks the class chain, so one `catch` can handle a whole family:

```js
console.log('  nf instanceof NotFoundError    :', nf instanceof NotFoundError);
console.log('  nf instanceof AppError         :', nf instanceof AppError);
console.log('  nf instanceof Error            :', nf instanceof Error);
console.log('  nf instanceof ValidationError  :', nf instanceof ValidationError);
```

```text
  nf instanceof NotFoundError    : true
  nf instanceof AppError         : true
  nf instanceof Error            : true
  nf instanceof ValidationError  : false
```

> **Interview tip:** keep the hierarchy shallow. A base `AppError` plus a handful of subclasses (`NotFoundError`, `ValidationError`, `ConflictError`, `UnauthorizedError`) is plenty. Put the knowledge "what status should this become?" in the error itself (`statusCode`) so the central handler (section 16) stays short.

## 11. `cause` chains, `captureStackTrace`, and the `instanceof` caveat

### Wrapping with `cause`

When you catch a low-level error and throw a higher-level one, keep the original as the `cause`. Without it you lose the real reason.

```js
function saveOrder() {
  try {
    const low = new Error('connection reset by peer');
    low.code = 'ECONNRESET';
    throw low;
  } catch (cause) {
    throw new DatabaseError('Could not save the order', { cause });
  }
}
try {
  saveOrder();
} catch (err) {
  let level = 0;
  for (let e = err; e; e = e.cause) {
    console.log(`  ${'  '.repeat(level)}${e.name}${e.code ? ` [${e.code}]` : ''}: ${e.message}`);
    level++;
  }
  console.log('  util.inspect shows it too:', util.inspect(err).includes('[cause]'));
}
```

```text
  DatabaseError [E_DB]: Could not save the order
    Error [ECONNRESET]: connection reset by peer
  util.inspect shows it too: true
```

This is part 4 of `examples/04-custom-errors.js`. `console.log(err)` and an uncaught crash print the chain too, under a `[cause]:` label. The user sees "Could not save the order", the log shows the cause.

### `Error.captureStackTrace(obj, fn)`

`Error.captureStackTrace(target, fn)` is a V8 function that writes a `stack` property onto any object. If you pass a function as the second argument, the stack starts at the **caller** of that function: `fn` itself and everything newer than it (including the `captureStackTrace` call) are hidden. This removes helper frames, so the top frame points at the code that made the mistake.

```js
function assertPositive(n) {
  if (n > 0) return;
  const err = new RangeError(`expected a positive number, got ${n}`);
  Error.captureStackTrace(err, assertPositive); // frames from assertPositive upward are cut off
  throw err;
}
function checkout(total) {
  assertPositive(total);
}
try {
  checkout(-5);
} catch (e) {
  const top = e.stack.split('\n')[1].trim().split(' ')[1];
  console.log('  top frame points at the CALLER of the helper:', top);
}
```

```text
  top frame points at the CALLER of the helper: checkout
```

Many tutorials put `Error.captureStackTrace(this, this.constructor)` into every custom error constructor. On Node 24 this is **optional** for classes that `extends Error`: V8 already leaves the constructor frames out (part 3 of the example shows the top frame is the code that wrote `new`). It is harmless and common, so you will see it in older code. It still matters for helper functions like `assertPositive` above.

### `toJSON` for safe responses

`JSON.stringify(err)` is `{}` for a plain error because `message` is non-enumerable. A `toJSON()` method (like in `AppError`) decides exactly what goes to the client. Never send `stack` to a client: it reveals file paths and code structure.

### `instanceof` can lie across realms and duplicate packages

A **realm** is a separate JavaScript world with its own copy of `Error`, for example an `iframe` in a browser or a context from `node:vm`. An error created in another realm is **not** `instanceof` your realm's `Error`.

```js
const foreign = vm.runInNewContext('new Error("made in another realm")');
console.log('  foreign instanceof Error     :', foreign instanceof Error);
console.log('  Error.isError(foreign)       :', Error.isError(foreign));
console.log('  util.types.isNativeError     :', util.types.isNativeError(foreign));
console.log('  Object.prototype.toString    :', Object.prototype.toString.call(foreign));

// Two copies of "the same" class (for example two installed versions of one package) are different classes.
const makeClass = () => class ApiError extends Error {};
const CopyA = makeClass();
const CopyB = makeClass();
console.log('  new CopyA() instanceof CopyB :', new CopyA('x') instanceof CopyB);
```

```text
  foreign instanceof Error     : false
  Error.isError(foreign)       : true
  util.types.isNativeError     : true
  Object.prototype.toString    : [object Error]
  new CopyA() instanceof CopyB : false
```

The same thing happens when `node_modules` contains two copies of a library: its error class exists twice, and `instanceof` fails between them. The safe checks across such boundaries are `Error.isError(x)`, `util.types.isNativeError(x)`, or comparing a stable `code`. That is one more reason to give every error a `code`.

> **Interview tip:** "When does `err instanceof MyError` return false even though it is a `MyError`?" Strong answer: "When the error was created by a different copy of the class: another realm (`vm` context, iframe) or a second installed version of the same package. So for errors that cross a package boundary I check a stable `err.code` or `err.name` instead of relying on `instanceof` alone."

## 12. Error events: EventEmitter and streams

An **EventEmitter** (lesson 09) announces things with `emit(name, ...args)`. The event name `'error'` is special: if you emit `'error'` and nobody listens, Node **throws** the error. Streams are emitters, so a stream error is an `'error'` event.

```js
const plain = new EventEmitter();
try {
  plain.emit('error', new Error('nobody was listening'));
} catch (e) {
  console.log('  emit threw:', e.message);
}
plain.on('error', (e) => console.log('  with a listener it is just an event:', e.message));
plain.emit('error', new Error('now handled'));
```

```text
  emit threw: nobody was listening
  with a listener it is just an event: now handled
```

This is part 1 of `examples/05-emitter-and-stream-errors.js`. If you emit `'error'` with something that is not an `Error`, Node throws `ERR_UNHANDLED_ERROR` instead and keeps your value in `err.context`.

**The rule:** every emitter that can fail needs an `'error'` listener. A failing stream (`fs.createReadStream` of a missing file) emits `'error'` and is destroyed:

```text
  read stream error: ENOENT | destroyed: true
```

### `.pipe()` forgets errors, `pipeline()` does not

When you connect streams with `.pipe()`, an error in the source is **not** passed on, and the destination stays open (a leak). `stream.pipeline()` forwards the first error and destroys every stream in the chain.

```js
// .pipe(): the destination is left open
source.on('error', (e) => { /* ... */ });
source.pipe(dest);

// pipeline(): one place to catch, everything is cleaned up
try {
  await pipeline(flaky(), dest2);
} catch (e) {
  console.log('  pipeline rejected with:', e.message);
  console.log('  destination destroyed?', dest2.destroyed);
}
```

```text
  source error: "source broke at chunk 3"
  destination destroyed? false (still open: a leak waiting to happen)
  pipeline rejected with: source broke at chunk 3
  destination destroyed? true
```

The first two lines come from the `.pipe()` case and the last two from `pipeline()`. Always prefer `pipeline` from `node:stream/promises` (lesson 11).

### Other error routes on emitters

- **`captureRejections`**: an `async` listener that throws is a rejected promise, which `emit` ignores. Create the emitter with `{ captureRejections: true }` and the rejection is sent to the `'error'` event.
- **`events.once(emitter, 'ready')`** rejects if the emitter emits `'error'` first.
- **`EventEmitter.errorMonitor`** lets you log every error without handling it: the error is still thrown if there is no `'error'` listener.

```text
  routed to the error event: async listener failed
  once() rejected with: failed before ready
  monitor saw: still unhandled
  and it still threw: still unhandled
```

> **Interview tip:** "What happens if an `EventEmitter` emits `'error'` and nobody listens?" Strong answer: "Node throws the error, so it becomes an uncaught exception and the process exits with code 1. That is by design: an `'error'` event nobody handles is a failure nobody noticed. Streams, sockets and child processes are emitters, so each one needs an `'error'` listener, or I use `pipeline()` which does it for me."

### Where does the error show up? A cheat sheet

Different Node APIs report failure in different ways. This table is the whole lesson in one picture.

| The API is... | The error arrives as... | You handle it with |
|---|---|---|
| a plain (synchronous) function | a `throw` | `try/catch` |
| callback based (`fs.readFile(file, cb)`) | the first argument, `err` | `if (err) ...` inside the callback |
| promise based, or an `async` function | a rejected promise | `try/catch` around `await`, or `.catch()` |
| an emitter, stream, socket or child process (`spawn`) | an `'error'` event | `emitter.on('error', ...)` |
| an HTTP server | `server.on('error')` for the server itself (such as `EADDRINUSE`), `'error'` events on requests, responses and sockets | listeners, plus one central handler for your routes (section 16) |
| `fetch` | a rejection for network failures only. A `404` or `500` is a normal response | `try/catch`, then check `res.ok` |
| a worker thread (lesson 18) | an `'error'` event on the `Worker` object, then `'exit'` | `worker.on('error', ...)` |
| a child process that dies (lesson 15) | an `'exit'` event with a code or a signal | `child.on('exit', ...)` |

## 13. When nobody catches an error: Node's defaults

If an error is not caught, it reaches the **process level**. What happens next depends on the kind of failure. These are the defaults on Node 24, measured by running each case in a **child process** (a second Node process started by the first one, so a crash does not end the experiment).

Two words you need: **stderr** is the error output stream, where Node writes crash reports (normal `console.log` output goes to **stdout**). The **exit code** is the number a process hands back to whoever started it: `0` means success, anything else means failure.

| Situation | Result |
|---|---|
| uncaught `throw` (sync, or inside a timer or callback) | stack printed to stderr, **exit code 1** |
| promise rejected, nobody attached a handler | the same: stack printed, **exit code 1**, timers that were waiting never run |
| rejection with a non-Error (`Promise.reject('x')`) | error `UnhandledPromiseRejection` with code `ERR_UNHANDLED_REJECTION`, exit code 1 |
| `emit('error', err)` with no listener | throws, so exit code 1 |
| the process ends normally | exit code 0, or the number you put in `process.exitCode` |

This is what an uncaught error looks like (paths shortened; the `node:internal` lines depend on the Node version):

```text
<repo>/lessons/14-error-handling-and-debugging/examples/_process-child.js:16
    throw new Error('top-level throw');
    ^

Error: top-level throw
    at Object.<anonymous> (<repo>/lessons/14-error-handling-and-debugging/examples/_process-child.js:16:11)
    at Module._compile (node:internal/modules/cjs/loader:1854:14)
    at Object..js (node:internal/modules/cjs/loader:1985:10)
    at Module.load (node:internal/modules/cjs/loader:1577:32)
    at Module._load (node:internal/modules/cjs/loader:1379:12)
    at wrapModuleLoad (node:internal/modules/cjs/loader:255:19)
    at Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:154:5)
    at node:internal/main/run_main_module:33:47

Node.js v24.16.0
```

You can reproduce it with `node lessons/14-error-handling-and-debugging/examples/_process-child.js throw`. Read it from the top: the **file and line** of the throw, the **source line** with a caret under it, a blank line, then `Error: message` and the stack, and finally the Node version.

A rejected promise with a plain string produces a different report, because there is no stack to show:

```text
node:internal/process/promises:392
      new UnhandledPromiseRejection(reason);
      ^

UnhandledPromiseRejection: This error originated either by throwing inside of an async function without a catch block, or by rejecting a promise which was not handled with .catch(). The promise rejected with the reason "a plain string, not an Error".
    at throwUnhandledRejectionsMode (node:internal/process/promises:392:7)
    at processPromiseRejections (node:internal/process/promises:475:17)
    at process.processTicksAndRejections (node:internal/process/task_queues:106:37) {
  code: 'ERR_UNHANDLED_REJECTION'
}

Node.js v24.16.0
```

Run it with `node lessons/14-error-handling-and-debugging/examples/_process-child.js reject-string`. (The helper file also prints one extra line, `exit event, code 1`, from its own `exit` listener; it is not part of Node's report.) Note the stack points into Node, not into your code. This is one more reason to always reject with real `Error` objects.

### Exit codes worth knowing

| Code | Meaning |
|---|---|
| `0` | success |
| `1` | uncaught exception, unhandled rejection (default mode), or a syntax error when loading a file |
| `7` | the `uncaughtException` handler itself threw an error |
| `9` | invalid command line argument, such as an unknown flag |
| `13` | top-level `await` that never settles (ES modules only) |
| `134` | the process aborted, for example "heap out of memory" (measured on Windows; it is `128 + 6`, the number of `SIGABRT`). The Node docs also list code `5` for a fatal V8 error, but the heap out-of-memory crash we measured ended with 134 |
| `128 + N` | on Linux and macOS, killed by signal number N (for example 137 for `SIGKILL`) |

> **Remember:** a **pending promise does not keep Node alive**. In a CommonJS file, `await new Promise(() => {})` at the end of your code just lets the process exit with code 0. In an ES module with top-level `await`, Node detects the stuck program and exits with code 13 and a warning.

## 14. `uncaughtException`, `unhandledRejection` and friends

Node lets you listen for failures at the process level. Four events matter.

| Event | When it fires | Arguments |
|---|---|---|
| `uncaughtException` | a thrown error reached the top without a `catch` | `(err, origin)` where `origin` is `'uncaughtException'` or `'unhandledRejection'` |
| `uncaughtExceptionMonitor` | same moment, but it only **observes**: the crash still happens | `(err, origin)` |
| `unhandledRejection` | a promise was rejected and no handler was attached to it in time (before the next turn of the event loop) | `(reason, promise)` |
| `rejectionHandled` | a handler was attached to a rejected promise **after** `unhandledRejection` fired | `(promise)` |

`examples/06-process-handlers.js` runs twelve scenarios, each in its own child process (`_process-child.js` holds the scenarios), and prints the real exit code:

```text
exit  scenario
----  --------
1     uncaught throw, no handler (stopped)
        stderr: Error: top-level throw
1     unhandled rejection, no handler (stopped)
        stderr: Error: rejected and nobody handled it
1     rejection with a non-Error value (stopped)
        stderr: UnhandledPromiseRejection: This error originated either by throwing insi...
1     emit('error') with no listener (stopped)
        stderr: Error: emitter error with no listener
0     unhandledRejection handler registered (survived)
        stdout: unhandledRejection handler: rejected but a handler exists
0     catch attached late (survived)
        stdout: unhandledRejection: handled too late
        stdout: rejectionHandled: a catch was attached later
0     uncaughtException handler registered (survived)
        stdout: uncaughtException handler: thrown inside a timer (uncaughtException)
0     rejection, only uncaughtException handler (survived)
        stdout: uncaughtException handler: rejection with only an uncaughtException handler (unhandledRejection)
1     uncaughtExceptionMonitor only (stopped)
        stdout: monitor saw: crash after the monitor looked (uncaughtException)
        stderr: Error: crash after the monitor looked
1     handler logs, then process.exit(1) (stopped)
        stdout: fatal: unknown failure
0     same as "reject" but with --unhandled-rejections=warn (survived)
        stderr: UnhandledPromiseRejectionWarning: Error: rejected and nobody handled it
3     process.exitCode = 3 (survived)
```

"Survived" means a timer set 50 ms later still ran. What the table teaches:

1. **No handler means a crash with exit code 1**, for throws and for rejections. Since Node 15 the default for unhandled rejections is to throw (older versions only printed a warning).
2. **A handler for `unhandledRejection` stops the crash.** The process continues and exits with 0. That is dangerous if all your handler does is log.
3. **An `uncaughtException` handler also catches unhandled rejections** (with `origin` set to `'unhandledRejection'`) when there is no `unhandledRejection` handler.
4. **`rejectionHandled`** fires when you attach `.catch` too late: the rejection was first reported as unhandled, then handled. It is mostly useful to retract a log line.
5. **`uncaughtExceptionMonitor`** never prevents the crash. Use it to flush a last log line or report to an error tracker.
6. If the `uncaughtException` handler itself throws, Node exits with code 7.

### The `--unhandled-rejections` modes

You can change the default mode with a command line flag (the second to last row of the table above used `--unhandled-rejections=warn`).

| Mode | Behaviour |
|---|---|
| `throw` (default) | emit `unhandledRejection`; if there is no handler, raise the rejection as an uncaught exception (crash) |
| `strict` | raise it as an uncaught exception first; if that is handled, emit `unhandledRejection` |
| `warn` | print a warning, never crash (an `unhandledRejection` handler still runs) |
| `warn-with-error-code` | emit `unhandledRejection`; if there is no handler, warn and set the exit code to 1 |
| `none` | silence everything |

Leave the default (`throw`) alone. A process that keeps running after an unexpected rejection is in an unknown state.

You may read about the `domain` module in old articles: it tried to catch errors for a group of operations. It is deprecated in the documentation. Do not use it. Modern Node code uses `async`/`await`, one central handler, and a process restart.

> **Interview tip:** asked "What happens on an unhandled promise rejection in current Node?" answer: "The process prints the error and exits with code 1, unless an `unhandledRejection` or `uncaughtException` handler exists. Since Node 15 the default mode is `throw`."

## 15. The rule: log, then exit, and let a supervisor restart you

After an `uncaughtException` the program is in an **unknown state**. Maybe a half-written file, a half-updated object, a lock never released. If you carry on, you may serve wrong answers or corrupt data. The safe rule is:

1. **Log** the error with everything you know (one structured line, section 20).
2. **Clean up** briefly: stop accepting new work, let running requests finish.
3. **Exit** with a non-zero code.
4. A **supervisor** (systemd, Docker's restart policy, Kubernetes, pm2) starts a fresh, clean process.

A **supervisor** is a program whose only job is to watch your process and start it again when it dies. "Let it crash" is not carelessness. It is a design that relies on a quick, clean restart.

```js
let shuttingDown = false;

// One function handles every fatal error: log it, stop taking new work, set the exit code, let the process drain.
function fatal(err, origin) {
  if (shuttingDown) return; // a second error during shutdown must not start a second shutdown
  shuttingDown = true;

  // 1. Log first, as one structured line.
  console.error(JSON.stringify({ level: 'fatal', origin, name: err.name, message: err.message }));

  // 2. Safety net: if cleanup hangs, force the exit after 2 seconds. unref() so this timer never keeps the process alive.
  setTimeout(() => process.exit(1), 2000).unref();

  // 3. Stop accepting new connections. Requests already running get a chance to finish.
  server.close(() => console.log('server closed, process will exit with code 1'));
  server.closeIdleConnections();

  // 4. Set the code and let the event loop empty by itself (no process.exit, so pending output is not cut off).
  process.exitCode = 1;
}

process.on('uncaughtException', (err, origin) => fatal(err, origin));
process.on('unhandledRejection', (reason) => fatal(reason instanceof Error ? reason : new Error(String(reason)), 'unhandledRejection'));
```

Run `examples/07-crash-log-then-exit.js`. It starts a server, makes one good request, then lets a background promise fail:

```text
server is up
request before the bug: 200 ok
a background job fails now...
{"level":"fatal","origin":"unhandledRejection","name":"Error","message":"background sync failed"}
server closed, process will exit with code 1
exit event: the process ends now with code 1
```

The JSON line goes to stderr and the rest to stdout, so in a terminal they appear together as shown. The exit code is 1 (check it with `echo $?` in bash or `$LASTEXITCODE` in PowerShell). The checker treats this example as "expected to fail" because of the `// @expect-fail` line at the top.

The last line comes from a tiny listener the example registers for the `'exit'` event:

```js
process.on('exit', (code) => console.log(`exit event: the process ends now with code ${code}`));
```

`'exit'` is the very last chance to run code. Only **synchronous** work is possible in it: the event loop has stopped, so timers and I/O you start there never run. Use it for a final log line, not for cleanup that needs `await`. (The `'beforeExit'` event is different: it fires when the loop runs empty but the process could still continue. It does not fire after a crash or after `process.exit()`.)

Why not just call `process.exit(1)` in the handler? `process.exit()` stops immediately, even if log lines or responses are still being written. Setting `process.exitCode` and letting the loop drain is gentler, with the 2-second `unref()` timer as a safety net for hung cleanup.

> **Remember:** `uncaughtException` is for crashes. A planned stop, such as a deploy or `docker stop`, arrives as a **signal** (`SIGTERM`, `SIGINT`) that you handle with `process.on('SIGTERM', ...)` to close the server gracefully. Lesson 15 covers signals and graceful shutdown.

> **Common mistake:** using `uncaughtException` to **keep the server running** ("it never crashes now!"). Node's own documentation calls the event a crude mechanism meant as a last resort, and warns that resuming without recovering properly causes unpredictable problems. Use it for logging and a clean shutdown only.

## 16. Central error handling for HTTP servers

In a web server, many places can fail: parsing, validation, the database, a bug. If each route builds its own error response, you get inconsistent formats, forgotten cases and leaked internals. The fix is **one place** that turns errors into responses:

1. Handlers just `throw` (or let rejections happen). They never write error responses themselves.
2. One function, `handleError(err, res)`, maps the error to a status and a body.
3. Known errors (`AppError`, system errors) get a precise answer. **Unknown errors get a generic 500** and the real details go only to the log.

```js
function handleError(err, res, requestId) {
  // 1. Translate known failures into a status.
  let status = 500;
  let body = { error: { code: 'E_INTERNAL', message: 'Something went wrong', requestId } };

  if (err instanceof AppError) {
    status = err.statusCode;
    body = { error: { code: err.code, message: err.message, details: err.details } };
  } else if (err && ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'].includes(err.code)) {
    status = 503; // our dependency is down: tell the client to try again later
    body = { error: { code: 'E_UNAVAILABLE', message: 'A service we depend on is unavailable', requestId } };
  }

  // 2. Log what a developer needs. Clients never see it.
  if (status >= 500) console.log(`  [server log ${requestId}] ${err.name}: ${err.message}`);

  // 3. Respond, unless a response has already started. Then all we can do is cut the connection.
  if (res.headersSent) return res.destroy(err);
  sendJson(res, status, body);
}

async function dispatch(req, res, requestId) {
  try {
    const handler = routes[`${req.method} ${new URL(req.url, 'http://localhost').pathname}`];
    if (!handler) throw new NotFoundError(`Route ${req.method} ${req.url}`);
    sendJson(res, 200, await handler(req));
  } catch (err) {
    handleError(err, res, requestId);
  }
}
```

The example (`examples/08-http-central-errors.js`) starts a server on a free port and calls it with `fetch`:

```text
GET /users/1 -> 200
   {"id":1,"name":"Ada"}
GET /users/999 -> 404
   {"error":{"code":"E_NOT_FOUND","message":"User 999 was not found"}}
GET /nothing-here -> 404
   {"error":{"code":"E_NOT_FOUND","message":"Route GET /nothing-here was not found"}}
POST /users -> 200
   {"created":{"name":"Grace","age":36}}
POST /users -> 400
   {"error":{"code":"E_VALIDATION","message":"The request is not valid","details":[{"field":"name","message":"must be a non-empty string"},{"field":"age","message":"must be an integer from 0 to 150"}]}}
POST /users -> 400
   {"error":{"code":"E_VALIDATION","message":"The request is not valid","details":[{"field":"body","message":"is not valid JSON"}]}}
  [server log req-7] Error: connect ECONNREFUSED 127.0.0.1:5432
GET /database -> 503
   {"error":{"code":"E_UNAVAILABLE","message":"A service we depend on is unavailable","requestId":"req-7"}}
  [server log req-8] TypeError: Cannot read properties of undefined (reading 'theme')
GET /bug -> 500
   {"error":{"code":"E_INTERNAL","message":"Something went wrong","requestId":"req-8"}}
fetch did not throw for the 404: ok=false, status=404. Check res.ok yourself.
```

Look at the `GET /bug` request. The route has a bug (`undefined.theme`), but the client only sees "Something went wrong" and a `requestId`. The real message `Cannot read properties of undefined` appears only in the server log, tagged with the same id. The client can quote the id to support, and you can find the exact log line.

Three details:

- **Never leak internals** for 5xx errors: no stack, no SQL, no file paths, no internal host names (the `connect ECONNREFUSED 127.0.0.1:5432` text above stays in the log).
- **Check `res.headersSent`.** If the response already started (for example while streaming), you can no longer send a status. Destroy the connection so the client sees a failure instead of a truncated "success".
- **A last-resort `.catch`** on the dispatch call (see the file) guarantees that a bug inside `handleError` itself cannot become an unhandled rejection.

The very last line of the output is a gotcha for the **client** side. `fetch` only rejects when the network fails. A `404` or `500` is a normal response, so `await fetch(url)` does not throw for it. Always check `res.ok` (or `res.status`) before you trust the body.

### Errors that belong to the server itself

Your route handlers are not the only source of errors. Three more places need a listener, because they are `'error'` events, not exceptions you can catch:

- `server.on('error', ...)`: the server could not start or broke while running. `server.listen()` on a busy port does not throw, it emits `EADDRINUSE` here (section 26).
- `server.on('clientError', ...)`: a client sent something that is not valid HTTP. By default Node answers `400 Bad Request` and closes the socket. Add a listener only if you want to log or change that.
- `req.on('error', ...)` and `res.on('error', ...)`: the connection broke while you were reading the request or writing the response (for example `ECONNRESET`, section 26). Nobody can answer the client any more, so log it and stop working for that request.

> **Interview tip:** "Where do you handle errors in an Express or plain `http` app?" Strong answer: "Handlers just throw. One error-handling function (the four-argument middleware in Express) maps known errors to a status and a safe body, turns everything unknown into a generic 500 with a request id, and logs the details. It checks `res.headersSent` first. Anything that escapes it is a bug, so the process logs it and restarts."

### The same idea in Express 5

Frameworks give you this structure. Here is an illustrative snippet, not a runnable example of this repo.

```js
// Needs: npm install express   (illustrative snippet)
const express = require('express');
const app = express();

app.get('/users/:id', async (req, res) => {
  const user = await db.findUser(req.params.id); // a rejection is forwarded to the error middleware (Express 5)
  if (!user) throw new NotFoundError('User');
  res.json(user);
});

// Error middleware has FOUR parameters. Register it after all routes.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.statusCode ?? 500;
  res.status(status).json({
    error: { code: err.code ?? 'E_INTERNAL', message: status < 500 ? err.message : 'Something went wrong' },
  });
});
```

In Express 5 you no longer need `try/catch` or `next(err)` in `async` handlers: rejected promises and thrown errors are forwarded to the error middleware. In Express 4 the promise returned by an `async` handler is ignored, so the error is not forwarded to the error middleware: the request hangs, and on current Node the rejection is also an unhandled rejection (section 13) unless you wrapped the handler. (This Express 4 behaviour is described from the framework's design, not run for this lesson.)

## 17. Validation errors

**Validation** means checking that input has the right shape before you use it. Bad input is the most common **operational** error: the user did something wrong, not your code.

Rules that work well:

- Validate at the **edge** (where data enters: HTTP body, query, environment variables, files), once, so the rest of the code can trust it.
- **Collect all problems**, then throw one `ValidationError` with a list. One round trip is kinder than telling the user about one field at a time.
- Answer with **400** (Bad Request). Some APIs use **422** (Unprocessable Content) for "valid JSON, invalid values". Pick one and be consistent.
- Say which field and what is wrong. Do not echo secrets.

```js
function validateUser(body) {
  const problems = [];
  if (typeof body.name !== 'string' || body.name.trim() === '') {
    problems.push({ field: 'name', message: 'must be a non-empty string' });
  }
  if (!Number.isInteger(body.age) || body.age < 0 || body.age > 150) {
    problems.push({ field: 'age', message: 'must be an integer from 0 to 150' });
  }
  if (problems.length > 0) throw new ValidationError(problems);
  return { name: body.name.trim(), age: body.age };
}
```

The two `400` responses in the previous section's output come from this function (both errors reported together) and from `readJson`, which turns a `JSON.parse` failure into a validation problem (`"is not valid JSON"`). In real projects a schema library (zod, joi, ajv) writes this function for you. They are third-party packages, so this lesson stays with plain code.

> **Interview tip:** "How do you handle validation errors in an API?" Strong answer: "I validate once at the edge, collect every problem, and throw one `ValidationError` that carries a list of `{ field, message }`. The central handler turns it into a 400 (or 422) with that list. It is an operational error, so it is not logged as a bug, and the message never echoes secrets."

## 18. Fail fast, and error budgets

**Fail fast** means: detect a problem as early as possible and stop loudly, instead of limping on. A wrong setting found at startup costs you one minute. The same problem found at 3 a.m. when a request first uses it costs much more.

Good places to fail fast:

- **Startup:** validate all configuration before listening on a port. Report every problem at once, then exit with a non-zero code.
- **Function entry:** check arguments and throw `TypeError`/`RangeError` immediately.
- **Calls to other systems:** use timeouts so a hung service fails quickly (section 19), and stop calling a dead service (circuit breaker, section 19).

```js
function loadConfig(env) {
  const problems = [];
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) problems.push(`PORT must be 0-65535, got "${env.PORT}"`);
  if (!env.DATABASE_URL) problems.push('DATABASE_URL is required');
  if (problems.length > 0) {
    const err = new Error(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    err.code = 'E_CONFIG';
    throw err;
  }
  return { port, databaseUrl: env.DATABASE_URL };
}
```

```text
  Invalid configuration:
   - PORT must be 0-65535, got "abc"
   - DATABASE_URL is required
  (a real app would print this and call process.exit(1) right away)
  good config: { port: 8080, databaseUrl: 'postgres://localhost/app' }
```

This is part 1 of `examples/09-retry-and-fail-fast.js`. It is the opposite of "defensive" code that swallows problems.

### Error budgets

An **error budget** is the amount of failure you are allowed. First you promise a level of reliability, called an **SLO** (service level objective), for example "99.9% of requests succeed this month". The rest is your budget: 0.1% may fail.

```js
const slo = 0.999; // promise: 99.9% of requests succeed
const requestsPerMonth = 1_000_000;
const allowedFailures = Math.round(requestsPerMonth * (1 - slo));
const failedSoFar = 640;
console.log(`  SLO ${(slo * 100).toFixed(1)}% of ${requestsPerMonth} requests -> ${allowedFailures} failures allowed per month`);
console.log(`  failed so far: ${failedSoFar}, budget left: ${allowedFailures - failedSoFar} (${(((allowedFailures - failedSoFar) / allowedFailures) * 100).toFixed(0)}%)`);
```

```text
  SLO 99.9% of 1000000 requests -> 1000 failures allowed per month
  failed so far: 640, budget left: 360 (36%)
  budget left -> ship features; budget gone -> freeze releases and fix reliability
```

Why it is useful: 100% reliability is impossible and absurdly expensive. The budget turns "how reliable is reliable enough?" into a number. While there is budget left, the team can ship risky changes. When the budget is gone, they stop and fix reliability. Only count the failures that are the service's fault (5xx, timeouts), not a user's 400.

> **Interview tip:** "What does fail fast mean, and what is an error budget?" Strong answer: "Fail fast means detecting a bad state as early as possible and stopping loudly, for example validating configuration at startup and crashing before the server listens. An error budget is the failure I am allowed under my SLO, for example 0.1% of requests for a 99.9% target. While budget remains we ship; when it is spent we freeze features and fix reliability."

## 19. Retry or fail? A practical decision

Many errors are **transient**: they go away by themselves (a dropped connection, an overloaded server). Retrying can turn them into successes. But retrying the wrong error wastes time or makes things worse.

Ask three questions:

1. **Is the error transient?** `ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED` during a restart, HTTP 429, 502, 503, 504, timeouts: yes. Validation errors, 400, 401, 403, 404, `ENOENT`, and every programmer error: **no**. The same call will fail the same way.
2. **Is it safe to repeat?** Reading is safe. Writing may not be: retrying "charge the card" can charge twice. Retry only **idempotent** operations (same result when repeated), or use an idempotency key.
3. **Have we tried enough?** Cap the attempts (3 to 5) and the total time.

```js
const RETRYABLE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'EPIPE']);
const RETRYABLE_STATUS = new Set([408, 429, 502, 503, 504]);

function isRetryable(err) {
  if (err.name === 'TimeoutError') return true;
  if (RETRYABLE_CODES.has(err.code)) return true;
  if (RETRYABLE_STATUS.has(err.status)) return true;
  return false; // validation errors, 401/403/404, ENOENT, and every programmer error: retrying cannot help
}
```

```text
  ECONNRESET   socket hang up         -> retry
  503          Service Unavailable    -> retry
  429          Too Many Requests      -> retry
  404          Not Found              -> fail now
  400          Bad Request            -> fail now
  ENOENT       no such file           -> fail now
  TypeError    x is not a function    -> fail now
```

### Backoff and jitter

Do not retry immediately. Wait a bit, and wait longer after each failure: **exponential backoff** (10 ms, 20 ms, 40 ms, ...). Add **jitter** (a random part) so that a thousand clients do not all retry at the same instant and knock the service over again.

```js
async function retry(fn, { retries = 3, baseMs = 10, maxMs = 100, random = Math.random, onRetry } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !isRetryable(err)) throw err;
      const cap = Math.min(maxMs, baseMs * 2 ** attempt); // 10, 20, 40, 80, 100, 100 ...
      const wait = Math.floor(random() * cap); // "full jitter": a random wait from 0 up to the cap
      onRetry?.({ attempt: attempt + 1, error: err, cap, wait });
      await sleep(wait);
    }
  }
}
```

```text
  attempt 1 failed (ECONNRESET), cap 10 ms, waiting 5 ms
  attempt 2 failed (ECONNRESET), cap 20 ms, waiting 10 ms
  result "data" after 3 calls
  gave up at once: "Bad Request" after 1 call
  gave up: "still down" after 3 calls (1 first try + 2 retries)
```

(The demo passes a fixed `random` function so the numbers repeat. Real code uses `Math.random`.) Notice the two last lines: a non-retryable error fails on the first call, and a retryable one gives up after the limit and throws the **last error**.

### Timeouts

A retry loop is useless if one attempt can hang forever. Give every attempt a timeout. `AbortSignal.timeout(ms)` makes a signal that aborts after `ms` milliseconds, and `fetch` rejects with a `TimeoutError` when it fires.

```js
async function withTimeout(ms, fn) {
  const signal = AbortSignal.timeout(ms);
  try {
    return await fn(signal);
  } catch (err) {
    if (signal.aborted) throw signal.reason; // name "TimeoutError", which isRetryable() accepts
    throw err;
  }
}
```

```text
  attempt 1 failed: TimeoutError
  result: fast data on retry
  raw error: AbortError, cause: TimeoutError
```

The last line is a gotcha: `timers/promises.setTimeout` with an aborted signal rejects with an `AbortError` whose `cause` is the `TimeoutError`. That is why the helper above rethrows `signal.reason`: the retry logic then sees a `TimeoutError` as it expects. Keep the two names apart: a `TimeoutError` means "too slow" (often worth a retry), while an `AbortError` from your own `controller.abort()` means "I cancelled on purpose", which is not a failure and must not be retried or logged as an error.

### Circuit breaker

If a service is down, 1000 clients each retrying 3 times only adds load. A **circuit breaker** counts consecutive failures. After a threshold it "opens": for a cool-down period it fails **immediately** without calling the service. After the cool-down it lets one trial call through ("half open"); success closes the circuit again.

```text
  call 1: service is down
  call 2: service is down
  call 3: service is down
  call 4: circuit open, not calling the service
  call 5: circuit open, not calling the service
  call 6: circuit open, not calling the service
  the service was really called 3 times, not 6
  after cool-down: service is back
```

This is part 7 of `examples/09-retry-and-fail-fast.js` (a 25-line class).

> **Interview tip:** strong answers to "How would you handle a flaky downstream service?" mention timeouts, retries only for transient and idempotent calls, exponential backoff with jitter, a retry limit, a circuit breaker, and a fallback or graceful degradation. Also mention that retries multiply: three layers that each make up to 3 attempts can send 27 calls to the bottom service for one request.

## 20. Debugging with logs: `console` done well

The cheapest debugger is a well-placed log line. Node's `console` does more than `console.log`. All of this is in `examples/10-console-and-debuglog.js`.

**Format specifiers.** The first argument can contain placeholders: `%s` string, `%d` number, `%i` integer, `%f` float, `%j` JSON, `%o` and `%O` object, `%%` a literal percent sign.

**`console.table`** prints an array of objects as a table. A second argument picks the columns.

```js
console.log('  %s is %d years old, config: %j, object: %o', 'Ada', 36, { debug: true }, { a: 1 });
console.table([
  { id: 1, name: 'Ada', role: 'admin' },
  { id: 2, name: 'Linus', role: 'user' },
]);
console.table([{ id: 1, name: 'Ada', role: 'admin' }], ['name']); // only some columns
```

```text
  Ada is 36 years old, config: {"debug":true}, object: { a: 1 }
┌─────────┬────┬─────────┬─────────┐
│ (index) │ id │ name    │ role    │
├─────────┼────┼─────────┼─────────┤
│ 0       │ 1  │ 'Ada'   │ 'admin' │
│ 1       │ 2  │ 'Linus' │ 'user'  │
└─────────┴────┴─────────┴─────────┘
┌─────────┬───────┐
│ (index) │ name  │
├─────────┼───────┤
│ 0       │ 'Ada' │
└─────────┴───────┘
```

**Deep objects.** `console.log` prints nested objects only 2 levels deep, then shows `[Object]`. Use `console.dir(obj, { depth: null })` or `util.inspect(obj, { depth: null })` to see everything.

```js
const deep = { a: { b: { c: { d: { e: 'deep' } } } } };
console.log('  console.log stops at depth 2:', deep);
console.log('  util.inspect with depth null:', util.inspect(deep, { depth: null, compact: true, breakLength: Infinity }));
console.log('  console.dir with depth null :');
console.dir(deep, { depth: null });
```

```text
  console.log stops at depth 2: { a: { b: { c: [Object] } } }
  util.inspect with depth null: { a: { b: { c: { d: { e: 'deep' } } } } }
  console.dir with depth null :
{
  a: {
    b: { c: { d: { e: 'deep' } } }
  }
}
```

**Group, count, assert, trace.** `console.group` indents the lines that follow. `console.count('label')` counts calls. `console.assert(condition, message)` prints only when the condition is false, and it does **not** throw. `console.trace('message')` prints the current call stack, so you can answer "who called this function?".

```js
capture.group('request 17');
capture.log('step one');
capture.count('retries');
capture.count('retries');
capture.groupEnd();
capture.assert(1 + 1 === 3, 'math is broken'); // does NOT throw, only prints
function inner() {
  capture.trace('who called me?'); // prints the stack to stderr, the program keeps going
}
function outer() {
  inner();
}
outer();
```

```text
  | request 17
  |   step one
  |   retries: 1
  |   retries: 2
  | Assertion failed: math is broken
  | Trace: who called me? (frames: inner <- outer)
```

(`capture` is a `Console` that writes into an array, so the example can print everything in order. The last line is shortened: a real trace has one `at ...` line per frame.)

**`console.time`** measures how long a block takes:

```js
console.time('sum');
let total = 0;
for (let i = 0; i < 1e6; i++) total += i;
console.timeEnd('sum'); // prints "sum: 0.7ms" or similar
```

```text
sum: 9.725ms
```

The number is different on every run and every machine.

> **Remember:** `console.error`, `console.warn`, `console.trace` and `console.assert` write to **stderr**. `console.log`, `console.info`, `console.table`, `console.dir` and `console.time*` write to **stdout**. Keep that split: `node app.js > out.txt` keeps the normal output in the file and still shows errors in the terminal, and `node app.js 2> errors.txt` does the opposite (both forms work in bash and in PowerShell).

### Log errors as data

`JSON.stringify(err)` gives `{}` (section 1). When you log an error as JSON, copy the parts you need, and follow the `cause` chain:

```js
function serializeError(err, { stack = true } = {}) {
  if (!(err instanceof Error)) return { value: util.inspect(err) };
  return {
    name: err.name,
    message: err.message,
    code: err.code,
    stack: stack ? err.stack : undefined,
    cause: err.cause === undefined ? undefined : serializeError(err.cause, { stack }),
  };
}
const failure = new Error('Could not save order', { cause: Object.assign(new Error('reset by peer'), { code: 'ECONNRESET' }) });
console.log('  JSON.stringify(err)        :', JSON.stringify(failure));
const record = serializeError(failure, { stack: false }); // stack left out only to keep the printed line short
console.log('  serialized cause.code      :', record.cause.code);
console.log('  one JSON line per event    :', JSON.stringify({ level: 'error', msg: 'save failed', err: record }));
console.log('  by default the record also has a stack string:', typeof serializeError(failure).stack);
```

```text
  JSON.stringify(err)        : {}
  serialized cause.code      : ECONNRESET
  one JSON line per event    : {"level":"error","msg":"save failed","err":{"name":"Error","message":"Could not save order","cause":{"name":"Error","message":"reset by peer","code":"ECONNRESET"}}}
  by default the record also has a stack string: string
```

Good logs in production follow a few habits:

- **One line of JSON per event**, with a time, a level (`debug`, `info`, `warn`, `error`, `fatal`), a short message, and fields (`requestId`, `userId`). Machines can search and count them. Real projects use a logger library such as pino or winston (third-party, `npm install pino`).
- **Add context where it is known.** An error that says only "not found" is useless. "User 42 not found" is much better.
- **Log an error once.** Log it where you handle it, not at every level it passes through (that makes five lines for one problem). When you rethrow, wrap it with `cause` instead.
- **Never log secrets**: passwords, tokens, full card numbers, personal data.

## 21. `util.debuglog`, `NODE_DEBUG` and the `DEBUG` style

Sometimes you want detailed debug lines in the code permanently, but silent unless asked for. Node has a built-in tool: `util.debuglog(section)`.

```js
const debug = util.debuglog('myapp'); // section names are case-insensitive
const debugDb = util.debuglog('myapp-db');
console.log(`enabled: myapp=${debug.enabled} myapp-db=${debugDb.enabled}`);
debug('connected to %s on port %d', 'localhost', 5432);
debugDb('query took %d ms', 12);
```

The function returned by `debuglog` prints **only** if the environment variable `NODE_DEBUG` lists its section. It prints to **stderr** with the section name (upper case) and the process id. `debug.enabled` tells you whether it is on. The example runs this code three times as a child process with different `NODE_DEBUG` values:

```text
  NODE_DEBUG=""
    stdout: enabled: myapp=false myapp-db=false
    stderr: (nothing)
  NODE_DEBUG="myapp"
    stdout: enabled: myapp=true myapp-db=false
    stderr: MYAPP <pid>: connected to localhost on port 5432
  NODE_DEBUG="myapp*"
    stdout: enabled: myapp=true myapp-db=true
    stderr: MYAPP <pid>: connected to localhost on port 5432
            MYAPP-DB <pid>: query took 12 ms
```

(`<pid>` is the real process id, replaced by the example so the output is stable.) Things to know:

- Several sections are separated by commas (`NODE_DEBUG=myapp,http`), and `*` is a wildcard, as `myapp*` shows.
- Setting it on the command line:

```bash
NODE_DEBUG=myapp node app.js
```

```powershell
$env:NODE_DEBUG="myapp"; node app.js
```

- Node's own modules use the same system. For example `NODE_DEBUG=http`, `NODE_DEBUG=net`, `NODE_DEBUG=module` (how `require` looks for files) and `NODE_DEBUG=timer` print what happens inside Node, which is a great way to see why a request or a `require` behaves strangely. The output is very detailed, so use it on small programs.
- The variable must be set **before** Node starts. Setting `process.env.NODE_DEBUG` inside the script is too late, which is why the example uses a child process.

### The `DEBUG` package style

Many libraries use the `debug` package (Express, many database drivers) with a variable called `DEBUG` and names like `app:db`. The idea is the same, with patterns such as `DEBUG=app:*`. The example (part 7) has a 10-line version:

```js
const patterns = (process.env.DEBUG ?? '')
  .split(',')
  .filter(Boolean)
  .map((p) => new RegExp(`^${p.replaceAll('*', '.*')}$`));
const createDebug = (namespace) => {
  const on = patterns.some((re) => re.test(namespace));
  return (...args) => on && console.error(namespace, util.format(...args));
};
createDebug('app:http')('GET /health took %d ms', 3);
createDebug('app:db')('SELECT 1');
createDebug('other:thing')('this is never printed');
```

```text
  DEBUG=app:*  stderr: app:http GET /health took 3 ms
               app:db SELECT 1
```

The real package (illustrative snippet, needs `npm install debug`):

```js
// Needs: npm install debug
const debug = require('debug')('app:db');
debug('query took %d ms', 12); // prints only when DEBUG=app:* (or app:db) is set
```

> **Interview tip:** "How do you get detailed logs from production without drowning in noise?" Strong answer: "Leave detailed lines in the code but off by default, switched on by a section name: `util.debuglog` with `NODE_DEBUG`, or the `debug` package with `DEBUG`. Or use a logger with levels and raise the level for a short time. Node's own internals (`http`, `net`, `module`) use `NODE_DEBUG` too."

## 22. The debugger: breakpoints instead of guesses

Logs show you what you thought to print. A **debugger** lets you pause the program and look at everything. Node has a built-in debugger protocol called the **inspector**: Node opens a WebSocket (a two-way connection), and tools such as Chrome DevTools or VS Code connect to it.

### The `debugger;` statement

Write `debugger;` in your code. When a debugger is attached, execution pauses there like a breakpoint. When no debugger is attached, it does nothing:

```js
debugger; // eslint-disable-line no-debugger
console.log('  "debugger;" did nothing: no debugger is attached, so Node ignores it');
console.log('  inspector.url() here        :', require('node:inspector').url());
```

```text
  "debugger;" did nothing: no debugger is attached, so Node ignores it
  inspector.url() here        : undefined
```

(`inspector.url()` returns the WebSocket address of the inspector, or `undefined` when it is not active.) Remove `debugger;` before you commit: a linter rule (`no-debugger`) catches it.

### The command-line flags

| Flag | What it does |
|---|---|
| `node --inspect app.js` | start the inspector (default address `127.0.0.1:9229`) and run immediately |
| `node --inspect-brk app.js` | start the inspector and **pause on the first line**, so you can set breakpoints before any code runs |
| `node --inspect-wait app.js` | wait for a debugger to attach, then run (Node 20.15+ and 22.2+) |
| `node --inspect=0 app.js` | let the system choose a free port |
| `node inspect app.js` | a text-mode debugger built into Node (no browser needed) |

The same example starts a child with `--inspect=0`:

```text
  with --inspect=0, stderr says: Debugger listening on ws://127.0.0.1:<port>/<id>
  and inspector.url() returns   : ws://127.0.0.1:<port>/<id>
```

> **Common mistake:** exposing the inspector to a network (`--inspect=0.0.0.0:9229`). Anyone who can connect can run any code inside your process. The default address is `127.0.0.1` (this machine only).

Two more things about the inspector in practice:

- **Debugging a remote server:** do not open the port. Make an SSH tunnel to its localhost, then attach to `127.0.0.1:9229` on your own machine.

```bash
ssh -L 9229:127.0.0.1:9229 user@your-server
```

- **Starting the inspector in a process that is already running** (Linux and macOS only): send it the `SIGUSR1` signal, for example `kill -USR1 <pid>`. The flag `--disable-sigusr1` (added in Node 22.14 and 23.7) turns this off. Windows has no `SIGUSR1`. This behaviour is taken from the Node documentation and was not run on the Windows machine used to write this lesson.

### Text-mode: `node inspect`

No browser is needed for a quick look. The practice file `examples/_debug-me.js` adds up a small shopping cart:

```js
function total(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price * item.qty;
  }
  return sum;
}

const cart = [
  { price: 5, qty: 2 },
  { price: 3, qty: 1 },
];
const result = total(cart);
console.log('total is', result);
```

Start it with `node inspect lessons/14-error-handling-and-debugging/examples/_debug-me.js` and type the commands after `debug>`. This is a real session (the commands you type are added after each `debug>`, and paths use forward slashes):

```text
< Debugger listening on ws://127.0.0.1:9229/<id>
< For help, see: https://nodejs.org/learn/getting-started/debugging
connecting to 127.0.0.1:9229 ... ok
< Debugger attached.
Break on start in lessons/14-error-handling-and-debugging/examples/_debug-me.js:13
 11 }
 12 
>13 const cart = [
 14   { price: 5, qty: 2 },
 15   { price: 3, qty: 1 },
debug> sb(8)
  3 // Or:  node --inspect-brk lessons/14-error-handling-and-debugging/examples/_debug-me.js
  4 
  5 function total(items) {
  6   let sum = 0;
  7   for (const item of items) {
> 8     sum += item.price * item.qty;
  9   }
 10   return sum;
 11 }
 12 
 13 const cart = [
debug> c
break in lessons/14-error-handling-and-debugging/examples/_debug-me.js:8
  6   let sum = 0;
  7   for (const item of items) {
> 8     sum += item.price * item.qty;
  9   }
 10   return sum;
debug> exec sum
0
debug> exec item
{ price: 5, qty: 2 }
debug> watch("sum")
debug> c
break in lessons/14-error-handling-and-debugging/examples/_debug-me.js:8
Watchers:
  0: sum = 10

  6   let sum = 0;
  7   for (const item of items) {
> 8     sum += item.price * item.qty;
  9   }
 10   return sum;
debug> n
step in lessons/14-error-handling-and-debugging/examples/_debug-me.js:7
Watchers:
  0: sum = 13

  5 function total(items) {
  6   let sum = 0;
> 7   for (const item of items) {
* 8     sum += item.price * item.qty;
  9   }
debug> 
```

What happened: the debugger stopped on the first line that runs (`Break on start`, line 13, because function declarations are hoisted). `sb(8)` set a breakpoint on line 8. `c` (continue) ran until line 8, where `exec sum` showed `0` and `exec item` showed the first item. `watch("sum")` made `sum` show up at every stop. The second `c` stopped at line 8 for the second item, with `sum = 10`. `n` (next) executed that line and stopped at the loop again, now with `sum = 13`.

| Command | Short | What it does |
|---|---|---|
| `cont` | `c` | continue until the next breakpoint |
| `next` | `n` | run the current line, step **over** function calls |
| `step` | `s` | step **into** the function called on this line |
| `out` | `o` | run until the current function returns (step **out**) |
| `pause` | | pause running code |
| `setBreakpoint(line)` | `sb(line)` | breakpoint at a line of the current file (`sb('file.js', 8)` for another file) |
| `clearBreakpoint(...)` | `cb(...)` | remove a breakpoint |
| `backtrace` | `bt` | show the call stack |
| `list(5)` | | show 5 lines of source around the current line |
| `watch('expr')` | | show an expression at every stop (`unwatch`, `watchers`) |
| `exec expr` | | evaluate an expression in the current scope |
| `repl` | | open a mini console in the current scope (Ctrl+C to leave) |
| `restart`, `kill`, `.exit` | | restart, stop the program, leave the debugger |

### Chrome DevTools

1. Run `node --inspect-brk lessons/14-error-handling-and-debugging/examples/_debug-me.js`.
2. In Chrome or Edge open `chrome://inspect` (`edge://inspect` in Edge). Under "Remote Target" click **inspect** (or "Open dedicated DevTools for Node").
3. In the **Sources** panel, click a line number to set a breakpoint, then press **F8** to resume.
4. At a stop, look at **Scope** (all variables), **Watch** (your expressions), **Call Stack** and **Breakpoints**. Use **F10** (step over), **F11** (step into) and **Shift+F11** (step out).

### VS Code

The easiest way: open a **JavaScript Debug Terminal** (Command Palette, "Debug: JavaScript Debug Terminal") and run `node app.js` there. Every Node process started in that terminal is debugged automatically. Or create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Run current file",
      "program": "${file}",
      "skipFiles": ["<node_internals>/**"]
    },
    {
      "type": "node",
      "request": "attach",
      "name": "Attach to node --inspect",
      "port": 9229
    }
  ]
}
```

"Run current file" starts the open file under the debugger (press F5). "Attach" connects to a process you started yourself with `--inspect`. `skipFiles` keeps the debugger from stepping into Node's internal code.

### Kinds of breakpoints

| Kind | How | Use it when |
|---|---|---|
| Line breakpoint | click the line number gutter | you want to stop every time this line runs |
| **Conditional breakpoint** | right-click the gutter, add a condition like `item.qty > 5` or `i === 999` | the bug shows up only for one user or on the 1000th loop pass |
| **Logpoint** | right-click the gutter, "Add logpoint" (DevTools) or "Add Logpoint" (VS Code), message like `item.price, sum` | you want a `console.log` **without editing code** and without pausing. Nothing to clean up afterwards |
| Pause on exceptions | a checkbox in the debugger panel (uncaught, or also caught) | you do not know where the error starts. The debugger stops at the `throw` |
| `debugger;` statement | write it in code | you need a stop in a place that is hard to click, such as inside generated code |

> **Interview tip:** be ready to say how you debug. A good answer: "I read the error and the first line of the stack that points at my code. Then I reproduce it with the smallest input. If logs do not explain it, I attach the debugger with `--inspect-brk`, put a conditional breakpoint or a logpoint where the bad value appears, and walk back up the call stack to find where it came from."

## 23. Reading a stack trace, and getting more of it

A stack trace answers two questions: **where** did it fail, and **how did the program get there**? Here is the example's call chain, `handleRequest` calls `loadUser` calls `parseUser`:

```js
function parseUser(text) {
  const data = JSON.parse(text);
  return data.profile.name.toUpperCase(); // the bug: profile has no name
}
function loadUser(text) {
  return parseUser(text);
}
function handleRequest() {
  return loadUser('{"profile":{}}');
}
```

```text
  line 1 is the message  : TypeError: Cannot read properties of undefined (reading 'toUpperCase')
  then one line per call, newest call first:
    parseUser            11-stack-traces-and-reports.js line 36, column 28
    loadUser             11-stack-traces-and-reports.js line 39, column 10
    handleRequest        11-stack-traces-and-reports.js line 42, column 10
    Object.<anonymous>   11-stack-traces-and-reports.js line 45, column 3
    ...plus 6 more frames from node:internal (Node's own module loader). Skip those.
  read it like this: handleRequest called loadUser, which called parseUser, which failed at line 36
```

This is part 1 of `examples/11-stack-traces-and-reports.js`. (The number of `node:internal` frames, 6 here, depends on the Node version and on whether the file is CommonJS or an ES module, so it may differ on your machine. The line numbers refer to the example file itself.) How to read it, line by line:

1. **The header** is `ErrorName: message`. Read the message first: `reading 'toUpperCase'` of `undefined` means that the thing before `.toUpperCase` (here `data.profile.name`) is `undefined`.
2. **The first frame** is where the error was **created**. Here `parseUser`, line 36, column 28. The column points to the exact spot: the `.toUpperCase` access. Open the file there first.
3. **The frames below** are the callers, from newest to oldest. Read them to learn *how* the bad value got there: `handleRequest` passed `{"profile":{}}` through `loadUser`.
4. **`Object.<anonymous>`** is the top level of a CommonJS file (Node wraps the file in a function). It is the bottom of **your** code.
5. **`node:internal/...` frames** are Node's own code (module loading, timers). They are not your bug. Skip them.

Other frame shapes you will meet:

| Frame | Meaning |
|---|---|
| `at fn (file:line:col)` | a function call |
| `at async fn (file:line:col)` | an `async` function that was waiting on an `await` (section below) |
| `at new ClassName (file:line:col)` | a constructor |
| `at ClassName.method (...)` | a method call |
| `at file:line:col` | an anonymous function (no name; give your functions names, they help stack traces) |
| `at Timeout._onTimeout (file:line:col)` | a timer callback. For an anonymous arrow function you see `Timeout._onTimeout`, for a named function you see `Timeout.name [as _onTimeout]` (as in the example below). The next lines are Node's `listOnTimeout` and `processTimers` |

### `Error.stackTraceLimit`

V8 keeps only the **top 10 frames** by default. In deeply nested code the interesting part may be cut off.

```js
console.log('  default limit        :', Error.stackTraceLimit, '-> frames kept:', countFrames(recurse(50)));
Error.stackTraceLimit = 3;
console.log('  limit 3              ->', countFrames(recurse(50)), 'frames');
Error.stackTraceLimit = 0;
console.log('  limit 0              -> stack is only the header:', JSON.stringify(recurse(50).stack));
Error.stackTraceLimit = Infinity;
console.log('  limit Infinity       ->', countFrames(recurse(50)), 'frames (every call is kept)');
```

```text
  default limit        : 10 -> frames kept: 10
  limit 3              -> 3 frames
  limit 0              -> stack is only the header: "Error: bottom"
  limit Infinity       -> 59 frames (every call is kept)
  from the command line: node --stack-trace-limit=50 app.js
```

(The `59` is 51 calls of `recurse` plus the top level of the file plus Node's own loader frames, so it is specific to Node 24.16; the other numbers are the same everywhere.) Set it at startup with `node --stack-trace-limit=50 app.js` while hunting a bug. A big limit costs time and memory for every error, so do not leave `Infinity` on in production.

### Async stack traces

When a function is paused at `await`, V8 can rebuild the chain of `async` callers. These are called **async stack traces**. The callers show up as `async` frames. Callbacks and `.then` chains do not get this:

```js
async function readRow() {
  await sleep(1);
  throw new Error('row is missing');
}
async function loadPage() {
  await readRow();
}
async function render() {
  await loadPage();
}
```

```text
  with await : readRow <- async loadPage <- async render <- async main
  with .then : inThen (who started the chain is not recorded)
  in a timer : Timeout.inTimer [as _onTimeout] (starts fresh)
```

(The example prints only the function names, newest call on the left.) With `await`, you see the whole path `main -> render -> loadPage -> readRow`. With `.then()` or a timer, the stack shows only the callback itself: the code that started the work is gone. Another reason to prefer `async`/`await`.

### Flags that show where a warning or a plain throw came from

Not every problem is an `Error` with a stack. Node prints **warnings** (for example `MaxListenersExceededWarning` or a deprecation notice) and crashes with a thrown string have no stack. Node gives a hint for both, and a flag that adds the missing location:

```text
  warning, no flag               : (Use `node --trace-warnings ...` to show where the warning was created)
  warning, --trace-warnings      : at addListeners (<tmp>/warn.js:4:40)
  throw "text", no flag          : (Use `node --trace-uncaught ...` to show where the exception was thrown)
  throw "text", --trace-uncaught : at fail (<tmp>/throw.js:2:3)
  also useful: --trace-deprecation, --throw-deprecation, --trace-exit, --trace-sync-io
```

This is part 6 of `examples/11-stack-traces-and-reports.js`. It writes two tiny files, runs each one twice, and prints the key line from stderr. The first file adds 11 listeners to one emitter, which triggers the warning. The second one does `throw 'a plain string'`.

| Flag | What it adds |
|---|---|
| `--trace-warnings` | a stack trace for every warning, so you can find who caused it |
| `--trace-deprecation` | a stack trace for deprecation warnings only (`DeprecationWarning`) |
| `--throw-deprecation` | turns deprecation warnings into thrown errors, so tests and CI fail on them |
| `--trace-uncaught` | where an uncaught exception was **thrown**, even when it is not an `Error` object |
| `--trace-exit` | a stack trace whenever the process exits: who called `process.exit()`? |
| `--trace-sync-io` | a stack trace when synchronous I/O (for example `readFileSync`) runs after the first turn of the event loop, where it blocks other work (lesson 08) |

You can also listen to warnings in code with `process.on('warning', (w) => ...)`.

> **Interview tip:** "A production error log shows a stack trace with only `node:internal` frames, or no stack at all. What do you do?" Strong answer: "First I check that everything throws real `Error` objects, because a thrown string or a bare rejection has no stack. Then I raise `--stack-trace-limit` if the trace is cut off, use `async`/`await` instead of raw callbacks to keep async frames, switch on `--enable-source-maps` for compiled code, and use `--trace-uncaught` or `--trace-warnings` to find the origin."

## 24. Source maps: stack traces for compiled code

If you write TypeScript or use a bundler, the file that runs (`out.js`) is not the file you wrote (`src/app.ts`). A stack trace points into `out.js`, which is hard to read. A **source map** is a file that records, for every position in the output, the matching position in the original. Tools put a comment at the end of the output file that points to it:

```js
//# sourceMappingURL=out.js.map
```

Node can use it. Switch it on with `--enable-source-maps` (or `NODE_OPTIONS=--enable-source-maps`, or `process.setSourceMapsEnabled(true)` at the start of your program). The example fakes a tool's output by hand (a tiny map placed inside a `data:` URL) and runs it twice:

```text
  (no flag)            at boom (<tmp>/out.js:2:9)
  --enable-source-maps at boom (<tmp>/src/app.ts:11:3)
```

This is part 4 of `examples/11-stack-traces-and-reports.js`. Without the flag the trace says `out.js`, line 2. With it, Node translates to `src/app.ts`, line 11. Remember: line numbers are 1-based, and `out.js:2:9` becomes `app.ts:11:3` because the map says so.

Building the stack text with source maps costs extra time, so measure first if your program creates huge numbers of errors. For a server in production it is usually worth it: you get readable errors from compiled code.

> **Interview tip:** "Our TypeScript service logs stack traces that point at `dist/app.js:1:48213`. How do you fix that?" Strong answer: "The build must emit source maps (`sourceMap: true` for `tsc`, or the bundler option), and I start Node with `--enable-source-maps` (or `NODE_OPTIONS=--enable-source-maps`). Then `error.stack` shows the original `.ts` file and line. If I do not want the runtime cost, I upload the maps to my error tracker and translate there."

## 25. Diagnostic reports: a snapshot of a process

A **diagnostic report** is a JSON file that describes the process at one moment: JavaScript and native stacks, heap numbers, open handles, versions, environment variables. It is built into Node, needs no install, and is made for post-mortems: "what was this process doing when it crashed or hung?"

```js
const live = process.report.getReport();
console.log('  sections        :', Object.keys(live).join(', '));
console.log('  header.event    :', live.header.event, '| nodejsVersion:', live.header.nodejsVersion);
console.log('  automatic reports are off by default:', {
  onFatalError: process.report.reportOnFatalError,
  onUncaughtException: process.report.reportOnUncaughtException,
  onSignal: process.report.reportOnSignal,
});
```

```text
  sections        : header, javascriptStack, javascriptHeap, nativeStack, resourceUsage, uvthreadResourceUsage, libuv, workers, environmentVariables, sharedObjects
  header.event    : JavaScript API | nodejsVersion: v24.16.0
  automatic reports are off by default: { onFatalError: false, onUncaughtException: false, onSignal: false }
```

`process.report.getReport()` returns the report as an object, `process.report.writeReport()` writes it to a file. To get one **automatically** when something goes wrong, start Node with a flag:

| Flag | A report is written when |
|---|---|
| `--report-uncaught-exception` | an exception is not caught |
| `--report-on-fatalerror` | a fatal error happens, such as running out of memory |
| `--report-on-signal` | the process receives a signal (`SIGUSR2` by default, on Linux and macOS). Useful for a **hung** process |
| `--report-directory=dir`, `--report-filename=name.json` | choose where it is saved |
| `--report-exclude-env` | leave out environment variables (they may contain secrets). Added in Node 22.13 and 23.3, so it does not exist on older versions |

The example crashes a child process on purpose with `--report-uncaught-exception` and reads the report:

```text
  child exit code : 1
  report event    : Exception
  report message  : TypeError: boom in child
  report top frame: at fail (<tmp>/crash-me.js:2:9)
```

The file also holds `javascriptHeap` (memory numbers), `libuv` (the open handles keeping the loop alive, great for finding why a process will not exit), `nativeStack` and more. It is a compact way to ask a customer or a production server: "send me this file".

> **Remember:** reports include environment variables by default, and they may contain secrets. Treat report files as sensitive, or use `--report-exclude-env`.

### "Why does my process not exit?"

A process stays alive while something still keeps the event loop busy: a timer, an open server, a socket, a child process. `process.getActiveResourcesInfo()` lists them by type. In the example, a child process with one pending `setTimeout` prints:

```text
  getActiveResourcesInfo() in a child that waits for one timer: Timeout
```

Call it where you expect the program to be finished (for example from a timer you add while debugging) and the leftover names tell you what to close: `Timeout` is a timer, `TCPServerWrap` is a server that is still listening, `TCPSocketWrap` is an open connection. The `libuv` section of a diagnostic report gives the same information in more detail.

> **Interview tip:** "A Node process hangs and does not respond. How do you find out why?" Strong answer: "First check CPU. If it is at 100%, something blocks the event loop, so I take a CPU profile. If CPU is idle, I check what keeps it waiting: a diagnostic report (`--report-on-signal`, or `process.report.writeReport()`) shows the stacks, the open handles and the heap in one file. For a process that will not exit I list `process.getActiveResourcesInfo()`. I attach `--inspect` only through an SSH tunnel."

## 26. Common runtime errors and how to fix them

`examples/12-common-runtime-errors.js` reproduces each of these on your machine, then prints what you see, the usual cause, and a fix. Here is the whole output:

```text
1. ECONNREFUSED: nothing is listening on that port
  error    : ECONNREFUSED (connect) connect ECONNREFUSED 127.0.0.1:<port>
  fetch    : TypeError: fetch failed | cause.code = ECONNREFUSED
  localhost: AggregateError code=ECONNREFUSED message="" inner errors=2
  fix      : start the server first, check the port and host, add a retry for start-up races
2. ECONNRESET: the other side slammed the connection shut
  fetch    : fetch failed | cause.code = ECONNRESET
  fix      : treat it as retryable for idempotent requests; check idle timeouts of proxies and load balancers
3. EADDRINUSE: the port is already taken
  error    : EADDRINUSE (listen) port matches: true | listen EADDRINUSE: address already in use 127.0.0.1:<port>
  fix      : stop the old process, pick another port, or listen(0) in tests
4. ENOENT: no such file (or no such command)
  error    : ENOENT | ENOENT: no such file or directory, open '<tmpdir>/config-14-demo.json'
  fix      : path.join(__dirname, 'config.json'), or import.meta.dirname in ES modules
  spawn    : ENOENT | syscall: spawn no-such-command-14
5. EPIPE: writing to a pipe that the reader already closed
  child    : exit code 1, stderr says: Error: EPIPE: broken pipe, write
  fix      : listen for "error" on process.stdout and exit quietly on EPIPE (this is what happens with: node app.js | head)
6. "Cannot read properties of undefined" and its relatives
  missing nested field   TypeError: Cannot read properties of undefined (reading 'name')
  not a function         TypeError: api.run is not a function
  forgot await           TypeError: Cannot read properties of undefined (reading 'toUpperCase')
  destructure undefined  TypeError: undefined is not iterable
  assign to undefined    TypeError: Cannot set properties of undefined (setting 'theme')
  reassign const         TypeError: Assignment to constant variable.
  fix      : validate input at the edge, use ?. and ??, and ask WHY the value is undefined (that is the real bug)
7. Module errors
  require("./nope")              MODULE_NOT_FOUND: Cannot find module './nope-14'
  require("some-package")        MODULE_NOT_FOUND: Cannot find module 'no-such-package-14'
  import("./nope.mjs")           ERR_MODULE_NOT_FOUND: Cannot find module '<examples>/nope-14.mjs' imported from <examples>/12-common-runtime-errors.js
  import("some-package")         ERR_MODULE_NOT_FOUND: Cannot find package 'no-such-package-14' imported from <examples>/12-common-runtime-errors.js
  require() inside .mjs          ReferenceError: require is not defined in ES module scope, you can use import instead
  require() of a plain .mjs      works, x = 1
  require() of top-level await   ERR_REQUIRE_ASYNC_MODULE: require() cannot be used on an ESM graph with top-level await. Use import() instead. To see where the top-level await comes from, use --experimental-print-required-tla.
  require() of ESM, feature off  Error [ERR_REQUIRE_ESM]: require() of ES Module <tmp>/plain.mjs from <tmp>/load-it.cjs not supported.
  fix      : use import() or make the code ESM; check the "type" field in package.json and the file extension
8. FATAL ERROR: JavaScript heap out of memory (a child with a tiny 40 MB heap and a leak)
  exit     : 134 (the process aborted, nothing can catch this)
  stderr   : FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory
  fix      : find the leak (heap snapshots), stream instead of buffering, or raise --max-old-space-size as a last resort
9. EMFILE: too many open files (every process has a limit)
  error    : EMFILE (open), the OS refused to open one more file
  pool     : 10 jobs, limit 3: at most 3 ran at the same time, results [2,4,6,8,10,12,14,16,18,20]
  fix      : limit concurrency, close what you open (finally, using, pipeline), only then raise the limit (ulimit -n)
```

(Ports, folders and Windows backslashes are replaced by `<port>`, `<tmp>` and so on so that the text is the same everywhere. On the Windows machine used to write this lesson, the ENOENT message contained the full resolved path, not just the relative name you passed. Part 9 depends on your operating system's file limit: Windows reached it, and a system with a very high limit prints `limit not reached within 20000 files` instead.)

Now each error in more detail.

### `ECONNREFUSED`

Nothing accepted the connection. Either the server is not running, it listens on a different port or address, or it is still starting. Things to know:

- The error from `net` is a plain error with `code: 'ECONNREFUSED'`.
- The global `fetch` hides it: it rejects with `TypeError: fetch failed`, and the real reason is in **`err.cause`**.
- When you connect to `localhost`, Node tries both `::1` (IPv6) and `127.0.0.1` (IPv4). On a machine that has both addresses the failure is an `AggregateError` with **an empty message**, and the individual errors are in `err.errors` (2 on the machine used for this lesson, one per address; the count depends on your network setup).
- So if you only print `err.message` you see nothing. Check `err.code` and `err.errors`.

### `ECONNRESET`

The other side closed the connection with a reset instead of a polite goodbye (a crash, a proxy timeout, a firewall, or the server calling `socket.resetAndDestroy()` like the example). Typical in long-lived keep-alive connections that a load balancer cut after an idle timeout. It is transient, so retry idempotent requests (section 19).

These network codes are easy to mix up. Side by side:

| Code | What happened | Usually |
|---|---|---|
| `ECONNREFUSED` | you tried to connect and **nothing was listening** (server down, wrong port) | retry for a short while if the server is restarting, otherwise fix the address |
| `ECONNRESET` | the connection **was open**, then the other side dropped it abruptly | retry if the request is idempotent |
| `ETIMEDOUT` | no answer arrived in time | retry with a limit, and set your own timeout |
| `ENOTFOUND` | DNS could not find the host name | fix the name (a typo, a missing record), do not retry |
| `EAI_AGAIN` | a temporary DNS failure | retry |

> **Interview tip:** "What is the difference between `ECONNREFUSED` and `ECONNRESET`?" Strong answer: "Refused means the connection never started because nothing was listening on that address and port. Reset means it was established and then the peer killed it, for example a crash or an idle timeout in a proxy. Refused usually means the service is down or the config is wrong. Reset is transient, so an idempotent request can be retried."

### `EADDRINUSE`

Another process (often your own previous run) already listens on that port. The error has `port`, `address` and `syscall: 'listen'`. For a server it arrives as an `'error'` event on the server object (`server.on('error', ...)`), because `listen()` itself does not throw. To find the owner: `netstat -ano | findstr :3000` in Windows PowerShell, `lsof -i :3000` on Linux and macOS. In tests always `listen(0)` so the OS picks a free port.

### `ENOENT`

"No such file or directory". The usual cause is a **relative path**, which starts from the folder where you ran `node`, not from the folder of the file. The example changes the current folder and then reads `'config-14-demo.json'`, and it fails. Build paths from the file location: `path.join(__dirname, 'config.json')` in CommonJS, `path.join(import.meta.dirname, 'config.json')` in ES modules. The same code appears when a **program is not found**: `spawn('no-such-command-14')` emits an `'error'` event with `ENOENT`. (On Windows, `npm` is `npm.cmd` and needs a shell. See lesson 15.)

### `EMFILE`

"Too many open files". Every process has a limit of open file handles, and sockets and files both count. It happens when code opens thousands of files at once (for example `Promise.all` over a huge array of `readFile` calls) and does not close them. Part 9 of the example opens files in a loop and never closes them, until the operating system says no:

```js
const open = [];
try {
  for (let i = 0; i < 20000; i++) open.push(fs.openSync(os.devNull, 'r')); // never closed on purpose
} catch (e) {
  console.log(e.code, e.syscall);
}
for (const fd of open) fs.closeSync(fd);
```

```text
EMFILE open
```

On the Windows machine used to write this lesson the limit was reached after about 8,000 files. Linux and macOS have their own limits (often 1,024 or 256 by default, changed with `ulimit -n`). A system with a very high limit would not fail inside 20,000 files.

The fix has three steps. First **limit concurrency**: do not start 20,000 reads at once, start a few and feed new ones as old ones finish. Second, close what you open (`finally`, `using`, `pipeline`). Only then, third, raise the limit. Here is a tiny pool (it is in the example too). `limit` workers take items from one shared list:

```js
async function mapLimit(items, limit, fn) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
```

```text
10 jobs, limit 3: at most 3 ran at the same time, results [2,4,6,8,10,12,14,16,18,20]
```

Why is `next++` safe without a lock? JavaScript runs one piece of code at a time, and `next++` happens with no `await` in between, so two workers can never take the same item.

To see the same error with a low limit on Linux or macOS (not run on the Windows machine used here):

```bash
ulimit -n 64
node -e "const fs = require('node:fs'); try { for (;;) fs.openSync('/dev/null', 'r'); } catch (e) { console.log(e.code); }"
```

On a typical Linux or macOS shell this prints `EMFILE`.

### `EPIPE`

You wrote to a pipe or socket and the reader is gone. The classic case is `node app.js | head`: `head` quits after ten lines and the next write fails. It arrives as an `'error'` event on `process.stdout`, which crashes the program if nobody listens. For command line tools, handle it:

```js
process.stdout.on('error', (err) => {
  if (err.code === 'EPIPE') process.exit(0); // the reader went away: not a failure
  throw err;
});
```

With this handler the child in our test exits with code 0 instead of 1. The message text of the error differs by platform: on Windows it reads `EPIPE: broken pipe, write` (as in the output above), while on Linux and macOS it is usually `Error: write EPIPE` (not run here). Match on `err.code === 'EPIPE'`, never on the message.

### "Cannot read properties of undefined" (and `x is not a function`)

The most common error in JavaScript. The message tells you the **property** being read (`reading 'name'`), so the **value before the dot** is `undefined`. Look at the stack's first frame for the line and column. Then ask why the value is undefined: a missing field in the input, an array index out of range, a function that returned nothing, a forgotten `await` (a `Promise` has no `.name`), or a callback called with different arguments than you expected. Fix the **cause** (validate input, return the value). Optional chaining (`user?.profile?.name`) is fine for truly optional data, but using it everywhere hides bugs.

### Module errors

| Error | Meaning and fix |
|---|---|
| `MODULE_NOT_FOUND` | `require()` could not find the file or package. Check the spelling, the relative path (`./`), and that you ran `npm install` |
| `ERR_MODULE_NOT_FOUND` | the same for `import`. In ES modules a relative import needs the full file name **with the extension** (`./util.js`) |
| `ReferenceError: require is not defined in ES module scope` | you used `require` in an ES module (a `.mjs` file, or `"type": "module"`). Use `import`, or `createRequire` |
| `ERR_REQUIRE_ESM` | `require()` of an ES module. **Outdated on Node 24:** `require()` can load ES modules (Node 20.19+, 22.12+ and 24) unless the feature is switched off, as in the example. You will still meet it on older Node versions |
| `ERR_REQUIRE_ASYNC_MODULE` | you `require()`d an ES module that uses top-level `await`. That cannot work synchronously. Use `import()` |

### `FATAL ERROR: ... JavaScript heap out of memory`

The JavaScript heap (where objects live) hit its limit. This is not an exception: the process **aborts** (exit code 134 here), and nothing, not even `uncaughtException`, can catch it. The default limit depends on the machine, so do not hard-code a number; `v8.getHeapStatistics().heap_size_limit` tells you. You can change it with `--max-old-space-size=<megabytes>`, but a bigger heap only delays a leak.

Typical causes: a cache or array that only grows, event listeners that are never removed (lesson 09), closures that keep big data alive, and loading a whole large file or result set into memory instead of **streaming** it (lesson 11). To find the leak:

1. Take a **heap snapshot** with `v8.writeHeapSnapshot()` (or start Node with `--heapsnapshot-near-heap-limit=3` to get snapshots just before it dies, or `--heapsnapshot-signal=SIGUSR2` on Linux and macOS).
2. Load the files in the Chrome DevTools **Memory** tab.
3. Take two snapshots some time apart and use "Comparison" to see which object types keep growing.

Add `--report-on-fatalerror` (section 25) to also get a diagnostic report when it dies.

## 27. A method for debugging

Tools help, but a method helps more. When something is broken:

1. **Reproduce it.** Find the smallest input and steps that make it fail every time. If you cannot reproduce it, you cannot know that you fixed it.
2. **Read the error.** Message first, then the first stack frame that is in your code, then the callers. Most bugs are solved here.
3. **Find the first wrong value.** Work backwards from the failure: where does the bad value come from? Log it, or stop on it with a conditional breakpoint, at the earliest place you can.
4. **Make a guess and test it.** Change one thing at a time. If you are lost, **bisect**: cut the problem in half (comment out half the code, or use `git bisect` to find the commit that broke it).
5. **Fix the cause, not the symptom.** Adding `?.` to hide an `undefined` fixes the message, not the bug.
6. **Add a test** that fails before the fix and passes after (lesson 16).
7. **In production** you cannot attach a debugger casually. Use what you prepared: structured logs with request ids, metrics, traces, diagnostic reports and heap snapshots.

## 28. Interview angle: what you will be asked

| Question | A strong answer includes |
|---|---|
| "How do you handle errors in Node.js?" | operational vs programmer errors; `try/catch` with `await`; error classes with `code`; one central handler; log and exit on unknown errors |
| "Why does `try/catch` not catch an error in a `setTimeout` callback?" | the callback runs later on a new call stack; put `try/catch` inside the callback, or use promises and `await` |
| "What happens on an unhandled promise rejection?" | default mode `throw`: stack printed, exit code 1; an `unhandledRejection` handler stops the crash; always handle or `await` your promises |
| "Should you use `uncaughtException` to keep the server alive?" | no: state is unknown. Log, close gracefully, exit non-zero, let a supervisor restart |
| "`return promise` or `return await promise` in a `try`?" | inside `try`, use `return await`, otherwise `catch` and `finally` do not see the failure |
| "How do you design errors in an API?" | a base `AppError` with `code`, `statusCode`, `isOperational`; map in one handler; hide internals on 5xx; include a request id |
| "When do you retry?" | transient and idempotent only; backoff with jitter; limit attempts; per-attempt timeout; circuit breaker |
| "How do you debug a slow or crashing production service?" | logs and metrics first; diagnostic report or heap snapshot; `--inspect` only through a tunnel; reproduce locally |
| "How do you find a memory leak?" | heap snapshots compared over time; look for growing caches, listeners, closures; stream instead of buffering |
| "`ECONNREFUSED` or `ECONNRESET`: what is the difference?" | refused: nothing was listening, the connection never started; reset: it was open and the peer dropped it, so retry if idempotent |
| "A process hangs or will not exit. What do you check?" | CPU first (blocked loop vs idle); a diagnostic report; `process.getActiveResourcesInfo()` for leftover timers, servers and sockets |
| "Stack traces from our compiled TypeScript are unreadable." | emit source maps and run with `--enable-source-maps`; throw real `Error` objects; `--stack-trace-limit` for deep stacks |
| "What does `fetch` do on a 404?" | it resolves normally. It rejects only for network failures, with the real code in `err.cause`. Check `res.ok` |

Common wrong answers: "wrap everything in `try/catch`", "use `process.on('uncaughtException')` so the app never crashes", "catch the error and ignore it", "throw strings", "`console.log` is enough".

## Summary / Key takeaways
- An `Error` has `name`, `message`, `stack`, `cause` and (often) `code`. Match on `code` or class, never on `message`. Always throw `Error` objects. Custom errors (`AppError` and subclasses) add `statusCode` and `isOperational`, and wrap low-level errors with `cause` instead of losing them.
- `finally` always runs, and a `return` or `throw` inside it overrides everything. Use it (or `using`) only for cleanup.
- Operational errors (the world misbehaves) are handled: retry, fall back, tell the user. Programmer errors (a bug) are logged and fixed, and the process restarts.
- `try/catch` only sees errors thrown while its block runs. Use `await` (and `return await` inside `try`) for promises, put `try/catch` inside callbacks, and use `pipeline`, `'error'` listeners and `captureRejections` for streams and emitters.
- On Node 24 an uncaught error or unhandled rejection prints the stack and exits with code 1. After an `uncaughtException`: log, clean up, exit, and let a supervisor restart. Never use the handler to carry on.
- One central handler turns errors into responses: precise for known errors, a generic 500 plus a request id for unknown ones. Validate at the edge and collect all problems.
- Fail fast at startup. Retry only transient, idempotent failures with backoff, jitter, a limit and a timeout. A circuit breaker stops calling a dead service. An error budget turns "reliable enough" into a number.
- Debug with structured logs, `console` tools, `util.debuglog`, `node inspect` or `--inspect-brk` with DevTools or VS Code (conditional breakpoints and logpoints), `--stack-trace-limit`, `--enable-source-maps` and diagnostic reports.

## Quick check

1. Name the five properties that describe an error, and say why `JSON.stringify(err)` is usually `{}`.
<details><summary>Answer</summary>

`name`, `message`, `stack`, `cause` and `code` (the last one is added by Node or by you). `message`, `stack` and `cause` are own but **non-enumerable** properties, and `name` lives on the prototype, so `JSON.stringify` and `Object.keys` skip them. To log an error as JSON, copy the fields you need into a plain object, and follow the `cause` chain.

</details>

2. What is the difference between an operational error and a programmer error? Give one example of each and say what you do with each.
<details><summary>Answer</summary>

An operational error comes from the environment while the code is correct, for example `ECONNREFUSED`, a missing file, or invalid user input. You handle it: retry, fall back, or return a clear message. A programmer error is a bug, for example reading a property of `undefined` or passing the wrong argument type. Retrying cannot help, so you log it with the stack, fix the code, and (when it reaches the process level) let the process restart.

</details>

3. What does this function return, and what happens to the error?
```js
function f() {
  try {
    throw new Error('x');
  } finally {
    return 'done';
  }
}
```
<details><summary>Answer</summary>

It returns `'done'` and the error disappears silently. A `return` inside `finally` overrides the pending throw. The same is true for `break`, `continue` and a `throw` (a new throw replaces the old one). Keep `finally` for cleanup.

</details>

4. Why does this `catch` never run? How do you fix it?
```js
try {
  setTimeout(() => { throw new Error('late'); }, 10);
} catch (e) {
  console.log('caught');
}
```
<details><summary>Answer</summary>

`try/catch` only covers code that runs while the `try` block is on the call stack. The timer callback runs later on a fresh stack, so the `try` is long gone. Put the `try/catch` inside the callback, or wrap the timer in a promise (`await sleep(10)` from `node:timers/promises`) and use `await` inside a `try` block.

</details>

5. In an `async` function, what is the difference between `return fetchData()` and `return await fetchData()` inside a `try` block?
<details><summary>Answer</summary>

With `return fetchData()` the promise leaves the function before it settles, so if it rejects later the `catch` (and a `finally` that expects the result) does not see it. With `return await fetchData()` the function waits inside the `try`, so the rejection is thrown there and the `catch` runs.

</details>

6. On Node 24, what happens when a promise is rejected and nobody handles it? What changes if you register `process.on('unhandledRejection', ...)`?
<details><summary>Answer</summary>

The default mode is `throw`: the error and its stack are printed and the process exits with code 1. If an `unhandledRejection` handler exists, it runs instead, the process keeps running, and the exit code stays 0 unless you change it. If only an `uncaughtException` handler exists, the rejection is passed to it with `origin` set to `'unhandledRejection'`.

</details>

7. Why is the right reaction to an `uncaughtException` "log, clean up, exit"? What restarts the program?
<details><summary>Answer</summary>

After an uncaught error the program is in an unknown state (half-finished work, held locks), so continuing can give wrong answers or corrupt data. You log the error, stop taking new work, let running work finish within a short deadline, and exit with a non-zero code. A supervisor (systemd, Docker restart policy, Kubernetes, pm2) then starts a fresh process.

</details>

8. In an HTTP server, where should errors be turned into responses, and what should the client see for an unexpected bug?
<details><summary>Answer</summary>

In one central place (an error-handling function or middleware), not inside each route. Known errors (`ValidationError`, `NotFoundError`, a down dependency) map to 400, 404 or 503 with a clear body. Unknown errors become a generic `500 Something went wrong` with a request id, while the full error and stack go only to the log. Also check `res.headersSent` before writing a response.

</details>

9. Which errors are safe to retry, and what are exponential backoff and jitter?
<details><summary>Answer</summary>

Retry transient errors (`ECONNRESET`, `ETIMEDOUT`, timeouts, HTTP 429/502/503/504) and only for idempotent operations or with an idempotency key. Never retry validation errors, 4xx responses or programmer errors. Exponential backoff doubles the wait after each failure (for example 100 ms, 200 ms, 400 ms). Jitter adds randomness so many clients do not retry at the same moment. Also set a retry limit and a timeout per attempt.

</details>

10. How do you start a Node program so that Chrome DevTools can debug it from the first line, and what is the difference between `--inspect` and `--inspect-brk`? How do you see original TypeScript lines in a stack trace?
<details><summary>Answer</summary>

Run `node --inspect-brk app.js`, open `chrome://inspect` and click "inspect". `--inspect` starts the inspector and runs immediately, `--inspect-brk` also pauses on the first line so you can set breakpoints before any code runs. For TypeScript (or any compiled code) that emits source maps, start Node with `--enable-source-maps`, and stack traces will show the original files and lines.

</details>

## Try it yourself

### Task 1 (easy): predict the output
Read this code and write down the exact output **before** you run it. Then run it and check.

```js
function a() {
  try {
    return 'try';
  } finally {
    console.log('cleanup');
  }
}

function b() {
  try {
    throw new Error('x');
  } catch (e) {
    return 'catch';
  } finally {
    return 'finally';
  }
}

function c() {
  for (let i = 0; i < 3; i++) {
    try {
      if (i === 1) continue;
      console.log('body', i);
    } finally {
      console.log('finally', i);
    }
  }
}

console.log(a());
console.log(b());
c();
```

<details><summary>Hint</summary>

`finally` runs before a function returns, even when `try` or `catch` returned first. A `return` in `finally` replaces the earlier return value. `continue` also triggers `finally` for that loop pass.

</details>

<details><summary>Solution</summary>

Save the code in a file and run it with `node`. The output is:

```text
cleanup
try
finally
body 0
finally 0
finally 1
body 2
finally 2
```

`a()` logs `cleanup` first (finally runs before the return completes), then `console.log` prints `try`. `b()` returns `'finally'` because the `return` in `finally` overrides the `return 'catch'`. In `c()`, pass 1 hits `continue`, but `finally 1` still runs.

</details>

### Task 2 (medium): one function that maps errors to responses
You have these two error classes:

```js
class ValidationError extends Error {
  constructor(details) {
    super('Invalid input');
    this.name = 'ValidationError';
    this.details = details;
  }
}
class NotFoundError extends Error {
  constructor(what) {
    super(`${what} was not found`);
    this.name = 'NotFoundError';
  }
}
```

Write `errorToResponse(err)` that returns `{ status, body }`:

- `ValidationError` gives status 400 and a body with `error: 'validation_failed'`, the message and the `details`.
- `NotFoundError` gives status 404 and a body with `error: 'not_found'` and the message.
- An error whose `code` is `ECONNREFUSED`, `ETIMEDOUT` or `ECONNRESET` gives status 503 with a generic message that does **not** include the original message (it may contain an internal address).
- Anything else (a `TypeError`, a thrown string, ...) gives status 500 with the generic message `Something went wrong` and no details from the error.

<details><summary>Hint</summary>

Check with `instanceof` for your two classes, and with `err && [...].includes(err.code)` for system errors (the thrown value might not be an object). The final `return` is the default for everything unknown. Never put `err.message` into the 500 or 503 body.

</details>

<details><summary>Solution</summary>

```js
const assert = require('node:assert/strict');

class ValidationError extends Error {
  constructor(details) {
    super('Invalid input');
    this.name = 'ValidationError';
    this.details = details;
  }
}
class NotFoundError extends Error {
  constructor(what) {
    super(`${what} was not found`);
    this.name = 'NotFoundError';
  }
}

// Turns any error into { status, body }. Clients must never see messages or stacks of unexpected errors.
function errorToResponse(err) {
  if (err instanceof ValidationError) {
    return { status: 400, body: { error: 'validation_failed', message: err.message, details: err.details } };
  }
  if (err instanceof NotFoundError) {
    return { status: 404, body: { error: 'not_found', message: err.message } };
  }
  if (err && ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'].includes(err.code)) {
    return { status: 503, body: { error: 'unavailable', message: 'A dependency is unavailable, try again later' } };
  }
  return { status: 500, body: { error: 'internal', message: 'Something went wrong' } }; // no err.message here
}

const dbDown = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' });
const bug = new TypeError("Cannot read properties of undefined (reading 'id')");

assert.deepEqual(errorToResponse(new ValidationError([{ field: 'age' }])).status, 400);
assert.deepEqual(errorToResponse(new NotFoundError('User 7')).body.message, 'User 7 was not found');
assert.equal(errorToResponse(dbDown).status, 503);
assert.equal(errorToResponse(bug).status, 500);
assert.ok(!JSON.stringify(errorToResponse(bug)).includes('reading'), 'the message of a bug must not reach the client');
assert.ok(!JSON.stringify(errorToResponse(dbDown)).includes('10.0.0.5'), 'internal addresses must not leak');
assert.equal(errorToResponse('a string was thrown').status, 500);
console.log('all checks passed');
```

Output:

```text
all checks passed
```

The function is pure (no `res`, no I/O), so it is easy to test, which is a big benefit of a central handler.

</details>

### Task 3 (harder): find and fix three bugs
This program has three error-handling bugs, one in each function. Run it first: it crashes. Fix the bugs so that it prints the three lines shown below.

```js
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function loadConfig(file) {
  try {
    return fs.readFile(file, 'utf8');
  } catch {
    return '{}'; // the fallback when the file is missing
  }
}

async function loadUsers(names) {
  const users = [];
  names.forEach(async (name) => {
    users.push(await Promise.resolve({ name }));
  });
  return users;
}

async function saveReport(report) {
  try {
    if (!report.title) throw new Error('title is required');
  } catch (err) {
    throw new Error('Could not save report');
  }
}

async function main() {
  console.log('config:', await loadConfig(path.join(os.tmpdir(), 'missing-14.json')));
  console.log('users:', await loadUsers(['ada', 'linus']));
  await saveReport({}).catch((e) => console.log('cause:', e.cause?.message));
}

main();
```

Expected output after the fix:

```text
config: {}
users: [ { name: 'ada' }, { name: 'linus' } ]
cause: title is required
```

<details><summary>Hint</summary>

Bug 1 is in section 8 (`return` versus `return await` inside `try`). Bug 2 is the `forEach` warning. Bug 3 is about losing information when you wrap an error (section 11).

</details>

<details><summary>Solution</summary>

```js
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function loadConfig(file) {
  try {
    return await fs.readFile(file, 'utf8'); // Fix 1: await, so a rejection is thrown INSIDE the try block
  } catch {
    return '{}'; // the fallback when the file is missing
  }
}

async function loadUsers(names) {
  // Fix 2: forEach ignores the promises its callback returns. map + Promise.all waits for all of them.
  return Promise.all(names.map(async (name) => await Promise.resolve({ name })));
}

async function saveReport(report) {
  try {
    if (!report.title) throw new Error('title is required');
  } catch (err) {
    throw new Error('Could not save report', { cause: err }); // Fix 3: keep the original error as the cause
  }
}

async function main() {
  console.log('config:', await loadConfig(path.join(os.tmpdir(), 'missing-14.json')));
  console.log('users:', await loadUsers(['ada', 'linus']));
  await saveReport({}).catch((e) => console.log('cause:', e.cause?.message));
}

main();
```

Output:

```text
config: {}
users: [ { name: 'ada' }, { name: 'linus' } ]
cause: title is required
```

Bug 1: `return fs.readFile(...)` hands the promise to the caller before it fails, so the `catch` never ran and the rejection crashed the program. Bug 2: `forEach` does not wait for `async` callbacks, so `loadUsers` returned an empty array before any user was added. Bug 3: the new error threw away the reason; with `{ cause: err }` the log shows both levels.

</details>

**Bonus: practise the debugger (no hints, just steps).** The tasks above are about error handling. To practise the debugging half, run `node inspect lessons/14-error-handling-and-debugging/examples/_debug-me.js`, set a breakpoint with `sb(8)`, press `c` twice, and use `exec sum` at each stop. Then start the same file with `node --inspect-brk`, open `chrome://inspect`, and add a **conditional breakpoint** `item.qty === 1` on line 8, so it stops only for the second cart item.

<details><summary>What you should see</summary>

In `node inspect`, `exec sum` prints `0` at the first stop and `10` at the second (the first item is 5 x 2). The loop ends with `sum` equal to 13, and the program prints `total is 13`. In DevTools the conditional breakpoint skips the first item, and in the Scope panel you see `sum` is `10` and `item` is `{ price: 3, qty: 1 }`.

</details>

## Where to go next
- Next lesson: [15. Processes, Signals, child_process and Building CLIs](../15-processes-and-cli/README.md). You will see how a supervisor sends signals, how graceful shutdown works, and how exit codes are used by command line tools.
- Practise the interview questions: [Round 1: screening](../../rounds/round-1-screening/questions.md), [Round 2: core](../../rounds/round-2-core/questions.md), [Round 3: coding](../../rounds/round-3-coding/questions.md), [Round 4: advanced](../../rounds/round-4-advanced/questions.md) and [Round 5: system design](../../rounds/round-5-system-design/questions.md) (retries, circuit breakers and error budgets show up there). Error handling, `try/catch` with promises, unhandled rejections and debugging come up in all of them.
- Related lessons: [07. Async JavaScript](../07-async-javascript/README.md), [08. The Event Loop](../08-event-loop/README.md), [09. Events and EventEmitter](../09-events/README.md) and [11. Streams](../11-streams/README.md).
