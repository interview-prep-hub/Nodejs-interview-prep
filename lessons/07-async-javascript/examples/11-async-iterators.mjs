// Top-level await, async generators and for await...of
// Shows how to consume values that arrive over time, one at a time, in an ES module.
// Run: node lessons/07-async-javascript/examples/11-async-iterators.mjs

import { setTimeout as delay } from 'node:timers/promises';
import { EventEmitter, on } from 'node:events';
import { Readable } from 'node:stream';

// 1. Top-level await: allowed only in ES modules (.mjs, or "type": "module"). No async main() needed.
console.log('--- 1: top-level await');
const config = await delay(10, { port: 3000 });
console.log('config loaded before the next line runs:', config);

// 2. An async generator: "async function*". It can await AND yield. for await...of reads it.
async function* countdown(from) {
  for (let n = from; n >= 1; n--) {
    await delay(5);
    yield n;
  }
  return 'liftoff'; // a return value is NOT seen by for await...of
}

console.log('\n--- 2: async generator + for await...of');
for await (const n of countdown(3)) {
  console.log('got', n);
}

// 3. Values are PULLED one at a time. The generator only continues when the loop asks for more.
async function* producer() {
  for (let i = 1; i <= 3; i++) {
    console.log('  producing', i);
    yield i;
  }
}
console.log('\n--- 3: pull-based (the slow consumer sets the pace)');
for await (const item of producer()) {
  await delay(10); // slow consumer
  console.log('  consumed', item);
}

// 4. A realistic use: read a paged API page by page, and stop early with break.
async function* fetchAllItems() {
  const pages = [['a', 'b'], ['c', 'd'], ['e', 'f']]; // pretend each page is one network request
  try {
    for (let page = 0; page < pages.length; page++) {
      await delay(5); // network
      console.log(`  (page ${page + 1} fetched)`);
      yield* pages[page]; // yield each item of the page
    }
  } finally {
    console.log('  cleanup ran (connection closed)'); // runs on break, return, throw or normal end
  }
}

console.log('\n--- 4: paging, with an early break');
for await (const item of fetchAllItems()) {
  console.log('item', item);
  if (item === 'c') break; // leaving the loop early calls the generator's finally block
}

// 5. for await also works on a normal array of promises (it awaits them one by one).
console.log('\n--- 5: for await over an array of promises');
for await (const value of [delay(15, 'slow-1'), delay(5, 'fast-2'), 'plain-3']) {
  console.log('value', value);
}

// 6. Node streams are async iterable. Readable.from builds a stream from an iterable.
console.log('\n--- 6: streams are async iterable');
const chunks = [];
for await (const chunk of Readable.from(['x', 'y', 'z'])) {
  chunks.push(chunk);
}
console.log('chunks:', chunks);

// 7. events.on turns repeated events into an async iterator. "close" lists events that end the loop.
console.log('\n--- 7: events.on');
const emitter = new EventEmitter();
setTimeout(() => {
  emitter.emit('message', 'hello');
  emitter.emit('message', 'world');
  emitter.emit('done');
}, 10);
for await (const [text] of on(emitter, 'message', { close: ['done'] })) {
  console.log('message:', text);
}

// 8. Array.fromAsync collects an async iterable into an array.
console.log('\n--- 8: Array.fromAsync');
console.log(await Array.fromAsync(countdown(3)));

// 9. What for await really does: an async iterable has a [Symbol.asyncIterator]() method that
//    returns an object with next(). next() returns a promise of { value, done }.
console.log('\n--- 9: the protocol, by hand');
const range = {
  from: 1,
  to: 3,
  [Symbol.asyncIterator]() {
    let current = this.from;
    const last = this.to;
    return {
      async next() {
        await delay(5);
        return current <= last ? { value: current++, done: false } : { value: undefined, done: true };
      },
    };
  },
};
for await (const n of range) console.log('range value', n);

console.log('\nall done');
