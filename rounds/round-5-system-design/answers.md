# Round 5: System Design and Architecture: Answers

These are model outlines, not the only right answers. State assumptions out loud, and give the trade-off for each choice.

---

## Design prompts

### R5-DESIGN-01 [Medium] Design a URL shortener

**If you only have 5 minutes:** Generate a unique short code per URL, store `code -> long URL` in a key-value store, put a cache in front, answer reads with a 301/302 redirect. Reads dominate, so optimise reads.

**Requirements:** Create short link, redirect, optional custom alias and expiry. Out of scope: analytics dashboards. Non-functional: redirect under 50 ms at p99, high availability.

**Estimate:** 100M links/month is about 40 writes/s. Reads 100 times more: about 4,000/s average, 40,000/s peak. Storage: 100M x about 500 bytes = 50 GB a month, about 3 TB in 5 years. A 7-character base62 code gives 62^7, about 3.5 trillion combinations, enough.

**API:** `POST /links {url, alias?, ttl?} -> {code, shortUrl}`; `GET /:code -> 302 Location`.

**Data model:** `links(code PK, long_url, created_at, expires_at, owner)`. A key-value or wide-column store (or a sharded SQL table by `code`), because access is always by key.

**Design:**

```text
client -> CDN/LB -> [Node API x N] -> cache (Redis) -> DB (sharded by code)
                         |
                  ID generator (counter ranges per instance)
```

**Code generation:** a global counter encoded in base62 (each instance leases a range of ids, so no per-write coordination), or a random 7-char code with a uniqueness check. Counters are predictable, so add a secret permutation if enumeration matters.

**Node.js decisions:** stateless instances, async DB driver, connection pool; redirects are tiny, so one process handles thousands per second. Do not do analytics writes in the request path: push a click event to a queue.

**Failure modes:** cache miss storm (use single-flight), DB down (serve from cache, return 503 on miss), duplicate alias (409), retries are safe because create is idempotent for the same URL plus owner.

**Security and abuse:** validate URLs (scheme allow list), block malware domains, rate limit creation.

**Scaling:** cache hot codes (the top 20 percent of links give most of the traffic), shard the DB by code hash, add a CDN for redirects, read replicas.

**Trade-offs:** 301 is cached by browsers (less load, but you lose click counts and cannot change the target); 302 is not cached.

### R5-DESIGN-02 [Hard] Design a distributed rate limiter service

**If you only have 5 minutes:** Use a token bucket per key, stored in Redis and updated atomically with a Lua script. Each API instance asks Redis (or uses a local approximation) before handling a request.

**Requirements:** Limit per API key per minute with bursts, return 429 with `Retry-After`. Overhead under 2 ms. Decide fail-open vs fail-closed if the limiter is down (usually fail-open for non-critical APIs).

**Estimate:** 100,000 requests/s total means 100,000 limiter checks/s. One Redis node handles about that, so shard keys across a Redis cluster.

**API:** a middleware `limit(key, cost) -> {allowed, remaining, retryAfterMs}`.

**Data model:** key `rl:{apiKey}` holding `tokens` and `last_refill`, with a TTL.

**Design:**

```text
client -> LB -> [Node instance] -- Lua script --> Redis cluster (sharded by key)
                    |
              local counter (optional, syncs in batches)
```

**Algorithms:** token bucket (bursts allowed, O(1) state), sliding window counter (smoother), fixed window (simple, spikes at window edges).

**Node.js decisions:** the check is a network round trip, so keep a timeout of a few ms and use a pooled Redis connection; the Lua script keeps the read-modify-write atomic, which JavaScript alone cannot guarantee across processes.

**Failure modes:** Redis slow or down (fail open with a local per-instance limit), clock differences (use Redis time), hot key (one huge customer: shard by key plus slot).

**Scaling:** local token leasing: each instance takes a batch of tokens and refills in bulk, trading accuracy for fewer calls.

**Trade-offs:** strict global accuracy costs latency; approximate limits are much cheaper.

### R5-DESIGN-03 [Hard] Design a real-time chat with presence

**If you only have 5 minutes:** WebSocket gateways hold the connections, a message service stores messages, and pub/sub fans messages out between gateways. Presence is a key with a TTL refreshed by heartbeats.

**Requirements:** send/receive in real time, groups, history, online status. At-least-once delivery with client-side dedupe by message id.

**Estimate:** 1M connections. A WebSocket in Node uses roughly tens of KB, so about 20 GB in total, around 50,000 connections per instance means 20 gateway instances. If each user sends one message per 10 seconds, that is 100,000 messages/s.

