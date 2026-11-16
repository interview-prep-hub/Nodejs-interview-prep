// emit() is synchronous: listeners run in registration order, before emit() returns
// Run: node lessons/09-events/examples/02-sync-order.js

const EventEmitter = require('node:events');

console.log('1. emit is synchronous');
const bell = new EventEmitter();
bell.on('ring', () => console.log('  listener ran'));
console.log('  before emit');
bell.emit('ring');
console.log('  after emit');

console.log('2. listeners run in the order they were added');
const order = new EventEmitter();
order.on('go', () => console.log('  first added'));
order.on('go', () => console.log('  second added'));
order.prependListener('go', () => console.log('  added last, but prepended'));
order.emit('go');

console.log('3. a nested emit runs its listeners immediately');
const nested = new EventEmitter();
nested.on('outer', () => {
  console.log('  outer: start');
  nested.emit('inner');
  console.log('  outer: end');
});
nested.on('inner', () => console.log('  inner ran in the middle of outer'));
nested.emit('outer');

console.log('4. changes made while emitting only affect the NEXT emit');
const live = new EventEmitter();
function second() {
  console.log('  second');
}
live.on('x', function first() {
  console.log('  first (removes second, adds late)');
  live.off('x', second);
  live.on('x', () => console.log('  late'));
});
live.on('x', second);
console.log('  -- emit #1');
live.emit('x');
console.log('  -- emit #2');
live.emit('x');

console.log('5. a once listener removes itself BEFORE it runs');
const once = new EventEmitter();
let runs = 0;
once.once('x', () => {
  runs++;
  once.emit('x'); // does not call this listener again
});
once.emit('x');
console.log('  runs:', runs);

console.log('6. emit returns true if there was at least one listener');
const e = new EventEmitter();
console.log('  with no listener:', e.emit('x'));
e.on('x', () => {});
console.log('  with a listener:', e.emit('x'));

console.log('7. to run listeners LATER, you must defer the emit yourself');
const later = new EventEmitter();
later.on('x', (how) => console.log('  listener ran via', how));
setImmediate(() => later.emit('x', 'setImmediate'));
queueMicrotask(() => later.emit('x', 'queueMicrotask'));
process.nextTick(() => later.emit('x', 'process.nextTick'));
console.log('  all three emits are scheduled, nothing ran yet');
