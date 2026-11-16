// JSON gotchas, Date pitfalls, errors with try/catch, the call stack and stack overflow
// Run: node lessons/02-javascript-essentials/examples/12-json-date-errors.js

const { spawnSync } = require('node:child_process');

console.log('=== JSON');

// 1. JSON.stringify silently drops or changes what JSON cannot hold.
const data = {
  name: 'Sara',
  age: undefined, // dropped
  run() {}, // dropped
  id: Symbol('x'), // dropped
  score: NaN, // becomes null
  big: Infinity, // becomes null
  when: new Date(0), // becomes an ISO string (Date has a toJSON method)
  tags: new Set([1]), // becomes {}
  table: new Map([[1, 2]]), // becomes {}
  nothing: null, // kept
};
console.log('1a.', JSON.stringify(data));
console.log('1b.', JSON.stringify([undefined, function () {}, Symbol('x')])); // in arrays they become null
// A value JSON cannot hold at the top level gives undefined (not the text "undefined"). -0 loses its sign.
console.log('1c.', JSON.stringify(undefined), JSON.stringify(() => {}), JSON.stringify(-0), JSON.stringify(new Date(NaN)));

// 2. JSON.parse gives plain data only. A reviver can rebuild richer types.
const text = '{"when":"1970-01-01T00:00:00.000Z","n":1}';
const plain = JSON.parse(text);
const revived = JSON.parse(text, (key, value) => (key === 'when' ? new Date(value) : value));
console.log('2a.', typeof plain.when, '|', revived.when instanceof Date);
console.log('2b.', JSON.parse('12345678901234567890'), '<- numbers above 2^53 lose digits');
// The reviver gets a third argument with the original source text, so a big id can become a BigInt.
const bigId = JSON.parse('{"id":12345678901234567890}', (key, value, context) => (key === 'id' ? BigInt(context.source) : value));
console.log('2c.', bigId);

// 3. Bad input throws SyntaxError. JSON is stricter than JavaScript.
for (const bad of ["{'a': 1}", '[1, 2,]', '', undefined]) {
  try {
    JSON.parse(bad);
  } catch (err) {
    console.log('3.  ', err.name + ':', err.message);
  }
}

// 4. Things that make stringify throw.
const loop = {};
loop.self = loop;
try {
  JSON.stringify(loop);
} catch (err) {
  console.log('4a. ', err.name + ':', err.message.split('\n')[0]);
}
try {
  JSON.stringify({ n: 10n });
} catch (err) {
  console.log('4b. ', err.name + ':', err.message);
}

// 5. toJSON, a filter list, and indentation.
class Money {
  constructor(cents) {
    this.cents = cents;
  }
  toJSON() {
    return `$${(this.cents / 100).toFixed(2)}`;
  }
}
console.log('5a. ', JSON.stringify({ price: new Money(1999) }));
console.log('5b. ', JSON.stringify({ a: 1, secret: 'x', b: 2 }, ['a', 'b']));
console.log('5c. ');
console.log(JSON.stringify({ a: 1, list: [1, 2] }, null, 2));
// A replacer function can teach stringify about types it does not know, such as Map and Set.
const replacer = (key, value) => (value instanceof Map ? Object.fromEntries(value) : value instanceof Set ? [...value] : value);
console.log('5d. ', JSON.stringify({ table: new Map([['x', 1]]), tags: new Set(['a', 'b']) }, replacer));

console.log('=== Date');

// 6. Months count from 0. Days of the month count from 1. Weekdays: 0 is Sunday.
const jan15 = new Date(2024, 0, 15); // local time
console.log('6.  ', jan15.getFullYear(), jan15.getMonth(), jan15.getDate(), jan15.getDay());

// 7. A date-only string is read as UTC. A date-time string without Z is read as local time.
//    The same code gives different answers in different time zones. We run it in three.
const probe = `
  const d = new Date('2024-01-15');
  const local = new Date('2024-01-15T00:00:00');
  JSON.stringify({ dayOfMonth: d.getDate(), localMidnightInUtc: local.toISOString() })
`;
for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
  const run = spawnSync(process.execPath, ['-p', probe], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  });
  console.log('7.  ', tz.padEnd(17), run.stdout.trim());
}

// 8. Invalid dates do not throw when created. They turn into NaN.
const invalid = new Date('not a date');
console.log('8a. ', String(invalid), invalid.getTime(), Number.isNaN(invalid.getTime()));
console.log('8b. ', JSON.stringify({ when: invalid }));
try {
  invalid.toISOString();
} catch (err) {
  console.log('8c. ', err.name + ':', err.message);
}

// 9. Dates are objects: compare with numbers, remember they can be changed in place.
const dateA = new Date(Date.UTC(2024, 0, 31));
const dateB = new Date(Date.UTC(2024, 0, 31));
console.log('9a. ', dateA == dateB, dateA.getTime() === dateB.getTime(), dateA < new Date(Date.UTC(2024, 1, 1)));
console.log('9b. ', typeof (dateA + 1), typeof (dateA - 1)); // + uses the string form, - uses the number
const next = new Date(dateA);
next.setUTCMonth(1); // February has no 31st, so the date rolls over
console.log('9c. ', next.toISOString().slice(0, 10));
console.log('9d. ', (new Date(Date.UTC(2024, 0, 2)) - new Date(Date.UTC(2024, 0, 1))) / 3600000, 'hours between');