**API:** WebSocket events `send {chatId, text, clientMsgId}`, `message`, `ack`, `typing`; REST `GET /chats/:id/messages?before=`.

**Data model:** messages in a store partitioned by `chat_id` and ordered by time (Cassandra-style or sharded SQL); presence in Redis with TTL; chat membership in SQL.

**Design:**

```text
client <-ws-> [Gateway (Node) x N] <-> pub/sub (Redis/NATS/Kafka) <-> [Chat service] -> message store
                    |                                                       |
              presence (Redis)                                      push notifications (offline users)
```

**Node.js decisions:** gateways keep only connection state and are the only sticky part; heartbeats (ping/pong) detect dead connections; apply backpressure (check `bufferedAmount`, drop or close slow clients); raise file descriptor limits; keep the work per message tiny so the loop never blocks.

**Failure modes:** gateway crash (clients reconnect with exponential backoff and jitter, and fetch missed messages by last id), duplicate sends (dedupe on `clientMsgId`), ordering (per-chat sequence numbers).

**Scaling:** shard chats across pub/sub channels; for huge groups use fan-out on read.

**Trade-offs:** at-least-once plus dedupe is simpler than exactly-once; presence is approximate by design.

### R5-DESIGN-04 [Medium] Design a background job queue and scheduler

**If you only have 5 minutes:** Producers put jobs in a durable queue. Workers pull jobs, process them, and acknowledge. Failures retry with backoff, and jobs that keep failing go to a dead-letter queue. Run jobs at-least-once and make handlers idempotent.

**Requirements:** reliability, delayed jobs, retries, priorities, visibility into failures.

**Estimate:** 1,000 jobs/s, average 200 ms each means about 200 busy worker slots at once; with 10 concurrent jobs per Node process that is about 20 processes.

**API:** `enqueue(type, payload, {delay, priority, idempotencyKey})`.

**Data model:** a queue (Redis streams or lists, SQS, RabbitMQ) plus a jobs table for status and history.

**Design:**

```text
[API] -> queue -> [Worker (Node) x N] -> side effects
            |            |
     delayed set      retry w/ backoff -> DLQ
```

**Node.js decisions:** workers are separate processes from the API; CPU-heavy jobs run in worker threads or separate pools; limit concurrency per worker; handle `SIGTERM` by finishing current jobs.

**Failure modes:** a worker dies mid-job (visibility timeout returns the job to the queue), poison messages (cap attempts, then DLQ), duplicates (idempotency key), thundering herd after outage (jitter).

**Scaling:** add workers; separate queues per job type so a slow type does not block others; autoscale on queue depth.

**Trade-offs:** at-least-once with idempotent handlers beats trying for exactly-once.

### R5-DESIGN-05 [Medium] Design an image upload and processing pipeline

**If you only have 5 minutes:** The client uploads directly to object storage with a pre-signed URL. An event creates a job. Workers make thumbnails and store them. A CDN serves the results.

**Requirements:** upload up to 10 MB, thumbnails, fast delivery, safe handling of bad files.

**Estimate:** 1M uploads/day is about 12 per second on average, maybe 100 per second at the peak. At 5 MB each, that is about 5 TB a day of originals. Output sizes add maybe 20 percent.

**API:** `POST /uploads -> {uploadUrl, id}`; client PUTs the file; `GET /images/:id` returns status or the URL.

**Data model:** `images(id, owner, status, original_key, variants...)` in SQL; blobs in object storage.

**Design:**

```text
client -> API (signed URL) ; client -> object storage -> event -> queue -> [Workers] -> object storage -> CDN
```

**Node.js decisions:** keep file bytes out of your Node servers (no buffering of 10 MB bodies). If you must proxy, stream with backpressure. Image resizing is CPU work: do it in worker processes or a service using native libraries, not on the API event loop.

**Failure modes:** corrupt or malicious files (validate type and size, process in a sandboxed worker), duplicate events (idempotent processing keyed by image id), partial failures (status field, retries, DLQ).

**Scaling:** workers scale on queue depth; CDN caches variants; lifecycle rules for old originals.

**Trade-offs:** async processing gives a short "processing" window but protects the API; synchronous resizing is simpler but ties up request capacity.

---

## Concept questions

### R5-CONCEPT-01 [Easy] [Must-know] How do you scale a Node.js service?

