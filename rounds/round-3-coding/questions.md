# Round 3: Live Coding: Challenges

How to use this file: pick a card, start a timer, and solve the challenge in its folder. Do not open the hints or [answers.md](answers.md) until you are stuck or finished. Method and scoring: [README.md](README.md).

---

## Coding challenges (hands-on)

### R3-CODE-01 [Medium] debounce

Return a function that waits for a quiet period before calling the original. Supports `leading`, `trailing`, `cancel` and `flush`. Tests use mock timers.
Skills: closures, timers, `this` and arguments. Time box: 25 minutes.
Folder: [challenges/01-debounce](challenges/01-debounce/README.md). Run: `npm run challenge -- debounce`

### R3-CODE-02 [Medium] LRU cache

A fixed-size cache that evicts the least recently used entry, with O(1) operations.
Skills: data structures, `Map` ordering. Time box: 30 minutes.
Folder: [challenges/02-lru-cache](challenges/02-lru-cache/README.md). Run: `npm run challenge -- lru-cache`

### R3-CODE-03 [Medium] Concurrency-limited promise pool

Run an array of async tasks with at most N at a time, keep result order, and handle errors in two modes.
Skills: async control flow, concurrency. Time box: 30 minutes.
Folder: [challenges/03-promise-pool](challenges/03-promise-pool/README.md). Run: `npm run challenge -- promise-pool`

### R3-CODE-04 [Medium] Retry with exponential backoff

Retry a failing async function with growing delays, jitter, a stop condition and cancellation. Time and randomness are injectable.
Skills: async loops, backoff, dependency injection. Time box: 30 minutes.
Folder: [challenges/04-retry-backoff](challenges/04-retry-backoff/README.md). Run: `npm run challenge -- retry-backoff`
