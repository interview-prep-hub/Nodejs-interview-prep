# 25. Architecture, Design Patterns and Resilience

> Level: Advanced   Time: about 240 minutes   Node: 24 (notes where older versions differ)

[Previous: 24. Production, Deployment and Observability](../24-production-and-deployment/README.md) | [All lessons](../../README.md) | [Next: 26. Web Frameworks and the Middleware Pattern](../26-frameworks-and-middleware/README.md)

## What you will learn
- How to organise a Node project (layers, feature folders, "clean" and "hexagonal" architecture in plain words), how dependency injection works by hand, and SOLID in a few lines of JavaScript
- The design patterns Node interviews ask about, each with a small runnable example: singleton (the module cache), factory, builder, adapter, decorator, proxy, observer, strategy, middleware, pub/sub, repository and unit of work
- Event-driven architecture and message queues (RabbitMQ, Kafka, SQS, BullMQ): delivery guarantees, idempotent consumers, the outbox pattern, retries and dead-letter queues, with a job queue you build yourself
- Scheduling and cron jobs (and how to stop three app instances from running the same job three times), plus caching strategies with protection against a cache stampede
- API design: REST conventions, pagination, idempotency keys, ETag and lost updates, problem details (RFC 9457), and a comparison of REST, GraphQL, gRPC and tRPC
- Monolith, modular monolith and microservices (the honest trade-offs), API gateway, BFF and service discovery
- Resilience patterns written by hand: timeouts, retries with backoff and jitter, circuit breaker, bulkhead, rate limiting and backpressure
- CQRS, event sourcing, the saga pattern, the CAP theorem, the twelve-factor app, and how to talk about trade-offs in an interview

## 1. What "architecture" means

**Architecture** is the set of big decisions that are expensive to change later: how the code is split into parts, how the parts talk to each other, and where the data lives. A **design pattern** is a named, reusable solution to a small problem that keeps coming back inside the code, like "I need to add logging to this object without editing it".

Two words explain most of this lesson:

- **Coupling**: how much one part must know about another. You want it low. If changing the database forces you to edit your HTTP handlers, those parts are tightly coupled.
- **Cohesion**: how well the things inside one part belong together. You want it high. A file called `utils.js` with 40 unrelated functions has low cohesion.

Think of a restaurant. The cook does not take payments and the cashier does not cook. Each person has one job and a clear way to hand work to the next person. That is **separation of concerns**: each part of the program deals with one kind of thing (HTTP, business rules, storage), so you can change or test one part without touching the others.

There is no best architecture. Every choice buys something and costs something. A good interview answer always names both.

> **Interview tip:** start any design answer with the problem and the constraints (how much traffic, how big the team, how strict the consistency needs to be), not with a technology name. "It depends" is a fine start if you follow it with "on X, and here is what I would do in each case".

### Map of this lesson

The lesson is long because the topic is wide. Read it in parts: each part answers one question, and the sections inside a part build on each other.

| Part | Sections | The question it answers |
|---|---|---|
| A. Structure and patterns | 2 to 8 | How do I organise code so it stays easy to change and to test? |
| B. Messages and time | 9 to 12 | How do parts talk without waiting for each other, and how do I run work on a schedule? |
| C. Data and APIs | 13 to 15 | How do I make reads fast (caching), and how do I design the API that clients use? |
| D. System shape | 16 | One deployable app, or many small ones? |
| E. Staying up when things fail | 17 to 21 | What do I do when a dependency is slow, down or too busy? |
| F. Distributed-system ideas | 22 to 24 | CQRS, event sourcing, sagas, the CAP theorem, the twelve-factor app |
| G. Interview skills | 25 | How do I argue a trade-off out loud? |

Short on time? The topics that come up most in Node interviews are dependency injection (3), the patterns (5 to 7), delivery guarantees and idempotency (11), caching and stampedes (13), idempotency keys (14), the resilience patterns (17 to 20) and the trade-off talk (25).

### How to run the examples, and the fake clock

All examples run from the repo root, for example `node lessons/25-architecture-and-patterns/examples/01-layered-app.js`. They use only core modules and finish by themselves in a second or two. Anything that depends on time (retries, TTLs, cron, rate limits) uses a **fake clock** from the helper file `examples/_fake-clock.js`. A fake clock is a clock you move forward by hand, so the numbers in this lesson are the same on every run and nothing really waits. Files that start with an underscore are helpers, not examples to run on their own.

You will see the fake clock in many examples. The whole idea is four calls:

- `clock.now()` returns the fake time in milliseconds (it starts at 0).
- `clock.setTimeout(fn, ms)` and `clock.sleep(ms)` work like the real ones, but only fire when the fake time reaches them.
- `clock.tick(ms)` moves the fake time forward and runs every timer that falls due.
- `clock.tickAsync(ms)` does the same and also lets promise callbacks run between timers. Code that does `await clock.sleep(...)` needs this one.

To try it, put the snippet below in a file inside the `examples/` folder (it is not one of the lesson files, so delete it afterwards):

```js
const { FakeClock } = require('./_fake-clock');

async function main() {
  const clock = new FakeClock();
  clock.setTimeout(() => console.log('timer fired at t =', clock.now()), 500);
  clock.tick(499);
  console.log('after 499 ms: nothing yet, t =', clock.now());
  clock.tick(1);

  // Code that awaits a fake sleep needs tickAsync: it lets promise callbacks run between timers.
  const done = clock.sleep(1000).then(() => console.log('woke up at t =', clock.now()));
  await clock.tickAsync(1000);
  await done;
}
main();
```

```text
after 499 ms: nothing yet, t = 499
timer fired at t = 500
woke up at t = 1500
```

## 2. Project structure: layers, features and "hexagonal"

### The layered structure

The most common structure in Node back ends is four layers. A request goes down the layers, and the answer comes back up:

```text
request -> route -> controller -> service -> repository -> database
```

| Layer | Its one job | It must NOT contain |
|---|---|---|
| Routes | map a method and URL to a controller function | any logic |
| Controller | read the request, call a service, build the response, turn errors into status codes | business rules, SQL |
| Service | the business rules ("an email may be registered only once") | `req`/`res` objects, SQL |
| Repository | read and write storage, return plain objects | business rules, HTTP |

The rule: **calls only go downward.** A repository never imports a controller. This is what makes each layer replaceable. You can swap PostgreSQL for MongoDB by rewriting one layer, test the rules without starting an HTTP server, and call the same service from a queue worker or a command-line tool, not only from HTTP.

Here are the three important pieces of `examples/01-layered-app.js` (trimmed). First the service, which holds the rule and knows nothing about HTTP:

```js
class UserService {
  constructor({ users }) {
    this.users = users; // the repository is handed in from outside
  }
  async register({ name, email } = {}) {
    if (!name || !email || !email.includes('@')) throw new ValidationError('name and a valid email are required');
    const normalized = email.toLowerCase();
    if (await this.users.findByEmail(normalized)) throw new ConflictError(`email ${normalized} is already registered`);
    return this.users.create({ name, email: normalized });
  }
}
```

The controller turns the service result or error into an HTTP-shaped answer:

```js
const statusFor = new Map([
  [ValidationError, 400],
  [NotFoundError, 404],
  [ConflictError, 409],
]);

function makeUserController({ userService }) {
  const respond = async (successStatus, work) => {
    try {
      return { status: successStatus, body: await work() };
    } catch (err) {
      const status = [...statusFor].find(([Type]) => err instanceof Type)?.[1] ?? 500;
      return { status, body: { error: err.message } };
    }
  };
  return {
    create: (req) => respond(201, () => userService.register(req.body)),
    get: (req) => respond(200, () => userService.getUser(Number(req.params.id))),
  };
}
```

Finally the **composition root**: the one place that decides which concrete classes are used and connects them. Everything else only receives what it needs (section 3 explains why):

```js
function buildApp(users) {
  const userService = new UserService({ users });
  return makeRouter(makeUserController({ userService }));
}
```

Running the file sends six requests through all layers, then tests the service alone with a fake repository:

```text
--- Part 1: the layers working together
POST /users    -> 201 {"id":1,"name":"Ada","email":"ada@example.com"}
POST /users    -> 409 {"error":"email ada@example.com is already registered"}
POST /users    -> 400 {"error":"name and a valid email are required"}
GET  /users/1  -> 200 {"id":1,"name":"Ada","email":"ada@example.com"}
GET  /users/99 -> 404 {"error":"user 99 not found"}
GET  /nope     -> 404 {"error":"no such route"}

--- Part 2: test the service alone with a fake repository (no HTTP, no database)
service test passed, saved: [{"name":"Bob","email":"bob@x.io"}]
```

Look at where each decision lives. The service throws a `ConflictError`; it does not know what "409" is. The controller knows 409 but not why. The same service works behind Express, Fastify, a queue consumer or a unit test. The example uses a plain function instead of a real HTTP server to stay short and exact; in Express (lesson 26) the route table becomes `app.post('/users', controller.create)`.

> **Common mistake:** the "fat controller": validation, business rules and SQL all inside the route handler. It works on day one, and by month six nobody dares to touch it and nothing can be tested without HTTP. The opposite mistake is also common: four layers where each one only forwards the call. If a layer adds nothing, merge it.

### By layer or by feature?

You can group files by what they are, or by what they are for:

```text
BY LAYER (fine for small apps)         BY FEATURE (scales better)
src/                                   src/
  routes/       users.js, orders.js      users/
  controllers/  users.js, orders.js        users.routes.js
  services/     users.js, orders.js        users.controller.js
  repositories/ users.js, orders.js        users.service.js
  app.js                                   users.repository.js
                                         orders/
                                           orders.routes.js
                                           ...
                                         shared/      (logger, errors, config)
                                         app.js       (composition root)
```

With folders by layer, one change ("add a field to orders") touches four folders. With folders by feature, the files that change together sit together. That is higher cohesion. Feature folders also prepare you for the **modular monolith** (section 16): each feature exposes a small public file (for example `orders/index.js`) and other features import only that, never its internals.

### Clean and hexagonal architecture in plain words

**Hexagonal architecture** (also called **ports and adapters**) and **clean architecture** are two names for one idea: put the business rules in the middle, and make everything else (web framework, database, queue, email) a plug-in around them.

- The **core** holds the domain rules and the use cases. It imports no Express, no SQL driver, no SDK.
- A **port** is a small contract the core needs, such as "something with `findByEmail` and `create`" or "something with `send(to, subject)`". In JavaScript a port is just a set of method names; there is no `interface` keyword.
- An **adapter** is a concrete piece that plugs into a port: `PostgresUserRepository`, `SmtpMailer`, `ExpressController`.
- The **dependency rule**: source code dependencies point inward. Adapters know the core. The core never knows the adapters.

```text
   HTTP (Express)     CLI     queue worker       <- driving adapters (they call the core)
          \            |          /
           +-----  application core  -----+
           |   use cases + domain rules   |
           +------+----------------+------+
                  |                |
          UserRepository         Mailer          <- ports (what the core needs)
                  |                |
        PostgresUserRepository   SmtpMailer      <- driven adapters (implement the ports)
```

The payoff is the same as with layers: swap or fake any outer piece. The cost is more files and more indirection. For a small CRUD service, plain layers are enough. Reach for ports and adapters when the business rules are rich, or when you really expect to change a technology.

> **Interview tip:** "How is hexagonal architecture different from plain layers?" A strong short answer: in plain layers the business code sits on top of the data layer and usually ends up depending on it (it imports the database code). In hexagonal the business code sits in the middle and owns the contracts (ports); the database and the web framework depend on those contracts, not the other way round. Say "dependencies point inward", then give the cost: more files and indirection, so only worth it when the rules are rich.

## 3. Dependency injection by hand

**Dependency injection (DI)** means: an object gets the things it needs from the outside, instead of creating or importing them itself. "Dependency" is just "something I need to do my job".

```js
// Illustration only (not a runnable file).
// Hard-wired: the service decides which mailer to use. A test cannot replace it.
const mailer = require('./smtp-mailer');
const signUp = (email) => mailer.send(email, 'Welcome!');

// Injected: whoever builds the service decides. A test passes a fake.
const makeSignUp = ({ mailer }) => (email) => mailer.send(email, 'Welcome!');
```

The most common form is **constructor injection**: the dependencies arrive as constructor arguments (as in `new UserService({ users })` above). Passing a single object with named fields is easier to read than a long list of positional arguments.

### Why it helps testing

In a test you want to run your code without a real database, mail server or clock. If the code receives these things, you hand it fakes. If it requires them itself, you must patch the module cache, which is fragile. Example `02-di-container.js` shows both a hand-built container and a test:

```js
const sent = [];
const testContainer = buildContainer().register('mailer', () => ({
  send: async (to, subject) => sent.push({ to, subject }),
}));
await testContainer.resolve('signupService').signUp('bob@example.com');
assert.deepEqual(sent, [{ to: 'bob@example.com', subject: 'Welcome!' }]);
```

### A container in 25 lines

A **DI container** is an optional helper that builds objects and their dependencies for you. You register a recipe for each name, then ask for the root object and the container builds the whole graph:

```js
class Container {
  #recipes = new Map();
  #singletons = new Map();

  register(name, factory, { lifetime = 'singleton' } = {}) {
    this.#recipes.set(name, { factory, lifetime });
    this.#singletons.delete(name);
    return this;
  }

  resolve(name, path = []) {
    if (path.includes(name)) throw new Error(`Circular dependency: ${[...path, name].join(' -> ')}`);
    const recipe = this.#recipes.get(name);
    if (!recipe) throw new Error(`Nothing registered under "${name}"`);
    if (recipe.lifetime === 'singleton' && this.#singletons.has(name)) return this.#singletons.get(name);

    const instance = recipe.factory((dep) => this.resolve(dep, [...path, name]));
    if (recipe.lifetime === 'singleton') this.#singletons.set(name, instance);
    return instance;
  }
}
```

The application classes are registered in one function, the composition root:

```js
function buildContainer() {
  return new Container()
    .register('logger', () => new Logger())
    .register('mailer', () => new SmtpMailer())
    .register('users', () => new UserRepository())
    .register('signupService', (get) => new SignupService({ users: get('users'), mailer: get('mailer'), logger: get('logger') }));
}
```

Output of the example:

```text
--- 1. Resolve the whole graph from the root
  [smtp] pretend to send "Welcome!" to ada@example.com
  [log] signed up ada@example.com

--- 2. Lifetimes
singleton: same logger twice? true
transient: same object twice? false

--- 3. A test: replace the mailer with a fake that records calls
  [log] signed up bob@example.com
  test passed, the fake mailer saw: [{"to":"bob@example.com","subject":"Welcome!"}]

--- 4. Mistakes are caught with clear messages
  resolve("a") -> Circular dependency: a -> b -> a
  resolve("missing") -> Nothing registered under "missing"

--- 5. Without DI the dependency is hidden inside the file
  [smtp] pretend to send "Welcome!" to carol@example.com
  a test cannot swap the mailer here without patching require()
```

Two **lifetimes** appear in almost every container. A **singleton** is built once and reused (a logger, a connection pool). A **transient** is built fresh on every request for it. Many containers add a third, **scoped**, which lives as long as one HTTP request.

> **Remember:** DI is a technique, a container is a tool. Many good Node codebases use DI with no container at all: one `buildApp()` function that creates objects in order and passes them along. Real containers exist when the graph gets big: `awilix`, `tsyringe`, `InversifyJS`, and NestJS has one built in.

> **Common mistake:** the **service locator**. If business code calls `container.resolve('mailer')` inside its methods, the dependency is hidden again, and you only moved the problem. Resolve at the composition root and pass the result in. Also watch for **circular dependencies** (A needs B and B needs A). The container above reports them, but the real fix is design: extract the shared part into a third object, or let one side publish an event instead of calling.

> **Interview tip:** "How do you test code that talks to a database, an email service or the clock?" Strong short answer: those things are dependencies, so they are passed in, and the test passes fakes. One composition root wires the real ones in production. Add that time and randomness count as dependencies too: the fake clock and the injected `random` function later in this lesson are exactly this idea.

## 4. SOLID in JavaScript

**SOLID** is five guidelines for object-oriented design. They are advice, not laws, and interviewers love them. Here is each one in plain words with the smallest JavaScript example (all in `examples/03-solid.js`).

| Letter | Name | One-sentence version |
|---|---|---|
| S | Single responsibility | a module should have one reason to change |
| O | Open/closed | add new behaviour by adding code, not by editing old code |
| L | Liskov substitution | a subtype must work anywhere its parent works |
| I | Interface segregation | do not force code to depend on methods it does not use |
| D | Dependency inversion | depend on a small contract, not on a concrete tool |

