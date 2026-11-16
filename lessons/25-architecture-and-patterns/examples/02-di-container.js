// Dependency injection by hand: constructor injection, a 25-line container, and a test with a fake
// Run: node lessons/25-architecture-and-patterns/examples/02-di-container.js
const assert = require('node:assert/strict');

// ---------- A tiny container: name -> recipe. It builds objects and their dependencies for you.
class Container {
  #recipes = new Map();
  #singletons = new Map();

  // lifetime 'singleton': build once, reuse. 'transient': build a new one on every resolve.
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

    // The factory receives a "get" function so it can ask for ITS dependencies.
    const instance = recipe.factory((dep) => this.resolve(dep, [...path, name]));
    if (recipe.lifetime === 'singleton') this.#singletons.set(name, instance);
    return instance;
  }
}

// ---------- Application classes. They only receive what they need; they never call require() for it.
class Logger {
  log(msg) {
    console.log('  [log]', msg);
  }
}

class SmtpMailer {
  async send(to, subject) {
    console.log(`  [smtp] pretend to send "${subject}" to ${to}`);
  }
}

class UserRepository {
  #rows = [];
  async add(user) {
    this.#rows.push(user);
    return user;
  }
}

class SignupService {
  constructor({ users, mailer, logger }) {
    this.users = users;
    this.mailer = mailer;
    this.logger = logger;
  }
  async signUp(email) {
    await this.users.add({ email });
    await this.mailer.send(email, 'Welcome!');
    this.logger.log(`signed up ${email}`);
  }
}

// ---------- The composition root: one function that lists every recipe
function buildContainer() {
  return new Container()
    .register('logger', () => new Logger())
    .register('mailer', () => new SmtpMailer())
    .register('users', () => new UserRepository())
    .register('signupService', (get) => new SignupService({ users: get('users'), mailer: get('mailer'), logger: get('logger') }));
}

async function main() {
  console.log('--- 1. Resolve the whole graph from the root');
  const container = buildContainer();
  await container.resolve('signupService').signUp('ada@example.com');

  console.log('\n--- 2. Lifetimes');
  console.log('singleton: same logger twice?', container.resolve('logger') === container.resolve('logger'));
  container.register('requestId', () => ({ id: Math.random() }), { lifetime: 'transient' });
  console.log('transient: same object twice?', container.resolve('requestId') === container.resolve('requestId'));

  console.log('\n--- 3. A test: replace the mailer with a fake that records calls');
  const sent = [];
  const testContainer = buildContainer().register('mailer', () => ({
    send: async (to, subject) => sent.push({ to, subject }),
  }));
  await testContainer.resolve('signupService').signUp('bob@example.com');
  assert.deepEqual(sent, [{ to: 'bob@example.com', subject: 'Welcome!' }]);
  console.log('  test passed, the fake mailer saw:', JSON.stringify(sent));

  console.log('\n--- 4. Mistakes are caught with clear messages');
  const broken = new Container()
    .register('a', (get) => ({ b: get('b') }))
    .register('b', (get) => ({ a: get('a') }));
  for (const name of ['a', 'missing']) {
    try {
      broken.resolve(name);
    } catch (err) {
      console.log(`  resolve("${name}") ->`, err.message);
    }
  }

  console.log('\n--- 5. Without DI the dependency is hidden inside the file');
  class HardWired {
    async signUp(email) {
      // In a real file this would be: const mailer = require('./smtp-mailer'); at the top.
      // A test cannot replace it without patching the module cache.
      return new SmtpMailer().send(email, 'Welcome!');
    }
  }
  await new HardWired().signUp('carol@example.com');
  console.log('  a test cannot swap the mailer here without patching require()');
}

main();
