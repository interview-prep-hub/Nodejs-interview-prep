# Round 5: System Design and Architecture

Usually 45 to 60 minutes, at a whiteboard or in a shared diagram. There is no single right answer. The interviewer wants a clear method, sensible numbers, honest trade-offs, and Node.js awareness.

## What is in this folder

| File | Use |
| --- | --- |
| [questions.md](questions.md) | 5 design prompts and 12 short concept questions |
| [answers.md](answers.md) | Model outlines for each design and tight answers for each concept |

Lessons to read first: [12](../../lessons/12-http-and-networking/README.md), [13](../../lessons/13-realtime-websockets-sse/README.md), [17](../../lessons/17-databases-and-data-access/README.md), [18](../../lessons/18-worker-threads-and-cluster/README.md), [19](../../lessons/19-performance-and-memory/README.md), [24](../../lessons/24-production-and-deployment/README.md), [25](../../lessons/25-architecture-and-patterns/README.md).

## The 45-minute framework

| Minutes | Step | What you do |
| --- | --- | --- |
| 0-5 | Requirements | Ask what the system must do (functional) and how well (scale, latency, availability, consistency). State what is out of scope. |
| 5-10 | Estimates | Users, requests per second, storage, bandwidth. Round numbers, show arithmetic. |
| 10-15 | API | Main endpoints or events, request and response shapes. |
| 15-20 | Data model | Tables or keys, which store and why. |
| 20-35 | High-level design, then deep dive | Boxes and arrows, then the two hardest parts. |
| 35-43 | Failure modes and bottlenecks | What breaks, retries, idempotency, backpressure, hot keys. |
| 43-45 | Wrap-up | Trade-offs, what you would do next at 10x. |

## Numbers worth remembering

| Item | Rough value |
| --- | --- |
| Seconds in a day / month | about 86,400 / 2.6 million |
| Memory read | about 100 ns |
| SSD random read | about 100 microseconds |
| Round trip in one data centre | about 0.5 ms |
| Round trip across continents | about 100 to 150 ms |
| One server doing simple HTTP in Node | thousands to tens of thousands of requests per second |
| Requests per second from daily users | daily requests / 86,400, then multiply by 3 to 10 for the peak |

Example: 10 million requests a day is about 115 per second on average, and maybe 500 to 1000 at the peak.

## Node.js specific points to mention

- One thread per process: scale with several processes or containers. Keep services stateless.
- Never block the event loop: use worker threads or a separate service for CPU-heavy work.
- Streams and backpressure for large files. Do not buffer big payloads.
- Connection limits: file descriptors, pool sizes, keep-alive.
- Graceful shutdown, health checks, timeouts on every outbound call.

## Blank worksheet (copy for each practice)

```text
Problem:
Functional requirements:
Non-functional (scale, latency, availability, consistency):
Out of scope:
Estimates (users, RPS peak, storage, bandwidth):
API:
Data model and store:
Diagram:
Deep dive 1:
Deep dive 2:
Failure modes:
Trade-offs / alternatives:
What changes at 10x:
```

## Common mistakes

- Drawing boxes before asking questions.
- Naming technologies without saying why.
- Ignoring failure and retries.
- No numbers at all, or numbers that are never used in a decision.

## Next

Before: [Round 4](../round-4-advanced/README.md) | After: [Round 6: Behavioral](../round-6-behavioral/README.md) | [All rounds](../../README.md)
