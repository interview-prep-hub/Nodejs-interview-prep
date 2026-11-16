# Round 2: Core Node.js Technical

Usually about 60 minutes. The main technical interview: how Node.js REALLY works. You are expected to explain mechanisms, not just definitions, and to predict what code prints.

## What is tested

- Event loop, microtasks, timers, and why order matters.
- Async patterns, error propagation, cancellation.
- Events, buffers, streams and backpressure.
- HTTP without a framework, processes, modules, errors, tests.

## What is in this folder

| File | Use |
| --- | --- |
| [questions.md](questions.md) | 30 questions (8 predict-the-output puzzles) and 1 coding challenge |
| [answers.md](answers.md) | Model answers with verified outputs |
| [challenges/](challenges/01-event-emitter/README.md) | `npm run challenge -- event-emitter` |

## How to practise alone

1. Read the lessons: [07](../../lessons/07-async-javascript/README.md) to [16](../../lessons/16-testing/README.md), especially [08 Event loop](../../lessons/08-event-loop/README.md).
2. For each question use the 4-step shape: **definition, mechanism, example, gotcha**.
3. For puzzles, say the output AND the reason before running the code.
4. Record yourself. If you ramble for more than 2 minutes, tighten the answer.
5. Redo missed questions after 1 day, 3 days and 7 days.

## Mid-level vs senior signals

- Mid-level: correct definitions and simple examples.
- Senior: explains the mechanism, names the edge case, says what they would measure, and knows the numbers (thread pool of 4, 10 listeners, default timeouts).

## Next

Before: [Round 1](../round-1-screening/README.md) | After: [Round 3: Live coding](../round-3-coding/README.md) | [All rounds](../../README.md)
