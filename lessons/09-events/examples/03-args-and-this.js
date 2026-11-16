// Arguments passed to listeners, and what "this" is inside a listener (regular vs arrow function)
// Run: node lessons/09-events/examples/03-args-and-this.js

const EventEmitter = require('node:events');

console.log('1. every argument after the event name is passed to the listener');
const shop = new EventEmitter();
shop.on('sale', (item, price, qty) => {
  console.log('  sold', qty, 'x', item, 'at', price);
});
shop.emit('sale', 'pen', 2, 5);

console.log('2. one object argument is easier to grow than many positional ones');
shop.on('refund', ({ item, amount, reason }) => {
  console.log('  refund:', item, amount, reason);
});
shop.emit('refund', { item: 'pen', amount: 2, reason: 'broken' });

console.log('3. "this" inside a regular function is the emitter');
const ee = new EventEmitter();
ee.label = 'I am the emitter';
ee.on('hello', function () {
  console.log('  regular function, this.label =', this.label);
  console.log('  this === ee:', this === ee);
});
ee.emit('hello');

console.log('4. "this" inside an arrow function is whatever it was outside');
const owner = {
  label: 'I am the owner object',
  start() {
    ee.on('hi', () => {
      console.log('  arrow function, this.label =', this.label);
    });
  },
};
owner.start();
ee.emit('hi');

console.log('5. gotcha: passing a method loses its object');
class Counter {
  constructor() {
    this.count = 0;
  }
  increment() {
    this.count++;
  }
}
const counter = new Counter();
const hits = new EventEmitter();
hits.on('hit', counter.increment); // "this" will be the emitter, not counter
hits.emit('hit');
console.log('  counter.count:', counter.count, '(still 0)');
console.log('  hits.count:', hits.count, '(the emitter got the ++ by mistake)');

console.log('6. fixes: bind the method, or wrap it in an arrow function');
const fixed = new Counter();
const hits2 = new EventEmitter();
hits2.on('hit', fixed.increment.bind(fixed));
hits2.on('hit', () => fixed.increment());
hits2.emit('hit');
console.log('  fixed.count:', fixed.count);
