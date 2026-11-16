// Node helpers for promises: util.promisify, util.callbackify, timers/promises, events.once
// Shows how to move between callbacks and promises using what Node already gives you.
// Run: node lessons/07-async-javascript/examples/10-node-helpers.js

const fs = require('node:fs');
const util = require('node:util');
const { EventEmitter, once } = require('node:events');
const timersPromises = require('node:timers/promises');

// ---------------------------------------------------------------------------
// 1. util.promisify: turns an error-first callback function into a promise function.
async function part1() {
  console.log('--- 1: util.promisify');
  const readFile = util.promisify(fs.readFile); // same as fs.promises.readFile
  const text = await readFile(__filename, 'utf8');
  console.log('read', text.length > 0 ? 'some text' : 'nothing', 'with promisify(fs.readFile)');

  await readFile(__dirname + '/does-not-exist.txt').catch((err) => console.log('missing file ->', err.code));

  // Gotcha: a method loses `this` when you promisify it on its own. Bind it first.
  class Db {
    prefix = 'db:';
    get(key, callback) {
      const value = this.prefix + key; // needs `this`
      setTimeout(() => callback(null, value), 1);
    }
  }
  const db = new Db();
  const detached = util.promisify(db.get);
  const bound = util.promisify(db.get.bind(db));
  console.log('detached:', await detached('a').catch((err) => err.constructor.name));
  console.log('bound   :', await bound('a'));

  // Some functions have a custom promisified version. promisify(setTimeout) is one of them.
  const sleep = util.promisify(setTimeout);
  console.log('promisify(setTimeout) resolves with the 2nd argument:', await sleep(5, 'woke up'));

  // You can define your own custom version with util.promisify.custom.
  function legacy(callback) {
    callback(null, 'first', 'second'); // two success values: promisify keeps only the first
  }
  console.log('default promisify keeps one value:', await util.promisify(legacy)());
  legacy[util.promisify.custom] = () => new Promise((resolve) => legacy((err, a, b) => resolve([a, b])));
  console.log('custom promisify keeps both      :', await util.promisify(legacy)());
}

// ---------------------------------------------------------------------------
// 2. util.callbackify: the opposite direction (for old code that wants a callback).
async function part2() {
  console.log('\n--- 2: util.callbackify');
  async function double(n) {
    if (n < 0) throw new Error('negative');
    return n * 2;
  }
  const doubleCb = util.callbackify(double);
  await new Promise((resolve) => {
    doubleCb(21, (err, result) => {
      console.log('callbackify success: err =', err, 'result =', result);
      doubleCb(-1, (err2, result2) => {
        console.log('callbackify failure: err =', err2.message, 'result =', result2);
        resolve();
      });
    });
  });

  // Gotcha: a promise that rejects with a falsy value (null, 0, '') is wrapped in an Error.
  await new Promise((resolve) => {
    util.callbackify(() => Promise.reject(null))((err) => {
      console.log('rejected with null ->', err.code, '| original reason:', err.reason);
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
// 3. timers/promises: setTimeout, setImmediate and setInterval that already return promises.
async function part3() {
  console.log('\n--- 3: timers/promises');
  const value = await timersPromises.setTimeout(10, 'value after 10 ms');
  console.log(value);
  console.log(await timersPromises.setImmediate('value from setImmediate'));

  // setInterval returns an ASYNC ITERATOR: one loop turn per tick. Use break to stop it.
  let ticks = 0;
  for await (const label of timersPromises.setInterval(10, 'tick')) {
    ticks++;
    console.log(label, ticks);
    if (ticks === 3) break;
  }
}

// ---------------------------------------------------------------------------
// 4. events.once: wait for ONE event as a promise.
async function part4() {
  console.log('\n--- 4: events.once');
  const emitter = new EventEmitter();
  setTimeout(() => emitter.emit('ready', 'db', 5432), 10);
  const args = await once(emitter, 'ready'); // an ARRAY of all the arguments of the event
  console.log('ready event arguments:', args);

  // If the emitter emits 'error' while we wait, the promise rejects.
  setTimeout(() => emitter.emit('error', new Error('connection lost')), 10);
  await once(emitter, 'ready').catch((err) => console.log('once rejected with:', err.message));

  // It can be cancelled with a signal. We use a normal timer plus AbortController here, because
  // the timer inside AbortSignal.timeout() does NOT keep the process alive: with nothing else
  // pending, Node would simply exit before the timeout fires (and exit code 0, silently).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20);
  await once(emitter, 'ready', { signal: controller.signal })
    .catch((err) => console.log('once with a signal:', err.name))
    .finally(() => clearTimeout(timer));

  // Gotcha: start listening BEFORE the event can happen. An event that already fired is gone.
  emitter.emit('late-event');
  const waited = once(emitter, 'late-event');
  const result = await Promise.race([waited, timersPromises.setTimeout(20, 'never arrived')]);
  console.log('event emitted before once():', result);
}

async function main() {
  await part1();
  await part2();
  await part3();
  await part4();
}

main();
