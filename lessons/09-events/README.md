# 09. Events and EventEmitter

> Level: Intermediate   Time: about 120 minutes   Node: 24 (notes where older versions differ)

[Previous: 08. The Event Loop (the most asked Node.js topic)](../08-event-loop/README.md) | [All lessons](../../README.md) | [Next: 10. Buffers and Binary Data](../10-buffers/README.md)

## What you will learn
- The observer pattern in plain words, and why so much of Node is built on it
- The whole EventEmitter API: `on`, `once`, `off`, `emit`, `prependListener`, `listenerCount`, `eventNames`, `removeAllListeners`
- Exactly how `emit` works: synchronous, registration order, and a snapshot of the listeners
- The special `error` event, the leak warning (`MaxListenersExceededWarning`), and how to avoid both problems
- Extending EventEmitter in a class, `events.once` and `events.on`, and cancelling waits with `AbortSignal`
- The async listener trap, `captureRejections`, and the web-style `EventTarget`
- How to build a mini EventEmitter from scratch (a classic interview task)
- Patterns (pub/sub, event bus, request-scoped events), the events inside Node core, and error handling strategies

All examples run from the repo root, for example `node lessons/09-events/examples/01-basics.js`. Each example prints numbered parts, and the lesson text tells you which part shows what. They use only core modules and finish by themselves. Snippets in this lesson that use `await` live inside an `async function main()` in the example files.

## 1. The observer pattern in plain words

The **observer pattern** lets one part of a program announce "something happened" without knowing who cares.

Think of a newsletter. You subscribe once. Later the publisher sends an issue and every subscriber gets a copy. The publisher does not know who you are and does not care what you do with it.

| Word | Meaning |
|---|---|
| event | a name (like `'data'`) plus some optional data |
| emit | announce an event ("send the issue") |
| listener (or handler) | a function that wants to run when the event is emitted |
| subscribe / listen | register a listener (`on`) |

```
publisher                          listeners
emitter.emit('news', 'hi')  --->   listener 1('hi')
                            --->   listener 2('hi')
```

Why does this help? Imagine a `Downloader` that must update a progress bar, write a log line and send a metric. Without events it calls `ui.update()`, `logger.log()` and `metrics.count()` itself, so it knows all three. With events it only does `this.emit('progress', 40)`. Anyone can listen, and you add or remove listeners without touching the downloader.

Node is full of this pattern. A stream (data that arrives in pieces, see lesson 11) emits `'data'` and `'end'`. An HTTP server emits `'request'`. A child process emits `'exit'`. The class behind all of them is `EventEmitter`, from the core module `node:events`.

When should you use an event instead of a callback or a promise?

| Tool | How often it fires | Use it when |
|---|---|---|
| callback | once, by convention | one function wants one result |
| promise | exactly once (it settles one time) | one result, and you want to `await` it |
| event | zero, one or many times | something repeats (`'data'`, `'request'`), or many parties care |

> **Remember:** `EventEmitter` has nothing to do with the event loop from lesson 08. It is a plain JavaScript class. `emit` is just a loop that calls functions.

> **Interview tip:** "Explain the observer pattern." A strong short answer: one object keeps a list of functions and calls them when something happens, so it never needs to know who they are. `EventEmitter` is exactly that: `on` adds to the list, `emit` loops over it.

## 2. Your first EventEmitter: `on` and `emit`

```js
const EventEmitter = require('node:events');

const radio = new EventEmitter();

function listenerA(song) {
  console.log('  A heard:', song);
}
radio.on('song', listenerA);
radio.on('song', (song) => console.log('  B heard:', song));

const hadListeners = radio.emit('song', 'Blue');
console.log('  emit returned:', hadListeners);
```

```text
  A heard: Blue
  B heard: Blue
  emit returned: true
```

This is part 1 of `examples/01-basics.js`.

- `on(name, listener)` adds a listener. `addListener` is the same method with a longer name.
- `emit(name, ...args)` calls every listener of that name and passes `...args` to each. It returns `true` if there was at least one listener, otherwise `false`.
- `require('node:events')` returns the class itself. `const { EventEmitter } = require('node:events')` works too. In ES modules write `import { EventEmitter } from 'node:events'`.
- Event names are normally strings. Symbols (unique values, rarely used for this) work too. A number is turned into a string, so `on(1, fn)` and `emit('1')` meet.

> **Common mistake:** a typo in the event name fails silently. `emit('Song')` does not reach `on('song')`: nothing prints, nothing throws, and `emit` returns `false`. In bigger programs define event names as constants.

## 3. The rest of the basic API

| Method | What it does |
|---|---|
| `on(name, fn)` / `addListener` | add a listener at the end of the list |
| `once(name, fn)` | add a listener that runs one time, then removes itself |
| `off(name, fn)` / `removeListener` | remove one listener (you must pass the same function) |
| `prependListener(name, fn)` / `prependOnceListener` | add at the front of the list |
| `emit(name, ...args)` | call the listeners, return `true` or `false` |
| `listenerCount(name)` | how many listeners an event has |
| `listeners(name)` / `rawListeners(name)` | a copy of the list (`rawListeners` keeps the `once` wrappers) |
| `eventNames()` | the names that currently have listeners |
| `removeAllListeners([name])` | remove all listeners, of one name or of everything |
| `setMaxListeners(n)` / `getMaxListeners()` | the limit for the leak warning (section 10) |

`on`, `once`, `off`, `prependListener` and `removeAllListeners` return the emitter, so calls can be chained: `emitter.on('a', f).on('b', g)`.

Counting and clearing, in one small example:

```js
const radio = new EventEmitter();
radio.on('song', () => {}).on('song', () => {}).on('weather', () => {});
console.log('  listenerCount("song"):', radio.listenerCount('song'));
console.log('  eventNames():', radio.eventNames());
radio.removeAllListeners('song'); // only this event name
console.log('  after removeAllListeners("song"):', radio.eventNames());
radio.removeAllListeners(); // every event name
console.log('  after removeAllListeners():', radio.eventNames());
```

```text
  listenerCount("song"): 2
  eventNames(): [ 'song', 'weather' ]
  after removeAllListeners("song"): [ 'weather' ]
  after removeAllListeners(): []
```

`eventNames()` lists only names that currently have at least one listener. `removeAllListeners()` with no argument is a blunt tool: it also removes listeners that other code added, including ones a library or Node itself needs (think of `process` or a stream). Prefer removing your own listeners one by one.

The classic trap is `off`:

```js
const EventEmitter = require('node:events');
const radio = new EventEmitter();

function listenerA(song) {
  console.log('  A heard:', song);
}
radio.on('song', listenerA);
radio.on('song', (song) => console.log('  B heard:', song));

radio.off('song', (song) => console.log('  B heard:', song)); // a NEW function, so nothing is removed
console.log('  after off with a look-alike function:', radio.listenerCount('song'));
radio.off('song', listenerA); // the real reference
console.log('  after off with the real function:', radio.listenerCount('song'));
```

```text
  after off with a look-alike function: 2
  after off with the real function: 1
```

Two functions are only "the same" if they are the same object. To remove a listener later, keep a reference to it (a named function or a `const`).

Two more details interviewers like:
- If you add the same function twice, it runs twice, and one `off` call removes only one of them (the most recently added).
- `listenerCount(name, fn)` can count one specific function (added in Node 18.16 and 19.8).

`examples/01-basics.js` runs every method in the table. Run it and read the output line by line.

> **Interview tip:** "How do you remove a listener?" Pass the same function object to `off`, so keep it in a variable. `on` and `addListener` are the same method, and so are `off` and `removeListener`. Mention that `removeAllListeners()` is risky on shared emitters.

## 4. `emit` is synchronous, and listeners run in order

This is the most asked EventEmitter question. **`emit` is synchronous**: it calls every listener one after the other and only returns when all of them have finished.

```js
const bell = new EventEmitter();
bell.on('ring', () => console.log('  listener ran'));
console.log('  before emit');
bell.emit('ring');
console.log('  after emit');
```

```text
  before emit
  listener ran
  after emit
```

The listener runs between "before" and "after", on the same **call stack** (the list of functions that are running right now, each one waiting for the one it called). Nothing is queued and no timer is involved.

Order rules: listeners run in the order they were added, and `prependListener` puts one at the front.

```js
const order = new EventEmitter();
order.on('go', () => console.log('  first added'));
order.on('go', () => console.log('  second added'));
order.prependListener('go', () => console.log('  added last, but prepended'));
order.emit('go');
```

```text
  added last, but prepended
  first added
  second added
```

