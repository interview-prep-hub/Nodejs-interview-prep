// Async listeners: emit() does not wait for them, and their errors are not thrown by emit(). Fixes included.
// Run: node lessons/09-events/examples/08-async-listeners.js

const EventEmitter = require('node:events');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Without this, the unhandled rejection in part 2 would crash the process (exit code 1).
process.on('unhandledRejection', (reason) => {
  console.log('  [process] unhandledRejection:', reason.message);
});

// A helper that DOES wait: call every listener and wait for all the promises.
async function emitAsync(emitter, name, ...args) {
  const results = emitter.rawListeners(name).map((listener) => listener.apply(emitter, args));
  await Promise.all(results);
  return results.length > 0;
}

async function main() {
  console.log('1. emit does not wait for an async listener');
  const a = new EventEmitter();
  a.on('save', async (name) => {
    await sleep(20);
    console.log('  async listener finished saving', name);
  });
  const returned = a.emit('save', 'file.txt');
  console.log('  emit already returned:', returned);
  console.log('  (the listener is still running)');
  await sleep(40);

  console.log('2. a rejected async listener does NOT make emit throw');
  const b = new EventEmitter();
  b.on('save', async () => {
    throw new Error('disk is full');
  });
  try {
    b.emit('save');
    console.log('  emit did not throw');
  } catch (err) {
    console.log('  caught by try/catch:', err.message);
  }
  await sleep(10);

  console.log('3. fix A: try/catch inside the async listener');
  const c = new EventEmitter();
  c.on('save', async () => {
    try {
      throw new Error('disk is full');
    } catch (err) {
      console.log('  handled inside the listener:', err.message);
    }
  });
  c.emit('save');
  await sleep(10);

  console.log('4. fix B: captureRejections sends rejections to the "error" event');
  const d = new EventEmitter({ captureRejections: true });
  d.on('error', (err) => console.log('  error event received:', err.message));
  d.on('save', async () => {
    throw new Error('disk is full');
  });
  d.emit('save');
  await sleep(10);

  console.log('5. fix C: a custom handler with Symbol.for("nodejs.rejection")');
  const e = new EventEmitter({ captureRejections: true });
  e[Symbol.for('nodejs.rejection')] = (err, eventName, ...args) => {
    console.log(`  rejection handler: "${err.message}" from event "${eventName}" with args`, args);
  };
  e.on('save', async () => {
    throw new Error('disk is full');
  });
  e.emit('save', 'file.txt');
  await sleep(10);

  console.log('6. fix D: emitAsync waits for every listener');
  const f = new EventEmitter();
  f.on('save', async () => {
    await sleep(20);
    console.log('  listener 1 done');
  });
  f.on('save', async () => {
    await sleep(5);
    console.log('  listener 2 done');
  });
  await emitAsync(f, 'save');
  console.log('  now every listener is finished');
}

main();