// Parsing traps in V8 (the engine inside Node). An impossible day such as February 30 is NOT an
// invalid date: it rolls over to the next month. A day such as 32 or a month such as 13 is rejected.
console.log('9e. ', new Date('2024-02-30').toISOString(), '|', String(new Date('2024-02-32')));
// Only the ISO format is guaranteed to parse the same everywhere. Other formats depend on the engine.
// V8 reads '01/02/2024' as January 2 (month first), local time.
console.log('9f. ', new Date('01/02/2024').getMonth(), '(0 means January)');

// Showing one moment in different time zones: use Intl.DateTimeFormat with a timeZone option.
const moment = new Date(Date.UTC(2024, 0, 15, 12, 0));
for (const timeZone of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
  const shown = new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(moment);
  console.log('9g. ', timeZone.padEnd(17), shown);
}

console.log('=== Errors');

// 10. try / catch / finally.
function parseAge(input) {
  const age = Number(input);
  if (Number.isNaN(age)) throw new TypeError(`age must be a number, got "${input}"`);
  if (age < 0) throw new RangeError('age cannot be negative');
  return age;
}
let attempts = 0;
for (const input of ['42', 'abc', '-1']) {
  try {
    console.log('10a.', 'ok', parseAge(input));
  } catch (err) {
    console.log('10a.', err instanceof RangeError ? 'range error:' : 'other error:', err.message);
  } finally {
    attempts += 1; // runs on success and on failure
  }
}
console.log('10b.', 'finally ran', attempts, 'times');

// 11. Throw Error objects, not strings: only an Error has a stack trace.
try {
  throw 'just a string';
} catch (err) {
  console.log('11a.', typeof err, err.stack);
}
try {
  parseAge('x');
} catch (err) {
  console.log('11b.', err.name, '|', err.message, '|', err.stack.split('\n')[0]);
}

// 12. Custom errors, and `cause` to keep the original problem.
class ConfigError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ConfigError';
  }
}
try {
  try {
    JSON.parse('{bad');
  } catch (cause) {
    throw new ConfigError('config file is invalid', { cause });
  }
} catch (err) {
  console.log('12. ', err.name, '|', err.message, '| cause:', err.cause.name, '|', err instanceof ConfigError, err instanceof Error);
}

// 13. finally runs even after return. A return inside finally wins.
function tryReturn() {
  try {
    return 'from try';
  } finally {
    console.log('13a. finally runs before the function returns');
  }
}
function finallyWins() {
  try {
    return 'from try';
  } finally {
    return 'from finally'; // a return here replaces the earlier one: avoid this in real code
  }
}
console.log('13b.', tryReturn(), '|', finallyWins());

console.log('=== Call stack');

// 14. The call stack is a list of the functions that are running right now.
//     A stack trace is a printout of it, newest call first.
function level3() {
  return new Error('trace').stack;
}
function level2() {
  return level3();
}
function level1() {
  return level2();
}
const frames = level1()
  .split('\n')
  .slice(1, 4)
  .map((line) => line.trim().split(' ')[1]);
console.log('14. ', frames);

// 15. Too many nested calls: the stack has a fixed size and overflows.
let depth = 0;
function dive() {
  depth += 1;
  dive();
}
try {
  dive();
} catch (err) {
  console.log('15a.', err.name + ':', err.message, '| went deeper than 1000 calls:', depth > 1000);
}

const sumRecursive = (n) => (n === 0 ? 0 : n + sumRecursive(n - 1));
function sumLoop(n) {
  let total = 0;
  for (let i = 1; i <= n; i++) total += i;
  return total;
}
try {
  sumRecursive(1_000_000);
} catch (err) {
  console.log('15b.', 'recursive sum of 1,000,000 numbers ->', err.name);
}
console.log('15c.', 'loop sum of 1,000,000 numbers ->', sumLoop(1_000_000));

// A trampoline keeps the recursive shape without growing the stack: the function returns
// the NEXT step as a function, and a loop runs the steps one at a time.
const trampoline = (fn) => (...args) => {
  let step = fn(...args);
  while (typeof step === 'function') step = step();
  return step;
};
const sumTrampoline = trampoline(function go(n, total = 0) {
  return n === 0 ? total : () => go(n - 1, total + n);
});
console.log('15d.', 'trampoline sum of 1,000,000 numbers ->', sumTrampoline(1_000_000));

console.log('=== More on try/catch');

// 16. Handle only the errors you expect, and rethrow the rest. If the catch block swallows
//     everything, real bugs (like a TypeError from a typo) vanish silently.
function mightFail(kind) {
  if (kind === 'range') throw new RangeError('out of range');
  if (kind === 'type') throw new TypeError('wrong type');
  return 'fine';
}
for (const kind of ['ok', 'range', 'type']) {
  try {
    try {
      console.log('16a. result:', mightFail(kind));
    } catch (err) {
      if (!(err instanceof RangeError)) throw err; // not ours: pass it on
      console.log('16a. handled:', err.message);
    }
  } catch (err) {
    console.log('16a. rethrown to the caller:', err.name);
  }
}
// If you do not need the error object, the binding can be left out: catch { ... }
try {
  JSON.parse('{');
} catch {
  console.log('16b. optional catch binding');
}

// 17. try/catch cannot catch an error thrown LATER by a callback, because by then
//     the try block has already finished. Await does work with try/catch.
async function awaitDemo() {
  try {
    await Promise.reject(new Error('rejected promise'));
  } catch (err) {
    console.log('17a. await + try/catch caught:', err.message);
  }
}
awaitDemo();

try {
  setTimeout(() => {
    throw new Error('thrown inside a timer');
  }, 0);
} catch (err) {
  console.log('this line never runs');
}
// Last resort hook, used here only so the demo can finish. Real programs use it for logging, then exit.
process.once('uncaughtException', (err) => {
  console.log('17b. try/catch missed it, Node reported:', err.message);
});