What "synchronous" means for you:
- A slow listener blocks the code that called `emit`, and with it the whole event loop. Heavy CPU work in a listener freezes your server.
- A nested `emit` inside a listener also runs right away, in the middle of the outer listener (part 3 of the example).
- If a listener throws, the exception travels up through `emit` (section 8).
- A listener that emits its own event again can recurse until the stack overflows with `RangeError: Maximum call stack size exceeded`.
- There is no way to say "stop, do not call the other listeners". The web-style `Event` has `stopImmediatePropagation()` (section 14), `EventEmitter` does not. Only a throw ends the loop early (section 8).
- The return value of a listener is ignored.

### Making listeners run later

`EventEmitter` never makes anything async by itself. If you want the listeners to run later, defer the `emit` yourself. There are three common ways. Part 7 of the example schedules all three from the main script, in this order: `setImmediate`, `queueMicrotask`, `process.nextTick`. They run in the reverse order:

```js
const later = new EventEmitter();
later.on('x', (how) => console.log('  listener ran via', how));
setImmediate(() => later.emit('x', 'setImmediate'));
queueMicrotask(() => later.emit('x', 'queueMicrotask'));
process.nextTick(() => later.emit('x', 'process.nextTick'));
console.log('  all three emits are scheduled, nothing ran yet');
```

```text
  all three emits are scheduled, nothing ran yet
  listener ran via process.nextTick
  listener ran via queueMicrotask
  listener ran via setImmediate
```

`process.nextTick` and `queueMicrotask` run as soon as the current code finishes, before the event loop moves on. `setImmediate` runs a little later, when the event loop reaches its check phase (lesson 08), so callbacks that are already waiting get to run first. In a CommonJS main script the order is the one above. In an ES module, `queueMicrotask` runs before `process.nextTick`. Use `setImmediate` when you want to give other work room to run, and `process.nextTick` for the "let the caller attach a listener first" case (section 11).

> **Interview tip:** "Is `emit` sync or async?" Answer: synchronous. Prove it with the before/after logs above. A strong answer adds "listeners run in registration order, `emit` returns `true` if anyone was listening, and if I want it async I defer the emit myself". The example is `examples/02-sync-order.js` (parts 1 to 3, 6 and 7).

## 5. Arguments and `this`

Everything after the event name is passed to the listener, in order:

```js
const shop = new EventEmitter();
shop.on('sale', (item, price, qty) => {
  console.log('  sold', qty, 'x', item, 'at', price);
});
shop.emit('sale', 'pen', 2, 5);
```

```text
  sold 5 x pen at 2
```

When an event carries more than two or three values, pass one object instead (`emit('refund', { item, amount, reason })`). It reads better and you can add fields later without breaking old listeners.

### What is `this` inside a listener?

| Listener is... | `this` is... |
|---|---|
| a regular `function () {}` | the emitter that called it |
| an arrow function `() => {}` | whatever `this` was where the arrow was written |
| a method passed directly (`on('x', obj.method)`) | the emitter, NOT `obj` |

```js
const ee = new EventEmitter();
ee.label = 'I am the emitter';
ee.on('hello', function () {
  console.log('  regular function, this.label =', this.label);
  console.log('  this === ee:', this === ee);
});
ee.emit('hello');

const owner = {
  label: 'I am the owner object',
  start() {
    ee.on('hi', () => {
      console.log('  arrow function, this.label =', this.label);
    });
  },
};
owner.start();
ee.emit('hi');
```

```text
  regular function, this.label = I am the emitter
  this === ee: true
  arrow function, this.label = I am the owner object
```

The third row of the table is a famous bug:

```js
class Counter {
  constructor() {
    this.count = 0;
  }
  increment() {
    this.count++;
  }
}
const counter = new Counter();
const hits = new EventEmitter();
hits.on('hit', counter.increment); // "this" will be the emitter, not counter
hits.emit('hit');
console.log('  counter.count:', counter.count, '(still 0)');
console.log('  hits.count:', hits.count, '(the emitter got the ++ by mistake)');
```

```text
  counter.count: 0 (still 0)
  hits.count: NaN (the emitter got the ++ by mistake)
```

`hits.count` was `undefined`, and `undefined++` gives `NaN`. Fix it with `counter.increment.bind(counter)` or an arrow wrapper: `() => counter.increment()`.

> **Common mistake:** using an arrow function and then expecting `this` to be the emitter. Use a regular function if you need the emitter, or use the emitter variable by name. The example is `examples/03-args-and-this.js`.

## 6. Changing listeners while emitting, and `once` in depth

When you call `emit`, Node takes a **snapshot** (a copy) of the listener list and calls the functions in the copy. So changes made by a listener only affect the next `emit`:

```js
const live = new EventEmitter();
function second() {
  console.log('  second');
}
live.on('x', function first() {
  console.log('  first (removes second, adds late)');
  live.off('x', second);
  live.on('x', () => console.log('  late'));
});
live.on('x', second);
console.log('  -- emit #1');
live.emit('x');
console.log('  -- emit #2');
live.emit('x');
```

```text
  -- emit #1
  first (removes second, adds late)
  second
  -- emit #2
  first (removes second, adds late)
  late
```

In emit #1, `second` was removed by `first` but still ran, because it was in the snapshot. The `late` listener, added during emit #1, waited for emit #2. (In emit #2, `first` adds yet another `late`, which waits for emit #3.)

### How `once` works

`once` wraps your function in a small wrapper. When the event fires, the wrapper **first removes itself, then calls your function**. That order makes `once` safe even if your function emits the same event again:

```js
const once = new EventEmitter();
let runs = 0;
once.once('x', () => {
  runs++;
  once.emit('x'); // does not call this listener again
});
once.emit('x');
console.log('  runs:', runs);
```

```text
  runs: 1
```

The wrapper keeps your original function in `wrapper.listener`. That is why `emitter.off('x', yourFunction)` also removes a `once` listener, and why `rawListeners('x')` (wrappers included) differs from `listeners('x')` (originals).

> **Interview tip:** "What happens if a listener adds or removes listeners while `emit` is running?" Strong answer: `emit` loops over a copy of the list, so the change shows up on the next `emit`, never in the current one. Add that `once` removes itself before it calls your function, which is why a re-entrant `emit` cannot run it twice.

## 7. The special `error` event

The name `'error'` is the only event name with a built-in rule:

> If you emit `'error'` and **nobody is listening**, `emit` throws.

```js
const a = new EventEmitter();
try {
  a.emit('error', new Error('disk is full'));
} catch (err) {
  console.log('  caught from emit:', err.message);
}

const b = new EventEmitter();
b.on('error', (err) => console.log('  handled:', err.message));
console.log('  emit returned:', b.emit('error', new Error('disk is full')));
```

```text
  caught from emit: disk is full
  handled: disk is full
  emit returned: true
```

Why this rule? Failures in streams, sockets and child processes happen later, in the background, where no `try/catch` can reach them. If an unhandled error were silently ignored, bugs would hide, so Node makes them loud. Without a `try/catch` the throw becomes an **uncaught exception** (an error that nobody caught) and the process stops. This is what it looks like (the stack lines are shortened, and the `node:events:487` line number differs between Node versions):

```js
const EventEmitter = require('node:events');
const e = new EventEmitter();
console.log('before');
e.emit('error', new Error('boom'));
console.log('never printed');
```

```text
before
node:events:487
      throw er; // Unhandled 'error' event
      ^

Error: boom
    at Object.<anonymous> (...crash.js:4:17)
    ... more stack lines ...
Emitted 'error' event at:
    ... more stack lines ...

Node.js v24.16.0
```

The process exits with code 1.

Rules to remember:
1. **Any emitter that can fail needs an `'error'` listener.** This is the most common real-world crash with streams, sockets, `http.get` requests and child processes.
2. **Emit `Error` objects.** An unhandled `emit('error', 'just a string')` throws a different error: `err.code` is `'ERR_UNHANDLED_ERROR'`, `err.message` is `Unhandled error. ('just a string')`, and the original value is in `err.context`.
3. **`errorMonitor` watches errors without handling them.** A listener registered on the symbol `events.errorMonitor` is called before the normal `error` listeners. It is good for logging and metrics, but it does not count as handling, so the throw still happens:

```js
const { errorMonitor } = EventEmitter;
const c = new EventEmitter();
c.on(errorMonitor, (err) => console.log('  monitor logged:', err.message));
try {
  c.emit('error', new Error('still unhandled'));
} catch (err) {
  console.log('  and it still threw:', err.message);
}
```

```text
  monitor logged: still unhandled
  and it still threw: still unhandled
```

> **Interview tip:** "What happens if you emit `'error'` and there is no listener?" It throws (the Error itself, or `ERR_UNHANDLED_ERROR` for a non-Error), and if nothing catches it the process crashes with exit code 1. The example is `examples/04-error-event.js`.

## 8. When a listener throws

Because `emit` is synchronous, an exception inside a listener travels up through `emit`. The listeners after the failing one **never run**:

