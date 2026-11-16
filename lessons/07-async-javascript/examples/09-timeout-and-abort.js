// Timeouts (Promise.race and AbortSignal.timeout) and cancellation (AbortController)
// Shows how to stop WAITING for slow work, and how to really tell work to stop.
// Run: node lessons/07-async-javascript/examples/09-timeout-and-abort.js

const http = require('node:http');
const { setTimeout: sleep } = require('node:timers/promises');

const delay = (ms, value) => new Promise((resolve) => setTimeout(resolve, ms, value));

// ---------------------------------------------------------------------------
// Part 1: a timeout wrapper built with Promise.race.
// The first promise to settle wins. If the timer wins, we reject.
function withTimeout(promise, ms, label = 'operation') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
  });
  // clearTimeout in finally: otherwise the pending timer keeps the process alive until it fires.
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function part1() {
  console.log('--- 1: timeout wrapper with Promise.race');
  console.log('fast work :', await withTimeout(delay(10, 'result'), 100));

  let finished = false;
  const slowWork = delay(60).then(() => {
    finished = true;
    return 'late result';
  });
  await withTimeout(slowWork, 20, 'slow work').catch((err) => console.log('slow work :', err.message));
  console.log('slow work is still running? finished =', finished);
  await slowWork;
  console.log('...and it did finish later: finished =', finished, '(the timeout did not stop it)');
}

// ---------------------------------------------------------------------------
// Part 2: AbortSignal.timeout(ms) makes a signal that aborts by itself. APIs that accept
// a signal (fetch, timers/promises, fs, events.once ...) can stop for real.
async function part2() {
  console.log('\n--- 2: AbortSignal.timeout');
  try {
    await sleep(500, 'never', { signal: AbortSignal.timeout(20) });
  } catch (err) {
    console.log('timers/promises sleep:', err.name, '| cause:', err.cause.name);
  }

  // A tiny local server: /fast answers at once, /slow answers after 300 ms.
  const server = http.createServer((req, res) => {
    const wait = req.url === '/slow' ? 300 : 0;
    const timer = setTimeout(() => res.end('hello from ' + req.url), wait);
    res.on('close', () => clearTimeout(timer)); // the client may hang up early
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const fast = await fetch(base + '/fast', { signal: AbortSignal.timeout(500) });
    console.log('fetch /fast :', await fast.text());
    await fetch(base + '/slow', { signal: AbortSignal.timeout(50) });
  } catch (err) {
    console.log('fetch /slow :', err.name, '-', err.message);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

// ---------------------------------------------------------------------------
// Part 3: AbortController is the "stop" button. controller.abort() flips signal.aborted
// and fires an 'abort' event. Your own code must listen for it.
function cancellableSleep(ms, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason); // already cancelled before we started
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve('slept ' + ms + ' ms');
    }, ms);
    function onAbort() {
      clearTimeout(timer); // really stop the work
      reject(signal.reason);
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function processItems(items, { signal }) {
  const done = [];
  for (const item of items) {
    signal.throwIfAborted(); // a polite check between units of work
    await delay(10);
    done.push(item);
  }
  return done;
}

async function part3() {
  console.log('\n--- 3: AbortController');
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20);
  await cancellableSleep(500, { signal: controller.signal }).catch((err) =>
    console.log('cancelled sleep:', err.name, '-', err.message),
  );
  console.log('signal.aborted is now:', controller.signal.aborted);

  const c2 = new AbortController();
  c2.abort('user pressed cancel'); // any value can be the reason
  await cancellableSleep(500, { signal: c2.signal }).catch((reason) => console.log('custom reason:', reason));

  const c3 = new AbortController();
  setTimeout(() => c3.abort(), 35);
  await processItems(['a', 'b', 'c', 'd', 'e', 'f'], { signal: c3.signal }).catch((err) =>
    console.log('processItems stopped early with:', err.name),
  );
}

// ---------------------------------------------------------------------------
// Part 4: combine a user cancel button with a timeout using AbortSignal.any.
async function part4() {
  console.log('\n--- 4: AbortSignal.any (cancel button + timeout)');
  const userCancel = new AbortController();
  const signal = AbortSignal.any([userCancel.signal, AbortSignal.timeout(30)]);

  try {
    await cancellableSleep(500, { signal });
  } catch (err) {
    console.log('stopped because of:', err.name, '(a timeout, the user did not click)');
  }

  const userCancel2 = new AbortController();
  const signal2 = AbortSignal.any([userCancel2.signal, AbortSignal.timeout(500)]);
  setTimeout(() => userCancel2.abort(), 10);
  try {
    await cancellableSleep(200, { signal: signal2 });
  } catch (err) {
    console.log('stopped because of:', err.name, '(the user clicked cancel)');
  }
}

// ---------------------------------------------------------------------------
// Part 5: putting it together. Retry with exponential backoff, where every attempt has its own
// timeout and the whole job can be cancelled from outside.
async function retryWithSignal(task, { retries = 2, baseMs = 10, attemptMs = 30, signal } = {}) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted(); // cancelled before this attempt started?
    const timeout = AbortSignal.timeout(attemptMs);
    const attemptSignal = signal ? AbortSignal.any([signal, timeout]) : timeout; // whichever comes first
    try {
      return await task(attemptSignal, attempt);
    } catch (err) {
      if (signal?.aborted || attempt >= retries) throw err; // the caller cancelled, or no retries left
      const wait = baseMs * 2 ** attempt;
      console.log(`  attempt ${attempt + 1} failed (${err.cause?.name ?? err.name}), waiting ${wait} ms`);
      await sleep(wait, undefined, { signal }); // the backoff wait also stops when the caller cancels
    }
  }
}

// Fake tasks that obey the signal. flaky: attempt 1 hangs (200 ms), later attempts take 5 ms.
const flaky = (signal, attempt) => sleep(attempt === 0 ? 200 : 5, 'ok on attempt ' + (attempt + 1), { signal });
const alwaysHangs = (signal) => sleep(200, 'never', { signal });

async function part5() {
  console.log('\n--- 5: retry + timeout per attempt + cancel');
  console.log(await retryWithSignal(flaky));

  await retryWithSignal(alwaysHangs).catch((err) => console.log('gave up:', err.name, '| cause:', err.cause.name));

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 55); // the user gives up while attempt 2 is running
  await retryWithSignal(alwaysHangs, { signal: controller.signal }).catch((err) =>
    console.log('cancelled:', err.name, '| cause:', err.cause.name),
  );
}

async function main() {
  await part1();
  await part2();
  await part3();
  await part4();
  await part5();
}

main();
