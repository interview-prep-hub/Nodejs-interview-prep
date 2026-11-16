# 24. Production, Deployment and Observability

> Level: Advanced   Time: about 240 minutes   Node: 24 (notes where older versions differ)

[Previous: 23. Node.js Internals: V8, libuv and How It All Fits](../23-node-internals/README.md) | [All lessons](../../README.md) | [Next: 25. Architecture, Design Patterns and Resilience](../25-architecture-and-patterns/README.md)

## What you will learn
- How to configure a service the twelve-factor way: environment variables, a validator that fails fast at startup, per-environment settings, and how to handle secrets
- What `NODE_ENV` really changes (very little in Node itself) and the traps around it
- Structured JSON logging: levels, redaction of secrets, correlation ids with `AsyncLocalStorage`, and what log aggregation does with your lines
- Health checks (liveness, readiness, startup) and a complete graceful shutdown: signals, draining, hard timeout, exit codes, and the `process.exit()` pitfall
- Running Node for real: systemd, PM2, Docker (a production-grade multi-stage Dockerfile), Kubernetes concepts, and a reverse proxy such as nginx with TLS, `trust proxy` and timeouts that fit together
- Shipping: CI/CD stages, rolling, blue/green and canary deployments, zero-downtime restarts, rollback
- Observability: logs, metrics (RED and USE, Prometheus), distributed tracing with OpenTelemetry, error tracking, alerting and SLOs
- Capacity and cost thinking, serverless Node (Lambda handler shape, cold starts), and a first-five-minutes incident checklist for high CPU, memory growth, event loop lag, too many open files and pool exhaustion

All the runnable examples are in `examples/`. Run them from the repo root, for example `node lessons/24-production-and-deployment/examples/02-json-logger.js`. They use only core modules, listen on port 0 on `127.0.0.1` (the operating system picks a free port), close everything and finish by themselves in a few seconds. Two files start with `_` (`_logger.js`, `_lambda-handler.js`): they are helpers that other examples load, not programs to run.

The folder `examples/_snippets/` holds real configuration files (a Dockerfile, an nginx config, a systemd unit, a PM2 file, a CI workflow, Kubernetes manifests, an OpenTelemetry bootstrap). They are **not executed** by the course tools, because they need Docker, Kubernetes, nginx or a cloud account. The JavaScript snippets pass `node --check` and the nginx file passes `nginx -t` (syntax only); the Docker, Kubernetes and CI files were reviewed by reading. Copy them and adapt them to your project. Third-party tools (pino, winston, PM2, prom-client, OpenTelemetry, Sentry) appear only as clearly labelled snippets.

The outputs below were captured on Windows 11 with Node 24.16.0. Everything in this lesson that touches the real operating system (signals, the PID 1 problem, file descriptor limits) is a Linux topic in production. Where Windows behaves differently, the text says so.

### How the lesson is organised

This is a long lesson because production has many parts. Each section stands on its own, so you can read it in several sittings.

| Part | Sections | Question it answers |
|---|---|---|
| A. Configure | 2 to 5 | How does the app learn its settings and keep its secrets? |
| B. Log | 6 to 9 | How do I see what happened, across many requests and many machines? |
| C. Stay healthy, stop cleanly | 10 to 12 | How does the platform know I am OK, and how do I stop without hurting users? |
| D. Run it | 13 to 16 | What keeps the process alive, in a container, in a cluster, behind a proxy? |
| E. Ship it | 17 and 18 | How does a commit reach production safely, and how do I undo it? |
| F. Observe it | 19 to 22 | How do I measure it, follow a request, and get told when users suffer? |
| G. Plan and survive | 23 to 26 | How many servers, what about serverless, and what do I do when it breaks? |
| H. Wrap-up | 27 to 29 | The whole picture, a checklist, and the interview questions |

Short on time? Read sections 3, 5, 10, 11, 14, 20 and 29 first. They hold most of what interviewers ask.

## 1. What changes when code goes to production

On your laptop you are the only user. You watch the terminal. If it crashes, you start it again. In production none of that is true:

| On your laptop | In production |
|---|---|
| One user: you | Many users at once, some of them hostile |
| You watch the terminal | Nobody watches. You learn about problems from users or alarms |
| You restart it by hand | A machine must restart it at 3 a.m., and start new copies when load grows |
| Settings are in your head or in a file | Settings are injected from outside, and secrets must stay secret |
| `console.log` is enough | You need logs you can search, numbers you can graph, and traces you can follow |
| "It works" | "It works under load, during a deploy, when the database is slow, and after a crash" |

Production work is a loop, not a one-time step:

```text
 configure -> package -> deploy -> run -> observe -> (something breaks) -> fix -> configure ...
```

Some words you will see all the time, defined once:

- **Environment**: one complete copy of the system. Typical names: local, test, staging (a copy of production for final checks), production.
- **Deploy**: putting a new version into an environment. **Release**: making it available to users (these can be separate steps).
- **Rollback**: going back to the previous version after a bad deploy.
- **Instance** (or **replica**): one running copy of your app. Production usually runs several.
- **Load balancer**: a server (or cloud service) that spreads incoming requests over several instances and skips the ones that are not healthy.
- **Orchestrator**: software such as Kubernetes that starts, stops, restarts and scales your containers across machines.
- **Latency**: how long one request takes, from the moment it is sent to the moment the answer arrives.
- **stdout and stderr**: the two output streams of a process. `console.log` writes to stdout, `console.error` writes to stderr.
- **Observability**: how well you can understand what the system is doing from the outside, using logs, metrics and traces.
- **Incident**: something is wrong in production and users are affected.

> **Interview tip:** "I built an API" is a junior answer. Senior questions start after that: "How do you configure it? How do you deploy without downtime? How do you know it is healthy? What do you do at 3 a.m. when it is not?" This lesson is the answer to those questions.

## 2. Configuration: the twelve-factor way

**Configuration** (config) is everything that is different between deploys of the same code: the database address, API keys, the port, the log level, feature switches. It is not the same as constants in your code (such as your route names), which never change between environments.

The **twelve-factor app** is a well-known list of rules for services that run in the cloud. Factor III says: **store config in the environment.** An **environment variable** is a named text value that the operating system hands to a process when it starts. In Node you read it with `process.env.NAME`.

Why not put config in the code or in committed config files?

- Secrets in git live forever in the history. Deleting them later does not remove them.
- If config is inside the code, every change needs a new build. The goal is **build once, deploy many**: the same image runs in staging and production, and only the environment variables differ.
- Environment variables work the same for every language, every operating system, Docker and Kubernetes.

The twelve factors in one line each, because interviewers like this list: (1) one codebase, many deploys; (2) declare dependencies explicitly; (3) config in the environment; (4) treat databases and queues as attached resources you reach by URL; (5) separate build, release and run; (6) run as stateless processes; (7) export services by binding to a port; (8) scale out with more processes; (9) disposability: fast start, graceful stop; (10) keep dev and prod similar; (11) logs are an event stream written to stdout; (12) run admin tasks as one-off processes. This lesson covers (3), (9) and (11) in depth.

### Environment variables are always text

```js
process.env.DEMO_FLAG = false;                    // assigning a boolean stores the TEXT "false"
console.log(typeof process.env.DEMO_FLAG);       // 'string'
console.log(Boolean(process.env.DEMO_FLAG));     // true: any non-empty text is truthy
```

```text
1. Environment variables are always text
   typeof process.env.DEMO_FLAG : string
   value                        : "false"
   Boolean("false")             : true (any non-empty text is truthy)
```

The classic bug is `if (process.env.DEBUG)` when `DEBUG=false` is set: the text `"false"` is truthy, so debug mode turns on. Always convert: `process.env.DEBUG === 'true'`, `Number(process.env.PORT)`. Assigning `process.env.X = undefined` stores the text `"undefined"`, which is another trap.

### Loading a `.env` file for local development

On your machine it is handy to keep variables in a file named `.env`. Node can load it itself, with no extra package (the `--env-file` flag was added in Node 20.6 and is no longer experimental since Node 24.10):

```bash
node --env-file=.env server.js
```

```text
# .env  (never commit this file; put it in .gitignore)
PORT=3000
DATABASE_URL=postgres://dev:dev@localhost:5432/app_dev
```

Facts to remember (checked on Node 24.16): a variable that is already set in the shell **wins** over the file; with two `--env-file` flags the later file wins; a missing file is an error (use `--env-file-if-exists` to continue without it); and `--env-file` is not allowed inside `NODE_OPTIONS`. There is also `process.loadEnvFile('.env')` for code, and `util.parseEnv(text)` to parse text. To set one variable for one run:

```bash
# bash, zsh
PORT=9000 node server.js
```

```powershell
# PowerShell
$env:PORT = 9000; node server.js
```

Commit a `.env.example` file with fake values so a new developer knows which variables exist. In production, a `.env` file is usually **not** used. The platform (systemd, Docker, Kubernetes, your cloud) injects the variables.

> **Common mistake:** reading `process.env.SOMETHING` in twenty different files. Config then has no single place, no validation and no types. Read the environment **once**, in one module, check it, freeze the result, and let the rest of the code import that object.

## 3. Validate config at startup and fail fast

**Fail fast** means: if something is wrong, stop immediately and say clearly what is wrong. A service that starts with a missing database URL and fails on the first user request, at 3 a.m., is much worse than one that refuses to start during the deploy.

Example `examples/01-config-and-node-env.js` has a hand-written validator. This is the core of it:

```js
function loadConfig(env) {
  const problems = [];
  const nodeEnv = env.NODE_ENV || 'development'; // unset means "development" here: a choice, see trap 2 in the NODE_ENV section
  if (!PROFILES[nodeEnv]) {
    // Stop here: without a known profile every other message would just be noise.
    throw new ConfigError([`NODE_ENV must be one of: ${Object.keys(PROFILES).join(', ')} (got "${nodeEnv}")`]);
  }
  const profile = PROFILES[nodeEnv];

  const values = {};
  for (const [name, rule] of Object.entries(SCHEMA)) {
    // Order of precedence: real environment variable, then the profile default, then the schema fallback.
    const fromEnv = env[name] !== undefined && env[name] !== '' ? env[name] : undefined;
    const text = fromEnv ?? profile[name];
    if (text === undefined) {
      if ('fallback' in rule) values[name] = rule.fallback;
      else problems.push(`${name} is required`);
      continue;
    }
    const result = parse(name, text, rule);
    if (result.error) problems.push(result.error);
    else values[name] = result.value;
  }
  if (problems.length > 0) throw new ConfigError(problems); // ALL problems at once, not one per restart
  return Object.freeze({ NODE_ENV: nodeEnv, ...values });
}
```

The design choices matter more than the code:

1. **A table (`SCHEMA`) says what each variable must look like**, and one loop checks all of them.
2. **All problems are collected and reported together.** Nobody wants to fix one error, redeploy, and find the next one.
3. **Error messages never contain the value**, because the value may be a secret.
4. **The result is frozen** (`Object.freeze`). Later code cannot change the config by accident.
5. **Production has no default for secrets.** Development has safe fake defaults, so a new developer can start with an empty environment. Production must provide real values or refuse to start.

Output (the example "pretends" to be several environments by passing different objects instead of `process.env`):

```text
2. A validated config: development works with nothing set, production does not
   development, empty environment:
   ok -> { NODE_ENV: 'development', DEPLOY_ENV: 'local', PORT: 3000, LOG_LEVEL: 'debug', DATABASE_URL: '***', SESSION_SECRET: '***', DB_POOL_MAX: 10, SHUTDOWN_TIMEOUT_MS: 10000, FEATURE_NEW_CHECKOUT: false }
   production, nothing else set:
   Invalid configuration (2 problems):
     - DATABASE_URL is required
     - SESSION_SECRET is required
   (a real app prints this and exits with code 1 before it opens any port)
   production, wrong values:
   Invalid configuration (5 problems):
     - PORT must be a whole number
     - LOG_LEVEL must be one of: trace, debug, info, warn, error, fatal
     - DATABASE_URL is not a valid URL
     - SESSION_SECRET must be at least 16 characters long
     - DB_POOL_MAX must be between 1 and 100
   (a real app prints this and exits with code 1 before it opens any port)
   typo in NODE_ENV:
   Invalid configuration (1 problem):
     - NODE_ENV must be one of: development, test, production (got "prod")
   (a real app prints this and exits with code 1 before it opens any port)
3. A good production config: real variables override the profile, secrets stay hidden
   production, complete:
   ok -> { NODE_ENV: 'production', DEPLOY_ENV: 'staging', PORT: 9000, LOG_LEVEL: 'info', DATABASE_URL: '***', SESSION_SECRET: '***', DB_POOL_MAX: 10, SHUTDOWN_TIMEOUT_MS: 10000, FEATURE_NEW_CHECKOUT: true }
   changing the config later: TypeError
```

A real service uses it like this, at the very top of `server.js`:

```js
let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  console.error(err.message);
  process.exit(1); // nothing is running yet, so exiting at once is correct here
}
```

> **Under the hood:** a failing start is also good for deployment systems. In Kubernetes a new version with bad config never becomes "ready", so the rolling update stops and the **old** version keeps serving users. The bad deploy is visible and harmless. If the app instead started and failed later, users would see the errors.

Libraries do the same job with less code. This is an illustrative snippet, not a runnable example:

```js
// Needs: npm install zod
const { z } = require('zod');

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000), // coerce: text to number
  DATABASE_URL: z.string().url(), // zod 4 also has the shorter z.url(); check the docs of your zod version
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const config = Env.parse(process.env); // throws one error that lists every problem
```

### Config per environment

There are three common ways to give different settings to different environments. They can be combined, as in the example:

| Way | Good for | Watch out |
|---|---|---|
| Environment variables only | Everything, especially secrets | Easy to forget one: validate at startup |
| Defaults per environment inside the code (the `PROFILES` object) | Non-secret defaults such as log level and port | Never put production secrets in code |
| A config file per environment (`config/production.json`) | Large, non-secret settings | Do not commit secrets. Files drift away from reality |

The order of precedence in the example, strongest first: a real environment variable, then the profile default, then the fallback in the schema. This is the same idea as `--env-file` (shell beats file).

Do not write `if (process.env.NODE_ENV === 'production')` all over the code. Decide once, in the config module, and expose a named setting such as `config.logLevel` or `config.features.newCheckout`.

## 4. Secrets

A **secret** is a value that gives access: database passwords, API keys, signing keys, tokens. Rules that interviewers expect you to know:

- **Never in git**, not even "just for now". History keeps it. If it leaks, **rotate** it (create a new one, retire the old one). Removing the commit is not enough.
- **Never in a Docker image.** `ENV` and `ARG` values stay visible in the image layers (`docker history`). For build-time secrets such as a private npm token, use BuildKit's `RUN --mount=type=secret`.
- **Never in logs, error messages or URLs.** See redaction in section 7.
- **Least privilege.** Give each service its own credentials with only the rights it needs, so one leak does not open everything.
- **Rotate regularly** and make rotation possible: a restart or a reload should be enough to pick up a new value.

Where secrets live and how they arrive:

| Where it is stored | How the app gets it |
|---|---|
| A secret manager (AWS Secrets Manager, Google Secret Manager, Azure Key Vault, HashiCorp Vault) | The platform injects it as an environment variable or a file, or the app fetches it at startup |
| Kubernetes `Secret` | Environment variable or a mounted file. Note: a Kubernetes Secret is only base64 encoded, not encrypted, unless you enable encryption at rest or use an external secrets tool |
| The CI system's secret store | Used at deploy time to create the above. Never printed in job logs |

Environment variable or file? Environment variables are simple, but they are visible to anything that can inspect the process (`docker inspect`, crash dumps, child processes inherit them). A mounted **file** (for example `/run/secrets/db_password`) can have strict permissions. A common convention is `DB_PASSWORD_FILE=/run/secrets/db_password`: the app reads the file named by the variable (the official PostgreSQL Docker image works like this).

> **Interview tip:** if asked "how do you handle secrets?", cover four things: not in git or images, injected at runtime from a secret manager, redacted in logs, and rotated. Mentioning that Kubernetes Secrets are not encrypted by default shows real experience.

## 5. NODE_ENV: what it really changes

`NODE_ENV` is an environment variable with three conventional values: `development`, `test` and `production`.

The surprising fact: **Node itself does not read it.** The example starts two fresh Node processes that differ only in `NODE_ENV` and compares a fingerprint of the runtime (version, heap limit, built-in features, flags):

```text
4. What NODE_ENV changes in Node itself: nothing
   runtime facts identical with NODE_ENV=production and =development: true
```

So what does `NODE_ENV=production` do? Other code reads it:

| Who reads it | What happens |
|---|---|
| **npm** | `npm install` and `npm ci` skip `devDependencies` when it is `production`. (Checked: `NODE_ENV=production npm config get omit` prints `dev`.) |
| **Express** | Caches view templates and sends shorter error messages |
| **Many libraries** | Turn off debug checks and extra logging, or choose a production build |
| **Your own code** | The example hides error details in production and shows them in development |

```text
5. What reads NODE_ENV: libraries (and your own code)
   development: { error: 'relation "orders" does not exist', type: 'Error' }
   production : { error: 'Internal Server Error' }
   A typo is silent: "prod" === "production" is false -> that is why loadConfig() rejects unknown values
```

Traps that interviewers like:

1. **Staging is not a `NODE_ENV` value.** Libraries only know `production` and "not production". If staging uses `NODE_ENV=staging`, they behave like development (slow, verbose). Use `NODE_ENV=production` on staging too, and a separate variable such as `DEPLOY_ENV=staging` for "which production". The example config has exactly this.
2. **Unset means development for most libraries.** A forgotten variable in production silently gives you the slow, verbose mode. Set it explicitly in the image (`ENV NODE_ENV=production`) and validate it.
3. **Order in a Dockerfile.** If `ENV NODE_ENV=production` comes **before** `npm ci`, the dev dependencies (your compiler, your bundler) are not installed and the build fails. Use `npm ci --omit=dev` where you mean it, and set the variable in the final stage.
4. **Typos are silent.** `NODE_ENV=prod` is "not production" to every library. The validator in section 3 rejects it.
5. **It is not a feature switch.** Do not hide features behind `NODE_ENV`. Use explicit config values.

> **Remember:** `NODE_ENV` does not make your own code faster by itself. It is only a signal that libraries and your code choose to read.

## 6. Logging: why `console.log` is not enough

A **log** is a record of something that happened, written while the program runs. You already know `console.log`. In production it fails you in five ways:

