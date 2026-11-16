# What is not finished yet

The course is usable now: 26 lessons with 330+ verified examples, six interview rounds with questions and model answers, 8 coding challenges with tests, 3 cheatsheets, a mock-interview guide, a README and a study plan. The work was stopped early to save effort, so these items are the honest gaps. Pick them up in this order.

## 1. Bigger question banks (highest value)

The rounds currently have about 140 questions plus 8 challenge cards. The original target was about 450.

| Round | Now | Target | Missing topics |
| --- | --- | --- | --- |
| 1 | 38 | 100 | more JS puzzles, modules and npm, core modules, error basics |
| 2 | 30 | 150 | events (more), buffers, streams (more), http, realtime, process, testing, db, module internals, npm deep |
| 4 | 27 | 100 | more internals, streams, networking, crypto, TypeScript, modern Node, frameworks |
| 5 | 5 designs + 12 | 15 designs + 60 | web crawler, leaderboard, webhooks, API gateway, notifications, checkout saga, collaborative editing, search autocomplete, multi-tenant API, log pipeline |
| 6 | 26 | 100 | more behavioral, HR and negotiation items, worksheets |

Question IDs follow `R<round>-<TOPIC>-<NN>` and every question in `questions.md` needs a matching heading in `answers.md`. `npm run check:qa` verifies this.

## 2. More coding challenges

Done: promisify, event-emitter, debounce, lru-cache, promise-pool, retry-backoff, fix-sequential-awaits, fix-prototype-pollution. Ideas not yet built:

- Round 1: sum CLI arguments, read a JSON config with defaults, word frequency counter, `sleep` and `withTimeout`, a tiny JSON HTTP service.
- Round 2: implement `Promise.all`/`allSettled`/`race`/`any`, transform streams with `pipeline`, async line reader, tiny HTTP router, JSON body reader with limits, recursive directory scanner, binary packet parser.
- Round 3: throttle, memoize with TTL, token bucket, Koa-style compose, deepClone, deepEqual, flatten/unflatten, async queue, pub/sub with wildcards, mini schema validator, Todo REST API, CSV parser, dependency-aware task runner, URL shortener core, async mutex, single-flight.
- Round 4 (debug it): listener leak, blocked loop, backpressure, race condition, unhandled rejections, offload to a worker thread, graceful shutdown, path traversal, N+1 queries, stream error handling.

Each challenge needs: README, starter that throws `TODO`, `*.test.js` (uses `rounds/_shared/load.js`), and `solution/`. Copy an existing challenge folder as a template. `npm run check:challenges` verifies solution passes and starter fails. Prefer injectable clocks and mock timers so tests are fast and not flaky.

## 3. Mock interviews and worksheets

Only one mock-interview guide exists. Add full written mock scripts per round with scoring sheets, and more Round 6 worksheets (resume checklist, final-week checklist).

## 4. Review and polish

- Lesson READMEs are long (about 900 to 3000 lines each) and some are well above the 400 to 800 line target. Consider splitting the biggest (02, 14, 17, 25) or adding a table of contents at the top of each.
- Platform notes: examples were verified on Windows 11 with Node 24.16 only. Re-run `npm run check:examples` on Linux and macOS and note differences (timing-sensitive examples in lessons 08, 15, 18, 19 are the most likely to differ).
- A few facts are marked in the lessons as "from documentation, not executed": third-party library snippets (Express, Fastify, Jest and others), nvm-windows details, POSIX-only behaviour.
- Answers in rounds 1, 2 and 4 were checked by running code only for the predict-the-output puzzles. A second reviewer pass for factual accuracy against the lessons would be valuable.
- Node versions move on: lesson 01 and Round 1 state which versions are LTS as of November 2026. Update them over time.

## 5. Housekeeping

- This folder is not a git repository. Run `git init`, create a branch, and commit before you start editing.
- `npm run check` runs the text, example, challenge and question checks. Run it after any change.
