// events.once and events.on: events as promises and as async iterators, with AbortSignal
// Run: node lessons/09-events/examples/07-events-once-on.js

const http = require('node:http');
const EventEmitter = require('node:events');
const { once, on } = EventEmitter;

async function main() {
  console.log('1. await once(): wait for one event');
  const job = new EventEmitter();
  setTimeout(() => job.emit('ready', 'result-1', 'extra'), 5);
  const args = await once(job, 'ready'); // an ARRAY of all emitted arguments
  console.log('  arguments:', args);
  console.log('  listeners left:', job.listenerCount('ready'), '(it cleaned up after itself)');

  console.log('2. once() rejects if the emitter emits "error" first');
  const broken = new EventEmitter();
  setTimeout(() => broken.emit('error', new Error('connection lost')), 5);
  try {
    await once(broken, 'ready');
  } catch (err) {
    console.log('  rejected with:', err.message);
  }

  console.log('3. on(): a for await loop over events');
  const ticker = new EventEmitter();
  setTimeout(() => {
    ticker.emit('tick', 1);
    ticker.emit('tick', 2);
    ticker.emit('tick', 3);
    ticker.emit('end');
  }, 5);
  // close: ['end'] stops the loop when "end" is emitted
  for await (const [n] of on(ticker, 'tick', { close: ['end'] })) {
    console.log('  tick', n);
  }
  console.log('  loop finished, listeners left:', ticker.listenerCount('tick'));

  console.log('4. break out of the loop: the listener is removed');
  const endless = new EventEmitter();
  setTimeout(() => {
    endless.emit('tick', 'a');
    endless.emit('tick', 'b');
  }, 5);
  for await (const [value] of on(endless, 'tick')) {
    console.log('  got', value, 'and leaving');
    break;
  }
  console.log('  listeners left:', endless.listenerCount('tick'));

  console.log('5. AbortSignal cancels a wait');
  const silent = new EventEmitter();
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);
  try {
    await once(silent, 'never-happens', { signal: controller.signal });
  } catch (err) {
    console.log('  rejected:', err.name, err.code);
    console.log('  listeners left:', silent.listenerCount('never-happens'));
  }

  console.log('6. AbortSignal also stops a for await loop');
  const stream = new EventEmitter();
  const stop = new AbortController();
  setTimeout(() => stream.emit('data', 'chunk-1'), 5);
  setTimeout(() => stop.abort(), 15);
  try {
    for await (const [chunk] of on(stream, 'data', { signal: stop.signal })) {
      console.log('  received', chunk);
    }
  } catch (err) {
    console.log('  loop ended by', err.name);
  }

  console.log('7. real use: wait until a server is listening, then until it is closed');
  const server = http.createServer();
  server.listen(0); // port 0: the OS picks a free port
  await once(server, 'listening');
  console.log('  listening on a real port:', server.address().port > 0);
  server.close();
  await once(server, 'close');
  console.log('  closed');
}

main();
