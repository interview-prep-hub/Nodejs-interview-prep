// EventTarget and Event (the web-style API) compared with EventEmitter
// Run: node lessons/09-events/examples/09-event-target.js

const EventEmitter = require('node:events');
const { getEventListeners } = EventEmitter;

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

// Errors thrown by EventTarget listeners are reported as uncaught exceptions on the next tick.
// We catch them here so the example can show what happens.
process.on('uncaughtException', (err, origin) => {
  console.log(`  [process] ${origin}:`, err.message);
});

async function main() {
  console.log('1. EventTarget basics: addEventListener, dispatchEvent, an Event object');
  const target = new EventTarget();
  target.addEventListener('ping', (event) => {
    console.log('  got event of type:', event.type);
    console.log('  event.target === target:', event.target === target);
  });
  target.dispatchEvent(new Event('ping'));

  console.log('2. dispatchEvent is synchronous too');
  target.addEventListener('sync', () => console.log('  listener ran'));
  console.log('  before');
  target.dispatchEvent(new Event('sync'));
  console.log('  after');

  console.log('3. data travels inside the event: CustomEvent and detail');
  target.addEventListener('order', (event) => {
    console.log('  order detail:', event.detail);
  });
  target.dispatchEvent(new CustomEvent('order', { detail: { id: 7, total: 30 } }));

  console.log('4. the same function added twice is only registered once');
  function same() {
    console.log('  same() ran');
  }
  target.addEventListener('dup', same);
  target.addEventListener('dup', same);
  target.dispatchEvent(new Event('dup'));
  console.log('  getEventListeners count:', getEventListeners(target, 'dup').length);
  const emitter = new EventEmitter();
  emitter.on('dup', same);
  emitter.on('dup', same);
  console.log('  EventEmitter count for the same case:', emitter.listenerCount('dup'));

  console.log('5. options: once and signal');
  target.addEventListener('once', () => console.log('  once ran'), { once: true });
  target.dispatchEvent(new Event('once'));
  target.dispatchEvent(new Event('once'));
  const controller = new AbortController();
  target.addEventListener('sig', () => console.log('  sig ran'), { signal: controller.signal });
  target.dispatchEvent(new Event('sig'));
  controller.abort(); // removes the listener
  target.dispatchEvent(new Event('sig'));
  console.log('  (second dispatch printed nothing)');

  console.log('6. preventDefault: dispatchEvent returns false for a cancelable event');
  target.addEventListener('close-request', (event) => event.preventDefault());
  console.log('  cancelable:', target.dispatchEvent(new Event('close-request', { cancelable: true })));
  console.log('  not cancelable:', target.dispatchEvent(new Event('close-request')));

  console.log('7. a throwing listener does not reach the caller of dispatchEvent');
  const risky = new EventTarget();
  risky.addEventListener('x', () => {
    throw new Error('listener failed');
  });
  risky.addEventListener('x', () => console.log('  second listener still ran'));
  const result = risky.dispatchEvent(new Event('x'));
  console.log('  dispatchEvent returned:', result, '(no exception here)');
  await nextTurn(); // the error is reported on the next tick

  console.log('8. no "error" magic, no emit, no listenerCount, no eventNames');
  console.log('  typeof target.on:', typeof target.on);
  console.log('  typeof target.emit:', typeof target.emit);
  console.log('  typeof target.listenerCount:', typeof target.listenerCount);
  console.log('  typeof target.eventNames:', typeof target.eventNames);

  console.log('9. you can extend EventTarget like EventEmitter');
  class Door extends EventTarget {
    open() {
      this.dispatchEvent(new Event('open'));
    }
  }
  const door = new Door();
  door.addEventListener('open', () => console.log('  door opened'));
  door.open();

  console.log('10. AbortSignal is an EventTarget');
  const ac = new AbortController();
  console.log('  signal instanceof EventTarget:', ac.signal instanceof EventTarget);
  ac.signal.addEventListener('abort', () => console.log('  abort event fired'), { once: true });
  ac.abort();

  console.log('11. stopImmediatePropagation: skip the remaining listeners (EventEmitter cannot do this)');
  const chain = new EventTarget();
  chain.addEventListener('go', (event) => {
    console.log('  first listener ran, stopping the rest');
    event.stopImmediatePropagation();
  });
  chain.addEventListener('go', () => console.log('  second listener (never printed)'));
  chain.dispatchEvent(new Event('go'));
}

main();
