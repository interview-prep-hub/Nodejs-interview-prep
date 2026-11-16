# Round 3: Live Coding

Usually 60 to 90 minutes, as a machine-coding or pair-programming round. You write working code while talking. Interviewers judge problem solving, correctness, edge cases, tests and how clearly you communicate.

## What is in this folder

| File | Use |
| --- | --- |
| [questions.md](questions.md) | Challenge cards with difficulty, skills and time box |
| [answers.md](answers.md) | Approach, complexity, edge cases and follow-ups for each challenge |
| `challenges/NN-name/` | README, starter file, automated tests and a reference solution |

## The challenges

| # | Challenge | Difficulty | Time | Run |
| --- | --- | --- | --- | --- |
| 1 | [debounce](challenges/01-debounce/README.md) | Medium | 25 min | `npm run challenge -- debounce` |
| 2 | [LRU cache](challenges/02-lru-cache/README.md) | Medium | 30 min | `npm run challenge -- lru-cache` |
| 3 | [Promise pool](challenges/03-promise-pool/README.md) | Medium | 30 min | `npm run challenge -- promise-pool` |
| 4 | [Retry with backoff](challenges/04-retry-backoff/README.md) | Medium | 30 min | `npm run challenge -- retry-backoff` |

More challenges for this and the other rounds: [Round 1](../round-1-screening/challenges/01-promisify/README.md), [Round 2](../round-2-core/challenges/01-event-emitter/README.md), [Round 4 (debug it)](../round-4-advanced/README.md).

## The method (use it every time)

1. **Clarify** (2 min): inputs, outputs, errors, sizes. Ask before you code.
2. **Examples** (2 min): write 2 or 3 inputs with expected outputs, including one edge case.
3. **Approach** (3 min): say your plan and its complexity BEFORE typing.
4. **Code** (15 min): simple version first, small functions, good names.
5. **Test** (5 min): walk the examples through your code. Run the tests.
6. **Improve** (rest): edge cases, complexity, clean-up, what you would do with more time.

## How to practise with this folder

```bash
npm run challenge -- debounce              # run your code against the tests
npm run challenge -- debounce --solution   # run the reference solution (to see what passing looks like)
```

PowerShell and bash both work with these commands. Start the timer when you open the README. Write your code in the starter file next to the tests. Stuck for 5 minutes? Open one hint, not the solution. Use `node --test --watch` in the challenge folder for fast feedback.

## Self-scoring

| Area | 0 | 1 | 2 |
| --- | --- | --- | --- |
| Finished in the time box | no | with hints | yes |
| All tests pass first run | no | after fixes | yes |
| Explained approach and complexity first | no | partly | yes |
| Edge cases found without hints | none | some | most |

## Common mistakes

- Typing before understanding the problem.
- Ignoring edge cases (empty input, bad types, errors, repeated calls).
- Using `Date.now()` and real timers in code that should be testable. Inject the clock or sleep function.
- Staying silent. Think out loud.

## Next

Before: [Round 2](../round-2-core/README.md) | After: [Round 4: Advanced](../round-4-advanced/README.md) | [All rounds](../../README.md)
