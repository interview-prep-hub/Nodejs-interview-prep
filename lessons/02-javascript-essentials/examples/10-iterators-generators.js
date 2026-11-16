// Iterators, generators and Symbol
// Run: node lessons/02-javascript-essentials/examples/10-iterators-generators.js

const util = require('node:util');

// 1. The iterator protocol: an object with next() that returns { value, done }.
const manual = ['a', 'b'][Symbol.iterator]();
console.log('1. ', manual.next(), manual.next(), manual.next());

// 2. An iterable is an object with a [Symbol.iterator]() method that returns an iterator.
//    for...of, spread, destructuring, Array.from, new Set(...) and Promise.all all use it.
class Range {
  constructor(from, to) {
    this.from = from;
    this.to = to;
  }
  [Symbol.iterator]() {
    let current = this.from;
    const last = this.to;
    return {
      next() {
        return current <= last ? { value: current++, done: false } : { value: undefined, done: true };
      },
    };
  }
}
const range = new Range(1, 4);
const [one, two] = range;
console.log('2a. ', [...range], Array.from(range), Math.max(...range), one, two);
for (const n of range) {
  if (n > 2) break;
  console.log('2b.  for...of item', n);
}

// A plain object is not iterable, and strings are iterated by code point.
const plain = { a: 1 };
try {
  for (const x of plain) console.log(x);
} catch (err) {
  console.log('2c. ', err.name + ':', err.message);
}
const smiley = 'a\u{1F600}';
console.log('2d.  length:', smiley.length, '| code points:', [...smiley].length);

// 3. A generator function (function*) is a function you can pause with yield.
function* countTo(n) {
  for (let i = 1; i <= n; i++) yield i;
}
const gen = countTo(2);
console.log('3a. ', gen.next(), gen.next(), gen.next());

// Generators are lazy: nothing runs until you ask for the next value.
function* noisy() {
  console.log('    ...producing 1');
  yield 1;
  console.log('    ...producing 2');
  yield 2;
}
const lazy = noisy();
console.log('3b.  created, nothing has run yet');
console.log('3c. ', lazy.next());

// That makes infinite sequences possible.
function* naturals() {
  let n = 1;
  while (true) yield n++;
}
function* take(iterable, limit) {
  if (limit <= 0) return;
  let count = 0;
  for (const item of iterable) {
    yield item;
    if (++count >= limit) return;
  }
}
console.log('3d. ', [...take(naturals(), 5)]);

// 4. yield also receives values: whatever you pass to next(value).
function* chat() {
  const name = yield 'name?';
  const age = yield `hi ${name}, age?`;
  return `${name} is ${age}`;
}
const talk = chat();
console.log('4.  ', talk.next().value, '|', talk.next('Ann').value, '|', talk.next(30));

// 5. yield* hands over to another iterable.
function* inner() {
  yield 'b';
  yield 'c';
}
function* outer() {
  yield 'a';
  yield* inner();
  yield 'd';
}
console.log('5.  ', [...outer()]);

// 6. Iterator helpers (built in on Node 24): filter, map, take, toArray on any iterator.
const squares = naturals()
  .filter((n) => n % 2 === 0)
  .map((n) => n * n)
  .take(3)
  .toArray();
console.log('6.  ', squares);

// 7. Symbol: a value that is guaranteed unique. Often used as a hidden property key.
const id1 = Symbol('id');
const id2 = Symbol('id');
console.log('7a. ', id1 === id2, id1.toString(), id1.description);

const user = { name: 'Sara', [id1]: 123 };
console.log('7b. ', Object.keys(user), JSON.stringify(user), user[id1], Object.getOwnPropertySymbols(user));

// Symbol.for uses a global registry, so the same key gives the same symbol.
console.log('7c. ', Symbol.for('app.key') === Symbol.for('app.key'), Symbol.keyFor(Symbol.for('app.key')));
try {
  console.log('' + id1);
} catch (err) {
  console.log('7d. ', err.name + ':', err.message);
}

// 8. Well-known symbols let your objects plug into the language.
const temperature = {
  [Symbol.toPrimitive](hint) {
    return hint === 'string' ? '20 C' : 20;
  },
  get [Symbol.toStringTag]() {
    return 'Temperature';
  },
};
console.log('8a. ', `${temperature}`, +temperature, temperature + 1, Object.prototype.toString.call(temperature));

// Node has its own: util.inspect.custom controls how console.log prints an object.
class Secret {
  constructor(token) {
    this.token = token;
  }
  [util.inspect.custom]() {
    return 'Secret<hidden>';
  }
}
console.log('8b. ', new Secret('abc123'), util.inspect.custom === Symbol.for('nodejs.util.inspect.custom'));

// 9. Leaving a loop early. break (or an error) makes for...of call the iterator's return()
//    method, so a generator can run its finally block. This is how cleanup works for
//    things like open files.
function* readLines() {
  try {
    yield 'line 1';
    yield 'line 2';
    yield 'line 3';
  } finally {
    console.log('9b.  cleanup ran');
  }
}
for (const line of readLines()) {
  console.log('9a. ', line);
  break;
}

class Countdown {
  [Symbol.iterator]() {
    let n = 3;
    return {
      next: () => ({ value: n, done: n-- <= 0 }),
      return: () => {
        console.log('9c.  hand-made iterator: return() was called');
        return { done: true };
      },
    };
  }
}
for (const n of new Countdown()) {
  if (n === 2) break;
}

// 10. Async generators pair with for await (the async lesson covers this properly).
async function* ticker() {
  yield 'tick 1';
  yield 'tick 2';
}
(async () => {
  for await (const t of ticker()) console.log('10. ', t);
})();
