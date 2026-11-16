// try / catch / finally: order of events, return inside finally, rethrowing, and operational vs programmer errors
// Run: node lessons/14-error-handling-and-debugging/examples/02-try-catch-finally.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

console.log('1. Order of events');
function flow(fail) {
  const steps = [];
  try {
    steps.push('try');
    if (fail) throw new Error('boom');
    steps.push('try end');
  } catch (e) {
    steps.push(`catch(${e.message})`);
  } finally {
    steps.push('finally');
  }
  steps.push('after');
  return steps.join(' > ');
}
console.log('  no error:', flow(false));
console.log('  error   :', flow(true));

console.log('2. finally runs even when try returns');
function returnInTry() {
  try {
    return 'value from try';
  } finally {
    console.log('  (finally still ran before the function returned)');
  }
}
console.log('  result:', returnInTry());

console.log('3. A return inside finally wins, and it silently swallows the error');
function swallow() {
  try {
    throw new Error('this error is lost');
  } finally {
    // eslint-disable-next-line no-unsafe-finally
    return 'finally won';
  }
}
console.log('  result:', swallow());

console.log('4. An error thrown inside finally replaces the original error');
try {
  try {
    throw new Error('original');
  } finally {
    throw new Error('from finally'); // eslint-disable-line no-unsafe-finally
  }
} catch (e) {
  console.log('  caught:', e.message);
}

console.log('5. Optional catch binding, and rethrowing what you cannot handle');
function parseConfig(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    if (e instanceof SyntaxError) return {}; // expected problem: fall back to defaults
    throw e; // anything else is a surprise: do not hide it
  }
}
console.log('  bad json  ->', parseConfig('{oops'));
console.log('  good json ->', parseConfig('{"port":3000}'));
try {
  parseConfig(Symbol('not text')); // a TypeError: a bug in the caller, so parseConfig rethrows it
} catch {
  console.log('  catch without (e) works when you do not need the error object');
}

console.log('6. finally is the place to release things (files, locks, timers)');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'err14-'));
const file = path.join(folder, 'data.txt');
fs.writeFileSync(file, 'hello');
let fd;
try {
  fd = fs.openSync(file, 'r');
  console.log('  opened the file, reading...');
  throw new Error('read failed halfway');
} catch (e) {
  console.log('  caught:', e.message);
} finally {
  if (fd !== undefined) fs.closeSync(fd);
  console.log('  file closed in finally');
  fs.rmSync(folder, { recursive: true, force: true });
}

console.log('7. Operational errors vs programmer errors');
// Operational: the program is right, the world is not (file missing, network down, bad user input).
// Programmer: the program is wrong (typo, wrong type, undefined variable). Retrying cannot fix it.
// This is only a rule of thumb. The real question is always: where did the bad thing come from?
function classify(e) {
  if (e instanceof TypeError || e instanceof ReferenceError || e instanceof RangeError) {
    return 'programmer bug: log it, fix the code';
  }
  if (e instanceof SyntaxError) return 'depends: bad input is operational, a typo in your code is a bug';
  if (typeof e.code === 'string' && /^E[A-Z]+$/.test(e.code)) return 'operational: handle it';
  return 'unknown: treat as a bug until proven otherwise';
}
const samples = [
  () => fs.readFileSync(path.join(os.tmpdir(), 'nope-14.txt')),
  () => undefined.foo,
  () => fs.readFileSync({ not: 'a path' }),
  () => JSON.parse('{'),
  () => {
    throw new Error('plain error');
  },
];
for (const run of samples) {
  try {
    run();
  } catch (e) {
    const label = e.code ? `${e.name} ${e.code}` : e.name;
    console.log(`  ${label.padEnd(30)} -> ${classify(e)}`);
  }
}

console.log('8. Node 24 also has "using": cleanup that runs by itself when the block ends');
class Connection {
  constructor(name) {
    this.name = name;
    console.log(`  open ${name}`);
  }
  [Symbol.dispose]() {
    console.log(`  close ${this.name}`);
  }
}
function runQuery() {
  using db = new Connection('db'); // closed automatically, even if an error is thrown
  using cache = new Connection('cache'); // closed first (reverse order)
  throw new Error('query failed');
}
try {
  runQuery();
} catch (e) {
  console.log('  caught:', e.message);
}