1. **No levels.** You cannot keep the important messages and drop the noisy ones.
2. **No structure.** A line like `payment failed for order 42: card declined` can only be searched with text patterns. "Show me all failed payments over 100 euros for customer 7" is impossible.
3. **No context.** Which request, which user, which server, which version?
4. **Multi-line output breaks tools.** A stack trace printed as ten lines becomes ten separate "events" in most log systems.
5. **No control.** You cannot turn debug logs on for 10 minutes without a code change.

The answer is **structured logging**: every log event is **one line of JSON** with named fields. Machines can parse it, filter it, and group it.

```json
{"level":"warn","time":"2026-11-10T12:00:00.000Z","service":"orders-api","orderId":42,"reason":"card_declined","msg":"payment failed"}
```

### Levels

| Level | Number (pino style) | Use it for |
|---|---|---|
| `fatal` | 60 | The process cannot continue and will exit |
| `error` | 50 | An operation failed and someone should look |
| `warn` | 40 | Something odd that was handled (a retry, a fallback, a deprecated call) |
| `info` | 30 | Normal important events: server started, request finished, job completed |
| `debug` | 20 | Detail for developers. Off in production by default |
| `trace` | 10 | Very detailed. Almost never on |

Set the lowest level that is written with an environment variable (`LOG_LEVEL=info`). A message below that level costs almost nothing, because the logger returns at the first comparison. Changing the variable needs a restart; real loggers such as pino also let you change `logger.level` while running, for example from a protected admin route or a signal, so you can turn debug on for ten minutes without a deploy.

### Where do logs go? To stdout

Factor XI of the twelve-factor app: **a service does not manage log files. It writes its event stream to stdout** and the platform collects it. Docker, Kubernetes, systemd (journal) and every cloud do this already. No rotation, no disk-full surprises, no file permissions inside the container.

### What not to log

- Passwords, tokens, full card numbers, and personal data you do not need (see redaction below).
- The same error at every layer. Pick one place to log an error (usually where it is finally handled), otherwise one failure creates five lines.
- Every successful health check. They arrive every few seconds and bury everything else.
- Whole request bodies. They are big and often contain secrets.

> **Interview tip:** "Why not just use `console.log`?" A strong answer names the gaps (no levels, nothing you can search by field, no request context, stack traces split into many events, no way to change verbosity without a deploy) and then says what you use instead: one JSON object per line on stdout, with a level and a request id.

## 7. A tiny logger, redaction, and the real libraries

Example `examples/02-json-logger.js` uses a hand-written logger from `_logger.js`. It is about 90 lines and has no dependencies, so you can see every moving part. This is its core:

```js
function build(settings, bindings) {
  const log = {};
  for (const [name, number] of Object.entries(LEVELS)) {
    log[name] = (first, second) => {
      if (number < settings.threshold) return; // a disabled level costs one comparison
      // Supported calls: log.info('text'), log.info({ userId: 7 }, 'text'), log.error(err, 'text')
      let fields = {};
      let msg = '';
      if (typeof first === 'string') {
        msg = first;
      } else if (first instanceof Error) {
        fields = { err: first };
        msg = second ?? first.message;
      } else {
        fields = first ?? {};
        msg = second ?? '';
      }
      const fromContext = settings.context ? settings.context.getStore() : undefined;
      const record = { level: name, time: settings.now().toISOString(), ...bindings, ...fromContext, ...fields, msg };
      settings.write(JSON.stringify(sanitize(record, settings.redactKeys)));
    };
  }
  // A child logger adds fixed fields to every line it writes (module name, order id, ...).
  log.child = (extra) => build(settings, { ...bindings, ...extra });
  log.isLevelEnabled = (name) => LEVELS[name] >= settings.threshold;
  return log;
}
```

Four ideas are in there:

- **Cheap disabled levels:** `if (number < settings.threshold) return;` is the first line of every log method.
- **Child loggers** (`log.child({ module: 'checkout' })`) add fixed fields to every line they write, so the module name does not have to be repeated.
- **`context`:** the logger can read an `AsyncLocalStorage` store and add its fields to every line (section 8).
- **`sanitize`:** before `JSON.stringify`, every value is made safe. Errors become plain objects, circular references become `"[Circular]"`, BigInt becomes text, and secrets are hidden.

The output of the example, section by section:

```text
1. The same event as text and as a JSON line
   text:  payment failed for order 42: card declined
   {"level":"warn","time":"2026-11-10T12:00:00.000Z","service":"orders-api","orderId":42,"reason":"card_declined","msg":"payment failed"}
2. Levels: the logger is set to "info", so debug is dropped
   lines written: 1 | debug enabled: false | warn enabled: true
3. Child loggers add fixed fields to every line
   {"level":"info","time":"2026-11-10T12:00:02.000Z","service":"orders-api","module":"checkout","orderId":43,"msg":"cart validated"}
   {"level":"info","time":"2026-11-10T12:00:03.000Z","service":"orders-api","module":"checkout","orderId":43,"items":3,"msg":"stock reserved"}
4. Errors are turned into plain fields (type, message, stack, code, cause)
   err.type    : Error
   err.message : could not load order
   err.cause   : ECONNREFUSED - connect ECONNREFUSED 10.0.0.5:5432
   err.stack starts with: "Error: could not load order"
5. Secrets are redacted by key name, at any depth
   {"level":"info","time":"2026-11-10T12:00:05.000Z","service":"orders-api","user":"ada","password":"[REDACTED]","headers":{"authorization":"[REDACTED]","accept":"application/json"},"payload":[{"token":"[REDACTED]","name":"first"}],"msg":"login attempt"}
   Only KEYS are checked. A secret inside the message text is NOT found:
   {"level":"info","time":"2026-11-10T12:00:06.000Z","service":"orders-api","msg":"connecting to postgres://admin:hunter2@db:5432/app"}
6. A circular object and a BigInt do not crash the logger
   {"level":"info","time":"2026-11-10T12:00:07.000Z","service":"orders-api","a":{"name":"a","self":"[Circular]"},"big":"12345678901234567890","msg":"odd values"}
7. What a log aggregator does: parse every line, then filter and group by field
   count by level          : { warn: 1, info: 8, error: 2 }
   errors                  : [ 'request failed', 'payment service timed out' ]
   everything for r-1      : [ 'info:order created', 'error:payment service timed out' ]
   plain text would need a regular expression for each of these questions
```

### Redaction

**Redaction** means replacing a secret with a placeholder before the line is written. The example matches **keys** (`password`, `token`, `authorization`, `cookie`, ...) at any depth, in objects and arrays.

> **Common mistake:** trusting redaction completely. It only knows key names. In section 5 of the output, the password inside the connection string in the message text is **not** found. Never put secrets in message strings, URLs or error messages in the first place. Redaction is a safety net, not a licence.

Better practice: log specific fields you chose (an allow-list) instead of dumping whole objects (a deny-list approach that has to know every secret).

### pino and winston (third-party, illustrative)

In real projects you normally use a library. **pino** is the fast, JSON-first choice. **winston** is older and very configurable (many outputs, formats).

```js
// Needs: npm install pino
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: ['password', 'req.headers.authorization', 'req.headers.cookie'], // paths, not just key names
});

logger.info({ orderId: 42 }, 'order created'); // pino writes {"level":30,"time":...,"pid":...,"hostname":...,"orderId":42,"msg":"order created"}
const orderLog = logger.child({ module: 'checkout' });
orderLog.error(new Error('boom'), 'payment failed'); // pino serializes the error under "err"
```

```js
// Needs: npm install winston
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  transports: [new winston.transports.Console()],
});

logger.info('order created', { orderId: 42 });
```

| | pino | winston |
|---|---|---|
| Output | JSON by default, level as a number (30 = info) | Any format you configure, level as text |
| Level order | Higher number = more severe (10 to 60) | npm levels: **lower** number = more severe (`error` 0, `warn` 1, `info` 2, ...) |
| Strength | Speed, low overhead, `child` loggers, `redact` paths | Many transports and formats, very flexible |
| Pretty output for development | A separate tool (`pino-pretty`), used as a pipe, never in production | Built-in formats such as `colorize` |

Both libraries are labelled as illustrative here: this repo does not install them. Pino moves heavy work (formatting, shipping) to a separate worker thread through "transports", so slow log destinations do not block the event loop.

## 8. Request ids with AsyncLocalStorage

A server handles many requests at the same time, so their log lines mix together. To read the story of **one** request you need a **correlation id** (also called a request id): a unique value that is attached to every log line produced for that request.

Passing the id as an argument through every function is a lot of plumbing. **`AsyncLocalStorage`** (from `node:async_hooks`) solves it: it gives you a "box" that belongs to the current chain of asynchronous calls. You put the id in at the start of the request, and any code running later in that chain (after `await`, in timers, in callbacks) can read it. Since Node 24.0 it is built on a mechanism called AsyncContextFrame; the API is the same.

Example `examples/03-request-id-als.js` runs two small services, **gateway** calls **inventory**, each with its own store. The function `makeService(name)` creates one `AsyncLocalStorage` and one logger per service, and returns these helpers:

```js
function withRequestId(handler) {
  return (req, res) => {
    const incoming = req.headers['x-request-id'];
    // Never trust a header blindly: accept only short, simple ids. Otherwise make a new one.
    const requestId = typeof incoming === 'string' && /^[\w.-]{1,64}$/.test(incoming) ? incoming : randomUUID();
    res.setHeader('x-request-id', requestId);
    context.run({ requestId }, () => {
      log.info({ method: req.method, url: req.url }, 'request received');
      handler(req, res).catch((err) => {
        log.error(err, 'unhandled error in handler');
        res.statusCode = 500;
        res.end('error');
      });
    });
  };
}

// Use this for every outgoing call so the id travels to the next service.
function callService(url) {
  const { requestId } = context.getStore();
  return fetch(url, { headers: { 'x-request-id': requestId } });
}

return { context, log, withRequestId, callService };
```

What happens:

1. The id comes from the `x-request-id` header if it is a short, simple string; otherwise a new UUID is made. **Never trust a header blindly**: a long or odd value could flood or confuse your logs.
2. `context.run({ requestId }, ...)` makes the id available to everything the handler starts.
3. The logger was created with `context`, so every line gets the `requestId` automatically.
4. `callService` copies the id into the header of the outgoing request, so the next service continues the same story.
5. The id is also sent back in the response, so a user can quote it to support.

```text
1. Three requests at the same time, the log lines of both services interleave
   total log lines: 19
   A keeps its own id          : true
   B got a generated UUID      : true
   C got a new id, not the bad one: true
2. Filter by one id and you get the whole story, across both services
   request A (client sent x-request-id: client-abc)
     gateway   info  request received {"method":"GET","url":"/order"}
     gateway   debug asking inventory {"sku":"sku-1"}
     inventory info  request received {"method":"GET","url":"/stock/sku-1"}
     inventory info  stock checked {"sku":"sku-1","available":5}
     gateway   debug inventory answered {"available":5}
     gateway   info  sending response
   ... (request B had no header and request C had a bad one: the real output prints the same six lines for each, under its own id; left out here)
   lines with no id (written outside a request): [ 'gateway started' ]
3. A hand-made queue: callbacks that run later lose the context unless you bind them
   plain callback sees : undefined
   bound callback sees : job-42
```

Read the middle block: for each request, lines from **both services** appear under the same id, in the order they happened. Real logs of the two services would be in different files or pods, and a log search for the id finds them all.

> **Common mistake:** context getting lost. A callback that you store and call later from somewhere else runs in the context of the **caller**, not the place where you stored it. The last part of the output shows it: the plain callback sees `undefined`, while `AsyncLocalStorage.bind(fn)` remembers the context where it was created. Libraries that keep their own queues (connection pools, job runners) are the usual place where this happens.

> **Under the hood:** prefer `als.run(store, fn)`. The methods `enterWith`, `exit` and `disable` are still experimental in the Node docs.

## 9. Log aggregation

In production you may have 40 pods on 10 machines. Nobody connects to each one to read a file. **Log aggregation** means collecting all the lines in one place and searching them there.

```text
 your app --stdout--> container runtime --> log agent --> central store --> search and dashboards
 (JSON lines)                               (Fluent Bit,    (Elasticsearch/OpenSearch,   (Kibana, Grafana,
                                             Vector, ...)    Loki, CloudWatch, Datadog)   vendor UI)
```

What helps the most:

- **One JSON object per line.** The store can index fields, so `level:error AND orderId:42` works. This is why the hand-written logger writes `JSON.stringify(...)` plus a newline and nothing else.
- **The same field names in every service** (`service`, `level`, `requestId`, `time`). Then one query follows a request across services (the "everything for r-1" query in part 7 of the output of example 02).
- **Cost control.** Log stores charge by volume. Keep `info` in production, use `debug` only for a short time on a few instances, drop noisy health-check lines, and set a retention period (for example 14 days hot, 90 days cold).
- **Careful with personal data.** Logs are data too. Laws such as GDPR apply, so avoid logging what you do not need.

The part you own is the first arrow: write clean JSON lines to stdout. Everything after it is platform work.

> **Interview tip:** "A user says their order failed. How do you find out why, across five services?" Strong answer: ask for the request id (it is in the response header), search the aggregated JSON logs for that id, read the story in time order, and, if tracing is on, open the trace with the same id to see which step was slow or failed.

## 10. Health checks: liveness, readiness and startup

A **health check** is a small HTTP endpoint that the platform calls to ask your app "are you OK?". Orchestrators such as Kubernetes, load balancers and Docker use the answer to decide what to do. There are three different questions, and mixing them up causes real outages.

| Check | Question it answers | If it fails | Typical path |
|---|---|---|---|
| **Liveness** | Is the process stuck or broken beyond repair? | The platform **restarts** the container | `/livez` |
| **Readiness** | Can this instance take traffic right now? | The platform **stops sending requests** to it. No restart | `/readyz` |
| **Startup** | Has the slow start-up work finished? | Other checks wait. After too many failures: restart | `/startupz` |

Use 200 for "yes" and 503 ("Service Unavailable") for "no". The smallest useful version is two routes and one flag (a sketch):

```js
let ready = false; // set to true when start-up work is done, back to false when shutdown begins

http.createServer((req, res) => {
  if (req.url === '/livez') return void res.end('alive'); // the process answers, so it is not stuck
  if (req.url === '/readyz') {
    res.statusCode = ready ? 200 : 503;
    return void res.end(ready ? 'ready' : 'not ready');
  }
  res.statusCode = 404;
  res.end();
});
```

Real services need more: a startup check, a timeout around each dependency, and the shutdown state. Example `examples/04-health-checks.js` is a server whose state we change step by step. This is its decision logic:

```js
async function route(url) {
  if (url === '/livez') {
    // Only look at this process. Never check the database here: restarting the app does not fix the database.
    return { status: 200, body: { status: 'alive' } };
  }
  if (url === '/startupz') {
    return state.started ? { status: 200, body: { status: 'started' } } : { status: 503, body: { status: 'starting' } };
  }
  if (url === '/readyz') {
    if (state.shuttingDown) return { status: 503, body: { status: 'shutting-down' } };
    if (!state.started) return { status: 503, body: { status: 'starting' } };
    const checks = {};
    try {
      await withTimeout(db.ping(), 100);
      checks.database = 'ok';
    } catch (err) {
      checks.database = `failed: ${err.message}`;
    }
    const ready = Object.values(checks).every((value) => value === 'ok');
    return { status: ready ? 200 : 503, body: { status: ready ? 'ready' : 'not-ready', checks } };
  }
  return { status: 404, body: { error: 'not found' } };
}
```

```text
1. Just started: the port is open, but warm-up is not finished
   /livez     200 {"status":"alive"}
   /startupz  503 {"status":"starting"}
   /readyz    503 {"status":"starting"}
2. Warm-up finished
   /livez     200 {"status":"alive"}
   /startupz  200 {"status":"started"}
   /readyz    200 {"status":"ready","checks":{"database":"ok"}}
3. Database refuses connections: not ready, but still ALIVE (no restart helps)
   /livez     200 {"status":"alive"}
   /startupz  200 {"status":"started"}
   /readyz    503 {"status":"not-ready","checks":{"database":"failed: connection refused"}}
4. Database hangs: the readiness check gives up after its own 100 ms timeout
   /livez     200 {"status":"alive"}
   /startupz  200 {"status":"started"}
   /readyz    503 {"status":"not-ready","checks":{"database":"failed: no answer within 100 ms"}}
   the three probes together took less than 1 s: true
5. Database is back: ready again
   /livez     200 {"status":"alive"}
   /startupz  200 {"status":"started"}
   /readyz    200 {"status":"ready","checks":{"database":"ok"}}
6. Shutting down: readiness fails first so no new traffic arrives, liveness stays green
   /livez     200 {"status":"alive"}
   /startupz  200 {"status":"started"}
   /readyz    503 {"status":"shutting-down"}
```

Read the output top to bottom:

1. **Just started.** The port is open, but warm-up is not finished. Liveness is green (the process is fine), startup and readiness are red. A load balancer sends no traffic yet.
2. **Warm-up finished.** All green.
3. **Database refuses connections.** Readiness turns red, so traffic goes to other instances. **Liveness stays green**: restarting this app would not repair the database.
4. **Database hangs.** The check has its own timeout (100 ms), so the probe still answers quickly. A health check that waits for a hung dependency just hangs too, and the platform then thinks the whole app is dead.
5. **Database is back.** Ready again, with no human action.
6. **Shutting down.** Readiness goes red first, so no new requests arrive while we finish the old ones (next section).

Rules that come from real incidents:

- **Liveness must be dumb.** Never check the database, a queue, or another service in liveness. If the database is down and every liveness check fails, the platform restarts every instance, which makes things worse (and the restarts overload the database when it returns). The only thing liveness has to prove is "the event loop still answers". That alone catches infinite loops and deadlocks, because a blocked process cannot answer the probe.
- **Readiness checks what this instance needs to serve**, with a short timeout on each check, and caches an expensive result for a few seconds.
- **Be careful with shared dependencies.** If readiness fails on a dependency that every instance shares, a short blip makes all instances "not ready" at once and you have a full outage, where a degraded service (some features failing) might have been better. Decide per dependency: is the service useless without it?
- **No authentication, no heavy queries, no logging at `info` for every probe.** They are called every few seconds by many callers.
- **Startup probes** let you give a slow app (cache warm-up, migrations) a long start window without making the liveness probe slow to notice real deadlocks later.

> **Interview tip:** "What is the difference between liveness and readiness?" A strong answer gives the failure action (restart vs. remove from the load balancer), says liveness must not depend on external systems, and mentions the cascading-restart risk.

