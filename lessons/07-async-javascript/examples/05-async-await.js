// async/await: sugar over promises, try/catch/finally, return vs return await, error patterns
// Shows how an async function behaves and the common ways to handle errors in async code.
// Run: node lessons/07-async-javascript/examples/05-async-await.js

const delay = (ms, value) => new Promise((resolve) => setTimeout(resolve, ms, value));

class NotFoundError extends Error {
  name = 'NotFoundError';
}

async function fetchUser(id) {
  await delay(5);
  if (id <= 0) throw new NotFoundError('user not found: ' + id);
  return { id, name: 'user' + id };
}

// ---------------------------------------------------------------------------
// 1. An async function ALWAYS returns a promise.
async function part1() {
  console.log('--- 1: async always returns a promise');
  async function five() {
    return 5; // a plain value is wrapped: the caller gets a promise for 5
  }
  async function broken() {
    throw new Error('oops'); // a throw becomes a rejected promise, not a crash
  }
  const p = five();
  console.log('five() is a promise:', p instanceof Promise);
  console.log('await five():', await p);
  console.log('await broken() failed with:', await broken().catch((e) => e.message));
}

// 2. await pauses ONLY the async function. The caller keeps running.
async function part2() {
  console.log('--- 2: await pauses only this function');
  async function pausing() {
    console.log('B. inside: runs synchronously until the first await');
    await delay(10);
    console.log('D. inside: resumed after the await');
  }
  console.log('A. before the call');
  const p = pausing();
  console.log('C. after the call: the caller was NOT paused');
  await p;
}

// 3. The same logic with .then and with await.
function withThen(id) {
  return fetchUser(id)
    .then((user) => user.name.toUpperCase())
    .catch((err) => 'then-style fallback: ' + err.message);
}

async function withAwait(id) {
  try {
    const user = await fetchUser(id);
    return user.name.toUpperCase();
  } catch (err) {
    return 'await-style fallback: ' + err.message;
  }
}

async function part3() {
  console.log('--- 3: .then versus await');
  console.log(await withThen(1));
  console.log(await withAwait(1));
  console.log(await withThen(0));
  console.log(await withAwait(0));
}

// 4. try / catch / finally.
async function part4() {
  console.log('--- 4: try / catch / finally');
  for (const id of [1, 0]) {
    try {
      const user = await fetchUser(id);
      console.log('got', user.name);
    } catch (err) {
      console.log('catch:', err.name, '-', err.message);
    } finally {
      console.log('finally runs in both cases (id ' + id + ')');
    }
  }
}

// 5. return vs return await, inside try/catch/finally.
function makeConnection() {
  const conn = {
    closed: false,
    async query() {
      await delay(10); // the query needs a little time
      if (conn.closed) throw new Error('connection was closed before the query finished');
      return 'rows';
    },
    close() {
      conn.closed = true;
    },
  };
  return conn;
}

async function queryWithoutAwait(conn) {
  try {
    return conn.query(); // BUG: we leave the try block right away with a pending promise
  } finally {
    conn.close(); // runs NOW, before the query is done
  }
}

async function queryWithAwait(conn) {
  try {
    return await conn.query(); // we wait inside the try block
  } finally {
    conn.close(); // runs after the query is done
  }
}

async function part5() {
  console.log('--- 5: return vs return await');
  console.log('without await:', await queryWithoutAwait(makeConnection()).catch((e) => 'FAILED: ' + e.message));
  console.log('with await   :', await queryWithAwait(makeConnection()).catch((e) => 'FAILED: ' + e.message));
}

// 6. Error handling patterns.
async function loadProfile(id) {
  try {
    return await fetchUser(id);
  } catch (err) {
    // Add context and keep the original error as "cause".
    throw new Error('could not load profile ' + id, { cause: err });
  }
}

// Go-style helper: never throws, always returns [error, value].
async function to(promise) {
  try {
    return [null, await promise];
  } catch (err) {
    return [err, undefined];
  }
}

async function part6() {
  console.log('--- 6: error handling patterns');

  // a) Catch only what you can handle. Re-throw the rest.
  async function userOrNull(id) {
    try {
      return await fetchUser(id);
    } catch (err) {
      if (err instanceof NotFoundError) return null; // expected case
      throw err; // unknown problem: do not hide it
    }
  }
  console.log('a) missing user gives:', await userOrNull(0));

  // b) Wrap with context, keep the cause.
  try {
    await loadProfile(0);
  } catch (err) {
    console.log('b) message:', err.message);
    console.log('b) cause  :', err.cause.name, '-', err.cause.message);
  }

  // c) The [err, value] helper.
  const [err, user] = await to(fetchUser(0));
  console.log('c) err:', err && err.message, '| user:', user);
  const [err2, user2] = await to(fetchUser(2));
  console.log('c) err:', err2, '| user:', user2.name);
}

// 7. One boundary at the top: catch everything that escapes, report it, set the exit code.
async function main() {
  await part1();
  await part2();
  await part3();
  await part4();
  await part5();
  await part6();
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exitCode = 1;
});