```js
const d = new EventEmitter();
d.on('job', () => console.log('  listener 1 ran'));
d.on('job', () => {
  throw new Error('listener 2 failed');
});
d.on('job', () => console.log('  listener 3 ran'));
try {
  d.emit('job');
} catch (err) {
  console.log('  emit threw:', err.message, '(listener 3 never ran)');
}
```

```text
  listener 1 ran
  emit threw: listener 2 failed (listener 3 never ran)
```

If the listeners are written by other people (a plugin system), one bad plugin should not break the rest. Give each listener its own `try/catch`:

```js
function safeEmit(emitter, name, ...args) {
  for (const listener of emitter.rawListeners(name)) {
    try {
      listener.apply(emitter, args);
    } catch (err) {
      console.log('  listener failed, carrying on:', err.message);
    }
  }
}
safeEmit(d, 'job');
```

```text
  listener 1 ran
  listener failed, carrying on: listener 2 failed
  listener 3 ran
```

`rawListeners` is used (not `listeners`) so that `once` listeners still remove themselves.

> **Interview tip:** "If one listener throws, do the others still run?" No: the exception leaves `emit` at once, so the later listeners are skipped and the caller of `emit` gets the error. For untrusted listeners (plugins), wrap each call in its own `try/catch`.

## 9. The `newListener` and `removeListener` events

The emitter announces changes to its own listener list with two special events, both called with `(eventName, listener)`:
- `'newListener'` is emitted **before** a listener is added.
- `'removeListener'` is emitted **after** a listener is removed.

```js
const feed = new EventEmitter();
feed.on('newListener', (eventName) => {
  // Emitted BEFORE the listener is added, so the count is still the old one.
  console.log(`  newListener: "${String(eventName)}" (count so far: ${feed.listenerCount(eventName)})`);
});
feed.on('removeListener', (eventName) => {
  console.log(`  removeListener: "${String(eventName)}" (count now: ${feed.listenerCount(eventName)})`);
});
function onTick() {}
feed.on('tick', onTick);
feed.on('tick', () => {});
feed.off('tick', onTick);
```

```text
  newListener: "removeListener" (count so far: 0)
  newListener: "tick" (count so far: 0)
  newListener: "tick" (count so far: 1)
  removeListener: "tick" (count now: 1)
```

Look at the first line: adding the `'removeListener'` listener is itself a new listener, so `newListener` fires for it. The counts show the timing: "before" for `newListener`, "after" for `removeListener`. For a `once` listener, `newListener` receives your original function, not the internal wrapper.

`removeListener` is less tidy with `once`. When a `once` listener fires and it was the only listener of that event, you get your original function. When other listeners remain on the same event, Node 24.16 hands over the internal wrapper instead (part 7 of the example prints `true`, then `false`). So do not use `===` to recognise your function inside a `removeListener` handler.

A real use is **lazy start**: begin expensive work only when the first listener for an event arrives (part 2 of the example). You will rarely need these two events, but they appear in senior-level questions. The example is `examples/05-meta-events-and-leaks.js`.

## 10. Too many listeners: `MaxListenersExceededWarning` and memory leaks

A listener is a function, and a function keeps alive every outer variable it uses (this is its **closure**). If an emitter lives for a long time (a shared bus, a server, `process`) and short-lived code keeps adding listeners that are never removed, memory grows forever, and every later `emit` gets slower because it has more functions to call. This is the classic **EventEmitter memory leak**.

Node has a smoke alarm for it. The limit is `EventEmitter.defaultMaxListeners`, which is **10 listeners per event name, per emitter**. The 11th one prints a warning (once). It is only a warning: the listener is still added.

```js
const sharedBus = new EventEmitter();
for (let request = 1; request <= 12; request++) {
  sharedBus.on('config-changed', () => {}); // BUG: nobody ever removes this
}
console.log('  listeners on the shared bus:', sharedBus.listenerCount('config-changed'));
console.log('  default limit:', EventEmitter.defaultMaxListeners);
```

```text
  listeners on the shared bus: 12
  default limit: 10
```

On stderr (the error output channel, separate from normal output) you also see this. The number after `node:` is the process id and changes every run:

```text
(node:27280) MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 11 config-changed listeners added to [EventEmitter]. MaxListeners is 10. Use emitter.setMaxListeners() to increase limit
(Use `node --trace-warnings ...` to show where the warning was created)
```

The example also reads the warning in code with `process.on('warning', ...)`. The warning object has `name`, `count` (11 here), `type` (the event name) and `emitter`. To find a leak in a real program, run `node --trace-warnings app.js` to see where the 11th listener was added, and log `emitter.listenerCount(name)` over time.

How to fix it:

| Fix | When |
|---|---|
| `off` when the work is done (use `try/finally` or a `close` event) | the listener belongs to one short task |
| `once` | each task needs the event only one time |
| signal-based cleanup (`{ signal }`, sections 13 and 14) | many listeners should disappear together |
| a separate emitter per task (section 17) | the listeners belong to one request or job |
| `emitter.setMaxListeners(n)` | you really expect many listeners by design (use a number, not unlimited) |

```js
// fix A: remove it when the work is done
const bus = new EventEmitter();
for (let request = 1; request <= 12; request++) {
  const onChange = () => {};
  bus.on('config-changed', onChange);
  // ... the request finishes ...
  bus.off('config-changed', onChange);
}
console.log('  listeners left:', bus.listenerCount('config-changed'));
```

```text
  listeners left: 0
```

`setMaxListeners(0)` (or `Infinity`) switches the alarm off completely, which hides real leaks. Changing `EventEmitter.defaultMaxListeners` affects every emitter in the process, including the ones inside libraries, so prefer the per-emitter method.

> **Common mistake:** adding a listener inside a function that runs many times (a request handler, a retry loop) and never removing it. Also note that `once` only helps if the event actually fires: eleven pending `once` listeners on one event still trigger the warning.

`EventTarget` has the same alarm: 11 listeners for one type on a plain `EventTarget` print `MaxListenersExceededWarning: Possible EventTarget memory leak detected`. Raise it with `events.setMaxListeners(n, target)`. (An `AbortSignal` is exempt: `EventEmitter.defaultMaxListeners` has no effect on it, and on Node 24.16 adding many `abort` listeners prints no warning.)

> **Interview tip:** "You see `MaxListenersExceededWarning`. What do you do?" Do not raise the limit first. Find who adds the 11th listener (`node --trace-warnings`), check why it is never removed, and fix it with `off`, `once`, a `signal` or a per-task emitter. Use `setMaxListeners(n)` only when many listeners are intended. Also mention that it is only a warning: the 11th listener is still added.

## 11. Extending EventEmitter in a class

In real code you rarely pass around a bare `new EventEmitter()`. You write a class that **is** an emitter:

```js
class Downloader extends EventEmitter {
  constructor(name, steps) {
    super(); // always call super() first, it sets up the emitter
    this.name = name;
    this.steps = steps;
  }

  start() {
    let done = 0;
    const timer = setInterval(() => {
      done++;
      // Arrow function: "this" is still the Downloader.
      this.emit('progress', Math.round((done / this.steps) * 100));
      if (done === this.steps) {
        clearInterval(timer);
        this.emit('done', { name: this.name, steps: done });
      }
    }, 5);
    return this; // so you can write new Downloader(...).start()
  }

  fail(message) {
    this.emit('error', new Error(`${this.name}: ${message}`));
  }
}

const dl = new Downloader('report.pdf', 4);
dl.on('progress', (percent) => console.log(`  progress: ${percent}%`));
dl.on('error', (err) => console.log('  error event:', err.message));
dl.on('done', (info) => console.log('  done:', info));
dl.start();
```

Callers only need to know the event names: `progress`, `done`, `error`. The output (the example also calls `dl.fail('connection reset')` after `done`):

```text
  progress: 25%
  progress: 50%
  progress: 75%
  progress: 100%
  done: { name: 'report.pdf', steps: 4 }
  error event: report.pdf: connection reset
```

Things to know:
- Call `super()` before you use `this`.
- **Do not emit from the constructor.** The caller does not have the object until the constructor returns, so nobody can have attached a listener, and the event is lost. Emit from a method like `start()`, or delay it: `process.nextTick(() => this.emit('ready'))`. The example proves both (part 2).
- **Composition is an alternative.** Keep the emitter inside your class (`#events = new EventEmitter()`) and expose only `on` and your own methods. Then outsiders cannot call `emit` on your object. In the example, `typeof door.emit === 'function'` is `false` for the composed `Door`.
- Older code uses `util.inherits(MyClass, EventEmitter)`. Modern code uses `class ... extends`.
- Document the events your class emits (names and arguments). They are part of its public API. Name an event after what happened (`'saved'`, `'user:created'`), keep one style, and define the names as constants in bigger programs.

