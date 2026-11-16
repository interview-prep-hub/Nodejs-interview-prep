// Typing async code, callbacks and EventEmitter
// Shows: Promise<T>, Promise.all with tuples, allSettled, a callback-to-promise helper, a typed EventEmitter
// Run: node lessons/21-typescript-with-node/examples/08-async-and-events.ts

import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

type User = { id: number; name: string };

// 1. An async function always returns a Promise. You write the type of the value INSIDE it.
async function loadUser(id: number): Promise<User> {
  await sleep(1);
  if (id < 0) throw new Error(`bad id ${id}`);
  return { id, name: `user${id}` }; // a plain object, but callers receive Promise<User>
}

const user = await loadUser(1); // await unwraps: user is a User
console.log('1.', user);

// Promise.all keeps one type per position (a tuple), so destructuring is fully typed.
const [a, b, pause] = await Promise.all([loadUser(2), loadUser(3), sleep(1)]);
console.log('   all:', a.name, b.name, pause); // pause is void, so undefined

// 2. Promise.allSettled returns a discriminated union. Check "status" to narrow it.
const settled = await Promise.allSettled([loadUser(4), loadUser(-1)]);
for (const item of settled) {
  if (item.status === 'fulfilled') console.log('2. fulfilled:', item.value.name);
  else console.log('2. rejected:', (item.reason as Error).message);
}

// 3. Node's own APIs are typed too. readFile returns a string when you pass an encoding,
// and a Buffer when you do not. (These are overloads in the type definitions.)
const asText = await readFile(import.meta.filename, 'utf8'); // string
const asBytes = await readFile(import.meta.filename); // Buffer
console.log('3.', typeof asText, Buffer.isBuffer(asBytes));

// 4. Turning an old-style callback API into a promise, with a generic helper.
type NodeCallback<T> = (error: Error | null, result?: T) => void;

function fromCallback<T>(start: (done: NodeCallback<T>) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    start((error, result) => {
      if (error) reject(error);
      else resolve(result as T); // result is T | undefined, so we assert it is there
    });
  });
}
const doubled = await fromCallback<number>((done) => setTimeout(() => done(null, 21 * 2), 1));
console.log('4. from callback:', doubled);

// 5. A typed EventEmitter. The type argument maps each event name to its list of arguments.
type JobEvents = {
  started: [id: number];
  progress: [id: number, percent: number];
  finished: [id: number, result: string];
  error: [error: Error];
};
const jobs = new EventEmitter<JobEvents>();

jobs.on('started', (id) => console.log(`5. job ${id} started`));
jobs.on('progress', (id, percent) => console.log(`   job ${id} at ${percent.toFixed(0)}%`)); // percent: number
jobs.once('finished', (id, result) => console.log(`   job ${id} finished with ${result}`));
jobs.on('error', (error) => console.log('   job error:', error.message));

// @ts-expect-error typo in the event name: "finishd" is not in JobEvents
jobs.on('finishd', () => {});

jobs.emit('started', 7);
jobs.emit('progress', 7, 50);
jobs.emit('finished', 7, 'ok');
jobs.emit('error', new Error('disk full'));

// emit() is checked too. This call forgets the percent argument. (It is harmless at runtime only because
// nobody listens on this second emitter. On `jobs` the listener above would crash on percent.toFixed.)
const spare = new EventEmitter<JobEvents>();
// @ts-expect-error progress needs two arguments (id and percent)
spare.emit('progress', 7);