**S, single responsibility.** A function that calculates a total, formats it and saves it has three reasons to change. Split it:

```js
const invoiceTotal = (items) => items.reduce((sum, i) => sum + i.price * i.qty, 0);
const invoiceText = (items) => items.map((i) => `${i.qty} x ${i.name}`).join(', ') + ` = ${invoiceTotal(items)}`;
const saveInvoice = (store, text) => store.push(text); // the "storage" is injected
```

**O, open/closed.** An `if/else` ladder on a type means every new type edits the function. A registry lets you extend without editing:

```js
const discounts = new Map([
  ['none', (p) => p],
  ['student', (p) => p * 0.9],
]);
const price = (base, type) => (discounts.get(type) ?? discounts.get('none'))(base);

discounts.set('blackfriday', (p) => p * 0.5); // extension: no existing code touched
```

**L, Liskov substitution.** If code works with a `Storage`, it must also work with any subclass of `Storage`. A "read-only storage" that inherits `write()` and throws breaks every caller:

```js
class Storage {
  read(name) { return `contents of ${name}`; }
  write(name, data) { return `wrote ${data.length} chars to ${name}`; }
}
class ReadOnlyStorage extends Storage {
  write() {
    throw new Error('read only!');
  }
}
const backup = (storage) => storage.write('backup.txt', 'data');
backup(new Storage()); //         works
backup(new ReadOnlyStorage()); // throws: the subtype is NOT a safe replacement
```

The fix is usually "do not inherit". Make two small shapes (a reader and a writer) and ask for the one you need.

**I, interface segregation.** JavaScript has no `interface` keyword, so the "interface" is simply the methods your code actually calls. A function that only calls `cache.get(id)` should accept anything with a `get` method, and its test fake needs only one method:

```js
const greet = (cache, id) => `hello ${cache.get(id) ?? 'stranger'}`;
greet({ get: (id) => (id === 1 ? 'Ada' : undefined) }, 1); // a 1-method fake
greet(new Map([[2, 'Bob']]), 2); // a Map also has get()
```

**D, dependency inversion.** The high-level class (order rules) must not import the low-level detail (an email library). Both depend on a tiny contract, "a notifier has `send(text)`". Section 3 is this principle in action:

```js
class OrderService {
  constructor({ notifier }) {
    this.notifier = notifier;
  }
  place(order) {
    this.notifier.send(`order ${order.id} placed`);
    return 'ok';
  }
}
```

Output of the whole file:

```text
--- S: single responsibility
[ '3 x pen, 1 x book = 16' ]

--- O: open/closed
student: 90
blackfriday: 50

--- L: Liskov substitution
wrote 4 chars to backup.txt
subtype broke the caller: read only!
read-only still works for reading: contents of a.txt

--- I: interface segregation
hello Ada
hello Bob

--- D: dependency inversion
  email: order 1 placed
  sms  : order 2 placed
```

> **Interview tip:** do not just recite the letters. Give one concrete example from your own code for the principle you are asked about, and say when you would NOT apply it ("for a 30-line script, splitting into three modules is overkill"). Dependency inversion and single responsibility are the two most asked.

## 5. Singleton, factory and builder

These are the **creational patterns**: they are about how objects get created. All three are in `examples/04-creational-structural.js`.

### Singleton: one shared instance (and Node gives it to you)

A **singleton** is an object of which only one instance exists, shared by everyone. Typical candidates: a configuration object, a logger, a database connection pool.

In Node you do not need a special class. The **module cache** does it. The first time `require('./x')` runs, Node executes the file once, stores its `module.exports` in `require.cache`, and every later `require` of the same file returns that same object. A module is a singleton by default.

The helper `_counter-singleton.js` keeps a number at module level and exports a `next()` function. The example requires it twice:

```js
const a = require('./_counter-singleton');
const b = require('./_counter-singleton'); // second require: NOT executed again, same exports object
console.log('same object?', a === b);
console.log('a.next() ->', a.next(), '| b.next() ->', b.next(), '(shared state)');
const key = Object.keys(require.cache).find((k) => k.endsWith('_counter-singleton.js'));
console.log('cache key is the resolved file name:', path.basename(key));

delete require.cache[key]; // gotcha: now the next require loads the file again
const c = require('./_counter-singleton');
console.log('after deleting the cache entry, same object?', a === c, '| c.next() ->', c.next());
```

```text
--- Singleton via the module cache
  (_counter-singleton.js is executing now)
same object? true
a.next() -> 1 | b.next() -> 2 (shared state)
cache key is the resolved file name: _counter-singleton.js
  (_counter-singleton.js is executing now)
after deleting the cache entry, same object? false | c.next() -> 1
```

The line "is executing now" appears once for the first load and once after the cache entry was deleted. That is the proof that the cache is what makes it a singleton.

The gotchas that interviewers ask about:

- **It is one instance per process, not per system.** With `cluster`, `worker_threads` or three servers behind a load balancer, each has its own copy. State that must be shared belongs in a database or Redis.
- **The cache key is the resolved file path.** If the same package is installed twice in `node_modules` (two versions, or a duplicated dependency), you get two instances, because they are two different files.
- **Windows trap: letter case.** The cache key is a plain string. On Windows the file system ignores case, so `require('./Store.js')` and `require('./store.js')` both succeed but load the file twice and give two different objects (checked on Windows with Node 24). On Linux the wrong-case name fails with "Cannot find module". The default macOS file system also ignores case, so it usually behaves like Windows here (not tested for this lesson). Always write the exact file name.
- **Keys use backslashes on Windows.** That is why the example only compares the end of the key and uses `path.basename`.
- **ES modules are cached too**, by URL, and there is no public API to evict one. A different URL (for example `./x.mjs?v=2`) is a different module.
- **Hidden global state hurts tests.** A module-level singleton keeps its state between tests. Prefer to create the instance once in the composition root and pass it in (section 3). You still get "one instance", without everyone reaching for a global.

### Factory: a function that decides what to build

A **factory** is a function that creates objects so the caller does not need to know which class or setup is used. The caller says what it wants; the factory returns something with the right shape.

```js
function createLogger(kind) {
  const factories = {
    console: () => ({ log: (m) => console.log('  console:', m) }),
    memory: () => {
      const lines = [];
      return { log: (m) => lines.push(m), lines };
    },
    silent: () => ({ log: () => {} }),
  };
  if (!factories[kind]) throw new Error(`unknown logger kind "${kind}"`);
  return factories[kind]();
}
```

```text
--- Factory
  console: hello
  memory logger kept: [ 'one', 'two' ]
  error: unknown logger kind "fax"
```

You already use factories from Node itself: `http.createServer()`, `fs.createReadStream()`, `crypto.createHash()`. A factory can validate arguments, return different kinds of objects, reuse cached ones, and hide the `new` keyword.

### Builder: build a complex object step by step

A **builder** collects settings through small method calls and produces the final object with one `build()` call. Returning `this` from each method is what lets the calls chain.

```js
const query = new QueryBuilder().from('users').where('age', '>', 18).where('country', '=', 'PK').orderBy('name').limit(10).build();
console.log(query);
```

```text
--- Builder
{
  sql: 'SELECT * FROM users WHERE age > ? AND country = ? ORDER BY name ASC LIMIT 10',
  params: [ 18, 'PK' ]
}
```

Look at the `?` placeholders: the builder keeps values in `params` and never pastes them into the SQL text. That is how query builders such as Knex keep **values** safe from SQL injection (lesson 17). Table and column names are different: this small builder pastes them into the SQL text, so they must come from your own code or an allow-list, never straight from a request.

> **Interview tip:** in JavaScript a plain options object (`{ table, where, limit }`) is often simpler than a builder. A builder earns its place when the steps have rules (for example `from()` is required) or when the order of steps matters.

## 6. Adapter, decorator and proxy

These three are **structural patterns**: they are about how objects are wrapped and connected. They look alike (all wrap something), so interviewers love the question "what is the difference?". The intent is different:

| Pattern | Interface compared to the wrapped object | Intent |
|---|---|---|
| Adapter | **different**: it converts one interface into another | make a foreign thing fit what my code expects |
| Decorator | the **same** | add behaviour (logging, caching, timing) |
| Proxy | the **same** | control access (lazy creation, permissions, remote calls) |

### Adapter

Two payment providers have different shapes. One takes an object and returns a promise, the other takes dollars and a callback. Your app wants one shape, `pay({ cents })`. The adapters translate:

```js
const providers = {
  fastPay: {
    async pay({ cents }) {
      const r = await fastPay.charges.create({ amountCents: cents, currency: 'usd' });
      return { ok: r.status === 'succeeded', reference: r.id };
    },
  },
  oldBank: {
    pay({ cents }) {
      return new Promise((resolve, reject) => {
        oldBank.makePayment(cents / 100, (err, ref) => (err ? reject(err) : resolve({ ok: true, reference: ref })));
      });
    },
  },
};
```

```text
--- Adapter: two different providers, one interface
  fastPay: {"ok":true,"reference":"fp_1"}
  oldBank: {"ok":true,"reference":"OB-12.5"}
```

The rest of the app never learns that the second provider uses callbacks. This is also exactly what the "adapters" in hexagonal architecture are (section 2), and what `util.promisify` does for callback functions.

### Decorator

A **decorator** wraps an object or function, adds behaviour, and keeps the same interface. Because functions are values in JavaScript, a decorator is often a function that takes a function and returns a function:

```js
const withLogging = (name, fn) => async (...args) => {
  const result = await fn(...args);
  console.log(`  ${name}(${JSON.stringify(args)}) ->`, JSON.stringify(result));
  return result;
};
const withTiming = (fn, now) => async (...args) => {
  const start = now();
  try {
    return await fn(...args);
  } finally {
    console.log(`  took ${now() - start} ms`);
  }
};

const decorated = withLogging('fastPay.pay', withTiming(providers.fastPay.pay, now));
```

```text
--- Decorator: add logging and timing without touching the provider
  took 25 ms
  fastPay.pay([{"cents":1250}]) -> {"ok":true,"reference":"fp_1"}
```

(The `25 ms` comes from a fake `now()` that moves 25 ms on every call, so the output is repeatable.) The decorators stack like layers of an onion: timing runs inside, logging outside. A well-known real example is a `CachedUserRepository` that wraps a `UserRepository`, has the same methods, and checks a cache first.

> **Remember:** the `@decorator` syntax you see in TypeScript and NestJS code is a different feature that shares the name. It is not valid plain JavaScript on Node 24 (it throws a `SyntaxError`), and the pattern here needs no special syntax.

### Proxy

JavaScript has a built-in `Proxy` object that intercepts operations such as reading or setting a property. It is a natural tool for the proxy pattern. Two uses: create something heavy only when it is first used (a **virtual** or lazy proxy), and block changes (a **protection** proxy):

```js
function lazy(create) {
  let instance;
  return new Proxy({}, {
    get(_target, prop) {
      instance ??= create(); // built on first use only
      return instance[prop];
    },
  });
}

function readOnly(target) {
  return new Proxy(target, {
    set(_t, prop) {
      throw new TypeError(`cannot change "${String(prop)}": object is read-only`);
    },
    deleteProperty(_t, prop) {
      throw new TypeError(`cannot delete "${String(prop)}": object is read-only`);
    },
  });
}
```

```text
--- Proxy
  proxy created, nothing built yet
  (building the heavy report engine now)
  first use: report done
  second use: report done
  error: cannot change "mode": object is read-only
  reading still works: prod
  gotcha: TypeError: Cannot read private member #n from an object whose class did not declare it
```

The last line is the famous gotcha. If a class uses `#private` fields and you wrap an instance in a `Proxy`, calling a method through the proxy fails. Inside the method `this` is the proxy, and the proxy does not own the private field.

Two workarounds:

- Return methods bound to the real target from the `get` trap: `const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;`
- Or avoid proxying objects that use private fields.

Passing the target as the third argument of `Reflect.get` alone fixes private getters, but not methods: `proxy.inc()` still calls `inc` with `this` set to the proxy.

> **Interview tip:** "Adapter, decorator, proxy: what is the difference?" Do not answer "they all wrap an object". Answer with the intent: the adapter changes the interface so a foreign thing fits, the decorator keeps the interface and adds behaviour, the proxy keeps the interface and controls access. Then give one example each from this section (two payment providers, logging and timing, a lazy or read-only object).

## 7. Observer, strategy, middleware and pub/sub

These are **behavioural patterns**: they are about how objects talk to each other. All four are in `examples/05-behavioral.js`.

### Observer (EventEmitter)

In the **observer** pattern a subject announces that something happened, and any number of observers react. The subject does not know who they are. In Node this is `EventEmitter` (lesson 09):

```js
class OrderService extends EventEmitter {
  place(order) {
    // ...save the order here...
    this.emit('orderPlaced', order); // synchronous: all listeners run before emit() returns
    return 'saved';
  }
}

const orders = new OrderService();
orders.on('orderPlaced', (o) => console.log('  email listener  : confirmation for order', o.id));
orders.on('orderPlaced', (o) => console.log('  analytics       : revenue +', o.total));
console.log('  place() returned:', orders.place({ id: 1, total: 40 }));
```

```text
--- Observer
  email listener  : confirmation for order 1
  analytics       : revenue + 40
  place() returned: saved
```

Adding a third reaction means adding a listener; `OrderService` is not edited (open/closed again). The gotchas from lesson 09 matter here: `emit` is synchronous, so a slow or throwing listener affects the caller, and forgotten listeners leak memory.

### Strategy

A **strategy** is an interchangeable algorithm chosen at run time. In JavaScript each strategy is simply a function with the same signature, stored in an object or map:

```js
const shippingStrategies = {
  standard: (kg) => 5 + kg * 1,
  express: (kg) => 15 + kg * 2.5,
  pickup: () => 0,
};
const shippingCost = (method, kg) => shippingStrategies[method](kg);
```

```text
--- Strategy
  standard 2 kg -> 7
  express  2 kg -> 20
  pickup   2 kg -> 0
  sort by length: [ 'a', 'bb', 'ccc' ]
```

`Array.prototype.sort(compareFn)` is a strategy you already use: you pass in "how to compare". Passport's login strategies (local, Google, JWT) are the same idea.

### Middleware (chain of responsibility)

In a **chain of responsibility**, a request passes through a line of handlers. Each handler may do its work and call `next()` to continue, or stop the chain by not calling it. This is the idea behind Express and Koa **middleware** (lesson 26 builds on it). A complete version fits in a few lines:

```js
function compose(middlewares) {
  return function run(ctx) {
    let index = -1;
    const dispatch = async (i) => {
      if (i <= index) throw new Error('next() called twice');
      index = i;
      const fn = middlewares[i];
      if (!fn) return; // end of the chain
      return fn(ctx, () => dispatch(i + 1));
    };
    return dispatch(0);
  };
}
```

The example chains a logger, an auth check and a handler, and runs it twice, once with a user and once without:

```text
--- Middleware (chain of responsibility)
  1 before: logger sees /secret
  2 auth   : user ok
  3 handler runs for ada
  1 after : logger sees status 200
  ---
  1 before: logger sees /secret
  2 auth   : no user, stop here
  1 after : logger sees status 401
```

Read the order: "1 before", then deeper steps, then "1 after". Code after `await next()` runs on the way back out, like an onion. In the second run `auth` never calls `next()`, so the handler never runs, yet the logger still gets its "after" turn. That is **short-circuiting**.

### Pub/sub

**Publish/subscribe** looks like the observer pattern, but a **broker** sits between the two sides. Publishers send messages to a named **topic**; subscribers register interest in topics. Neither side knows the other exists.

| | Observer | Pub/sub |
|---|---|---|
| Who knows whom | subject keeps a list of its observers | nobody knows anybody, they only know the broker and topic names |
| Where | usually inside one process | can cross processes and machines (Redis, RabbitMQ, Kafka, NATS) |
| Delivery | direct call, synchronous | usually asynchronous, sometimes stored for later |

