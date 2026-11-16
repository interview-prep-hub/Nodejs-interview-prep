# Node.js Interview Prep

A self-study course for the Node.js part of a software interview. It goes from "I know a little JavaScript" to senior backend topics, in simple language with small, runnable examples. For each interview round it has questions to practise on your own, model answers, and coding challenges with automated tests.

- Runtime: **Node.js 24** (tested on v24.16.0). Needs Node 24 or newer. Examples use only built-in modules, no `npm install`.
- Works on Windows, macOS and Linux. Commands below work in PowerShell and bash.
- Plan your time: see [STUDY-PLAN.md](STUDY-PLAN.md) (1 week, 2 weeks, 4 weeks).
- What is not finished yet: see [REMAINING.md](REMAINING.md).

## How to use this repo

1. **Learn**: read the lessons in order (or follow a [learning path](#learning-paths)). Run every example. Each lesson ends with "Quick check" questions and "Try it yourself" tasks.
2. **Practise**: do the [interview rounds](#interview-rounds). Answer each question aloud first, then read the model answer.
3. **Code**: solve the challenges with the tests. Start the timer, write your solution, run the tests.
4. **Rehearse**: run a [mock interview](rounds/mock-interviews/README.md) and use the [cheatsheets](cheatsheets/event-loop-and-async.md) the day before.

## Lessons

### Tier 1: Foundations (beginner)

| # | Lesson | You learn |
| --- | --- | --- |
| 01 | [Introduction](lessons/01-introduction/README.md) | What Node.js is, install, REPL, how it runs code |
| 02 | [JavaScript essentials](lessons/02-javascript-essentials/README.md) | The JavaScript you need: scope, closures, `this`, classes, arrays |
| 03 | [Modules](lessons/03-modules/README.md) | CommonJS, ES modules, `require` internals |
| 04 | [npm and package.json](lessons/04-npm-and-package-json/README.md) | Dependencies, semver, lockfiles, scripts |
| 05 | [Core modules tour](lessons/05-core-modules-tour/README.md) | `path`, `os`, `util`, `url`, `readline`, `process` |
| 06 | [File system](lessons/06-file-system/README.md) | Reading, writing, directories, watching |

### Tier 2: Core Node.js (intermediate)

| # | Lesson | You learn |
| --- | --- | --- |
| 07 | [Async JavaScript](lessons/07-async-javascript/README.md) | Callbacks, promises, async/await, cancellation |
| 08 | [Event loop](lessons/08-event-loop/README.md) | Phases, microtasks, timers, blocking |
| 09 | [Events](lessons/09-events/README.md) | `EventEmitter` in depth |
| 10 | [Buffers](lessons/10-buffers/README.md) | Binary data, encodings |
| 11 | [Streams](lessons/11-streams/README.md) | Readable, writable, transform, backpressure |
| 12 | [HTTP and networking](lessons/12-http-and-networking/README.md) | Servers, clients, TCP, TLS, DNS |
| 13 | [Real-time](lessons/13-realtime-websockets-sse/README.md) | WebSockets and Server-Sent Events |
| 14 | [Error handling and debugging](lessons/14-error-handling-and-debugging/README.md) | Error design, debugger, stack traces |

### Tier 3: Building real systems (intermediate to advanced)

| # | Lesson | You learn |
| --- | --- | --- |
| 15 | [Processes and CLI](lessons/15-processes-and-cli/README.md) | `child_process`, signals, building CLIs |
| 16 | [Testing](lessons/16-testing/README.md) | `node:test`, mocks, coverage |
| 17 | [Databases and data access](lessons/17-databases-and-data-access/README.md) | SQL, pools, transactions, caching |
| 18 | [Worker threads and cluster](lessons/18-worker-threads-and-cluster/README.md) | Parallelism and scaling a process |
| 19 | [Performance and memory](lessons/19-performance-and-memory/README.md) | Profiling, leaks, GC, benchmarking |
| 20 | [Security and crypto](lessons/20-security-and-crypto/README.md) | Common attacks, hashing, JWT, permissions |
| 21 | [TypeScript with Node](lessons/21-typescript-with-node/README.md) | Type stripping, tsconfig, types |
| 22 | [Modern Node features](lessons/22-modern-node-features/README.md) | What changed in Node 18 to 24 |

### Tier 4: Expert and production

| # | Lesson | You learn |
| --- | --- | --- |
| 23 | [Node internals](lessons/23-node-internals/README.md) | V8, libuv, how `require` and `fs` work inside |
| 24 | [Production and deployment](lessons/24-production-and-deployment/README.md) | Config, logs, health checks, Docker, shutdown |
| 25 | [Architecture and patterns](lessons/25-architecture-and-patterns/README.md) | Layers, DI, queues, caching, resilience |
| 26 | [Frameworks and middleware](lessons/26-frameworks-and-middleware/README.md) | Express, Fastify, Koa, middleware design |

## Interview rounds

| Round | Typical length | Folder | Content |
| --- | --- | --- | --- |
| 1. Screening | 30 to 45 min | [round-1-screening](rounds/round-1-screening/README.md) | 38 questions, 1 challenge |
| 2. Core Node.js | 60 min | [round-2-core](rounds/round-2-core/README.md) | 30 questions, 1 challenge |
| 3. Live coding | 60 to 90 min | [round-3-coding](rounds/round-3-coding/README.md) | 4 challenges and a method |
| 4. Advanced and senior | 60 to 90 min | [round-4-advanced](rounds/round-4-advanced/README.md) | 27 questions (incl. 6 incidents), 2 debug-it challenges |
| 5. System design | 45 to 60 min | [round-5-system-design](rounds/round-5-system-design/README.md) | 5 designs, 12 concept questions, framework |
| 6. Behavioral and HR | 30 to 60 min | [round-6-behavioral](rounds/round-6-behavioral/README.md) | 26 questions, STAR worksheet |

Extras: [mock interviews](rounds/mock-interviews/README.md), [cheatsheets](cheatsheets/event-loop-and-async.md) ([core APIs](cheatsheets/core-apis.md), [quick answers](cheatsheets/interview-quick-answers.md)).

## Commands

Run from the repo root.

```bash
node lessons/08-event-loop/examples/02-nexttick-vs-promise.js   # run a lesson example
npm run challenge -- promisify                      # run the tests for a challenge
npm run challenge -- promisify --solution           # run the tests against the reference solution
npm run check                                       # all checks: text, examples, challenges, questions
npm run check:examples                              # run every lesson example
```

Challenge names are the folder names without the number prefix, for example `debounce`, `lru-cache`, `promise-pool`, `retry-backoff`, `event-emitter`, `fix-sequential-awaits`.

## Learning paths

- **I am new to Node.js**: lessons 01 to 08, then Round 1, then 09 to 14, then Round 2.
- **I know Node.js, interview in a week**: skim 08, 11, 12, 14; do Rounds 1, 2 and 3; read the cheatsheets. See the 7-day plan in [STUDY-PLAN.md](STUDY-PLAN.md).
- **Senior role**: lessons 17 to 26, then Rounds 4 and 5, then Round 6 stories.
- **Only coding rounds**: Round 3 challenges, then Round 4 debug-it challenges.

## Skills checklist

Tick these when you can explain them in two minutes without notes.

- [ ] How Node runs JavaScript: V8, libuv, event loop phases, microtasks
- [ ] CommonJS vs ESM, `require` caching, npm and semver
- [ ] Promises, async/await, errors, cancellation, concurrency limits
- [ ] EventEmitter, Buffers, streams and backpressure
- [ ] HTTP servers, status codes, keep-alive, timeouts, WebSockets vs SSE
- [ ] Error design, uncaught exceptions, graceful shutdown
- [ ] Child processes, worker threads, cluster and when to use each
- [ ] Testing with `node:test`
- [ ] Databases: pools, transactions, N+1, caching
- [ ] Profiling CPU and memory, finding leaks
- [ ] Security: injection, prototype pollution, ReDoS, SSRF, passwords, JWT
- [ ] Production: config, logs, health checks, Docker, observability
- [ ] Design: stateless services, queues, caching, rate limiting, trade-offs
- [ ] Stories for behavioral questions (STAR)

## Folder map

```text
lessons/NN-name/README.md      the lesson
lessons/NN-name/examples/      runnable code
rounds/round-N-name/           README, questions.md, answers.md, challenges/
rounds/mock-interviews/        timed mock interviews
cheatsheets/                   one-page references
scripts/                       checkers and the challenge runner
```
