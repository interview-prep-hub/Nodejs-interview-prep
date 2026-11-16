// Behavioural patterns: observer (EventEmitter), strategy, middleware (chain of responsibility), pub/sub
// Run: node lessons/25-architecture-and-patterns/examples/05-behavioral.js
const { EventEmitter } = require('node:events');

// ======================================================================
// OBSERVER: a subject announces events; any number of observers react. The subject knows none of them.
// ======================================================================
class OrderService extends EventEmitter {
  place(order) {
    // ...save the order here...
    this.emit('orderPlaced', order); // synchronous: all listeners run before emit() returns
    return 'saved';
  }
}

function observerDemo() {
  console.log('--- Observer');
  const orders = new OrderService();
  orders.on('orderPlaced', (o) => console.log('  email listener  : confirmation for order', o.id));
  orders.on('orderPlaced', (o) => console.log('  analytics       : revenue +', o.total));
  console.log('  place() returned:', orders.place({ id: 1, total: 40 }));
  // Adding a new reaction later means adding a listener. OrderService is not edited.
}

// ======================================================================
// STRATEGY: pick an algorithm at run time. Each strategy is a function with the same signature.
// ======================================================================
const shippingStrategies = {
  standard: (kg) => 5 + kg * 1,
  express: (kg) => 15 + kg * 2.5,
  pickup: () => 0,
};

function shippingCost(method, kg) {
  const strategy = shippingStrategies[method];
  if (!strategy) throw new Error(`unknown shipping method "${method}"`);
  return strategy(kg);
}

function strategyDemo() {
  console.log('\n--- Strategy');
  for (const method of ['standard', 'express', 'pickup']) {
    console.log(`  ${method.padEnd(8)} 2 kg -> ${shippingCost(method, 2)}`);
  }
  // Array.prototype.sort(compareFn) is the same idea: you pass the strategy for "how to compare".
  console.log('  sort by length:', ['ccc', 'a', 'bb'].sort((x, y) => x.length - y.length));
}

// ======================================================================
// MIDDLEWARE / CHAIN OF RESPONSIBILITY: a pipeline of steps; each decides to call next() or stop.
// ======================================================================
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

async function middlewareDemo() {
  console.log('\n--- Middleware (chain of responsibility)');
  const log = (ctx, next) => {
    console.log('  1 before: logger sees', ctx.path);
    return next().then(() => console.log('  1 after : logger sees status', ctx.status));
  };
  const auth = async (ctx, next) => {
    if (!ctx.user) {
      console.log('  2 auth   : no user, stop here');
      ctx.status = 401; // short-circuit: next() is NOT called
      return;
    }
    console.log('  2 auth   : user ok');
    await next();
  };
  const handler = async (ctx) => {
    console.log('  3 handler runs for', ctx.user);
    ctx.status = 200;
  };
  const app = compose([log, auth, handler]);

  await app({ path: '/secret', user: 'ada' });
  console.log('  ---');
  await app({ path: '/secret', user: null });
}

// ======================================================================
// PUB/SUB: like observer, but a BROKER sits between them. Publisher and subscriber never meet.
// ======================================================================
class Broker {
  #subs = new Map(); // topic -> Set of handlers
  subscribe(topic, handler) {
    if (!this.#subs.has(topic)) this.#subs.set(topic, new Set());
    this.#subs.get(topic).add(handler);
    return () => this.#subs.get(topic).delete(handler); // returns an unsubscribe function
  }
  async publish(topic, message) {
    // exact topic subscribers, plus 'orders.*' style subscribers for the same first word
    const wildcard = topic.split('.')[0] + '.*';
    const handlers = [...(this.#subs.get(topic) ?? []), ...(this.#subs.get(wildcard) ?? [])];
    // allSettled: one failing subscriber must not stop the others.
    // The async wrapper turns a plain "throw" inside a handler into a rejected promise too.
    const results = await Promise.allSettled(handlers.map(async (h) => h(message)));
    return results.filter((r) => r.status === 'rejected').length;
  }
}

async function pubSubDemo() {
  console.log('\n--- Pub/sub');
  const broker = new Broker();
  broker.subscribe('orders.created', (m) => console.log('  billing  got orders.created:', m));
  broker.subscribe('orders.created', () => {
    throw new Error('shipping service is down');
  });
  broker.subscribe('orders.*', (m) => console.log('  audit    got an orders.* message:', m));
  const unsubscribe = broker.subscribe('orders.created', (m) => console.log('  temp     got:', m));

  const failed = await broker.publish('orders.created', { id: 7 });
  console.log('  subscribers that failed:', failed);
  unsubscribe();
  await broker.publish('orders.created', { id: 8 });
  console.log('  (the temp subscriber is gone after unsubscribe)');
}

async function main() {
  observerDemo();
  strategyDemo();
  await middlewareDemo();
  await pubSubDemo();
}

main();
