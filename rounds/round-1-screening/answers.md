# Round 1: Screening and Fundamentals: Answers

Say the **Short answer** aloud first. Add the extra detail only if the interviewer asks.

---

## Node.js basics (Lesson 01)

### R1-NODE-01 [Easy] [Must-know] What is Node.js, and what is it not?

**Short answer:** Node.js is a JavaScript runtime. It runs JavaScript outside the browser, using Google's V8 engine, and adds APIs for files, networking, processes and more. It is not a language, not a framework, and not a web server by itself.

**Go deeper:** Node = V8 (runs JS) + libuv (event loop, async I/O, thread pool) + built-in modules (`fs`, `http`, `crypto`...). Frameworks such as Express run ON Node.

**Common wrong answer:** "Node.js is a framework" or "a language". It is neither.

### R1-NODE-02 [Easy] [Must-know] How is Node.js different from running JavaScript in a browser?

**Short answer:** Same language, different environment. A browser gives you `window`, the DOM and `fetch`. Node gives you `fs`, `http`, `process`, `Buffer` and `require`. Node has no DOM, and a browser cannot read your disk freely.

**Go deeper:** The global object is `globalThis` in both. Modern Node also has `fetch`, `AbortController` and `URL`. Node controls the runtime version you ship, a browser does not.

### R1-NODE-03 [Easy] [Must-know] Your JavaScript runs on one thread. How can Node.js still serve thousands of connections?

**Short answer:** Waiting for I/O (network, disk) does not need the JavaScript thread. Node hands I/O to the operating system or to libuv's thread pool, keeps running other code, and runs your callback when the result is ready. This is the event loop, and it is called non-blocking I/O.

**Go deeper:** One thread handles many connections because most of the time a connection is idle, waiting. CPU-heavy work is the exception: it blocks the one thread, so use worker threads for that. See [Lesson 08](../../lessons/08-event-loop/README.md).

**Follow-up:** "What blocks the event loop?" Long loops, huge `JSON.parse`, sync `fs` calls, catastrophic regexes.

### R1-NODE-04 [Easy] What are V8 and libuv, and what does each one do?

**Short answer:** V8 is the engine that compiles and runs JavaScript. libuv is a C library that provides the event loop, async file and network I/O, timers and a thread pool.

### R1-NODE-05 [Easy] What does LTS mean, and which Node.js version should you run in production?

**Short answer:** LTS means Long Term Support. Even-numbered majors (22, 24, 26) become LTS and get security fixes for years. Run an LTS line in production, never an odd-numbered "Current" release. This course uses Node 24.