## 11. Graceful shutdown

Your process gets stopped all the time: every deploy, every scale-down, every node upgrade, every spot-instance interruption. **Graceful shutdown** means: when asked to stop, finish what you are doing first, then exit cleanly.

Without it, users see dropped connections (502 or "connection reset") on each deploy, jobs are cut in half, database transactions are aborted, and the last log and trace data is lost.

### Signals

A **signal** is a small message the operating system sends to a process. The ones you need:

| Signal | Meaning | Who sends it |
|---|---|---|
| `SIGTERM` | "Please stop." Can be caught | Docker (`docker stop`), Kubernetes, systemd, `kill <pid>` |
| `SIGINT` | Ctrl+C in a terminal. Can be caught | You, and PM2 (its default stop signal) |
| `SIGKILL` | "Die now." **Cannot be caught** | The platform, after the grace period ran out |

The platform's promise is: it sends `SIGTERM`, waits (Docker: 10 seconds by default; Kubernetes: `terminationGracePeriodSeconds`, 30 by default; systemd: `TimeoutStopSec`), then sends `SIGKILL`. Your job is to finish before that second step.

Three words you will meet in this section:

- A request is **in flight** when it has arrived but has not been answered yet.
- To **drain** is to let the in-flight work finish while accepting no new work.
- **Keep-alive** means that after answering, the client keeps the TCP connection (the network connection underneath HTTP) open to reuse it for its next request. A connection that is open but waiting for that next request is **idle**. A server that wants to stop has to close idle connections itself, or they hold it open.

### The smallest version

This is the minimum that makes a deploy harmless for a simple server (a sketch; checked by running it and triggering the handler):

```js
const server = http.createServer(handler);
server.listen(3000);

function shutdown(signal) {
  console.log(`${signal} received: no new connections, finishing the requests in flight`);
  server.close(() => {
    // this callback runs when the last connection has ended
    console.log('all requests finished');
    process.exitCode = 0; // no process.exit(): Node ends by itself when nothing is left to do
  });
  // The escape hatch: if something never finishes, give up after 10 seconds.
  setTimeout(() => process.exit(1), 10_000).unref(); // unref: this timer alone must not keep the process alive
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

`server.close()` stops new connections and waits for the existing ones. With a request in flight, the output is the first line, then (after the request is answered) the second. It is a good start, and a real service needs more:

- Tell the load balancer first (make readiness fail and wait a moment).
- Close keep-alive connections that become idle after their last answer. Otherwise they hold the server open until the keep-alive timeout (up to 6 seconds) or until the client hangs up. When this sketch was tried with `fetch` as the client, the process needed about 4 seconds to exit instead of well under 1.
- Close the queue worker and the database, in the right order.
- Stop at once on a second signal, and report an exit code.

That is the next part.

### The seven steps

Example `examples/05-graceful-shutdown.js` implements them. This is the heart of it:

```js
async function drain(signal) {
  const started = Date.now();
  log.info({ signal }, 'shutdown started');
  shuttingDown = true; // 1. readiness answers 503 from now on

  const hardStop = setTimeout(() => {
    // 2. The escape hatch. It is armed before anything else can hang.
    log.error({ timeoutMs }, 'graceful shutdown took too long, forcing exit');
    forceExit(1);
  }, timeoutMs);
  hardStop.unref(); // this timer alone must never keep the process alive

  log.info({ readinessDelayMs }, 'readiness is failing, waiting for the load balancer to notice');
  await sleep(readinessDelayMs); // 3. keep serving while the traffic is being moved away

  const serverClosed = once(server, 'close');
  server.close(); // 4. stop accepting new connections, close the idle keep-alive ones
  const sweep = setInterval(() => server.closeIdleConnections(), 20); // connections that become idle later
  log.info('no longer accepting new connections, waiting for requests in flight');
  await Promise.all([
    serverClosed.then(() => log.info('http server closed: every request has finished')),
    worker.stop(), // 5. stop taking new jobs too
  ]);
  clearInterval(sweep);

  await db.close(); // 6. last, because both the server and the worker were using it
  clearTimeout(hardStop);
  log.info({ ms: Date.now() - started, forced }, 'shutdown complete');
  return forced ? 1 : 0; // 7. the exit code the process should end with
}
```

1. **Mark yourself not-ready** (`shuttingDown = true`). The readiness endpoint now answers 503.
2. **Arm a hard timeout first**, before anything can hang. If the clean shutdown takes too long, force the exit with code 1. The timer is `unref()`ed so that it never keeps the process alive by itself. Make it **shorter than the platform's kill timer** (for example 20 s inside a 30 s grace period), so that you exit with your own log and code instead of being shot by `SIGKILL`.
3. **Wait a moment for the load balancer to notice** (`readinessDelayMs`). Removing a pod from rotation and sending `SIGTERM` happen at about the same time, and it takes a few seconds for everyone to stop sending requests. During this delay the server still serves normally. In real systems this is 3 to 15 seconds. (Kubernetes people often do the same with a `preStop` hook that sleeps.)
4. **Stop accepting connections** with `server.close()`. Existing requests keep running. Since Node 19, `close()` also closes idle keep-alive connections. We also sweep every 20 ms with `server.closeIdleConnections()` for connections that become idle later (explained below).
5. **Wait for in-flight work**: the server's `close` event (all requests done) and the queue worker finishing its current job.
6. **Close shared dependencies last, in reverse order of creation**: the database pool was used by both the server and the worker, so it closes after them.
7. **Return the exit code.** 0 if everything was clean, 1 if the hard timeout or a second signal forced it.

The wiring to the signals is small. Note what it does **not** do: it does not call `process.exit()`.

```js
function shutdown(signal) {
  if (shutdownPromise) {
    // A second signal means "I am impatient": stop being graceful.
    log.warn({ signal }, 'second signal while shutting down, exiting now');
    forceExit(1);
    return shutdownPromise;
  }
  shutdownPromise = drain(signal);
  return shutdownPromise;
}

function installSignalHandlers(shutdown) {
  const installed = [];
  for (const signal of ['SIGTERM', 'SIGINT']) {
    const handler = () => {
      shutdown(signal).then((code) => {
        process.exitCode = code; // Node ends by itself, with this code, once nothing is left to do
      });
    };
    process.on(signal, handler);
    installed.push([signal, handler]);
  }
  return () => installed.forEach(([signal, handler]) => process.off(signal, handler)); // for the demo
}
```

- The **second signal** (`shutdownPromise` already exists) means the operator is impatient: stop being graceful and exit now. This is why pressing Ctrl+C twice works in well-behaved programs.
- The handler sets `process.exitCode` and lets Node end on its own once nothing is left to do. Section 12 shows why.

Real signals are awkward to send on Windows, so the demo triggers the handlers with `process.emit('SIGTERM')`, which runs exactly the same listeners. It runs three scenarios. The log lines are collected and printed after each scenario, so they do not mix with the narration.

```text
Scenario 1: a clean shutdown (SIGTERM)
   idle keep-alive connection is open: true
   >>> SIGTERM arrives while /slow is in flight
   during the readiness delay, /readyz says: 503 shutting down
   after the listener closed, a new request fails with: ECONNREFUSED
   the request that was in flight got: 200 "slow done" | connection header: close
   idle keep-alive connection was closed by the server: true
   process.exitCode is now: 0
   server log:
     info  shutdown started {"signal":"SIGTERM"}
     info  readiness is failing, waiting for the load balancer to notice {"readinessDelayMs":100}
     info  no longer accepting new connections, waiting for requests in flight
     info  asking the queue worker to stop after its current job
     info  queue worker finished its current job and stopped
     info  http server closed: every request has finished
     info  closing the database pool
     info  database pool closed
     info  shutdown complete {"forced":false}
Scenario 2: a request never finishes, so the hard timeout (300 ms) fires
   >>> SIGTERM arrives while /stuck is in flight
   the stuck request ended with: ECONNRESET
   exit(code) was requested with: [ 1 ] | process.exitCode: 1
   server log:
     info  shutdown started {"signal":"SIGTERM"}
     info  readiness is failing, waiting for the load balancer to notice {"readinessDelayMs":0}
     info  no longer accepting new connections, waiting for requests in flight
     info  asking the queue worker to stop after its current job
     info  queue worker finished its current job and stopped
     error graceful shutdown took too long, forcing exit {"timeoutMs":300}
     info  http server closed: every request has finished
     info  closing the database pool
     info  database pool closed
     info  shutdown complete {"forced":true}
Scenario 3: the operator presses Ctrl+C twice (second signal = stop waiting)
   >>> first SIGINT
   >>> second SIGINT
   exit(code) was requested with: [ 1 ] | process.exitCode: 1
   server log:
     info  shutdown started {"signal":"SIGINT"}
     info  readiness is failing, waiting for the load balancer to notice {"readinessDelayMs":0}
     info  no longer accepting new connections, waiting for requests in flight
     info  asking the queue worker to stop after its current job
     info  queue worker finished its current job and stopped
     warn  second signal while shutting down, exiting now {"signal":"SIGINT"}
     info  http server closed: every request has finished
     info  closing the database pool
     info  database pool closed
     info  shutdown complete {"forced":true}
```

What to notice:

- **Scenario 1.** During the readiness delay, `/readyz` says 503 but the server still answers. After the delay the listener is closed, and a new connection is refused (`ECONNREFUSED`). The request that was in flight when the signal arrived **finished normally** (200). Its response carried `Connection: close`, and the idle keep-alive connection was closed by the server. The process ends with exit code 0.
- **Scenario 2.** One request never finishes. The hard timeout (300 ms in the demo) fires, logs an error, and asks for exit code 1. In a real process `process.exit(1)` would end everything at this point; the demo replaces it with a stub that only closes the sockets, which is why the later log lines still appear.
- **Scenario 3.** The second `SIGINT` forces the exit at once.

> **Under the hood:** why the sweep and the `Connection: close` header? I measured this on Node 24.16: a keep-alive connection that is busy when `server.close()` is called becomes **idle** after its response, and then stays open until the keep-alive timeout (5 seconds plus a 1 second buffer by default). The `close` callback only arrived after about 6 seconds. Telling the client `Connection: close` on the last response, and sweeping with `closeIdleConnections()`, avoids that wait. If you cannot wait for anything, `server.closeAllConnections()` ends all connections, including busy ones (the hard-timeout path).

> **Interview tip:** "Walk me through a graceful shutdown." A strong answer in one breath: "On SIGTERM I make readiness fail, wait a few seconds for the load balancer, stop accepting connections and close the idle ones, wait for in-flight requests and jobs, close the database last, and let the process exit through `process.exitCode`. A hard timeout shorter than the platform's kill timer is the fallback, and a second signal forces the exit."

More things a complete shutdown has to handle:

- **Long-lived connections** (WebSocket, Server-Sent Events) never finish by themselves. Close them yourself, for WebSocket with close code 1001 ("going away"), and let clients reconnect to another instance (lesson 13).
- **Timers and intervals**: clear them, or `unref()` timers that should not hold the process open.
- **Telemetry**: flush the last batch of logs, metrics and traces before the end. A `beforeExit` handler (it runs when the loop is empty) is a good place, see `_snippets/otel-tracing.js`.
- **Windows**: Windows has no real signals. The Node docs say `SIGTERM` is not supported there, and `process.kill(pid, 'SIGTERM')` (or `SIGINT`) from another process ends the target unconditionally, without running your handlers. Ctrl+C (`SIGINT`) in a console does reach your handler. Production Node almost always runs on Linux, so test real signals in a Linux container or WSL.

The demo's `--serve` mode starts a real server you can stop with Ctrl+C:

```bash
node lessons/24-production-and-deployment/examples/05-graceful-shutdown.js --serve
```

It listens on port 3000 unless the `PORT` variable is set (this mode is not run by the course checker, so it is the one example that uses a fixed port).

### Crashes are not shutdowns

Everything above is for a stop that you **asked for**. A crash is different. After an `uncaughtException` (or an unhandled promise rejection, which Node 24 turns into an uncaught exception by default) the state of the process is unknown: a half-finished operation may have left data in a bad shape. Do not try to drain and keep serving. Write one clear log line, then exit with a non-zero code, and let the supervisor start a fresh process:

```js
process.on('uncaughtException', (err, origin) => {
  // origin is 'uncaughtException' for a thrown error and 'unhandledRejection' for a rejected promise nobody handled
  log.fatal({ err, origin }, 'uncaught exception, exiting');
  process.exit(1); // here process.exit is right: there is nothing safe left to protect
});
```

Without any handler Node already prints the stack and exits with code 1 (checked on Node 24.16). The handler is worth having because it writes a structured JSON line that your log tools can alert on, and it is the place to flush an error tracker (section 22). Never use `uncaughtException` to "keep going": that hides bugs and leaves the process in a state nobody understands (lesson 14).

## 12. The `process.exit()` pitfall

`process.exit(code)` ends the process **right now**. Pending timers never fire. Pending I/O callbacks never run. Requests in flight are cut. Even output that is still waiting to be written to `stdout` or `stderr` can be lost. Only synchronous `exit` listeners run.

`process.exitCode = code` is different: it only sets the number. Node keeps running until nothing is left to do, then exits with that number.

Example `examples/06-exit-pitfall.js` shows both. It starts small child programs, so the parent can watch what happens:

```text
1. Work that is scheduled but not finished yet
   with process.exit(0)      -> "shutdown requested" | code 0
   with process.exitCode = 0 -> "shutdown requested\nflushing the last buffered log lines" | code 0
2. A request that is still being handled when the shutdown code runs
   shutdown = process.exit(0)
     client got : FAILED (fetch failed)
     child exit : 0
   shutdown = server.close() and process.exitCode = 0
     client got : status 200, body "work finished"
     child exit : 0
```

- Part 1: the timer that was supposed to flush the last buffered log lines never ran with `process.exit(0)`. With `process.exitCode = 0` it ran.
- Part 2: a server handles a request that needs 400 ms. At 100 ms its "shutdown" code runs. With `process.exit(0)` the client got a network error (`fetch failed`; the exact error code differs between operating systems). With `server.close()` and `process.exitCode` the client got its answer, and the child still exited with code 0.

When is `process.exit()` fine? When there is nothing to protect: a fatal config error at startup (section 3), as the last step of the hard-timeout path, and after logging an uncaught exception. Everywhere else, set `process.exitCode` and let the loop drain.

> **Interview tip:** "What is wrong with calling `process.exit()` in a signal handler?" Strong answer: it skips draining, cuts in-flight requests, and can lose buffered output. Set `process.exitCode`, close resources, and keep a hard timeout as the fallback.

## 13. Process management: keeping the app running

A **process manager** (or supervisor) starts your app at boot, restarts it when it crashes, collects its output, and applies limits. Node does not restart itself. Lesson 14 explained the rule: log the error, exit, and let a supervisor restart you. These are the options.

### systemd (Linux servers)

**systemd** is the init system of most Linux distributions. You describe your service in a **unit file** (full file: `examples/_snippets/orders-api.service`):

```ini
[Service]
Type=simple
User=orders
Group=orders
WorkingDirectory=/opt/orders-api/current

# One KEY=value per line. Keep this file readable only by root (chmod 600), it holds secrets.
EnvironmentFile=/etc/orders-api/env
Environment=NODE_ENV=production

# Use the full path of node. systemd does not read your shell profile, so nvm and PATH tricks do not work here.
ExecStart=/usr/bin/node dist/server.js

# Restart after a crash or a non-zero exit, but NOT after a clean stop that you asked for.
Restart=on-failure
RestartSec=2

# Stopping: systemd sends SIGTERM, waits up to TimeoutStopSec for your graceful shutdown, then sends SIGKILL.
# Keep your own hard timeout (lesson example 05) shorter than this value.
KillSignal=SIGTERM
TimeoutStopSec=30
```

What the important lines do:

- `Restart=on-failure`: restart after a crash (non-zero exit), but not after a clean `systemctl stop`.
- `KillSignal` and `TimeoutStopSec`: the grace period of section 11. Your own hard timeout must be shorter.
- `EnvironmentFile`: keeps secrets out of the unit file. `User`: avoids running as root.
- The full path of `node`: systemd does not read your shell profile, so `nvm` and `PATH` tricks do not work.
- Comments: in unit files a comment must be on its own line. A `#` after a value becomes part of the value.

```bash
# Linux server commands (systemd does not exist on Windows)
sudo cp orders-api.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now orders-api   # start now and at every boot
systemctl status orders-api
journalctl -u orders-api -f     # logs: systemd collects stdout and stderr in the journal
```

### PM2 (third-party, popular on plain servers)

**PM2** is a process manager written in Node (`npm install -g pm2`). Its main attraction is **cluster mode**: it starts one worker per CPU core that share one port, and `pm2 reload` restarts them one by one for a zero-downtime deploy. Config (full file: `examples/_snippets/ecosystem.config.js`):

```js
exec_mode: 'cluster',
instances: 'max',

// Restart a worker whose memory passes this value (a safety net for a slow leak, not a cure for it).
max_memory_restart: '400M',

// Graceful stop: PM2 sends SIGINT, waits kill_timeout milliseconds, then sends SIGKILL.
// So your app must handle SIGINT (and SIGTERM for other platforms) and finish within this time.
kill_timeout: 10000,

// With wait_ready, `pm2 reload` waits until the new worker calls process.send('ready') before stopping the old one.
// In server.js:  server.listen(port, () => { if (process.send) process.send('ready'); });
wait_ready: true,
listen_timeout: 10000,
```

PM2 sends `SIGINT` first (not `SIGTERM`) and `SIGKILL` after `kill_timeout`. So your shutdown code should handle **both** signals, as the example does. Inside Docker or Kubernetes you usually do not need PM2: the platform already restarts and scales your process, and one `node` process per container is simpler.

### Docker restart policies

```bash
docker run --restart no ...              # default: never restart
docker run --restart on-failure:5 ...    # restart if the exit code is not 0, at most 5 times
docker run --restart unless-stopped ...  # restart always, except after you stopped it yourself
docker run --restart always ...          # restart always (also after a Docker daemon restart)
```

Docker slows down repeated restarts (a delay that grows), so a crash loop does not eat the whole machine. In Kubernetes the pod's `restartPolicy` is `Always` by default, with an exponential back-off that you see as the status `CrashLoopBackOff`.

### Comparison

