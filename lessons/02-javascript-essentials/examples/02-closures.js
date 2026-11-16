// Scope, closures and the classic loop question
// Run: node lessons/02-javascript-essentials/examples/02-closures.js

// 1. A closure: an inner function remembers the variables around it,
//    even after the outer function has finished.
function makeCounter() {
  let count = 0; // private: nothing outside can touch it directly
  return function next() {
    count += 1;
    return count;
  };
}
const a = makeCounter();
const b = makeCounter();
console.log('1. a:', a(), a(), a(), '| b:', b());

// 2. A closure keeps the VARIABLE, not a copy of its value at that moment.
let message = 'first';
const show = () => message;
message = 'second';
console.log('2. ', show());

// 3. The classic interview question. All three timers share ONE var i.
const seenVar = [];
for (var i = 0; i < 3; i++) {
  setTimeout(() => seenVar.push(i), 0);
}

// 4. With let, every loop turn gets its own fresh i.
const seenLet = [];
for (let j = 0; j < 3; j++) {
  setTimeout(() => seenLet.push(j), 0);
}

// 5. The pre-ES6 fix: an IIFE (immediately invoked function expression)
//    copies i into a new function scope on each turn.
const seenIife = [];
for (var k = 0; k < 3; k++) {
  (function (copy) {
    setTimeout(() => seenIife.push(copy), 0);
  })(k);
}

// Print after all the zero-delay timers above have fired.
setTimeout(() => {
  console.log('3. var  :', seenVar);
  console.log('4. let  :', seenLet);
  console.log('5. iife :', seenIife);
}, 10);

// 6. Real use: private state with a small public API.
function createAccount(startBalance) {
  let balance = startBalance;
  return {
    deposit(amount) {
      balance += amount;
      return balance;
    },
    getBalance() {
      return balance;
    },
  };
}
const account = createAccount(100);
account.deposit(50);
console.log('6. ', account.getBalance(), '| direct access:', account.balance);

// 7. Same idea, "run only once".
function once(fn) {
  let called = false;
  let result;
  return function (...args) {
    if (!called) {
      called = true;
      result = fn(...args);
    }
    return result;
  };
}
const init = once(() => {
  console.log('7a. init runs');
  return 42;
});
console.log('7b. ', init(), init());

// 8. The scope chain: a name is looked up from the inside out. An inner name can
//    hide ("shadow") an outer one with the same name.
const level = 'module';
function outer() {
  const level = 'outer'; // shadows the module level name, but only inside outer
  function inner() {
    return level; // not found in inner, so look in outer; the module level is never reached
  }
  return inner();
}
console.log('8.  ', outer(), '|', level);
