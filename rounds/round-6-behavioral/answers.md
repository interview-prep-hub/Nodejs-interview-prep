# Round 6: Behavioral, Hiring Manager and HR: Answers

For every question you get: what the interviewer is testing, a structure, a sample shape (invented, to learn the shape from, never to copy), and mistakes to avoid. Replace the samples with your own true stories.

---

## Behavioral

### R6-BEH-01 [Easy] [Must-know] Tell me about yourself.

**Testing:** Clear communication and relevance.
**Structure:** Present (what you do now), past (two relevant steps), future (why this role). Under 90 seconds.
**Sample shape:** "I am a backend developer with four years of Node.js. Right now I build the order API for an online shop: about 200 requests a second, PostgreSQL and Redis. Before that I worked on a small startup's real-time features, which is where I learned WebSockets and debugging memory leaks. I am looking for a team where I can work on larger-scale systems, which is why this role caught my eye."
**Avoid:** your life story, reading your CV aloud, nothing about why this role.

### R6-BEH-02 [Medium] [Must-know] Tell me about a conflict with a teammate. What happened?

**Testing:** Maturity, empathy, resolution.
**Structure:** STAR, with the focus on how you listened and found a shared goal.
**Sample shape:** "A teammate and I disagreed on whether to add a cache. I asked for a 15-minute call, listened to their concern (stale data), and we agreed to measure first. The numbers showed the database query was the problem, so we added an index instead. We both learned to bring data first."
**Avoid:** blaming, a story where you simply "won".

### R6-BEH-03 [Medium] Tell me about a time you disagreed with your lead or a technical decision.

**Testing:** You can disagree respectfully and commit.
**Structure:** Your concern with evidence, how you raised it privately, the outcome, and that you supported the final decision.
**Avoid:** going around your lead; saying "I was right".

### R6-BEH-04 [Medium] [Must-know] Tell me about a mistake you made, especially in production.

**Testing:** Ownership, learning, calm under pressure.
**Structure:** What happened, how you noticed, immediate fix, root cause, what you changed so it cannot happen again.
**Sample shape:** "I shipped a migration that locked a large table for a minute during peak hours. I rolled back within five minutes, wrote the incident note, and then added a rule to run big migrations off-peak with a lock timeout and a staging rehearsal."
**Avoid:** a fake weakness ("I work too hard"), blaming tools or people.

### R6-BEH-05 [Easy] What is your biggest accomplishment?

**Testing:** Impact and pride in work.
**Structure:** Result first with a number, then how. Pick something with business impact.
**Sample shape:** "I cut our report endpoint from 12 seconds to 600 ms by streaming rows and adding an index, which stopped support tickets about timeouts."

### R6-BEH-06 [Medium] Tell me about a tight deadline. What did you do?

**Testing:** Prioritising and communication.
**Structure:** Clarify the must-have, cut scope, tell stakeholders early, deliver the core, plan the rest.
**Avoid:** heroics and burnout as the main lesson.

### R6-BEH-07 [Medium] How do you handle unclear or changing requirements?

**Testing:** Comfort with ambiguity.
**Structure:** Ask clarifying questions, write assumptions down, build the smallest useful slice, get quick feedback, keep the design flexible.

### R6-BEH-08 [Medium] Tell me about a time you mentored or helped someone.

**Testing:** Teamwork and leadership.
**Structure:** What they struggled with, how you helped (pairing, review comments that teach, docs), their progress.

### R6-BEH-09 [Medium] How do you react to critical feedback? Give an example.

**Testing:** Coachability.
**Structure:** Listen, ask for specifics, act, follow up. Name real feedback and what you changed.

### R6-BEH-10 [Medium] Tell me about a time you said no, or pushed back.

**Testing:** Judgement and respect.
**Structure:** The request, the risk you saw, the alternative you offered, the outcome. Say no to the plan, not to the person.

### R6-BEH-11 [Easy] [Must-know] Why are you leaving your current job?

**Testing:** Motivation and attitude.
**Structure:** Positive and forward-looking: what you want more of (scale, ownership, learning). Be honest and brief.
**Avoid:** badmouthing the employer or manager.

### R6-BEH-12 [Easy] [Must-know] Why do you want to work here?

**Testing:** Real interest.
**Structure:** Two specific things about the product, the engineering culture or the tech, and how your skills match. Do your research the day before.
**Avoid:** "because you are a big company" or only salary.

---

## Experience and situational

### R6-EXP-01 [Medium] [Must-know] Walk me through the architecture of a Node.js project you worked on.

