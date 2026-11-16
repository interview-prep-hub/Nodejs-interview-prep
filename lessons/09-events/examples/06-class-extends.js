// Extending EventEmitter in a class: the usual way real code uses events
// Run: node lessons/09-events/examples/06-class-extends.js

const EventEmitter = require('node:events');

// A small worker that reports progress by emitting events.
class Downloader extends EventEmitter {
  constructor(name, steps) {
    super(); // always call super() first, it sets up the emitter
    this.name = name;
    this.steps = steps;
  }

  start() {
    let done = 0;
    const timer = setInterval(() => {
      done++;
      // Arrow function: "this" is still the Downloader.
      this.emit('progress', Math.round((done / this.steps) * 100));
      if (done === this.steps) {
        clearInterval(timer);
        this.emit('done', { name: this.name, steps: done });
      }
    }, 5);
    return this; // so you can write new Downloader(...).start()
  }

  fail(message) {
    this.emit('error', new Error(`${this.name}: ${message}`));
  }
}

// A class that emits from its constructor: nobody can be listening yet.
class Eager extends EventEmitter {
  constructor() {
    super();
    this.emit('ready'); // lost: the caller has no object to attach a listener to
  }
}

// A class that delays the emit until the caller had a chance to listen.
class Patient extends EventEmitter {
  constructor() {
    super();
    process.nextTick(() => this.emit('ready'));
  }
}

// Composition: hold an emitter inside instead of extending it.
class Door {
  #events = new EventEmitter();
  on(name, fn) {
    this.#events.on(name, fn);
    return this;
  }
  open() {
    this.#events.emit('open');
  }
}

// Override emit to see every event. Node has no wildcard listener, so this is the usual trick.
class LoudEmitter extends EventEmitter {
  emit(name, ...args) {
    if (name !== '*') super.emit('*', name, ...args); // tell the "any event" listeners first
    return super.emit(name, ...args); // keep the normal behaviour and return value
  }
}

async function main() {
  console.log('1. a class that extends EventEmitter');
  const dl = new Downloader('report.pdf', 4);
  console.log('  is an EventEmitter:', dl instanceof EventEmitter);
  dl.on('progress', (percent) => console.log(`  progress: ${percent}%`));
  dl.on('error', (err) => console.log('  error event:', err.message));
  await new Promise((resolve) => {
    dl.on('done', (info) => {
      console.log('  done:', info);
      resolve();
    });
    dl.start();
  });
  dl.fail('connection reset');

  console.log('2. emitting from the constructor is lost');
  const eager = new Eager();
  eager.on('ready', () => console.log('  eager: never printed'));
  const patient = new Patient();
  patient.on('ready', () => console.log('  patient: heard ready'));
  await new Promise((resolve) => setImmediate(resolve));

  console.log('3. composition: expose only the methods you choose');
  const door = new Door();
  door.on('open', () => console.log('  door opened'));
  console.log('  door.emit is a function:', typeof door.emit === 'function');
  door.open();

  console.log('4. override emit to watch every event (a simple wildcard)');
  const loud = new LoudEmitter();
  loud.on('*', (name, ...args) => console.log(`  [any event] ${name}`, args));
  loud.on('saved', (file) => console.log('  saved listener:', file));
  console.log('  emit(saved) returned:', loud.emit('saved', 'a.txt'));
  console.log('  emit(deleted) returned:', loud.emit('deleted', 'a.txt'));
}

main();
