# Round 5: System Design and Architecture: Questions

How to use this file: for each design, set a 45-minute timer and design on paper using the framework in [README.md](README.md). Say the answer aloud. Then compare with [answers.md](answers.md). Concept questions: answer in 1 to 2 minutes.

---

## Design prompts

### R5-DESIGN-01 [Medium] Design a URL shortener

Users paste a long URL and get a short one. Visiting the short URL redirects to the long one. Assume 100 million new links a month, reads 100 times more than writes, links last for years.

Clarifying questions you should ask: custom aliases? expiry? analytics? who can create links? abuse handling?

### R5-DESIGN-02 [Hard] Design a distributed rate limiter service

An API with many Node.js instances behind a load balancer must limit each API key to N requests per minute, with low latency overhead.

Clarifying questions you should ask: per key, per IP, or per route? hard or soft limit? what happens if the limiter is down? burst allowed?

### R5-DESIGN-03 [Hard] Design a real-time chat with presence

One-to-one and group chat, online/offline status, message history. Assume 1 million concurrent connections.

Clarifying questions you should ask: group size limits? delivery guarantees? read receipts? history length? mobile push?

### R5-DESIGN-04 [Medium] Design a background job queue and scheduler

Services enqueue jobs (send emails, resize images, generate reports). Jobs must run reliably, may be delayed or scheduled, and failures must retry.

Clarifying questions you should ask: job duration? ordering needs? priorities? exactly-once or at-least-once? volume?

### R5-DESIGN-05 [Medium] Design an image upload and processing pipeline

Users upload photos (up to 10 MB). The system makes thumbnails and optimised versions, and serves them fast worldwide. Assume 1 million uploads a day.

Clarifying questions you should ask: video too? sync or async result? moderation? privacy of files? retention?

---

## Concept questions (Lessons 12, 13, 17, 18, 19, 24, 25, 26)

### R5-CONCEPT-01 [Easy] [Must-know] How do you scale a Node.js service?

### R5-CONCEPT-02 [Easy] [Must-know] Stateless vs stateful services: why does it matter?

### R5-CONCEPT-03 [Medium] [Must-know] What caching layers exist, and what makes invalidation hard?

### R5-CONCEPT-04 [Medium] Queue vs stream vs pub/sub: what is the difference?

### R5-CONCEPT-05 [Medium] [Must-know] SQL or NoSQL: how do you choose?

### R5-CONCEPT-06 [Medium] What are replication and sharding, and what do they cost?

### R5-CONCEPT-07 [Hard] Explain CAP and eventual consistency in practical words.

### R5-CONCEPT-08 [Medium] [Must-know] What is idempotency, and how do you implement it for an API?

### R5-CONCEPT-09 [Medium] Offset or cursor pagination?

### R5-CONCEPT-10 [Medium] Name the main rate-limiting algorithms and when to use each.

### R5-CONCEPT-11 [Medium] What are timeouts, retries and circuit breakers for?

### R5-CONCEPT-12 [Medium] Monolith or microservices?
