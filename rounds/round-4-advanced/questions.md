# Round 4: Advanced and Senior Deep Dive: Questions

How to use this file: answer ALOUD in 2 to 4 minutes. Lead with the mechanism, say what you would measure, and name the trade-off. Compare with [answers.md](answers.md). For incident scenarios, answer in this order: first five minutes, what to measure, how to narrow down, likely causes, fix, prevention.

---

## Internals (Lessons 08, 23)

Lessons: [08 Event loop](../../lessons/08-event-loop/README.md), [23 Node internals](../../lessons/23-node-internals/README.md)

### R4-INT-01 [Medium] How does V8 run your JavaScript? What are the stages?

### R4-INT-02 [Hard] What are hidden classes (shapes) and inline caches, and what do they mean for how you write code?

### R4-INT-03 [Hard] [Must-know] Trace what happens when you call `fs.readFile`, from your code to the callback.

### R4-INT-04 [Hard] What is `AsyncLocalStorage`, and what is it used for?

### R4-INT-05 [Medium] Is the `vm` module a security sandbox?

---

## Performance and memory (Lesson 19)

Lesson: [19 Performance and memory](../../lessons/19-performance-and-memory/README.md)

### R4-PERF-01 [Medium] [Must-know] What is the difference between latency and throughput, and why do you look at p99 instead of the average?

### R4-PERF-02 [Hard] [Must-know] A Node.js service is slow. How do you find out why?

### R4-PERF-03 [Medium] What are common ways to make a Node.js API faster?

### R4-MEM-01 [Medium] How is memory organised in Node.js, and how does garbage collection work at a high level?

### R4-MEM-02 [Hard] [Must-know] How do you find a memory leak?

### R4-MEM-03 [Hard] `heapUsed` is small but the process uses a lot of memory (RSS). How is that possible?

---

## Scaling and security (Lessons 18, 20)

Lessons: [18 Worker threads and cluster](../../lessons/18-worker-threads-and-cluster/README.md), [20 Security and crypto](../../lessons/20-security-and-crypto/README.md)

### R4-SCALE-01 [Medium] [Must-know] Compare `worker_threads`, `cluster` and `child_process`. When do you use each?

### R4-SCALE-02 [Medium] What makes a service easy to scale horizontally? When do you need sticky sessions?

### R4-SCALE-03 [Hard] How can worker threads share memory safely?

### R4-SEC-01 [Medium] [Must-know] What are the most important security risks in a Node.js backend, and how do you defend against them?

### R4-SEC-02 [Medium] How should you store and check passwords?

### R4-SEC-03 [Medium] What are the pitfalls of JWTs?

### R4-SEC-04 [Hard] What is the Node.js permission model, and how do you reduce supply-chain risk?

---

## Production (Lesson 24)

Lesson: [24 Production and deployment](../../lessons/24-production-and-deployment/README.md)

### R4-PROD-01 [Medium] [Must-know] What does a good graceful shutdown look like?

### R4-PROD-02 [Medium] What is the difference between a liveness and a readiness check?

### R4-PROD-03 [Medium] What do you do differently when you run Node.js in Docker?

---

## Incident scenarios (Lessons 14, 19, 24)

### R4-INC-01 [Hard] CPU is pinned at 100 percent on one core, and latency for every endpoint has grown. What do you do?

### R4-INC-02 [Hard] Memory climbs steadily for hours until the container is killed (OOM). What do you do?

### R4-INC-03 [Hard] Average latency is fine, but p99 spikes every few minutes. What do you check?

### R4-INC-04 [Hard] After a deploy, clients behind a load balancer see bursts of `ECONNRESET`. What is going on?

### R4-INC-05 [Hard] The logs show `EMFILE: too many open files` under load. What do you do?

### R4-INC-06 [Hard] Requests hang until they time out. CPU is low and the event loop is not lagging. What do you check?

---

## Coding challenges (hands-on)

### R4-CODE-01 [Easy] Debug it: the slow importer

An import takes 400 ms in tests and over 40 minutes in production because `await` sits in a `for` loop. Fix it with bounded parallelism.
Skills: sequential vs parallel awaits, bounded concurrency. Time box: 20 minutes.
Folder: [challenges/01-fix-sequential-awaits](challenges/01-fix-sequential-awaits/README.md). Run: `npm run challenge -- fix-sequential-awaits`

### R4-CODE-02 [Medium] Debug it: the polluted merge

A crafted JSON body turned every user into an admin. Fix `deepMerge` so it cannot pollute `Object.prototype`.
Skills: prototype pollution, safe merging. Time box: 30 minutes.
Folder: [challenges/02-fix-prototype-pollution](challenges/02-fix-prototype-pollution/README.md). Run: `npm run challenge -- fix-prototype-pollution`