```js
class Broker {
  #subs = new Map(); // topic -> Set of handlers
  subscribe(topic, handler) {
    if (!this.#subs.has(topic)) this.#subs.set(topic, new Set());
    this.#subs.get(topic).add(handler);
    return () => this.#subs.get(topic).delete(handler); // returns an unsubscribe function
  }
  async publish(topic, message) {
    const wildcard = topic.split('.')[0] + '.*';
    const handlers = [...(this.#subs.get(topic) ?? []), ...(this.#subs.get(wildcard) ?? [])];
    // allSettled: one failing subscriber must not stop the others.
    // The async wrapper turns a plain "throw" inside a handler into a rejected promise too.
    const results = await Promise.allSettled(handlers.map(async (h) => h(message)));
    return results.filter((r) => r.status === 'rejected').length;
  }
}
```

```text
--- Pub/sub
  billing  got orders.created: { id: 7 }
  temp     got: { id: 7 }
  audit    got an orders.* message: { id: 7 }
  subscribers that failed: 1
  billing  got orders.created: { id: 8 }
  audit    got an orders.* message: { id: 8 }
  (the temp subscriber is gone after unsubscribe)
```

Notice that the "shipping service is down" subscriber threw, yet billing, the temporary subscriber and audit all still got the message. A plain `EventEmitter` would have stopped at the throwing listener.

The `async` wrapper in `handlers.map(async (h) => h(message))` is not decoration. Without it, a synchronous `throw` inside `map` escapes `Promise.allSettled` and crashes the program, because `allSettled` only collects rejected promises. It cannot catch an exception thrown while the array is still being built.

> **Interview tip:** be ready to say that Redis Pub/Sub is fire-and-forget: if no subscriber is connected at that moment, the message is gone. When messages must not be lost you need a broker that stores them (RabbitMQ queues, Kafka, SQS, Redis Streams). Lesson 13 shows pub/sub used to scale WebSocket servers.

## 8. Repository and unit of work

### Repository

A **repository** is an object that looks like a collection of domain objects (`add`, `findById`, `findByEmail`) and hides how they are stored. You already met it in section 2: `InMemoryUserRepository` is a repository, and the service neither knows nor cares that it is backed by a `Map`.

Why it is worth having:

- **Swap the storage** (SQL to Mongo, real database to in-memory fake) without touching the rules.
- **Test the service quickly** with a fake repository, as in Part 2 of example 01.
- **One place for queries.** Name the methods after the question the business asks (`findOverdueInvoices`), not after the table (`find({ where: ... })`).

Two traps:

- Do not return ORM objects or SQL details to the service. An **ORM** (object-relational mapper) is a library that maps database rows to objects, such as Prisma or Sequelize. If its objects leak into the rules, the storage has leaked into the rules and the layer boundary is gone.
- Do not build one giant generic `Repository<T>` with thirty methods that every class must implement (interface segregation again).

Lesson 17 has the real-database version of this pattern.

### Unit of work

A **unit of work** tracks all the changes made during one business operation and writes them together, in one **transaction**, or not at all. (A transaction is a group of database changes that either all happen or none do.) The classic example is a bank transfer: subtract from one account, add to another. If the second step fails, the first must be undone.

The example keeps changes in a working copy and applies them only on `commit()`. If an error is thrown before that, `commit()` is never called and the working copy is simply dropped, so nothing changed:

```js
class UnitOfWork {
  #store;
  #work;
  constructor(store) {
    this.#store = store;
    this.#work = new Map(store); // working copy
  }
  get(key) { return this.#work.get(key); }
  set(key, value) { this.#work.set(key, value); }
  commit() {
    this.#store.clear();
    for (const [k, v] of this.#work) this.#store.set(k, v);
  }
}

async function transfer(store, from, to, amount) {
  const uow = new UnitOfWork(store);
  uow.set(from, uow.get(from) - amount);
  if (uow.get(from) < 0) throw new Error(`insufficient funds in ${from}`);
  uow.set(to, uow.get(to) + amount);
  uow.commit();
}
```

```text
--- Part 3: unit of work (all changes together, or none)
after a good transfer  : { alice: 70, bob: 50 }
transfer failed        : insufficient funds in bob
after a failed transfer: { alice: 70, bob: 50 } (unchanged)
```

With a real database this is `BEGIN`, several statements, then `COMMIT` or `ROLLBACK` (lesson 17). ORMs call it a transaction (Prisma `$transaction`, Sequelize and TypeORM transactions).

Two practical points for Node:

- Every query of the transaction must use the **same connection** from the pool. So pass the transaction object explicitly to the repositories, or carry it with `AsyncLocalStorage`.
- Never leave a transaction open across a slow network call. It holds locks and a pool connection the whole time.

> **Interview tip:** "How do two repositories take part in one transaction?" Strong short answer: the service (or a unit-of-work object) opens the transaction, hands the same transaction object to both repositories, and commits or rolls back once at the end. The repositories never open their own. The honest limit: a transaction covers one database. Across a database and a broker, or across services, you need the outbox (section 9) or a saga (section 22).

## 9. Event-driven architecture and message queues

In **event-driven architecture** the parts of a system talk by sending **messages** instead of calling each other directly and waiting for the answer. A **producer** puts a message somewhere, a **broker** (the middleman that stores and routes messages) holds it, and a **consumer** picks it up, maybe a second later, maybe on another machine.

Why teams do this:

- **Decoupling.** The code that places an order does not know about emails, invoices or analytics. New reactions are added without editing it.
- **Absorbing spikes.** A queue is a buffer. A traffic burst fills the queue; workers drain it at their own pace.
- **Reliability.** If a consumer is down or fails, the message waits and is retried.
- **Keeping requests fast.** Slow work (sending mail, resizing an image) is moved out of the HTTP request.

Two kinds of message are worth telling apart. A **command** says "do this" ("ResizeImage") and goes to one handler. An **event** says "this happened" ("OrderPlaced", always past tense) and anyone may react.

### Three shapes of messaging

1. **Work queue (competing consumers).** Many workers read from one queue; each message is processed by **one** of them. Used to spread work.
2. **Publish/subscribe (fan-out).** Every subscriber, or every group of subscribers, gets its **own copy** of each message.
3. **Log.** An append-only, ordered list of messages. Consumers remember their own position (an **offset**) and can read old messages again.

### The tools you will be asked about

| Tool | What it is | What to remember |
|---|---|---|
| **RabbitMQ** | a message broker (speaks AMQP, a standard messaging protocol). Producers publish to an **exchange**, which routes to **queues**; consumers acknowledge ("ack") each message | flexible routing (direct, topic, fanout), per-message ack, a **prefetch** limit for flow control, dead-letter exchanges. A message leaves the queue once acked |
| **Apache Kafka** | a distributed commit **log**. A topic is split into **partitions** | order is guaranteed only **inside one partition** (messages with the same key go to the same partition). Consumer groups share the partitions. Messages are kept for a retention period, so they can be replayed. Very high throughput |
| **Amazon SQS** | a managed queue service | a **standard** queue gives at-least-once delivery and no strict order; a **FIFO** queue keeps order per message group. A received message is hidden for a **visibility timeout**; if you do not delete it in time it comes back. After too many receives it can move to a dead-letter queue |
| **BullMQ** | a Node.js library for job queues, stored in Redis | `queue.add(name, data, { attempts, backoff, delay })`, a `Worker` with `concurrency`, scheduled repeating jobs (called repeatable jobs in older docs, job schedulers in current ones). Needs a running Redis |

A rough guide to choosing: simple background jobs in a Node app that already has Redis, use BullMQ. On AWS and want it managed, SQS (with SNS for fan-out). Complex routing rules, RabbitMQ. High-volume event streams, many independent consumers, or replay, Kafka.

Here is the BullMQ shape. It is an illustration, because third-party libraries are not part of the runnable examples:

```js
// Illustration only. Needs: npm install bullmq   (and a running Redis server)
const { Queue, Worker } = require('bullmq');
const connection = { host: '127.0.0.1', port: 6379 };

async function enqueue() {
  const emails = new Queue('emails', { connection });
  await emails.add('welcome', { to: 'ada@example.com' }, {
    attempts: 3,                                   // try up to 3 times
    backoff: { type: 'exponential', delay: 1000 }, // wait 1 s, then 2 s, then 4 s ... (2^(n-1) x delay)
  });
}

// The consumer is usually a separate process
new Worker('emails', async (job) => {
  await sendWelcomeEmail(job.data.to); // if this throws, BullMQ schedules a retry
}, { connection, concurrency: 5 });
```

In BullMQ a job that has used all its attempts stays in the queue's **failed** set, where you can inspect it and retry it. That set plays the role of a dead-letter list.

### Keeping a queue healthy

A queue that nobody watches fails silently. These are the numbers that tell you something is wrong:

- **Queue depth** (how many messages wait) and the **age of the oldest message**. Rising depth means workers are too slow; the age tells you how late the work already is.
- **Consumer lag** (Kafka): how far each consumer group is behind the newest message in each partition.
- **Dead-letter queue size.** Alert when it is above zero.
- **Retry rate and processing time.** A jump in retries is often the first sign that a dependency is struggling.

Messages also outlive the code that wrote them, so treat the message format like a public API (section 14): add fields, do not rename or remove them, put a `type` and a `version` in every message, and make consumers ignore fields they do not know.

**Webhooks** are the same idea over plain HTTP. The sender calls your URL and retries until it gets a 2xx answer, so you get at-least-once delivery. A good receiver checks the signature of the request, answers quickly (put the real work on a queue), and is idempotent.

### The dual-write problem and the outbox pattern

A very common bug: a service saves an order in its database **and** publishes an `OrderPlaced` event. These are two separate systems, so a crash between the two steps leaves them disagreeing (order saved, event never sent). You cannot wrap a database and a broker in one transaction.

The fix is the **outbox pattern**. In the **same database transaction** you write the order and a row in an `outbox` table. A separate **relay** process reads unsent outbox rows, publishes them, and marks them sent. A crash can now only cause a **duplicate** publish, never a lost one. That means consumers must be **idempotent** (running the same message twice has the same effect as running it once, see section 11). Try it yourself in task 3 at the end of the lesson.

Two variations you may hear about: instead of a relay that polls the table, some teams read the database's own change log (**change data capture**, CDC, with tools such as Debezium). And the mirror image on the receiving side is an **inbox** table: the consumer stores each message id in the same transaction as its work, which is the first idempotency technique in section 11.

> **Interview tip:** "You save to the database and publish an event. What can go wrong, and how do you fix it?" Strong short answer: the two writes are not atomic, so a crash between them loses the event (or publishes an event for data that was rolled back). Fix it with a transactional outbox: write the event row in the same transaction, publish from it later, accept duplicates, and make the consumer idempotent.

## 10. A job queue with retries and a dead-letter list

Let us build the core of such a queue to see that there is no magic. `examples/06-job-queue.js` has a `JobQueue` with these features: a handler function, concurrency, a maximum number of attempts, exponential backoff between attempts, a dead-letter list, and an optional limit on how many jobs may wait.

The heart of it is the method that runs one job:

```js
async #run(job) {
  job.attemptsMade++;
  try {
    await this.#handler(job);
    this.done.push(job.id);
  } catch (err) {
    if (job.attemptsMade >= this.attempts) {
      this.dead.push({ id: job.id, name: job.name, error: err.message, attempts: job.attemptsMade });
      return; // out of attempts: into the dead-letter list
    }
    const delay = this.backoffMs * 2 ** (job.attemptsMade - 1); // 100, 200, 400, ...
    this.clock.setTimeout(() => {
      this.#waiting.push(job); // after the delay the job goes back in line
      this.#pump();
    }, delay);
  }
}
```

The demo adds three jobs: one that works, one that fails twice and then works (`flaky`), and one that always fails (`broken`). Time is fake, so the timestamps are exact:

```text
--- Part 1: retries with exponential backoff, then the dead-letter list
  t=  0 job 1 (ok) attempt 1: success
  t=  0 job 2 (flaky) attempt 1: failed (temporary glitch), retry in 100 ms
  t=  0 job 3 (broken) attempt 1: failed (always fails), retry in 100 ms
  t=100 job 2 (flaky) attempt 2: failed (temporary glitch), retry in 200 ms
  t=100 job 3 (broken) attempt 2: failed (always fails), retry in 200 ms
  t=300 job 2 (flaky) attempt 3: success
  t=300 job 3 (broken) attempt 3: failed, out of attempts -> dead-letter list
  finished job ids: [ 1, 2 ]
  dead-letter list: [ { id: 3, name: 'broken', error: 'always fails', attempts: 3 } ]
```

Read it top to bottom. The waits grow: 100 ms after the first failure, 200 ms after the second. `flaky` succeeds on its third try. `broken` has no attempts left, so it lands in `queue.dead` instead of being retried forever.

A **dead-letter queue (DLQ)** is the place where messages go when they cannot be processed after the allowed number of tries. Without one, a **poison message** (one that always fails) would be retried forever, burn CPU, and block the workers behind it. With one, the rest of the traffic keeps flowing and you can inspect the failures later. A good DLQ practice list:

- **Alert** when the DLQ is not empty. A silent DLQ is just a place where data goes to die.
- Keep the **original message, the error and the attempt count** (the example does).
- After you fix the bug, **redrive**: move the messages back to the main queue.
- Retry only **transient** errors (network blips, 503). A permanent error, such as a validation failure, will never succeed, so send it straight to the DLQ.

The second part shows what a queue should do when producers are faster than workers. Instead of growing without limit, a bounded queue pushes back:

```text
--- Part 2: a bounded queue pushes back instead of growing forever
  job 1: accepted
  job 2: accepted
  job 3: accepted
  job 4: rejected (QueueFullError: queue is full (2 waiting)) -> the API would answer 503 or 429
  jobs finished: 3
```

Job 1 starts at once, jobs 2 and 3 fill the waiting room, and job 4 is refused. The producer can now react (return an error, wait, or drop the work). Section 21 comes back to this.

> **Interview tip:** "Design a simple job queue." A strong short answer lists the parts in order: producers add jobs; workers take them with a concurrency limit; a failed job is retried with exponential backoff up to N attempts; after that it goes to a dead-letter queue and someone is alerted; the queue has a size limit so overload is rejected, not buffered; jobs are idempotent because delivery is at-least-once. This example has every part except **persistence**. It lives in memory, so a restart loses every waiting job. A real queue stores jobs in Redis or a database.

## 11. Delivery guarantees and idempotent consumers

When a broker hands a message to a consumer, three promises are possible:

| Guarantee | Meaning | How it happens | Risk |
|---|---|---|---|
| **At-most-once** | delivered zero or one time | the message is acknowledged **before** the work (or the broker never redelivers) | the message can be **lost** |
| **At-least-once** | delivered one or more times | the message is acknowledged **after** the work; no ack means redeliver | the message can be **duplicated** |
| **Exactly-once** | processed exactly one time | see below | usually only true inside one system |

At-least-once is the default of almost every real system (SQS standard queues, RabbitMQ with manual acks, Kafka consumers that commit after processing). The reason is the "two generals" problem: after you finish the work and send the ack, you can never be sure the ack arrived. If the broker cannot tell, it must choose between possibly losing the message (at-most-once) and possibly repeating it (at-least-once). Most businesses choose repeating.

Example `06-job-queue.js` (part 3) simulates this with a tiny broker that redelivers a message until it is acknowledged. A consumer can die between its two steps, "do the work" and "send the ack". On the first delivery of `m2` it dies right there:

```js
function runBroker(messages, consumer) {
  for (const msg of messages) {
    let acked = false;
    for (let delivery = 1; delivery <= 3 && !acked; delivery++) {
      try {
        consumer(msg, () => (acked = true), delivery);
      } catch {
        // The consumer crashed. If it had not acked yet, the broker delivers the message again.
      }
    }
  }
}
```

```text
--- Part 3: at-most-once, at-least-once, and an idempotent consumer
  at-most-once  (ack, then work): m1, m3  <- m2 is LOST
  at-least-once (work, then ack): m1, m2, m2, m3  <- m2 is DUPLICATED
  at-least-once + idempotent    : m1, m2, m3  <- every message handled once
```

The same trade-off exists in real clients:

- **Kafka:** a consumer that commits its offset (its saved position in the log) **before** processing is at-most-once. One that commits **after** is at-least-once.
- **SQS:** a consumer that deletes the message after the work is at-least-once.
- **RabbitMQ:** a consumer with automatic acknowledgement is at-most-once. With a manual ack after the work it is at-least-once.

### Idempotent consumers: the real answer to "exactly-once"

An operation is **idempotent** if doing it twice has the same result as doing it once. If every consumer is idempotent, at-least-once delivery behaves like exactly-once in effect. Three ways to get there:

1. **Remember processed message ids.** Keep a table with a unique constraint on the message id. Insert the id **in the same database transaction** as the work. A second delivery hits the constraint and is skipped (the third example line above).
2. **Make the operation naturally idempotent.** "Set the order status to `paid`" is safe to repeat. "Add 10 to the balance" is not. Prefer writing the final state, or write with a unique key (an `INSERT ... ON CONFLICT DO NOTHING`).
3. **Use a version check.** `UPDATE ... WHERE version = 5` only works once, because the first run changes the version.

> **Interview tip:** "Can you get exactly-once delivery?" The strong answer: not across a network in general. Some systems offer exactly-once **within their own boundary** (for example Kafka transactions between Kafka topics). The moment a side effect leaves that boundary (a database write, an email, a payment), you need at-least-once delivery plus an idempotent consumer, which gives exactly-once **processing in effect**. Say that sentence and you pass this question.

Two more things interviewers like to hear:

- **Ordering is not free.** Standard queues do not promise order. Kafka orders messages per partition, and SQS FIFO per message group. Design consumers so that order does not matter, or carry a version number in each message and ignore stale ones.
- **Mind the visibility timeout.** If a job takes longer than the broker waits for the ack (SQS visibility timeout, RabbitMQ consumer timeout), the broker will deliver it to a second worker while the first is still working. Keep jobs shorter than the timeout, or extend the timeout while working, and be idempotent anyway.

## 12. Scheduling and cron jobs

Many systems need work on a schedule: send a daily report, clean old sessions, retry failed payments every five minutes. Node gives you `setTimeout` and `setInterval`. They work, but have traps. Example `07-scheduling.js` shows each one.

### Part 1: setInterval overlaps and drifts

`setInterval(job, 100)` means "start `job` every 100 ms". It does **not** wait for an async job to finish. If the job takes longer than the interval, runs pile up on top of each other. The example models three styles with the fake clock (a job that takes 30 ms, except in A):

```text
--- Part 1: interval styles (fake clock, job takes 30 ms)
  A. setInterval style, job takes 150 ms: most runs at the same time = 2
  B. wait 100 ms after each run  starts at: 0, 130, 260, 390, 520
  C. self-correcting             starts at: 0, 100, 200, 300, 400
```

- **A** starts a run every 100 ms no matter what, so a 150 ms job overlaps with the next run. Two copies run at once: double load, and two writers touching the same data.
- **B** waits for the job and then sleeps 100 ms. No overlap, but each run starts 30 ms later than the last one, so the schedule **drifts**.
- **C** works out the next ideal start time (`start + n * 100`) and sleeps only the difference. No overlap and no drift.

Real timers also fire slightly late (a timer is a minimum delay, lesson 08), and a late run pushes everything after it (measured on Node 24: an interval run that fired about 55 ms late moved the following runs by the same amount; the exact numbers vary from run to run). Over days a `setInterval` schedule slips. So do not use plain timers when the exact moment matters ("at 09:00 every day").

More limits of timers:

- A delay larger than about 24.8 days (2^31 - 1 ms) is not supported. Node prints a `TimeoutOverflowWarning` and runs the callback after 1 ms.
- Timers live in memory. If the process restarts, the schedule is gone, and a job that was due during the restart is skipped.
- If you run three instances of the app, all three run the job.

### Part 2: how cron works

**Cron** is the classic way to say "when to run" using five fields:

```text
 minute  hour  day-of-month  month  day-of-week
   0-59  0-23      1-31      1-12      0-6 (0 = Sunday)

*/15 * * * *      every 15 minutes
0 9 * * 1-5       09:00 on weekdays (Monday to Friday)
30 2 * * 0        02:30 on Sundays
0 0 1 * *         midnight on the 1st of each month
```

A field can be `*` (any), a number, a range `1-5`, a step `*/15`, or a list `1,15`. Under the hood a simple scheduler wakes up once a minute and asks "does the current time match this expression?" (many libraries instead work out the next matching time and set one timer for it, but the matching rules are the same). The example has a 25-line matcher and a once-a-minute loop (all times in UTC). It counts how often several expressions fire during Monday 9 November 2026:

```text
--- Part 2: a mini cron matcher (UTC), counting runs during Monday 2026-11-09
  * * * * *     every minute                     1440 run(s), first 00:00
  */15 * * * *  every 15 minutes                   96 run(s), first 00:00
  0 9 * * 1-5   09:00 on weekdays                   1 run(s), first 09:00
  30 2 * * 0    02:30 on Sundays                    0 run(s), never
  0 0 13 * 1    00:00 on the 13th OR on Mondays     1 run(s), first 00:00
```

The last line shows a famous cron quirk: if **both** day-of-month and day-of-week are restricted, the job runs when **either** matches (OR), not both. Monday 9 November is not the 13th, but it is a Monday, so the job still fires.

In real projects you use a library. This is an illustration:

```js
// Illustration only. Needs: npm install node-cron   (check the library's docs for the current API)
const cron = require('node-cron');

cron.schedule('0 9 * * 1-5', () => {
  console.log('send the weekday report');
}, { timezone: 'UTC' });
```

> **Common mistake:** local time zones. In time zones that use daylight saving time, a job set for 02:30 local time does not exist on the day the clocks jump forward, and may run twice (or be skipped, depending on the library) on the day they jump back. Run servers in UTC, give the schedule an explicit time zone, and make jobs idempotent.

### Part 3: only one instance should run the job

With three app instances, a cron job runs three times. Options, from simplest to most flexible:

1. **Run the scheduler in one place**: a single "scheduler" process, a Kubernetes `CronJob`, or a cloud scheduler that triggers a job once.
2. **Put the job on a queue.** A scheduler (for example BullMQ job schedulers, stored in Redis) adds the job, and exactly one worker takes it.
3. **Take a distributed lock** at the start of each run. Whoever gets the lock runs the job; the others skip.

Part 3 of the example plays the role of Redis with a `LockStore`. In Redis the acquire step is one command, **set if not exists, with an expiry**:

```text
SET lock:daily-report instance-A NX PX 30000
```

`NX` means "only if the key does not exist" and `PX 30000` means "expire after 30 000 ms". Releasing must check the owner first, atomically, with a small Lua script, so one instance never deletes another instance's lock:

```text
if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end
```

```js
class LockStore {
  #locks = new Map();
  constructor(clock) { this.clock = clock; }
  tryAcquire(key, owner, ttlMs) {
    const held = this.#locks.get(key);
    if (held && held.expiresAt > this.clock.now()) return false; // someone else holds a live lock
    this.#locks.set(key, { owner, expiresAt: this.clock.now() + ttlMs });
    return true;
  }
  release(key, owner) {
    if (this.#locks.get(key)?.owner !== owner) return false; // only the owner may release
    this.#locks.delete(key);
    return true;
  }
}
```

```text
--- Part 3: a lock with a TTL so only one instance runs the job
  t=    0 instance A: got the lock, runs the job
  t=    0 instance B: lock is held, skips
  t=    0 instance C: lock is held, skips
  ...instance A freezes (crash or long GC pause) and never releases the lock
  t=10000 instance B: lock is held, skips
  t=30000 instance C: got the lock, runs the job
  instance A wakes up and tries to release: refused (C owns it now)
```

The **TTL** (time to live) matters: if A crashes while holding the lock and there is no expiry, nobody ever runs the job again. But a TTL creates its own danger: if the job takes longer than the TTL, the lock expires while A is still working, and C starts a second copy. So lock-protected jobs should still be idempotent. Stronger setups renew the lock while working, or use a **fencing token** (a number that grows with each lock grant; the database rejects writes that carry an old number).

> **Interview tip:** "The app runs on three servers and has a cron job that sends a report. How do you make sure it is sent once?" A strong short answer: run the scheduler in one place (a single process, a Kubernetes CronJob, a cloud scheduler) or put the job on a queue so only one worker takes it. If that is not possible, take a lock with an expiry. Whatever you pick, make the job idempotent, because a lock can expire while the job is still running. Also say that a lock with an expiry is a best-effort guard, not a guarantee.

## 13. Caching strategies

A **cache** keeps a copy of data that is slow or expensive to get, in a place that is fast to read. Caches appear at several levels: the browser and a CDN (content delivery network: servers near the user that keep copies of your responses; HTTP caching, lesson 12), memory inside your process, a shared store such as Redis (lesson 17), and the database itself. This section is about the application-level cache. All of it is in `examples/08-caching.js`.

### Cache-aside with a TTL

**Cache-aside** (also called lazy loading) is the default pattern. The application checks the cache first. On a **miss** it reads the database and puts the value in the cache; on a **hit** it skips the database.

A **TTL** (time to live) makes every entry expire after a set time, so stale data cannot live forever:

```js
async function getUser(id) {
  const cached = cache.get(id);
  if (cached !== undefined) return `${cached} (from cache)`;
  const value = await db.read(id);
  cache.set(id, value, 60_000); // 60 s TTL
  return `${value} (from db)`;
}
async function renameUser(id, name) {
  await db.write(id, name); // 1. change the source of truth
  cache.delete(id); //         2. drop the stale copy; the next read refills it
}
```

```text
--- 1. Cache-aside with a 60 s TTL, and invalidation on write
  get #1      : Ada (from db) | db reads: 1
  get #2      : Ada (from cache) | db reads: 1
  after 61 s  : Ada (from db) | db reads: 2
  after rename: Ada Lovelace (from db) | db reads: 3
```

The second read never touched the database. After 61 seconds of fake time the entry expired and the database was read again. After a rename, the code deleted the cached copy, so the next read saw the new name. That delete is **invalidation**: removing or updating cache entries when the source changes. An old joke says cache invalidation is one of the two hard problems in computer science. Your tools, from weakest to strongest guarantee:

1. A short TTL (stale data is allowed, but only briefly).
2. Delete on write (the code above).
3. Versioned keys (`user:1:v7`): a change creates a new key, so the old one is never read again.
4. Change events that tell every instance to drop its copy.

> **Common mistake:** a race can still leave stale data. Reader A reads the old value from the database, the writer updates the database and deletes the cache entry, then reader A puts its old value into the cache. It stays wrong until the TTL ends. This is one reason to always keep a TTL as a safety net.

### Eviction: LRU

A cache must not grow without limit (an unbounded `Map` used as a cache is a memory leak, lesson 19). **Eviction** decides what to throw away when it is full. **LRU** (least recently used) throws away the entry that was used longest ago. A JavaScript `Map` remembers insertion order, which makes LRU about 15 lines:

```js
class LruCache {
  #map = new Map();
  constructor(max) { this.max = max; }
  get(key) {
    if (!this.#map.has(key)) return undefined;
    const value = this.#map.get(key);
    this.#map.delete(key); // re-insert so this key becomes the NEWEST
    this.#map.set(key, value);
    return value;
  }
  set(key, value) {
    this.#map.delete(key);
    this.#map.set(key, value);
    if (this.#map.size > this.max) this.#map.delete(this.#map.keys().next().value); // evict the oldest
  }
}
```

```text
--- 2. LRU cache with room for 3 entries
  after set a, b, c      : a b c (oldest first)
  after get a            : b c a
  after set d (b evicted): c a d
```

Reading `a` moved it to the "newest" end, so when `d` arrived, `b` was the oldest and was evicted. Other policies: **LFU** (least frequently used) and **FIFO** (oldest inserted first). Redis does eviction for you: you set a memory limit (`maxmemory`) and a policy (`maxmemory-policy`, for example `allkeys-lru`).

### Write-through and write-behind

What should happen on a **write**? There are four common answers:

| Strategy | On write | Good | Bad |
|---|---|---|---|
| **Cache-aside** (write) | write the database, then delete the cache entry | simple, the cache holds only what is read | the next read is a miss |
| **Write-through** | write the cache and the database together; the caller waits for both | cache is always fresh, no data loss | slower writes |
| **Write-behind** (write-back) | write the cache now, the database later in a batch | very fast writes, fewer database writes | a crash loses data that was not flushed yet |
| **Write-around** | write the database only, skip the cache | does not fill the cache with data nobody reads | the first read is a miss |

```text
--- 3. Write-through vs write-behind
  write-through: 3 writes -> 3 db writes, db has p = 3
  write-behind : 3 writes -> db writes right now: 0 (a crash here would lose them)
  write-behind : after the 1 s flush -> db writes: 1, db has p = 3
```

Write-behind turned three writes to the same key into one database write (only the latest value is kept). That is its big win and its big risk.

### Cache stampede: protect the database with promise coalescing

A **cache stampede** (or thundering herd, or dogpile) happens when a popular key expires and many requests miss at the same moment. Every one of them goes to the database to rebuild the same value. One expired key can send hundreds of identical queries and knock the database over.

The fix that fits Node perfectly is **promise coalescing** (also called request deduplication, or single-flight). While a load for a key is already running, new callers do not start their own. They share the **same promise**:

```js
function coalesce(load) {
  const inflight = new Map();
  return (key) => {
    if (inflight.has(key)) return inflight.get(key);
    const promise = load(key).finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  };
}
```

```text
--- 4. Cache stampede: 10 requests for the same missing key at once
  naive cache-aside      : db reads = 10
  with promise coalescing: db reads = 1
  failing load           : 10 callers rejected with: db is down
```

Ten simultaneous requests caused ten database reads in the naive version and only one with coalescing. If the one shared load fails, every waiting caller gets the same error, and because the entry is removed in `finally`, the next call tries again.

Coalescing works **inside one process**. With ten app instances you still get up to ten loads. More tools:

- **TTL jitter:** add a random part to every TTL (60 s plus or minus 10 percent). Keys written at the same moment then do not all expire at the same moment. Many keys expiring together is sometimes called a **cache avalanche**.
- **Stale-while-revalidate:** serve the old value while one request refreshes it in the background.
- **A short Redis lock** for the refresh, so only one instance rebuilds the value.
- **Negative caching:** cache "not found" for a few seconds. Without it, repeated lookups of a key that does not exist skip the cache every time and hit the database (sometimes called **cache penetration**).

> **Interview tip:** before you add a cache, say what it costs: stale data, one more thing to invalidate, memory, and a new failure mode (what happens when the cache is down? the database must be able to survive the load, or you need a fallback). Per-process caches also differ between instances, so a user can see different data on two requests. A shared cache (Redis) fixes that at the price of a network hop.

## 14. API design: REST conventions

An API is a promise to people you may never meet. Change it carelessly and you break their apps. Example `09-api-design.js` is a small in-memory API that follows common conventions. It uses a pure function `handle(req)` instead of a real server so it is short and exact. Lesson 12 has the HTTP basics (methods, status codes, headers), so this section focuses on design decisions.

### Resources, verbs and status codes

REST models an API as **resources** (things, named with plural nouns) manipulated with the standard HTTP **verbs**:

| Request | Meaning | Success status | Safe? | Idempotent? |
|---|---|---|---|---|
| `GET /v1/books` | list books | 200 | yes | yes |
| `GET /v1/books/6` | read one | 200 | yes | yes |
| `POST /v1/books` | create | **201** + `Location` header | no | **no** |
| `PUT /v1/books/6` | replace the whole book | 200 or 204 | no | yes |
| `PATCH /v1/books/6` | change some fields | 200 | no | not guaranteed |
| `DELETE /v1/books/6` | remove | **204** (no body) | no | yes |

"Safe" means it does not change anything. "Idempotent" means repeating it leaves the same final state. A second `DELETE` of the same book returns 404 instead of 204, but the state is the same (the book is gone), so `DELETE` is still idempotent. Put verbs in the HTTP method, not in the URL: `POST /v1/books`, not `/v1/createBook`.

Status codes you should use with confidence (the example below produces 200, 201, 204, 400, 404, 405, 422 and 500; the other rows are here so you know them):

| Code | Name | When |
|---|---|---|
| 200 | OK | success with a body |
| 201 | Created | a resource was created; send its URL in `Location` |
| 202 | Accepted | the work was accepted but is not finished; send a status URL in `Location` (see "Slow work" below) |
| 204 | No Content | success, nothing to send back |
| 400 | Bad Request | the request is malformed (broken JSON, invalid cursor) |
| 401 / 403 | Unauthorized / Forbidden | not logged in / logged in but not allowed |
| 404 | Not Found | no such resource or route |
| 405 | Method Not Allowed | the URL exists but not for this verb; send an `Allow` header |
| 409 | Conflict | the request clashes with current state (duplicate email) |
| 412 | Precondition Failed | an `If-Match` condition was not met (see "Lost updates" below) |
| 422 | Unprocessable Content | the request is well-formed but fails validation |
| 429 | Too Many Requests | rate limited; send `Retry-After` |
| 500 / 503 | Internal Server Error / Service Unavailable | your bug / temporarily overloaded or down |