**Answer:** Vertically by using all cores (run one process per core with `cluster`, PM2, or one container per core). Horizontally by running many identical stateless instances behind a load balancer. Move CPU work to workers, cache hot data, and find the real bottleneck (often the database) before adding servers. Trade-off: more instances need shared state outside the process.

### R5-CONCEPT-02 [Easy] [Must-know] Stateless vs stateful services: why does it matter?

**Answer:** A stateless instance keeps nothing between requests, so any instance can serve any request, and instances can be added, removed or restarted freely. State moves to a database, cache or object store. Stateful pieces (WebSocket connections, in-memory sessions) need sticky routing or reconnect logic, and make deploys harder.

### R5-CONCEPT-03 [Medium] [Must-know] What caching layers exist, and what makes invalidation hard?

**Answer:** Browser, CDN, API gateway, application cache (in-process or Redis), database cache. Patterns: cache-aside (read, miss, load, store), write-through, TTL. Invalidation is hard because the cache and the source can disagree and many keys depend on one change. Use short TTLs, versioned keys, and explicit deletes on write. Watch for stampedes on expiry (single-flight, jitter).

### R5-CONCEPT-04 [Medium] Queue vs stream vs pub/sub: what is the difference?

**Answer:** A queue gives each message to ONE consumer, which acknowledges it (work distribution). Pub/sub delivers each message to ALL subscribers (broadcast), usually without history. A stream (Kafka, Redis streams) is an ordered, retained log that many consumer groups can read at their own pace and replay. Pick a queue for jobs, pub/sub for notifications, a stream for event history and replay.

### R5-CONCEPT-05 [Medium] [Must-know] SQL or NoSQL: how do you choose?

**Answer:** Choose SQL when data is relational, you need transactions and flexible queries. Choose a document or key-value store when access is by key or document, the schema varies, or you need to scale writes horizontally and can model for your queries. Many systems use both. Do not choose NoSQL only because it sounds scalable: a single SQL database handles far more than most products need.

### R5-CONCEPT-06 [Medium] What are replication and sharding, and what do they cost?

**Answer:** Replication copies data to other nodes for availability and read scaling, but replicas lag, so reads can be stale. Sharding splits data across nodes by a key to scale writes and storage, but cross-shard queries and transactions become hard, and a bad shard key creates hot spots. Do replication first, shard only when one primary cannot keep up.

### R5-CONCEPT-07 [Hard] Explain CAP and eventual consistency in practical words.

**Answer:** When a network partition happens, a distributed system must choose: stay consistent (refuse some requests) or stay available (answer, maybe with stale data). Without a partition you can have both. Eventual consistency means replicas converge after a short delay if writes stop. Use strong consistency for money and inventory counts, eventual consistency for feeds and counters.

### R5-CONCEPT-08 [Medium] [Must-know] What is idempotency, and how do you implement it for an API?

**Answer:** An operation is idempotent if repeating it has the same effect as doing it once. This makes retries safe. For POST, the client sends an `Idempotency-Key` header. The server stores the key with the result (unique constraint); a repeat returns the stored result instead of doing the work again. Keys expire after a day or so.

### R5-CONCEPT-09 [Medium] Offset or cursor pagination?

**Answer:** Offset (`?page=3`) is simple but slows down on large offsets (the DB still skips rows) and shows duplicates or gaps when data changes. Cursor (keyset) pagination uses "after this id/time" (`WHERE id > ? ORDER BY id LIMIT n`), stays fast and stable, but cannot jump to page N. Use cursors for feeds and large tables.

### R5-CONCEPT-10 [Medium] Name the main rate-limiting algorithms and when to use each.

**Answer:** Fixed window (count per minute: simple, allows a double burst at the edge), sliding window (smoother, more state), token bucket (steady rate plus bursts, most common), leaky bucket (smooths output to a constant rate). For distributed systems, keep counters in Redis with atomic scripts.

### R5-CONCEPT-11 [Medium] What are timeouts, retries and circuit breakers for?

**Answer:** Timeouts stop a slow dependency from tying up your resources forever (every outbound call needs one). Retries with exponential backoff and jitter handle brief failures, only for idempotent operations. A circuit breaker stops calling a dependency that is failing (open), lets one test call through later (half-open), and recovers when it works, so you fail fast and give it room to recover.

### R5-CONCEPT-12 [Medium] Monolith or microservices?

**Answer:** Start with a well-structured modular monolith: simple to deploy, test and debug. Move to services when teams or scaling needs differ enough to justify the cost: network calls, distributed tracing, data consistency (sagas), and operational overhead. Split along clear business boundaries, never into tiny "nano services".