### Seeing every event: override `emit`

`EventEmitter` has no wildcard such as `on('*', fn)` or `on('user.*', fn)`. A subclass can add the "every event" behaviour by overriding `emit` and calling the original with `super.emit`:

```js
class LoudEmitter extends EventEmitter {
  emit(name, ...args) {
    if (name !== '*') super.emit('*', name, ...args); // tell the "any event" listeners first
    return super.emit(name, ...args); // keep the normal behaviour and return value
  }
}

const loud = new LoudEmitter();
loud.on('*', (name, ...args) => console.log(`  [any event] ${name}`, args));
loud.on('saved', (file) => console.log('  saved listener:', file));
console.log('  emit(saved) returned:', loud.emit('saved', 'a.txt'));
console.log('  emit(deleted) returned:', loud.emit('deleted', 'a.txt'));
```

```text
  [any event] saved [ 'a.txt' ]
  saved listener: a.txt
  emit(saved) returned: true
  [any event] deleted [ 'a.txt' ]
  emit(deleted) returned: false
```

It is handy for logging and debugging. The `'*'` name is only a convention, the class gives it no special meaning. Note the last line: `emit(deleted)` returns `false` because only the `'*'` listener ran for it, not a listener of `'deleted'` itself. Pattern matching like `user.*` would be your own code inside `emit`. This is part 4 of `examples/06-class-extends.js`.

> **Interview tip:** "How do you build a class that emits events, and what can go wrong?" Extend `EventEmitter`, call `super()` first, emit from methods (never the constructor), always emit `Error` objects on `'error'`, and document the event names. Mention composition as the way to hide `emit` from callers.

## 12. `events.once` and `events.on`: events as promises and async iterators

Listeners are callbacks. The `events` module also gives you two helpers for `async`/`await`.

### `events.once(emitter, name)`: wait for one event

It returns a promise that resolves with an **array** of the emitted arguments. If the emitter emits `'error'` while you wait, the promise **rejects** with that error:

```js
const { once, on } = require('node:events');

const job = new EventEmitter();
setTimeout(() => job.emit('ready', 'result-1', 'extra'), 5);
const args = await once(job, 'ready'); // an ARRAY of all emitted arguments
console.log('  arguments:', args);
console.log('  listeners left:', job.listenerCount('ready'), '(it cleaned up after itself)');

const broken = new EventEmitter();
setTimeout(() => broken.emit('error', new Error('connection lost')), 5);
try {
  await once(broken, 'ready');
} catch (err) {
  console.log('  rejected with:', err.message);
}
```

```text
  arguments: [ 'result-1', 'extra' ]
  listeners left: 0 (it cleaned up after itself)
  rejected with: connection lost
```

A very practical use is waiting for a server:

```js
const http = require('node:http');
const server = http.createServer();
server.listen(0); // port 0: the OS picks a free port
await once(server, 'listening');
console.log('  listening on a real port:', server.address().port > 0);
server.close();
await once(server, 'close');
console.log('  closed');
```

```text
  listening on a real port: true
  closed
```

Three gotchas:
- **Waiting for `'error'` itself.** `once(emitter, 'error')` resolves with the error instead of rejecting, because you asked for that event by name.
- **Events are not stored.** If the event already happened before you called `once`, you wait forever. Start waiting first, then trigger the work.
- **A pending promise does not keep Node alive.** If nothing else is running, the process just exits with code 0 and no message. This script prints only `waiting...`:

```js
const { once, EventEmitter } = require('node:events');

async function main() {
  const emitter = new EventEmitter();
  console.log('waiting...');
  await once(emitter, 'ready'); // nothing will ever emit, and nothing keeps Node alive
  console.log('never printed');
}
main();
```

```text
waiting...
```

In an ES module with top-level `await`, the same situation prints `Warning: Detected unsettled top-level await` and exits with code 13.

### `events.on(emitter, name)`: loop over events

`on` returns an **async iterator**: an object you can loop over with `for await`, which hands you one item at a time and waits when the next one has not arrived yet. Each item is the array of arguments of one event:

```js
const ticker = new EventEmitter();
setTimeout(() => {
  ticker.emit('tick', 1);
  ticker.emit('tick', 2);
  ticker.emit('tick', 3);
  ticker.emit('end');
}, 5);
// close: ['end'] stops the loop when "end" is emitted
for await (const [n] of on(ticker, 'tick', { close: ['end'] })) {
  console.log('  tick', n);
}
console.log('  loop finished, listeners left:', ticker.listenerCount('tick'));
```

```text
  tick 1
  tick 2
  tick 3
  loop finished, listeners left: 0
```

- The loop never ends on its own. It ends when you `break`, when the `close` option (Node 20+) names an event that fires, when an `AbortSignal` aborts, or when the emitter emits `'error'` (the loop throws).
- Leaving the loop removes the listener, so nothing leaks.
- Events that arrive while your loop body is busy are queued and delivered in order. The queue has no practical size limit by default (see the `highWaterMark` option in the docs).

| You want | Use |
|---|---|
| to react every time | `emitter.on('x', fn)` |
| to wait for the next single occurrence | `await once(emitter, 'x')` |
| to process a series in a loop | `for await (const [v] of on(emitter, 'x'))` |

The example is `examples/07-events-once-on.js` (parts 1 to 4 and 7).

> **Interview tip:** "How do you wait for an event with `async`/`await`?" Use `await events.once(emitter, 'name')`. A strong answer says why it beats `new Promise((resolve) => emitter.once('name', resolve))`: it also rejects when the emitter emits `'error'`, it removes its listeners in every case, and it accepts a `signal` for cancel or timeout. For a series of events, use `for await` over `events.on`.

## 13. `AbortSignal` with events

An `AbortController` lets one piece of code cancel work started by another. `once` and `on` accept `{ signal }`. When the signal aborts, the wait is cancelled, the listeners are removed, and the promise rejects with an `AbortError`:

```js
const silent = new EventEmitter();
const controller = new AbortController();
setTimeout(() => controller.abort(), 10);
try {
  await once(silent, 'never-happens', { signal: controller.signal });
} catch (err) {
  console.log('  rejected:', err.name, err.code);
  console.log('  listeners left:', silent.listenerCount('never-happens'));
}
```

```text
  rejected: AbortError ABORT_ERR
  listeners left: 0
```

The same works for a `for await` loop over `on(...)`: the loop throws `AbortError` and ends (part 6 of the example).

For a **timeout**, use `AbortSignal.timeout(ms)`. The error is still an `AbortError`, and the real reason is in `err.cause`:

```js
const { once, EventEmitter } = require('node:events');

async function main() {
  const emitter = new EventEmitter();
  const keepAlive = setTimeout(() => {}, 1000); // see the note below
  try {
    await once(emitter, 'ready', { signal: AbortSignal.timeout(50) });
  } catch (err) {
    console.log(err.name, '/', err.cause.name);
  }
  clearTimeout(keepAlive);
}
main();
```

```text
AbortError / TimeoutError
```

> **Common mistake:** expecting `AbortSignal.timeout` to keep the program alive. Its timer does not hold the process open (checked on Node 24.16): without the `keepAlive` timer above, Node would exit silently before the timeout fires. In a real server something else keeps the process alive, so this only bites in small scripts.

Two more tools:
- `AbortSignal.any([a, b])` gives a signal that aborts when the first of several signals aborts (used in Try it yourself 3).
- For `EventTarget`, `addEventListener('x', fn, { signal })` removes the listener when the signal aborts, so one `abort()` can clean up many listeners at once (section 14).

## 14. `EventTarget` and `Event`: the web-style API

Browsers have their own event system: `EventTarget` objects, `addEventListener`, `dispatchEvent` and `Event` objects. Node implements it too, so web code and web APIs like `AbortSignal` work the same way. `EventTarget`, `Event` and `CustomEvent` are globals.

```js
const target = new EventTarget();
target.addEventListener('ping', (event) => {
  console.log('  got event of type:', event.type);
  console.log('  event.target === target:', event.target === target);
});
target.dispatchEvent(new Event('ping'));
```

```text
  got event of type: ping
  event.target === target: true
```

The data travels inside the event object. To carry your own data use `new CustomEvent('order', { detail: { id: 7, total: 30 } })` and read `event.detail` in the listener (part 3 of the example).

### EventEmitter versus EventTarget

