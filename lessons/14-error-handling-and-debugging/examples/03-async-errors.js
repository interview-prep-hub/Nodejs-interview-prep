// Errors in callbacks, promises and async/await, and why try/catch misses errors thrown later
// Run: node lessons/14-error-handling-and-debugging/examples/03-async-errors.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const util = require('node:util');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const missing = path.join(os.tmpdir(), 'no-such-file-14.txt');

// ---------------------------------------------------------------------------
function part1() {
  console.log('1. Error-first callbacks: the first argument is the error, or null');
  return new Promise((resolve) => {
    fs.readFile(missing, 'utf8', (err, data) => {
      if (err) {
        console.log('  callback got err.code =', err.code, '| data =', data);
        return resolve(); // "return" stops the function: a classic bug is forgetting it
      }
      console.log('  never printed');
      resolve();
    });
  });
}

// ---------------------------------------------------------------------------
function part2() {
  console.log('2. try/catch cannot catch an error thrown in a LATER callback');
  return new Promise((resolve) => {
    // Without this handler the process would crash. We register it only to prove who receives the error.
    process.once('uncaughtException', (err, origin) => {
      console.log(`  process-level handler got: "${err.message}" (origin: ${origin})`);
      resolve();
    });
    try {
      setTimeout(() => {
        throw new Error('thrown from a timer');
      }, 5);
      console.log('  try block finished normally, the timer has not fired yet');
    } catch (e) {
      console.log('  never printed:', e.message); // the call stack of the try is long gone when the timer fires
    }
  });
}

// ---------------------------------------------------------------------------
async function part3() {
  console.log('3. Promises: a throw inside .then becomes a rejection, .catch handles it');
  const result = await Promise.resolve(1)
    .then((n) => {
      if (n === 1) throw new Error('step 1 failed');
      return n;
    })
    .then(() => console.log('  skipped: the chain jumps over this'))
    .catch((e) => {
      console.log('  .catch got:', e.message);
      return 'recovered value'; // returning a value turns the chain back to success
    })
    .finally(() => console.log('  .finally runs either way'));
  console.log('  chain result:', result);
}

// ---------------------------------------------------------------------------
async function part4() {
  console.log('4. async/await: try/catch around await works like synchronous code');
  try {
    await fs.promises.readFile(missing, 'utf8');
  } catch (e) {
    console.log('  caught:', e.code);
  }

  console.log('  an async function never throws synchronously, it returns a rejected promise');
  async function broken() {
    throw new Error('inside async');
  }
  let promise;
  try {
    promise = broken(); // no await here, so try/catch has nothing to catch
    console.log('  no sync error. broken() returned a promise:', promise instanceof Promise);
  } catch {
    console.log('  never printed');
  }
  // If nobody attached a handler, this rejection would be "unhandled" and crash the process (see example 06).
  await promise.catch((e) => console.log('  but .catch sees it:', e.message));
}

// ---------------------------------------------------------------------------
async function part5() {
  console.log('5. "return promise" versus "return await promise" inside try');
  const failLater = async () => {
    await sleep(1);
    throw new Error('failed later');
  };
  async function withoutAwait() {
    try {
      return failLater(); // the promise leaves the try block before it fails
    } catch {
      return 'caught inside';
    }
  }
  async function withAwait() {
    try {
      return await failLater(); // waits inside the try, so catch can see the error
    } catch {
      return 'caught inside';
    }
  }
  console.log('  without await:', await withoutAwait().catch((e) => `NOT caught inside (caller got: ${e.message})`));
  console.log('  with await   :', await withAwait());
}

// ---------------------------------------------------------------------------
async function part6() {
  console.log('6. Several promises: all, allSettled, any');
  const ok = (v) => sleep(5).then(() => v);
  const bad = (m) => sleep(2).then(() => Promise.reject(new Error(m)));

  await Promise.all([ok('a'), bad('b failed'), ok('c')]).catch((e) => console.log('  all        -> rejects fast with:', e.message));

  const settled = await Promise.allSettled([ok('a'), bad('b failed'), ok('c')]);
  console.log('  allSettled ->', settled.map((s) => (s.status === 'fulfilled' ? s.value : `x(${s.reason.message})`)));

  await Promise.any([bad('first'), bad('second')]).catch((e) => {
    console.log(`  any        -> ${e.name} with ${e.errors.length} errors:`, e.errors.map((x) => x.message));
  });
}

// ---------------------------------------------------------------------------
async function part7() {
  console.log('7. util.promisify turns an error-first callback into a promise (err becomes a rejection)');
  const readFile = util.promisify(fs.readFile);
  try {
    await readFile(missing);
  } catch (e) {
    console.log('  rejected with code', e.code);
  }
}

// ---------------------------------------------------------------------------
async function part8() {
  console.log('8. A promise executor catches a throw while it runs, but not one from a later callback');
  await new Promise((resolve, reject) => {
    throw new Error('thrown while the executor runs'); // turned into a rejection for us
  }).catch((e) => console.log('  .catch received:', e.message));

  await new Promise((resolve) => {
    process.once('uncaughtException', (err, origin) => {
      console.log(`  uncaughtException received: "${err.message}" (origin: ${origin})`);
      resolve(); // the promise below never settles, so we move on from here
    });
    new Promise(() => {
      setTimeout(() => {
        throw new Error('thrown from a timer inside an executor');
      }, 1);
    }).catch((e) => console.log('  never printed:', e.message));
  });
}

async function main() {
  await part1();
  await part2();
  await part3();
  await part4();
  await part5();
  await part6();
  await part7();
  await part8();
}

main();