| Tool | Restarts on crash | Starts at boot | Zero-downtime reload | Uses all CPU cores | Best for |
|---|---|---|---|---|---|
| systemd | Yes | Yes | No (not alone) | No (run several units) | One Linux server |
| PM2 | Yes | Yes (`pm2 startup`) | Yes, in cluster mode | Yes, in cluster mode | Simple servers, small teams |
| Docker restart policy | Yes | If Docker starts at boot | No | No | Single host containers |
| Kubernetes | Yes | n/a | Yes (rolling update) | Yes (more replicas) | Serious production |

### Why not nodemon in production?

`nodemon` (and `node --watch`, built in since Node 18.11 and stable in Node 22) **restarts the app when a file changes**. That is a development tool. In production it is wrong because:

- Nothing should change on disk while a release is running. A restart caused by a stray file write is an outage you did not plan.
- It is an extra process between the platform and your app. Signals may not reach your code, so graceful shutdown breaks.
- It brings dev dependencies into production, and offers no health checks, limits or log handling.
- After a crash, both `nodemon` and `node --watch` print a message and **wait for a file change** instead of restarting. A real supervisor restarts a crashed app by itself, with a back-off. With nodemon in production, a crash leaves you down until someone touches a file.

Run `node server.js` (or `node dist/server.js`) directly under a real supervisor.

> **Interview tip:** "PM2, systemd, or Docker/Kubernetes?" Strong answer: the job is the same everywhere (start at boot, restart on crash, send `SIGTERM` and wait, limit resources). On one plain Linux server use systemd or PM2. In containers let the platform do it and run one `node` process per container, scaling with more replicas. In every case the app must crash on fatal errors and shut down on `SIGTERM`.

## 14. Docker for Node

A **container** runs your app together with everything it needs (Node, libraries) as an isolated process, from an **image**: a read-only package built from a **Dockerfile**. The same image runs on your laptop, in CI and in production. That is the "build once, deploy many" idea.

Below is the production-grade Dockerfile from `examples/_snippets/Dockerfile`. It is not executed by the course tools (no Docker is needed to follow the lesson), so treat it as a reviewed template and test it in your own project. Read the comments, they are the lesson:

```dockerfile
# syntax=docker/dockerfile:1
#
# SNIPPET, not executed by the course tools. A production-grade, multi-stage Dockerfile for a Node.js service.
# It assumes: package.json + package-lock.json at the project root, a "build" script that writes to dist/,
# and a server that listens on PORT (default 3000) and has /livez and /readyz endpoints (lesson 24, example 04).
#
#   Build : docker build -t orders-api:1.0.0 .
#   Run   : docker run --rm --init -p 3000:3000 --memory 512m --env-file .env.production orders-api:1.0.0
#
# Three stages. Only the last one becomes the image you ship. The first two are thrown away after the build.

# Pin the MAJOR version so a rebuild does not jump to a new Node release by surprise.
# For fully repeatable builds pin the image digest as well:  node:24-alpine@sha256:<digest>
ARG NODE_VERSION=24

############################ stage 1: production dependencies only ############################
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
# (If a dependency compiles native code on Alpine, add here: RUN apk add --no-cache python3 make g++)

# LAYER CACHING: copy only the dependency files first. Docker reuses the cached result of the next
# instruction for as long as these two files are unchanged, so editing source code does not reinstall packages.
COPY package.json package-lock.json ./

# npm ci installs EXACTLY what the lockfile says and fails if package.json and the lockfile disagree.
# (npm install may rewrite the lockfile and drift. Do not use it in a build.)
# --omit=dev leaves out devDependencies. The cache mount keeps npm's download cache between builds
# without putting it in the image (needs BuildKit, which is the default in current Docker).
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

############################ stage 2: build (compile TypeScript, bundle, ...) ############################
FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
# Source code comes AFTER the install, because it changes far more often than the dependencies.
COPY . .
RUN npm run build
# Skip this whole stage for plain JavaScript projects and copy the source in the runtime stage instead.

############################ stage 3: runtime ############################
FROM node:${NODE_VERSION}-alpine AS runtime

# tini is a tiny init program for PID 1: it passes SIGTERM on to node and cleans up zombie processes.
# The alternative is to start the container with `docker run --init` (or `init: true` in compose).
RUN apk add --no-cache tini

# Libraries read NODE_ENV. "production" turns on their production behaviour (caching, short errors).
# Node itself ignores it. Memory limits are NOT set here: they belong to the deployment, see below.
ENV NODE_ENV=production
WORKDIR /app

# Do not run as root. The official node images already contain a user called "node" (uid 1000).
# --chown makes the files belong to that user without an extra layer.
COPY --from=deps  --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
USER node

EXPOSE 3000

# Docker's own health check. No curl in slim images, so use node itself (fetch is built in).
# NOTE: Kubernetes ignores HEALTHCHECK and uses its own probes. Docker alone never restarts an
# "unhealthy" container either; the status is for you, for compose (depends_on) and for Swarm.
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/livez').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# EXEC FORM (a JSON array), never the shell form "CMD npm start":
#  - npm and the shell would sit between Docker and node, and they do not forward SIGTERM,
#    so docker stop waits 10 seconds and then SIGKILLs your server in the middle of a request.
#  - node server.js directly means node (behind tini) receives the signal and your handler runs.
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]

# ------------------------------------------------------------------------------------------------
# MEMORY. Containers are killed from outside when they pass their limit (exit code 137 = 128 + 9,
# SIGKILL, "OOMKilled"), with no JavaScript error at all. V8 has its own heap limit and reports
# "JavaScript heap out of memory" (exit code 134) when IT runs out first. Set the heap limit BELOW the
# container limit, because memory outside the heap also counts (Buffers, native code, thread stacks):
#
#   docker run --memory 512m -e NODE_OPTIONS=--max-old-space-size=384 ...
#
# A good starting point is about 75 percent of the container limit. Measure, then adjust.
# ------------------------------------------------------------------------------------------------
```

And the `.dockerignore` next to it. This is the short version; the full file with comments is `examples/_snippets/.dockerignore`. Everything listed is **not sent** to the build, which makes builds faster and keeps secrets and junk out of the image. It works like `.gitignore`, but it is a separate file:

```text
# installed INSIDE the image: your Windows or macOS node_modules would be the wrong binaries
node_modules
# built inside the image too
dist
coverage
# secrets and local settings must never end up in an image layer
.env
.env.*
!.env.example
.git
Dockerfile*
.dockerignore
**/*.test.js
```

### Why it looks like this

- **Multi-stage build.** Stage 1 and 2 are thrown away. Only the last stage becomes the image, so compilers, dev dependencies and source files do not ship. Smaller image, smaller attack surface, faster pulls.
- **Layer caching order.** Docker caches each instruction as a layer and reuses it if nothing above it changed. So put the things that change **least** first: base image, system packages, then `package.json` and `package-lock.json` plus `npm ci`, and your source code **last**. Editing a source file then does not reinstall dependencies.
- **`npm ci --omit=dev`, not `npm install`.** `npm ci` installs exactly what the lockfile says and fails if `package.json` and the lockfile disagree. That makes builds repeatable. `--omit=dev` leaves out dev dependencies.
- **Non-root user.** `USER node` (the official image already has it). If someone breaks into the app, they are not root in the container. On plain Linux a non-root user cannot listen on ports below 1024, so use 3000 or similar (some container runtimes relax this rule, but do not depend on it).
- **`.dockerignore`.** Keeps `node_modules` from your machine (wrong binaries for Linux), `.env` files, `.git` and tests out of the build. Without it, secrets can end up inside image layers.
- **Exec form `CMD ["node", ...]`**, never `CMD npm start`. With `npm start`, `npm` and a shell sit between Docker and your process and do not pass `SIGTERM` on. `docker stop` then waits 10 seconds and `SIGKILL`s a server in the middle of a request.
- **`NODE_ENV=production`** in the final stage only (section 5, trap 3).

### PID 1 and signal forwarding

The first process in a container has **process id 1**. On Linux, PID 1 is special: the kernel does not apply the default "terminate" action to signals it has no handler for, and it is responsible for cleaning up orphaned child processes ("zombies"). Node was not written for that role. The official docker-node guide warns that Node as PID 1 does not respond to `SIGINT` and similar signals as you expect unless your code handles them.

Two fixes, use one of them:

1. Run with `docker run --init` (Docker adds a tiny init program called **tini**), or `init: true` in compose.
2. Put tini in the image (`apk add tini`, `ENTRYPOINT ["/sbin/tini", "--"]`) as the Dockerfile above does.

And always handle `SIGTERM` in your code (section 11): even with tini, nothing happens gracefully unless your app does it.

### Which base image?

| Base | What it is | Good | Watch out |
|---|---|---|---|
| `node:24` (full) | Debian with build tools | Compiling native modules | Large. Use it in a build stage only |
| `node:24-slim` | Small Debian (glibc) | Works with almost every npm package. Safe default | A bit larger than Alpine |
| `node:24-alpine` | Alpine Linux (musl libc, BusyBox) | Very small, quick to pull | Some prebuilt native modules are built for glibc and fail or behave differently on musl. DNS and memory allocator behaviour can differ from glibc |
| distroless (`gcr.io/distroless/nodejs...`) | Node and C libraries only. **No shell, no npm, no curl** | Smallest attack surface | Hard to debug (`docker exec` has no shell). Health checks need `node healthcheck.js`. See `examples/_snippets/Dockerfile.distroless` |

Pin the major version (`node:24-alpine`), and for strict reproducibility pin the digest too. Never use `latest`. Pick a supported release line: as of November 2026 Node 26 is Active LTS, Node 24 and 22 are Maintenance LTS, and Node 20 and 18 are end of life (no more security fixes). The examples here were tested on 24, so `24` is used in the templates; change the number to the line your team supports. Rebuild regularly to get security patches, and scan the image in CI (section 17).

### HEALTHCHECK and memory

- `HEALTHCHECK` lets Docker mark a container `healthy` or `unhealthy`. Slim images have no `curl`, so the example uses Node's built-in `fetch`. Docker alone does not restart an unhealthy container, and Kubernetes ignores `HEALTHCHECK` completely and uses its own probes (section 15).
- **Memory limits.** `docker run --memory 512m` is a hard ceiling: above it, the kernel kills the container with `SIGKILL` (exit code **137**, which is 128 + 9; Kubernetes shows `OOMKilled`) and your code gets no error to catch. V8 has its own heap limit. When V8 runs out first, the process aborts with "JavaScript heap out of memory" and exit code **134** (checked on Node 24: `--max-old-space-size=40` with a leak gives 134). The heap is only part of the memory (Buffers, native code, thread stacks count too), so set `--max-old-space-size` **below** the container limit, about 75 percent as a starting point:

```bash
docker run --memory 512m -e NODE_OPTIONS=--max-old-space-size=384 myapp:1.0.0
```

Node 24.16 also has `--max-old-space-size-percentage=<n>`, which sets the heap limit as a percentage of system memory instead of a fixed number of megabytes. On the Windows test machine (about 16 GB of memory), `--max-old-space-size-percentage=50` gave a V8 heap limit of about 8226 MiB (read with `v8.getHeapStatistics().heap_size_limit`, which includes the young generation), so there it follows the machine's total memory. What it uses inside a Linux container with a memory limit (the limit or the host's memory) was **not tested** here. Check it in your own container before you rely on it:

```bash
docker run --rm --memory 512m node:24-alpine node --max-old-space-size-percentage=75 -e "console.log(require('v8').getHeapStatistics().heap_size_limit)"
```

> **Interview tip:** the three questions that separate people who used Docker from people who understand it: "why `npm ci` and not `npm install`?", "why exec form and what is PID 1?", "why copy `package.json` before the source code?"

## 15. Kubernetes in plain words

**Kubernetes** (K8s) is a system that runs containers on a group of machines and keeps them in the shape you describe. You write what you **want** (3 copies of this image, with these limits), and Kubernetes keeps making it true: it restarts what dies, replaces what is old, and moves work away from failed machines. Full manifests: `examples/_snippets/k8s-deployment.yaml`.

| Object | Plain meaning |
|---|---|
| **Pod** | One or more containers that run together. The smallest unit. Usually one Node container |
| **Deployment** | "Keep N identical pods running", and update them gradually when the template changes |
| **ReplicaSet** | The thing a Deployment creates for one version. It keeps the pod count right. You rarely touch it |
| **Service** | One stable address that spreads traffic over the **ready** pods |
| **Ingress** | Routes outside traffic (host names, paths, TLS) to Services. It plays the role of the reverse proxy in section 16. (The Ingress API itself stays, but the popular community "ingress-nginx" controller was retired in March 2026 and the Gateway API is the usual successor, so check which controller your cluster uses) |
| **ConfigMap** | Non-secret settings, given to pods as environment variables or files |
| **Secret** | Sensitive settings, same delivery. Only base64, not encrypted by default |
| **HorizontalPodAutoscaler (HPA)** | Changes the number of pods based on measured use |
| **PodDisruptionBudget** | "Never take more than this many pods away at once" during planned maintenance |
| **Namespace** | A named folder that groups objects (for example `staging` and `production`) |

### Probes, requests and limits

This is the part of the Deployment that matters most for a Node developer:

```yaml
# REQUESTS = what the scheduler reserves for you (used to decide which machine the pod goes to).
# LIMITS   = a hard ceiling. Going over the memory limit means the container is killed (OOMKilled, exit 137).
# A CPU limit throttles the process instead of killing it, and throttling shows up as event loop lag.
# Many teams set a CPU request but no CPU limit for Node services. Measure before you decide.
resources:
  requests:
    cpu: 250m              # a quarter of one core
    memory: 384Mi
  limits:
    memory: 512Mi

# STARTUP: "has the app finished starting?" The other probes wait until this passes once.
startupProbe:
  httpGet: { path: /startupz, port: 3000 }
  periodSeconds: 2
  failureThreshold: 30     # up to 60 seconds to start
# READINESS: "send me traffic?" A failure removes the pod from the Service. The pod is NOT restarted.
readinessProbe:
  httpGet: { path: /readyz, port: 3000 }
  periodSeconds: 5
  timeoutSeconds: 2
  failureThreshold: 2
# LIVENESS: "is the process stuck?" A failure RESTARTS the container. Keep it simple, never check the database.
livenessProbe:
  httpGet: { path: /livez, port: 3000 }
  periodSeconds: 10
  timeoutSeconds: 2
  failureThreshold: 3

# On shutdown Kubernetes removes the pod from the Service and sends SIGTERM at about the same time.
# Load balancers need a few seconds to notice, so wait a little before the app starts closing.
# (Needs a `sleep` command in the image. An app-level readiness delay, as in example 05, does the same job.)
lifecycle:
  preStop:
    exec:
      command: ["sleep", "5"]
```

- **Probes** are the three health checks of section 10. Kubernetes calls the HTTP paths you give it.
- **Requests** are what the scheduler **reserves** for the pod; they decide which machine it lands on, and they are the base for autoscaling percentages. **Limits** are a hard ceiling. Over the **memory** limit: the container is killed (`OOMKilled`, exit 137). Over the **CPU** limit: it is **throttled** (slowed down), not killed, and throttling shows up as event loop lag. Many teams set a CPU request but no CPU limit for Node services, and always a memory request equal to the limit. Measure before you decide.
- **Autoscaling.** The HPA rule is `desired = ceil(current * measured / target)`. With 3 pods at 90% CPU and a target of 70%, it asks for `ceil(3 * 90 / 70)` = 4 pods. The percentage is relative to the CPU **request**, so without a request there is nothing to scale on.
- **Rolling update.** `maxUnavailable: 0` and `maxSurge: 1` mean: start one new pod, wait until it is **ready**, then stop one old pod, and repeat. Readiness probes make this safe; graceful shutdown makes the stopping part invisible.

### ConfigMap and Secret: how the settings arrive

This is how the validated config of section 3 gets its input in a cluster. Kubernetes puts the values into the environment of the container, and `loadConfig(process.env)` checks them at startup (an excerpt of the same file):

```yaml
envFrom:
  - configMapRef:
      name: orders-api-config      # every key becomes an environment variable: NODE_ENV, LOG_LEVEL, ...
env:
  - name: DATABASE_URL             # one value picked from a Secret
    valueFrom:
      secretKeyRef:
        name: orders-api-secrets
        key: DATABASE_URL
```

The gotcha: environment variables are read **when the container starts**. Editing a ConfigMap or a Secret does not change a pod that is already running. Roll the Deployment so new pods start with the new values (`kubectl rollout restart deployment/orders-api`). Values mounted as **files** are refreshed after a delay, but your code then has to re-read the file.

### What happens when a pod is stopped

```text
 1. Kubernetes marks the pod "Terminating" and removes it from the Service's list (a few seconds to spread)
 2. The preStop hook runs (here: sleep 5 seconds, so the traffic has time to move away)
 3. SIGTERM is sent to your process  ->  your graceful shutdown starts (section 11)
 4. After terminationGracePeriodSeconds (default 30) without exit: SIGKILL
```

So `terminationGracePeriodSeconds` must be larger than `preStop` time + your own shutdown timeout. In the manifest: 40 > 5 + 20.

> **Interview tip:** "We get a few 502s on every rolling update. Why?" Strong answer: steps 1 and 3 happen at about the same time, so for a moment the load balancer still sends requests to a pod that has already started closing. Fix it by waiting a few seconds before closing (a `preStop` sleep or the readiness delay of example 05), by closing idle keep-alive connections, and by giving the pod a grace period longer than the wait plus the drain.

### Commands you will use

```bash
kubectl get pods                         # what is running, how often it restarted
kubectl describe pod <name>              # events: why it is Pending, OOMKilled, failing probes
kubectl logs <name> --previous           # the logs of the container that just crashed
kubectl rollout status deployment/orders-api   # waits until the update is done or fails
kubectl rollout undo deployment/orders-api     # roll back to the previous version
kubectl top pod                          # live CPU and memory use
```

Typical statuses: `CrashLoopBackOff` (the container keeps exiting, check `logs --previous` and the exit code), `OOMKilled` (memory limit), `ImagePullBackOff` (wrong image name or no access), `Pending` (no machine has enough free requests).

## 16. A reverse proxy in front of Node

A **reverse proxy** is a server that receives requests from the internet and forwards them to your app. **nginx** is the classic one. Cloud load balancers and Kubernetes Ingress controllers do the same job. Why put one in front of Node?

- **TLS termination.** **TLS** is the encryption behind `https`. The proxy holds the certificate, does the encryption work, and talks plain `http` to Node on the private network. Certificate renewal stays out of your app.
- **Compression (gzip).** Text responses (HTML, JSON, CSS) shrink a lot when compressed before they cross the network, but compressing costs CPU. Better on nginx than on the one thread that runs your JavaScript.
- **Static files.** Images, CSS and bundles are served straight from disk with long cache headers. Node never sees those requests.
- **Rate limits.** Slow down abusive clients before they reach your code.
- **Slow clients.** The proxy absorbs clients with slow connections, so your Node workers are free.
- **One entrance for many apps**, security headers, request size limits, and zero-downtime switching between versions.

