// Common async mistakes, and what Node does with unhandled rejections
// Shows each mistake next to its fix. Crashing cases run in child processes so this file stays alive.
// Run: node lessons/07-async-javascript/examples/12-mistakes-and-unhandled.js

const { execFile } = require('node:child_process');

const delay = (ms, value) => new Promise((resolve) => setTimeout(resolve, ms, value));

// ---------------------------------------------------------------------------
// Mistake 1: forgetting await. You get a Promise, not the value.
async function getName() {
  await delay(5);
  return 'Alice';
}
async function isAdmin() {
  await delay(5);
  return false;
}

async function mistake1() {
  console.log('--- 1: forgetting await');
  const name = getName(); // BUG: no await
  console.log('wrong :', name, '| name.toUpperCase is', typeof name.toUpperCase);
  console.log('right :', (await getName()).toUpperCase());

  // The trap that hides best: a Promise object is always truthy.
  if (isAdmin()) console.log('wrong : "admin" branch ran, because a Promise is truthy');
  if (await isAdmin()) console.log('never printed');
  else console.log('right : not an admin');
}

// ---------------------------------------------------------------------------
// Mistake 2: an async callback inside forEach. forEach does not wait for the promises.
async function mistake2() {
  console.log('\n--- 2: async function inside forEach');
  const done = [];
  [1, 2, 3].forEach(async (n) => {
    await delay(5);
    done.push(n);
  });
  console.log('wrong : right after forEach, done =', done); // empty: the work has not finished
  await delay(20);
  console.log('        later,               done =', done);

  const done2 = [];
  for (const n of [1, 2, 3]) {
    await delay(5);
    done2.push(n);
  }
  console.log('right : for...of waits (one by one), done =', done2);

  const done3 = [];
  await Promise.all(
    [1, 2, 3].map(async (n) => {
      await delay(5);
      done3.push(n);
    }),
  );
  console.log('right : Promise.all + map waits (in parallel), done =', done3);
}

// ---------------------------------------------------------------------------
// Mistake 3: the "new Promise wrapper" anti-pattern around something that is already a promise.
async function mistake3() {
  console.log('\n--- 3: new Promise wrapper anti-pattern');
  // WRONG: getName() already returns a promise. The wrapper adds noise and hides mistakes.
  const wrapped = new Promise((resolve, reject) => {
    getName().then(resolve).catch(reject);
  });
  // RIGHT: just return the promise (or use async/await).
  const direct = getName();
  console.log('wrapper :', await wrapped);
  console.log('direct  :', await direct);
}

// ---------------------------------------------------------------------------
// Mistake 4: swallowing errors. The error vanishes and a worse one shows up later, far away.
async function readConfig() {
  await delay(5);
  throw new Error('config file is missing');
}

async function loadConfigSwallowing() {
  try {
    return await readConfig();
  } catch (err) {
    console.log('  (logged and forgotten):', err.message);
    // no return, no throw: the caller gets undefined
  }
}

async function loadConfigHonest() {
  try {
    return await readConfig();
  } catch (err) {
    throw new Error('cannot start: ' + err.message, { cause: err }); // let the caller decide
  }
}

async function mistake4() {
  console.log('\n--- 4: swallowing errors');
  const config = await loadConfigSwallowing();
  try {
    console.log('port =', config.port);
  } catch (err) {
    console.log('wrong : the real problem is gone, we only see:', err.message);
  }
  await loadConfigHonest().catch((err) => console.log('right :', err.message));
}

// ---------------------------------------------------------------------------
// Mistakes 5 and 6, and the default behaviour of unhandled rejections, in child processes.
// run() starts a child Node process and resolves with its exit code and a short summary.
// The children are independent, so mistakes5and6() starts them all at once (and waits with Promise.all).
function run(code, flags = []) {
  return new Promise((resolve) => {
    execFile(process.execPath, [...flags, '-e', code], { encoding: 'utf8' }, (error, stdout, stderr) => {
      const line = stderr.split(/\r?\n/).find((l) => /(Error|Warning|Rejection): /.test(l));
      resolve({
        exit: error ? error.code : 0, // for a non-zero exit, error.code is the exit code
        printed: stdout.trim().replace(/\r?\n/g, ' / ') || '-',
        headline: line ? line.replace(/^\(node:\d+\) /, '').slice(0, 56) : '(nothing on stderr)',
      });
    });
  });
}

async function mistakes5and6() {
  console.log('\n--- 5, 6 and the default behaviour (each case runs in its own child process)');
  const cases = [
    ['5a floating async call', "async function save() { await null; throw new Error('boom'); } save(); setTimeout(() => console.log('timer ran'), 50);"],
    ['5b rejected with a string', "Promise.reject('just a string');"],
    ['5c handler attached too late', "const p = Promise.reject(new Error('boom')); setTimeout(() => p.catch(() => {}), 10);"],
    ['5d catch attached at once', "Promise.reject(new Error('boom')).catch((e) => console.log('caught', e.message));"],
    ['6a throw inside setTimeout', "new Promise(() => { setTimeout(() => { throw new Error('boom'); }, 5); }).catch(() => console.log('never'));"],
    ['6b fix: reject from the timer', "new Promise((_, reject) => { setTimeout(() => { try { throw new Error('boom'); } catch (e) { reject(e); } }, 5); }).catch((e) => console.log('caught', e.message));"],
    ['6c async executor', "new Promise(async () => { await null; throw new Error('boom'); }).catch(() => console.log('never'));"],
    [
      '6d async event listener',
      "const { EventEmitter } = require('node:events'); const e = new EventEmitter(); " +
        "e.on('job', async () => { await null; throw new Error('boom'); }); e.emit('job'); " +
        "setTimeout(() => console.log('timer ran'), 50);",
    ],
    [
      '6e fix: captureRejections',
      "const { EventEmitter } = require('node:events'); const e = new EventEmitter({ captureRejections: true }); " +
        "e.on('error', (err) => console.log('error event got:', err.message)); " +
        "e.on('job', async () => { await null; throw new Error('boom'); }); e.emit('job'); " +
        "setTimeout(() => console.log('timer ran'), 50);",
    ],
  ];
  const handlerCode =
    "process.on('unhandledRejection', (reason) => console.log('handler got:', reason.message)); " +
    "Promise.reject(new Error('boom')); setTimeout(() => console.log('timer ran'), 50);";
  const plain = "Promise.reject(new Error('boom')); setTimeout(() => console.log('timer ran'), 50);";

  // Start every child process now, then wait for all of them. Results come back in input order.
  const [caseResults, withHandler, warnMode, strictMode] = await Promise.all([
    Promise.all(cases.map(([, code]) => run(code))),
    run(handlerCode),
    run(plain, ['--unhandled-rejections=warn']),
    run(plain, ['--unhandled-rejections=strict']),
  ]);

  cases.forEach(([label], i) => {
    const r = caseResults[i];
    console.log(`${label.padEnd(32)} exit ${r.exit} | ${r.headline} | stdout: ${r.printed}`);
  });

  console.log('\nChanging the default behaviour:');
  console.log(`process.on('unhandledRejection')   exit ${withHandler.exit} | stdout: ${withHandler.printed}`);
  console.log(`--unhandled-rejections=warn        exit ${warnMode.exit} | ${warnMode.headline} | stdout: ${warnMode.printed}`);
  console.log(`--unhandled-rejections=strict      exit ${strictMode.exit} | ${strictMode.headline}`);
}

async function main() {
  await mistake1();
  await mistake2();
  await mistake3();
  await mistake4();
  await mistakes5and6();
}

main();