| | `EventEmitter` | `EventTarget` |
|---|---|---|
| add a listener | `on(name, fn)` | `addEventListener(type, fn, options)` |
| remove | `off(name, fn)` | `removeEventListener(type, fn)` or `{ signal }` |
| fire | `emit(name, ...args)` | `dispatchEvent(new Event(type))` |
| data | any number of arguments | one `Event` object (`CustomEvent.detail`) |
| same function added twice | runs twice | registered once |
| a listener throws (or returns a promise that rejects) | the exception reaches the `emit` caller (a rejected promise does not) | reported as an uncaught exception on `process.nextTick()`, other listeners still run |
| special `error` rule | yes | no |
| `prependListener`, `listenerCount`, `eventNames` | yes | no (use `events.getEventListeners(target, type)`) |
| cancelling | not built in | `preventDefault()` on a cancelable event |
| stop the remaining listeners | not possible (only a throw) | `event.stopImmediatePropagation()` |
| synchronous | yes | yes |

Proof of two differences (`getEventListeners` comes from `node:events`):

```js
function same() {
  console.log('  same() ran');
}
target.addEventListener('dup', same);
target.addEventListener('dup', same);
target.dispatchEvent(new Event('dup'));
console.log('  getEventListeners count:', getEventListeners(target, 'dup').length);
const emitter = new EventEmitter();
emitter.on('dup', same);
emitter.on('dup', same);
console.log('  EventEmitter count for the same case:', emitter.listenerCount('dup'));

const risky = new EventTarget();
risky.addEventListener('x', () => {
  throw new Error('listener failed');
});
risky.addEventListener('x', () => console.log('  second listener still ran'));
const result = risky.dispatchEvent(new Event('x'));
console.log('  dispatchEvent returned:', result, '(no exception here)');
```

```text
  same() ran
  getEventListeners count: 1
  EventEmitter count for the same case: 2
  second listener still ran
  dispatchEvent returned: true (no exception here)
```

The example then prints one more line, `[process] uncaughtException: listener failed`, from a `process.on('uncaughtException')` handler. Without such a handler, the thrown error would crash the process a moment after `dispatchEvent` returned.

More details:
- `{ once: true }` removes the listener after the first call. `{ signal }` removes it on abort.
- `dispatchEvent` returns `false` if a listener called `preventDefault()` on an event created with `{ cancelable: true }`.
- `event.stopImmediatePropagation()` stops the remaining listeners of that dispatch (part 11 of the example). `EventEmitter` has no equivalent.
- A function listener gets the target as `this`. A listener can also be an object with a `handleEvent(event)` method.
- You can extend it: `class Door extends EventTarget {}`.

### Which one does Node use?

- **EventEmitter**: the classic core modules: streams, `net`, `http`, `child_process`, `process`, `readline`, `worker_threads` workers, `cluster`.
- **EventTarget**: web-compatible APIs: `AbortSignal` (the `'abort'` event), `MessagePort` and the global `WebSocket` client (all three are `instanceof EventTarget` on Node 24.16).

For ordinary Node application code prefer EventEmitter: it has the richer API and the rest of the ecosystem uses it. Reach for EventTarget when you share code with browsers or work with `AbortSignal`. The example is `examples/09-event-target.js`.

> **Interview tip:** "What is the difference between EventEmitter and EventTarget?" A strong answer names: one `Event` object versus any arguments, duplicates ignored, no `error` magic, how errors thrown by listeners are handled, and where each one is used in Node.

## 15. The async listener gotcha, and `captureRejections`

An `async` function returns a promise, and `emit` ignores return values. So **`emit` does not wait for async listeners**:

```js
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const a = new EventEmitter();
a.on('save', async (name) => {
  await sleep(20);
  console.log('  async listener finished saving', name);
});
const returned = a.emit('save', 'file.txt');
console.log('  emit already returned:', returned);
console.log('  (the listener is still running)');
await sleep(40);
```

```text
  emit already returned: true
  (the listener is still running)
  async listener finished saving file.txt
```

Three consequences:
1. When `emit` returns, the work is not done. Code after `emit` cannot assume it is.
2. Two async listeners finish in the order their awaits finish, not in registration order.
3. A rejected promise from a listener does **not** make `emit` throw, so a `try/catch` around `emit` does not see it. It becomes an **unhandled rejection** (a promise failed and nobody was waiting to catch the failure). On Node 24 the default for those is to crash the process with exit code 1.

```js
const b = new EventEmitter();
b.on('save', async () => {
  throw new Error('disk is full');
});
try {
  b.emit('save');
  console.log('  emit did not throw');
} catch (err) {
  console.log('  caught by try/catch:', err.message);
}
```

```text
  emit did not throw
  [process] unhandledRejection: disk is full
```

The example installs a `process.on('unhandledRejection')` handler to print the second line. Without it the process would crash.

### Fixes

**A. Handle errors inside the listener.** Put a `try/catch` around the awaited work in the listener. Simple and explicit (part 3 of the example).

**B. `captureRejections: true`.** Node then checks whether a listener returned a promise, and if it rejects, sends the error to the emitter's `'error'` event:

```js
const d = new EventEmitter({ captureRejections: true });
d.on('error', (err) => console.log('  error event received:', err.message));
d.on('save', async () => {
  throw new Error('disk is full');
});
d.emit('save');
```

```text
  error event received: disk is full
```

The normal `'error'` rules apply: with `captureRejections` on and no `'error'` listener, the rejection is thrown as an unhandled error and the process crashes. The default is `false`. Setting `EventEmitter.captureRejections = true` changes the default for all new emitters.

**C. A custom rejection handler.** Define a method named `Symbol.for('nodejs.rejection')`. It receives the error, the event name and the original arguments:

```js
const e = new EventEmitter({ captureRejections: true });
e[Symbol.for('nodejs.rejection')] = (err, eventName, ...args) => {
  console.log(`  rejection handler: "${err.message}" from event "${eventName}" with args`, args);
};
e.on('save', async () => {
  throw new Error('disk is full');
});
e.emit('save', 'file.txt');
```

```text
  rejection handler: "disk is full" from event "save" with args [ 'file.txt' ]
```

**D. Really wait for the listeners.** Write a helper that collects the promises:

```js
async function emitAsync(emitter, name, ...args) {
  const results = emitter.rawListeners(name).map((listener) => listener.apply(emitter, args));
  await Promise.all(results);
  return results.length > 0;
}

const f = new EventEmitter();
f.on('save', async () => {
  await sleep(20);
  console.log('  listener 1 done');
});
f.on('save', async () => {
  await sleep(5);
  console.log('  listener 2 done');
});
await emitAsync(f, 'save');
console.log('  now every listener is finished');
```

```text
  listener 2 done
  listener 1 done
  now every listener is finished
```

This runs the listeners in parallel (see the order of the "done" lines). For one-by-one, use `for (const l of emitter.rawListeners(name)) await l.apply(emitter, args);`. If a listener throws synchronously, the helper rejects before it starts the later listeners, so decide what you want there.

> **Interview tip:** "Can you `await emitter.emit()`?" No: `emit` returns a boolean. Explain the three consequences and the fixes. The example is `examples/08-async-listeners.js`.

## 16. Build a mini EventEmitter from scratch

A very common coding interview task: "implement `on`, `emit`, `off` and `once`". Build it in small steps. The idea: a `Map` from event name to an array of functions.

**Step 1: `on` and `emit`.**

```js
class TinyEmitter {
  constructor() {
    this.listeners = new Map();
  }
  on(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(fn);
    return this;
  }
  emit(name, ...args) {
    const list = this.listeners.get(name);
    if (!list) return false;
    for (const fn of list) fn.apply(this, args);
    return true;
  }
}

const tiny = new TinyEmitter();
tiny.on('hi', (name) => console.log('  hello,', name));
console.log('  emit returned:', tiny.emit('hi', 'Ann'));
```

```text
  hello, Ann
  emit returned: true
```

`fn.apply(this, args)` makes `this` the emitter and spreads the arguments, like the real one. `return this` allows chaining. The full class in the example calls its Map `this.events`.

**Step 2: `prependListener`.** The same as `on`, but with `unshift` instead of `push`.

**Step 3: `off`.** Remove ONE instance, the most recently added, by looping backwards. Also match `list[i].listener === fn`, so `off(name, original)` works for `once` listeners (step 4):

```js
off(name, fn) {
  const list = this.events.get(name);
  if (!list) return this;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] === fn || list[i].listener === fn) {
      list.splice(i, 1);
      break;
    }
  }
  if (list.length === 0) this.events.delete(name);
  return this;
}
```

**Step 4: `once`.** A wrapper that removes itself first, then calls the original. It stores the original in `wrapper.listener`:

```js
once(name, fn) {
  const wrapper = (...args) => {
    this.off(name, wrapper);
    return fn.apply(this, args);
  };
  wrapper.listener = fn;
  return this.on(name, wrapper);
}
```

**Step 5: emit over a copy.** If a listener calls `off`, the array changes under the loop and a listener could be skipped. So loop over `[...list]`:

```js
for (const fn of [...list]) fn.apply(this, args);
```