The line between 400 and 422 is a convention that differs between teams. Pick one rule, document it, and use it everywhere.

### Filtering and pagination

Collections need filtering (`?genre=scifi`), sorting (`?sort=-year`, a leading minus meaning descending) and **pagination** (never return an unbounded list). Only accept filter and sort fields from an allow-list; never paste client-supplied names into a query.

There are two ways to paginate. **Offset pagination** (`?page=3&limit=20`) is simple but slow for deep pages (the database still walks past all skipped rows) and unstable when rows are added or removed while someone is paging (items get skipped or repeated). **Cursor pagination** (also called keyset pagination) says "give me the rows after the last one I saw", using an **opaque cursor** that the server hands out. It is fast and stable, but you cannot jump to page 50. Lesson 17 compares them with real SQL. The example uses a cursor and caps `limit` at 50:

```text
=== collection, filtering and cursor pagination
GET /v1/books?genre=scifi&limit=2
  -> 200 application/json
   {"data":[{"id":1,"title":"Dune","genre":"scifi","year":1965},{"id":2,"title":"Neuromancer","genre":"scifi","year":1984}],"page":{"limit":2,"nextCursor":"eyJpZCI6Mn0"},"_links":{"self":"/v1/books?genre=scifi&limit=2","next":"/v1/books?genre=scifi&limit=2&after=eyJpZCI6Mn0"}}
GET /v1/books?genre=scifi&limit=2&after=eyJpZCI6Mn0
  -> 200 application/json
   {"data":[{"id":4,"title":"Foundation","genre":"scifi","year":1951},{"id":5,"title":"Hyperion","genre":"scifi","year":1989}],"page":{"limit":2,"nextCursor":null},"_links":{"self":"/v1/books?genre=scifi&limit=2","next":null}}
GET /v1/books?after=not-a-cursor
  -> 400 application/problem+json
   {"type":"about:blank","title":"Bad Request","status":400,"detail":"the \"after\" cursor is not valid","instance":"/v1/books"}
```

The cursor `eyJpZCI6Mn0` is just the JSON `{"id":2}` encoded in base64url. The client must treat it as meaningless text, which leaves you free to change what is inside later. Book 3 (`Emma`, a classic) was skipped by the filter, and the second page ends with `nextCursor: null`.

The `_links` part is a taste of **HATEOAS** (Hypermedia As The Engine Of Application State): the response tells the client where it can go next, so clients follow links instead of building URLs. It is the top step of the Richardson maturity model of REST (level 0: one endpoint; level 1: resources; level 2: verbs and status codes; level 3: hypermedia). Most real APIs stop at level 2, plus pagination links.

### Errors: problem details (RFC 9457)

Every API invents an error format unless you pick one. **RFC 9457, "Problem Details for HTTP APIs"** (it replaced RFC 7807) is the standard one. The media type is `application/problem+json`, and these members are defined:

| Member | Meaning |
|---|---|
| `type` | a URI that identifies the kind of problem (default `about:blank`, which means "just use the HTTP status") |
| `title` | a short, human-readable summary of the problem type |
| `status` | the HTTP status code |
| `detail` | an explanation of this specific occurrence |
| `instance` | a URI for this specific occurrence |

You may add **extension members**, such as an `errors` list for validation:

```text
=== create, read, delete
POST /v1/books
  -> 201 application/json | location: /v1/books/6
   {"id":6,"title":"Solaris","genre":"scifi","year":1961}
POST /v1/books
  -> 422 application/problem+json
   {"type":"https://api.example.com/problems/validation-error","title":"Your request parameters are invalid","status":422,"detail":"2 field(s) failed validation","instance":"/v1/books","errors":[{"field":"title","message":"is required"},{"field":"year","message":"must be a whole number"}]}
GET /v1/books/6
  -> 200 application/json
   {"id":6,"title":"Solaris","genre":"scifi","year":1961}
DELETE /v1/books/6
  -> 204 (no body)
DELETE /v1/books/6
  -> 404 application/problem+json
   {"type":"about:blank","title":"Not Found","status":404,"detail":"book 6 does not exist","instance":"/v1/books/6"}
```

Notice `201` with a `Location` header, `204` with no body, and the repeated `DELETE` that answers 404. Wrong routes, wrong methods and bugs use the same shape:

```text
=== wrong route, wrong method, server bug
GET /v1/shelves
  -> 404 application/problem+json
   {"type":"about:blank","title":"Not Found","status":404,"detail":"no route for /v1/shelves","instance":"/v1/shelves"}
PUT /v1/books
  -> 405 application/problem+json | allow: GET, POST
   {"type":"about:blank","title":"Method Not Allowed","status":405,"detail":"PUT is not allowed here","instance":"/v1/books"}
GET /v1/boom
  -> 500 application/problem+json
   {"type":"about:blank","title":"Internal Server Error","status":500,"detail":"something went wrong on our side"}
```

The `/v1/boom` route throws an error whose message contains a database password. The client sees only a generic message. **Never send stack traces, SQL or connection strings to the client**; log them on the server.

### Idempotency keys: making POST safe to retry

`POST` is not idempotent, which is a problem. A client sends "charge 5.00", the network drops the answer, and the client cannot tell whether the charge happened. If it retries, it may charge twice. An **idempotency key** fixes this. The client generates a unique value (a UUID) and sends it in an `Idempotency-Key` header. The server stores, per key, a fingerprint of the request and the response it produced:

- **First request with a key:** do the work, store the response.
- **Same key and same body again:** do **not** repeat the work; return the stored response.
- **Same key but a different body:** that is a client bug; answer with an error (here 422).

```text
=== idempotency key
POST /v1/payments
  -> 400 application/problem+json
   {"type":"about:blank","title":"Bad Request","status":400,"detail":"the Idempotency-Key header is required","instance":"/v1/payments"}
POST /v1/payments
  -> 201 application/json
   {"id":"pay_1","amount":500}
POST /v1/payments
  -> 201 application/json | idempotent-replayed: true
   {"id":"pay_1","amount":500}
POST /v1/payments
  -> 422 application/problem+json
   {"type":"about:blank","title":"Idempotency key reused","status":422,"detail":"this key was first used with a different request body","instance":"/v1/payments"}
charges actually made: 1
```

Three requests used the key `abc-1`, but only one charge was made.

Facts to know about the header:

- The name `Idempotency-Key` was popularised by payment APIs. It is described in an IETF Internet-Draft (`draft-ietf-httpapi-idempotency-key-header`). It was still a draft, not an RFC, when this lesson was checked in November 2026.
- The draft uses 422 for a reused key with a different body (as the example does) and 409 for a request that is still in progress.
- In production the key store is a database table with a unique constraint, written in the same transaction as the side effect, with an expiry (for example 24 hours).
- A second request that arrives while the first is **still running** needs an "in progress" state and should get `409 Conflict`. The in-memory example is synchronous, so it cannot show that race.

> **Interview tip:** "Is POST idempotent? How do you make a payment endpoint safe to retry?" Strong answer: no, POST is not idempotent by definition; the client sends an `Idempotency-Key`, the server stores the key with a fingerprint of the request and the response, and replays that response on a repeat instead of doing the work again.

### Slow work: 202 Accepted

If creating something takes longer than a request should wait (a report, a video conversion), do not hold the connection open. Answer **202 Accepted** with a `Location` header that points at a **status resource**, for example `/v1/reports/17`. The client polls that URL (or you call its webhook when the work is done). The work itself runs on a job queue (section 10). When the job has finished, the status resource says so and links to the result.

### Lost updates: ETag and If-Match

Two users load the same book, both edit it, and both send `PUT`. The second `PUT` silently overwrites the first. That is a **lost update**. The fix is **optimistic concurrency** (no locks; the server just checks that nothing changed in between):

```http
GET /v1/books/6            ->  200, ETag: "v7"
PUT /v1/books/6            If-Match: "v7"   ->  200 (stored version is still v7, update applied, new ETag "v8")
PUT /v1/books/6            If-Match: "v7"   ->  412 Precondition Failed (stored version is now v8)
```

The `ETag` is a version label for the current state of the resource. The client sends it back in `If-Match`. If the stored version has moved on, the server answers **412 Precondition Failed** and the client must reload and decide again. This is the same idea as the version check in section 11. (This block is an illustration of the HTTP exchange, not output of the example.) The same `ETag` also powers cheap reads: `If-None-Match` on a `GET` gets `304 Not Modified` with no body when nothing changed.

### Versioning and not breaking clients

| Approach | Example | Notes |
|---|---|---|
| URL path | `/v1/books` | the most common: visible, easy to route, easy to test in a browser |
| Header | `Accept: application/vnd.example.v2+json` | clean URLs, but harder to try by hand |
| Query | `/books?version=2` | rare |

Better than versioning is not breaking anything: **adding** fields is safe, **removing or renaming** them is not, and clients should ignore fields they do not know. Introduce `/v2` only when forced to and keep `/v1` running for a published period. Announce the change with a `Deprecation` response header (RFC 9745), the end date with a `Sunset` header (RFC 8594), and release notes.

## 15. REST, GraphQL, gRPC and tRPC

"Which API style would you use?" is a standard question. The honest answer is a comparison:

| | REST | GraphQL | gRPC | tRPC |
|---|---|---|---|---|
| **Transport** | HTTP | HTTP, usually one `POST /graphql` | HTTP/2 | HTTP |
| **Data format** | JSON (usually) | JSON | Protocol Buffers (binary) | JSON |
| **Contract** | optional (OpenAPI) | a typed schema, always | a `.proto` file, always | TypeScript types shared by both sides |
| **Who shapes the response** | the server (fixed per endpoint) | the client asks for exact fields | the server (fixed messages) | the server |
| **HTTP caching / CDN** | works naturally | hard (POST, varying queries) | not applicable | limited |
| **Streaming** | via SSE or WebSockets | subscriptions | built in (server, client, bidirectional) | via subscriptions |
| **Browsers** | everywhere | everywhere | needs gRPC-Web and a proxy | everywhere (TypeScript only) |
| **Strong point** | simple, universal, cacheable | no over-fetching, one request for a screen | fast, small, clients built from the schema, streaming | end-to-end types with no codegen |
| **Watch out for** | many round trips, over- and under-fetching | N+1 resolvers (one database query per item instead of one query for all of them, see lesson 17 section 9; fix with batching such as DataLoader), expensive queries (limit depth and cost) | harder to debug by eye, browser friction | both ends must be TypeScript; poor fit for public APIs |

When to choose what:

- **REST** is the default for public APIs and simple services. Everyone can call it with `curl`.
- **GraphQL** fits when many different clients (web, mobile, partners) need different slices of the same graph-shaped data, or as a BFF (section 16) that hides many back-end calls from the front end.
- **gRPC** fits service-to-service calls inside your system, where speed, small messages, ready-made clients and streaming matter. In Node the usual package is `@grpc/grpc-js`.
- **tRPC** fits a full-stack TypeScript team (often one repository) that wants type-safe calls with zero schema files. It is not an API for outsiders.

For push and two-way communication (polling, Server-Sent Events, WebSockets) and how to scale them, see [lesson 13](../13-realtime-websockets-sse/README.md).

> **Interview tip:** answer with a default and an exception: "REST for public APIs, gRPC between internal services, GraphQL when clients have very different data needs, and I would only choose tRPC if everything is TypeScript in one repo." Then name one cost for each.

## 16. Monolith, modular monolith and microservices

A **monolith** is one deployable application. **Microservices** are many small services, each deployed and scaled on its own and owning its own data. A **modular monolith** sits between: one deployable, but split inside into modules with strict boundaries.

| | Monolith | Modular monolith | Microservices |
|---|---|---|---|
| **Deploy** | one unit | one unit | each service alone |
| **Boundaries** | informal (often decay into a "big ball of mud") | enforced in code: modules talk only through public interfaces | enforced by the network |
| **Calls between parts** | function calls | function calls | network calls (slow, can fail) |
| **Transactions** | one database transaction | one database transaction | none across services: sagas, eventual consistency |
| **Scaling** | the whole app together | the whole app together | each service on its own |
| **Team autonomy** | low | medium | high |
| **Operations cost** | low | low | high: many pipelines, monitoring, versioned contracts |

The honest summary: **microservices solve an organisational and scaling problem, and create a distributed-systems problem.** A call that used to be a function call becomes a network request that is slower and can time out, and shared database tables become separate data stores that you must keep in step with events. Copies of the data are then briefly out of date on some services and catch up later. That is called **eventual consistency** (section 22 and 23). Chains also reduce availability: three services in a row that are each up 99.9 percent of the time give about 99.7 percent (0.999 x 0.999 x 0.999).

