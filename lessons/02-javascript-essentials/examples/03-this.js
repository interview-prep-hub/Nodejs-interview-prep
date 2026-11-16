// How `this` is decided: default, method, call/apply/bind, arrow functions, new
// Run: node lessons/02-javascript-essentials/examples/03-this.js

const { EventEmitter } = require('node:events');

// 1. Plain function call. Sloppy mode: this is globalThis. Strict mode: undefined.
function sloppyThis() {
  return this === globalThis;
}
function strictThis() {
  'use strict';
  return this;
}
console.log('1. sloppy:', sloppyThis(), '| strict:', strictThis());

// 2. Method call: this is whatever object is to the left of the dot.
const user = {
  name: 'Sara',
  hello() {
    return 'hi from ' + this.name;
  },
};
console.log('2. ', user.hello());

// 3. Losing this: take the method out of the object and call it on its own.
//    Class bodies are always strict, so this becomes undefined and the code throws.
class Counter {
  count = 0;
  inc() {
    this.count += 1;
    return this.count;
  }
}
const counter = new Counter();
const detached = counter.inc;
try {
  detached();
} catch (err) {
  console.log('3. ', err.name + ':', err.message);
}

// 4. Two fixes: bind, or call it through the object inside a wrapper.
const bound = counter.inc.bind(counter);
console.log('4. bind:', bound(), '| wrapper:', (() => counter.inc())());

// 5. call, apply and bind set this by hand.
function intro(greeting, punctuation) {
  return `${greeting}, I am ${this.name}${punctuation}`;
}
const omar = { name: 'Omar' };
console.log('5a. call :', intro.call(omar, 'Hello', '!'));
console.log('5b. apply:', intro.apply(omar, ['Hello', '?']));
const introOmar = intro.bind(omar, 'Hey'); // bind also presets the first argument
console.log('5c. bind :', introOmar('.'));
console.log('5d. rebind is ignored:', introOmar.bind({ name: 'Zed' })('...'));

// 6. Arrow functions have NO this of their own. They use the this of the place where they are written.
const team = {
  name: 'Core',
  members: ['Ann', 'Bo'],
  listRegular() {
    return this.members.map(function (m) {
      return m + ' in ' + this.name; // this is globalThis here (sloppy mode)
    });
  },
  listArrow() {
    return this.members.map((m) => m + ' in ' + this.name); // this is team
  },
};
console.log('6a. regular:', team.listRegular());
console.log('6b. arrow  :', team.listArrow());

// 7. Trap: an arrow function as an object method. Its this is the module's this.
//    In a CommonJS file the module level this is module.exports (an empty object).
const broken = {
  value: 1,
  get: () => this.value,
};
console.log('7. ', broken.get(), '| module this is module.exports:', this === module.exports);

// 8. new: creates an empty object, sets this to it, and returns it.
function Person(name) {
  this.name = name;
}
const lin = new Person('Lin');
console.log('8a. ', lin.name, lin instanceof Person);

// Forgetting new in sloppy mode writes onto globalThis.
Person('oops');
console.log('8b. ', globalThis.name);
delete globalThis.name;

// If a constructor returns an object, that object replaces the new one. A primitive is ignored.
function ReturnsObject() {
  this.a = 1;
  return { b: 2 };
}
function ReturnsNumber() {
  this.a = 1;
  return 99;
}
console.log('8c. ', new ReturnsObject(), new ReturnsNumber());

// 9. Node detail: event listeners written as regular functions get the emitter as this.
const emitter = new EventEmitter();
emitter.on('ping', function () {
  console.log('9a. regular listener, this is the emitter:', this === emitter);
});
emitter.on('ping', () => {
  console.log('9b. arrow listener,   this is the emitter:', this === emitter);
});
emitter.emit('ping');

// 10. Arrow function versus regular function: the differences interviewers ask about.
const arrow = () => 1;
function regular() {
  return arguments.length; // a regular function gets its own "arguments" object
}
function outerFn() {
  const inner = () => arguments.length; // an arrow has none, so this is outerFn's arguments
  return inner(10, 20);
}
console.log('10a. prototype property:', typeof regular.prototype, '|', typeof arrow.prototype);
console.log('10b. arguments:', regular(1, 2, 3), '| the arrow sees the outer one:', outerFn('only one'));
try {
  new arrow();
} catch (err) {
  console.log('10c.', err.name + ':', err.message);
}
// Node detail: Node wraps every CommonJS file in a function with 5 parameters
// (exports, require, module, __filename, __dirname), and the top level "arguments" is theirs.
console.log('10d. top level arguments.length:', arguments.length);

// 11. new beats bind: a bound function still works as a constructor, and the bound this is ignored.
function Thing(x) {
  this.x = x;
}
const BoundThing = Thing.bind({ ignored: true }, 1);
const thing = new BoundThing();
console.log('11. ', thing.x, thing instanceof Thing, thing.ignored);

// 12. bind written by hand, a classic interview task. This short version ignores the "new" case.
//     Never add methods to built-in prototypes in real code. This is only a demonstration.
Function.prototype.myBind = function (thisArg, ...preset) {
  const fn = this;
  return function (...later) {
    return fn.apply(thisArg, [...preset, ...later]);
  };
};
console.log('12. ', intro.myBind(omar, 'Hey')('!'));
delete Function.prototype.myBind;

// 13. Node detail: in a setTimeout callback written as a regular function,
//     this is the Timeout object (in browsers it is window).
setTimeout(function () {
  console.log('13. this in a timer callback:', this.constructor.name);
}, 0);
