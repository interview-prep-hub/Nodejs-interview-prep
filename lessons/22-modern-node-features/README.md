# 22. Modern Node.js: What Changed in Node 18, 20, 22 and 24

> Level: Advanced   Time: about 180 minutes   Node: 24 (notes where older versions differ)

[Previous: 21. TypeScript with Node.js](../21-typescript-with-node/README.md) | [All lessons](../../README.md) | [Next: 23. Node.js Internals: V8, libuv and How It All Fits](../23-node-internals/README.md)

## What you will learn
- How Node releases work: Current, Active LTS, Maintenance and End-of-life, why production runs an LTS line, how to plan upgrades, and the rule change that starts with Node 27
- A release-by-release timeline for Node 18, 20, 22, 24, 25 and 26 with the headline features of each
- Web standards that are now built in: `fetch`, `AbortSignal`, `structuredClone`, `WebSocket`, `URLPattern`, Web Crypto, Web Streams, `BroadcastChannel`
- Tools that now live inside the `node` program: `--watch`, `--env-file`, `--run`, `util.parseArgs`, `util.styleText`, `node:test`, `node:sqlite`, `fs.glob`
- Module changes: `require(esm)`, syntax detection, `import.meta.dirname`, import attributes, and running TypeScript files by stripping types
- The permission model and single executable applications: what they do and what they do not promise
- New JavaScript features that came with a newer V8 engine: `groupBy`, Set methods, iterator helpers, `using` and more
- Which npm packages you can drop (and what you lose), which APIs are deprecated or removed, an upgrade checklist, and a 60-second answer to "what is new in Node?"

**How to use this lesson.** Run every example from the repo root, for example `node lessons/22-modern-node-features/examples/01-detect-features.js`. The examples use only core modules, need no internet and finish by themselves. Helper files live in `examples/_helpers/`.

