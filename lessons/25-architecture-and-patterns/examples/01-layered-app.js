// Layered architecture: controller -> service -> repository, wired in one place, plus a unit of work
// Run: node lessons/25-architecture-and-patterns/examples/01-layered-app.js
const assert = require('node:assert/strict');

// ---------- Domain errors: the service throws these, the controller turns them into status codes
class ValidationError extends Error {}
class ConflictError extends Error {}
class NotFoundError extends Error {}

// ---------- Data layer: a repository hides HOW users are stored (here: a Map, in real life: SQL)
class InMemoryUserRepository {
  #rows = new Map();
  #nextId = 1;
  async create(data) {
    const user = { id: this.#nextId++, ...data };
    this.#rows.set(user.id, user);
    return user;
  }
  async findById(id) {
    return this.#rows.get(id) ?? null;
  }
  async findByEmail(email) {
    return [...this.#rows.values()].find((u) => u.email === email) ?? null;
  }
}

// ---------- Business layer: rules only. No req/res, no SQL.
class UserService {
  constructor({ users }) {
    this.users = users;
  }
  async register({ name, email } = {}) {
    if (!name || !email || !email.includes('@')) throw new ValidationError('name and a valid email are required');
    const normalized = email.toLowerCase();
    if (await this.users.findByEmail(normalized)) throw new ConflictError(`email ${normalized} is already registered`);
    return this.users.create({ name, email: normalized });
  }
  async getUser(id) {
    const user = await this.users.findById(id);
    if (!user) throw new NotFoundError(`user ${id} not found`);
    return user;
  }
}

// ---------- HTTP layer: translate a request into a service call, and errors into status codes
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

// ---------- Routes: a table from "METHOD pattern" to a controller method
function makeRouter(controller) {
  const routes = [
    ['POST', /^\/users$/, controller.create],
    ['GET', /^\/users\/(?<id>\d+)$/, controller.get],
  ];
  return async function handle(method, path, body) {
    for (const [m, pattern, handler] of routes) {
      const match = m === method && pattern.exec(path);
      if (match) return handler({ body, params: match.groups ?? {} });
    }
    return { status: 404, body: { error: 'no such route' } };
  };
}

// ---------- Composition root: the ONE place that knows which concrete classes are used
function buildApp(users) {
  const userService = new UserService({ users });
  return makeRouter(makeUserController({ userService }));
}

async function main() {
  console.log('--- Part 1: the layers working together');
  const handle = buildApp(new InMemoryUserRepository());
  const show = async (method, path, body) => {
    const res = await handle(method, path, body);
    console.log(`${method.padEnd(4)} ${path.padEnd(9)} -> ${res.status} ${JSON.stringify(res.body)}`);
  };
  await show('POST', '/users', { name: 'Ada', email: 'Ada@Example.com' });
  await show('POST', '/users', { name: 'Ada again', email: 'ada@example.com' });
  await show('POST', '/users', { name: 'No email' });
  await show('GET', '/users/1');
  await show('GET', '/users/99');
  await show('GET', '/nope');

  console.log('\n--- Part 2: test the service alone with a fake repository (no HTTP, no database)');
  const saved = [];
  const fakeRepo = {
    findByEmail: async () => null,
    create: async (data) => {
      saved.push(data);
      return { id: 7, ...data };
    },
  };
  const user = await new UserService({ users: fakeRepo }).register({ name: 'Bob', email: 'BOB@x.io' });
  assert.deepEqual(user, { id: 7, name: 'Bob', email: 'bob@x.io' });
  assert.equal(saved.length, 1);
  console.log('service test passed, saved:', JSON.stringify(saved));

  console.log('\n--- Part 3: unit of work (all changes together, or none)');
  await unitOfWorkDemo();
}

// A unit of work collects changes in a working copy and applies them in one step on commit.
class UnitOfWork {
  #store;
  #work;
  constructor(store) {
    this.#store = store;
    this.#work = new Map(store); // working copy
  }
  get(key) {
    return this.#work.get(key);
  }
  set(key, value) {
    this.#work.set(key, value);
  }
  commit() {
    this.#store.clear();
    for (const [k, v] of this.#work) this.#store.set(k, v);
  }
  // No rollback method is needed: if commit() is never called, the working copy is just dropped.
}

async function transfer(store, from, to, amount) {
  const uow = new UnitOfWork(store);
  uow.set(from, uow.get(from) - amount);
  if (uow.get(from) < 0) throw new Error(`insufficient funds in ${from}`);
  uow.set(to, uow.get(to) + amount);
  uow.commit();
}

async function unitOfWorkDemo() {
  const balances = new Map([
    ['alice', 100],
    ['bob', 20],
  ]);
  await transfer(balances, 'alice', 'bob', 30);
  console.log('after a good transfer  :', Object.fromEntries(balances));
  await transfer(balances, 'bob', 'alice', 500).catch((e) => console.log('transfer failed        :', e.message));
  console.log('after a failed transfer:', Object.fromEntries(balances), '(unchanged)');
}

main();
