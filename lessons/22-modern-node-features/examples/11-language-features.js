// JavaScript features that arrived with the V8 engine inside Node 22 and 24.
// Shows: withResolvers, Promise.try, groupBy, Set methods, fromAsync, copy methods, iterator helpers, RegExp.escape, Error.isError, using.
// Run: node lessons/22-modern-node-features/examples/11-language-features.js

const vm = require('node:vm');

async function main() {
  console.log('1. Promise.withResolvers: a promise plus its resolve and reject, no wrapper needed');
  const { promise, resolve } = Promise.withResolvers();
  setTimeout(() => resolve('resolved from outside'), 5);
  console.log(' ', await promise);

  console.log('2. Promise.try: sync throws and async rejections both become a promise');
  const failed = await Promise.try(() => JSON.parse('{bad json')).catch((err) => err.name);
  console.log('  a sync throw is caught by .catch:', failed);
  console.log('  a normal return value is wrapped:', await Promise.try(() => 42));

  console.log('3. Object.groupBy and Map.groupBy (the lodash groupBy)');
  const numbers = [1, 2, 3, 4, 5];
  const byParity = Object.groupBy(numbers, (n) => (n % 2 ? 'odd' : 'even'));
  console.log('  Object.groupBy:', { ...byParity }, '| prototype is null:', Object.getPrototypeOf(byParity) === null);
  console.log('  Map.groupBy keys can be any value:', Map.groupBy(numbers, (n) => n > 2));

  console.log('4. Set methods');
  const a = new Set([1, 2, 3]);
  const b = new Set([3, 4]);
  console.log('  union:', a.union(b), '| intersection:', a.intersection(b));
  console.log('  difference:', a.difference(b), '| symmetricDifference:', a.symmetricDifference(b));
  console.log('  isSubsetOf:', new Set([3]).isSubsetOf(a), '| isSupersetOf:', a.isSupersetOf(new Set([1])), '| isDisjointFrom:', a.isDisjointFrom(new Set([9])));

  console.log('5. Array.fromAsync collects an async iterable (or promises) into an array');
  async function* countdown() {
    yield 3;
    yield 2;
    yield 1;
  }
  console.log('  from an async generator:', await Array.fromAsync(countdown()));
  console.log('  from an array of promises:', await Array.fromAsync([Promise.resolve('a'), 'b']));

  console.log('6. Change-by-copy array methods leave the original alone');
  const original = [3, 1, 2];
  console.log('  toSorted:', original.toSorted(), '| toReversed:', original.toReversed(), '| with(1, 99):', original.with(1, 99));
  console.log('  toSpliced(1, 1, "x", "y"):', original.toSpliced(1, 1, 'x', 'y'));
  console.log('  original is unchanged:', original);

  console.log('7. Iterator helpers are lazy, so they work on infinite generators');
  function* naturals() {
    let n = 1;
    while (true) yield n++;
  }
  console.log('  first 3 squares of even numbers:', naturals().filter((n) => n % 2 === 0).map((n) => n * n).take(3).toArray());
  console.log('  Iterator.from + drop:', Iterator.from([10, 20, 30]).drop(1).toArray());

  console.log('8. RegExp.escape (Node 24+) and Error.isError');
  const userInput = '1+1=2 (really?)';
  const pattern = new RegExp(RegExp.escape(userInput));
  console.log('  the escaped text matches itself literally:', pattern.test('is 1+1=2 (really?) true'));
  console.log('  the same text as raw regex source does not (+ and ? are operators):', new RegExp(userInput).test('is 1+1=2 (really?) true'));
  console.log('  RegExp.escape(".*") =', RegExp.escape('.*'), '| RegExp.escape("a.b") =', RegExp.escape('a.b'), '(a leading letter or digit is hex-escaped)');
  const foreignError = vm.runInNewContext('new Error("from another realm")');
  console.log('  instanceof Error:', foreignError instanceof Error, '| Error.isError:', Error.isError(foreignError), '| plain object:', Error.isError({ message: 'x' }));

  console.log('9. using: automatic cleanup when a block ends (Node 24+)');
  const resource = (name) => ({
    name,
    [Symbol.dispose]() {
      console.log(`  disposing ${name}`);
    },
  });
  {
    using first = resource('first');
    using second = resource('second');
    console.log(`  working with ${first.name} and ${second.name}`);
  } // leaving the block disposes in reverse order: second, then first
  {
    await using slow = {
      async [Symbol.asyncDispose]() {
        await new Promise((done) => setTimeout(done, 5));
        console.log('  async disposal finished');
      },
    };
    console.log('  await using waits for async cleanup');
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