**Step 6: the `error` rule.** If nobody listens to `'error'`, throw:

```js
if (!list || list.length === 0) {
  if (name === 'error') {
    throw args[0] instanceof Error ? args[0] : new Error(`Unhandled error. (${String(args[0])})`);
  }
  return false;
}
```

Add `listenerCount`, `eventNames` and `removeAllListeners` (a `Map` makes them one-liners) and you have most of the real API. The full class is in `examples/10-mini-emitter.js`.

How do you know yours matches the real one? Run the same scenario on both and compare. The example records what happens in an array for each class and calls `assert.deepEqual` on the two arrays. If even one line differs, the assert throws. The output is:

```text
  prepended Ann
  first Ann
  second Ann, this is the emitter: true
  emit(hi) returned true
  once got 1 and 2
  1st emit(one) returned true
  2nd emit(one) returned false
  emit(removed) returned false
  snap: first
  snap: second
  -- second emit(snap)
  snap: first
  snap: late
  listenerCount(hi) = 3
  eventNames = hi, snap
  error with no listener threw: boom
  error handled: boom
  on() returns the emitter: true
  eventNames after removeAllListeners = []
3. both logs are identical (19 lines compared)
```

(The example prints this log from `MiniEmitter`; the real `EventEmitter` produced exactly the same lines.)

> **Under the hood:** the real `EventEmitter` stores listeners in a plain object without a prototype, and keeps a single function directly when an event has only one listener (an array only for two or more). The result is the same as our Map of arrays, just tuned for speed. You can peek at `emitter._events`, but it is private, so never rely on it.

What interviewers check: `return this`, `fn.apply(this, args)`, a `once` that can be removed with `off`, a copy before looping, the `error` rule, and your complexity answer: `on` is O(1) (constant time, it does not slow down as listeners pile up), while `emit` and `off` are O(n) where n is the number of listeners of that event.

## 17. Patterns: pub/sub, event bus, request-scoped events

### Pub/sub

**Publish/subscribe** means publishers and subscribers share only a topic name. A small wrapper that hands back an "unsubscribe" function is a nice API, because nobody has to keep the handler around:

```js
const EventEmitter = require('node:events');

class PubSub {
  #emitter = new EventEmitter();

  subscribe(topic, handler) {
    this.#emitter.on(topic, handler);
    return () => this.#emitter.off(topic, handler);
  }

  publish(topic, message) {
    return this.#emitter.emit(topic, message);
  }
}

const pubsub = new PubSub();
const unsubscribe = pubsub.subscribe('news', (text) => console.log('  subscriber got:', text));
pubsub.publish('news', 'first');
unsubscribe();
console.log('  published after unsubscribe, anyone listening?', pubsub.publish('news', 'second'));
```

```text
  subscriber got: first
  published after unsubscribe, anyone listening? false
```

### Event bus

An **event bus** is one shared emitter that many modules import. Node caches modules, so every `require` of the same file returns the same object:

```js
// _bus.js
const EventEmitter = require('node:events');
module.exports = new EventEmitter();

// _audit.js: listens, and does not know who emits
const bus = require('./_bus.js');
const seen = [];
bus.on('user:created', (user) => {
  seen.push(`audit: user ${user.name} was created`);
});
module.exports = { seen };

// 11-patterns.js
const bus = require('./_bus.js');
const audit = require('./_audit.js');

console.log('  same object from every require():', require('./_bus.js') === bus);
bus.emit('user:created', { name: 'Ann' }); // _audit.js reacts to this
bus.emit('user:created', { name: 'Bob' });
console.log('  audit module saw:', audit.seen);
console.log('  bus.eventNames():', bus.eventNames());
```

```text
  same object from every require(): true
  audit module saw: [ 'audit: user Ann was created', 'audit: user Bob was created' ]
  bus.eventNames(): [ 'user:created' ]
```

Trade-offs to mention in an interview: the bus is global state, it is hard to see "who listens to this?", listeners must be registered before the emit (events are not stored), and tests need `bus.removeAllListeners()` between runs. Passing an emitter explicitly to the modules that need it is easier to test.

Also remember the limit of the whole approach: an `EventEmitter` works **inside one process**. It cannot reach another server, it keeps nothing if the process crashes, it never retries and it has no **back pressure** (a way for a slow receiver to tell the sender to slow down). For that you need a **message broker** (a separate server that stores and delivers messages, such as Redis, RabbitMQ or Kafka), a topic for the system design round. Between a parent and a child process, or a main thread and a worker, Node gives you message passing instead (`child.send()` and `postMessage()`, both arrive as `'message'` events).

### Request-scoped events

The leak in section 10 came from a long-lived emitter with short-lived listeners. There are two clean ways to avoid it.

**1. One emitter per request or job.** It is created with the request and freed from memory (garbage collected) when nothing refers to it any more, so nothing global can leak:

```js
function runJob(url) {
  const job = new EventEmitter();
  setImmediate(() => {
    job.emit('step', `parsed ${url}`);
    job.emit('step', `loaded data for ${url}`);
    job.emit('done', { url, ok: true });
  });
  return job;
}

const server = http.createServer((req, res) => {
  const log = [];
  const job = runJob(req.url); // new emitter for THIS request only
  job.on('step', (text) => log.push(text));
  job.once('done', (result) => res.end(JSON.stringify({ result, log })));
});
```

Requesting `/a` and `/b` from the example's client prints:

```text
  GET /a -> {"result":{"url":"/a","ok":true},"log":["parsed /a","loaded data for /a"]}
  GET /b -> {"result":{"url":"/b","ok":true},"log":["parsed /b","loaded data for /b"]}
```

**2. A correlation id in the event name** on a shared bus (a correlation id is a unique number that ties a reply to its question). The asker listens with `once` on a name that contains its own id, so replies cannot get mixed up:

```js
bus.on('question', ({ id, text }) => {
  // a pretend worker; it answers on an event name that contains the id
  setTimeout(() => bus.emit(`answer:${id}`, text.toUpperCase()), 5);
});
let nextId = 0;
function ask(text) {
  const id = ++nextId;
  return new Promise((resolve) => {
    bus.once(`answer:${id}`, resolve); // once: the listener cleans itself up
    bus.emit('question', { id, text });
  });
}
const answers = await Promise.all([ask('one'), ask('two'), ask('three')]);
console.log('  answers:', answers);
console.log('  listeners left on the bus:', bus.eventNames());
```

```text
  answers: [ 'ONE', 'TWO', 'THREE' ]
  listeners left on the bus: [ 'user:created', 'question' ]
```

No `answer:*` listeners are left. If a reply may never come, add a timeout (`events.once` with `{ signal: AbortSignal.timeout(...) }`), or that listener stays forever.

### Advanced: which request context do listeners see?

`AsyncLocalStorage` (lesson 22, section 8) keeps a value, such as a request id, available through a whole chain of `await`s and callbacks. Because `emit` is synchronous, a listener of a plain `EventEmitter` runs inside the code that called `emit`, so it sees the context of the code that called `emit`, not of the code that called `on`. `events.EventEmitterAsyncResource` does the opposite: it always runs listeners in the context where the emitter was created.

```js
const { AsyncLocalStorage } = require('node:async_hooks');
const { EventEmitterAsyncResource } = EventEmitter;

const store = new AsyncLocalStorage();
const plain = new EventEmitter();
const tracked = store.run('created-here', () => new EventEmitterAsyncResource({ name: 'Tracked' }));
plain.on('hi', () => console.log('  plain EventEmitter listener sees:', store.getStore()));
tracked.on('hi', () => console.log('  EventEmitterAsyncResource listener sees:', store.getStore()));
store.run('request-42', () => {
  plain.emit('hi'); // emit is synchronous, so the listener runs inside request-42
  tracked.emit('hi'); // this class always runs listeners in the context where it was created
});
```

```text
  plain EventEmitter listener sees: request-42
  EventEmitterAsyncResource listener sees: created-here
```

For a normal request-scoped emitter the plain class is what you want: the listener sees the right request id. Reach for `EventEmitterAsyncResource` when a long-lived emitter (a pool, a connection) should keep its own context no matter who emits. This is part 5 of `examples/11-patterns.js`, and it is a senior-level detail you can skip on a first read.

> **Interview tip:** "What is the difference between pub/sub, an event bus and a message broker?" Pub/sub is the idea (publishers and subscribers share only a topic). An event bus is a pub/sub object inside one process, usually a shared `EventEmitter`. A message broker is a separate server that does the same across processes and machines, and adds storage, retries and delivery guarantees. The example is `examples/11-patterns.js` (plus the helpers `_bus.js` and `_audit.js`).

## 18. EventEmitter inside Node core

You use EventEmitter every day without writing `new EventEmitter()`:

| Object | Common events |
|---|---|
| `process` | `exit`, `beforeExit`, `uncaughtException`, `unhandledRejection`, `warning`, `SIGINT` |
| readable stream | `data`, `end`, `error`, `close`, `readable` |
| writable stream | `drain`, `finish`, `error`, `close` |
| `http.Server` | `request`, `connection`, `listening`, `close`, `error`, `clientError` |
| `net.Socket` | `connect`, `data`, `end`, `close`, `error`, `timeout` |
| child process | `spawn`, `exit`, `close`, `error`, `message` |
| `fs.FSWatcher` | `change`, `error`, `close` |
| `readline.Interface` | `line`, `close` |
| `worker_threads` `Worker` | `online`, `message`, `error`, `exit` |

All of these classes inherit from `EventEmitter` (part 1 of `examples/12-core-modules.js` checks six of them with `instanceof`). Some details, with real output:

**Streams** emit their events in a fixed order. An `fs` read stream opens, becomes ready, delivers data, ends, then closes. A write stream finishes writing (`'finish'`) before it closes:

```text
  read stream: open > ready > data > end > close
  write stream: open > ready > finish > close
```

**An HTTP server** is just an emitter. `http.createServer(handler)` simply adds `handler` as a listener of the `'request'` event:

```js
const server = http.createServer((req, res) => res.end('ok'));
console.log('  request listeners:', server.listenerCount('request'));
```

```text
  request listeners: 1
```

For one request, with extra listeners on `'listening'`, `'connection'`, `'request'` and `'close'`, the order is:

```text
  server events: listening > connection > request > close
```

Also listen for `'error'` on the server. If the port is already in use, `listen` fails with `EADDRINUSE`, and that arrives as an `'error'` event.

**A child process** has `'spawn'` (it started), `'exit'` (it ended) and `'close'` (it ended **and** its stdio streams are closed). Wait for `'close'` if you need all of its output:

```text
  lifecycle: spawn > exit(0) > close
  child printed: hello from the child
```

Do not depend on the order of `'exit'` relative to the `'data'` events of its stdout. That is why the example collects the output separately and prints it after `'close'`. `child.stdout` and `child.stderr` are streams, so they are emitters too.

**`process`** is an emitter, and `'exit'` is its last event. According to the docs, an `'exit'` listener may only do synchronous work, because the process is shutting down and the event loop will run nothing more:

```text
6. process "exit" event, code: 0
```

Part 5 of the example checks the web-style side: `AbortSignal` and `MessagePort` are `EventTarget` objects.

> **Common mistake:** forgetting `'error'` on objects that can fail later: `http.get(...)` requests, sockets, child processes and streams. The failure arrives as an `'error'` event, and with no listener it crashes the process (section 7). In the example, `req.on('error', reject)` is on the `http.get` request.

## 19. Error handling strategies

| Situation | Problem | Strategy | Section |
|---|---|---|---|
| any emitter that can fail later | `emit('error')` with no listener crashes the process | always add an `'error'` listener, and emit real `Error` objects | 7 |
| a sync listener throws | `emit` throws, later listeners are skipped | `try/catch` around `emit`, `try/catch` inside the listener, or a `safeEmit` helper for plugins | 8 |
| an async listener rejects | unhandled rejection, `emit` does not throw | `try/catch` inside the listener, `captureRejections`, or `emitAsync` | 15 |
| you want logs or metrics for errors | handling them would hide them | `errorMonitor` | 7 |
| you wait with `await once(...)` | an error event makes the promise reject | wrap in `try/catch` | 12 |
| listeners must not outlive a task | leak warning | `off` in `finally`, `once`, `{ signal }`, per-task emitters | 10, 13, 17 |
| the process is in an unknown state | continuing may corrupt data | `process.on('uncaughtException')` is for logging and cleanup, then exit and let a process manager restart. It is not a way to carry on. | |

A good default for a class that emits events:
1. Document its events, including `'error'`.
2. Emit `Error` objects.
3. After an `'error'`, release resources (timers, sockets) so the object does not stay alive.
4. Keep listeners small, and put slow or failing work behind a `try/catch` or a promise that you handle.

> **Interview tip:** "How do you handle errors in event-driven code?" A strong answer names the three channels and does not mix them up: failures that happen later arrive as an `'error'` event (so always listen), a synchronous listener that throws surfaces at the `emit` call (so `try/catch` or guard each listener), and an async listener that rejects never reaches `emit` (so handle it inside, or use `captureRejections`). Process-level handlers are for logging and a clean exit, not for carrying on.

## 20. Interview angle: what you will be asked

| Question | What a strong answer includes |
|---|---|
| Is `emit` synchronous or asynchronous? | Synchronous. Listeners run in registration order before `emit` returns. Show before/after logs. Defer with `setImmediate` or `process.nextTick` if you need async. |
| What happens when you emit `'error'` with no listener? | It throws the error (`ERR_UNHANDLED_ERROR` for a non-Error). Uncaught means the process crashes. Add a listener, or use `errorMonitor` only to observe. |
| How do you remove a listener? | `off` with the same function reference. Anonymous functions cannot be removed. `once` listeners can be removed with the original function. |
| What is `MaxListenersExceededWarning`? | Default 10 listeners per event per emitter. It signals a likely leak. Fix the leak. `setMaxListeners` only when many listeners are intended. |
| What is `this` in a listener? | The emitter for regular functions. Arrow functions keep the outer `this`. Methods lose their object unless bound. |
| Does `emit` wait for async listeners? | No. Explain unhandled rejections, `captureRejections`, and a helper that awaits `Promise.all`. |
| EventEmitter versus EventTarget? | The table in section 14. |
| Implement an EventEmitter. | Section 16, with `once`, `off`, copy-before-emit and the `error` rule. |
| How are streams and EventEmitter related? | Streams inherit from EventEmitter. `data`, `end`, `error`, `drain`, `finish` are events. |
| How do you turn an event into a promise? | `events.once`, with `{ signal }` for cancel or timeout. For a series, `events.on` with `for await`. |
| Does `EventEmitter` support wildcard listeners? | No. Override `emit` in a subclass to also emit a `'*'` event (section 11), or match patterns in your own code. |
| How do you make listeners run later? | `emit` is always synchronous, so defer the call: `setImmediate`, `queueMicrotask` or `process.nextTick` (section 4). |
| Can an emitter send events to another process or server? | No, it only works inside one process. Use `child.send` / `postMessage` between processes and threads, and a message broker between machines (section 17). |

## Summary / Key takeaways
- An `EventEmitter` keeps a list of listener functions per event name. `emit(name, ...args)` calls them, `on` and `once` add them, `off` removes them.
- `emit` is **synchronous**: listeners run in registration order, on the same call stack, before `emit` returns. Changes made while emitting apply to the next `emit`.
- Emitting `'error'` with no listener **throws**. Every emitter that can fail later needs an `'error'` listener, and you should emit real `Error` objects.
- The 11th listener on one event prints `MaxListenersExceededWarning`. It almost always means a leak, so remove listeners when the work is done.
- Inside a listener `this` is the emitter (regular function) or the outer `this` (arrow). `emit` ignores promises, so async listeners need their own error handling or `captureRejections`.
- `events.once` turns an event into a promise, `events.on` into an async iterator, and `AbortSignal` cancels both.
- `EventTarget` is the web version: one `Event` object, duplicates ignored, no `error` rule. Node core uses EventEmitter for streams, http, process and child processes.
- You can build a working emitter in about 50 lines: a Map of arrays, `once` wrappers, a copy before looping, and the `error` rule.

## Quick check

1. Is `emit` synchronous or asynchronous? How can you prove it?
<details><summary>Answer</summary>

Synchronous. Log a line before and after the `emit` call. The listener's output appears between them, because `emit` calls every listener and returns only when all are finished.

</details>

2. What happens when you call `emitter.emit('error', new Error('x'))` and there is no `'error'` listener?
<details><summary>Answer</summary>

`emit` throws that error. If nothing catches it, the process crashes with exit code 1. With a non-Error argument it throws an error with code `ERR_UNHANDLED_ERROR` instead, and the original value is in `err.context`.

</details>

3. Why does this not remove the listener? `emitter.on('x', () => work()); emitter.off('x', () => work());`
<details><summary>Answer</summary>

The two arrow functions are different objects, and `off` compares by reference. Keep the function in a variable and pass that same variable to both `on` and `off`.

</details>

4. You add A and B with `on`, then C with `prependListener`, all for `'go'`. In what order do they run? What if B removes C during the emit?
<details><summary>Answer</summary>

C, A, B. C comes first because it was prepended. If B removes C during the emit, nothing changes for the current emit, because `emit` works on a copy of the list (and C has already run anyway). The removal shows from the next `emit`.

</details>

5. What is `this` inside a listener written as a regular function, and inside an arrow function?
<details><summary>Answer</summary>