**Go deeper:** At the time of writing, 26 is Active LTS and 24 and 22 are Maintenance LTS. Check [nodejs.org/en/about/previous-releases](https://nodejs.org/en/about/previous-releases) for current dates. From Node 27 the odd/even split is planned to end.

### R1-NODE-06 [Medium] When is Node.js a good choice, and when is it a poor one?

**Short answer:** Good for I/O-heavy work: APIs, real-time apps (chat, WebSockets), proxies, streaming, CLIs, tooling. Poor for long CPU-heavy work on the main thread (video encoding, big number crunching), unless you use worker threads or a separate service.

**Follow-up:** "How would you use Node for CPU work?" Worker threads, a job queue plus worker processes, or native code.

---

## JavaScript essentials (Lesson 02)

### R1-JS-01 [Easy] [Must-know] What is the difference between `var`, `let` and `const`?

**Short answer:** `var` is function-scoped, hoisted and initialised as `undefined`. `let` and `const` are block-scoped and sit in the temporal dead zone until their line runs. `const` cannot be re-assigned, but an object held in a `const` can still change.

**Example:**

```js
const user = { name: 'Sam' };
user.name = 'Alex';   // allowed
// user = {};         // TypeError: Assignment to constant variable
```

**Tip:** Default to `const`, use `let` when you must re-assign, avoid `var`.

### R1-JS-02 [Easy] [Must-know] What is a closure? Give a practical use.

**Short answer:** A closure is a function that remembers the variables of the place where it was created, even after that place has finished. Uses: private state, factories, callbacks, `once`/`memoize`/`debounce` helpers.

**Example:**

```js
function counter() {
  let n = 0;
  return () => ++n;
}
const next = counter();
next(); next(); // 1, 2
```

### R1-JS-03 [Easy] [Must-know] What is the difference between `==` and `===`?

**Short answer:** `===` compares value and type with no conversion. `==` converts types first, which gives surprises such as `[] == false` being `true`. Use `===`. The one accepted use of `==` is `x == null`, which matches both `null` and `undefined`.

### R1-JS-04 [Medium] [Must-know] How is `this` decided, and how do arrow functions differ?

**Short answer:** For normal functions, `this` is set by HOW the function is called: `obj.method()` gives `obj`, a plain call gives `undefined` (strict mode) or the global object, `new` gives the new object, and `call/apply/bind` set it explicitly. Arrow functions have no own `this`: they use the `this` of the code around them.

**Gotcha:** Passing `obj.method` as a callback loses `this`. Fix with `bind` or an arrow wrapper.

### R1-JS-05 [Medium] What is a prototype, and how does prototypal inheritance work?

**Short answer:** Every object has a hidden link to another object, its prototype. When you read a property that is missing, JavaScript follows the chain until it finds it or reaches `null`. `class` is cleaner syntax on top of this.

**Example:** `[].map` works because `Array.prototype` has `map`.

### R1-JS-06 [Easy] What are `map`, `filter` and `reduce` for?

**Short answer:** `map` transforms every item into a new array of the same length. `filter` keeps items that pass a test. `reduce` folds an array into a single value (sum, object, group). None of them change the original array.

### R1-JS-07 [Medium] What is the difference between a shallow copy and a deep copy? How do you deep copy in modern Node.js?

**Short answer:** A shallow copy (`{...obj}`, `Object.assign`) copies the top level only, so nested objects are still shared. A deep copy copies everything. Use the built-in `structuredClone(value)`. It handles dates, maps, sets and cycles, but not functions or class prototypes.

**Common wrong answer:** `JSON.parse(JSON.stringify(x))`. It loses `Date`, `Map`, `undefined` and fails on cycles.

---

## Modules and npm (Lessons 03, 04)

### R1-MOD-01 [Easy] [Must-know] What is the difference between CommonJS and ES modules?

**Short answer:** CommonJS uses `require()` and `module.exports`, loads synchronously, and is the default for `.js` files unless package.json says `"type": "module"`. ES modules use `import`/`export`, are static and support top-level `await`. Use `.mjs` or `"type": "module"` for ESM.

**Go deeper:** `__dirname` does not exist in ESM, use `import.meta.dirname`. ESM exports are live bindings, CJS exports are copies. Recent Node versions can `require()` a synchronous ES module.

### R1-MOD-02 [Medium] What is the difference between `exports` and `module.exports`?

**Short answer:** `exports` is just a shortcut variable that points at `module.exports`. Adding properties to `exports` works. Re-assigning `exports = ...` breaks the link and exports nothing. To export a single function or class, assign to `module.exports`.

### R1-NPM-01 [Easy] [Must-know] What is the difference between `dependencies` and `devDependencies`?

**Short answer:** `dependencies` are needed at runtime. `devDependencies` are only for development (tests, linters, TypeScript). In production you install with `npm ci --omit=dev` so dev tools are not shipped.

### R1-NPM-02 [Medium] [Must-know] What does `package-lock.json` do, and how is `npm ci` different from `npm install`?

**Short answer:** The lockfile records the exact version of every installed package, so every machine gets the same tree. `npm install` can update the lockfile. `npm ci` deletes `node_modules`, installs exactly what the lockfile says, and fails if package.json and the lockfile disagree. Use `npm ci` in CI and Docker.

### R1-NPM-03 [Easy] What do `^1.2.3` and `~1.2.3` mean in package.json?

**Short answer:** `^1.2.3` allows minor and patch updates: `>=1.2.3 <2.0.0`. `~1.2.3` allows only patch updates: `>=1.2.3 <1.3.0`. This is semantic versioning: major.minor.patch, where major means breaking changes.

---

## Async JavaScript (Lesson 07)

### R1-ASY-01 [Easy] [Must-know] What problem do callbacks, promises and async/await each solve?

**Short answer:** Callbacks let code continue when slow work finishes, but nesting gets deep ("callback hell") and errors are easy to miss. Promises are objects for a future value, with chaining and one error path. `async/await` is syntax over promises that reads like normal top-to-bottom code.

### R1-ASY-02 [Medium] [Must-know] What is the difference between `Promise.all`, `Promise.allSettled`, `Promise.race` and `Promise.any`?

**Short answer:**

| Method | Resolves when | Rejects when |
| --- | --- | --- |
| `all` | all fulfil (array of values) | the first one rejects |
| `allSettled` | all finish (array of `{status, value/reason}`) | never |
| `race` | the first one settles, either way | the first one settles with rejection |
| `any` | the first one fulfils | all reject (`AggregateError`) |

### R1-ASY-03 [Easy] [Must-know] How do you handle errors with async/await?

**Short answer:** Wrap `await` in `try/catch`, or call `.catch()` on the promise. A rejected promise that you `await` throws at that line. Forgetting to `await` (a "floating promise") means the error escapes your `try/catch`.

**Example:**

```js
try {
  const data = await readFile('missing.txt', 'utf8');
} catch (err) {
  if (err.code === 'ENOENT') console.log('file not found');
  else throw err;
}
```

### R1-ASY-04 [Medium] Why can `await` inside a `for` loop be slow, and how do you run the work in parallel?

**Short answer:** Each `await` waits for the previous item, so 10 calls of 100 ms take 1 second. If the calls are independent, start them all and await together: `await Promise.all(items.map(fn))`. For thousands of items, limit concurrency with a pool (see [the promise pool challenge](../round-3-coding/challenges/03-promise-pool/README.md)).

### R1-ASY-05 [Medium] What is an unhandled promise rejection, and what does current Node.js do about it?

**Short answer:** It is a rejected promise with no handler. Since Node 15 the default is to treat it like an uncaught exception: print the error and exit with code 1. You can listen for `unhandledRejection` for logging, but the right fix is to handle the error.

---

## Core modules, HTTP and errors (Lessons 05, 06, 09, 12, 14)

### R1-CORE-01 [Easy] [Must-know] `fs.readFile` or `fs.createReadStream`: when do you use which?

**Short answer:** `readFile` loads the whole file into memory, so it suits small files. `createReadStream` reads in chunks, so memory stays flat for large files, and you can pipe it to a response or another stream. Prefer the promise API (`fs/promises`) over sync calls in servers.

### R1-CORE-02 [Easy] How do you read environment variables and command line arguments?

**Short answer:** `process.env.NAME` for environment variables (always strings), `process.argv.slice(2)` for arguments, or `util.parseArgs` for flags. You can load a `.env` file with `node --env-file=.env app.js`.

### R1-CORE-03 [Easy] What is an `EventEmitter`? Show a tiny example.

**Short answer:** It is the observer pattern in the `events` module: objects register listeners with `on` and announce things with `emit`. Many core classes (streams, servers) are emitters. Listeners run synchronously, in order.

```js
const EventEmitter = require('node:events');
const bus = new EventEmitter();
bus.on('hello', (name) => console.log('hi', name));
bus.emit('hello', 'Sam'); // hi Sam
```

### R1-CORE-04 [Easy] Why use `path.join` instead of string concatenation?

**Short answer:** It uses the right separator for the operating system (`\` on Windows, `/` elsewhere), and removes duplicate or extra separators. Combine it with `__dirname` so paths do not depend on the current working directory.

### R1-HTTP-01 [Easy] [Must-know] Write a minimal HTTP server using only core modules.

**Short answer:**

```js
const http = require('node:http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: true }));
});
server.listen(3000);
```

**Go deeper:** `req` and `res` are streams. Always set status and `Content-Type`. In real projects you would use a framework for routing and parsing.

### R1-HTTP-02 [Easy] [Must-know] Which HTTP status codes do you use every day, and what do they mean?

**Short answer:** 200 OK, 201 Created, 204 No Content, 301/302 redirects, 400 bad request, 401 not authenticated, 403 not allowed, 404 not found, 409 conflict, 422 validation failed, 429 too many requests, 500 server error, 503 unavailable.

**Common wrong answer:** mixing up 401 and 403. 401 means "I do not know who you are", 403 means "I know who you are, and you may not".

### R1-HTTP-03 [Medium] What are the HTTP methods for, and what does "idempotent" mean?

**Short answer:** GET reads, POST creates or triggers an action, PUT replaces, PATCH changes part, DELETE removes. Idempotent means repeating the same request has the same effect as sending it once. GET, PUT and DELETE are idempotent. POST is not, so retries of POST need an idempotency key.

### R1-ERR-01 [Easy] What is the difference between operational errors and programmer errors?

**Short answer:** Operational errors are expected runtime problems: file not found, network timeout, invalid user input. You handle them (retry, return 4xx, log). Programmer errors are bugs: calling `undefined.foo`, wrong arguments. You fix the code, and after one in a critical place you usually restart the process.

### R1-ERR-02 [Medium] What happens when an exception is thrown and nobody catches it? What should you do about it?

**Short answer:** Node prints the stack trace and exits with code 1. You can add `process.on('uncaughtException')`, but only to log and then exit, because the process may be in a broken state. Run under a supervisor (systemd, Docker, Kubernetes, PM2) that restarts it.

---

## Predict the output (Lessons 02, 07, 08)

### R1-OUT-01 [Easy] What does this print?

**Output:**

```text
var 3
var 3
var 3
let 0
let 1
let 2
```

**Why:** `var` has one `i` shared by all callbacks. The loop finishes (`i` is 3) before any timer fires. `let` creates a fresh `j` per iteration, so each callback keeps its own value. Timers with the same delay run in creation order.

### R1-OUT-02 [Easy] What does this print?

**Output:**

```text
function undefined
ReferenceError
```

**Why:** Function declarations are hoisted with their body, so `typeof f` is `function`. `var g` is hoisted but only as `undefined`. `let h` is in the temporal dead zone, so reading it throws a `ReferenceError`.

### R1-OUT-03 [Medium] [Must-know] In what order do these lines print?

**Output:**

```text
sync
nextTick
promise
timeout
```

**Why:** Synchronous code first. Then the `process.nextTick` queue, then promise callbacks (microtasks), and only after that the timers phase of the event loop. nextTick beats promises in CommonJS.

### R1-OUT-04 [Medium] What does this print when run as a normal CommonJS file (`node file.js`)?

**Output:**

```text
a object
undefined
```

**Why:** `obj.regular()` has `this = obj`, so `a`. The arrow function uses the `this` of the module, which in CommonJS is `module.exports` (an object), so `typeof this` is `object`. The extracted `f()` is a plain call in sloppy mode: `this` is the global object, which has no `name`, so `undefined`. (In strict mode it would throw a `TypeError`.)

### R1-OUT-05 [Medium] What does this print?

**Output:** `1`, `3`, `5`, `2`, `4` (one per line).

**Why:** `a()` runs synchronously until the first `await`: it prints 1, calls `b()` which prints 3. The `await` queues the rest of `a` as a microtask. Then `.then(4)` is queued, then `5` prints synchronously. Microtasks run in order: first "2", then "4".

### R1-OUT-06 [Easy] What does this print?

**Output:** `0.30000000000000004 false  true object false [ 1, NaN, NaN ]`

**Why:** floating point numbers cannot store 0.1 exactly. `[] + []` is the empty string (so there are two spaces). `[] == false` is `true` after conversion. `typeof null` is `object` (a historic bug). `NaN` is never equal to itself. `parseInt` receives `(value, index)`, and the index acts as the radix: `parseInt(2, 1)` and `parseInt(3, 2)` are `NaN`.

---

## Coding challenges: approach notes

### R1-CODE-01 [Easy] Write your own promisify

**Approach:** Return a normal function. Inside, return `new Promise` and call `fn.call(this, ...args, callback)`. The callback rejects on a truthy first argument, otherwise resolves with the second.

**Complexity:** O(1) extra work per call.

**Edge cases people miss:** keeping `this`; a synchronous throw (the Promise executor already turns it into a rejection); ignoring extra callback values; checking `typeof fn`.

**What the interviewer looks for:** a normal function (not an arrow) for `this`, no needless `try/catch`, and knowing `util.promisify` exists.

**Follow-ups:** What if the callback is called twice? (A promise settles once, so the second call is ignored.)

Reference solution: [solution](challenges/01-promisify/solution/promisify.js)