The full config is in `examples/_snippets/nginx.conf`:

```nginx
# SNIPPET, not executed. nginx as a reverse proxy in front of a Node.js app on 127.0.0.1:3000.
# Put it in /etc/nginx/conf.d/orders-api.conf (it lives inside nginx's http { } block) and run: nginx -t && nginx -s reload

# --- Where the Node processes are. keepalive reuses connections to the app instead of opening one per request.
upstream node_app {
    server 127.0.0.1:3000;
    keepalive 32;
}

# --- Rate limiting: a shared 10 MB memory zone, counted per client IP, 10 requests per second on average.
limit_req_zone $binary_remote_addr zone=per_ip:10m rate=10r/s;

# --- WebSocket upgrade support: send "Connection: upgrade" only when the client asked for an upgrade.
# Otherwise send NO Connection header (an empty value removes it), so keepalive to Node keeps working.
map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      '';
}

# --- Port 80: do nothing except send everybody to https.
server {
    listen 80;
    server_name example.com;
    return 301 https://$host$request_uri;
}

# --- Port 443: TLS ends HERE. Between nginx and Node the traffic is plain http on the same machine or private network.
server {
    listen 443 ssl;
    http2 on;                      # nginx 1.25.1 and newer. On older versions write: listen 443 ssl http2;
    server_name example.com;

    ssl_certificate     /etc/letsencrypt/live/example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;

    server_tokens off;             # do not announce the nginx version
    client_max_body_size 1m;       # reject big request bodies before they reach Node (413)

    # --- What the app needs to know about the real request. Set once here; both locations below inherit them.
    proxy_http_version 1.1;                                        # required for upstream keepalive
    proxy_set_header Connection $connection_upgrade;               # "upgrade" for WebSockets, nothing otherwise
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Host $host;                                   # the host name the browser used
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;   # APPENDS the client address to what the client sent
    proxy_set_header X-Forwarded-Proto $scheme;                    # "https": the app cannot see that by itself
    proxy_read_timeout 60s;                                        # how long to wait for the app to answer

    # --- Compression. nginx does it so Node's single thread does not have to. HTML is always compressed when gzip is on.
    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_vary on;
    gzip_types text/plain text/css text/javascript application/javascript application/json image/svg+xml;

    # --- Static files: served by nginx directly, Node never sees these requests.
    location /assets/ {
        alias /var/www/orders-api/public/assets/;
        expires 1y;
        # A location that has its own add_header does NOT inherit the ones from the server block above.
        add_header Cache-Control "public, immutable";   # file names contain a content hash, so they never change
        access_log off;
    }

    # --- The API: rate limited, then proxied.
    location /api/ {
        limit_req zone=per_ip burst=20 nodelay;          # allow a burst of 20 extra requests, then answer 429
        limit_req_status 429;
        proxy_pass http://node_app;
    }

    # --- Everything else, including WebSocket connections.
    location / {
        proxy_pass http://node_app;
    }
}

# (The full file ends with notes on the Node side: trust proxy and keep-alive timeouts. Both are explained below.)
```

Reading it from the top: `upstream` names the Node processes and reuses connections to them; `limit_req_zone` defines the rate limit (per client IP, 10 requests per second on average); port 80 only redirects; port 443 holds the certificate (**TLS ends here**) and the `proxy_set_header` lines that tell Node who the real client is; then compression, static files with a one-year cache (safe because the file names contain a content hash), and the API location with the rate limit and `proxy_pass`. nginx limits per IP address. A limit per user or per API key has to be done in the app or in an API gateway.

### "Trust proxy": who is the real client?

Behind a proxy, every TCP connection to Node comes from the proxy. So `req.socket.remoteAddress` is the proxy's address, and the connection looks like plain `http` even if the browser used `https`. The proxy tells you the truth in headers: `X-Forwarded-For` (client address) and `X-Forwarded-Proto` (`https`). The nginx line `$proxy_add_x_forwarded_for` **appends** the address of the machine that connected to nginx to whatever the client already sent.

The problem: **anyone can send these headers.** A client can send `X-Forwarded-For: 6.6.6.6` and, if you believe the first entry, you "see" a different person. This breaks rate limits, IP allow-lists and audit logs.

The rule: believe the headers **only from proxies you control**, and count from the **right** (the end that your own proxy wrote). Express calls this `trust proxy`. The number is how many proxies of yours sit in front of the app.

```js
// Needs: npm install express  (illustrative)
app.set('trust proxy', 1); // exactly one proxy of ours (nginx) sits in front of this app
// now req.ip, req.protocol, req.secure and req.hostname use the forwarded headers
```

Setting `trust proxy` to `true` means "believe the left-most entry" in Express, which a client can forge. Use a number or a list of proxy addresses. Fastify has a `trustProxy` option that works the same way. Example `examples/07-trust-proxy.js` has a tiny proxy and an app with the same rule written by hand:

```js
function clientIp(req, trustedHops) {
  const chain = addressChain(req);
  return chain[Math.min(trustedHops, chain.length - 1)];
}
```

The chain is `[socket address, ...X-Forwarded-For read from the right]`. Skip as many entries as you have trusted proxies; the next one is the client. (All demo clients really come from `127.0.0.1`, so the proxy pretends that the browser had the documentation address `203.0.113.9`.)

```text
1. Straight to the app, no proxy
   X-Forwarded-For the app received : null
   trust 0 proxies (default)        : 127.0.0.1
   trust 1 proxy                    : 127.0.0.1
   naive "first entry" rule         : 127.0.0.1
   protocol, no trust / with trust  : http / http
2. Through the proxy, honest client
   X-Forwarded-For the app received : 203.0.113.9
   trust 0 proxies (default)        : 127.0.0.1
   trust 1 proxy                    : 203.0.113.9
   naive "first entry" rule         : 203.0.113.9
   protocol, no trust / with trust  : http / https
3. Through the proxy, client sends a forged "X-Forwarded-For: 6.6.6.6"
   X-Forwarded-For the app received : 6.6.6.6, 203.0.113.9
   trust 0 proxies (default)        : 127.0.0.1
   trust 1 proxy                    : 203.0.113.9
   naive "first entry" rule         : 6.6.6.6
   protocol, no trust / with trust  : http / https
4. Straight to the app (port exposed by mistake), forged header, trust 1 is fooled
   X-Forwarded-For the app received : 6.6.6.6
   trust 0 proxies (default)        : 127.0.0.1
   trust 1 proxy                    : 6.6.6.6
   naive "first entry" rule         : 6.6.6.6
   protocol, no trust / with trust  : http / http
```

- Case 2: through the proxy, the right answer is `203.0.113.9` with one trusted proxy. With no trust you get the proxy's own address.
- Case 3: the client forged `6.6.6.6`. The app received `6.6.6.6, 203.0.113.9`. "Trust 1 proxy" still gives the real address. The naive "first entry" rule is **fooled**.
- Case 4: someone reached the app **directly** (its port was exposed by mistake) with a forged header, and now even "trust 1" is fooled. So the second rule: **only the proxy may reach the Node port** (firewall, private network, `listen` on `127.0.0.1`).

### Timeouts: slow clients, keep-alive and the random 502

A connection costs memory and a socket even when nothing happens on it. If a client may stay slow forever, a few hundred slow clients can use up all your connections (the **slowloris** attack). So Node's HTTP server has timeouts. These are the ones to know, with their real defaults on Node 24:

| Setting | Default | What it limits |
|---|---|---|
| `server.headersTimeout` | 60 000 ms | Time to receive the complete request headers |
| `server.requestTimeout` | 300 000 ms | Time to receive the complete request (headers and body). It does **not** limit how long your handler runs |
| `server.keepAliveTimeout` | 5 000 ms (plus `keepAliveTimeoutBuffer`, 1 000 ms) | How long an idle keep-alive connection stays open |
| `server.timeout` | 0 (off) | Socket inactivity. Off by default, so a handler that never answers is never cut |
| `server.connectionsCheckingInterval` | 30 000 ms | How often Node looks for requests that are too late |

Example `examples/13-server-timeouts.js` prints the defaults, then shrinks the timeouts to a few hundred milliseconds and attacks its own server with a raw TCP client:

```text
1. The defaults of an http.Server (milliseconds)
   keepAliveTimeout            : 5000
   keepAliveTimeoutBuffer      : 1000
   headersTimeout              : 60000
   requestTimeout              : 300000
   timeout                     : 0
   connectionsCheckingInterval : 30000
2. A client that sends its headers too slowly (the "slowloris" attack)
   server answered       : HTTP/1.1 408 Request Timeout
   waited at least 200 ms: true (headersTimeout)
3. A client that promises 100 bytes of body, sends 3, and stops
   server answered       : HTTP/1.1 408 Request Timeout
   waited at least 400 ms: true (requestTimeout)
4. An honest client that is idle after a normal request (keep-alive)
   first line            : HTTP/1.1 200 OK
   Keep-Alive header     : timeout=1 (the server announces how long it waits)
   hung up after about 1 s of silence: true
5. The other direction: calling a server that never answers
   the call failed with  : TimeoutError
   it gave up in time    : true
```

- Parts 2 and 3: the server answers `408 Request Timeout` and hangs up on a client that is too slow, so the socket is free again. The check only runs every `connectionsCheckingInterval`, so the real cut can come a little after the limit.
- Part 4: after a normal answer, the server keeps the connection for `keepAliveTimeout` and tells the client in the `Keep-Alive` header. With the default it says `timeout=5`.
- Part 5 is the mirror image. Node never cuts a request it has fully received (`server.timeout` is 0), and an outgoing `fetch` has no timeout of its own. Give **every outgoing call** a limit: `fetch(url, { signal: AbortSignal.timeout(3000) })`. It rejects with a `TimeoutError`. A call without a limit can hang a request, and with enough hung requests the whole service, forever.

Now the **random 502**. nginx keeps idle upstream connections for 60 seconds by default; an AWS Application Load Balancer has an idle timeout of 60 seconds. Node closes an idle keep-alive connection after about 6 seconds (5 plus the 1 second buffer). If the proxy reuses a connection at the very moment Node closes it, the request fails and the user sees a sporadic **502**. Fix it from Node's side, so that Node never closes first:

```js
server.keepAliveTimeout = 65_000; // longer than the proxy's idle timeout
server.headersTimeout = 66_000;   // a little longer than keepAliveTimeout
```