A sensible default: **start with a modular monolith** (feature folders from section 2, no module importing another module's internals, ideally each module with its own tables). Extract a service only for a concrete reason:

- a part with a very different scaling profile,
- a team that must release independently,
- a risky component you want to isolate.

Three more ideas that interviewers like:

- **Database per service.** Each service owns its data and nobody else reads its tables. If two services share a database, they are coupled through the table layout.
- **Distributed monolith.** Services that must be deployed together, or that share a database, have all the costs of microservices and none of the benefits. This is the most common way microservices go wrong.
- **Strangler fig.** To move away from an old monolith, do not rewrite it in one go. Put a proxy in front, build one slice of functionality as a new service, route that slice's traffic to it, and repeat. The old code shrinks until it can be removed.

Teams tend to build systems that copy their own communication structure (this is called Conway's law). So the service boundaries should follow the team boundaries you want, not the other way round.

> **Interview tip:** "Monolith or microservices?" Do not pick a side. Say: "I would start with a modular monolith and extract a service for a concrete reason, such as independent scaling or independent release by a separate team. Microservices add network failures, distributed data and operations cost, so I need a reason that pays for them." That sentence shows judgment.

### API gateway, BFF and service discovery

- An **API gateway** is a single entry point in front of your services. It handles routing, authentication, rate limiting and TLS, and sometimes combines several calls into one. Examples: Kong, Envoy, NGINX, or your cloud provider's gateway. Keep business logic out of it, or it becomes a new monolith and a bottleneck.
- A **BFF** (Backend For Frontend) is a small back end built for **one kind of client**: a web BFF, a mobile BFF. It calls the internal services and returns exactly the shape that client's screens need. Node.js is a popular choice for BFFs because it is good at I/O, and front-end developers already know the language.
- **Service discovery** answers "what is the address of the `orders` service right now?" when instances start, stop and move. In the **client-side** style, a registry (Consul, etcd) stores addresses and the caller picks one. In the **server-side** style, a load balancer or DNS name hides the instances. On Kubernetes you normally just call a Service name (for example `http://orders`) and the platform does discovery for you, so you write no discovery code at all.

Services talk in two styles. **Synchronous** calls (HTTP, gRPC) are simple but couple the caller to the callee's availability and speed. **Asynchronous** messaging (sections 9 to 11) decouples them at the price of eventual consistency. Mixing both is normal.

## 17. Resilience, part 1: timeouts and retries

**Resilience** is the ability of a system to keep working, perhaps in a reduced way, when some part of it fails. In a system made of many parts that talk over a network, failure is not rare. Calls fail, hang, return garbage, or succeed after the caller has already given up. The patterns in sections 17 to 21 are the standard tools. Each one is hand-written in `examples/10-resilience.js` (and `11-rate-limiting.js`) with a fake clock so the numbers are exact.

> **Remember:** a **slow** dependency is usually worse than a **dead** one. A dead one fails fast. A slow one holds your sockets, memory and promises open while requests pile up behind it, and then **your** service becomes slow for **its** callers. This chain reaction is called a **cascading failure**, and most patterns below exist to stop it.

### Timeouts

Rule number one: **every call that leaves your process needs a timeout.** Without one, a hung dependency hangs your request forever. The example wraps an operation in a timeout and also tells the operation to stop, with an `AbortSignal`:

```js
async function withTimeout(clock, ms, operation) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = clock.setTimeout(() => {
      const error = new TimeoutError(`timed out after ${ms} ms`);
      controller.abort(error);
      reject(error);
    }, ms);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    clock.clearTimeout(timer);
  }
}
```

```text
--- 1. Timeout
  fast call : answered after 50 ms (aborted=false)
  slow call : TimeoutError: timed out after 100 ms
```

`Promise.race` alone only stops **waiting**. The slow work keeps running in the background unless the operation watches the signal. That is why the signal is passed in. With real I/O, use the built-in version and pass the signal along (lesson 07 covers cancellation):

```js
// Illustration only (url is whatever you call).
const response = await fetch(url, { signal: AbortSignal.timeout(2000) }); // rejects with a TimeoutError after 2 s
```

Choose timeouts from a **budget**. If your own endpoint must answer in 3 seconds, the calls inside it need to be shorter than that in total, and the caller's timeout must be longer than yours. Passing the remaining time ("deadline") downstream is the advanced version of this.

### Retries, backoff and jitter

A **retry** repeats a failed call, because many failures are brief (a restart, a dropped packet, a 503). Retries are powerful and dangerous, so use these rules:

- Retry only **transient** errors: network errors, timeouts, `429`, `502`, `503`, `504`. Never retry `400`, `404` or `422`; the answer will not change.
- Retry only **idempotent** operations, or operations protected by an idempotency key (section 14). Retrying "charge the card" without one can charge twice.
- Set a **maximum** number of attempts and a maximum delay.
- Wait between attempts, with **exponential backoff**: the delay doubles each time (100 ms, 200 ms, 400 ms, 800 ms...), up to a cap. This gives a struggling service room to recover.
- Add **jitter**: randomness in the delay.

Why jitter? Imagine 1000 clients lose their connection at the same moment. With plain backoff they all retry after 100 ms, then all after 200 ms. The server gets a huge synchronised spike every time, which is the "thundering herd". With **full jitter** each client waits a random time between 0 and the current ceiling, so the retries spread out.

```js
async function retry(fn, { clock, retries = 4, baseMs = 100, maxMs = 2000, random = Math.random, shouldRetry = () => true, log = () => {} }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err)) throw err;
      const ceiling = Math.min(maxMs, baseMs * 2 ** attempt); // 100, 200, 400, 800, ... capped at maxMs
      const delay = Math.round(random() * ceiling); //          jitter: spread the clients out
      log(`attempt ${attempt + 1} failed (${err.message}); ceiling ${ceiling} ms, waiting ${delay} ms`);
      await clock.sleep(delay);
    }
  }
}
```

The `random` function is injected so the example can use a fixed sequence (0.5, 0.9, 0.2). Real code leaves the default `Math.random`:

```text
--- 2. Retry with backoff and jitter
  attempt 1 failed (503 service unavailable); ceiling 100 ms, waiting 50 ms
  attempt 2 failed (503 service unavailable); ceiling 200 ms, waiting 180 ms
  attempt 3 failed (503 service unavailable); ceiling 400 ms, waiting 80 ms
  result: success on attempt 4 at t=310 ms
  4xx error: gave up at once: 400 bad request
  ceiling per attempt (base 100, cap 2000): 100, 200, 400, 800, 1600, 2000, 2000
```

The ceiling doubles each time (100, 200, 400) but the actual wait is a random fraction of it (50, 180, 80). A `400` error is not retried at all. The last line shows the cap: after attempt 6 the ceiling stays at 2000 ms. Lesson 07 has a shorter promise-based retry, and lesson 14 explains when to retry and when to fail.

> **Common mistake:** **retry amplification.** If your handler retries 3 times, and each of the 3 services below it also retries 3 times, one user request can become 27 calls to the bottom service exactly when it is struggling. Retry at **one** layer (usually the outermost that knows it is safe), use a retry budget (for example, retries may be at most 10 percent of traffic), and respect a `Retry-After` header when the server sends one.

## 18. Circuit breaker

Retries help with brief failures. When a dependency is down for a longer time, retrying just adds load to something that cannot cope, and your callers wait for timeouts that will certainly come. A **circuit breaker** (named after the one in an electrical panel) notices repeated failures and **stops calling** the dependency for a while. Callers fail immediately and cheaply, and the dependency gets quiet time to recover.

It has three states:

| State | What happens | Moves to |
|---|---|---|
| **Closed** | normal: calls go through, failures are counted | **Open**, when failures reach the threshold |
| **Open** | calls fail at once with a "circuit open" error, no network call is made | **Half-open**, after the reset time has passed |
| **Half-open** | exactly **one** trial call is allowed through | **Closed** if it succeeds, back to **Open** if it fails |

```text
CLOSED --(too many failures)--> OPEN --(wait resetMs)--> HALF-OPEN --(trial works)--> CLOSED
                                  ^                           |
                                  +------(trial fails)--------+
```

Here is the core, trimmed to the state logic:

```js
async exec(fn) {
  if (this.#state === 'open') {
    if (this.clock.now() - this.#openedAt < this.resetMs) throw new CircuitOpenError('circuit is open, failing fast');
    this.#change('half-open');
  }
  if (this.#state === 'half-open') {
    if (this.#trial) throw new CircuitOpenError('half-open, trial call already running');
    this.#trial = true; // only ONE call may test the water
  }
  try {
    const result = await fn();
    this.#failures = 0;
    if (this.#state === 'half-open') this.#change('closed');
    return result;
  } catch (err) {
    this.#failures++;
    if (this.#state === 'half-open' || this.#failures >= this.failureThreshold) {
      this.#openedAt = this.clock.now();
      this.#change('open');
    }
    throw err;
  } finally {
    this.#trial = false;
  }
}
```

The demo calls a service every 500 ms. The service is down until t=3000. The breaker opens after 3 failures and waits 1000 ms before trying again:

```text
--- 3. Circuit breaker (a service that is down until t=3000)
  t=   0 service down
  t= 500 service down
  t=1000 service down   [state: closed -> open]
  t=1500 circuit is open, failing fast
  t=2000 service down   [state: open -> half-open, then half-open -> open]
  t=2500 circuit is open, failing fast
  t=3000 ok   [state: open -> half-open, then half-open -> closed]
  t=3500 ok
  t=4000 ok
  9 calls were made, but only 7 reached the service
```

Walk through it. After the third failure (t=1000) the circuit opens. At t=1500 the call fails instantly: no request was sent. At t=2000 the reset time has passed, so one trial call goes out (half-open), the service is still down, and the circuit opens again. At t=3000 the trial succeeds and the circuit closes. Two of the nine calls never reached the struggling service.

Design choices that you should be able to discuss:

- **What counts as a failure:** timeouts, connection errors and `5xx`. Not `4xx` (the caller's fault).
- **Threshold:** a count of consecutive failures (as here), or an error **percentage** over a time window, which copes better with mixed traffic.
- **One breaker per dependency,** not one global breaker, so a broken email provider does not block payments.
- **What the caller does when open:** a **fallback** (cached data, a default value, "we will email you later") or a clear error.

In real projects you use a library. This is an illustration:

```js
// Illustration only. Needs: npm install opossum   (check the library's docs for the current options)
const CircuitBreaker = require('opossum');

const breaker = new CircuitBreaker(callPaymentService, {
  timeout: 3000,                // a call slower than 3 s counts as a failure
  errorThresholdPercentage: 50, // open when half of the recent calls failed
  resetTimeout: 30000,          // after 30 s, go half-open and try again
});
breaker.fallback(() => ({ status: 'queued for later' }));

async function pay(order) {
  return breaker.fire(order);
}
```

> **Interview tip:** "What is the difference between a retry and a circuit breaker?" A retry helps when **one call** failed for a brief moment. A circuit breaker helps when **the dependency** is down for a while: it stops every caller from trying, so the dependency can recover and your callers fail fast. Used alone, retries make a long outage worse. Then describe the three states and what a fallback could be.

## 19. Bulkhead

A ship's hull is divided into watertight compartments (**bulkheads**) so that a leak in one does not sink the ship. In software, a **bulkhead** limits how much of your resources one dependency or one kind of work can use, so that a problem there cannot take everything.

The simplest Node version is a **concurrency limiter** with a small waiting room: at most N calls run at once, at most M may wait, and everything beyond that is rejected immediately.

```js
class Bulkhead {
  #running = 0;
  #waiting = [];
  constructor({ maxConcurrent, maxQueue }) {
    Object.assign(this, { maxConcurrent, maxQueue });
  }
  async exec(fn) {
    if (this.#running < this.maxConcurrent) {
      this.#running++;
    } else if (this.#waiting.length < this.maxQueue) {
      await new Promise((resolve) => this.#waiting.push(resolve)); // wait for a slot to be handed over
    } else {
      throw new BulkheadFullError('too many calls in progress');
    }
    try {
      return await fn();
    } finally {
      const next = this.#waiting.shift();
      if (next) next(); // pass our slot straight to the next waiter
      else this.#running--;
    }
  }
}
```

Six calls arrive together, each taking 100 ms of fake time, with room for 2 running and 2 waiting:

```text
--- 4. Bulkhead (2 at a time, 2 may wait, 6 calls arrive together)
  call 1: ran from t=0 to t=100
  call 2: ran from t=0 to t=100
  call 3: ran from t=100 to t=200
  call 4: ran from t=100 to t=200
  call 5: rejected: BulkheadFullError
  call 6: rejected: BulkheadFullError
  most calls running at once: 2
```

Calls 1 and 2 ran at once. Calls 3 and 4 waited for a free slot. Calls 5 and 6 were turned away immediately instead of piling up. Without the bulkhead, a slow report endpoint could use every database connection and make the rest of the site hang.

Other bulkheads you already know: a separate connection pool (lesson 17) per kind of work, a worker thread pool with a fixed size (lesson 18), and `http.Agent` with a `maxSockets` limit. A new `http.Agent()` has `maxSockets: Infinity`, so setting a number is a real bulkhead for outgoing requests to one host:

```js
const http = require('node:http');

// At most 10 sockets to each host at the same time; more requests wait their turn.
const paymentsAgent = new http.Agent({ keepAlive: true, maxSockets: 10 });
console.log(paymentsAgent.maxSockets);
```

```text
10
```

Lesson 07 (section 15) shows the plain "run at most N promises at a time" helper that this pattern grows from.

### Putting the patterns together

Real calls use several of these at once. The order matters. A common convention, from the outside in, is **retry( circuit breaker( timeout( call ) ) )**, with a **fallback** at the very end for when everything fails:

- the **timeout** is innermost, so it limits each single attempt;
- the **circuit breaker** wraps it, so every attempt (including each retry) is counted, and an open circuit fails fast;
- the **retry** is outermost, and it must not retry a "circuit open" error, otherwise it keeps knocking on a closed door;
- a **bulkhead** goes around the call to cap concurrency.

Two companions are outside this lesson's code: **health checks** (the platform stops sending traffic to an instance whose readiness check fails, lesson 24 section 10) and **graceful degradation** (when a non-essential dependency is down, serve a reduced answer instead of an error: the fallback in the example below is exactly that).

Part 5 of the example stacks the first three. The service takes 300 ms to answer until t=1000 and 20 ms after that; the timeout is 100 ms and the breaker opens after 2 failures:

```js
const stamp = (m) => console.log(`        t=${pad(clock.now())} ${m}`);
const breaker = new CircuitBreaker({ clock, failureThreshold: 2, resetMs: 500, onChange: (a, b) => stamp(`breaker: ${a} -> ${b}`) });

const getData = () =>
  retry(() => breaker.exec(() => withTimeout(clock, 100, service)), {
    clock,
    retries: 3,
    baseMs: 100,
    random: () => 1, // always the full ceiling, to keep the numbers easy to read
    shouldRetry: (e) => !(e instanceof CircuitOpenError), // an open circuit means: stop, use the fallback
    log: stamp,
  }).catch((e) => `FALLBACK (cached data) because: ${e.constructor.name}`);
```

```text
--- 5. All together (service answers in 300 ms until t=1000, then in 20 ms)
        t= 100 attempt 1 failed (timed out after 100 ms); ceiling 100 ms, waiting 100 ms
        t= 300 breaker: closed -> open
        t= 300 attempt 2 failed (timed out after 100 ms); ceiling 200 ms, waiting 200 ms
  call at t=0   : FALLBACK (cached data) because: CircuitOpenError
        t=1000 breaker: open -> half-open
        t=1020 breaker: half-open -> closed
  call at t=1000: fresh data
```

The first call times out at t=100 and waits 100 ms. Its second attempt starts at t=200 and times out at t=300, and that second failure opens the breaker. The retry waits 200 ms, and at t=500 the third attempt is stopped by the open circuit at once. The caller gets the fallback instead of waiting for more timeouts. At t=1000 the reset time has long passed, the next call is the half-open trial, the service now answers in 20 ms, and the breaker closes.

> **Interview tip:** be ready to explain why the order matters, not just recite one. For example: "if the retry were inside the breaker, the breaker would count one failure for several attempts and could not stop the retries".

## 20. Rate limiting

A **rate limiter** caps how many requests a client may make in a period. It protects you from abusive or buggy clients, shares capacity fairly, and controls cost. When a request is over the limit you answer **429 Too Many Requests** with a `Retry-After` header (seconds to wait). Example `11-rate-limiting.js` implements the five algorithms interviewers name.

| Algorithm | Idea | Memory per key | Allows bursts? | Weakness |
|---|---|---|---|---|
| **Fixed window** | one counter per time window (per minute), reset at the edge | 1 counter | up to **2x** the limit around the edge | boundary burst |
| **Sliding window log** | store the time of every request, count those in the last window | up to `limit` timestamps | no | memory grows with the limit |
| **Sliding window counter** | two counters (this window, previous window), weight the previous one by overlap | 2 counters | a little | an estimate, not exact |
| **Token bucket** | a bucket refills at a steady rate; each request takes a token | 2 numbers | **yes**, up to the bucket size | needs the maths for refill |
| **Leaky bucket** | requests fill a bucket that drains at a constant rate; overflow is rejected | 2 numbers | no | (as a queue) adds waiting delay |

The token bucket is the one to know best, because it is the most common and it allows short bursts while enforcing an average rate. It needs no timer: it works out the refill lazily from the elapsed time when a request arrives.

```js
class TokenBucket {
  constructor({ clock, capacity, refillPerSec }) {
    Object.assign(this, { clock, capacity, refillPerSec });
    this.tokens = capacity;
    this.last = clock.now();
  }
  #refill() {
    const now = this.clock.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec);
    this.last = now; // lazy refill: no timer needed, we just do the maths when someone asks
  }
  allow() {
    this.#refill();
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
  retryAfterSeconds() {
    this.#refill();
    return Math.max(0, Math.ceil((1 - this.tokens) / this.refillPerSec));
  }
}
```

A timeline with capacity 3 and a refill of 2 tokens per second (so one token takes 500 ms). Three requests at t=0 use up the bucket and the fourth is denied. At t=250 only half a token has come back, so that request is denied; at t=500 a whole token is there:

```text
--- 2. Token bucket timeline (capacity 3, refill 2 tokens per second)
  t=   0 ms  allowed  tokens left: 2.00
  t=   0 ms  allowed  tokens left: 1.00
  t=   0 ms  allowed  tokens left: 0.00
  t=   0 ms  DENIED   tokens left: 0.00  -> 429, Retry-After: 1
  t= 250 ms  DENIED   tokens left: 0.50  -> 429, Retry-After: 1
  t= 500 ms  allowed  tokens left: 0.00
  t= 600 ms  DENIED   tokens left: 0.20  -> 429, Retry-After: 1
  t=1000 ms  allowed  tokens left: 0.00
  t=1000 ms  DENIED   tokens left: 0.00  -> 429, Retry-After: 1
  t=3000 ms  allowed  tokens left: 2.00
```

(`Retry-After` is a whole number of seconds, so a wait of 0.5 s is rounded up to 1.) After 2 seconds of silence (t=1000 to t=3000) the bucket refilled completely to its capacity of 3; the last request took one token, leaving 2.00. The burst allowance is back.

### The boundary problem, side by side

The first part of the example sends the same traffic to every algorithm, with a limit of 5 per second: 5 requests at t=900 ms and 5 more at t=1100 ms, only 200 ms later. `A` is allowed and `D` is denied:

```text
--- 1. The same traffic through every algorithm: limit 5 per second
       traffic: 5 requests at t=900 ms, then 5 more at t=1100 ms   (A = allowed, D = denied)
  fixed window     t=900: AAAAA   t=1100: AAAAA   allowed in 200 ms: 10
  sliding log      t=900: AAAAA   t=1100: DDDDD   allowed in 200 ms: 5
  sliding counter  t=900: AAAAA   t=1100: DDDDD   allowed in 200 ms: 5
  token bucket     t=900: AAAAA   t=1100: ADDDD   allowed in 200 ms: 6
  leaky bucket     t=900: AAAAA   t=1100: ADDDD   allowed in 200 ms: 6
```

The **fixed window** let 10 requests through in 200 ms, double the limit, because t=900 belongs to window 0 and t=1100 to window 1, and each window has its own counter. The sliding log and sliding counter remember the recent past and allow none. The token bucket and the leaky bucket allow one more request, because 200 ms refilled (or drained) exactly one unit at 5 per second.

### Using it in a real service

- **Per key.** Limit per user, API key or IP address, with one limiter object per key in a `Map` (the example does this in part 3). That `Map` grows with every new key, so real code removes idle keys (task 2 below). Behind a proxy, the client IP comes from `X-Forwarded-For`, which only the proxy may be trusted to set.
- **Across instances.** In-memory counters count per process. With three instances, a limit of 100 becomes 300. For a shared limit keep the counters in Redis: `INCR` plus `EXPIRE` for a fixed window, or a small Lua script for a token bucket so that read-and-update is atomic.
- **Where.** The cheapest place is the edge (a CDN, NGINX, the API gateway of section 16), before requests reach Node. Application-level limits are for per-user rules. A package such as `express-rate-limit` adds a middleware in one line (illustration, check the docs for current options):

```js
// Illustration only. Needs: npm install express express-rate-limit
const rateLimit = require('express-rate-limit');
app.use(rateLimit({ windowMs: 60_000, limit: 100 })); // 100 requests per minute per client
```

- **Be a good client.** When you call an API that limits you, obey `429` and `Retry-After`, and run your own token bucket so you rarely hit the limit.

> **Interview tip:** token bucket versus leaky bucket is a classic. The token bucket allows a burst up to its capacity and limits the average rate. The leaky bucket drains at a constant rate, so it smooths traffic and does not allow bursts. Fixed window is the simplest and has the boundary problem; sliding window counter is the cheap fix.

## 21. Backpressure at system level

In lesson 11 you met **backpressure** between streams: a slow writer tells a fast reader to pause, so memory does not fill with data nobody is ready for. The same problem exists in a whole system. If requests (or messages) arrive faster than they can be processed, something has to give. If you do nothing, the waiting line grows without limit.

A small calculation shows how fast. Say 100 requests per second arrive and your workers can handle 80 per second:

- The backlog grows by 20 per second. After 10 minutes there are 20 x 600 = **12 000** waiting.
- The newest request waits 12 000 / 80 = **150 seconds** before it is even started, long after its client gave up. The server is busy working for clients that are gone.
- Memory grows with the backlog until the process runs out. In a system that keeps up, **Little's law** says: items in the system = arrival rate x average time spent in the system. When arrivals exceed capacity there is no steady state at all, so the queue and the waiting time just keep growing.

The only fixes are to process faster, send slower, or refuse some work. In practice:

1. **Bound everything.** Give every queue, every concurrency limit and every request body a maximum size (as example 06's `maxWaiting`).
2. **Shed load early.** When full, reject at once with `503` or `429` and a `Retry-After`. Failing fast for some users is far better than being slow for everyone. Load balancers and gateways can do this too.
3. **Slow the producer down.** Use pull-based or acknowledgement-based flow control: a RabbitMQ **prefetch** limit, Kafka consumers that poll at their own pace, stream `highWaterMark` (lesson 11), or a producer that waits when `add()` says the queue is full.
4. **Drop what is not essential.** For metrics or telemetry it may be fine to sample or keep only the latest value.
5. **Scale the consumers** (more workers), while checking that the database behind them can take the extra load, or you only move the bottleneck.

Good signals to trigger shedding in Node are queue length, the number of in-flight requests, and **event loop delay** (`perf_hooks.monitorEventLoopDelay`, lesson 19): if the loop is lagging, accepting more work only makes everyone slower.

> **Interview tip:** the sentence to remember is "an unbounded queue is a bug waiting for a bad day". Every queue should have a limit, and you should be able to say what happens when it is reached.

## 22. CQRS, event sourcing and the saga pattern

These three are often mentioned together and often confused. Example `12-cqrs-events-saga.js` shows all of them in about 150 lines.

### Event sourcing

Normally you store the **current state**: the account row says `balance = 70`. With **event sourcing** you store the **events** that happened, in order, and never change them:

```text
1: AccountOpened   2: MoneyDeposited 100   3: MoneyWithdrawn 30
```

The current state is just the events **replayed**: start empty and apply each event (a `reduce`). Because nothing is overwritten you get a full audit trail for free, you can ask what the state was at version 2 ("time travel"), and you can rebuild any view from scratch.

```js
function applyEvent(state, event) {
  switch (event.type) {
    case 'AccountOpened':
      return { id: event.data.accountId, balance: 0 };
    case 'MoneyDeposited':
      return { ...state, balance: state.balance + event.data.amount };
    case 'MoneyWithdrawn':
      return { ...state, balance: state.balance - event.data.amount };
    default:
      return state;
  }
}

const loadAccount = (accountId, upToVersion = Infinity) =>
  eventStore.filter((e) => e.data.accountId === accountId && e.version <= upToVersion).reduce(applyEvent, null);
```

### CQRS

**CQRS** (Command Query Responsibility Segregation) means using **separate models** for changing data and for reading it.

- The **write side** handles **commands** ("Withdraw 30"). It checks the business rules against the current state, then appends events. It is built for correctness.
- The **read side** answers **queries** ("what is the balance? show the statement"). It is a **projection**: a view built from the events and shaped for the screens that read it, in a table, a cache or a search index. It is built for speed.

The read side is usually updated **asynchronously**, so it is **eventually consistent**: for a short moment after a write, a read may still show old data. The example makes that visible by delivering each event to the projection one event-loop turn later:

```text
--- 1. Event sourcing + CQRS
  rejected command: insufficient funds
  events stored: 1:AccountOpened, 2:MoneyDeposited, 3:MoneyWithdrawn
  read model right after the commands: undefined (stale: nothing projected yet)
  read model one turn later          : 70 | statement: +100 -30
  state from replaying all events    : { id: 'acc-1', balance: 70 }
  state as of version 2 (time travel): { id: 'acc-1', balance: 100 }
  new read model rebuilt from scratch: 70 (replay all events into a fresh projection)
```

The withdrawal of 500 was refused by the write side. The read model was empty right after the commands, then correct one turn later. Replaying all events into a new projection gave the same 70.

What to say about the costs:

- **Two models to keep in step** (write side and read side).
- **Eventual consistency.** A user who just saved something may not see it on the next page load. Common fixes: return the new state from the command, or read the user's own recent writes from the write side.
- **Event sourcing only:** changing the shape of old events is hard, long histories need **snapshots** (a saved state at some version, so you replay only the events after it), and deleting personal data from an append-only log needs special care.

Do not use either for plain CRUD. They help when audit, history, very different read and write needs, or complex rules are central. You can use CQRS without event sourcing, and the other way round.

> **Interview tip:** "CQRS and event sourcing: are they the same thing?" No. CQRS is about **separate models for writing and reading**. Event sourcing is about **storing events instead of current state**. They fit well together (the events feed the read models), but each works alone. Then name the price: more moving parts and eventual consistency.

### Saga

A **saga** is how you do one business operation across several services **without** a distributed transaction (a single all-or-nothing commit across several databases). The classic way to build such a commit is **two-phase commit** (2PC): a coordinator asks every database "can you commit?" and then tells all of them to commit. It is slow, it holds locks while it waits, and it stops if the coordinator dies, so it is rarely used between independent services. A saga splits the work into local steps instead. Every step has a **compensation**: an action that semantically undoes it. If a later step fails, the saga runs the compensations of the completed steps **in reverse order**.

```js
async function runSaga(name, steps, context) {
  const completed = [];
  for (const step of steps) {
    try {
      await step.run(context);
      console.log(`    ${step.name}: done`);
      completed.push(step);
    } catch (err) {
      console.log(`    ${step.name}: FAILED (${err.message}) -> compensating`);
      for (const done of [...completed].reverse()) {
        await done.undo(context);
        console.log(`    undo ${done.name}`);
      }
      return `${name}: rolled back`;
    }
  }
  return `${name}: completed`;
}
```

```text
--- 2. Saga (orchestrated): reserve stock -> charge card -> ship
  scenario: everything works
    reserve stock: done
    charge card: done
    create shipment: done
    order-1001: completed
  scenario: charge card fails
    reserve stock: done
    charge card: FAILED (card declined) -> compensating
    undo reserve stock
    order-1001: rolled back
  scenario: create shipment fails
    reserve stock: done
    charge card: done
    create shipment: FAILED (courier API is down) -> compensating
    undo charge card
    undo reserve stock
    order-1001: rolled back
```

In the third scenario the shipment fails after the card was charged, so the saga refunds the card and then releases the stock: reverse order.

Points to remember:

- **Orchestration vs choreography.** In an **orchestrated** saga (this example) one coordinator tells each service what to do next. In a **choreographed** saga there is no coordinator: each service reacts to the previous service's event and publishes its own. Orchestration is easier to follow and debug; choreography has less central coupling but the flow is scattered across services.
- A compensation is a **new business action** (a refund), not a database rollback. Some things cannot be undone, such as a sent email, so order the steps so that irreversible ones come last.
- Compensations can fail too. They must be **idempotent** and retried (section 11).
- A real orchestrator **stores its progress** so it can resume after a crash. Workflow engines such as Temporal or AWS Step Functions do this for you.
- Other users can see intermediate states (stock reserved, not yet paid). A saga gives you atomicity in the end, but not isolation.

> **Interview tip:** "How do you keep data consistent across microservices?" A strong short answer: there is no cross-service transaction, so I use a saga (local transactions plus compensations, orchestrated or choreographed), publish events with the outbox pattern, make every step and every compensation idempotent, and accept eventual consistency. Add that I avoid the problem when I can by keeping data that must change together inside one service.

## 23. CAP theorem and consistency models

The **CAP theorem** is about a data store that is spread over several machines. Three properties are named:

- **Consistency (C):** every read sees the most recent write (or returns an error). Technically this is called *linearizability*.
- **Availability (A):** every request to a working node gets a real answer, not an error, though it might be stale.
- **Partition tolerance (P):** the system keeps working even when the network splits and some nodes cannot talk to each other.

The theorem says: **when a partition happens, you must choose between C and A.** Networks do split, so P is not optional in a real distributed system. The real question is what the system does **during** a partition: refuse some requests to stay correct (a "CP" choice), or keep answering and accept that answers may be stale or conflict (an "AP" choice). When there is no partition, a system can offer both; the **PACELC** extension says that even then you trade **latency** against consistency.

Real systems are tunable and not simply one or the other, but as rough tendencies: coordination stores such as etcd and ZooKeeper favour consistency; Cassandra and DynamoDB (eventually consistent reads) favour availability; a single-leader SQL database with synchronous replication favours consistency.

> **Common mistake:** the "C" in CAP is not the "C" in ACID. ACID consistency means a transaction leaves the data valid under its rules (constraints hold). CAP consistency means all nodes agree on the latest value. Interviewers like this trap.

A few **consistency models** from strongest to weakest:

| Model | What a reader sees |
|---|---|
| **Strong** (linearizable) | always the latest write, as if there were one copy |
| **Read-your-writes** | you always see your own writes (others may lag) |
| **Causal** | if B happened because of A, nobody sees B without A |
| **Eventual** | if writes stop, all copies end up the same; in between, anything goes |

Stronger models cost latency and availability; weaker ones are faster and more available but push work onto the application. Choose per feature: a bank balance needs strong consistency, a "likes" counter does not.

Stores that keep several copies of each item often let you tune this with a **quorum**. With N copies, a write waits until W copies have it, and a read asks R copies. If **R + W > N**, every read set overlaps every write set, so a read always meets at least one copy with the latest write (for example N = 3, W = 2, R = 2). Lower R or W is faster and more available, but a read can then return old data. Cassandra and DynamoDB-style stores expose this as a setting.

> **Interview tip:** "Explain CAP." A strong short answer: when the network splits, a distributed store must choose between staying consistent (refuse some requests) and staying available (answer, maybe with stale data). Then say that it is a trade-off per feature, give one example for each side (bank balance, likes counter), and mention that even without a split you trade latency for consistency (PACELC).

## 24. Twelve-factor reminders

The **twelve-factor app** is a checklist for services that are easy to deploy and scale. You should recognise the list; most of it you have already met in this course.

| # | Factor | In Node terms |
|---|---|---|
| 1 | **Codebase** | one repository per app, many deploys of it |
| 2 | **Dependencies** | declare them all in `package.json` with a lockfile, install with `npm ci` |
| 3 | **Config** | keep config in environment variables, not in code (`process.env`, `--env-file`) |
| 4 | **Backing services** | a database, queue or cache is an attached resource, reached by a URL from config |
| 5 | **Build, release, run** | build once, combine with config as a release, run it; never edit code on the server |
| 6 | **Processes** | be stateless and share nothing; keep state in a database or Redis (lesson 18, section 12) |
| 7 | **Port binding** | the app opens its own port (from `PORT`) instead of relying on an outer web server |
| 8 | **Concurrency** | scale out by running more processes |
| 9 | **Disposability** | start fast, shut down gracefully on `SIGTERM` (lesson 12, section 19) |
| 10 | **Dev/prod parity** | keep environments as similar as you can |
| 11 | **Logs** | write logs to stdout as a stream; the platform collects them |
| 12 | **Admin processes** | run one-off tasks (migrations, scripts) with the same code and config |

The two factors that matter most for this lesson:

- **6, stateless processes.** This is what lets you add instances, and it is why caches, locks and rate-limit counters that must be shared have to live outside the process.
- **9, disposability.** A service that can be killed at any time is the reason for idempotent consumers and retries.

Lesson 24 covers deployment and observability in depth.

> **Interview tip:** you will rarely be asked to recite all twelve. Pick the three or four that fit the question and tie each to something concrete: config in environment variables (`process.env`), stateless processes (sessions in Redis, not in memory), graceful shutdown on `SIGTERM`, and logs to stdout.

## 25. How to talk about trade-offs in interviews

Senior interviews rarely test a single right answer. They test **how you reason**. A structure that works for almost any design or architecture question:

1. **Clarify the requirements and numbers.** What does it do? How many users and requests per second? How fast must it be? What happens if data is stale or lost? How large is the team?
2. **Start with the simplest design that could work** (often one service and one database) and say so.
3. **Find where it breaks.** Name the pressure points: traffic, a slow dependency, a crash in the middle of a write, two instances running the same job.
4. **Offer options with their costs,** choose one, and give the reason. Then say **what would make you change your mind**.
5. **Cover failure.** Mention timeouts, retries with idempotency, what you do when a dependency is down, and how you would notice (metrics, alerts, the dead-letter queue).

A useful sentence shape: "I would use **A** because **reason**. The cost is **cost**. If **condition** changes, I would move to **B**."

Common questions and the shape of a strong answer (the last column says where in this lesson to revise it):

| Question | A strong answer includes | Section |
|---|---|---|
| Monolith or microservices? | start with a modular monolith; extract a service for a concrete reason; mention network failure, distributed data and the operations cost | 16 |
| How do you avoid charging a customer twice? | idempotency key on the POST, stored with the response; idempotent consumers; unique constraint in the database | 14, 11 |
| Can you guarantee exactly-once delivery? | not in general; at-least-once plus idempotent processing gives exactly-once in effect | 11 |
| How do you make a cron job safe with 3 instances? | a single scheduler, a queue, or a lock with TTL; the job is idempotent anyway; mention lock expiry | 12 |
| How do you handle a slow third-party API? | timeout, retry with backoff and jitter for idempotent calls, circuit breaker, bulkhead, fallback | 17 to 19 |
| Cache or not? | what is cached, TTL and invalidation, stampede protection, what happens when the cache is empty or down | 13 |
| What do you do when the queue grows? | bound the queue, shed load, slow producers, scale consumers, watch the dead-letter queue | 21, 10 |
| Explain CAP | partition forces a choice between consistency and availability; give an example of each choice | 23 |

Weak answers to avoid: naming a technology without a reason ("we will use Kafka"), "microservices, always", treating failure as an edge case, claiming a cache or a queue is free, and saying "exactly-once is easy because the broker supports it".

### One worked example

Question: "A user signs up and must get a welcome email. How would you build it?" Follow the five steps:

1. **Clarify.** How many sign-ups per minute? Is the email provider reliable? Is it acceptable if the mail arrives a few seconds late? (Say yes: it is a welcome mail, not a password reset.)
2. **Simplest design.** Send the email inside the sign-up request.
3. **Where it breaks.** A slow provider makes sign-up slow. A provider outage makes sign-up fail even though the user was saved. A crash between "save" and "send" loses the mail.
4. **Options and choice.** Save the user and an outbox row in one transaction. A worker reads the outbox, puts a job on a queue, and sends the mail with retries (exponential backoff and jitter) and a dead-letter queue. The cost: one more moving part, and the mail may arrive late or, rarely, twice. If duplicates matter, the worker keeps a record of "welcome mail sent to user 42" so a repeat is ignored.
5. **Failure and visibility.** A circuit breaker stops the worker from hammering a provider that is down. A bounded queue and an alert on queue depth and on a non-empty dead-letter queue tell you when something is wrong. If the load grows a lot, add workers, and watch the provider's rate limit.

Notice how many sections of this lesson that one answer used: outbox (9), queue and dead-letter queue (10), idempotency (11), backoff (17), circuit breaker (18), bounded queue (21).

## Summary / Key takeaways
- Structure code in layers (routes/controllers, services, repositories) or by feature, call only downward, and keep business rules free of HTTP and SQL. Hexagonal architecture makes this a rule: the core knows ports, adapters plug in.
- Dependency injection means "hand in what you need". It makes code testable with fakes. A container is an optional helper; a composition root is the one place that wires things.
- In Node the module cache makes every module a singleton per process. Know its limits: per process only, and duplicated packages give duplicated instances.
- Adapter changes an interface, decorator adds behaviour behind the same interface, proxy controls access. Observer is in-process, pub/sub has a broker, middleware is a chain where each step may stop it.
- Queues give decoupling and buffering. Real delivery is at-least-once, so consumers must be idempotent; failed work goes to a dead-letter queue after limited retries with backoff. Use the outbox pattern when you must both write to the database and publish an event, and a saga with compensations for a business operation across services.
- Cache with a TTL and a size limit, invalidate on write, and protect hot keys with promise coalescing. Never cache without saying how it goes stale.
- Resilience stack: a timeout on every call, retries with exponential backoff and jitter for idempotent operations, a circuit breaker per dependency, a bulkhead to cap concurrency, rate limiting at the edge, and bounded queues so overload is rejected, not buffered forever.
- Prefer a modular monolith first. Microservices solve an organisational and scaling problem and create a distributed-systems problem. In interviews, state the trade-off, not only the choice.

## Quick check

1. A teammate writes SQL queries directly inside the route handlers. Which problems does that cause, and how do layers fix them?
<details><summary>Answer</summary>

The handler now mixes HTTP, business rules and storage. You cannot test the rules without HTTP and a database, you cannot reuse them from a queue worker or a script, and changing the database means editing every handler. With layers, the route calls a controller, the controller calls a service (rules only), and the service calls a repository (storage only). Each layer can be tested and replaced alone.

</details>

2. What is the difference between dependency injection and a DI container? Do you need a container?
<details><summary>Answer</summary>

Dependency injection is the technique of passing an object what it needs (usually as constructor arguments) instead of letting it create or `require` those things. A container is an optional tool that builds the objects and their dependencies for you from registered recipes. You do not need one: a single function that creates and connects the objects (the composition root) is enough for most Node apps.

</details>

3. Why is a CommonJS module a singleton, and name two situations where you still end up with two instances.
<details><summary>Answer</summary>

`require` runs a file once and stores its `module.exports` in `require.cache`, keyed by the resolved file path, so every later `require` returns the same object. You get two instances if the cache entry is deleted, if the same package exists twice in `node_modules` (two files), or when you use several processes (`cluster`, workers, several servers), because each process has its own cache.

</details>

4. What is the difference between an adapter, a decorator and a proxy?
<details><summary>Answer</summary>

All three wrap an object, but the intent differs. An adapter changes the interface so a foreign object fits what your code expects. A decorator keeps the same interface and adds behaviour (logging, timing, caching). A proxy keeps the same interface and controls access to the object (lazy creation, permission checks, remote calls).

</details>

5. Explain at-most-once and at-least-once delivery. How do you get "exactly-once in effect"?
<details><summary>Answer</summary>

At-most-once acknowledges a message before the work, so a crash loses it. At-least-once acknowledges after the work, so a crash before the ack causes a redelivery and a possible duplicate. True exactly-once across a network is not generally possible, so you use at-least-once delivery plus an idempotent consumer (for example, a unique message id stored in the same transaction as the work), which makes repeated deliveries have no extra effect.

</details>

6. What is a dead-letter queue, and what is a poison message?
<details><summary>Answer</summary>

A poison message is one that always fails to process. If it is retried forever it burns resources and can block other work. A dead-letter queue is where a message is moved after the allowed number of attempts, so the rest of the traffic keeps flowing and you can inspect, alert on, fix and later redrive the failed messages.

</details>

7. Why do retries use exponential backoff with jitter?
<details><summary>Answer</summary>

Backoff (doubling the wait) gives a struggling service room to recover instead of hammering it. Jitter (a random part of the wait) stops many clients that failed at the same moment from retrying at the same moment, which would create synchronised spikes (a thundering herd).

</details>

8. Name the three states of a circuit breaker and what happens in each.
<details><summary>Answer</summary>

Closed: calls go through and failures are counted. Open: after too many failures, calls fail immediately without touching the dependency. Half-open: after a reset time, one trial call is let through; if it succeeds the breaker closes, if it fails the breaker opens again.

</details>

9. What is the boundary problem of a fixed-window rate limiter, and which algorithm allows a burst on purpose?
<details><summary>Answer</summary>

Counters reset at fixed edges, so a client can send the full limit at the end of one window and again at the start of the next, getting up to twice the limit in a short time. A sliding window log or counter avoids this. The token bucket allows bursts on purpose: the bucket holds up to `capacity` tokens, so a client can spend them at once, while the refill rate limits the average.

</details>

10. What is a cache stampede, and how does promise coalescing stop it?
<details><summary>Answer</summary>

A stampede is when a popular key is missing or expires and many requests rebuild it at the same moment, sending many identical queries to the database. With promise coalescing the first caller starts the load and stores its promise in a map; later callers for the same key get that same promise instead of starting their own, so the database is read once.

</details>

## Try it yourself

Run your solutions from any folder with `node yourfile.js`. All three tasks use only core modules.

### Task 1 (easy): make a service testable with dependency injection

This service builds its own mailer, so a test cannot see which mail was sent. Save it as `starter.js` and run it:

```js
// Starter: hard-wired. The service builds its own mailer, so a test cannot see what was sent.
class SmtpMailer {
  async send(to, subject) {
    console.log(`SMTP: sending "${subject}" to ${to}`);
  }
}

class SignupService {
  async signUp(email) {
    await new SmtpMailer().send(email, 'Welcome!'); // hard-wired dependency
    return { email };
  }
}

new SignupService().signUp('ada@example.com').then(console.log);
```

```text
SMTP: sending "Welcome!" to ada@example.com
{ email: 'ada@example.com' }
```

Change `SignupService` so that it receives `{ users, mailer }` in its constructor. `users` has `exists(email)` and `add(email)`. A second sign-up with the same email must throw `already registered` and must not send a mail. Then write a test with `node:assert/strict` that uses fakes for both.

<details><summary>Hint</summary>

Constructor injection: `constructor({ users, mailer }) { this.users = users; this.mailer = mailer; }`. A fake mailer can be an object whose `send` pushes into an array you inspect afterwards. For the error check, use `assert.rejects(() => service.signUp(...), /already registered/)`.

</details>

<details><summary>Solution</summary>

```js
const assert = require('node:assert/strict');

class SignupService {
  constructor({ users, mailer }) {
    this.users = users;
    this.mailer = mailer;
  }
  async signUp(email) {
    if (await this.users.exists(email)) throw new Error('already registered');
    await this.users.add(email);
    await this.mailer.send(email, 'Welcome!');
    return { email };
  }
}

// ---- test with fakes
async function main() {
  const sent = [];
  const emails = new Set();
  const users = {
    exists: async (email) => emails.has(email),
    add: async (email) => emails.add(email),
  };
  const mailer = { send: async (to, subject) => sent.push({ to, subject }) };
  const service = new SignupService({ users, mailer });

  await service.signUp('ada@example.com');
  assert.deepEqual(sent, [{ to: 'ada@example.com', subject: 'Welcome!' }]);

  await assert.rejects(() => service.signUp('ada@example.com'), /already registered/);
  assert.equal(sent.length, 1, 'no second mail for a duplicate sign-up');
  console.log('all checks passed');
}
main();
```

```text
all checks passed
```

</details>

### Task 2 (medium): a per-key rate limiter that cleans up after itself

A `Map` of token buckets, one per user, grows forever as new users appear. Build a `KeyedLimiter({ clock, capacity, refillPerSec, idleMs })` with `allow(key)` (true or false), `sweep()` (removes keys not seen for at least `idleMs`) and a `size` getter. Use a token bucket per key and an injected clock (an object with `now()`), so you can test it without waiting. Make sure a user whose bucket was swept starts again with a full bucket.

<details><summary>Hint</summary>

Store `{ bucket, lastSeen }` per key and update `lastSeen` on every `allow`. In `sweep()`, delete the entries where `clock.now() - lastSeen >= idleMs`. Deleting from a `Map` while iterating over it with `for...of` is safe in JavaScript. Forgetting an idle key is harmless as long as `idleMs` is at least the time the bucket needs to refill (`capacity / refillPerSec`), because its bucket would be full anyway.

</details>

<details><summary>Solution</summary>

```js
const assert = require('node:assert/strict');

class TokenBucket {
  constructor({ clock, capacity, refillPerSec }) {
    Object.assign(this, { clock, capacity, refillPerSec });
    this.tokens = capacity;
    this.last = clock.now();
  }
  allow() {
    const now = this.clock.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec);
    this.last = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

class KeyedLimiter {
  #buckets = new Map(); // key -> { bucket, lastSeen }
  constructor({ clock, capacity, refillPerSec, idleMs }) {
    Object.assign(this, { clock, capacity, refillPerSec, idleMs });
  }
  allow(key) {
    let entry = this.#buckets.get(key);
    if (!entry) {
      entry = { bucket: new TokenBucket(this), lastSeen: 0 };
      this.#buckets.set(key, entry);
    }
    entry.lastSeen = this.clock.now();
    return entry.bucket.allow();
  }
  // Remove keys that were not seen for idleMs. If idleMs is at least capacity / refillPerSec (the time
  // to refill a bucket), an idle key would have a full bucket anyway, so forgetting it changes nothing.
  sweep() {
    for (const [key, entry] of this.#buckets) {
      if (this.clock.now() - entry.lastSeen >= this.idleMs) this.#buckets.delete(key);
    }
  }
  get size() {
    return this.#buckets.size;
  }
}

const clock = { t: 0, now() { return this.t; } };
const limiter = new KeyedLimiter({ clock, capacity: 2, refillPerSec: 1, idleMs: 10_000 });

assert.equal(limiter.allow('a'), true);
assert.equal(limiter.allow('a'), true);
assert.equal(limiter.allow('a'), false, 'a is out of tokens');
assert.equal(limiter.allow('b'), true, 'b has its own bucket');
assert.equal(limiter.size, 2);

clock.t = 5_000;
limiter.allow('b'); // b is seen again, a is not
clock.t = 12_000;
limiter.sweep(); // a idle for 12 s (>= 10 s) -> removed, b idle for 7 s -> kept
assert.equal(limiter.size, 1);
console.log('keys tracked after the sweep:', limiter.size);
assert.equal(limiter.allow('a'), true, 'a starts again with a full bucket');
console.log('all checks passed');
```

```text
keys tracked after the sweep: 1
all checks passed
```

</details>

### Task 3 (harder): an outbox that never loses an event and a consumer that ignores duplicates

Build, in memory, the outbox pattern from section 9. You need:

1. `placeOrder(db, order)` that stores the order in `db.orders` (a `Map`) **and** appends an outbox row `{ id, type, payload, sent: false }` to `db.outbox` (an array) in one step. A duplicate order id must throw and write nothing.
2. `relayOnce(db, publish)` that publishes every unsent row and marks a row `sent` only **after** `publish` succeeded. If `publish` throws, leave the row unsent so the next run retries it.
3. An idempotent consumer `handleOrderPlaced(event)` that "ships" each order exactly once, even if the same event arrives twice.

Test it with a `publish` that delivers `evt-1` but then throws (a lost acknowledgement), run the relay three times, and assert that each order was shipped exactly once.

<details><summary>Hint</summary>

The whole trick is the order of the two steps in the relay: publish first, mark as sent second. If you crash in between, the row is still unsent and will be published again, which is why the consumer needs to remember processed event ids (a `Set` is enough here). In a real database the order row and the outbox row are written in one SQL transaction.

</details>

<details><summary>Solution</summary>

```js
const assert = require('node:assert/strict');

// ---- the "database": two tables
const db = { orders: new Map(), outbox: [] };

// Write the order AND its event together. In SQL this is ONE transaction; here nothing can interrupt it.
function placeOrder(db, order) {
  if (db.orders.has(order.id)) throw new Error(`order ${order.id} already exists`);
  db.orders.set(order.id, order);
  db.outbox.push({ id: `evt-${order.id}`, type: 'OrderPlaced', payload: order, sent: false });
}

// The relay publishes unsent rows. A row is marked sent only AFTER publish succeeded (at-least-once).
async function relayOnce(db, publish) {
  for (const row of db.outbox.filter((r) => !r.sent)) {
    try {
      await publish(row);
      row.sent = true;
    } catch {
      // leave it unsent: the next run tries again
    }
  }
}

// ---- an idempotent consumer
const processed = new Set();
const shipped = [];
function handleOrderPlaced(event) {
  if (processed.has(event.id)) return 'duplicate ignored';
  processed.add(event.id);
  shipped.push(event.payload.id);
  return 'handled';
}

async function main() {
  placeOrder(db, { id: 1, total: 10 });
  placeOrder(db, { id: 2, total: 20 });
  assert.throws(() => placeOrder(db, { id: 1, total: 99 }), /already exists/);

  // A publish function that delivers evt-1 but then "loses the connection" before the relay hears about it.
  let lostAckOnce = false;
  const publish = async (row) => {
    const result = handleOrderPlaced(row);
    console.log(`  published ${row.id}: consumer says "${result}"`);
    if (row.id === 'evt-1' && !lostAckOnce) {
      lostAckOnce = true;
      throw new Error('connection lost after delivery');
    }
  };

  console.log('relay run 1');
  await relayOnce(db, publish);
  console.log('relay run 2');
  await relayOnce(db, publish);
  console.log('relay run 3 (nothing left)');
  await relayOnce(db, publish);

  assert.deepEqual(shipped, [1, 2]);
  assert.ok(db.outbox.every((r) => r.sent));
  console.log('shipped exactly once each:', shipped);
}
main();
```

```text
relay run 1
  published evt-1: consumer says "handled"
  published evt-2: consumer says "handled"
relay run 2
  published evt-1: consumer says "duplicate ignored"
relay run 3 (nothing left)
shipped exactly once each: [ 1, 2 ]
```

In run 1 the event was delivered but the relay never learned it, so it stayed unsent. Run 2 published it again, and the idempotent consumer ignored the duplicate. That is at-least-once delivery plus an idempotent consumer.

</details>

## Where to go next
- Next lesson: [26. Web Frameworks and the Middleware Pattern](../26-frameworks-and-middleware/README.md). It turns the middleware idea from section 7 into real Express, Fastify and Koa code.
- Practise the interview side of this lesson: [Round 3: coding](../../rounds/round-3-coding/questions.md) (rate limiter, LRU cache, retry with backoff, job queue), [Round 4: advanced](../../rounds/round-4-advanced/questions.md) (patterns, queues, resilience) and [Round 5: system design](../../rounds/round-5-system-design/questions.md) (monolith vs microservices, caching, queues, trade-offs).
- Revisit the building blocks: [lesson 07](../07-async-javascript/README.md) (timeouts, retries, concurrency limits), [lesson 09](../09-events/README.md) (EventEmitter), [lesson 11](../11-streams/README.md) (backpressure), [lesson 13](../13-realtime-websockets-sse/README.md) (real-time options), [lesson 14](../14-error-handling-and-debugging/README.md) (when to retry), [lesson 17](../17-databases-and-data-access/README.md) (transactions, pagination, caching with Redis) and [lesson 18](../18-worker-threads-and-cluster/README.md) (stateless design).