**Testing:** Depth, ownership, can you explain a system.
**Structure:** Purpose and scale (numbers), a simple diagram in words (clients, API, database, queue, cache), one interesting decision with the trade-off, one thing you would change. Use the [project deep-dive questions](worksheets/star-story-template.md).
**Avoid:** listing technologies with no reasons.

### R6-EXP-02 [Medium] Tell me about a performance problem you found and fixed.

**Structure:** Symptom and metric, how you measured (profile, event loop delay, slow query log), the cause, the fix, the new metric. Show you measured before changing things.

### R6-EXP-03 [Medium] How do you structure a Node.js project, and handle errors, logging and configuration?

**Good content:** layers (routes, services, data access), config from environment variables validated at start, central error handling with typed errors, structured JSON logs with request ids, graceful shutdown, tests. See [Lesson 25](../../lessons/25-architecture-and-patterns/README.md) and [Lesson 24](../../lessons/24-production-and-deployment/README.md).

### R6-EXP-04 [Medium] Tell me about a migration you did or would plan (callbacks to async/await, JavaScript to TypeScript, monolith split).

**Good content:** migrate in small steps behind tests, keep the system working, measure risk, communicate, rollback plan, avoid a big-bang rewrite.

### R6-SIT-01 [Medium] A deploy breaks production on a Friday afternoon. What do you do?

**Good content:** Roll back first, investigate second. Tell stakeholders. Check metrics. Write a short incident note. Afterwards: a blameless review and a prevention step (canary deploys, feature flags, no risky Friday deploys without a plan).

### R6-SIT-02 [Medium] A teammate pushes untested code and you find a bug in review. What do you do?

**Good content:** Be kind and specific. Show the failing case, suggest a test, offer to pair. If it is a pattern, discuss it privately or raise the team's testing standards.

### R6-SIT-03 [Medium] The product manager asks for a date you think is impossible. What do you do?

**Good content:** Do not just say no. Explain the work in pieces, give an estimate with uncertainty, offer options (smaller scope, more time, more people), and agree on what is most important.

---

## Questions for you to ask

### R6-ASK-01 [Easy] [Must-know] What questions should you ask about the team and the work?

**Ask:** "What does a typical project look like here?" "How is the team organised?" "What is the hardest technical problem the team has right now?"
**Good reply:** concrete and honest. **Worrying reply:** vague, or "we do everything".

### R6-ASK-02 [Easy] What questions should you ask about engineering practices?

**Ask:** "How do you review code?" "How is testing done?" "How often do you deploy, and how?" "Which Node.js version do you run, and how do you upgrade?"
**Good reply:** reviews, CI, regular deploys, an LTS version. **Worrying reply:** no tests, deploys by hand on a server, an end-of-life Node version.

### R6-ASK-03 [Easy] What questions should you ask about on-call and production?

**Ask:** "Is there an on-call rotation? How often, and how many incidents?" "How do you handle post-incident reviews?" "What do you use for monitoring?"
**Good reply:** shared rotation, runbooks, blameless reviews. **Worrying reply:** one hero, constant fires.

### R6-ASK-04 [Easy] What questions should you ask the hiring manager about growth and success?

**Ask:** "What would success look like in the first 90 days?" "How do people grow here?" "What do you like most and least about working here?"

---

## Offer and HR

### R6-NEG-01 [Medium] [Must-know] "What are your salary expectations?"

**Guidance:** Research the market range for the role and location. Ask for their range first if you can. If pressed, give a range with your target near the top, based on research, and say you are open to the full package.
**Example phrasing:** "Based on my research for this role and level, I am looking at X to Y. I am flexible depending on the whole package. What range did you have in mind?"
**Avoid:** giving your current salary where it is not required, or a single low number.

### R6-NEG-02 [Medium] You have another offer, or a deadline. How do you talk about it?

**Guidance:** Be honest and polite. Tell each company your timeline early and ask for time if needed. Never invent offers.
**Example phrasing:** "I am excited about this role. I have another process with a decision date of Friday. Could you tell me when I might hear back?"

### R6-NEG-03 [Medium] How do you negotiate, and how do you compare offers?

**Guidance:** Thank them, ask for the offer in writing, then negotiate calmly with reasons, not ultimatums. Look beyond salary: bonus, equity (and its vesting and risk), leave, remote work, learning budget, growth, team quality, on-call. Ask for time to decide. It is fine to say no politely.
**Example phrasing:** "Thank you for the offer. I would like to join. Based on my skills and the market, I was hoping for X. Is there flexibility?"