> **Interview tip:** "Users sometimes get a 502 from the load balancer, with nothing in the app logs. Why?" Strong answer: the app closed an idle keep-alive connection (Node's default is about 6 seconds) that the proxy (60 seconds) still thought was open, and the proxy sent a request into a closed socket. Set Node's `keepAliveTimeout` higher than the proxy's idle timeout, and `headersTimeout` a little higher than that. Bonus: mention the slow-client timeouts above.

## 17. CI/CD: from commit to production

**CI** (continuous integration) means every change is automatically built and tested. **CD** (continuous delivery or deployment) means a tested change can be released with one step, or automatically. The steps, in order:

| Stage | What runs | Fails the pipeline when |
|---|---|---|
| 1. Install | `npm ci` | The lockfile and `package.json` disagree |
| 2. Lint and type check | ESLint, `tsc --noEmit` | Style or type errors |
| 3. Test | Unit tests, then integration tests (with a real database in a container) | A test fails |
| 4. Build | Compile, bundle, build the Docker image | The build breaks |
| 5. Scan | `npm audit`, secret scanning, image scan (Trivy or similar) | A serious known vulnerability is found |
| 6. Package and push | Tag the image with the **commit hash**, push to the registry | |
| 7. Deploy to staging | Roll out the **same image** | The rollout does not become ready |
| 8. Smoke test | A few quick requests against staging (`/readyz`, one real API call) | Any of them fails |
| 9. Approve | A person (or an automatic gate) allows production | |
| 10. Deploy to production | Rolling, blue/green or canary (section 18) | The rollout does not become ready |
| 11. Verify and roll back | Smoke test again. On failure: undo | |

The `test` job of `examples/_snippets/github-actions-ci.yml` (GitHub Actions; the other jobs are in the file):

```yaml
test:
  runs-on: ubuntu-latest
  strategy:
    matrix:
      node: [22, 24, 26]           # test every supported Node line you run or may upgrade to (22 and 24: Maintenance LTS, 26: Active LTS)
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4
      with:
        node-version: ${{ matrix.node }}
        cache: npm                  # caches ~/.npm, keyed by package-lock.json
    - run: npm ci                   # exact versions from the lockfile; fails if the lockfile is out of date
    - run: npm run lint
    - run: npm test
    - run: npm run build --if-present
    - run: npm audit --omit=dev --audit-level=high   # known vulnerabilities in production dependencies
```

Principles worth saying out loud in an interview:

- **Build once, deploy many.** The image that passed staging is the image that goes to production. Never rebuild for production. Only the environment variables differ.
- **Immutable, traceable artifacts.** Tag with the commit hash, so you always know what runs where. `latest` tells you nothing.
- **Fast feedback.** Cache `~/.npm`, run independent jobs in parallel, keep the pipeline under about 10 minutes. A slow pipeline is a pipeline people work around.
- **Test on the Node versions you run** (a matrix, such as 22, 24 and 26 in November 2026), and pin the version in the Dockerfile and in `.nvmrc` or `engines` so CI and production agree. The action versions in the file (`@v4` and so on) are examples; newer majors probably exist, so check and pin them.
- **Secrets from the CI secret store.** Never echo them. Keep deploy credentials narrow.
- **Rollback is a stage, not an afterthought.** `kubectl rollout status` fails when the new pods never become ready; the pipeline then runs `kubectl rollout undo`.

> **Interview tip:** "Describe your CI/CD pipeline." A strong answer walks the table in order, then adds the three ideas that show experience: one image built once and promoted, tagged with the commit; a scan and a smoke test as gates; and an automatic rollback when the rollout does not become ready.

## 18. Deployment strategies and zero-downtime restarts

How do you replace the old version with the new one? The four classic answers:

| Strategy | How it works | Downtime | Rollback | Cost / risk |
|---|---|---|---|---|
| **Recreate** | Stop all old, start all new | Yes, a gap | Redeploy the old version | Simple. Fine for internal tools |
| **Rolling** | Replace instances a few at a time (the Kubernetes default) | None, if readiness and shutdown are right | Roll forward or undo, takes minutes | Both versions run **at the same time**, so they must be compatible |
| **Blue/green** | Run a full second copy ("green"), test it, then switch all traffic at once at the router | None | **Instant**: switch back | Double the capacity during the switch |
| **Canary** | Send a small share of traffic (1%, 5%, 25%) to the new version, watch error rate and latency, then continue or abort | None | Fast: route 0% to it | Needs good metrics and a router that can split traffic. Limits the damage of a bad release |

### What zero downtime really needs

Zero downtime is a result, not a switch. All of these must be true:

1. **Readiness gates traffic.** A new instance gets requests only after it passes `/readyz` (section 10).
2. **Graceful shutdown.** An old instance finishes its requests before it exits (section 11), and the load balancer stopped sending new ones first.
3. **Compatible versions.** During a rolling update, old and new code run together against the same database and send requests to each other. Changes must work in both directions.
4. **Database changes in small, safe steps.** The standard recipe is **expand and contract**:
   1. *Expand:* add the new column (nullable) or table. Old code ignores it.
   2. *Deploy* code that writes both old and new, and reads the old.
   3. *Backfill* old rows into the new column.
   4. *Deploy* code that reads the new one.
   5. *Contract:* in a later release, drop the old column.
   Never rename or drop something in the same release that still needs it. Run the migration as **one separate step** before the new version rolls out (a pipeline stage or a Kubernetes Job), not at app start. Otherwise every replica tries to migrate at the same moment.
5. **No sticky state in the process.** Sessions and caches that matter live in Redis or a database, not in memory (twelve-factor VI).

Without Kubernetes, the same idea works with: PM2 cluster `pm2 reload` (one worker at a time, new worker signals `ready`), two app instances behind nginx (take one out, update it, put it back), or two systemd units on different ports. In the Node cluster module (lesson 18) the pattern is: start a new worker, wait for its `listening` event, then disconnect the old one.

**Feature flags** separate deploying code from releasing a feature: ship it switched off, turn it on for 1% of users, turn it off in seconds if it misbehaves. That is often a faster "rollback" than a redeploy.

### Rollback

Rolling back code is easy: run the previous image (`kubectl rollout undo`, or switch blue/green). Rolling back **data** is not: a migration that dropped a column cannot be undone by running old code. That is why migrations are additive and why the safe default after a bad data change is a **fix forward**. Practise rollback regularly, so that it works when you need it.

> **Interview tip:** "Blue/green or canary?" Strong answer: blue/green gives an instant switch back but needs double capacity and moves all users at once. Canary limits the damage to a small share of users but needs good metrics and a router that can split traffic. Both need backward-compatible database changes, because for a while two versions share one database.

## 19. Observability: logs, metrics and traces

**Monitoring** watches for problems you already know about ("alert me when the error rate is above 2%"). **Observability** is the ability to ask new questions about a running system without shipping new code ("why are requests from this one customer slow?"). You get it from three kinds of data, called the **three pillars**:

| Signal | What it is | Best at answering | Cost |
|---|---|---|---|
| **Logs** | Events with details, one JSON line each | "What exactly happened in this request?" | Grows with traffic and verbosity |
| **Metrics** | Numbers sampled over time (counters, gauges, histograms) | "Is something wrong, and since when?" Dashboards and alerts | Small and fixed per series. Cheap |
| **Traces** | The path of one request through many services, with timings | "Where did the time go?" | Medium. Usually sampled |

They work as a team. A **metric** alert tells you the error rate is up. A **trace** shows that the slow step is the call to the payment service. The **logs** of that service, found through the trace id or request id, show the exact error. The ids you add (section 8) are the glue between the three.

> **Interview tip:** "Logs, metrics, traces: when do you use each?" Short answer: metrics tell you **that** something is wrong (cheap, good for alerts), traces tell you **where** (which service or call), and logs tell you **why** (the exact error and its details). Add that the ids tie the three together, and that each signal has its own cost to control.

## 20. Metrics: counters, gauges, histograms, RED and USE

A **metric** is a number with a name that you record over time. The monitoring system (**Prometheus** is the most common) reads your numbers every 15 seconds or so and stores them, so you can graph them and alert on them. Prometheus **pulls**: your app exposes a page, usually `GET /metrics`, in a simple text format, and Prometheus fetches it. Three kinds of metric cover almost everything:

| Type | Behaviour | Example |
|---|---|---|
| **Counter** | Only goes up (resets to 0 when the process restarts) | `http_requests_total`, `errors_total` |
| **Gauge** | Goes up and down | `http_requests_in_flight`, memory used, queue length |
| **Histogram** | Counts observations into buckets, so you can estimate percentiles | `http_request_duration_seconds` |

**Labels** split one metric into series: `http_requests_total{method="GET",route="/users/:id",status="200"}`. A counter is meant to be used with a rate (requests per second over the last 5 minutes); the restart reset is handled by the query language.

Example `examples/08-metrics-registry.js` has a hand-written registry (about 90 lines) with these three types, the Prometheus text output, and a small server instrumented with the RED method. The instrumentation is only this:

```js
const requestsTotal = registry.counter('http_requests_total', 'Requests served, by method, route and status.', ['method', 'route', 'status']);
const duration = registry.histogram('http_request_duration_seconds', 'Request duration in seconds.', ['method', 'route'], [0.1, 0.5, 1, 2.5]);
const inFlight = registry.gauge('http_requests_in_flight', 'Requests being handled right now.');

const routeName = route ? route.name : 'unmatched'; // one label value for ALL unknown URLs
const stop = duration.startTimer({ method: req.method, route: routeName });
res.on('finish', () => {
  stop();
  requestsTotal.inc({ method: req.method, route: routeName, status: res.statusCode });
});
```

The traffic is sent one request at a time, so the order is fixed. The output (the `_sum` lines and the process gauges are in the real text too, but they change on every run, so the example does not print them):

```text
1. Send some traffic (one request at a time, so the order is fixed)
   GET /users/1       -> 200
   GET /users/2       -> 200
   GET /users/3       -> 200
   GET /users/0       -> 404
   GET /report        -> 200
   GET /report        -> 200
   GET /boom          -> 500
   GET /no/such/page  -> 404
2. What a scraper (Prometheus) reads from GET /metrics. Selected lines:
   http_requests_total{method="GET",route="/users/:id",status="200"} 3
   http_requests_total{method="GET",route="/users/:id",status="404"} 1
   http_requests_total{method="GET",route="/report",status="200"} 2
   http_requests_total{method="GET",route="/boom",status="500"} 1
   http_requests_total{method="GET",route="unmatched",status="404"} 1
   http_request_duration_seconds_bucket{method="GET",route="/users/:id",le="0.1"} 4
   http_request_duration_seconds_bucket{method="GET",route="/users/:id",le="0.5"} 4
   http_request_duration_seconds_bucket{method="GET",route="/users/:id",le="1"} 4
   http_request_duration_seconds_bucket{method="GET",route="/users/:id",le="2.5"} 4
   http_request_duration_seconds_bucket{method="GET",route="/users/:id",le="+Inf"} 4
   http_request_duration_seconds_count{method="GET",route="/users/:id"} 4
   http_request_duration_seconds_bucket{method="GET",route="/report",le="0.1"} 0
   http_request_duration_seconds_bucket{method="GET",route="/report",le="0.5"} 2
   http_request_duration_seconds_bucket{method="GET",route="/report",le="1"} 2
   http_request_duration_seconds_bucket{method="GET",route="/report",le="2.5"} 2
   http_request_duration_seconds_bucket{method="GET",route="/report",le="+Inf"} 2
   http_request_duration_seconds_count{method="GET",route="/report"} 2
   http_requests_in_flight 0
   (the *_sum lines, memory and event loop gauges are in the output too; their values change on every run)
3. The same text also describes the process itself (USE method)
   gauges present: true
4. Percentiles are estimated from buckets
   estimated p95 of GET /report: 0.4800 s (2 requests fell in the 0.1 to 0.5 s bucket)
   the answer can only be as exact as the bucket edges you chose
5. Labels and cardinality
   labelled by raw URL   : 50 series after 50 users
   labelled by route name: 5 series in total for all the traffic above (method x route x status)
   wrong label set is rejected: http_requests_total needs labels [method,route,status] but got [method]
```

How to read it:

- `http_requests_total` is the **Rate** (requests per second, from the counter) and the **Errors** (the `status` label: 404 and 500 are visible separately).
- The histogram lines are **cumulative**: `le="0.5"` means "requests that took at most 0.5 seconds". The `/report` route has 0 requests under 0.1 s and 2 under 0.5 s. This is the **Duration**.
- `http_requests_in_flight 0` is a gauge. The scrape request itself is not counted.
- The p95 of `/report` is **estimated** from the buckets (a straight line inside the bucket). It can only be as exact as your bucket edges. Choose buckets around the latencies you care about, such as your SLO threshold.

### RED and USE: which numbers to collect

Two checklists tell you what to measure, so you do not stare at 300 dashboards:

| Method | For | The three numbers |
|---|---|---|
| **RED** (Rate, Errors, Duration) | Things that serve requests: an HTTP API, a gRPC service, a queue consumer | Requests per second, how many fail, how long they take (percentiles) |
| **USE** (Utilization, Saturation, Errors) | Resources: CPU, memory, disk, network, connection pools, the event loop | How busy it is, how much work is waiting, error count |

Google's SRE book adds the **four golden signals**: latency, traffic, errors, saturation. It is RED plus saturation.

USE for a Node process: **utilization** is event loop utilization and memory used; **saturation** is event loop delay, connection pool `waiting`, and the length of job queues; **errors** are failed connections and out-of-memory kills. The example exposes the first two as gauges (`nodejs_eventloop_utilization_ratio`, `nodejs_eventloop_delay_p99_seconds`).

Rules that save you from classic mistakes:

1. **Use percentiles, not averages.** A **percentile** answers "what share of requests was faster than this?": p95 is the time that 95% of requests beat, so 5% were slower; p99 leaves 1% slower. If 99 requests take 10 ms and one takes 5 seconds, the average is about 60 ms, which looks fine, but one user in a hundred waited 5 seconds. Watch p95 and p99. Histograms also add up across instances (you add the bucket counts), while percentiles that each instance computed itself cannot be averaged into a correct overall percentile. That is a reason to export buckets and let the monitoring system calculate.
2. **Mind the cardinality.** Every distinct label combination is a separate series that costs memory and money. The last part of the example shows it: labelling by raw URL created **50 series** for 50 users, labelling by the route template created one. Never use user ids, emails, raw URLs or error messages as label values. Use the route pattern (`/users/:id`), the status class, a small fixed set of names. The example also rejects a wrong label set with an error.
3. **Name things well.** `_total` for counters, base units in the name (`_seconds`, `_bytes`), and the same names in every service.
4. **Do not expose `/metrics` to the internet.** Serve it on an internal port or behind the proxy's allow-list.
5. **Short-lived processes cannot be scraped.** A cron job or a serverless function may be gone before Prometheus asks. Such jobs push their numbers to a gateway, or send metrics straight to a vendor.

> **Interview tip:** "Which metrics would you put on a new Node API?" Strong answer: RED per route (request rate, error rate, duration histogram), USE for the process (event loop delay and utilization, memory, pool waiting), labels from route templates and not raw URLs, and alerts on user-visible symptoms. Be ready to explain why a histogram beats an average.

In real projects you use the **prom-client** package (illustrative snippet):

```js
// Needs: npm install prom-client
const client = require('prom-client');

client.collectDefaultMetrics(); // process_resident_memory_bytes, nodejs_eventloop_lag_seconds, heap sizes, GC, ...

const duration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Request duration in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1],
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});
```

## 21. Distributed tracing and OpenTelemetry

A request in a modern system touches many services. When it is slow, the question is "which step?", and no single service can answer, because each one only sees its own part. **Distributed tracing** records the whole journey.

- A **trace** is the whole journey of one request. It has a **trace id**.
- A **span** is one step inside it: an HTTP handler, a database query, an outgoing call. A span has a name, start and end time, **attributes** (key-value details such as `http.route` or `db.system`), a **status** (ok or error), and a **parent span**. Spans form a tree.
- **Context propagation** is how the trace crosses a network. The caller puts the trace id and its own span id into a header of the outgoing request. The next service reads the header and creates its spans as children. The standard header is **W3C Trace Context**, named `traceparent`:

```text
traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
             |  |                                |                |
             |  trace id (32 hex)                parent span id   flags (01 = sampled)
             version
```

If one service forgets to forward the header, the trace breaks in two at that point. That is the most common tracing bug.

Example `examples/09-tracing-context.js` builds a small tracer by hand. The current span lives in `AsyncLocalStorage` (the same idea as the request id), `inject` writes the header before every outgoing call, and the server reads it with `parseTraceparent`. Two services, **shop** and **catalog**, run in one process but share nothing except HTTP:

```js
function getProduct(id) {
  return tracer.withSpan('HTTP GET catalog', { kind: 'client', attributes: { 'product.id': id } }, async () => {
    const reply = await fetch(`${catalogUrl}/products/${id}`, { headers: tracer.inject({}) }); // the header carries THIS span's id
    if (!reply.ok) throw new Error(`catalog answered ${reply.status}`);
    return reply.json();
  });
}
```

```text
1. The header
   traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01
   parsed     : { traceId: '4bf92f3577b34da6a3ce929d0e0e4736', parentSpanId: '00f067aa0ba902b7', sampled: true }
   garbage    : null
2. One checkout request. Eleven spans in two services, all in the same trace:
   shop: GET /checkout [server]
     shop: validate cart [internal]
     shop: HTTP GET catalog [client]  product.id=1
       catalog: GET /products/:id [server]  product.id=1
         catalog: db.query [internal]  db.system=postgres
     shop: HTTP GET catalog [client]  product.id=2
       catalog: GET /products/:id [server]  product.id=2
         catalog: db.query [internal]  db.system=postgres
     shop: HTTP GET catalog [client] ERROR  product.id=0
       catalog: GET /products/:id [server]  product.id=0
         catalog: db.query [internal]  db.system=postgres
   spans in this trace   : 11
   same trace id on all  : true
   failed spans          : [ 'shop: HTTP GET catalog' ]
   db.query lasted >= 14 ms: true
3. A caller (a browser, another team's service) already started a trace: we continue it
   our root span uses the caller's trace id: true
   our root span's parent is the caller's span: true
4. Sampling: the first service decides, everybody else obeys the flag
   spans recorded when the flag is 00: 0
```

The tree shows what a tracing UI draws as a waterfall: the checkout span contains the cart validation and three calls to the catalog. Each client span (in **shop**) has the catalog's server span as a child, which has the `db.query` span as its child. The two product calls ran in parallel, the third failed and its span is marked `ERROR`, while the checkout itself survived. All 11 spans share one trace id, even though they were created in two services.

Parts 3 and 4 of the output show two more rules:

- **Continue an existing trace.** If the incoming request already has a `traceparent`, use its trace id and make its span your parent.
- **Sampling.** Recording every trace is expensive. The first service decides (**head-based sampling**: keep 10%, for example) and writes the decision into the flags (`01` or `00`). Every other service obeys it, so you never get half a trace. The alternative is **tail-based sampling**: collect everything for a short time, then keep the slow and failed traces (done in a collector).

### OpenTelemetry

**OpenTelemetry** (OTel) is the open standard and the set of libraries that does what the example does, for real: it creates spans automatically for `http`, `fetch`, Express, `pg`, Redis and many more, propagates the context, and exports the data in a vendor-neutral format (**OTLP**) to a **collector** or straight to a backend (Jaeger, Grafana Tempo, Datadog, and others). Pieces to name in an interview:

| Piece | Job |
|---|---|
| **API** (`@opentelemetry/api`) | What your code calls to make spans. Safe to use in libraries (does nothing without an SDK) |
| **SDK** (`@opentelemetry/sdk-node`) | The implementation: sampling, processing, exporting |
| **Instrumentations** | Patches for common libraries that create spans for you |
| **Exporter** | Sends spans somewhere (OTLP over HTTP or gRPC) |
| **Collector** | A separate process that receives, filters, samples and forwards telemetry |
| **Resource** | Who produced the data: `service.name`, version, environment |

The file `examples/_snippets/otel-tracing.js` is a bootstrap you would load with `node --require ./otel-tracing.js dist/server.js`. Things that go wrong:

- **It must load first.** Instrumentation works by patching modules such as `http` at the moment they are loaded. If your app imports them before the SDK starts, there are no spans. That is why it is loaded with `--require` (or `NODE_OPTIONS`) and not from the middle of `server.js`. ES modules need a different loader hook, so read the current documentation for your Node version.
- **Flush on exit.** Spans leave in batches. Without a flush at the end of your shutdown, the last seconds of traces are lost (the snippet uses `beforeExit`).
- **Cost.** Sample. Many teams keep 1% to 10% of normal traces and 100% of errors.
- **Link logs and traces.** Put `trace_id` and `span_id` in every log line (read them from the current span). Then a trace in the UI links to its logs, and a log line links to its trace.
- **Configuration through environment variables**, so no code changes between environments: `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_TRACES_SAMPLER`.

> **Interview tip:** "How does a trace follow a request across services?" Strong answer: each outgoing call carries the `traceparent` header (trace id, parent span id, sampling flag). The next service continues the same trace with its own spans as children. Inside a service the current span travels in `AsyncLocalStorage`. The most common bug is a hop that does not forward the header, which splits the trace in two.

## 22. Error tracking, alerting and SLOs

### Error tracking

Logs record that an error happened. An **error tracker** (Sentry, Rollbar, Bugsnag, Datadog and others) adds what logs cannot do well: it **groups** the same error from thousands of events into one issue, counts how many users it hit, shows when it first appeared and which release introduced it, maps minified stack traces back to your source with **source maps**, and alerts on new or returning issues. Illustrative snippet:

```js
// Needs: npm install @sentry/node
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN, // the address to send errors to
  environment: process.env.DEPLOY_ENV, // staging or production
  release: process.env.GIT_SHA, // lets the tool say "this started with release abc123"
});

// ... in your top-level error handling (lesson 14): report, then flush BEFORE the process exits
process.on('uncaughtException', async (err) => {
  Sentry.captureException(err);
  await Sentry.flush(2000); // wait up to 2 seconds for the report to leave
  process.exit(1);
});
```

Remember to scrub personal data, set `release` and `environment` so reports are filterable, and flush before exiting (an error report that never leaves the machine helps nobody).

### Alerting

An **alert** wakes a human. The rule that matters: **alert on symptoms users feel, not on causes.**

| Good alert (symptom) | Weak alert (cause) |
|---|---|
| Error rate above 2% for 5 minutes | CPU above 80% |
| p99 latency above 1 second for 10 minutes | One pod restarted |
| The SLO error budget is burning 14 times too fast | Memory above 70% |

High CPU with happy users is not an emergency. Low CPU with failing checkouts is. Keep causes on dashboards for diagnosis. Every page should be **urgent, actionable and new**, and link to a **runbook** (a short document: what this alert means, how to check, how to fix). Too many alerts lead to **alert fatigue**, and then the real one is ignored. Anything that can wait until the morning is a ticket, not a page.

### SLI, SLO and the error budget

- **SLI** (service level indicator): a measured number about the service, as a ratio of good events to all events. Example: the share of requests that returned non-5xx **and** took under 300 ms.
- **SLO** (service level objective): your internal target for the SLI, over a window. Example: 99.9% over 30 days.
- **SLA** (service level agreement): a promise to customers, usually with money attached if broken. Set the SLO stricter than the SLA.
- **Error budget**: what the SLO allows to fail. For 99.9% it is 0.1% of requests or time. In a 30-day window (43,200 minutes):

| SLO | Allowed downtime per 30 days |
|---|---|
| 99% | 7.2 hours (432 minutes) |
| 99.9% | 43.2 minutes |
| 99.95% | 21.6 minutes |
| 99.99% | 4.32 minutes |

The budget turns arguments into numbers. While there is budget left, ship features and take risks. When it is used up, the team slows down and fixes reliability. **Burn rate** is how fast you spend it: a burn rate of 1 uses exactly the whole budget in the window. A common alert pages when the burn rate is 14.4 or more over the last hour (at that speed one hour spends 14.4 / 720 = 2% of a 30-day budget) and files a ticket for a slow burn of 1 over several days.

> **Interview tip:** the sentence "we alert on SLO burn rate, not on CPU" shows you understand modern operations. Be ready to compute the downtime of 99.9% (43.2 minutes per 30 days).

## 23. Capacity and cost thinking

Questions a senior engineer asks before launch: "How many requests per second can one instance handle? How many instances do we need at peak? What breaks first? What does it cost?"

**Measure, do not guess.** Run a load test (tools such as `autocannon` or `k6`, third-party) against a production-like environment and increase the load until latency climbs steeply: that point is the **knee**. Stay well below it.

Worked example, with numbers you can redo:

1. One request costs **8 ms** of CPU on the event loop (measured with a profile or from CPU time divided by requests).
2. One Node process uses about one core for its JavaScript, so its maximum is `1000 / 8 = 125` requests per second.
3. Plan for **60 percent** utilization, leaving room for bursts, garbage collection and the cost of one failing pod: `125 * 0.6 = 75` requests per second per pod (one core each).
4. Peak traffic is **900** requests per second: `900 / 75 = 12` pods. Add one so a single failure does not overload the rest: **13**.
5. **Check every other limit.** 13 pods with a database pool of 10 are 130 connections, but the database might allow 100 (example 11). Memory: 13 times 512 MB. Downstream APIs may have rate limits.

**Little's law** helps with concurrency: `requests in flight = arrival rate * average latency`. At 300 requests per second and 100 ms latency, about 30 requests are in flight at any moment. If the database slows down and latency rises to 1 s, the same traffic means 300 in flight: pools fill and memory grows. That is how a slow dependency becomes an outage.

Node specifics: scale **out** (more processes or pods), because one process uses one core for JavaScript; the CPU-heavy work belongs in worker threads (lesson 18); memory per instance is mostly the heap plus Buffers; the thread pool (4 threads by default) limits parallel file, DNS and crypto work.

Cost levers:

- **Right-size** requests and limits: compare what pods ask for with what they really use.
- **Autoscale in as well as out**, so you do not pay for idle pods at night.
- **Cheaper interruptible machines** for stateless pods. Your graceful shutdown (section 11) makes that safe.
- **Compress responses and cache at the edge**, so fewer requests reach your pods.
- **Hidden costs**: log volume, metric series (cardinality), traces, and data leaving the cloud.

Compute a **cost per 1,000 requests** now and then, so cost is a number you can discuss.

> **Interview tip:** "How many servers do you need for 900 requests per second?" Do not guess a number. Say how you would get it: measure the CPU time per request, divide to get the maximum per process, plan for about 60% utilization, add one spare, and then check every other limit (database connections, memory, downstream rate limits). Showing the steps matters more than the final number.

## 24. Serverless Node

**Serverless functions** (AWS Lambda, Google Cloud Functions, Azure Functions) run your code on demand, without you managing servers. You write a **handler**, upload it, and the platform starts containers when requests arrive and stops them when they stop. You pay per invocation and per millisecond. AWS Lambda is the usual interview example.

The shape of a Node handler (from `examples/_lambda-handler.js`):

```js
const state = { connectionsCreated: 0, invocations: 0 };

function connectToDatabase() {
  state.connectionsCreated++; // in real life: a TCP connection and a login, tens of milliseconds
  return { query: async (sql) => ({ rows: [{ sql }] }) };
}

const db = connectToDatabase(); // created once, shared by every invocation in this container

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

exports.handler = async (event, context) => {
  state.invocations++;
  const method = event.requestContext?.http?.method ?? 'GET';
  const path = event.rawPath ?? '/';
  // ... route on method and path, call db.query(...), return json(200, {...})
};
```

Two phases matter:

- **Init phase**: the code outside the handler. It runs **once per container**, on a **cold start**, before the first request. Put expensive reusable setup here: SDK clients, a database connection, parsed config.
- **Handler**: runs once per request. `event` describes the request (here the API Gateway HTTP API format 2.0: `rawPath`, `requestContext.http.method`, `body`, `isBase64Encoded`), and `context` describes the invocation (`getRemainingTimeInMillis()`, request id). The return value is the response: `{ statusCode, headers, body }`. Use an `async` handler.

Example `examples/12-lambda-shape.js` pretends to be the Lambda runtime. It loads the handler module again to start a "container", and calls the handler for each request:

```text
1. Cold start: the first request pays for the INIT phase, the next ones do not
   container A started, connections created so far: 1
   request 1 -> 200 {"path":"/orders","invocationInThisContainer":1,"msLeft":true}
   request 2 -> 200 {"path":"/orders","invocationInThisContainer":2,"msLeft":true}
   request 3 -> 200 {"path":"/orders","invocationInThisContainer":3,"msLeft":true}
   container A stats: { connectionsCreated: 1, invocations: 3 }
2. Scaling out: a second container starts from zero and opens its OWN connection
   container B first request -> {"path":"/orders","invocationInThisContainer":1,"msLeft":true}
   container B stats: { connectionsCreated: 1, invocations: 1 }
   50 containers at once = 50 database connections. Use a connection proxy or a small pool per container.
3. Event and response shapes
   JSON body        -> 201 {"saved":"book","rows":1}
   base64 body      -> 201 {"saved":"pen","rows":1}
   broken JSON body -> 500 Expected property name or '}' in JSON at position 1 (line 1 column 2)
4. The timeout is a hard stop
   /slow with a 100 ms limit -> 500 Task timed out after 0.10 seconds
```

What it teaches:

- **Cold start vs warm start.** The first request of container A paid for the init (one connection created). Requests 2 and 3 reused it (`invocations: 3`, still one connection). A **warm** container is reused for later requests, so module-level variables survive. Use that for caches and connections, never for per-user data.
- **Scaling means more containers**, and each container handles **one request at a time**. Container B starts from zero and opens its own connection. A traffic spike of 200 concurrent requests can mean 200 containers and 200 database connections. Use a connection proxy (such as RDS Proxy) or an HTTP-based data API, and keep the pool per container at 1 or 2.
- **Timeouts are hard.** The default Lambda timeout is 3 seconds (the maximum is 15 minutes). When the time is up the invocation is cut. Pass `context.getRemainingTimeInMillis()` to slow calls, so you can give up in time.
- **A failing handler becomes a 500**, as the broken JSON body shows.

Cold start costs (tens to hundreds of milliseconds, more for big bundles) come from downloading the code, starting the runtime and running your init code. Ways to reduce them: a **small bundle** (bundle with esbuild, avoid importing whole SDKs), lazy-load rarely used modules inside the handler, keep init work light, give the function more memory (CPU grows with it), and, if it matters, pay for **provisioned concurrency** (kept-warm containers).

Other points interviewers like:

- **No background work after returning.** When the handler returns, the container is frozen. A promise you did not await may never finish. `await` everything.
- **Retries and idempotency.** Asynchronous invocations are retried on error, so the same event can arrive twice. Make handlers idempotent (safe to run twice).
- **Logs** go to the platform's log service from `console` output. JSON lines work well there too. Add the request id from `context.awsRequestId`.
- **When it fits:** spiky or low traffic, event processing, glue code. **When it does not:** steady high traffic (a container is cheaper), long-lived connections such as WebSockets, strict low latency without provisioned capacity.
- Check the current limits (package size, memory range, timeout) and supported Node runtimes in the provider's documentation. They change.

> **Interview tip:** "What is a cold start and how do you reduce it?" Strong answer: the first request to a new container pays for downloading the code, starting the runtime and running the init code. Reduce it with a small bundle, light init work, lazy loading, more memory (more CPU), or provisioned concurrency. Mention the flip side: warm containers keep module-level state, and every container opens its own database connection.

## 25. Incidents: the first five minutes

An **incident** is when production is broken or degrading and users are affected. The first minutes decide how bad it gets. A calm checklist beats improvising:

1. **Say it out loud.** Announce the incident in the team channel and name one person who leads (the **incident commander**). Others do not start random changes.
2. **How bad is it?** Look at the RED dashboard: error rate, latency, traffic. Who is affected: everyone, one region, one customer, one endpoint? Is it getting worse?
3. **What changed?** Most incidents follow a change: a deploy, a config or feature flag change, a traffic spike, a certificate expiry, a cron job, or a problem at a provider. Check the deploy history first.
4. **Stop the bleeding before finding the cause.** Roll back the last deploy, turn off the feature flag, scale out, shed load, fail over. Diagnose after users are safe.
5. **Check the basics for this process.** Are the pods running (restarts, `OOMKilled`, `CrashLoopBackOff`)? What do the error logs say? What are the vitals: CPU, memory, event loop lag, open handles, pool use?
6. **Collect evidence before you restart.** A restart erases the state you need. From **one** affected instance (take it out of rotation first), capture a heap snapshot, a CPU profile or a diagnostic report.
7. **Communicate.** Update the status page and stakeholders every 15 to 30 minutes, even with "no news yet".
8. **Afterwards, write a blameless postmortem**: timeline, impact, root cause, what worked, what did not, and action items with owners. Blameless means you ask what in the system allowed the mistake, not who made it.

### Collecting evidence from a Node process

Three kinds of evidence are worth knowing. A **heap snapshot** is a file that lists every object in memory (use it for memory growth). A **CPU profile** records which functions used the time (use it for high CPU). A **diagnostic report** is a JSON file with the stack, the heap numbers and the open handles at one moment. Lessons 14 and 19 show how to read them. This is how you ask Node for them:

```bash
# Start the process with a flag ahead of time, so you can trigger the capture later without a restart:
node --heapsnapshot-signal=SIGUSR2 server.js   # kill -USR2 <pid> writes a .heapsnapshot file (open it in Chrome DevTools)
node --report-on-signal server.js              # kill -USR2 <pid> writes a diagnostic report (JSON: stacks, heap, handles)
node --cpu-prof --cpu-prof-dir=./profiles server.js   # a CPU profile, written when the process exits
node --heapsnapshot-near-heap-limit=3 server.js       # a heap snapshot when the heap is about to run out
```

`--report-on-signal` uses `SIGUSR2` by default, the same signal as the first command, so use one of the two at a time or change the report signal with `--report-signal`. Do not use `SIGUSR1`: Node reserves it to start the debugger. That is also a way to look inside a process that is already running, without a restart: `kill -USR1 <pid>` starts the inspector on `127.0.0.1:9229`, and you reach it through an SSH tunnel or `kubectl port-forward`. **Never** open the inspector port to the network (`--inspect=0.0.0.0`): whoever connects can run any code inside your process. Signals are a Linux and macOS tool. A heap snapshot **pauses the process** and needs extra memory (roughly the size of the heap), so take it on one instance, never on the whole fleet at once. From code, `process.report.writeReport()` writes the diagnostic report, and `require('node:v8').writeHeapSnapshot()` writes a snapshot.

A small "vitals" function gives you the numbers for step 5. Example `examples/10-vitals-and-incidents.js` builds one:

```js
const snapshot = {
  // CPU time / wall time. It can pass 100 when several threads are busy. On Windows the operating system counts
  // CPU time in coarse steps (about 15 ms), so look at windows of many seconds there.
  cpuPercent: ((cpu.user + cpu.system) / wallMicros) * 100,
  eventLoopUtilization: elu.utilization, // 0 to 1: how much of the time the loop was running JavaScript
  loopDelayP99Ms: loopDelay.percentile(99) / 1e6, // how late timers fire: the best "is the loop stuck?" number
  heapUsedMB: memory.heapUsed / MB,
  rssMB: memory.rss / MB,
  resources: countResources(), // open sockets, timers, file requests...
};
```

A snapshot has this shape (the values below are made up to show the format; real values differ on every run):

```js
{ cpuPercent: 62.4, eventLoopUtilization: 0.71, loopDelayP99Ms: 34.2, heapUsedMB: 118.6, rssMB: 187.3, resources: { TCPSocketWrap: 42, Timeout: 3 } }
```

## 26. The five classic Node problems

For each: what you see, the usual causes, how to check, and how to fix. The example `10-vitals-and-incidents.js` produces three of these symptoms on purpose (a blocked event loop, a growing heap, leaked sockets). It prints conclusions instead of raw numbers, because the numbers change on every run:

```text
1. Quiet process
   event loop delay p99 under 100 ms: true
   event loop utilization under 0.5: true
   diagnosis: nothing stands out in event loop lag
2. High CPU: a 250 ms synchronous loop inside a timer callback
   event loop delay p99 over 200 ms: true
   event loop utilization over 0.5 : true
   diagnosis: event loop saturated: some code runs for too long (high CPU%: take a CPU profile; low CPU%: look for synchronous I/O)
3. Memory growth: is the heap still big AFTER a full garbage collection?
   temporary objects: heap after GC stays near the start: true
   kept objects     : heap after GC grows every round    : true
4. Handles: connections that nobody closes
   20 connections (both ends live in this process) add 40 socket handles: true
   after closing them the count goes back down                        : true
   On Linux every socket is a file descriptor, so a leak ends with EMFILE (too many open files).
```

### 1. High CPU

- **You see:** CPU at the limit, latency up, autoscaler adding pods that do not help.
- **Usual causes:** a regular expression with catastrophic backtracking (lesson 20), `JSON.parse` or `JSON.stringify` of huge objects, synchronous crypto (`pbkdf2Sync`), big loops and sorts on the request path, too much logging, gzip in-process.
- **Check:** is it all instances or one? Since when, and what deployed then? Which route (metrics by `route`)?
- **Fix:** take a CPU profile (`--cpu-prof`, or the inspector) and read the flame graph (lesson 19). Optimize the hot path, cache, stream instead of buffering, move heavy work to worker threads (lesson 18). Scaling out is a stopgap, not a fix.

### 2. Memory growth

- **You see:** memory rising like a staircase, a pod restarted with `OOMKilled` (exit 137) or "heap out of memory" (exit 134), garbage collection taking longer.
- **Check:** is it the **heap** (`heapUsed`) or **outside** it (`rss` much bigger than `heapTotal`: Buffers, native memory)? Part 3 of the output asks the right question: **is the heap still big after a full garbage collection?** Temporary objects: no. A cache that never forgets: yes, and it grows every round. (The example needs the flag `--expose-gc` to call `gc()`: `node --expose-gc lessons/24-production-and-deployment/examples/10-vitals-and-incidents.js`. The course checker passes the flag for you.)
- **Usual causes:** unbounded caches and `Map`s, event listeners added and never removed (look for `MaxListenersExceededWarning`), module-level arrays that collect per-request data, timers never cleared, closures that hold big objects.
- **Fix:** compare two heap snapshots taken minutes apart (DevTools "Comparison" view) to see what grows. Bound the cache (size and time limit). Stopgap while you search: restart on a memory threshold (`max_memory_restart`).

### 3. Event loop lag

- **You see:** timers fire late, all requests slow down together, health probes time out and the platform restarts pods.
- **Measure:** `monitorEventLoopDelay` (p99 of the delay) and `performance.eventLoopUtilization()`. Part 2 of the output blocks the loop for 250 ms: the p99 delay is above 200 ms and utilization is above 0.5.
- **Usual causes:** CPU-heavy JavaScript, synchronous file or crypto calls, huge JSON, long garbage collection pauses. (A busy **thread pool**, which is only 4 threads by default, delays file, DNS and crypto work, while the loop itself stays responsive.)
- **Fix:** split long work into chunks that yield to the loop (`setImmediate`), use the async APIs, worker threads for CPU work, streams for big data. Alert on loop delay: it is the best "Node is struggling" metric.

### 4. Too many open files (EMFILE)

- **You see:** `Error: EMFILE: too many open files` or failing connections. Every socket and every open file uses a **file descriptor** (a number the OS gives for each open file or connection), and each process has a limit (`ulimit -n`, often 1024 for the soft limit on Linux).
- **Check:** `ls /proc/<pid>/fd | wc -l`, `lsof -p <pid>`, and `process.getActiveResourcesInfo()` in Node. Part 4 of the output counts sockets: 20 connections (both ends in one process) add 40 handles, and closing them brings the count back.
- **Usual causes:** a leak (sockets or files never closed, a new `http.Agent` created per request instead of one shared keep-alive agent), reading thousands of files at once, a flood of incoming connections.
- **Fix:** find the leak first. Reuse one agent, close streams (`pipeline` does it for you), limit concurrency. Raising the limit (`LimitNOFILE` in systemd, `--ulimit nofile` in Docker) is a safety net, not a cure.

### 5. Connection pool exhaustion

- **You see:** requests slow or time out with pool errors, **while the database looks idle**. That combination is the clue.
- **How it happens:** all pool connections are in use, so callers queue. If the connections are never returned (a missing `release` on the error path), the pool stays empty forever.

Example `examples/11-pool-exhaustion.js` has a tiny pool and shows the queue, the leak, and the fix:

```text
1. More work than connections: the extra callers wait in line
   right after starting 6 queries: { size: 2, inUse: 2, free: 0, waiting: 4 }
   all 6 finished. Most queries running at once: 2
   afterwards: { size: 2, inUse: 0, free: 2, waiting: 0 }
2. The leak: an error path that forgets release()
   nothing is running, yet: { size: 2, inUse: 2, free: 0, waiting: 0 }
   the next, perfectly fine request fails with:
     PoolTimeoutError: waited 100 ms for a connection ({"size":2,"inUse":2,"free":0,"waiting":0})
   The database looks idle, but every request waits for a connection that never comes back.
3. The fix: try/finally
   after two failures: { size: 2, inUse: 0, free: 2, waiting: 0 }
   the next request works: { size: 2, inUse: 0, free: 2, waiting: 0 }
4. The arithmetic that is done too late
   10 app instances x pool of 20 = 200 connections, the database allows 100
   safe pool size per instance for a budget of 80 (leave room for admin tools and migrations): 8
```

- Part 1: six queries, two connections, so two run and four wait in line (`waiting: 4`). Nothing is wrong, this is a pool doing its job.
- Part 2: the buggy handler skips `release()` when the query throws. After two failures, `inUse: 2` while nothing is running. The next request waits for its full timeout and fails. A **timeout on acquire** turns an invisible hang into a clear error.
- Part 3: `try/finally` fixes it. **Always release in `finally`.**
- Part 4: the arithmetic. 10 instances times a pool of 20 is 200 connections against a database that allows 100. Pool size per instance times instance count (plus admin tools and migrations) must stay below the database limit. Autoscaling makes this worse, because every new pod brings a full pool.
- **Check:** export `pool.inUse`, `pool.waiting` and the acquire time as metrics (USE method: utilization and saturation). Alert when `waiting` stays above zero.

> **Interview tip:** "The API is slow, CPU is low, and the database looks idle. What do you check?" That combination points at a wait, not at work: connection pool exhaustion (a missing `release`, or a pool smaller than the concurrency), a slow downstream call without a timeout, or a busy thread pool. Look at `pool.waiting`, the event loop delay and a trace of one slow request before touching anything.

## 27. Putting the pieces together

A production-ready `server.js` follows a fixed order. Startup, then shutdown in the same order reversed:

```text
STARTUP                                              SHUTDOWN (on SIGTERM or SIGINT)
 1. loadConfig(process.env)  (exit 1 if invalid)      1. not ready (readiness 503)
 2. create the logger (level, redaction)              2. start the hard timeout (unref, shorter than the kill timer)
 3. connect to the database, create pools             3. wait a moment for the load balancer
 4. start workers and consumers                       4. server.close(), close idle connections
 5. server.listen(port)                               5. wait for in-flight requests and jobs
 6. mark "started" (startup probe passes)             6. close pools, connections (reverse order)
 7. install signal handlers                           7. flush logs and telemetry, set process.exitCode
```

Everything in this lesson fits into that list: config (section 3), logger and request ids (6 to 8), health (10), shutdown (11 and 12), packaging and platform (13 to 16), shipping (17 and 18), and the numbers that tell you it works (19 to 22).

## 28. Production readiness checklist

Use it before a launch and in design reviews. Each item has a section number above.

**Configuration and secrets**
- [ ] All config comes from the environment and is validated at startup, with every problem reported at once (3)
- [ ] No secrets in git, images, logs or error messages. Secrets come from a secret manager and can be rotated (4)
- [ ] `NODE_ENV=production` is set explicitly. Staging uses the same value plus a separate `DEPLOY_ENV` (5)

**Logging and tracing**
- [ ] JSON logs on stdout with levels, a service name and a request id on every line (6 to 8)
- [ ] Secrets are redacted. No personal data that is not needed (7)
- [ ] The request or trace id is forwarded to every downstream call (8, 21)

**Health and lifecycle**
- [ ] Separate liveness, readiness and startup endpoints. Liveness checks no dependency (10)
- [ ] `SIGTERM` and `SIGINT` are handled: not ready, drain, close in reverse order, hard timeout shorter than the platform's kill timer, exit code, no `process.exit()` in the normal path (11, 12)
- [ ] Server timeouts are set, keep-alive is longer than the proxy's idle timeout, and every outgoing call has its own timeout (16)
- [ ] Unexpected errors (`uncaughtException`) log one structured line and exit non-zero, so the supervisor restarts the process (11)

**Packaging and platform**
- [ ] Multi-stage image, lockfile install with `npm ci --omit=dev`, non-root user, `.dockerignore`, exec-form `CMD`, an init process (14)
- [ ] Image tagged with the commit, not `latest`, and scanned (14, 17)
- [ ] Memory limit set, and `--max-old-space-size` below it (14, 15)
- [ ] Requests and limits, probes, and at least 2 replicas with a PodDisruptionBudget (15)

**Delivery**
- [ ] Pipeline: install, lint, test, build, scan, deploy, smoke test, with rollback. The same artifact goes to every environment (17)
- [ ] Database migrations are backward compatible (expand and contract). Rollback is rehearsed (18)

**Observability and operations**
- [ ] RED metrics per route and USE metrics for the process, the pool and the event loop (20)
- [ ] Alerts on symptoms (error rate, latency, SLO burn), each with a runbook (22)
- [ ] An error tracker with release and environment tags (22)
- [ ] The load per instance is measured, headroom is planned, and pool sizes times replicas fit the database (sections 23 and 26)
- [ ] A written first-five-minutes incident checklist and a way to take a heap snapshot or CPU profile (25)

## 29. Interview angle: what you will be asked

| Question | A strong answer includes | A weak answer |
|---|---|---|
| "How do you deploy a Node service to production?" | Build one image in CI, tag with the commit, scan it, deploy to staging, smoke test, roll out gradually behind readiness probes, watch metrics, roll back automatically | "I copy the files to the server and run `node app.js`" |
| "How do you get zero-downtime deploys?" | Readiness gating, graceful shutdown (SIGTERM, drain, hard timeout), backward-compatible migrations, rolling or blue/green | "Use PM2" and nothing else |
| "What happens when Kubernetes stops your pod?" | Removed from Service endpoints and `preStop` in parallel, `SIGTERM`, grace period (30 s default), then `SIGKILL`. The app must handle `SIGTERM` | "It just kills it" |
| "Liveness vs readiness?" | Restart vs remove from load balancer. Liveness must not check dependencies | They are "the same health check" |
| "Memory keeps growing. What do you do?" | Heap or native memory? Heap after GC grows? Two heap snapshots compared, look at caches, listeners, closures. Stopgap restart | "Add more memory" |
| "Logs, metrics, traces: when each?" | Metrics tell you something is wrong, traces where, logs why. Correlation ids tie them. Cardinality and cost | "Log everything" |
| "How do you handle config and secrets?" | Environment, validated at startup, fail fast, secret manager, redaction, rotation | `.env` file committed to git |
| "Your API is slow only in production. First steps?" | RED dashboards, what changed, event loop lag and pool saturation, then a profile or trace | Guessing and restarting |
| "How do you protect a Node server from slow or hostile clients?" | `headersTimeout` and `requestTimeout` (408), connection limits and rate limits at the proxy, request size limits, a timeout on every outgoing call | "Node is fast enough, it does not need it" |
| "What do you do when the process crashes?" | Log one structured fatal line, flush the error tracker, exit non-zero, let the supervisor restart it. Never keep serving after `uncaughtException` | Swallowing the error to "stay up" |

Common wrong answers worth remembering: "`NODE_ENV=production` makes Node faster" (Node ignores it, libraries read it), "run `npm start` in Docker" (signals are lost), "call `process.exit(0)` in the SIGTERM handler" (cuts requests), "check the database in the liveness probe" (cascading restarts), "label metrics by user id" (cardinality explosion), "average latency is fine, so users are fine" (hides the tail).

## Summary / Key takeaways
- Config comes from the environment, is read once, validated at startup, and fails fast with all the problems listed. Secrets never go in git, images or logs. `NODE_ENV` is read by libraries and npm, not by Node: use `production` on staging too, and a separate variable for the environment name.
- Log structured JSON to stdout, with levels, redaction and a request id from `AsyncLocalStorage` on every line. Aggregation then makes it searchable.
- Liveness asks "should I restart you?" and checks nothing external. Readiness asks "send traffic?" and gates deploys and shutdown.
- Graceful shutdown: not ready, wait, `server.close()`, drain, close dependencies in reverse order, hard timeout shorter than the kill timer, exit code through `process.exitCode`, second signal forces. Do not use `process.exit()` in the normal path. A crash is different: log, exit non-zero, let the supervisor restart.
- Set timeouts in both directions: the server's own (headers, request, keep-alive longer than the proxy's idle timeout) and one on every outgoing call.
- Containers: multi-stage build, `npm ci --omit=dev`, non-root, exec-form `CMD`, an init process, a memory limit with `--max-old-space-size` below it. Kubernetes adds probes, requests and limits, rolling updates and autoscaling.
- Observe with metrics (RED, USE, percentiles, low cardinality), traces (context propagation with `traceparent`, sampling) and logs, and alert on symptoms and SLO burn.
- In an incident: stop the bleeding first, check what changed, collect evidence from one instance before restarting, and write a blameless postmortem.