**About the outputs.** They were captured on Windows 11 with Node 24.16.0. Release dates and statuses were checked on 2026-11-10 against the official schedule. Dates can change, so confirm them on the [Node.js previous releases page](https://nodejs.org/en/about/previous-releases). Things that only exist in Node 25 or 26 come from the official changelogs and were not run here; the text says so each time. A few examples start extra `node` processes and take a few seconds.

**This lesson is long on purpose.** Read it in two passes. First pass, the sections interviewers ask about most: 2 (release policy), 4 (feature detection), 5 (`fetch`), 9 (`--env-file`, `--watch`, `--run`), 12 (`require(esm)`), 17 (replacements), 19 (upgrades) and 20 (the 60-second answer). Second pass, everything else, as a reference you can come back to.

## 1. Where changes come from, and how to read a stability label

Node is built from a few big parts. Your JavaScript runs on the **V8 engine** (the same engine as Chrome). A C library called **libuv** waits for files and network traffic. On top sit Node's own APIs such as `fs` and `http`. When something new arrives in Node, it comes from one of these places:

| Source of change | Examples | Where you see it |
|---|---|---|
| Node's own APIs | `fs.glob`, `node:test`, global `fetch` | release notes, API docs |
| Command-line flags | `--watch`, `--env-file`, `--run`, `--permission` | `node --help` |
| A newer V8 engine (new JavaScript language features) | `Object.groupBy`, Set methods, `using` | `process.versions.v8` |
| The module system | `require(esm)`, syntax detection, type stripping | module docs |
| Deprecations and removals | `url.parse()`, `new Buffer()`, `SlowBuffer` | warnings at run time |

A **flag** is an option you type after `node`, such as `node --watch app.js`. A feature "behind a flag" is switched off until you pass its flag.

The JavaScript features follow the V8 version that a Node line ships: Node 18 has V8 10.1, Node 20 has 11.3, Node 22 has 12.4, Node 24 has 13.6 and Node 26 has 14.6. If you know which V8 a line uses, you can guess which language features it has.

Node's documentation puts a **stability index** on every API. This is how to read it:

| Level | Name | Meaning |
|---|---|---|
| 0 | Deprecated | Do not use. It may print a warning and may be removed. |
| 1 | Experimental | May change or vanish in any release, even a patch. Sub-levels: 1.0 early development, 1.1 active development, 1.2 release candidate. |
| 2 | Stable | Safe. Breaking changes need a long deprecation first. |
| 3 | Legacy | Still works, but newer replacements exist. |

> **Remember:** Stability belongs to a feature, not to a whole module. `node:test` is stable since Node 20, but its code coverage and `mock.module()` parts are still experimental on Node 24.16. `URLPattern` is a global that prints no warning, yet the Node 24 docs still call it experimental. Always read the label of the exact API you use.

## 2. The release policy in plain words

Node publishes a **major version** (the first number: 22, 24, 26) on a schedule. Each major line goes through phases:

| Phase | What it means | Use it in production? |
|---|---|---|
| Alpha (new from Node 27) | Early testing. Breaking changes are still allowed between alpha releases. | No |
| Current | New line, about 6 months. New features land. Library authors test against it. | Only to test |
| Active LTS | **Long-term support**, about 12 months. Regular updates and bug fixes. | Yes |
| Maintenance LTS | About 18 months. Only critical bug fixes and security fixes. | Yes, but plan the next upgrade |
| End of life (EOL) | No more fixes of any kind, not even security fixes. | No |

So an LTS line is supported for about 30 months in total (12 Active plus 18 Maintenance). The nodejs.org page on previous releases says it directly: "Production applications should only use Active LTS or Maintenance LTS releases."

### The even/odd rule, and why it ends

For every line up to Node 26 the rule was:

- **Even numbers (18, 20, 22, 24, 26) become LTS** in October, about six months after the first release.
- **Odd numbers (19, 21, 23, 25) never become LTS.** They live for about six months and then reach end of life.
- The first release that carries the LTS label is **not** `x.0.0`. For example Node 24 became LTS with `v24.11.0` on 2025-10-28.
- Codenames are element names in alphabetical order: Hydrogen (18), Iron (20), Jod (22), Krypton (24), Lithium (26). "Jod" is the German word for iodine, not a typo.

Starting with **Node 27** the rules change. There will be **one major release per year**, in April. Every release becomes LTS (no odd/even difference), a new **Alpha** channel starts the October before (where breaking changes are allowed), and the version number is the year of the first Current release (27.0.0 in 2027, 28.0.0 in 2028). Node 26 is the last line under the old model. The official schedule says it "is not final and may be amended", so say "planned for April 2027".

### The lines today (checked 2026-11-10)

| Line | Codename | Status today | Current from | Became LTS | Maintenance from | End of life |
|---|---|---|---|---|---|---|
| 18 | Hydrogen | End of life | 2022-04-19 | 2022-10-25 | 2023-10-18 | 2025-04-30 |
| 20 | Iron | End of life | 2023-04-18 | 2023-10-24 | 2024-10-22 | 2026-04-30 |
| 22 | Jod | Maintenance LTS | 2024-04-24 | 2024-10-29 | 2025-10-21 | 2027-04-30 |
| 24 | Krypton | Maintenance LTS | 2025-05-06 | 2025-10-28 | 2026-10-20 | 2028-04-30 |
| 25 | none | End of life (odd, never LTS) | 2025-10-15 | never | 2026-04-01 | 2026-06-01 |
| 26 | Lithium | **Active LTS** | 2026-05-05 | 2026-10-28 | 2027-10-20 | 2029-04-30 |
| 27 | not chosen yet | Alpha | planned 2027-04-22 | planned 2027-10-20 | not used | planned 2030-04-30 |

Read it like this: only Node 26 is in the Active LTS phase today. Node 24 and Node 22 are in Maintenance, which is still fine for production. Node 20 and Node 18 are out of support. Node 25 was never meant for production and has been dead since 2026-06-01.

### Why production should run an LTS line

- You get security fixes for a long time, so you are not forced to upgrade every six months.
- Your dependencies (frameworks, database drivers, native addons) test against LTS lines first.
- A non-LTS line dies after about six months. A service built on Node 25 had to be moved before June 2026.

### How to plan upgrades

These are rules of thumb, not official rules:

1. Write down the EOL date of the line you run. A service on Node 22 has until 2027-04-30, which is less than six months from the date of this lesson.
2. Start testing the next LTS line as soon as it enters Active LTS (here: Node 26, since `v26.13.0` on 2026-10-28). Do the real upgrade while the old line is still supported, never after its EOL.
3. New projects should start on the Active LTS line (Node 26 today).
4. Keep patch and minor versions fresh inside your line. The machine that produced this lesson runs `v24.16.0`, while the newest Node 24 release is `v24.22.2`, six minor versions ahead. That is why the lessons say "Node 24 or newer".
5. Read the release notes of every major you cross. Skipping a major is possible, but you must read the breaking changes of the ones you skip.

The file [`examples/01-detect-features.js`](examples/01-detect-features.js) starts by asking the running program which Node it is:

```js
const major = Number(process.versions.node.split('.')[0]);
console.log('  version:', process.version);
console.log('  on an LTS line:', typeof process.release.lts === 'string');
console.log('  LTS codename:', process.release.lts);
```

```text
1. Runtime
  version: v24.16.0
  major is a number: true
  on an LTS line: true
  LTS codename: Krypton
  V8 engine version has dots: true
  engine for fetch (undici) is bundled: true
```

`process.release.lts` holds the codename on an LTS line and is `undefined` on a Current or odd line, so a program can warn "you are not running an LTS Node".

> **Interview tip:** "Which Node version would you use in production, and why?" A strong answer names the policy, not a number: "An LTS line, preferably Active LTS for a new project (Node 26 today), Maintenance LTS is acceptable while I plan the upgrade. Never an odd or Current line, never an end-of-life line." Add that from Node 27 every release becomes LTS.

> **Common mistake:** Saying "even versions are LTS" as a permanent law, or "Node 25 is the newest LTS". The even rule is true for 18 to 26 and then stops; odd lines are never LTS.

## 3. A timeline of the headline features

You will not memorise every release, but you should know the story of each line. "Landed in" is the first version that had the feature (the row says when it was behind a flag or marked experimental at first). "Today" is the state in the Node 24.16 docs (and the Node 26.13 docs where they differ).

### Node 18 "Hydrogen" (V8 10.1, EOL 2025-04-30)

| Feature | Landed in | Today |
|---|---|---|
| Global `fetch`, `FormData`, `Headers`, `Request`, `Response` (marked experimental at first) | 18.0.0 | Stable since 21.0.0 |
| `node:test` core test runner (experimental) | 18.0.0 | Stable since 20.0.0 |
| `util.parseArgs` | 18.3.0 | Stable since 20.0.0 |
| `node --watch` | 18.11.0 | Stable since 22.0.0 (and 20.13.0) |
| Single executable applications (first version) | 18.16.0 | Still "1.1 active development" |
| `AbortSignal.any` | 20.3.0 and 18.17.0 | Stable |

### Node 20 "Iron" (V8 11.3, EOL 2026-04-30)

| Feature | Landed in | Today |
|---|---|---|
| Permission model, behind `--experimental-permission` | 20.0.0 | Stable since 22.13.0, flag renamed `--permission` |
| `node:test` marked stable | 20.0.0 | Stable (coverage and `mock.module` still experimental) |
| V8 11.3: `toSorted`, `toReversed`, `toSpliced`, `with`, `isWellFormed`, regex `v` flag | 20.0.0 | Language features |
| `--env-file` | 20.6.0 | Stable (no longer experimental in 24.10.0) |
| `import.meta.dirname` and `import.meta.filename` | 20.11.0 | Stable |
| `process.loadEnvFile`, `util.parseEnv`, `util.styleText` | 20.12.0 | Stable (`styleText` since 22.13.0, `loadEnvFile` and `parseEnv` since 24.10.0) |
| `process.getBuiltinModule` | 20.16.0 | Stable |
| `require(esm)` and syntax detection without a flag | 20.19.0 | See Node 22 and 24 |

### Node 22 "Jod" (V8 12.4, Maintenance LTS, EOL 2027-04-30)

| Feature | Landed in | Today |
|---|---|---|
| `node --run <script>` | 22.0.0 | Stable |
| Global `WebSocket` client | 22.0.0 | Stable ("no longer experimental" in 22.4.0) |
| `fs.glob`, `fs.globSync`, `fsPromises.glob` | 22.0.0 | Stable since 24.0.0 |
| `process.getBuiltinModule` | 22.3.0 | Stable |
| `node:sqlite` (behind `--experimental-sqlite`) | 22.5.0 | Flag removed in 22.13.0, release candidate since 24.15.0 |
| Type stripping, `--experimental-strip-types` | 22.6.0 | On by default from 22.18.0, stable since 24.12.0 |
| `require(esm)` flag removed | 22.12.0 | No longer experimental since 24.15.0 |
| Syntax detection on by default | 22.7.0 | On |
| V8 12.4 language features: `Promise.withResolvers`, `Object.groupBy`, `Map.groupBy`, `Array.fromAsync`, Set methods, iterator helpers | Node 22 | Available (see the note in section 16) |

### Node 24 "Krypton" (V8 13.6, Maintenance LTS, EOL 2028-04-30)

| Feature | Landed in | Today |
|---|---|---|
| V8 13.6: `RegExp.escape`, `Error.isError`, `using` and `await using`, `Float16Array` | 24.0.0 | Language features |
| npm 11 | 24.0.0 | npm 11.17.0 inside Node 24.16.0 |
| `AsyncLocalStorage` built on `AsyncContextFrame` | 24.0.0 | Stable module |
| `URLPattern` global | 24.0.0 | Docs say "1 Experimental" |
| `url.parse()` prints a deprecation warning | 24.0.0 | Warning is printed |
| Test runner waits for subtests automatically | 24.0.0 | Stable |
| `import.meta.main` | 24.2.0 | Works without a flag, docs say "1.0 early development" |
| Type stripping: no experimental warning | 24.3.0 | Stable since 24.12.0 |
| `--env-file` and `process.loadEnvFile` no longer experimental | 24.10.0 | Stable |
| `require(esm)` no longer experimental, `node:sqlite` becomes a release candidate | 24.15.0 | `require(esm)` is stable, `node:sqlite` is 1.2 |

### Node 25, 26 and 27 in one paragraph each

- **Node 25** (odd, EOL 2026-06-01, V8 14.1): permission model gained `--allow-net`, Web Storage on by default, `SlowBuffer` removed, `assert.CallTracker` removed, the `fs.F_OK`-style constants removed.
- **Node 26 "Lithium"** (Active LTS, V8 14.6, first release 2026-05-05): the `Temporal` date and time API is on by default, Undici 8, `--experimental-transform-types` removed, `module.register()` deprecated at run time, `--config-file` stable.
- **Node 27** (Alpha only, V8 15.6): the first line under the one-release-a-year policy. Not for production.

Everything about Node 25 and 26 in this lesson comes from the official changelogs and docs. The examples were run on Node 24.16 only, so where a feature needs a newer Node the text says so.

## 4. Ask for the feature, not the version

When code must run on several Node versions (a library, or an app that is upgrading), do not compare version strings. Ask whether the feature exists:

```js
const features = [
  ['AbortSignal.timeout and AbortSignal.any', () => typeof AbortSignal.timeout === 'function' && typeof AbortSignal.any === 'function'],
  ['Set.prototype.union', () => typeof Set.prototype.union === 'function'],
  ['require(esm) is on', () => process.features.require_module === true],
];
```

`typeof` is safe even for a name that does not exist: `typeof Temporal` is `'undefined'`, while plain `Temporal` would throw a `ReferenceError`. The example wraps each check in `try/catch`, so one missing global never stops the report. Here is the rest of the output, with the features this lesson uses and the features that need a newer Node:

```text
2. Feature detection
  Features this lesson uses (MISSING would mean: upgrade Node):
    yes      fetch, FormData, Headers, Request, Response
    yes      AbortSignal.timeout and AbortSignal.any
    yes      structuredClone
    yes      global WebSocket client
    yes      URLPattern
    yes      navigator
    yes      node:test
    yes      node:sqlite
    yes      fs.glob
    yes      util.parseArgs, util.styleText
    yes      process.loadEnvFile
    yes      process.getBuiltinModule
    yes      require(esm) is on
    yes      type stripping for .ts files
    yes      Promise.withResolvers, Promise.try
    yes      Object.groupBy, Map.groupBy
    yes      Set.prototype.union
    yes      Array.fromAsync
    yes      toSorted, toReversed, toSpliced, with
    yes      iterator helpers (Iterator global)
    yes      RegExp.escape, Error.isError
  Features that need a newer Node (no is the expected answer here):
    no       Temporal (Node 26+)
    no       Iterator.concat (Node 26+)
    no       Uint8Array.fromBase64 (Node 25+)
    no       localStorage without a flag (Node 25+)
3. Single executable application
  sea.isSea(): false
```

The second list is the useful one in real life: it tells you when you can delete a **polyfill** (a small piece of code that fills in a feature an old runtime lacks). On Node 26 the `Temporal` line prints `yes` instead of `no`.

Three other places to say "which Node do I need":

- `"engines": { "node": ">=22.12" }` in `package.json`. By default npm only prints a warning (`EBADENGINE`) and installs anyway. With `npm install --engine-strict` it fails with the same error code. Both were run for this lesson.
- `process.getBuiltinModule('node:sqlite')` returns the module, or `undefined` when it does not exist, instead of throwing (section 8).
- A CI job (an automatic test run on every push) that runs your tests once per Node line you claim to support. This is called a **CI matrix**.

> **Interview tip:** "How do you use a new API in a library that must still run on older Node?" Feature detection with `typeof`, a fallback, the `engines` field, and a CI matrix. Do not parse `process.version`: a feature can be added to a patch release or back-ported to an older line, and the version number then lies.

## 5. `fetch` and friends are built in

`fetch`, `Headers`, `Request`, `Response` and `FormData` are globals. They are the same classes browsers have. Before Node 18 you installed `node-fetch`, `axios` or `form-data` for this. `fetch` was marked experimental in 18.0.0 and became stable in 21.0.0.

Under the hood Node uses **undici**, an HTTP client written for Node and bundled inside it (`process.versions.undici` is `7.25.0` on Node 24.16). That is why upgrading Node can change `fetch` behaviour: Node 24 bundles undici 7, Node 26 bundles undici 8.

[`examples/02-fetch-abort-clone.js`](examples/02-fetch-abort-clone.js) starts a tiny local server and calls it:

```js
const res = await fetch(`${base}/json`);
console.log('  ok:', res.ok, '| status:', res.status, '| type:', res.headers.get('content-type'));
console.log('  body:', await res.json());
```

```text
1. fetch a JSON endpoint
  ok: true | status: 200 | type: application/json
  body: { hello: 'world' }
2. A 404 does NOT make fetch reject
  ok: false | status: 404 | text: nope
3. A network failure DOES reject, with a vague message
  name and message: TypeError - fetch failed
  the real reason is in err.cause.code: ECONNREFUSED
```

Two rules that interviewers love:

1. **`fetch` only rejects when the request could not be made** (no connection, DNS failure, aborted). A `404` or `500` is a normal response with `ok: false`. You must check `res.ok` yourself.
2. A network failure always says `TypeError: fetch failed`. The real reason (`ECONNREFUSED`, `ENOTFOUND`, a timeout) is in `err.cause`.

`Headers`, `Request` and `Response` also work on their own, which is handy in tests and in code that builds responses:

```text
4. Headers, Response and Request are plain classes you can use alone
  content-type: text/plain | x-tag: a, b
  Response.json: 201 application/json { id: 7 }
  Request: POST true hi
  reading a body twice: TypeError - Body is unusable: Body has already been read
```

- Header names are case-insensitive, and `append` joins repeated values with `, `.
- A body is a stream that can be read **once**. Call `res.clone()` before reading if you need it twice.
- `Response.json(data, init)` is a quick way to build a JSON response.

### Uploading files with `FormData`

```js
const form = new FormData();
form.append('note', 'hello');
form.append('file', new Blob(['abcdef'], { type: 'text/plain' }), 'a.txt');
const uploaded = await fetch(`${base}/upload`, { method: 'POST', body: form });
```

```text
5. FormData with a file uploads as multipart/form-data
  server saw: { note: 'hello', fileName: 'a.txt', fileSize: 6 }
```

`fetch` sees a `FormData` body, picks `multipart/form-data` and writes the boundary for you. Do not set the `content-type` header yourself, or the boundary will be missing. The example server parses the upload with `new Response(body, { headers }).formData()`, a built-in multipart parser.

### Timeouts and cancelling: `AbortSignal.timeout` and `AbortSignal.any`

An **AbortSignal** is a flag you give to an operation so that you can cancel it later.

| Tool | What it does |
|---|---|
| `AbortSignal.timeout(ms)` | A signal that aborts by itself after `ms` milliseconds, with a `TimeoutError`. |
| `controller.abort()` | Aborts by hand. Without a reason, the error is an `AbortError`. |
| `AbortSignal.any([a, b])` | One signal that aborts when the first of the listed signals aborts, and takes over its reason. |

```text
6. AbortSignal.timeout and AbortSignal.any
  timeout -> TimeoutError | code 23
  abort() -> AbortError | code 20
  abort(reason) -> fetch rejects with the reason itself: user pressed cancel
```

> **Common mistake:** Using `err.name === 'AbortError'` to detect a timeout. A timeout made by `AbortSignal.timeout()` is a `TimeoutError` (code 23). Also note the last line: if you call `abort('some text')`, `fetch` rejects with that exact value, so it is a string and has no `.name`. Pass an `Error` object as the reason if your handlers read `.name`.

> **Interview tip:** "How do you add a timeout to `fetch` in Node?" Answer: `fetch(url, { signal: AbortSignal.timeout(5000) })`, no library. Mention `AbortSignal.any` to combine a timeout with a user cancel button, and say what `fetch` lacks (listed below) so you sound honest about when a library is still worth it.

### The same signal works outside `fetch`

A signal is not only for `fetch`. Many Node APIs accept a `signal` option, so one cancel button can stop a whole chain of work: `timers/promises`, `events.once()`, `fs.promises` reads, `child_process.spawn()`, `http.request()` and `stream.pipeline()` (each checked on Node 24.16). Part 7 of [`examples/02-fetch-abort-clone.js`](examples/02-fetch-abort-clone.js) tries four of them:

```js
const { setTimeout: sleep } = require('node:timers/promises');   // a sleep that returns a promise
await sleep(5000, 'done', { signal: first.signal });             // a 5 second wait, cancelled after 10 ms
stopped.throwIfAborted();                                        // throws signal.reason
```

```text
7. The same signal cancels more than fetch
  timers/promises sleep: AbortError | code ABORT_ERR
  events.once with a timeout signal: AbortError | the timeout is in err.cause: TimeoutError
  throwIfAborted() throws the reason itself: stopped on purpose
  fs.promises.readFile with an aborted signal: AbortError | cause: stopped on purpose
  a 60 second AbortSignal.timeout() is created now. It does not keep the process alive, so the example ends at once.
```

What to take from it:

- **Each API reports an abort in its own way.** `fetch` rejects with the reason itself. The other APIs reject with an `AbortError` and put your reason in `err.cause`. Do not write one `catch` that only knows one shape; check `signal.aborted` as well.
- `signal.throwIfAborted()` throws the reason. Call it at the top of each turn of your own long loop to make that loop cancellable.
- **`AbortSignal.timeout()` does not keep the process alive.** If a program only waits for an event with a timeout signal and nothing else is pending, Node exits with code 0 and no error before the timeout fires. That is why the example holds a normal 200 ms timer open while it waits.

### What `fetch` does not do for you

- No retries, interceptors or cookie jar (the reason people still use `axios`, `got` or `undici` directly).
- No progress events. To count bytes you read `res.body` as a stream yourself.
- It ignores the `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` variables unless you start Node with `--use-env-proxy` (the flag is listed in `node --help` on Node 24.16; this lesson does not exercise it). Behind a company proxy, check this first when `fetch` fails with `ENOTFOUND` or a timeout.
- For a custom connection pool, a proxy agent or retry rules you install the `undici` package and pass its `dispatcher`. Illustrative snippet, not a runnable example:

```js
// Needs: npm install undici
const { Agent } = require('undici');
const agent = new Agent({ connections: 10, keepAliveTimeout: 10_000 });
const res = await fetch('https://example.com/data', { dispatcher: agent });
```

Lesson 12 ([HTTP and networking](../12-http-and-networking/README.md)) covers `fetch`, agents and timeouts in depth.

## 6. `structuredClone`: the built-in deep copy

`structuredClone(value)` makes a deep copy using the same algorithm browsers use to send data between threads. It replaces `lodash.cloneDeep` for plain data, and it fixes the weak spots of `JSON.parse(JSON.stringify(x))`:

| Value | `JSON.parse(JSON.stringify(x))` | `structuredClone(x)` |
|---|---|---|
| `Date` | becomes a string | stays a `Date` |
| `Map`, `Set` | become `{}` | stay a `Map` and a `Set` |
| `undefined`, `NaN` | `undefined` is dropped, `NaN` becomes `null` | kept |
| `BigInt` | throws `TypeError` | kept |
| Circular reference | throws `TypeError` | works |
| Function | dropped silently | throws `DataCloneError` |
| Class instance | becomes a plain object | becomes a plain object (the prototype is lost) |

```js
const copy = structuredClone(original);
copy.nested.list.push(4);   // the original is not touched
```

```text
8. structuredClone is a built-in deep copy
  original list: [ 1, 2, 3 ] | copy list: [ 1, 2, 3, 4 ]
  Date and Map survive: true true | circular kept: true
  class instance becomes a plain object: false undefined
  functions cannot be cloned: DataCloneError | code 25
```

> **Common mistake:** "`structuredClone` clones anything." It does not. A class instance comes back as a plain object without its methods (`cloned instanceof User` is `false`), and any function inside the value makes it throw. If you need to keep class behaviour, write a `clone()` method.

## 7. More web-platform globals

[`examples/03-platform-globals.js`](examples/03-platform-globals.js) shows five more APIs that follow browser standards. [`examples/04-websocket-client.js`](examples/04-websocket-client.js) covers the WebSocket client.

### `URLPattern`

A **URLPattern** matches a URL against a pattern with named parts. It replaces hand-made regular expressions for simple routing. It became a global in Node 24.0.0, and the docs still label it experimental (it prints no warning).

```js
const pattern = new URLPattern({ pathname: '/users/:id' });
pattern.test('http://example.com/users/42');                 // true
pattern.exec('http://example.com/users/42').pathname.groups.id; // '42'
```

```text
1. URLPattern (a global since Node 24, still marked experimental in the docs)
  test /users/42: true
  test /posts/42: false
  id from exec(): 42
```

### `navigator`

`navigator` exists as a global, like in a browser. `navigator.hardwareConcurrency` is the number of logical CPUs, and `navigator.userAgent` is the text `Node.js/24` on Node 24. You can switch it off with `--no-experimental-global-navigator`.

```text
2. navigator (like in a browser)
  userAgent: Node.js/24
  hardwareConcurrency is a number: true
  language and platform are strings: string string
```

### Web Crypto

The global `crypto` is the standard **Web Crypto** object. `crypto.randomUUID()` and `crypto.getRandomValues()` are one line each, and `crypto.subtle` has hashing, signing and key generation. Browsers have the same API, so the code is portable.

```js
const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc'));
const { publicKey, privateKey } = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
```

```text
3. Web Crypto (the global crypto object)
  randomUUID length: 36
  getRandomValues: 4 random bytes
  SHA-256("abc"): ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
  Ed25519 signature bytes: 64
  verify original: true
  verify changed data: false
```

The `node:crypto` module still has more (streams, scrypt, argon2, certificates). Lesson 20 covers it.

### Web Streams

A **stream** hands you data piece by piece instead of all at once, which is how you handle big files and network bodies. Node has had its own streams since the beginning (lesson 11). The **Web Streams** classes `ReadableStream`, `WritableStream`, `TransformStream`, `CompressionStream` and `DecompressionStream` are the browser version, and they are globals now. `fetch` bodies, `Blob.stream()` and `Response` use them.

```js
const upper = new TransformStream({ transform(chunk, controller) { controller.enqueue(chunk.toUpperCase()); } });
for await (const chunk of source.pipeThrough(upper)) words.push(chunk); // a ReadableStream is async iterable
```

```text
4. Web Streams (ReadableStream, TransformStream, CompressionStream)
  piped through a transform: [ 'NODE', 'IS', 'MODERN' ]
  gzip: 3000 chars -> under 100 bytes | round trip equal: true
  Node stream -> Web stream is a ReadableStream: true | and back to a Node stream: [ 'x', 'y' ]
```

The last line shows the bridge between the two stream families: `Readable.toWeb(nodeStream)` gives a Web `ReadableStream`, and `Readable.fromWeb(webStream)` gives a Node stream back (pass `{ objectMode: true }` to keep each item as one chunk, as here). `Writable` and `Duplex` have the same two helpers. Use the Node streams for files and sockets, and the Web streams when you share code with browsers or handle `fetch` bodies.

### `BroadcastChannel`

A **BroadcastChannel** sends a message to every other channel object with the same name. Its real use in Node is talking between `worker_threads` (lesson 18); inside one thread it works too, which makes it easy to try. A channel never hears its own messages, and an open channel keeps the process alive, so close it.

```text
5. BroadcastChannel (one-to-many messages; its real use is between worker threads)
  b received: { headline: 'hello channel' }
```

### The built-in `WebSocket` client

The global `WebSocket` (Node 22.0.0) has the same API as in a browser: `open`, `message`, `error` and `close` events, `send()`, `close()` and `readyState`. Node ships a **client only**. There is no WebSocket server in Node; for a server you install a library such as `ws` (lesson 13 builds one by hand). To make the example runnable offline, it contains a 25-line server that does the handshake and echoes messages.

```js
const ws = new WebSocket(`ws://127.0.0.1:${port}`);
ws.addEventListener('message', (event) => console.log(event.data));
ws.send('ping');
```

```text
1. Connect, send, receive, close
  readyState right after new WebSocket(): 0 (0 = CONNECTING)
  open event, readyState: 1 (1 = OPEN)
  first message: welcome
  second message: echo: ping
  after close(), readyState: 2 (2 = CLOSING)
  close event, readyState: 3 (3 = CLOSED) | wasClean: true
2. A failed connection fires "error", then "close"
  events in order: error (ErrorEvent) then close (code 1006, wasClean false)
```

> **Common mistake:** Waiting for the `message` event only after `await`-ing the `open` event. A server can send its first message immediately, and the event may fire before your listener exists. Register `message` listeners right after `new WebSocket()` (the example does this with a small inbox). Also, a refused connection fires an `ErrorEvent` whose `message` is empty on Node 24.16, so it tells you nothing; the `close` event with code `1006` ("closed abnormally") follows it.

## 8. Two Node helpers: `process.getBuiltinModule` and `AsyncLocalStorage`

**`process.getBuiltinModule(id)`** (Node 20.16 and 22.3) loads a core module without `require` or `import`. It returns `undefined` if no such core module exists. That makes it a feature test and a way to write code that works in both CommonJS and ES modules:

```js
const fs = process.getBuiltinModule('node:fs');
process.getBuiltinModule('left-pad');   // undefined, not an error
```

```text
6. process.getBuiltinModule (load a core module without require or import)
  same object as require: true
  unknown name gives undefined: undefined
```

**`AsyncLocalStorage`** stores a value that follows one request through all its `await`s and callbacks, without passing it as an argument. It is how logging libraries attach a request id to every log line.

```js
const als = new AsyncLocalStorage();
als.run({ id: 1 }, async () => {
  await sleep(10);
  console.log(als.getStore().id);   // still 1, even after await
});
```

```text
7. AsyncLocalStorage (a value that follows a request through await)
  [request 2] still the same id after awaits
  [request 1] still the same id after awaits
  outside run(), getStore() is: undefined
```

Request 2 prints first because the example makes request 1 wait longer; each line still shows its own id. That is the whole point: two requests run at the same time, and neither one sees the other's value.

- Why it exists: before it, you had to pass a `requestId` argument through every function, or keep it in a global variable that two parallel requests would overwrite.
- Typical use: a middleware calls `als.run({ requestId }, next)`, and a logger calls `als.getStore()` anywhere below it.
- Gotchas: `getStore()` is `undefined` outside `run()`. The stored object is shared by reference, so treat it as read-only or keep it small. `enterWith()`, `exit()` and `disable()` are still marked experimental in the Node 24 docs; prefer `run()`.
- Since Node 24.0.0 `AsyncLocalStorage` uses a mechanism called `AsyncContextFrame` by default. Lesson 23 ([Node internals](../23-node-internals/README.md)) explains how async context is tracked.

> **Interview tip:** "How do you put a request id on every log line without passing it to every function?" Strong answer: `AsyncLocalStorage`. A middleware starts `als.run(store, next)`, and the logger reads `als.getStore()`. Add that the value follows `await`, timers and promises, and that a per-request store is not shared between parallel requests.

## 9. Tools that replaced `nodemon`, `dotenv` and `npm run`

[`examples/06-flags-in-action.js`](examples/06-flags-in-action.js) runs `node` with each flag on a tiny script in a temporary folder.

### `--env-file`: replaces `dotenv` for most apps

`node --env-file=.env app.js` reads the file and puts its values into `process.env` **before your code starts**. Added in Node 20.6, stable since 24.10.

```bash
node --env-file=.env app.js
```

```text
1. --env-file loads a .env file before your code starts (no dotenv needed)
  node --env-file=a.env show.js
    GREETING = hello from a.env | PORT = 3000
  a variable already set in the shell wins over the file:
    GREETING = hello from the shell | PORT = 3000
  two files: the later one wins:
    GREETING = hello from a.env | PORT = 4000
  a missing file is an error, unless you use --env-file-if-exists:
    node: <temp>/missing.env: not found
    <temp>/missing.env not found. Continuing without it.
    GREETING = undefined | PORT = undefined
```

Rules to remember: a variable already in the shell **wins** over the file; with several `--env-file` flags the **later file wins**; a missing file stops Node unless you use `--env-file-if-exists`; and `--env-file` is **not allowed inside `NODE_OPTIONS`**.

If you want to load the file from code, use `process.loadEnvFile(path)` (default path `./.env`; Node 20.12). It does not override variables that already exist. `util.parseEnv(text)` turns text into an object without touching `process.env`. Both are in [`examples/05-cli-helpers.js`](examples/05-cli-helpers.js):

```text
3. util.parseEnv turns .env text into an object
  EMPTY = ""
  GREETING = "hello # not a comment"
  HOST = "localhost"
  INLINE = "value"
  NAME = "single quotes"
  TOKEN = "abc123"
4. process.loadEnvFile puts the values into process.env
  MODERN_A (new): from-file
  MODERN_B (already set, NOT overridden): from-shell
  a missing file throws: ENOENT
```

Look at `INLINE`: the input was `INLINE=value # a comment`, and the unquoted `# a comment` is cut off. Inside quotes (`GREETING`) a `#` is kept. `export TOKEN=abc123` is accepted too. Lesson 15 covers environment variables in more depth.

> **Remember:** All values in `process.env` are strings, and anything you assign is turned into a string. Convert and validate once at start-up.

> **Interview tip:** "How do you load configuration without `dotenv`?" Strong answer: `node --env-file=.env app.js` (Node 20.6+, stable since 24.10), or `process.loadEnvFile()` from code. Then show you know the traps: a variable already set in the shell wins over the file, a later `--env-file` wins over an earlier one, no `${VAR}` expansion, and not allowed in `NODE_OPTIONS`. Add that real secrets in production belong in the platform's secret store, not in a committed `.env` file.

### `--run`: run a `package.json` script without npm

`node --run hello` runs the script named `hello` from the nearest `package.json`. npm itself does not have to start (Node 22.0).

```text
2. node --run runs a script from package.json (no npm needed)
  node --run hello -- --loud
    hello script ran, extra args: [ '--loud' ]
  node --run nothing
    Missing script: "nothing" for <temp>/package.json
```

Three things to know:

- The example's `package.json` also had a `prehello` script. It did **not** run: `node --run` skips `pre` and `post` scripts. So it is not a full replacement for `npm run`.
- Arguments after `--` are passed on to the script.
- The script text runs through the platform shell, so syntax differs by operating system. This was run on Windows, where `cmd` expands `%VAR%`, not `$VAR`. Linux and macOS use a POSIX shell, which was not tested here. Keep scripts that you run with `node --run` simple, or test them on every OS your team uses.

### `--watch`: restart when a file changes (replaces `nodemon`)

`node --watch app.js` runs the script, waits, and runs it again whenever a file it loaded changes (Node 18.11; stable in 22.0 and 20.13). Use `--watch-path=./src` to watch other folders. The example starts a watched script, edits it, and waits for the restart:

```text
3. --watch restarts the script when a file changes (no nodemon needed)
    saw version 1, then (after the edit) version 2
```

`--watch` only restarts the process. It does not reload the browser. The only extras that `node --help` lists on Node 24.16 are `--watch-path`, `--watch-kill-signal` and `--watch-preserve-output`; there is no config file and no ignore list like in `nodemon`.

### `util.parseArgs` and `util.styleText`: replace small `yargs` and `chalk` uses

[`examples/05-cli-helpers.js`](examples/05-cli-helpers.js) shows both. `parseArgs` reads command-line options (lesson 15 explains it in depth). `styleText` wraps text in colour codes:

```text
1. util.parseArgs (Node 18.3+, stable since 20)
  values: { port: '8080', color: false, verbose: [ true, true ] }
  positionals: [ 'input.txt' ]
  a typo throws: ERR_PARSE_ARGS_UNKNOWN_OPTION
2. util.styleText (a small chalk)
  forced codes: "\u001b[1m\u001b[32mok\u001b[39m\u001b[22m"
  default output here: plain "hello" (output is not a terminal)
  a bad format name throws: ERR_INVALID_ARG_VALUE
```

The `default output here` line depends on where you run the file. In a terminal it prints `has colour codes (you run in a terminal)`. `styleText` checks the stream and **removes the colours when the output is not a terminal** (a pipe or a file). That is good behaviour for log files, but a surprise if you expected escape codes: pass `{ validateStream: false }` to force them, as the `forced codes` line does.

The `allowNegative` option that turns `--no-color` into `color: false` was added in Node 22.4 and 20.16; on older lines `parseArgs` treats `--no-color` as an unknown option and throws.

What `styleText` accepts and respects:

- `styleText(['bold', 'green'], 'ok')` takes one format or an array. The formats are the named styles (colours, `bold`, `underline`, `bgRed` and so on).
- Hex text colours such as `'#ff8800'` work on Node 24.16, where they were added (24.16.0). On older 24.x and on Node 22 they are rejected.
- There is no `rgb(...)` form and no chaining like `chalk.red.bold`. A hex format sets the text colour only (the escape code it produces is the foreground one, `38;2;...`).
- Colour output follows the `NO_COLOR` and `FORCE_COLOR` environment variables (Node 22.8 and 20.18 and newer; before that `styleText` always added the codes).

## 10. The built-in test runner

`node:test` plus `node:assert` is enough for most unit tests, with no `jest` or `mocha` install. It was added as experimental in Node 18.0 and marked stable in Node 20.0.

A test file that imports `node:test` runs its tests when you run the file with plain `node`; a project usually runs all test files with `node --test`. [`examples/07-node-test.js`](examples/07-node-test.js) is a short tour (lesson 16 teaches testing in depth). It uses **mocks**: stand-ins such as a fake function that records its calls, or a fake clock that lets a minute pass instantly.

```js
test('mock timers make time pass instantly', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const done = t.mock.fn();
  setTimeout(done, 60_000);          // one minute, but we never wait for it
  t.mock.timers.tick(59_999);
  assert.equal(done.mock.callCount(), 0);
  t.mock.timers.tick(1);
  assert.equal(done.mock.callCount(), 1);
});
```

```text
✔ slugify makes a url-friendly string (1.8633ms)
✔ an async test just returns a promise (0.3552ms)
▶ subtests group related checks
  ✔ empty text (0.2924ms)
  ✔ only symbols (0.237ms)
  ✔ numbers are kept (0.2405ms)
✔ subtests group related checks (1.8428ms)
✔ mock.fn records every call (3.4528ms)
✔ mock timers make time pass instantly (1.9247ms)
✔ assert.partialDeepStrictEqual checks only the keys you name (2.1466ms)
﹣ a skipped test (0.5093ms) # shows how skip is reported
✔ a test we still have to write (1.1096ms) # TODO
ℹ tests 11
ℹ suites 0
ℹ pass 9
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 1
ℹ duration_ms 34.7543
```

The times in brackets change on every run. Eleven tests counted (the subtests count too), nine passed, one was skipped and one is a `todo`.

What is still experimental on Node 24.16: code coverage (`--experimental-test-coverage`), `mock.module()` (needs `--experimental-test-module-mocks`), and test randomisation. Since Node 24.0 the runner waits for subtests automatically, even if you forget `await`.

By default `node --test` finds files named `*.test.js`, `*-test.js`, `*_test.js`, `test-*.js`, `test.js`, and anything under a `test` folder (and the same for `.mjs`, `.cjs`, `.ts`). A file called `bar.spec.js` is **not** found unless you pass its pattern in quotes.

Real test files usually group tests with `describe` and `it` (both exported by `node:test`) and use **hooks** for set-up and clean-up: `before` and `after` run once around the group, `beforeEach` and `afterEach` run around every test. The order is `before`, then `beforeEach`, the test, `afterEach` for each test, then `after`. The flags you will use most:

| Flag | What it does |
|---|---|
| `node --test` | Run every test file it finds (in parallel, one process per file) |
| `--test-name-pattern=adds` | Run only tests whose name matches the pattern |
| `--test-only` | Run only tests marked `{ only: true }` |
| `--test-reporter=spec` | Pick the output format: `spec` (the default, even when piped), `tap`, `dot`, `junit` or `lcov` |
| `--watch` | Run again when a file changes |
| `--experimental-test-coverage` | Print a coverage table. Limits such as `--test-coverage-lines=80` do nothing unless coverage is switched on |
| `--test-timeout=<ms>` and `--test-concurrency=<n>` | Limit the time per test and how many files run at once |
| `--test-update-snapshots` | Create or refresh the files that `t.assert.snapshot()` compares against (the first run fails without them) |

> **Interview tip:** "Do you still need Jest?" Balanced answer: for plain unit tests, `node:test` is enough and means zero dependencies. Jest or Vitest still win when you need a browser-like DOM, module mocking that is stable today, a big matcher library, or snapshot tooling your team already knows.

## 11. Files and data: `fs.glob`, recursive `mkdir` and `rm`, `node:sqlite`

[`examples/08-replacements.js`](examples/08-replacements.js) shows four small built-ins that replace packages.

### `fs.glob` replaces the `glob` package

A **glob** is a pattern such as `**/*.js` that selects file names. `fs.glob` (callback), `fs.globSync` and `fs.promises.glob` (an **async iterator**: an object you loop over with `for await`) arrived in Node 22.0 and are stable since 24.0.

```js
fs.globSync('**/*.js', { cwd: dir, exclude: ['node_modules/**'] });
for await (const file of fs.promises.glob('src/**/*.js', { cwd: dir })) { /* ... */ }
```

```text
1. fs.glob replaces the glob package (Node 22+, stable since 24)
  **/*.js           -> [ a.js, b.test.js, node_modules/pkg/index.js, src/c.js, src/deep/d.js ]
  ... exclude       -> [ a.js, b.test.js, src/c.js, src/deep/d.js ]
  two patterns      -> [ readme.md, src/c.js ]
  braces            -> [ b.test.js, readme.md ]
  async iterator    -> [ src/c.js, src/deep/d.js ]
```

`exclude` takes a function or a list of patterns. The list form needs Node 22.14+ or 23.7+; on Node 22.0 to 22.13 `exclude` accepts a function only, so the `exclude: ['node_modules/**']` line above would not work there. On Windows the results contain backslashes, and you should not rely on the order, so the example normalises and sorts them before printing.

### `mkdir` and `rm` with `{ recursive: true }` replace `mkdirp` and `rimraf`

```text
2. mkdir and rm with { recursive: true } replace mkdirp and rimraf
  mkdir -p returns the first folder it created: x
  second time returns undefined (nothing to create): undefined
  after rm -rf, folder exists: false
  force: true ignores a path that is missing
  without force a missing path throws: ENOENT
```

`fs.rm(path, { recursive: true, force: true })` is `rm -rf`. It also has `maxRetries` and `retryDelay` options, which retry when the operation fails with errors such as `EBUSY` or `EPERM` because another process still holds a file (a common problem on Windows).

### `crypto.randomUUID()` replaces `uuid` (version 4 only)

```text
3. crypto.randomUUID replaces uuid for version 4
  looks like a v4 UUID: true
  two calls differ: true
```

It makes only version 4 (random) ids. If you need time-ordered ids (v7) or name-based ids (v5), keep a package.

### `node:sqlite`: a database with no install

`node:sqlite` is a built-in SQLite database (lesson 17 teaches SQL with it). It needs the `node:` prefix, no flag, and prints no warning on Node 24.16. It was added in 22.5, lost its flag in 22.13, and is a **release candidate** (stability 1.2) since 24.15.

```js
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)');
const insert = db.prepare('INSERT INTO users (name) VALUES (?)');
console.log(insert.run('Sam'));
```

```text
4. node:sqlite replaces better-sqlite3 for simple needs (release candidate in Node 24)
  insert -> { changes: 1, lastInsertRowid: 1 }
  select one -> { id: 2, name: 'Ada' }
  select all -> [ 'Ada', 'Sam' ]
```

The API is synchronous (`DatabaseSync`), like `better-sqlite3`. Rows come back as objects with no prototype, which is why the example spreads one (`{ ...row }`) before printing. It is still a release candidate, so check that it has every feature you need before you drop a package.

> **Interview tip:** "Can you use a database in Node without installing anything?" Yes: `node:sqlite` (no flag needed on 24.16, stability 1.2 release candidate). Show you know the cost: the API is synchronous, so a slow query blocks the event loop. It suits scripts, tests, tools and small apps. For a busy server, use a networked database or move the SQLite work to a worker thread (lesson 18).

## 12. Modules: `require(esm)`, syntax detection, `import.meta` and import attributes

Lesson 03 explains the two module systems. This section lists what changed.

### `require()` can load an ES module

For years `require()` could not load an ES module and threw `ERR_REQUIRE_ESM`. That made it hard to use packages that ship only as ES modules from a CommonJS app. Now `require(esm)` works with no flag and no warning (Node 22.12+, 20.19+, and 24; "no longer experimental" in 24.15). [`examples/09-require-esm.js`](examples/09-require-esm.js):

```js
const greeting = require('./_helpers/greeting.mjs');
greeting.add(2, 3);          // named export
greeting.default('Sam');     // default export lives on .default
```

```text
1. require() can load an ES module (Node 22.12+, 20.19+, 24; no flag, no warning)
  you get the module namespace object. Keys: __esModule, add, default, language
  named export works: 5 | language: ES module
  the default export is on .default: hello Sam
  process.features.require_module: true
2. An ES module can choose what require() returns, with the export name "module.exports"
  require() returned: plain object chosen by the module | add(2, 3) = 5
  the named export is not on it: undefined
3. The one limit: top-level await
  require() throws ERR_REQUIRE_ASYNC_MODULE
  import() of the same file works, ready = true
4. The old behaviour is still available as a switch
  with --no-experimental-require-module, require() throws ERR_REQUIRE_ESM
```

- You get the module **namespace object** (all exports as properties). Node also adds a property `__esModule: true` to it; you can ignore that one.
- A default export lives on `.default`. That is awkward for a package that used to do `module.exports = function () {}`. The fix (Node 22.12+ and 23+) is for the ES module to write `export { api as 'module.exports' }`. Then `require()` returns `api` itself, as part 2 shows. The price: the other named exports are not visible to `require()` users (`lostForRequire` is `undefined`), so attach them to `api` if they matter. `import` users still see every export.
- The limit: `require()` is synchronous (it returns at once, it cannot wait). **Top-level `await`** means using `await` directly in a module, outside any function. If the module or anything it imports uses one, `require()` cannot wait for it and throws `ERR_REQUIRE_ASYNC_MODULE`. Use `import()`, which returns a promise.

> **Interview tip:** "Can you `require` an ES module?" The old answer, "no, `ERR_REQUIRE_ESM`", is out of date. Say: yes on Node 22.12+, 20.19+ and 24, unless the module graph uses top-level `await`. This is why library authors can now ship ES-only packages without cutting off CommonJS users.

### Syntax detection

If a `.js` file has no module type in its `package.json` and it uses `import` or `export`, Node now notices the syntax and runs it as an ES module instead of failing (Node 22.7+, 20.19+).

```text
5. Syntax detection: a .js file with import and no "type" runs as an ES module
  in a folder with no package.json:
    this .js file runs as ESM; imported: ES module | require is undefined
  in a folder with a package.json that has no "type" field:
    warning code: MODULE_TYPELESS_PACKAGE_JSON (Node says: add "type" to package.json)
    this .js file runs as ESM; imported: ES module | require is undefined
  with detection switched off:
    SyntaxError: Cannot use import statement outside a module
```

Look at the middle case.

- When a `package.json` exists but has no `"type"` field, Node 24.16 prints the warning `MODULE_TYPELESS_PACKAGE_JSON`. This lesson did not check in which release the warning first appeared, so do not assume older lines print it.
- The first case is silent only because no `package.json` exists in any parent folder of your temp folder. If you have one there, you will see the warning too.
- Detection costs time: Node parses the file as CommonJS first, fails, and parses it again as ESM.
- The fix is one line: set `"type": "module"` (or `"commonjs"`) in `package.json`. Do not depend on detection in a real project. It is a convenience for scripts.

### `import.meta` and import attributes

An ES module has no `__dirname`, `__filename` or `require`. [`examples/10-import-meta.mjs`](examples/10-import-meta.mjs) shows the replacements:

```text
1. The CommonJS variables do not exist here
  typeof __dirname: undefined | typeof require: undefined
2. import.meta (Node 20.11+ for dirname and filename)
  file name: 10-import-meta.mjs
  folder name: examples
  dirname equals path.dirname(filename): true
  url starts with file:///: true
  resolve() gives a file URL string: true
3. import.meta.main tells you if this file was started directly (Node 24.2+)
  this file: true | a file that was only imported: false
```

| Replacement | Use it for |
|---|---|
| `import.meta.dirname` | the folder of this file (like `__dirname`), Node 20.11+ |
| `import.meta.filename` | the full path of this file (like `__filename`), Node 20.11+ |
| `import.meta.url` | the `file:///...` URL of this file |
| `import.meta.resolve('./x.js')` | the URL a specifier would resolve to |
| `import.meta.main` | `true` if this file was started directly, like `require.main === module` (Node 24.2+, docs say "early development") |

**Import attributes** (the `with { type: 'json' }` part) tell Node how to treat the imported file. JSON needs it:

```text
4. Import attributes: JSON needs { type: "json" }
  static import with attribute: { name: 'demo-app', port: 3000 }
  without the attribute: ERR_IMPORT_ATTRIBUTE_MISSING
  dynamic import with attribute: 3000
5. Top-level await works in ES modules
  read with await at the top: demo-app
```

```js
import config from './_helpers/config.json' with { type: 'json' };
const dynamic = await import('./_helpers/config.json', { with: { type: 'json' } });
```

> **Common mistake:** Writing `assert { type: 'json' }`, the older spelling from tutorials. On Node 24.16 it is a `SyntaxError: Unexpected identifier 'assert'`. Use `with`.

## 13. Running TypeScript with no compiler (type stripping)

TypeScript types are only hints for tools. Take them away and what is left is ordinary JavaScript. So Node 22.18+ and Node 24 run `.ts` files directly by **stripping** the types: they replace type annotations with spaces and run the JavaScript that is left. On Node 24.16 it is on by default and prints no warning (`process.features.typescript === 'strip'`). It is stable since 24.12. Lesson 21 teaches this in depth. Part 5 of [`examples/08-replacements.js`](examples/08-replacements.js) runs a small file:

```text
5. Type stripping replaces ts-node for simple TypeScript (Node 22.18+ and 24)
  typescript ran: Sam
  enum fails: SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]: TypeScript enum is not supported in strip-only mode
```

The limits you must know:

- Only **erasable** syntax works. `enum`, runtime `namespace`, constructor parameter properties (`constructor(private x)`) and JSX do not, because a compiler must write extra JavaScript for them.
- **Types are never checked.** `const n: number = 'text'` runs fine. Run `tsc --noEmit` in CI.
- Imports need the real file extension (`./bar.ts`), and type-only imports need `import type`.
- `tsconfig.json` is ignored (so path aliases do not work), and `.ts` files inside `node_modules` are refused.

`--experimental-transform-types` made enums work on Node 22 and 24, but it was **removed in Node 26.0**. On Node 26, `enum` needs a real compiler.

> **Interview tip:** "Can Node run TypeScript without `ts-node`?" Strong answer: yes, from Node 22.18 and in Node 24 it strips the type annotations by default (stable in 24.12). It only handles erasable syntax, it never checks types (so keep `tsc --noEmit` in CI), and `enum`, runtime `namespace` and parameter properties still need a compiler such as `tsc` or `tsx`.

## 14. The permission model

The **permission model** lets you start Node with limits: which folders it may read and write, and whether it may start child processes or workers. The flag is `--permission` (Node 20 called it `--experimental-permission`; the old name is now an unknown option). It is stable since 22.13. Part 4 of the same flags example:

```text
4. --permission locks the process down (needs Node 22.13+ / 24; before that the flag was --experimental-permission)
  node perm.js (no flag)
    process.permission is undefined
    read: allowed
    write: allowed
  node --permission perm.js
    process.permission is object
    read: ERR_ACCESS_DENIED | FileSystemRead
    write: ERR_ACCESS_DENIED | FileSystemWrite
  node --permission --allow-fs-read=<temp folder> perm.js
    process.permission is object
    read: allowed
    write: ERR_ACCESS_DENIED | FileSystemWrite
```

| Flag | What it allows |
|---|---|
| `--allow-fs-read=<path>` | reading under that path (`*` means everywhere) |
| `--allow-fs-write=<path>` | writing under that path |
| `--allow-child-process` | starting child processes |
| `--allow-worker` | creating worker threads |
| `--allow-addons` | loading native addons |
| `--allow-wasi` | WASI |
| `--allow-inspector` | the debugger inspector |

A denied call throws an error with `code === 'ERR_ACCESS_DENIED'`, and `err.permission` names what was missing (`FileSystemRead`, `FileSystemWrite`, `ChildProcess`, `WorkerThreads`). In code, `process.permission.has('fs.read', path)` returns a boolean; `process.permission` is `undefined` when the flag is off.

Important limits:

- The Node docs call it a "seat belt" that "does not provide security guarantees in the presence of malicious code". It helps against mistakes and bugs. It is **not** a sandbox for untrusted code.
- There is **no network permission on Node 24.16**: `fetch` still works under `--permission`. `--allow-net` arrives in Node 25.
- `--allow-child-process`, `--allow-worker`, `--allow-addons` and `--allow-inspector` print a `SecurityWarning`, because a child process or addon can step outside the model.

Lesson 20 ([security](../20-security-and-crypto/README.md)) puts this next to the other defences.

> **Interview tip:** "Is the permission model a sandbox?" Strong answer: no. The Node docs call it a seat belt. It limits what your own process may touch (files, child processes, workers, addons) and fails with `ERR_ACCESS_DENIED`, which reduces the damage from mistakes and honest bugs. It gives no guarantee against deliberately malicious code, and on Node 24 it cannot restrict the network at all. For untrusted code, use OS-level isolation such as a container or a separate user.

## 15. Single executable applications (SEA)

A **single executable application** is one program file that contains the `node` runtime plus your script, so users can run it without installing Node. It has been in Node since 18.16 and is still "1.1 active development" in the Node 24 and Node 26 docs, so treat it as a tool that can change.

This is the flow on Node 24 (you do not need to build one for this lesson):

1. **Bundle** your app into one script file, for example `hello.js`. To bundle means to combine your files and the packages they use into a single file, with a tool such as `esbuild`. The config can point to only one file.
2. Write `sea-config.json`: `{ "main": "hello.js", "output": "sea-prep.blob" }`.
3. Run `node --experimental-sea-config sea-config.json`. This makes the **blob** (your script in a packed form). Node prints `Wrote single executable preparation blob to sea-prep.blob`. This step was run while writing this lesson.
4. Copy the `node` binary (`node.exe` on Windows) to a new name, such as `hello.exe`.
5. Inject the blob into the copy with the `postject` tool. The command needs the name of a **fuse**: a marker string inside the Node binary that tells `postject` where to put the blob. The exact string depends on the Node build, so search the binary for `NODE_SEA_FUSE_`.
6. Run `hello.exe`. Inside it, `require('node:sea').isSea()` is `true`. The module also has `getAsset()` for files you embedded.

Needs: `npx postject` (an npm tool, not part of Node), so this lesson has no runnable example for steps 4 and 5. The newer `--build-sea` flag arrives in Node 25.5 and is not available on Node 24.

> **Common mistake:** These are the traps people hit. Old tutorials show an outdated fuse string that fails with "Could not find the sentinel"; the result is a full copy of Node, so it is large; the executable only runs on the operating system and CPU you built it for; and on Windows `postject` printed a warning that the signature seems corrupted when this was tried (the program still ran). Use SEA for command-line tools you hand to people without Node installed.

> **Interview tip:** "How do you ship a Node command-line tool to users who do not have Node?" Strong answer: a single executable application. It is a copy of the `node` binary (about 88 MB on this Windows machine) with your bundled script injected. It is not compiled machine code, so your script is still readable inside it. Say that it is still "active development" in the docs, that it needs one bundled file, and that you build once per operating system and CPU.

## 16. New JavaScript language features from V8

These come from the engine, not from Node, so they follow the V8 version of each line. Everything below was run on Node 24.16. The first Node line that has each feature is inferred from its V8 version (Node 22 has V8 12.4, Node 24 has V8 13.6); this lesson did not run Node 22. [`examples/11-language-features.js`](examples/11-language-features.js) uses every item:

| Feature | What it does | First LTS line (inferred) |
|---|---|---|
| `Promise.withResolvers()` | A promise plus its `resolve` and `reject` in one call | 22 |
| `Promise.try(fn)` | Runs `fn`; sync throws and async rejections both become a promise | 24 (needs V8 12.8 or newer) |
| `Object.groupBy`, `Map.groupBy` | Group items by a key function (the lodash `groupBy`) | 22 |
| `Set` methods: `union`, `intersection`, `difference`, `symmetricDifference`, `isSubsetOf`, `isSupersetOf`, `isDisjointFrom` | Real set maths | 22 |
| `Array.fromAsync()` | Collect an async iterable into an array | 22 |
| `toSorted`, `toReversed`, `toSpliced`, `with` | Array methods that return a **copy** and leave the original alone | 20 |
| Iterator helpers: `.map`, `.filter`, `.take`, `.drop`, `.flatMap`, `.toArray` | Lazy pipelines on iterators and generators | 22 |
| `RegExp.escape(text)` | Make text safe to put inside a regular expression | 24 |
| `Error.isError(value)` | A reliable "is this an error?" check | 24 |
| `using` and `await using` | Clean up a resource when a block ends | 24 |
| `Float16Array`, `Math.f16round` | 16-bit floating point numbers | 24 |

```text
1. Promise.withResolvers: a promise plus its resolve and reject, no wrapper needed
  resolved from outside
2. Promise.try: sync throws and async rejections both become a promise
  a sync throw is caught by .catch: SyntaxError
  a normal return value is wrapped: 42
3. Object.groupBy and Map.groupBy (the lodash groupBy)
  Object.groupBy: { odd: [ 1, 3, 5 ], even: [ 2, 4 ] } | prototype is null: true
  Map.groupBy keys can be any value: Map(2) { false => [ 1, 2 ], true => [ 3, 4, 5 ] }
4. Set methods
  union: Set(4) { 1, 2, 3, 4 } | intersection: Set(1) { 3 }
  difference: Set(2) { 1, 2 } | symmetricDifference: Set(3) { 1, 2, 4 }
  isSubsetOf: true | isSupersetOf: true | isDisjointFrom: true
5. Array.fromAsync collects an async iterable (or promises) into an array
  from an async generator: [ 3, 2, 1 ]
  from an array of promises: [ 'a', 'b' ]
6. Change-by-copy array methods leave the original alone
  toSorted: [ 1, 2, 3 ] | toReversed: [ 2, 1, 3 ] | with(1, 99): [ 3, 99, 2 ]
  toSpliced(1, 1, "x", "y"): [ 3, 'x', 'y', 2 ]
  original is unchanged: [ 3, 1, 2 ]
7. Iterator helpers are lazy, so they work on infinite generators
  first 3 squares of even numbers: [ 4, 16, 36 ]
  Iterator.from + drop: [ 20, 30 ]
```

Gotchas worth knowing:

- `Object.groupBy` returns an object **with no prototype** (`prototype is null: true`), so it has no `hasOwnProperty`. Use `Object.hasOwn(groups, key)` or `Map.groupBy`.
- Iterator helpers are **lazy**: they do the work for one item only when you ask for the next one, so `take(3)` on an endless generator stops after three. They work on **iterators**, not arrays. `[1, 2, 3].map(...)` is still the normal eager array method. For a lazy pipeline start with `array.values()` or a generator.
- `toSorted()` and friends copy the array. In a hot loop over a huge array that copy costs memory; `sort()` in place does not.

Part 8 and 9 of the same example cover the last three items:

```text
8. RegExp.escape (Node 24+) and Error.isError
  the escaped text matches itself literally: true
  the same text as raw regex source does not (+ and ? are operators): false
  RegExp.escape(".*") = \.\* | RegExp.escape("a.b") = \x61\.b (a leading letter or digit is hex-escaped)
  instanceof Error: false | Error.isError: true | plain object: false
9. using: automatic cleanup when a block ends (Node 24+)
  working with first and second
  disposing second
  disposing first
  await using waits for async cleanup
  async disposal finished
```

- `RegExp.escape('a.b')` gives `\x61\.b`, not `a\.b`. The standard escapes a leading letter or digit as a hex code on purpose. The result still matches the right text, so do not compare it to a hand-written string.
- `instanceof Error` is `false` for an error that comes from another **realm** (a different JavaScript world such as a `vm` context). `Error.isError` is `true` for it, and it is `false` for a plain object that only looks like an error.
- `using x = resource;` calls `x[Symbol.dispose]()` when the block ends, even after a `throw`. Several `using` lines are disposed in **reverse order** (last one first). `await using` waits for an async `Symbol.asyncDispose`. It replaces many `try/finally` blocks.

Temporal (the new date and time API) is `undefined` on Node 24 and is on by default in Node 26. `Iterator.concat` and `Map.prototype.getOrInsert` are Node 26 as well.

> **Interview tip:** "Which newer JavaScript features do you use in Node?" Pick three or four and say what each one replaces: `Object.groupBy` (lodash `groupBy`), `toSorted` (copy, then sort, so the original is not changed), `Promise.withResolvers` (a hand-made "deferred" wrapper), `using` (a `try/finally` block). Then add how you would know it is safe: the language features follow the V8 version of your Node line, so you check `engines`, feature-detect with `typeof`, and test on every line you support.

## 17. The package you used to install, and what replaces it

The honest table: what you can delete from `package.json`, and what you lose.

| Package | Built-in replacement | Honest limits |
|---|---|---|
| `node-fetch`, `axios` (simple calls), `form-data` | global `fetch`, `FormData`, `Headers`, `AbortSignal.timeout` | No retries, no interceptors, no cookie jar. `fetch` does not reject on 404 or 500. |
| `dotenv` | `node --env-file=.env`, `process.loadEnvFile()`, `util.parseEnv()` | `--env-file` is not allowed in `NODE_OPTIONS`. No `${VAR}` expansion (`B=${A}-x` stays literal). |
| `nodemon` | `node --watch` (and `--watch-path`) | Only restarts. No config file, no ignore list. |
| `chalk` (basics) | `util.styleText` | Named styles plus hex text colours (hex only from Node 24.16), no `rgb(...)`, no chaining. Drops colours when output is not a terminal. |
| `yargs`, `commander`, `minimist` (small tools) | `util.parseArgs` | Types are only `string` and `boolean`. No sub-commands, no automatic `--help`, no required-option check. |
| `uuid` (v4) | `crypto.randomUUID()` | Version 4 only. No v5 or v7. |
| `jest`, `mocha` (basic unit tests) | `node:test` and `node:assert` | Coverage and `mock.module` are still experimental. No browser-like DOM. |
| `ts-node`, `tsx` (simple TypeScript) | native type stripping | No `enum`, `namespace` or parameter properties. No type checking. `tsconfig.json` ignored. |
| `lodash.cloneDeep` | `structuredClone` | Functions throw. Class prototypes are lost. |
| `rimraf` | `fs.rm(path, { recursive: true, force: true })` | Check any extra `rimraf` option you use (patterns, filters). |
| `mkdirp` | `fs.mkdir(path, { recursive: true })` | None for normal use. |
| `glob` | `fs.glob`, `fs.globSync` | Check the options you rely on (dotfiles, symlinks). Do not rely on the order of results. |
| `ws` (client side only) | global `WebSocket` | There is no WebSocket server in Node. |
| `better-sqlite3`, `sqlite3` | `node:sqlite` | Release candidate. Check that it has the features you need. |
| `abort-controller` polyfills | `AbortController`, `AbortSignal.any`, `AbortSignal.timeout` | None. |
| `moment`, `dayjs` | `Temporal` | Only a global on Node 26 and newer (`undefined` on Node 24). |

A good rule: **replace a package when the built-in does the whole job you need, not when it does 80%.** Fewer dependencies mean a smaller attack surface and faster installs, but a half-replacement that you must patch yourself is worse than a well-maintained package.

> **Interview tip:** If asked "which dependencies would you remove from a project today?", pick two or three you can justify (for example `dotenv` for `--env-file`, `nodemon` for `--watch`, `node-fetch` for `fetch`) and say what you would check first (the minimum Node version in `engines`, and the limits above).

## 18. Deprecations and removals worth knowing

**Deprecated** means "do not use, it will go away". A deprecation has levels: a note in the docs only, a warning at run time, and finally removal. [`examples/12-deprecations.js`](examples/12-deprecations.js) tries each API in a child `node` process (so the warnings stay out of the example output) and prints which warning code Node 24.16 gives:

```text
1. What Node 24 prints at runtime (a code means a real warning; "none" means docs-only deprecation)
  new Buffer(5)                        DEP0005
  url.parse(...)                       DEP0169
  util._extend(...)                    DEP0060
  util.isArray(...)                    DEP0044
  require('punycode')                  DEP0040
  fs.F_OK                              DEP0176
  crypto.Hash(...) without new         DEP0179
  spawn(cmd, args, { shell: true })    DEP0190
  new SlowBuffer(5)                    DEP0030
  fs.exists(...)                       none
  require('node:domain')               none
  process.binding('util')              none
```

| Old way | Status on Node 24.16 | Use instead |
|---|---|---|
| `new Buffer(n)` | Warning `DEP0005` | `Buffer.alloc(n)`, `Buffer.from(...)` |
| `url.parse()`, `url.resolve()` | Warning `DEP0169` since Node 24.0 (behaviour is not standard and "prone to errors that have security implications") | `new URL(...)` |
| `util._extend()` | Warning `DEP0060` | `Object.assign()` or spread |
| `util.isArray()` and similar `util.isXxx` | Warning `DEP0044` for `isArray`. Some others (`util.isBoolean`) are already removed. | `Array.isArray()`, `typeof` |
| `require('punycode')` | Warning `DEP0040` | `url.domainToASCII()` for domain names, or a userland package |
| `fs.exists()` (callback) | Docs only, no warning | `fs.access()`, `fs.stat()`, or `fs.existsSync()` (that one is **not** deprecated) |
| `fs.F_OK`, `fs.R_OK` | Warning `DEP0176` (removed in Node 25) | `fs.constants.F_OK` |
| `domain` module | Docs only, no warning | `AsyncLocalStorage`, proper error handling |
| `process.binding()` | Docs only; shows up only with `--pending-deprecation` | Public APIs |
| `crypto.createCipher`, `createDecipher` | Already removed (they are `undefined`) | `crypto.createCipheriv`, `createDecipheriv` |
| `SlowBuffer` | Warning `DEP0030` since Node 24.0, removed in Node 25.0 | `Buffer.allocUnsafeSlow()` |
| `spawn(cmd, args, { shell: true })` | Warning `DEP0190`: arguments are only joined into a string, not escaped | Use no shell, or build the command yourself carefully |
| `--experimental-transform-types` | Works with a warning on 24 | Removed in Node 26. Use a compiler. |
| `module.register()` | No warning on 24.16 | Deprecated at run time in Node 26 |

The warning looks like this on the error stream (the process id in front changes on every run, so the example removes it):

```text
2. What a warning looks like on stderr (the process id differs on every run)
  [DEP0005] DeprecationWarning: Buffer() is deprecated due to security and usability issues. Please use the Buffer.alloc(), Buffer.allocUnsafe(), or Buffer.from() methods instead.
  (Use `node --trace-deprecation ...` to show where the warning was created)
```

Four flags help you find and handle them:

```text
3. Flags that control warnings
  default: exit 0 | stderr has a warning: true
  --no-deprecation: exit 0 | stderr has a warning: false
  --throw-deprecation: exit 1 | the warning became an uncaught error: true
  --trace-deprecation: stderr shows the call stack ("at ..."): true
  --pending-deprecation: also reports docs-only APIs: true
```

| Flag | Use it to |
|---|---|
| `--trace-deprecation` | Find **which line of code** (often inside a dependency) calls the deprecated API |
| `--throw-deprecation` | Turn warnings into errors, so CI fails on them |
| `--pending-deprecation` | See deprecations that are only in the docs today, early |
| `--no-deprecation` | Silence them (a last resort, not a fix) |

In code, `process.on('warning', (w) => ...)` receives every warning with `w.name` and `w.code`; the example uses it to print the codes.

> **Interview tip:** "How do you find which dependency uses a deprecated API?" Strong answer: run with `--trace-deprecation` so each warning prints the stack that created it (often a path inside `node_modules`). Use `--throw-deprecation` in CI so a new deprecated call fails the build, and `--pending-deprecation` to see docs-only deprecations early. Then update or replace the package that makes the call. Silencing with `--no-deprecation` is not a fix.

### The trend: promises instead of callbacks

Old callback APIs are not removed, but new code uses the promise versions: `fs/promises`, `timers/promises`, `readline/promises`, `stream/promises`, `dns/promises`, `util.promisify`, and `events.once`. Together with `async`/`await` this is the style of every modern Node codebase. When an interviewer asks "callbacks or promises?", say: promises (async/await) for application code, callbacks only where the API has no promise version or where event emitters are the natural model.

## 19. The upgrade checklist

Use this when you move a service from one Node major to the next.

1. **Pick the target.** The newest Active LTS line, unless a dependency blocks it. Check the EOL date of your current line.
2. **Read the release notes** (changelog) of every major you cross. Look for removed APIs, changed defaults and a new V8 version.
3. **Run your tests on the new version first.** Run them with `--throw-deprecation` to see every deprecated call. Run a few times with `--trace-deprecation` to find which library causes each warning.
4. **Check `engines` and the lock file.** Put the new version in `engines` and in your CI matrix (and in `.nvmrc`, `.node-version` or your Docker image tag). npm only warns on a mismatch; `--engine-strict` makes it fail.
5. **Check native addons.** A native addon is a package with compiled C or C++ code (look for `binding.gyp` or prebuilt `.node` files). It is built for one **ABI**, the binary contract between compiled code and the `node` program. Node 24.16 reports its ABI number as `137` in `process.versions.modules`. After a major upgrade you must rebuild or reinstall such packages. Prefer packages that use **Node-API**, a stable interface that does not break between majors.
6. **Update `@types/node`** to the same major as the Node you run, so the types match the runtime.
7. **Look at changed defaults.** Examples from this lesson: type stripping is on by default, `url.parse()` warns, `SlowBuffer` is gone in Node 25, and `fetch` comes from a different undici version. Run a staging environment under real traffic.
8. **Roll out gradually.** Upgrade one instance, or send a small share of traffic to the new version (a **canary**), and keep a quick way back to the old one.
9. **Remove polyfills and packages** that the new Node makes unnecessary (section 17), in a separate change so that a problem points to one cause.

> **Interview tip:** "Walk me through upgrading a production service from Node 22 to 26." Strong answer in five beats: pick the target and check the old line's end-of-life date, read the changelogs of every major crossed, run the tests with deprecation warnings as errors, check `engines`, the CI matrix and native addons, then roll out to a small share of traffic first with a way back. Mention that you upgrade dependencies that block the move before you move Node itself.

## 20. How to answer "What is new in Node?" in 60 seconds

Here is a script you can say out loud. It is about 150 words.

> "Node went from a small runtime to one with batteries included. I think of four themes.
> First, **web standards**: `fetch`, `AbortSignal`, `structuredClone`, `WebSocket`, Web Crypto and Web Streams are globals, so most HTTP code needs no library.
> Second, **tools inside the binary**: `node --watch`, `--env-file`, `--run`, `node:test`, `util.parseArgs`, `fs.glob`, `node:sqlite`, and TypeScript type stripping, which replace nodemon, dotenv, jest basics and ts-node for simple cases.
> Third, **modules**: `require(esm)` works, so CommonJS and ES modules mix, and there is `import.meta.dirname`.
> Fourth, **safety and releases**: a permission model, and deprecations like `url.parse` and `new Buffer`. For releases, even lines become LTS: today production should use Node 26, or 24 and 22 in maintenance. 20 and 18 are end of life. From Node 27 every release is LTS, one per year.
> When I upgrade I read the changelog, run tests with deprecation warnings as errors, and check engines and native addons."

> **Interview tip:** After the 60-second version, be ready for one follow-up from each theme: "does fetch reject on 404?", "what does `--env-file` do when the variable is already set?", "what stops `require(esm)` from working?", and "is the permission model a sandbox?". All four answers are in this lesson.

## Summary / Key takeaways
- Production runs an LTS line: Active LTS (Node 26 today) or Maintenance LTS (24 and 22). Node 20, 18 and every odd line are end of life. The even-is-LTS rule ends with Node 26; from Node 27 there is one major a year and every release is LTS.
- Node absorbs what used to be packages: `fetch`, `FormData`, `AbortSignal.timeout`, `structuredClone`, `WebSocket` (client), Web Crypto, `fs.glob`, `node:test`, `node:sqlite`, `util.parseArgs`, `util.styleText`.
- Command-line flags replace tools: `--watch`, `--env-file` (a shell variable wins, a later file wins), `--run` (no pre/post scripts), `--permission` (a seat belt, not a sandbox, no network control on Node 24).
- `require(esm)` works without a flag on 22.12+, 20.19+ and 24, except for graphs with top-level `await`. Syntax detection runs typeless `.js` files that use `import`, but set `"type"` in `package.json` to avoid the warning and the cost.
- Type stripping runs `.ts` files with no compiler, but only erasable syntax, with no type checking and no `tsconfig`.
- New JavaScript features arrive with V8: `Object.groupBy`, Set methods, `Array.fromAsync`, iterator helpers, `Promise.withResolvers`, `using`, `RegExp.escape`. Check by feature (`typeof`), not by version string.
- Know the traps of the web APIs: `fetch` rejects only when the request cannot be made (look at `err.cause`) and a 404 is a normal response; `AbortSignal.timeout` gives a `TimeoutError` and does not keep the process alive; `structuredClone` throws on functions and loses class prototypes.
- Deprecated and removed: `url.parse`, `new Buffer`, `util._extend`, `punycode`, `SlowBuffer` (removed in 25), `fs.F_OK`. Find callers with `--trace-deprecation`, fail CI with `--throw-deprecation`, and upgrade in steps: changelog, tests, `engines`, native addons, staged rollout.

## Quick check

1. Which Node lines are fine for production today, which are in Active LTS, and which are end of life?
<details><summary>Answer</summary>

Fine for production: Node 26 (Active LTS), and Node 24 and Node 22 (Maintenance LTS). Only Node 26 is Active LTS. Node 20 (EOL 2026-04-30), Node 18 (EOL 2025-04-30) and the odd lines such as Node 25 (EOL 2026-06-01) are end of life. Check the dates on the official schedule, because they can be amended.

</details>

2. Why would you not run a production service on Node 25, and what changes about this rule in Node 27?
<details><summary>Answer</summary>

Node 25 is an odd line. Odd lines never become LTS and reach end of life about six months after release; Node 25 has been EOL since 2026-06-01. From Node 27 on there is one major release per year, every release becomes LTS, and an Alpha channel replaces the early-testing role of the odd lines.

</details>

3. `await fetch(url)` returns a response with status 404. Does it throw? What if the server is down? Where is the real reason? How do you add a 5 second timeout?
<details><summary>Answer</summary>

No, a 404 is a normal response: `res.ok` is `false` and `res.status` is 404, so you must check it yourself. If the server is down, `fetch` rejects with `TypeError: fetch failed`, and the real reason (for example `ECONNREFUSED`) is in `err.cause.code`. For the timeout, pass `{ signal: AbortSignal.timeout(5000) }`; a timeout rejects with a `TimeoutError`, not an `AbortError`.

</details>

4. The shell has `PORT=9999` and `.env` has `PORT=3000`. What does `node --env-file=.env app.js` see? What if you pass two `--env-file` flags with different values?
<details><summary>Answer</summary>

`9999`: a variable already set in the shell wins over the file. With two `--env-file` flags, the later file wins over the earlier one. Also remember that `--env-file` cannot be put into `NODE_OPTIONS`, and a missing file stops Node unless you use `--env-file-if-exists`.

</details>

5. What can `require()` load now that it could not before, which module graph still fails, and how can an ES module control what `require()` returns?
<details><summary>Answer</summary>

It can load an ES module (an `.mjs` file, or a `.js` file in a `"type": "module"` package) on Node 22.12+, 20.19+ and 24, with no flag. You get the namespace object, with the default export on `.default`. A graph that uses top-level `await` still fails with `ERR_REQUIRE_ASYNC_MODULE`; use `import()` for it. To make `require()` return one chosen value, the module writes `export { api as 'module.exports' }` (Node 22.12+); its other named exports are then hidden from `require()` users.

</details>

6. Name two differences between `JSON.parse(JSON.stringify(x))` and `structuredClone(x)`. Name one thing `structuredClone` cannot do.
<details><summary>Answer</summary>

JSON turns a `Date` into a string, turns a `Map` or `Set` into `{}`, drops `undefined`, turns `NaN` into `null`, and throws on a `BigInt` or a circular reference. `structuredClone` keeps `Date`, `Map`, `Set`, `NaN`, `BigInt` and circular references. It cannot clone functions (it throws `DataCloneError`), and a class instance comes back as a plain object without its prototype.

</details>

7. Which TypeScript features cannot run with Node's type stripping? Does Node check your types?
<details><summary>Answer</summary>

Anything that needs a compiler to write extra JavaScript: `enum`, runtime `namespace`, constructor parameter properties, and JSX. Node never checks types: `const n: number = 'x'` runs. You also need real file extensions in imports (`./a.ts`), and `tsconfig.json` is ignored. Use `tsc --noEmit` in CI for the type check.

</details>

8. Does `node --run build` also run `prebuild` and `postbuild` scripts? Does the permission flag `--permission` stop `fetch` on Node 24?
<details><summary>Answer</summary>

No: `node --run` runs only the named script and skips the `pre` and `post` scripts that `npm run` would run. And no: there is no network permission on Node 24.16 (`--allow-net` arrives in Node 25), so `fetch` still works under `--permission`. The model also is not a sandbox against malicious code.

</details>

9. How do you check that `Promise.withResolvers` exists, and why is that better than reading `process.version`?
<details><summary>Answer</summary>

`typeof Promise.withResolvers === 'function'`. Feature detection tests the thing you need. Version numbers lie when a feature is back-ported to an older line, flagged, or missing from a custom build, and parsing them is easy to get wrong. Put the minimum version in `engines` as well, so npm can warn.

</details>

10. A `.js` file uses `import` and the nearest `package.json` has no `"type"` field. What happens on Node 24, what warning do you see, and how do you remove it?
<details><summary>Answer</summary>

Syntax detection notices the `import` syntax, re-parses the file as an ES module and runs it. Node prints the warning `MODULE_TYPELESS_PACKAGE_JSON` (when a typeless `package.json` exists) because the double parsing costs time. Remove it by setting `"type": "module"` in `package.json` (or use the `.mjs` extension).

</details>

## Try it yourself

### Task 1 (easy): which phase is a Node line in?
Write `statusOn(major, day)` that returns `'current'`, `'active LTS'`, `'maintenance LTS'`, `'end of life'` or `'not released yet'` for a Node line on a date (an ISO string such as `'2026-11-10'`). Use the dates from the table in section 2 for lines 18, 20, 22, 24 and 26. Then write `productionLines(day)` that lists the lines that are fine for production on that day.

<details><summary>Hint</summary>

For each line keep four dates: when it became Current, Active LTS, Maintenance and EOL. ISO dates sort correctly as plain strings, so you can compare them with `<` and do not need `Date` objects. Production means `'active LTS'` or `'maintenance LTS'`.

</details>

<details><summary>Solution</summary>

Save as `task1.js` and run it with `node task1.js`:

```js
// Task 1: which phase is a Node release line in on a given day?
const lines = {
  18: { current: '2022-04-19', active: '2022-10-25', maintenance: '2023-10-18', eol: '2025-04-30' },
  20: { current: '2023-04-18', active: '2023-10-24', maintenance: '2024-10-22', eol: '2026-04-30' },
  22: { current: '2024-04-24', active: '2024-10-29', maintenance: '2025-10-21', eol: '2027-04-30' },
  24: { current: '2025-05-06', active: '2025-10-28', maintenance: '2026-10-20', eol: '2028-04-30' },
  26: { current: '2026-05-05', active: '2026-10-28', maintenance: '2027-10-20', eol: '2029-04-30' },
};

function statusOn(major, day) {
  const line = lines[major];
  if (!line) return 'unknown';
  // ISO dates (YYYY-MM-DD) sort correctly as plain strings, so no Date objects are needed.
  if (day < line.current) return 'not released yet';
  if (day < line.active) return 'current';
  if (day < line.maintenance) return 'active LTS';
  if (day < line.eol) return 'maintenance LTS';
  return 'end of life';
}

// Which lines are fine for production on a given day?
function productionLines(day) {
  return Object.keys(lines).filter((major) => ['active LTS', 'maintenance LTS'].includes(statusOn(major, day)));
}

console.log('Node 22 on 2025-01-01:', statusOn(22, '2025-01-01'));
console.log('Node 22 on 2026-11-10:', statusOn(22, '2026-11-10'));
console.log('Node 20 on 2026-11-10:', statusOn(20, '2026-11-10'));
console.log('Node 26 on 2026-06-01:', statusOn(26, '2026-06-01'));
console.log('Production lines on 2026-11-10:', productionLines('2026-11-10'));
console.log('Production lines on 2024-01-01:', productionLines('2024-01-01'));
```

```text
Node 22 on 2025-01-01: active LTS
Node 22 on 2026-11-10: maintenance LTS
Node 20 on 2026-11-10: end of life
Node 26 on 2026-06-01: current
Production lines on 2026-11-10: [ '22', '24', '26' ]
Production lines on 2024-01-01: [ '18', '20' ]
```

The odd lines are left out on purpose: they are never meant for production. Remember that these dates can be amended; a real tool would read the official schedule instead of hard-coding it.

</details>

### Task 2 (medium): a safe `getJson` helper
Write `getJson(url, { timeoutMs })` using only built-ins. It must: abort after `timeoutMs` with a clear message, turn a non-2xx answer into an error that contains the status code, turn a connection failure into an error that contains the real reason (`ECONNREFUSED`, ...), and return the parsed JSON otherwise. Test it against a small local server with a good route, a missing route and a slow route.

<details><summary>Hint</summary>

Pass `signal: AbortSignal.timeout(timeoutMs)` to `fetch`. A timeout rejects with `err.name === 'TimeoutError'`; a network failure is a `TypeError` whose reason is in `err.cause.code`. After the `await`, check `res.ok` yourself. In the test server, clear the slow route's timer when the response closes so the server can shut down.

</details>

<details><summary>Solution</summary>

Save as `task2.js` and run it with `node task2.js`:

```js
// Task 2: a getJson helper built on fetch + AbortSignal.timeout
const http = require('node:http');

async function getJson(url, { timeoutMs = 1000 } = {}) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error(`timed out after ${timeoutMs} ms: ${url}`);
    // "fetch failed" hides the real reason in err.cause
    throw new Error(`network error (${err.cause?.code ?? err.message}): ${url}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`); // fetch does not reject on 404 or 500
  return res.json();
}

const server = http.createServer((req, res) => {
  if (req.url === '/ok') {
    res.setHeader('content-type', 'application/json');
    res.end('{"answer":42}');
  } else if (req.url === '/slow') {
    const timer = setTimeout(() => res.end('{}'), 500);
    res.on('close', () => clearTimeout(timer));
  } else {
    res.statusCode = 404;
    res.end('missing');
  }
});

async function main() {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const attempts = [
    ['/ok', 1000],
    ['/missing', 1000],
    ['/slow', 50],
  ];
  for (const [route, timeoutMs] of attempts) {
    try {
      console.log(route, '->', await getJson(base + route, { timeoutMs }));
    } catch (err) {
      console.log(route, '-> error:', err.message.replace(base, '<server>'));
    }
  }
  server.closeAllConnections();
  server.close();
}

main();
```

```text
/ok -> { answer: 42 }
/missing -> error: HTTP 404 for <server>/missing
/slow -> error: timed out after 50 ms: <server>/slow
```

To see the network-failure branch, call `getJson` with a port where nothing listens; the message then contains `ECONNREFUSED`.

</details>

### Task 3 (harder): a plugin loader
Write `loadPlugin(file)` and a small program that finds every `*.plugin.mjs` and `*.plugin.cjs` file in a folder with `fs.globSync`, loads each one, and prints its exported `name`. One of the `.mjs` plugins uses top-level `await`. Create the plugin files yourself in a temporary folder and delete them at the end.

<details><summary>Hint</summary>

Try `require(file)` first: it works for `.cjs` files and, on Node 22.12+ and 24, for `.mjs` files too. If it throws an error whose `code` is `ERR_REQUIRE_ASYNC_MODULE`, fall back to `import(pathToFileURL(file).href)`: `import()` needs a URL, not a Windows path. Any other error should be re-thrown.

</details>

<details><summary>Solution</summary>

Save as `task3.js` and run it with `node task3.js`:

```js
// Task 3: a plugin loader that uses fs.glob and require(esm), with an import() fallback
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function loadPlugin(file) {
  try {
    return require(file); // works for .cjs and, on Node 22.12+/24, for plain .mjs files too
  } catch (err) {
    if (err.code !== 'ERR_REQUIRE_ASYNC_MODULE') throw err;
    return import(pathToFileURL(file).href); // top-level await: only import() can wait for it
  }
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugins-'));
  try {
    fs.writeFileSync(path.join(dir, 'a.plugin.mjs'), "export const name = 'alpha';\n");
    fs.writeFileSync(path.join(dir, 'b.plugin.mjs'), "await Promise.resolve();\nexport const name = 'beta (top-level await)';\n");
    fs.writeFileSync(path.join(dir, 'c.plugin.cjs'), "exports.name = 'gamma (commonjs)';\n");
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a plugin');

    const files = fs.globSync('*.plugin.{mjs,cjs}', { cwd: dir }).sort();
    for (const name of files) {
      const plugin = await loadPlugin(path.join(dir, name));
      console.log(name.padEnd(14), '->', plugin.name);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main();
```

```text
a.plugin.mjs   -> alpha
b.plugin.mjs   -> beta (top-level await)
c.plugin.cjs   -> gamma (commonjs)
```

The `.txt` file is ignored by the pattern, `a.plugin.mjs` loads through `require()`, and `b.plugin.mjs` needs the `import()` fallback. In production you would load every plugin with `import()` and skip the `require()` attempt; the point of this task is to see where `require(esm)` stops.

</details>

## Where to go next
Continue with [23. Node.js Internals: V8, libuv and How It All Fits](../23-node-internals/README.md), which explains the engine and the event loop machinery under all of these features.

Practise this lesson with the interview rounds:
- [Round 1: screening](../../rounds/round-1-screening/questions.md) for the release policy and "what is new" questions
- [Round 2: core](../../rounds/round-2-core/questions.md) for `fetch`, modules and environment variables
- [Round 3: coding](../../rounds/round-3-coding/questions.md) for the built-in replacements
- [Round 4: advanced](../../rounds/round-4-advanced/questions.md) for `require(esm)`, the permission model and upgrade strategy
- [Round 5: system design](../../rounds/round-5-system-design/questions.md) for choosing runtime versions and an upgrade plan
- [Round 6: behavioral](../../rounds/round-6-behavioral/questions.md) for "how do you keep up with the platform?"
