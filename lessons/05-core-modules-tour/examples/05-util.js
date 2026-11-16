// util: promisify, callbackify, format, inspect, types, isDeepStrictEqual
// Run: node lessons/05-core-modules-tour/examples/05-util.js
const util = require('node:util');

// An old-style function: the LAST argument is a callback (error first).
function addLater(a, b, callback) {
  setTimeout(() => {
    if (typeof a !== 'number' || typeof b !== 'number') return callback(new TypeError('numbers only'));
    callback(null, a + b);
  }, 5);
}

async function main() {
  console.log('--- promisify: callback style -> promise style ---');
  const addAsync = util.promisify(addLater);
  console.log('2 + 3 =', await addAsync(2, 3));
  try {
    await addAsync(2, 'x');
  } catch (err) {
    console.log('rejected with:', err.message);
  }
  const sleep = util.promisify(setTimeout); // setTimeout has a built-in promisified form
  console.log('sleep resolved with:', await sleep(5, 'woke up'));

  console.log('--- callbackify: promise style -> callback style ---');
  const double = async (n) => n * 2;
  const doubleCb = util.callbackify(double);
  await new Promise((resolve) => {
    doubleCb(21, (err, result) => {
      console.log('callback got:', err, result);
      resolve();
    });
  });

  console.log('--- promisify: several results, and util.promisify.custom ---');
  function twoResults(callback) {
    setTimeout(() => callback(null, 'first', 'second'), 1);
  }
  console.log('keeps only the first result:', await util.promisify(twoResults)());
  // A function can tell promisify how to build its promise.
  twoResults[util.promisify.custom] = () =>
    new Promise((resolve) => twoResults((err, a, b) => resolve({ a, b })));
  console.log('with util.promisify.custom:', await util.promisify(twoResults)());

  console.log('--- promisify written by hand (a classic interview question) ---');
  function myPromisify(fn) {
    return function (...args) {
      return new Promise((resolve, reject) => {
        fn.call(this, ...args, (err, value) => (err ? reject(err) : resolve(value)));
      });
    };
  }
  const myAdd = myPromisify(addLater);
  console.log('myPromisify: 4 + 5 =', await myAdd(4, 5));
  await myAdd(1, 'x').catch((err) => console.log('myPromisify rejected with:', err.message));

  console.log('--- format: printf-style strings ---');
  console.log(util.format('%s is %d years old', 'Ada', 36));
  console.log(util.format('%i and %f', '42.9abc', '3.5x'));
  console.log(util.format('%j', { id: 1, tags: ['a', 'b'] }));
  console.log(util.format('%s', 'extra values', 'are', 'appended', 7));
  console.log(util.format('%d', '42abc'));

  console.log('--- inspect: turn any value into a readable string ---');
  const deep = { level1: { level2: { level3: { level4: 'deep' } } }, list: [1, 2, 3] };
  console.log(deep); // console.log uses depth 2
  console.log(util.inspect(deep, { depth: null }));
  console.log(util.inspect(deep, { depth: 0 }));
  console.log(JSON.stringify(util.inspect({ n: 1 }, { colors: true }))); // colors = escape codes
  console.log(util.inspect({ b: 2, a: 1 }, { sorted: true, compact: true }));

  class Money {
    constructor(cents) {
      this.cents = cents;
    }
    [util.inspect.custom]() {
      return `Money<$${(this.cents / 100).toFixed(2)}>`;
    }
  }
  console.log(new Money(1999));

  console.log('--- types: checks that typeof and instanceof cannot do ---');
  console.log('async function:', util.types.isAsyncFunction(async () => {}), '| typeof says', typeof (async () => {}));
  console.log('promise:', util.types.isPromise(Promise.resolve()));
  console.log('Map:', util.types.isMap(new Map()));
  console.log('typed array:', util.types.isTypedArray(new Uint8Array(2)));
  console.log('regexp:', util.types.isRegExp(/a/));
  console.log('proxy:', util.types.isProxy(new Proxy({}, {})));

  console.log('--- isDeepStrictEqual ---');
  console.log('same shape:', util.isDeepStrictEqual({ a: [1, 2] }, { a: [1, 2] }));
  console.log('1 vs "1":', util.isDeepStrictEqual({ a: 1 }, { a: '1' }));
  console.log('NaN vs NaN:', util.isDeepStrictEqual(NaN, NaN));
  console.log('0 vs -0:', util.isDeepStrictEqual(0, -0));
  class Point {
    constructor() {
      this.x = 1;
    }
  }
  console.log('Point vs plain object:', util.isDeepStrictEqual(new Point(), { x: 1 }));
  console.log('{a:1} === {a:1}:', { a: 1 } === { a: 1 });
}

main();