## Quick check

1. Why should an app validate its configuration at startup instead of when a value is first used?
<details><summary>Answer</summary>

Because a bad value then stops the deploy, not a user request at 3 a.m. All problems are reported at once, nothing is half started, and in Kubernetes the new version never becomes ready while the old one keeps serving. Never put the secret value itself in the error message.

</details>

2. Does Node change its behaviour when `NODE_ENV=production`? What is the staging trap?
<details><summary>Answer</summary>

No. Node itself ignores it. npm (skips dev dependencies) and libraries such as Express read it. The trap: libraries only know "production" and "not production", so `NODE_ENV=staging` makes them behave like development. Use `NODE_ENV=production` on staging and a different variable (for example `DEPLOY_ENV=staging`) for the environment name.

</details>

3. What does a failing liveness probe do, what does a failing readiness probe do, and why must liveness not check the database?
<details><summary>Answer</summary>

Liveness failure restarts the container. Readiness failure removes the pod from the Service so it gets no traffic, without a restart. If liveness checked the database, a database outage would make every instance fail and restart at the same time, which does not fix the database and adds restart load.

</details>

4. Why does `CMD npm start` make `docker stop` slow and unsafe, and what is the fix?
<details><summary>Answer</summary>

`npm` (and a shell) become the parent of your app and do not forward `SIGTERM`. Docker waits its timeout (10 seconds by default) and sends `SIGKILL`, cutting requests. Use the exec form `CMD ["node", "server.js"]`, run an init process (`--init` or tini) as PID 1, and handle `SIGTERM` in the code.

