// newListener / removeListener events, and the MaxListenersExceededWarning (forgotten listeners = memory leak)
// Run: node lessons/09-events/examples/05-meta-events-and-leaks.js

const EventEmitter = require('node:events');

// Part 1: the emitter tells you when listeners come and go
console.log('1. newListener and removeListener events');
const feed = new EventEmitter();
feed.on('newListener', (eventName) => {
  // Emitted BEFORE the listener is added, so the count is still the old one.
  console.log(`  newListener: "${String(eventName)}" (count so far: ${feed.listenerCount(eventName)})`);
});
feed.on('removeListener', (eventName) => {
  console.log(`  removeListener: "${String(eventName)}" (count now: ${feed.listenerCount(eventName)})`);
});
function onTick() {}
feed.on('tick', onTick);
feed.on('tick', () => {});
feed.off('tick', onTick);

console.log('2. real use: start work only when the first listener arrives');
const lazy = new EventEmitter();
let started = false;
lazy.on('newListener', (eventName) => {
  if (eventName === 'ready' && !started) {
    started = true;
    console.log('  first "ready" listener added, starting the expensive work');
  }
});
lazy.on('ready', () => {});
lazy.on('ready', () => {});

// Part 2: the leak warning. process.on("warning") lets us read it in the output.
const warnings = [];
process.on('warning', (w) => warnings.push(w));

console.log('3. forgotten listeners: one per "request", never removed');
const sharedBus = new EventEmitter();
for (let request = 1; request <= 12; request++) {
  sharedBus.on('config-changed', () => {}); // BUG: nobody ever removes this
}
console.log('  listeners on the shared bus:', sharedBus.listenerCount('config-changed'));
console.log('  default limit:', EventEmitter.defaultMaxListeners);

function report(label) {
  console.log(`  ${label}: ${warnings.length} warning(s)`);
  for (const w of warnings) {
    console.log('   ', w.name, '| event:', w.type, '| count:', w.count);
  }
  warnings.length = 0;
}

// Warnings are delivered on the next tick, so wait a moment before reading them.
setImmediate(() => {
  report('after the leak');

  console.log('4. fix A: remove the listener when the work is done');
  const bus = new EventEmitter();
  for (let request = 1; request <= 12; request++) {
    const onChange = () => {};
    bus.on('config-changed', onChange);
    // ... the request finishes ...
    bus.off('config-changed', onChange);
  }
  console.log('  listeners left:', bus.listenerCount('config-changed'));

  console.log('5. fix B: use once when each request needs the event only one time');
  const bus2 = new EventEmitter();
  for (let request = 1; request <= 12; request++) {
    bus2.once('config-changed', () => {});
    bus2.emit('config-changed'); // the event arrives, so the once listener is gone
  }
  console.log('  listeners left:', bus2.listenerCount('config-changed'));

  console.log('6. raising the limit is only for emitters that really need many listeners');
  const busy = new EventEmitter();
  busy.setMaxListeners(20);
  for (let i = 0; i < 15; i++) busy.on('x', () => {});
  console.log('  getMaxListeners():', busy.getMaxListeners(), '| listeners:', busy.listenerCount('x'));

  console.log('7. a once listener that fires: what does removeListener receive?');
  const watched = new EventEmitter();
  function original() {}
  watched.on('removeListener', (eventName, fn) => {
    console.log(`  removeListener got the original function: ${fn === original}`);
  });
  watched.once('solo', original);
  watched.emit('solo'); // the only listener of "solo"
  watched.once('shared', original);
  watched.on('shared', () => {});
  watched.emit('shared'); // "shared" has another listener too (Node 24.16 hands over the internal wrapper here)

  setImmediate(() => report('after fixes A, B and the raised limit'));
});
