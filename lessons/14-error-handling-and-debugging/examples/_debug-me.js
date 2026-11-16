// Practice file for the debuggers (starts with an underscore, so the automatic checker skips it).
// Run: node inspect lessons/14-error-handling-and-debugging/examples/_debug-me.js
// Or:  node --inspect-brk lessons/14-error-handling-and-debugging/examples/_debug-me.js

function total(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price * item.qty;
  }
  return sum;
}

const cart = [
  { price: 5, qty: 2 },
  { price: 3, qty: 1 },
];
const result = total(cart);
console.log('total is', result);
