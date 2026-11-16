# STAR story template and story bank

Copy this file and fill it in. Write real, true stories. Practise each aloud until it takes about 2 minutes.

## Blank template

```text
Title (3 words):
Situation (1-2 sentences):
Task (what I was responsible for):
Action (what I did, step by step, use "I"):
  1.
  2.
  3.
Result (with a number if possible):
Learning (what I would do differently):
Questions this story can answer:
```

## Worked example: a Node.js incident

```text
Title: Memory leak at night
Situation: Our order API (Node.js, 4 containers) was restarted by the orchestrator every few hours because of out-of-memory kills.
Task: I was on call and owned finding the cause.
Action:
  1. Checked memory metrics: heap grew steadily, not just RSS, so it was a JavaScript leak.
  2. Took two heap snapshots 20 minutes apart and compared them.
  3. Found a Map of request contexts that was never cleared on error paths.
  4. Fixed it with try/finally, added a size limit, and wrote a test that sends 2000 failing requests.
Result: No more OOM restarts. Memory stayed flat. I added a memory alert so we see growth earlier.
Learning: Add cleanup in finally blocks by default, and watch memory trends, not only restarts.
Questions this story can answer: a hard bug, a production incident, ownership, learning from a mistake.
```

## Story bank

Fill one row per story, then tick which common questions it can answer.

| # | Story title | Conflict | Mistake | Deadline | Leadership | Technical challenge | Disagreement |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ... | - [ ] | - [ ] | - [ ] | - [ ] | - [ ] | - [ ] |
| 2 | ... | - [ ] | - [ ] | - [ ] | - [ ] | - [ ] | - [ ] |
| 3 | ... | - [ ] | - [ ] | - [ ] | - [ ] | - [ ] | - [ ] |
| 4 | ... | - [ ] | - [ ] | - [ ] | - [ ] | - [ ] | - [ ] |
| 5 | ... | - [ ] | - [ ] | - [ ] | - [ ] | - [ ] | - [ ] |

## Project deep-dive template

```text
Project and purpose:
My role and team size:
Scale (requests per second, data size, users):
Architecture in 5 lines:
Biggest technical decision and the trade-off:
A mistake or surprise:
What I would change:
Numbers I can quote (latency, uptime, cost):
```

## Final week checklist

- [ ] 8 stories written and practised aloud
- [ ] "Tell me about yourself" under 90 seconds
- [ ] "Why this company" with two specific reasons
- [ ] 5 questions to ask the interviewers
- [ ] Salary range researched
- [ ] Tech setup and internet checked for video calls
- [ ] Sleep and a short walk the day before
