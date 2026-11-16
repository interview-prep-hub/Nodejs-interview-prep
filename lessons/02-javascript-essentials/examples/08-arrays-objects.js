// Array methods and Object helpers that every interview uses
// Run: node lessons/02-javascript-essentials/examples/08-arrays-objects.js

const orders = [
  { id: 1, user: 'ann', total: 30, paid: true },
  { id: 2, user: 'bo', total: 80, paid: false },
  { id: 3, user: 'ann', total: 50, paid: true },
  { id: 4, user: 'cy', total: 20, paid: true },
];
const idsOf = (list) => list.map((o) => o.id);

// 1. map changes every item, filter keeps some, reduce folds the list into one value.
console.log('1a. map   :', orders.map((o) => o.total));
console.log('1b. filter:', idsOf(orders.filter((o) => o.paid)));
console.log('1c. reduce:', orders.reduce((sum, o) => sum + o.total, 0));
const perUser = orders.reduce((acc, o) => {
  acc[o.user] = (acc[o.user] ?? 0) + o.total;
  return acc;
}, {});
console.log('1d. reduce into an object:', perUser);

// Trap: reduce on an empty array with no starting value throws.
try {
  [].reduce((a, b) => a + b);
} catch (err) {
  console.log('1e.', err.name + ':', err.message);
}
// Trap: without a starting value the first ITEM is the first accumulator.
console.log('1f.', [{ v: 1 }, { v: 2 }].reduce((acc, o) => acc + o.v));

// 2. Searching and testing.
console.log('2a. find     :', orders.find((o) => o.total > 40)?.id, '| findLast:', orders.findLast((o) => o.total > 40)?.id);
console.log('2b. findIndex:', orders.findIndex((o) => o.user === 'zed'), '(-1 means not found)');
console.log('2c. some     :', orders.some((o) => !o.paid), '| every:', orders.every((o) => o.paid));
console.log('2d. empty    :', [].some(Boolean), [].every(Boolean)); // every on nothing is true
console.log('2e. includes :', [1, 2, 3].includes(2), '| at(-1):', [1, 2, 3].at(-1));

// 3. flat and flatMap.
console.log('3a.', [1, [2, [3, [4]]]].flat(), [1, [2, [3, [4]]]].flat(Infinity));
console.log('3b.', ['hi there', 'good day'].flatMap((s) => s.split(' ')));

// 4. Mutating methods change the array. The newer "copy" methods return a new one.
const nums = [3, 1, 2];
const sorted = nums.toSorted((a, b) => a - b);
console.log('4a. toSorted keeps the original:', nums, sorted);
nums.sort((a, b) => a - b);
console.log('4b. sort changed the original  :', nums);

const letters = ['a', 'b', 'c', 'd'];
console.log('4c. toSpliced:', letters.toSpliced(1, 2, 'X'), '| original:', letters);
console.log('4d. with     :', letters.with(0, 'Z'), '| toReversed:', letters.toReversed());
const removed = letters.splice(1, 2); // splice mutates and returns what it removed
console.log('4e. splice   :', removed, letters);

// Sorting text: the default sort is by UTF-16 code units, so capitals come first.
console.log('4f.', ['b', 'a', 'C'].sort(), ['b', 'a', 'C'].sort((x, y) => x.localeCompare(y)));
console.log('4g.', orders.toSorted((x, y) => y.total - x.total).map((o) => o.id));

// 5. Building arrays, and the "holes" trap.
console.log('5a.', Array.from({ length: 4 }, (_, i) => i * 2), Array(3).fill(0));
console.log('5b.', new Array(3).map(() => 1), '<- map skips empty slots');
const shared = Array(2).fill([]); // fill uses ONE array for both slots
shared[0].push('x');
console.log('5c.', shared);

// 6. Object.entries / fromEntries turn an object into pairs and back.
const prices = { apple: 1, pear: 2 };
console.log('6a.', Object.keys(prices), Object.values(prices), Object.entries(prices));
const doubled = Object.fromEntries(Object.entries(prices).map(([name, price]) => [name, price * 2]));
console.log('6b.', doubled);
console.log('6c.', Object.hasOwn(prices, 'apple'), Object.hasOwn(prices, 'toString'), 'toString' in prices);
console.log('6d. key order:', Object.keys({ b: 1, 2: 1, a: 1, 1: 1 })); // integer-like keys first

// 7. Grouping (available on Node 24, which this course uses).
const byUser = Object.groupBy(orders, (o) => o.user);
console.log('7a.', Object.keys(byUser), idsOf(byUser.ann), '| prototype:', Object.getPrototypeOf(byUser));
const bySize = Map.groupBy(orders, (o) => (o.total >= 50 ? 'big' : 'small'));
console.log('7b.', [...bySize.keys()], idsOf(bySize.get('big')));

// 8. for...of walks values. for...in walks keys (including inherited ones).
for (const [i, letter] of ['x', 'y'].entries()) console.log('8a.', i, letter);
for (const key in ['x', 'y']) console.log('8b. key is a string:', typeof key, key);

// 9. slice copies a part and leaves the original alone. splice cuts the original (see 4e).
const five = [1, 2, 3, 4, 5];
console.log('9a. slice :', five.slice(1, 3), '| original:', five);

// Sorting is stable (the language guarantees it since ES2019): items that compare equal keep their original order.
const records = Array.from({ length: 30 }, (_, i) => ({ i, group: i % 3 }));
const byGroup = records.toSorted((x, y) => x.group - y.group);
const stable = byGroup.every((r, idx) => idx === 0 || byGroup[idx - 1].group !== r.group || byGroup[idx - 1].i < r.i);
console.log('9b. sort is stable:', stable);

// 10. Which function lists which keys? Own or inherited, enumerable or not, string or symbol.
const parent = { inherited: 1 };
const child = Object.create(parent);
child.own = 1;
Object.defineProperty(child, 'hidden', { value: 2, enumerable: false });
child[Symbol('tag')] = 3;
const viaForIn = [];
for (const key in child) viaForIn.push(key);
console.log('10a. for...in              :', viaForIn);
console.log('10b. Object.keys           :', Object.keys(child));
console.log('10c. getOwnPropertyNames   :', Object.getOwnPropertyNames(child));
console.log('10d. Reflect.ownKeys       :', Reflect.ownKeys(child));
