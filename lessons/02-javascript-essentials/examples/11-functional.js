// Higher-order functions, currying, composition, memoization, debounce
// Run: node lessons/02-javascript-essentials/examples/11-functional.js

// 1. Functions are values. A higher-order function takes a function or returns one.
function repeat(times, action) {
  for (let i = 0; i < times; i++) action(i);
}
const seen = [];
repeat(3, (i) => seen.push(i * 10));
console.log('1a.', seen);

function multiplyBy(factor) {
  return (n) => n * factor; // returns a new function that remembers factor
}
const double = multiplyBy(2);
const triple = multiplyBy(3);
console.log('1b.', double(5), triple(5), [1, 2, 3].map(double));

// 2. Partial application: fix some arguments now, supply the rest later.
function add(a, b, c) {
  return a + b + c;
}
const addTen = add.bind(null, 10);
console.log('2. ', addTen(1, 2));

// 3. Currying: turn f(a, b, c) into f(a)(b)(c). This version also accepts f(a, b)(c).
function curry(fn) {
  return function curried(...args) {
    if (args.length >= fn.length) return fn(...args);
    return (...more) => curried(...args, ...more);
  };
}
const curriedAdd = curry(add);
console.log('3. ', curriedAdd(1)(2)(3), curriedAdd(1, 2)(3), curriedAdd(1)(2, 3));

// 4. Composition: build a pipeline out of small functions.
const compose =
  (...fns) =>
  (input) =>
    fns.reduceRight((value, fn) => fn(value), input); // right to left, like f(g(h(x)))
const pipe =
  (...fns) =>
  (input) =>
    fns.reduce((value, fn) => fn(value), input); // left to right, easier to read

const trim = (s) => s.trim();
const lower = (s) => s.toLowerCase();
const slug = (s) => s.replace(/\s+/g, '-');
console.log('4a.', pipe(trim, lower, slug)('  Hello Node World  '));
console.log('4b.', compose(slug, lower, trim)('  Hello Node World  '));

// 5. Memoization: remember results so the same input is never computed twice.
function memoize(fn) {
  const cache = new Map();
  return function (arg) {
    if (cache.has(arg)) return cache.get(arg);
    const result = fn(arg);
    cache.set(arg, result);
    return result;
  };
}

let naiveCalls = 0;
function fibNaive(n) {
  naiveCalls += 1;
  return n < 2 ? n : fibNaive(n - 1) + fibNaive(n - 2);
}
console.log('5a.', fibNaive(20), 'in', naiveCalls, 'calls');

let memoCalls = 0;
const fibMemo = memoize((n) => {
  memoCalls += 1;
  return n < 2 ? n : fibMemo(n - 1) + fibMemo(n - 2);
});
console.log('5b.', fibMemo(20), 'in', memoCalls, 'calls');
console.log('5c.', fibMemo(20), 'again, still', memoCalls, 'calls');

// Traps: this version only looks at ONE argument, the cache never shrinks,
// and it is only safe for pure functions (same input always gives the same output).

// A version for several arguments: build the cache key from all of them.
// It works when the arguments can be written as JSON (numbers, strings, plain data).
function memoizeMany(fn) {
  const cache = new Map();
  return (...args) => {
    const key = JSON.stringify(args);
    if (!cache.has(key)) cache.set(key, fn(...args));
    return cache.get(key);
  };
}
let powerCalls = 0;
const power = memoizeMany((base, exp) => {
  powerCalls += 1;
  return base ** exp;
});
console.log('5d.', power(2, 10), power(2, 10), power(3, 2), '| real calls:', powerCalls);

// 6. Debounce: wait until calls stop for `wait` ms, then run once.
function debounce(fn, wait) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}
const log = debounce((text) => console.log('6.  debounced call ran once with:', text), 20);
log('first');
log('second');
log('third');
