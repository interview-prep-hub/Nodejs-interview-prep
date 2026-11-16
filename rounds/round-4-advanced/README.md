# Round 4: Advanced and Senior Deep Dive

Usually 60 to 90 minutes with a senior engineer or tech lead. They test depth: internals, trade-offs, production experience and how you debug. Rambling loses points. Aim for "here is the mechanism, here is what I would measure, here is the trade-off".

## What is in this folder

| File | Use |
| --- | --- |
| [questions.md](questions.md) | 27 questions: internals, performance, memory, scaling, security, production and 6 incident scenarios, plus 2 "debug it" challenges |
| [answers.md](answers.md) | Model answers; incident answers follow a fixed shape |
| [challenges/](challenges/01-fix-sequential-awaits/README.md) | Debug-it tasks with tests |

Debug-it challenges: `npm run challenge -- fix-sequential-awaits` and `npm run challenge -- fix-prototype-pollution`.

## How to answer

1. **Measure first.** "I would check CPU, memory, event loop lag and error rate before changing anything."
2. **Narrow down.** One change at a time. Say what each result would tell you.
3. **State the trade-off.** Every fix costs something.
4. **Tell a real story** when you have one: symptom, cause, fix, prevention.

## Incident answer shape

First five minutes (stabilise, check dashboards), what to measure, how to narrow down, likely causes ranked, the fix, and prevention.

## Study map

| Topic | Lesson |
| --- | --- |
| Internals | [23](../../lessons/23-node-internals/README.md), [08](../../lessons/08-event-loop/README.md) |
| Performance and memory | [19](../../lessons/19-performance-and-memory/README.md) |
| Scaling | [18](../../lessons/18-worker-threads-and-cluster/README.md) |
| Security | [20](../../lessons/20-security-and-crypto/README.md) |
| Production | [24](../../lessons/24-production-and-deployment/README.md) |

## Next

Before: [Round 3](../round-3-coding/README.md) | After: [Round 5: System design](../round-5-system-design/README.md) | [All rounds](../../README.md)
