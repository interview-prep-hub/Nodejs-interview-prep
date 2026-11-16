// The special "error" event: it throws when nobody listens. Also errorMonitor and a safe emit.
// Run: node lessons/09-events/examples/04-error-event.js

const EventEmitter = require('node:events');
const { errorMonitor } = EventEmitter;

console.log('1. emit("error", err) with NO error listener throws err');
const a = new EventEmitter();
try {
  a.emit('error', new Error('disk is full'));
} catch (err) {
  console.log('  caught from emit:', err.message);
}

console.log('2. with an error listener, nothing is thrown');
const b = new EventEmitter();
b.on('error', (err) => console.log('  handled:', err.message));
console.log('  emit returned:', b.emit('error', new Error('disk is full')));

console.log('3. an error event without an Error object throws a different error');
try {
  new EventEmitter().emit('error', 'just a string');
} catch (err) {
  console.log('  code:', err.code);
  console.log('  message:', err.message);
  console.log('  context:', err.context);
}

console.log('4. errorMonitor sees errors but does not handle them');
const c = new EventEmitter();
c.on(errorMonitor, (err) => console.log('  monitor logged:', err.message));
try {
  c.emit('error', new Error('still unhandled'));
} catch (err) {
  console.log('  and it still threw:', err.message);
}

console.log('5. a listener that throws breaks the rest of the emit');
const d = new EventEmitter();
d.on('job', () => console.log('  listener 1 ran'));
d.on('job', () => {
  throw new Error('listener 2 failed');
});
d.on('job', () => console.log('  listener 3 ran'));
try {
  d.emit('job');
} catch (err) {
  console.log('  emit threw:', err.message, '(listener 3 never ran)');
}

console.log('6. safeEmit: give every listener its own try/catch');
function safeEmit(emitter, name, ...args) {
  for (const listener of emitter.rawListeners(name)) {
    try {
      listener.apply(emitter, args);
    } catch (err) {
      console.log('  listener failed, carrying on:', err.message);
    }
  }
}
safeEmit(d, 'job');