In a regular function it is the emitter. In an arrow function it is whatever `this` was in the surrounding code. A method passed directly (`on('x', obj.method)`) gets the emitter as `this`, so use `bind` or an arrow wrapper.

</details>

6. What does Node print when you add an 11th listener for one event, and what does it usually mean?
<details><summary>Answer</summary>

`MaxListenersExceededWarning: Possible EventEmitter memory leak detected`. The default limit is 10 per event per emitter. It usually means listeners are added repeatedly (for example in a request handler) and never removed. Fix the leak with `off`, `once` or a per-request emitter. Raise the limit with `setMaxListeners(n)` only if many listeners are intended.

</details>

7. An `async` listener throws. Does `emit` throw? What can you do?
<details><summary>Answer</summary>

No. `emit` ignores the returned promise, so the rejection becomes an unhandled rejection (a crash by default on Node 24). Use `try/catch` inside the listener, create the emitter with `captureRejections: true` (rejections go to the `'error'` event), or write a helper that awaits `Promise.all` of the listener results.

</details>

8. What does `await once(emitter, 'ready')` return, and when does it reject?
<details><summary>Answer</summary>

It resolves with an array of the arguments of the first `'ready'` event. It rejects if the emitter emits `'error'` first, or with an `AbortError` if you passed a `signal` that aborts. It removes its listeners in every case.

</details>

9. Name three differences between `EventEmitter` and `EventTarget`.
<details><summary>Answer</summary>

Any three of these: `EventTarget` passes one `Event` object while `emit` passes any arguments; adding the same function twice is ignored by `EventTarget` but runs twice with `EventEmitter`; there is no special `'error'` event; an error thrown by an `EventTarget` listener does not reach the `dispatchEvent` caller; `EventTarget` has no `listenerCount`, `eventNames` or `prependListener`.

</details>

10. Why should a class not call `this.emit('ready')` in its constructor?
<details><summary>Answer</summary>

The code that calls `new MyClass()` does not have the object until the constructor returns, so it cannot have added a listener yet, and the event is lost. Emit from a method such as `start()`, or delay it with `process.nextTick`.

</details>

## Try it yourself

### Task 1 (easy): predict the output
Read this code and write down the exact output before you run it. Then run it and check.

```js
const EventEmitter = require('node:events');

const e = new EventEmitter();
e.on('a', () => console.log('1'));
e.once('a', () => console.log('2'));
e.prependListener('a', () => console.log('3'));

console.log('start');
e.emit('a');
e.emit('a');
console.log('end', e.listenerCount('a'));
```

<details><summary>Hint</summary>

The `prependListener` listener goes to the front. A `once` listener only runs on the first `emit`. Count the listeners that are left at the end.

</details>

<details><summary>Solution</summary>

Save the code in a file and run it with `node`. The output is:

```text
start
3
1
2
3
1
end 2
```

First emit: `3` (prepended), `1`, `2`. The `once` listener removes itself. Second emit: `3` and `1`. Two listeners are left.

</details>

### Task 2 (medium): a Countdown class
Write `class Countdown extends EventEmitter` with a `start(from)` method. Every 10 ms it emits `'tick'` with the remaining number (`from`, `from - 1`, ... `1`), then emits `'done'`. If `from` is not a positive integer, `start` must emit `'error'` with a `RangeError` instead. Add a `stop()` method that clears the timer and emits `'stopped'`.

<details><summary>Hint</summary>

Keep the timer id in a private field (`#timer`). Use `setInterval` with an arrow function so `this` is the countdown. Clear the interval when the counter reaches 0. Check the input with `Number.isInteger(from) && from >= 1`.

</details>

<details><summary>Solution</summary>

```js
const EventEmitter = require('node:events');

class Countdown extends EventEmitter {
  #timer = null;

  start(from) {
    if (!Number.isInteger(from) || from < 1) {
      this.emit('error', new RangeError(`from must be a positive integer, got ${from}`));
      return this;
    }
    let remaining = from;
    this.#timer = setInterval(() => {
      this.emit('tick', remaining);
      remaining--;
      if (remaining === 0) {
        clearInterval(this.#timer);
        this.#timer = null;
        this.emit('done');
      }
    }, 10);
    return this;
  }

  stop() {
    if (this.#timer === null) return this;
    clearInterval(this.#timer);
    this.#timer = null;
    this.emit('stopped');
    return this;
  }
}

// 1. a normal run
const c = new Countdown();
c.on('tick', (n) => console.log('tick', n));
c.on('error', (err) => console.log('error:', err.message));
c.once('done', () => {
  console.log('done');

  // 2. bad input goes to the error event
  c.start(0);
  c.start('x');

  // 3. stop in the middle
  const d = new Countdown();
  d.on('tick', (n) => {
    console.log('d tick', n);
    if (n === 4) d.stop();
  });
  d.on('stopped', () => console.log('d stopped'));
  d.on('done', () => console.log('d done (never printed)'));
  d.start(5);
});
c.start(3);
```

Output:

```text
tick 3
tick 2
tick 1
done
error: from must be a positive integer, got 0
error: from must be a positive integer, got x
d tick 5
d tick 4
d stopped
```

</details>

### Task 3 (harder): `waitForAll` with no leftover listeners
Write `waitForAll(emitter, names, { signal })`. It returns a promise that resolves with an object `{ name: argsArray, ... }` once **every** event in `names` has been emitted at least once (in any order). It must reject if the emitter emits `'error'` or if `signal` aborts. In every case (success, error, abort) the emitter must have **zero** listeners left afterwards.

<details><summary>Hint</summary>

`Promise.all(names.map((name) => once(emitter, name, { signal })))` is almost enough, but when one `once` rejects, the other waits are still pending and still hold listeners. Create your own `AbortController`, combine it with the caller's signal using `AbortSignal.any`, and call `abort()` on yours in a `finally` block.

</details>

<details><summary>Solution</summary>

```js
const EventEmitter = require('node:events');
const { once } = EventEmitter;

// Resolves with an object of all arguments once every event has fired at least once.
// Rejects on 'error' or when the signal aborts. Leaves no listeners behind.
async function waitForAll(emitter, names, { signal } = {}) {
  const inner = new AbortController();
  const combined = signal ? AbortSignal.any([signal, inner.signal]) : inner.signal;
  try {
    const results = await Promise.all(names.map((name) => once(emitter, name, { signal: combined })));
    return Object.fromEntries(names.map((name, i) => [name, results[i]]));
  } finally {
    inner.abort(); // cancels the waits that are still pending, which removes their listeners
  }
}

function listeners(e, names) {
  return [...names, 'error'].map((n) => `${n}:${e.listenerCount(n)}`).join(' ');
}

async function main() {
  const names = ['db', 'cache', 'queue'];

  // success, in any order
  const e1 = new EventEmitter();
  setTimeout(() => e1.emit('cache', 'cache ok'), 5);
  setTimeout(() => e1.emit('queue', 'queue ok'), 10);
  setTimeout(() => e1.emit('db', 'db ok'), 15);
  console.log('success:', await waitForAll(e1, names), '| left:', listeners(e1, names));

  // error
  const e2 = new EventEmitter();
  setTimeout(() => e2.emit('db', 'db ok'), 5);
  setTimeout(() => e2.emit('error', new Error('cache crashed')), 10);
  try {
    await waitForAll(e2, names);
  } catch (err) {
    console.log('error:', err.message, '| left:', listeners(e2, names));
  }

  // abort
  const e3 = new EventEmitter();
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 10);
  try {
    await waitForAll(e3, names, { signal: ac.signal });
  } catch (err) {
    console.log('abort:', err.name, '| left:', listeners(e3, names));
  }
}

main();
```

Output:

```text
success: { db: [ 'db ok' ], cache: [ 'cache ok' ], queue: [ 'queue ok' ] } | left: db:0 cache:0 queue:0 error:0
error: cache crashed | left: db:0 cache:0 queue:0 error:0
abort: AbortError | left: db:0 cache:0 queue:0 error:0
```

</details>

## Where to go next
- Next lesson: [10. Buffers and Binary Data](../10-buffers/README.md). Many of the objects you meet there (streams, sockets, files) are the emitters from this lesson.
- Practise this topic in the interview rounds: [round 1 screening](../../rounds/round-1-screening/questions.md) for the basics, [round 2 core](../../rounds/round-2-core/questions.md) for sync emit, `error`, leaks and `this`, [round 3 coding](../../rounds/round-3-coding/questions.md) for "implement an EventEmitter", and [round 4 advanced](../../rounds/round-4-advanced/questions.md) for `captureRejections`, `events.on` and design trade-offs.
- Run all the examples of this lesson at once: `node scripts/check-examples.js 09-events --verbose`.
