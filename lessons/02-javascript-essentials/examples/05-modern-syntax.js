// Destructuring, spread/rest, default parameters, ?. and ??, template literals
// Run: node lessons/02-javascript-essentials/examples/05-modern-syntax.js

// 1. Object destructuring: pull properties into variables.
const user = { id: 7, name: 'Sara', address: { city: 'Lima' }, role: undefined };
const { name, address: { city }, role = 'guest', ...others } = user;
console.log('1a.', name, city, role);
console.log('1b.', others);

// Rename while destructuring: take "name", call the variable "userName".
const { name: userName } = user;
console.log('1c.', userName);

// 2. Array destructuring: by position. Handy for swaps.
const [first, , third = 'default', ...tail] = ['a', 'b', undefined, 'd', 'e'];
console.log('2a.', first, third, tail);
let x = 1;
let y = 2;
[x, y] = [y, x];
console.log('2b.', x, y);

// 3. Destructuring in function parameters (an "options object").
function connect({ host = 'localhost', port = 3000, secure = false } = {}) {
  return `${secure ? 'https' : 'http'}://${host}:${port}`;
}
console.log('3. ', connect(), connect({ port: 8080, secure: true }));

// 4. Spread: copy and combine. Rest: collect what is left.
const base = [1, 2];
const more = [...base, 3, 4];
const merged = { ...{ a: 1, b: 1 }, ...{ b: 2, c: 3 } }; // later keys win
console.log('4a.', more, merged);
function sum(...numbers) {
  return numbers.reduce((total, n) => total + n, 0);
}
console.log('4b.', sum(1, 2, 3), '| spread call:', Math.max(...more));

// 5. Default parameters run at call time and only for undefined.
function greet(name = 'friend', punctuation = '!') {
  return `hello ${name}${punctuation}`;
}
console.log('5a.', greet(), '|', greet(undefined, '?'), '|', greet(null));
let calls = 0;
function stamp(id = ++calls) {
  return id;
}
console.log('5b.', stamp(), stamp(), stamp(10), '| default ran', calls, 'times');

// 6. Optional chaining ?. stops at null or undefined instead of throwing.
const config = { server: { port: 0 }, list: [], run: null };
console.log('6a.', config.server?.port, config.cache?.ttl, config.list?.[0]);
console.log('6b.', config.run?.(), config.missing?.deep.deeper.deepest);
try {
  console.log(config.cache.ttl);
} catch (err) {
  console.log('6c.', err.name + ':', err.message);
}

// 7. Nullish coalescing ?? only replaces null and undefined. || replaces every falsy value.
const port = 0;
const text = '';
console.log('7a. ||:', port || 3000, JSON.stringify(text || 'empty'));
console.log('7b. ??:', port ?? 3000, JSON.stringify(text ?? 'empty'));
let retries = null;
retries ??= 3; // assign only if null/undefined
let flag = 1;
flag ||= 99; // assign only if falsy
let name2 = 'x';
name2 &&= name2.toUpperCase(); // assign only if truthy
console.log('7c.', retries, flag, name2);

// 8. Template literals: multi-line text and embedded expressions.
const item = 'tea';
const price = 2.5;
const receipt = `Item: ${item}
Total: ${(price * 3).toFixed(2)} for 3`;
console.log('8a.');
console.log(receipt);

// A tagged template is a function that receives the pieces and the values.
function upper(strings, ...values) {
  return strings.reduce((out, s, i) => out + s + (values[i] !== undefined ? String(values[i]).toUpperCase() : ''), '');
}
console.log('8b.', upper`hello ${'world'} and ${'node'}!`);

// 9. Object literal shortcuts: shorthand names, computed keys and method shorthand.
const key = 'role';
const person = { name, [key]: 'admin', [`${key}Level`]: 3, greet() { return 'hi ' + this.name; } };
console.log('9.  ', person, person.greet());

// 10. Rest parameters versus the old "arguments" object.
function oldStyle() {
  return [Array.isArray(arguments), typeof arguments.map, arguments.length]; // array-like, but not an array
}
function newStyle(...args) {
  return [Array.isArray(args), args.map((n) => n * 2)]; // a real array
}
console.log('10. ', oldStyle(1, 2, 3), newStyle(1, 2, 3));
