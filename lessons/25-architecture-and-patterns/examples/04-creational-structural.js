// Creational and structural patterns: singleton, factory, builder, adapter, decorator, proxy
// Run: node lessons/25-architecture-and-patterns/examples/04-creational-structural.js
const path = require('node:path');

// ======================================================================
// SINGLETON: one shared instance. In Node the module cache gives it to you for free.
// ======================================================================
function singletonDemo() {
  console.log('--- Singleton via the module cache');
  const a = require('./_counter-singleton');
  const b = require('./_counter-singleton'); // second require: NOT executed again, same exports object
  console.log('same object?', a === b);
  console.log('a.next() ->', a.next(), '| b.next() ->', b.next(), '(shared state)');
  const key = Object.keys(require.cache).find((k) => k.endsWith('_counter-singleton.js'));
  console.log('cache key is the resolved file name:', path.basename(key));

  // Gotcha: the cache key is the file path, so deleting the entry gives you a SECOND instance.
  delete require.cache[key];
  const c = require('./_counter-singleton');
  console.log('after deleting the cache entry, same object?', a === c, '| c.next() ->', c.next());
}

// ======================================================================
// FACTORY: a function that decides WHICH object to build. Callers just say what they want.
// ======================================================================
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

function factoryDemo() {
  console.log('\n--- Factory');
  createLogger('console').log('hello');
  const mem = createLogger('memory');
  mem.log('one');
  mem.log('two');
  console.log('  memory logger kept:', mem.lines);
  try {
    createLogger('fax');
  } catch (err) {
    console.log('  error:', err.message);
  }
}

// ======================================================================
// BUILDER: build a complex object step by step, then call build() once.
// ======================================================================
class QueryBuilder {
  #table;
  #conditions = [];
  #params = [];
  #order = '';
  #limit = null;
  from(table) {
    this.#table = table;
    return this; // returning "this" is what makes the calls chain
  }
  where(column, op, value) {
    this.#conditions.push(`${column} ${op} ?`); // values go into placeholders, never into the SQL text
    this.#params.push(value);
    return this;
  }
  orderBy(column, dir = 'ASC') {
    this.#order = ` ORDER BY ${column} ${dir}`;
    return this;
  }
  limit(n) {
    this.#limit = n;
    return this;
  }
  build() {
    if (!this.#table) throw new Error('from() is required');
    const where = this.#conditions.length ? ` WHERE ${this.#conditions.join(' AND ')}` : '';
    const limit = this.#limit === null ? '' : ` LIMIT ${Number(this.#limit)}`;
    return { sql: `SELECT * FROM ${this.#table}${where}${this.#order}${limit}`, params: this.#params };
  }
}

function builderDemo() {
  console.log('\n--- Builder');
  const query = new QueryBuilder().from('users').where('age', '>', 18).where('country', '=', 'PK').orderBy('name').limit(10).build();
  console.log(query);
}

// ======================================================================
// ADAPTER: make a foreign interface look like the one YOUR code expects.
// ======================================================================
// Two payment providers with different shapes (both made up for this example):
const fastPay = {
  charges: { create: async ({ amountCents, currency }) => ({ id: 'fp_1', status: 'succeeded', amountCents, currency }) },
};
const oldBank = {
  makePayment: (dollars, callback) => setImmediate(() => callback(null, `OB-${dollars}`)),
};

// What OUR app wants: pay({ cents }) -> Promise<{ ok, reference }>
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

// ======================================================================
// DECORATOR: wrap something to add behaviour, keeping the same interface.
// ======================================================================
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

async function adapterAndDecoratorDemo() {
  console.log('\n--- Adapter: two different providers, one interface');
  for (const [name, provider] of Object.entries(providers)) {
    console.log(`  ${name}:`, JSON.stringify(await provider.pay({ cents: 1250 })));
  }

  console.log('\n--- Decorator: add logging and timing without touching the provider');
  let fakeNow = 0;
  const now = () => (fakeNow += 25); // a fake clock that moves 25 ms on every call
  const decorated = withLogging('fastPay.pay', withTiming(providers.fastPay.pay, now));
  await decorated({ cents: 1250 });
}

// ======================================================================
// PROXY: same interface, but it CONTROLS access (lazy creation, read-only guard).
// ======================================================================
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

function proxyDemo() {
  console.log('\n--- Proxy');
  const report = lazy(() => {
    console.log('  (building the heavy report engine now)');
    return { run: () => 'report done' };
  });
  console.log('  proxy created, nothing built yet');
  console.log('  first use:', report.run());
  console.log('  second use:', report.run());

  const config = readOnly({ mode: 'prod' });
  try {
    config.mode = 'dev';
  } catch (err) {
    console.log('  error:', err.message);
  }
  console.log('  reading still works:', config.mode);

  // Gotcha: wrapping an object that has #private fields in a Proxy breaks its methods,
  // because inside the method "this" is the proxy, and the proxy does not have the private field.
  class Counter {
    #n = 0;
    inc() {
      return ++this.#n;
    }
  }
  try {
    new Proxy(new Counter(), {}).inc();
  } catch (err) {
    console.log('  gotcha:', `${err.name}: ${err.message}`);
  }
}

async function main() {
  singletonDemo();
  factoryDemo();
  builderDemo();
  await adapterAndDecoratorDemo();
  proxyDemo();
}

main();
