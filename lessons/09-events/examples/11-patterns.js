// Patterns: pub/sub, a shared event bus, and request-scoped events
// Run: node lessons/09-events/examples/11-patterns.js

const http = require('node:http');
const EventEmitter = require('node:events');
const { once, EventEmitterAsyncResource } = EventEmitter;
const { AsyncLocalStorage } = require('node:async_hooks');
const bus = require('./_bus.js'); // one shared emitter (see _bus.js)
const audit = require('./_audit.js'); // a module that listens on that bus

// Pattern 1: pub/sub. Publishers and subscribers only share a topic name.
// subscribe() hands back an "unsubscribe" function, so nobody needs to keep the handler around.
class PubSub {
  #emitter = new EventEmitter();

  subscribe(topic, handler) {
    this.#emitter.on(topic, handler);
    return () => this.#emitter.off(topic, handler);
  }

  publish(topic, message) {
    return this.#emitter.emit(topic, message);
  }
}

// Pattern 3a: one emitter per job. It is created for one request and thrown away after it.
function runJob(url) {
  const job = new EventEmitter();
  setImmediate(() => {
    job.emit('step', `parsed ${url}`);
    job.emit('step', `loaded data for ${url}`);
    job.emit('done', { url, ok: true });
  });
  return job;
}

async function main() {
  console.log('1. pub/sub with an unsubscribe function');
  const pubsub = new PubSub();
  const unsubscribe = pubsub.subscribe('news', (text) => console.log('  subscriber got:', text));
  pubsub.publish('news', 'first');
  unsubscribe();
  console.log('  published after unsubscribe, anyone listening?', pubsub.publish('news', 'second'));

  console.log('2. event bus: the code that emits and the module that listens never import each other');
  console.log('  same object from every require():', require('./_bus.js') === bus);
  bus.emit('user:created', { name: 'Ann' }); // _audit.js reacts to this
  bus.emit('user:created', { name: 'Bob' });
  console.log('  audit module saw:', audit.seen);
  console.log('  bus.eventNames():', bus.eventNames());

  console.log('3. request-scoped events: one emitter per request');
  const server = http.createServer((req, res) => {
    const log = [];
    const job = runJob(req.url); // new emitter for THIS request only
    job.on('step', (text) => log.push(text));
    job.once('done', (result) => res.end(JSON.stringify({ result, log })));
  });
  server.listen(0);
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const path of ['/a', '/b']) {
    const body = await (await fetch(base + path)).json();
    console.log(`  GET ${path} ->`, JSON.stringify(body));
  }
  server.close();
  await once(server, 'close');

  console.log('4. request-scoped event NAMES: a correlation id on the shared bus');
  bus.on('question', ({ id, text }) => {
    // a pretend worker; it answers on an event name that contains the id
    setTimeout(() => bus.emit(`answer:${id}`, text.toUpperCase()), 5);
  });
  let nextId = 0;
  function ask(text) {
    const id = ++nextId;
    return new Promise((resolve) => {
      bus.once(`answer:${id}`, resolve); // once: the listener cleans itself up
      bus.emit('question', { id, text });
    });
  }
  const answers = await Promise.all([ask('one'), ask('two'), ask('three')]);
  console.log('  answers:', answers);
  console.log('  listeners left on the bus:', bus.eventNames());

  console.log('5. advanced: which request context do listeners see?');
  const store = new AsyncLocalStorage(); // keeps a value (like a request id) for the whole async call chain
  const plain = new EventEmitter();
  const tracked = store.run('created-here', () => new EventEmitterAsyncResource({ name: 'Tracked' }));
  plain.on('hi', () => console.log('  plain EventEmitter listener sees:', store.getStore()));
  tracked.on('hi', () => console.log('  EventEmitterAsyncResource listener sees:', store.getStore()));
  store.run('request-42', () => {
    plain.emit('hi'); // emit is synchronous, so the listener runs inside request-42
    tracked.emit('hi'); // this class always runs listeners in the context where it was created
  });
}

main();