</details>

5. List the steps of a graceful shutdown in order, and say why `process.exit()` is risky in the signal handler.
<details><summary>Answer</summary>

Mark not-ready, arm a hard timeout, wait for the load balancer, `server.close()` (and close idle connections), wait for in-flight requests and jobs, close dependencies in reverse order, set `process.exitCode`. `process.exit()` ends the process immediately: requests in flight are cut, pending timers and I/O never run, and buffered output can be lost.

</details>

6. What is the difference between a counter, a gauge and a histogram, and what is "high cardinality"?
<details><summary>Answer</summary>

A counter only goes up (requests served). A gauge goes up and down (in-flight requests, memory). A histogram counts values into buckets so you can estimate percentiles (latency). Cardinality is the number of distinct label combinations. Labels like user id or raw URL create endless series that cost memory and money, so use route templates and small fixed sets.

</details>

7. In a trace, how does a second service know it belongs to the same trace?
<details><summary>Answer</summary>

The caller sends the W3C `traceparent` header (`00-<trace id>-<parent span id>-<flags>`) on the outgoing request. The second service reads it and creates its spans with the same trace id and the caller's span as parent. If any service does not forward the header, the trace breaks there. The flags also carry the sampling decision.

</details>

8. How much downtime does a 99.9% SLO allow in 30 days, and what is a burn rate?
<details><summary>Answer</summary>

0.1% of 43,200 minutes, which is 43.2 minutes. The burn rate is how fast the error budget is spent compared with an even spread over the window: 1 uses exactly the whole budget in the window, 14.4 would spend 2% of a 30-day budget in one hour. Teams page on a high burn rate.

</details>

9. A container exits with code 137, another with code 134. What happened in each case?
<details><summary>Answer</summary>

137 is 128 + 9: the process received `SIGKILL`, usually from the kernel or Kubernetes because the container passed its memory limit (`OOMKilled`), or because the shutdown grace period ran out. 134 is an abort: V8 ran out of heap ("JavaScript heap out of memory"). Setting `--max-old-space-size` below the container limit makes V8 fail first with a message.

</details>

10. Why use `npm ci` instead of `npm install` in Dockerfiles and CI, and why copy `package.json` before the source code?
<details><summary>Answer</summary>

`npm ci` installs exactly what the lockfile says and fails if it disagrees with `package.json`, so builds are repeatable. Copying the dependency files first lets Docker reuse the cached install layer until those files change, so editing source code does not reinstall packages.

</details>

## Try it yourself

Do the tasks in a scratch folder, not inside the repo. Each solution is a single file that runs with plain `node file.js`.

### Task 1 (easy): read and check two settings

Write `readConfig(env)` that takes a plain object (so you can test it with fake values) and returns `{ port, debug }`:

- `PORT`: a whole number from 1 to 65535. Default 3000.
- `DEBUG`: the text `true` or `false`. Default `false`.
- If anything is wrong, throw **one** error that lists **all** problems.

Test it with `{}`, with `{ PORT: '8080', DEBUG: 'true' }`, and with `{ PORT: 'abc', DEBUG: 'yes' }`.

<details><summary>Hint</summary>

Collect messages in an array and throw once at the end, if the array is not empty. Remember that the values are text: use `Number(...)` and compare `DEBUG` with the strings `'true'` and `'false'`. `Number.isInteger` rejects `NaN` and `1.5`.

</details>

<details><summary>Solution</summary>

```js
// Task 1 solution: read PORT and DEBUG from the environment, report ALL problems at once.
function readConfig(env) {
  const problems = [];

  let port = 3000; // default
  if (env.PORT !== undefined && env.PORT !== '') {
    port = Number(env.PORT);
    if (!Number.isInteger(port) || port < 1 || port > 65535) problems.push('PORT must be a whole number from 1 to 65535');
  }

  let debug = false; // default
  if (env.DEBUG !== undefined && env.DEBUG !== '') {
    if (env.DEBUG === 'true') debug = true;
    else if (env.DEBUG !== 'false') problems.push('DEBUG must be "true" or "false"');
  }

  if (problems.length > 0) throw new Error('Invalid configuration:\n' + problems.map((p) => '  - ' + p).join('\n'));
  return Object.freeze({ port, debug });
}

console.log(readConfig({}));
console.log(readConfig({ PORT: '8080', DEBUG: 'true' }));
try {
  readConfig({ PORT: 'abc', DEBUG: 'yes' });
} catch (err) {
  console.log(err.message);
}
```

Output:

```text
{ port: 3000, debug: false }
{ port: 8080, debug: true }
Invalid configuration:
  - PORT must be a whole number from 1 to 65535
  - DEBUG must be "true" or "false"
```

</details>

### Task 2 (medium): one log line per request, with the request id

Build an HTTP server with a wrapper function `withRequestLogging(handler)`:

- Use the `x-request-id` header if the client sent one, otherwise make a UUID (`crypto.randomUUID()`). Send the id back in the response header.
- Store the id in an `AsyncLocalStorage`.
- Write a small `log(level, msg, fields)` function that adds the stored `requestId` automatically, so code deep inside a handler never has to receive the id.
- When each response finishes, write **one** JSON line: `method`, `url`, `status`, `durationMs`, `requestId`.
- Test with two requests (one with its own id, one without, one of them answering 500). Keep the lines in an array and print them at the end, so the output order is fixed.

<details><summary>Hint</summary>

`res.on('finish', ...)` is a good place for the "request completed" line. Do not rely on the store being set when that event fires: which context an event runs in depends on who ended the response (on Node 24 it often still works when `res.end()` was called inside `context.run(...)`, but a response ended from a callback that lost the context would log without the id). Enter the context again inside the listener (`context.run({ requestId }, ...)`), or read the id from a variable you captured. Use `process.hrtime.bigint()` for the timing.

</details>

<details><summary>Solution</summary>

```js
// Task 2 solution: one JSON log line per request with method, url, status, duration and the request id.
const http = require('node:http');
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');
const { once } = require('node:events');

const context = new AsyncLocalStorage();
const lines = []; // a real logger writes to stdout; we keep the lines to look at them

function log(level, msg, fields = {}) {
  lines.push(JSON.stringify({ level, msg, ...context.getStore(), ...fields })); // requestId comes from the store
}

function withRequestLogging(handler) {
  return (req, res) => {
    const requestId = req.headers['x-request-id'] ?? randomUUID(); // in real code also check the format
    const started = process.hrtime.bigint();
    res.setHeader('x-request-id', requestId);
    res.on('finish', () => {
      // Which context 'finish' runs in depends on who ended the response, so enter the context again for this one line
      context.run({ requestId }, () => {
        log('info', 'request completed', {
          method: req.method,
          url: req.url,
          status: res.statusCode,
          durationMs: Number(process.hrtime.bigint() - started) / 1e6,
        });
      });
    });
    context.run({ requestId }, () => handler(req, res));
  };
}

const server = http.createServer(
  withRequestLogging((req, res) => {
    log('debug', 'handler started'); // gets the requestId without being given it
    res.statusCode = req.url === '/fail' ? 500 : 200;
    res.end('done');
  }),
);

async function main() {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  await (await fetch(base + '/ok', { headers: { 'x-request-id': 'abc-1' } })).text();
  await (await fetch(base + '/fail')).text();
  server.close();

  for (const line of lines) {
    const record = JSON.parse(line);
    if ('durationMs' in record) record.durationMs = typeof record.durationMs; // the real number changes on every run
    if (record.requestId !== 'abc-1') record.requestId = '(generated uuid)';
    console.log(JSON.stringify(record));
  }
}

main();
```

Output (the real duration changes on every run, so the solution prints `"number"` instead of the value, and the generated id is replaced by a label):

```text
{"level":"debug","msg":"handler started","requestId":"abc-1"}
{"level":"info","msg":"request completed","requestId":"abc-1","method":"GET","url":"/ok","status":200,"durationMs":"number"}
{"level":"debug","msg":"handler started","requestId":"(generated uuid)"}
{"level":"info","msg":"request completed","requestId":"(generated uuid)","method":"GET","url":"/fail","status":500,"durationMs":"number"}
```

</details>

### Task 3 (harder): close everything, in the right order, with timeouts

Write `async function closeInReverse(resources, { perTaskTimeoutMs })`:

- `resources` is an array of `{ name, close }` in the order they were **created**. `close` is an async function.
- Close them in **reverse** order, one at a time.
- Each `close()` gets its own timeout. If one takes too long or throws, log the problem and **continue** with the rest.
- Return `0` if everything closed cleanly, otherwise `1` (the exit code to use).

Test it with an HTTP server (created first), a fake database, and a queue consumer whose `close()` never finishes.

<details><summary>Hint</summary>

Reverse a copy of the array (`[...resources].reverse()`). For the timeout use `Promise.race([close(), timeout])`, where `timeout` is a promise that rejects after `perTaskTimeoutMs`. Clear the timer in a `finally`, otherwise the timer keeps the process alive. Wrap each resource in its own `try/catch` so one failure does not stop the loop.

</details>

<details><summary>Solution</summary>

```js
// Task 3 solution: close resources in reverse order, each with its own timeout, and return an exit code.
const http = require('node:http');
const { once } = require('node:events');

async function closeInReverse(resources, { perTaskTimeoutMs = 1000 } = {}) {
  let failures = 0;
  for (const { name, close } of [...resources].reverse()) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`did not finish within ${perTaskTimeoutMs} ms`)), perTaskTimeoutMs);
    });
    try {
      await Promise.race([close(), timeout]); // whichever settles first
      console.log(`closed ${name}`);
    } catch (err) {
      failures++;
      console.log(`failed to close ${name}: ${err.message}`); // keep going: the other resources still need closing
    } finally {
      clearTimeout(timer);
    }
  }
  return failures === 0 ? 0 : 1;
}

async function main() {
  const server = http.createServer((req, res) => res.end('ok'));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const resources = [
    { name: 'http server', close: () => new Promise((resolve) => server.close(resolve)) }, // created first, closed last
    { name: 'database', close: async () => {} },
    { name: 'queue consumer', close: () => new Promise(() => {}) }, // never finishes
  ];
  const code = await closeInReverse(resources, { perTaskTimeoutMs: 100 });
  console.log('exit code to use:', code); // a real service would set process.exitCode = code
}

main();
```

Output:

```text
failed to close queue consumer: did not finish within 100 ms
closed database
closed http server
exit code to use: 1
```

The queue consumer is closed first because it was created last, it times out, the database and the HTTP server still close, and the function returns `1` because one resource failed. In a real shutdown you would also keep the overall hard timeout from section 11 around this call.

</details>

## Where to go next

Next lesson: [25. Architecture, Design Patterns and Resilience](../25-architecture-and-patterns/README.md). It builds on this one: timeouts, retries, circuit breakers and queues are what keep a service healthy when its neighbours are not.

Related lessons to revisit: [14. Error Handling and Debugging](../14-error-handling-and-debugging/README.md) (log, exit, restart, diagnostic reports), [15. Processes, Signals, child_process and Building CLIs](../15-processes-and-cli/README.md) (signals and exit codes), [17. Databases and Data Access](../17-databases-and-data-access/README.md) (pools and shutdown), [18. Worker Threads and Cluster](../18-worker-threads-and-cluster/README.md) (using all cores), [19. Performance and Memory](../19-performance-and-memory/README.md) (profiles and heap snapshots) and [20. Security and Crypto](../20-security-and-crypto/README.md) (hardening).

Practise this topic in the interview rounds:
- [Round 4: Advanced questions](../../rounds/round-4-advanced/questions.md): graceful shutdown, signals, event loop lag, memory leaks, observability
- [Round 5: System design questions](../../rounds/round-5-system-design/questions.md): deployment strategies, scaling, SLOs, capacity planning
- [Round 6: Behavioral questions](../../rounds/round-6-behavioral/questions.md): tell the story of an incident you handled (use the first-five-minutes checklist and the blameless postmortem)

[All lessons](../../README.md)
