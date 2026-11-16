// The three flavours of the fs API (sync, callback, promises) and where async fs work runs
// Run: node lessons/06-file-system/examples/01-three-flavours.js
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  // Every example works in its own throw-away folder inside the OS temp folder.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-flavours-'));
  const file = path.join(dir, 'hello.txt');

  try {
    // 1. Synchronous: the program waits here until the disk is done.
    fs.writeFileSync(file, 'written by the sync API');
    console.log('sync     :', fs.readFileSync(file, 'utf8'));

    // 2. Callback: the call returns at once, the callback runs later.
    await new Promise((resolve, reject) => {
      console.log('callback : before the call');
      fs.readFile(file, 'utf8', (err, text) => {
        if (err) return reject(err);
        console.log('callback : inside the callback ->', text);
        resolve();
      });
      console.log('callback : after the call (the file is NOT read yet)');
    });

    // 3. Promises: same work, but you can use await.
    await fsp.writeFile(file, 'written by the promise API');
    console.log('promises :', await fsp.readFile(file, 'utf8'));

    // fs.promises and require('node:fs/promises') are the same object.
    console.log('same object:', fs.promises === fsp);

    // An old callback function can be turned into a promise function with util.promisify.
    const readFileAsync = promisify(fs.readFile);
    console.log('promisify  :', await readFileAsync(file, 'utf8'));

    // The promise API can be cancelled with an AbortSignal (here it is already cancelled).
    const ac = new AbortController();
    ac.abort();
    try {
      await fsp.readFile(file, { signal: ac.signal });
    } catch (err) {
      console.log('cancelled  :', err.name);
    }

    // Errors: each flavour reports a missing file in its own way.
    const missing = path.join(dir, 'missing.txt');

    try {
      fs.readFileSync(missing);
    } catch (err) {
      console.log('sync error     :', err.code); // thrown
    }

    // (the Promise wrapper only lets us wait for the callback here)
    const cbError = await new Promise((resolve) => {
      fs.readFile(missing, (err) => resolve(err)); // error is the first argument
    });
    console.log('callback error :', cbError.code);

    try {
      await fsp.readFile(missing);
    } catch (err) {
      console.log('promise error  :', err.code); // rejected promise
    }

    // 4. Where does the async work run? In the libuv thread pool: 4 threads by default.
    // crypto.pbkdf2 is also pool work, so we use it to keep the pool busy.
    // (This part assumes the default pool size. Setting UV_THREADPOOL_SIZE changes the result.
    // It is also timing based, so a very slow or 1-2 core machine could give a surprising answer.)
    const slowJob = () => promisify(crypto.pbkdf2)('password', 'salt', 300000, 64, 'sha512');
    const timedStat = async () => {
      const start = performance.now();
      await fsp.stat(file);
      return performance.now() - start;
    };

    const started = performance.now();
    await slowJob();
    const oneJob = performance.now() - started; // how long one slow job takes on this machine
    const idle = await timedStat();

    const four = Array.from({ length: 4 }, slowJob); // all 4 pool threads busy
    await sleep(20); // let the jobs start
    const allBusy = await timedStat();
    await Promise.all(four);

    const three = Array.from({ length: 3 }, slowJob); // one pool thread still free
    await sleep(20);
    const oneFree = await timedStat();
    await Promise.all(three);

    console.log('stat, idle pool           : fast ->', idle < oneJob / 4);
    console.log('stat, 4 of 4 threads busy : had to wait ->', allBusy > oneJob / 2);
    console.log('stat, 3 of 4 threads busy : fast ->', oneFree < oneJob / 4);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

main();
