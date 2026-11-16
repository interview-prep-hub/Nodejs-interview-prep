# 02. JavaScript Essentials for Node Interviews

> Level: Beginner   Time: about 180 minutes   Node: 24 (notes where older versions differ)

[Previous: 01. Introduction: What Node.js Is and How to Start](../01-introduction/README.md) | [All lessons](../../README.md) | [Next: 03. Modules: CommonJS and ES Modules](../03-modules/README.md)

## What you will learn
- How `var`, `let` and `const` differ, what hoisting and the temporal dead zone are, and how scope and closures work (including the classic "loop with setTimeout" question)
- The five rules that decide `this`, how arrow functions differ from regular ones, and the Node-specific places where `this` surprises people
- How `new`, prototypes, the prototype chain and `class` fit together (a class is built on prototypes)
- Modern syntax you must read fluently: destructuring, spread, rest, `?.`, `??`, template literals
- The equality and type coercion traps (`==`, `NaN`, `typeof null`, `[] + {}`) and the eight falsy values
- Values vs references, shallow vs deep copy, `structuredClone`, `Object.freeze` and `Object.seal`
- The array and object helpers, `Map` (with an LRU cache), `Set`, the weak collections, iterators, generators and `Symbol`
- Functional tools (currying, composition, memoization), the `JSON` and `Date` gotchas, errors, and the call stack

This lesson covers only the JavaScript that Node interviews keep probing. Each section matches a small example file (sections 12 to 14 share one). Run them from the repo root, for example:

```bash
node lessons/02-javascript-essentials/examples/01-variables-hoisting.js
```

How to study: read a section, run its example file, change the code and run it again, then close the lesson and explain the idea out loud in two sentences. The quiz in section 15 and the exercises at the end are the real test.

> **Remember:** The outputs in this lesson were produced on Node 24.16 (V8 13.6) on Windows 11. The wording of built-in error messages (`Cannot read properties of undefined`, `Unexpected token` in JSON, `could not be cloned`, and so on) belongs to V8 and can differ slightly on other Node versions. In real code, check `err.name` or `err.code`, never the message text.

| Section | Topic | Example file |
|---|---|---|
| 1 | var, let, const, hoisting, TDZ | `examples/01-variables-hoisting.js` |
| 2 | Scope and closures | `examples/02-closures.js` |
| 3 | `this` | `examples/03-this.js` |
| 4 | Prototypes and classes | `examples/04-prototypes-classes.js` |
| 5 | Modern syntax | `examples/05-modern-syntax.js` |
| 6 | Equality, coercion, truthy and falsy | `examples/06-coercion.js` |
| 7 | Values, references, copying, freeze | `examples/07-copying-values.js` |
| 8 | Array and object helpers | `examples/08-arrays-objects.js` |
| 9 | Map, Set, WeakMap, WeakSet, WeakRef | `examples/09-collections-weak.js` |
| 10 | Iterators, generators, Symbol | `examples/10-iterators-generators.js` |
| 11 | Higher-order functions, currying, composition, memoization | `examples/11-functional.js` |
| 12 | JSON gotchas | `examples/12-json-date-errors.js` |
| 13 | Date pitfalls | `examples/12-json-date-errors.js` |
| 14 | Errors, try/catch, the call stack | `examples/12-json-date-errors.js` |
| 15 | Tricky output quiz | (in this file) |

## 1. Variables: var, let, const, hoisting and the temporal dead zone

A **variable** is a name that points to a value. A **scope** is the part of the program where that name can be seen. JavaScript has three keywords to declare a variable, and they differ in scope and in what you may do afterwards:

| | `var` | `let` | `const` |
|---|---|---|---|
| Scope | function | block (anything inside `{ }`) | block |
| Declare the same name twice | allowed | SyntaxError | SyntaxError |
| Assign a new value | yes | yes | no (TypeError) |
| Use before the declaration line | `undefined` | ReferenceError | ReferenceError |

**Hoisting** is what happens before a scope starts running: the **engine** (the program that runs your JavaScript; V8 in Node) reads every declaration in that scope and registers the names. The code does not literally move up. A `var` is registered with the value `undefined`. A function declaration is registered with its whole body. A `let` or `const` is registered but locked until its declaration line runs. The time between the start of the block and that line is the **temporal dead zone** (TDZ). Touching the name there throws a `ReferenceError`.

In a Node file you will meet four kinds of scope:

- **Global scope**: names that exist everywhere, such as `console`, `process` and `setTimeout`. They are properties of `globalThis`.
- **Module scope**: the file itself. Top-level names in a file are private to that file.
- **Function scope**: parameters and `var` names inside a function.
- **Block scope**: `let`, `const` and `class` names inside `{ }` (an `if`, a loop, or a bare block).

Example file: `examples/01-variables-hoisting.js`.

```js
console.log(hoistedVar); // undefined, not an error
var hoistedVar = 'now set';

try {
  console.log(tdz);
  let tdz = 'too late';
} catch (err) {
  console.log(err.name + ':', err.message);
}
```

```text
undefined
ReferenceError: Cannot access 'tdz' before initialization
```

The first line prints `undefined` because the declaration was hoisted but the assignment stays where you wrote it. The second throws because `let tdz` exists, but is locked until its line runs.

The whole example prints this:

```text
1a. undefined
1b. now set
2.  I escaped the if block
3a. 1 2
3b. undefined undefined
4a. ReferenceError: Cannot access 'tdz' before initialization
4b. typeof a name that never exists: undefined
4c. ReferenceError: Cannot access 'alsoTdz' before initialization
5a. [ 1, 2, 3 ]
5b. TypeError: Assignment to constant variable.
6a. a declaration works before its line
6b. TypeError: expressed is not a function
7a. oops
7b. ReferenceError: strictGlobal is not defined
8.  undefined | module scope
```

What each numbered line teaches:

- **2**: `var` ignores `if` and `for` blocks. It only respects function boundaries, so `inner` escapes the `if`.
- **3b**: `let` and `const` stay inside their block. `typeof` of a name that does not exist is the string `'undefined'`.
- **4b and 4c**: `typeof` is safe for a name that was never declared, but it is NOT safe inside the TDZ.
- **5**: `const` stops you from pointing the name at something else. It does not stop you from changing the object it points to.
- **6**: a function declaration (`function declared() {}`) can be called above its line. A function expression stored in a `var` cannot: the variable is `undefined` at that moment, so you get a `TypeError`, not a `ReferenceError`.
- **7**: assigning to a name you never declared creates a global variable in **sloppy mode**, JavaScript's old forgiving default (CommonJS files run this way). In **strict mode** it throws. You switch strict mode on by writing `'use strict'` at the top of a file or function. Classes and ES modules are always strict.
- **8**: in a browser a top-level `var` becomes a property of `window`. In Node every file is a module with its own scope, so a top-level `var` stays local to the file.

> **Interview tip:** "What does `console.log(a); var a = 1;` print?" Answer: `undefined`, because the declaration is hoisted and the assignment is not. Then say the rule you follow: `const` by default, `let` when the value must change, and no `var`. Interviewers like it when you also explain the TDZ with `let`.

## 2. Scope and closures

JavaScript uses **lexical scope**: when a name is not found in the current scope, the engine looks in the surrounding scope, then the next one outward, up to the module level. "Lexical" means the surroundings are decided by where the code is written, not by where it is called from. This chain of scopes is the **scope chain**. An inner name can hide an outer name with the same spelling; this is called **shadowing**.

```js
const level = 'module';
function outer() {
  const level = 'outer'; // shadows the module level name, but only inside outer
  function inner() {
    return level; // not found in inner, so look in outer; the module level is never reached
  }
  return inner();
}
console.log(outer(), '|', level);
```

```text
outer | module
```

A **closure** is a function together with the variables from the place where it was created. Picture a backpack: the function carries the variables it needs, even after the outer function has finished.

Example file: `examples/02-closures.js`.

```js
function makeCounter() {
  let count = 0; // private: nothing outside can touch it directly
  return function next() {
    count += 1;
    return count;
  };
}
const a = makeCounter();
const b = makeCounter();
console.log(a(), a(), a(), b());
```

```text
1 2 3 1
```

Each call to `makeCounter` creates a new `count`, so `a` and `b` have separate backpacks. Nothing outside can reach `count`, which makes closures the standard way to hide state.

**A closure keeps the variable, not a copy of its value.** If the variable changes after the function was created, the function sees the new value:

```js
let message = 'first';
const show = () => message;
message = 'second';
console.log(show());
```

```text
second
```

That is why this classic question exists:

```js
const seenVar = [];
for (var i = 0; i < 3; i++) {
  setTimeout(() => seenVar.push(i), 0);
}

const seenLet = [];
for (let j = 0; j < 3; j++) {
  setTimeout(() => seenLet.push(j), 0);
}

const seenIife = [];
for (var k = 0; k < 3; k++) {
  (function (copy) {
    setTimeout(() => seenIife.push(copy), 0);
  })(k);
}

setTimeout(() => {
  console.log('var  :', seenVar);
  console.log('let  :', seenLet);
  console.log('iife :', seenIife);
}, 10);
```

```text
var  : [ 3, 3, 3 ]
let  : [ 0, 1, 2 ]
iife : [ 0, 1, 2 ]
```

Why:

1. `var i` is ONE variable shared by the whole loop. A **callback** is a function you hand to something else so it can call it later; here `setTimeout` calls each one after the loop has finished, and the loop only ends when `i` reaches `3`.
2. With `let` in the loop header, JavaScript creates a fresh `j` for every turn. Each callback closes over its own `j`.
3. The old fix (before `let` existed) is an **IIFE**, an "immediately invoked function expression". It runs at once and copies `k` into a new function scope as `copy`.

In the full example file the three loop results (the lines labelled 3, 4 and 5) print last. They print from a timer, so they come after all the synchronous lines.

Two everyday uses of closures: private state with a small public API (`createAccount`), and a "run only once" wrapper (`once`):

```js
function createAccount(startBalance) {
  let balance = startBalance; // only the two functions below can see this
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
console.log(account.getBalance(), account.balance);

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
  console.log('init runs');
  return 42;
});
console.log(init(), init());
```

```text
150 undefined
init runs
42 42
```

`account.balance` is `undefined` because the variable never became a property: it lives only in the closure. `init` ran its function one time; the second call returned the saved result.

> **Common mistake:** A closure keeps everything it captured alive in memory. If a long-lived callback (an event listener, a timer, a cache entry) captures a large object, that object cannot be garbage collected (freed automatically when nothing uses it any more) while the callback exists. This is a common cause of memory leaks in Node programs.

> **Interview tip:** "What is a closure and where do you use it?" Strong answer: a function plus the variables of the scope where it was created, kept alive as long as the function is. Uses: private state (`createAccount`), function factories (`multiplyBy` in section 11), callbacks that remember their context, and helpers such as `once`, `memoize` and `debounce`. Then volunteer the loop question and the memory-leak risk.

## 3. `this`

`this` is a hidden extra parameter of a function. Its value depends on HOW the function is called, not on where it is written. The one exception is the arrow function, which has no `this` of its own.

Rules, from strongest to weakest (the arrow function is a special case, in the last row):

| Rule | Call looks like | `this` is |
|---|---|---|
| 1. `new` | `new Person('Lin')` | the brand new object |
| 2. Explicit | `f.call(obj)`, `f.apply(obj)`, `f.bind(obj)()` | `obj` |
| 3. Method | `obj.f()` | `obj` (whatever is left of the dot) |
| 4. Default | `f()` | `globalThis` in sloppy mode, `undefined` in strict mode |
| Arrow function | any call | the `this` of the surrounding code, fixed forever |

Class bodies and ES modules are always strict. A CommonJS file is sloppy unless it starts with `'use strict'`.

Example file: `examples/03-this.js`.

The most common bug: losing `this` when a method is passed around.

```js
class Counter {
  count = 0;
  inc() {
    this.count += 1;
    return this.count;
  }
}
const counter = new Counter();
const detached = counter.inc; // the object is no longer to the left of the dot
try {
  detached();
} catch (err) {
  console.log(err.name + ':', err.message);
}
console.log(counter.inc.bind(counter)());
```

```text
TypeError: Cannot read properties of undefined (reading 'count')
1
```

`call`, `apply` and `bind` set `this` by hand:

```js
function intro(greeting, punctuation) {
  return `${greeting}, I am ${this.name}${punctuation}`;
}
const omar = { name: 'Omar' };
console.log(intro.call(omar, 'Hello', '!'));      // arguments one by one
console.log(intro.apply(omar, ['Hello', '?']));   // arguments as an array
const introOmar = intro.bind(omar, 'Hey');        // returns a NEW function, presets this and the first argument
console.log(introOmar('.'));
console.log(introOmar.bind({ name: 'Zed' })('...')); // a bound function cannot be re-bound
```

```text
Hello, I am Omar!
Hello, I am Omar?
Hey, I am Omar.
Hey, I am Omar...
```

An arrow function uses the `this` of the code around it. That is useful inside methods and a trap when used as the method itself:

```js
const team = {
  name: 'Core',
  members: ['Ann', 'Bo'],
  listRegular() {
    return this.members.map(function (m) {
      return m + ' in ' + this.name; // a plain callback: this is globalThis (sloppy mode)
    });
  },
  listArrow() {
    return this.members.map((m) => m + ' in ' + this.name); // arrow: this is team
  },
};
console.log(team.listRegular());
console.log(team.listArrow());

const broken = { value: 1, get: () => this.value }; // arrow as a method: wrong
console.log(broken.get(), this === module.exports);
```

```text
[ 'Ann in undefined', 'Bo in undefined' ]
[ 'Ann in Core', 'Bo in Core' ]
undefined true
```

The last line shows a Node detail: at the top level of a CommonJS file, `this` is `module.exports` (an empty object at that point), so `this.value` is `undefined`. In an ES module the top-level `this` is `undefined`.

Two more Node-specific facts. A regular function used as an `EventEmitter` listener gets the emitter as `this`; an arrow function does not. In a `setTimeout` callback written as a regular function, `this` is the `Timeout` object (in a browser it would be `window`):

```js
const { EventEmitter } = require('node:events');
const emitter = new EventEmitter();
emitter.on('ping', function () {
  console.log('regular listener, this is the emitter:', this === emitter);
});
emitter.on('ping', () => {
  console.log('arrow listener,   this is the emitter:', this === emitter);
});
emitter.emit('ping');

setTimeout(function () {
  console.log('this in a timer callback:', this.constructor.name);
}, 0);
```

```text
regular listener, this is the emitter: true
arrow listener,   this is the emitter: false
this in a timer callback: Timeout
```

Forgetting `new` is also a `this` bug. Called as a plain function, the constructor below writes `name` onto `globalThis` (in sloppy mode). Classes protect you from this: calling a class without `new` throws.

```js
function Person(name) {
  this.name = name;
}
Person('oops'); // forgot new: this is globalThis
console.log(globalThis.name, new Person('Lin').name);
```

```text
oops Lin
```

### Arrow function versus regular function

This is one of the most common interview questions. Besides `this`, arrows differ in several more ways:

| | Regular function | Arrow function |
|---|---|---|
| Own `this` | yes, set by the call | no, uses the `this` around it |
| Own `arguments` object | yes | no (it sees the outer function's) |
| Works with `new` | yes | no |
| Has a `prototype` property | yes | no |
| Can be a generator (`function*`) | yes | no |
| Declaration is hoisted | yes, completely | no (it is a value stored in a variable) |

```js
const arrow = () => 1;
function regular() {
  return arguments.length; // a regular function gets its own "arguments" object
}
function outerFn() {
  const inner = () => arguments.length; // an arrow has none, so this is outerFn's arguments
  return inner(10, 20);
}
console.log(typeof regular.prototype, typeof arrow.prototype);
console.log(regular(1, 2, 3), outerFn('only one'));
try {
  new arrow();
} catch (err) {
  console.log(err.name + ':', err.message);
}
```

```text
object undefined
3 1
TypeError: arrow is not a constructor
```

A Node detail: at the top level of a CommonJS file, `arguments.length` is `5`. Node wraps every CommonJS file in a function with five parameters (`exports`, `require`, `module`, `__filename`, `__dirname`), and the top-level `arguments` belongs to that wrapper. [Lesson 03](../03-modules/README.md) explains the wrapper.

### `new` beats `bind`, and bind written by hand

A bound function can still be used as a constructor. In that case the bound `this` is ignored (the preset arguments are kept):

```js
function Thing(x) {
  this.x = x;
}
const BoundThing = Thing.bind({ ignored: true }, 1);
const thing = new BoundThing();
console.log(thing.x, thing instanceof Thing, thing.ignored);
```

```text
1 true undefined
```

"Write your own `bind`" is a classic coding question. A short version (it ignores the `new` case above):

```js
Function.prototype.myBind = function (thisArg, ...preset) {
  const fn = this; // the function that myBind was called on
  return function (...later) {
    return fn.apply(thisArg, [...preset, ...later]);
  };
};

function intro(greeting, punctuation) {
  return `${greeting}, I am ${this.name}${punctuation}`;
}
console.log(intro.myBind({ name: 'Omar' }, 'Hey')('!'));
```

```text
Hey, I am Omar!
```

Never add methods to built-in prototypes in real code; this is only a demonstration.

> **Interview tip:** Give the rules in order (`new`, explicit, method, default, arrow). Then say how you fix a lost `this`: `bind` it, wrap the call in an arrow function, or define the method as an arrow class field. A bound function cannot be changed by `call`, but `new` still wins over `bind`. For "arrow versus regular function", answer with the table: no own `this`, `arguments`, `prototype` or `new`; so use arrows for short callbacks and regular functions (or method shorthand) for object methods and constructors.

## 4. Prototypes, the prototype chain and classes

Every JavaScript object has a hidden link to another object called its **prototype**. When you read a property that the object does not have, JavaScript follows the link and looks there, then at that object's prototype, and so on. This list of links is the **prototype chain**. It ends at `Object.prototype` and then `null`.

Example file: `examples/04-prototypes-classes.js`.

```js
const animal = {
  eats: true,
  speak() {
    return 'some sound';
  },
};
const dog = Object.create(animal); // dog's prototype is animal
dog.barks = true;
console.log(dog.eats, dog.speak());
console.log(Object.keys(dog), 'eats' in dog, Object.hasOwn(dog, 'eats'));
dog.eats = false; // writing creates an OWN property that hides the inherited one
console.log(dog.eats, animal.eats);
```

```text
true some sound
[ 'barks' ] true false
false true
```

`dog` has only its own key `barks`. The lookup for `eats` and `speak` walked up to `animal`. `in` checks the whole chain, `Object.hasOwn` checks only the object itself. Writing `dog.eats = false` does not change `animal`; it adds a new own property that shadows the inherited one.

An object can even have no prototype. `Object.create(null)` makes a safe dictionary: it has no inherited keys such as `toString`, so keys that come from users cannot clash with them.

```js
const dict = Object.create(null);
dict.apple = 1;
console.log(dict.toString, 'toString' in {}, 'toString' in dict, dict);
```

```text
undefined true false [Object: null prototype] { apple: 1 }
```

Before `class` existed, you made "classes" with a **constructor function** (a normal function meant to be called with `new`) and its `.prototype` object:

```js
function Car(brand) {
  this.brand = brand;
}
Car.prototype.drive = function () {
  return this.brand + ' drives';
};
const fiat = new Car('Fiat');
const kia = new Car('Kia');
console.log(fiat.drive(), fiat.drive === kia.drive);

const keysIn = [];
for (const key in fiat) keysIn.push(key);
console.log(keysIn, Object.keys(fiat));
```

```text
Fiat drives true
[ 'brand', 'drive' ] [ 'brand' ]
```

`new Car(...)` creates an object whose prototype is `Car.prototype`. All cars share ONE `drive` function, which saves memory. The trap on the last line: `for...in` also lists inherited properties that are **enumerable** (that show up in loops and in `Object.keys`), but `Object.keys` lists only the object's own ones.

### What `new` does

`new Car('Fiat')` does four things: (1) it creates an empty object, (2) it links that object's prototype to `Car.prototype`, (3) it runs `Car` with `this` set to the new object, (4) it returns the new object. There is one exception: if the constructor itself returns an object, that object is returned instead. A returned primitive is ignored. Writing `new` by hand shows there is no magic:

```js
function Car(brand) {
  this.brand = brand;
}
Car.prototype.drive = function () {
  return this.brand + ' drives';
};

function myNew(Constructor, ...args) {
  const obj = Object.create(Constructor.prototype); // 1 and 2: new object, linked
  const result = Constructor.apply(obj, args); //      3: run the constructor with this = obj
  const isObject = (typeof result === 'object' && result !== null) || typeof result === 'function';
  return isObject ? result : obj; //                   4: an object returned by the constructor wins
}
const hand = myNew(Car, 'Fiat');
console.log(hand.drive(), hand instanceof Car, Object.keys(hand));

function ReturnsObject() {
  this.a = 1;
  return { b: 2 };
}
function ReturnsNumber() {
  this.a = 1;
  return 99;
}
console.log(new ReturnsObject(), new ReturnsNumber());
```

```text
Fiat drives true [ 'brand' ]
{ b: 2 } ReturnsNumber { a: 1 }
```

### Two things called "prototype"

Beginners mix these up, and interviewers know it:

| | What it is | How to reach it |
|---|---|---|
| `Car.prototype` | an ordinary object that lives on a FUNCTION. It is what objects made with `new Car()` get linked to. | `Car.prototype` |
| the prototype OF an object | the hidden link from one object to the next object in its chain (the spec writes it `[[Prototype]]`) | `Object.getPrototypeOf(obj)`, or the old accessor `obj.__proto__` |

The chain for `fiat` is `fiat` then `Car.prototype` then `Object.prototype` then `null`:

```js
function Car(brand) {
  this.brand = brand;
}
const fiat = new Car('Fiat');
console.log(Object.getPrototypeOf(fiat) === Car.prototype);
console.log(fiat.prototype);
console.log(Object.getPrototypeOf(Car.prototype) === Object.prototype);
```

```text
true
undefined
true
```

An instance has no property called `prototype` (the second line), because only functions have one.

### Classes

A `class` is the same machinery with cleaner syntax. It adds `extends`, `super`, `static`, private `#fields`, and getters and setters:

```js
class Animal {
  static count = 0; // belongs to the class itself, not to instances
  #energy = 10; // private field: only code inside this class body can read it

  constructor(name) {
    this.name = name;
    Animal.count += 1;
  }

  speak() {
    return `${this.name} makes a sound`;
  }

  get energy() {
    return this.#energy;
  }

  set energy(value) {
    if (value < 0) throw new RangeError('energy cannot be negative');
    this.#energy = value;
  }
}

class Dog extends Animal {
  constructor(name, breed) {
    super(name); // must run before "this" can be used
    this.breed = breed;
  }

  speak() {
    return super.speak() + ' (woof)'; // call the parent version
  }
}

const rex = new Dog('Rex', 'Collie');
console.log(rex.speak(), rex.energy);
rex.energy = 4;
console.log(rex.energy, Animal.count, rex.count);
try {
  rex.energy = -1;
} catch (err) {
  console.log(err.name + ':', err.message);
}
console.log(Object.keys(rex), JSON.stringify(rex));
```

```text
Rex makes a sound (woof) 10
4 1 undefined
RangeError: energy cannot be negative
[ 'name', 'breed' ] {"name":"Rex","breed":"Collie"}
```

Notes on that output:

- `static count` lives on the class (`Animal.count`), not on instances, so `rex.count` is `undefined`.
- The `get` and `set` methods (a **getter** and a **setter**) look like a plain property from outside (`rex.energy`) but run code when you read or assign it. This is how you validate on assignment.
- `#energy` is truly private. `Object.keys` and `JSON.stringify` cannot see it, and writing `rex.#energy` outside the class is a SyntaxError at parse time.
- A derived class constructor must call `super(...)` before it touches `this`.

### A class is sugar over prototypes

You can look at the machinery with a few lines:

```js
class Animal {
  speak() {
    return 'some sound';
  }
}
class Dog extends Animal {}
const rex = new Dog();

console.log(typeof Animal);
console.log(Object.getPrototypeOf(Dog.prototype) === Animal.prototype);
console.log(Object.getPrototypeOf(Dog) === Animal);
console.log(Object.getOwnPropertyNames(Animal.prototype));
console.log(rex instanceof Dog, rex instanceof Animal, rex instanceof Object);
```

```text
function
true
true
[ 'constructor', 'speak' ]
true true true
```

`typeof Animal` is `'function'`. The methods live on `Animal.prototype`, shared by all instances. `extends` sets up two links: `Dog.prototype` points to `Animal.prototype` (so instances inherit methods) and `Dog` itself points to `Animal` (so subclasses inherit statics). `instanceof` simply walks the prototype chain.

A class is sugar, but it is not exactly the same as a function. A class has extra rules that a constructor function does not have:

```js
class Animal {}
try {
  Animal();
} catch (err) {
  console.log(err.name + ':', err.message);
}

try {
  new Later();
} catch (err) {
  console.log(err.name + ':', err.message);
}
class Later {}

class BadChild extends Animal {
  constructor() {
    this.x = 1; // forgot to call super() first
  }
}
try {
  new BadChild();
} catch (err) {
  console.log(err.name + ':', err.message);
}
```

```text
TypeError: Class constructor Animal cannot be invoked without 'new'
ReferenceError: Cannot access 'Later' before initialization
ReferenceError: Must call super constructor in derived class before accessing 'this' or returning from derived constructor
```

In order: a class cannot be called without `new`; a class declaration is in the TDZ until its line runs (like `let`, unlike a hoisted function declaration); a derived class must call `super()` before it touches `this`. Also: class bodies are always strict, class methods are not enumerable (so `for...in` skips them), and private fields exist only in classes.

One more trap. An arrow function stored in a class field (`clickArrow = () => this.label`) keeps its `this` even when detached, but every instance then owns its own copy of the function. A normal method is shared on the prototype but can lose `this`:

```js
class Button {
  label = 'OK';
  clickMethod() {
    return this?.label; // when detached, this is undefined, so ?. avoids a crash
  }
  clickArrow = () => this.label;
}
const b1 = new Button();
const b2 = new Button();
const { clickMethod, clickArrow } = b1; // both are now detached from b1
console.log(clickMethod(), clickArrow());
console.log('method shared:', b1.clickMethod === b2.clickMethod, '| arrow shared:', b1.clickArrow === b2.clickArrow);
```

```text
undefined OK
method shared: true | arrow shared: false
```

### More class features: private methods, static private fields, static blocks

Private names (`#name`) also work for methods and for static members. A **static block** (`static { ... }`) runs once when the class is defined, which is useful when a static field needs more than one line to set up.

```js
class Ticket {
  static #issued = 0; // private AND static: one counter shared by the whole class
  static prefix;
  static {
    Ticket.prefix = 'T-'; // a static block: runs once, when the class is defined
  }

  #id = ++Ticket.#issued;

  #format() {
    return Ticket.prefix + String(this.#id).padStart(3, '0'); // a private method
  }

  label() {
    return this.#format();
  }
}
const t1 = new Ticket();
const t2 = new Ticket();
console.log(t1.label(), t2.label(), typeof t1.format, Object.keys(t1));
```

```text
T-001 T-002 undefined []
```

Private members are not properties at all, so `t1.format` is `undefined` and `Object.keys` shows nothing. The example file also has a `static create()` that uses `new this(...)` (so a subclass gets an instance of itself) and a **brand check**, `#energy in obj`, which tells you whether an object was built by this class.

> **Interview tip:** "Is JavaScript class-based?" Strong answer: no, it is prototype-based. `class` is syntax on top of prototypes: methods go on `Class.prototype`, `extends` links prototypes, and `instanceof` walks the chain. Mention `Object.create`, `Object.getPrototypeOf`, and that `__proto__` is an old accessor you should not use in new code. A likely follow-up is "inheritance or composition?": prefer composition (an object that HAS a helper, such as a logger or a client) and use `extends` only for a real "is a" relationship, because deep class trees are hard to change.

## 5. Modern syntax you must read fluently

Example file: `examples/05-modern-syntax.js`.

**Destructuring** pulls values out of objects and arrays into variables.

```js
const user = { id: 7, name: 'Sara', address: { city: 'Lima' }, role: undefined };
const { name, address: { city }, role = 'guest', ...others } = user;
console.log(name, city, role, others);

const [first, , third = 'default', ...tail] = ['a', 'b', undefined, 'd', 'e'];
console.log(first, third, tail);

let x = 1;
let y = 2;
[x, y] = [y, x]; // swap without a temporary variable
console.log(x, y);
```

```text
Sara Lima guest { id: 7 }
a default [ 'd', 'e' ]
2 1
```

`role = 'guest'` is a default, used only when the value is `undefined`. `...others` collects the properties that were not named. In `address: { city }`, `address` is only the path; the variable created is `city`. You can also rename: `const { name: userName } = user`.

Destructuring works in function parameters too, which is the usual way to write an "options object":

```js
function connect({ host = 'localhost', port = 3000, secure = false } = {}) {
  return `${secure ? 'https' : 'http'}://${host}:${port}`;
}
console.log(connect(), connect({ port: 8080, secure: true }));
```

```text
http://localhost:3000 https://localhost:8080
```

The `= {}` at the end lets you call `connect()` with no argument at all.

**Object literal shortcuts** save typing: `{ name }` means `{ name: name }`, `[expression]` as a key computes the key name, and `greet() {}` is a method written without `function`:

```js
const name = 'Sara';
const key = 'role';
const person = { name, [key]: 'admin', [`${key}Level`]: 3, greet() { return 'hi ' + this.name; } };
console.log(person, person.greet());
```

```text
{ name: 'Sara', role: 'admin', roleLevel: 3, greet: [Function: greet] } hi Sara
```

**Spread** (`...`) expands an array or object. **Rest** (`...`) collects the leftovers into an array. The same three dots; the position tells them apart.

```js
const more = [...[1, 2], 3, 4];
const merged = { ...{ a: 1, b: 1 }, ...{ b: 2, c: 3 } }; // later keys win
function sum(...numbers) {
  return numbers.reduce((total, n) => total + n, 0);
}
console.log(more, merged, sum(1, 2, 3), Math.max(...more));
```

```text
[ 1, 2, 3, 4 ] { a: 1, b: 2, c: 3 } 6 4
```

Spread makes a SHALLOW copy (section 7).

Rest parameters replace the old `arguments` object. `arguments` looks like an array but is not one (no `map`, `filter`, ...), and arrow functions do not have it. A rest parameter is a real array:

```js
function oldStyle() {
  return [Array.isArray(arguments), typeof arguments.map, arguments.length];
}
function newStyle(...args) {
  return [Array.isArray(args), args.map((n) => n * 2)];
}
console.log(oldStyle(1, 2, 3), newStyle(1, 2, 3));
```

```text
[ false, 'undefined', 3 ] [ true, [ 2, 4, 6 ] ]
```

**Default parameters** run at call time, and only when the argument is `undefined`:

```js
function greet(name = 'friend', punctuation = '!') {
  return `hello ${name}${punctuation}`;
}
console.log(greet(), '|', greet(undefined, '?'), '|', greet(null));
```

```text
hello friend! | hello friend? | hello null!
```

`null` is a real value, so it does not trigger the default. The default expression runs again on every call that needs it, so `function f(list = [])` gives each call its own fresh array:

```js
let calls = 0;
function stamp(id = ++calls) {
  return id;
}
console.log(stamp(), stamp(), stamp(10), '| default ran', calls, 'times');
```

```text
1 2 10 | default ran 2 times
```

**Optional chaining** `?.` stops and gives `undefined` when the value before it is `null` or `undefined`, instead of throwing. **Nullish coalescing** `??` supplies a fallback only for `null` and `undefined`, while `||` replaces every falsy value:

```js
const config = { server: { port: 0 }, list: [], run: null };
console.log(config.server?.port, config.cache?.ttl, config.list?.[0], config.run?.());

const port = 0;
const text = '';
console.log(port || 3000, JSON.stringify(text || 'empty'));
console.log(port ?? 3000, JSON.stringify(text ?? 'empty'));

let retries = null;
retries ??= 3; // assign only if null or undefined
console.log(retries);
```

```text
0 undefined undefined undefined
3000 "empty"
0 ""
3
```

This is the reason `??` exists: `0` and `''` are valid values, and `||` throws them away. Without `?.`, `config.cache.ttl` throws `TypeError: Cannot read properties of undefined (reading 'ttl')`. The matching assignment operators are `??=`, `||=` and `&&=`.

**Template literals** use backticks. They can span several lines and embed any expression in `${ }`. A **tagged template** puts a function name in front; the function receives the text pieces and the values:

```js
const item = 'tea';
const price = 2.5;
console.log(`Item: ${item}
Total: ${(price * 3).toFixed(2)} for 3`);

function upper(strings, ...values) {
  return strings.reduce((out, s, i) => out + s + (values[i] !== undefined ? String(values[i]).toUpperCase() : ''), '');
}
console.log(upper`hello ${'world'} and ${'node'}!`);
```

```text
Item: tea
Total: 7.50 for 3
hello WORLD and NODE!
```

> **Common mistake:** Mixing `??` with `||` or `&&` without parentheses is a SyntaxError (`a || b ?? c`). Write `(a || b) ?? c`.

> **Interview tip:** "What is the difference between `||` and `??`?" Strong answer: `||` falls back on any falsy value, so it wrongly replaces `0`, `''` and `false`; `??` falls back only on `null` and `undefined`. That is why you write `port ?? 3000` for a number that may legitimately be `0`. A follow-up is "spread versus rest": same `...`, spread expands a value into pieces, rest collects pieces into an array.

## 6. Equality, type coercion, truthy and falsy

**Type coercion** means JavaScript converts a value from one type to another automatically. It is the source of most "weird JavaScript" interview questions. Example file: `examples/06-coercion.js`.

**`==` versus `===`.** `===` never converts: different types are simply not equal. `==` converts first, using these rules in order:

1. Same type: compare like `===`.
2. `null` and `undefined` are equal to each other and to nothing else.
3. Number versus string: the string becomes a number.
4. A boolean becomes a number first (`true` is `1`, `false` is `0`).
5. An object versus a **primitive** (a plain value such as a number, string or boolean; section 7 lists them all): the object becomes a primitive (see "Objects become primitives" below), then compare again.

```text
0 == '0'                                       -> true
0 == ''                                        -> true
'0' == ''                                      -> false
null == undefined                              -> true
null == 0                                      -> false
null === undefined                             -> false
[] == false                                    -> true
[] == ![]                                      -> true
({}) === {}                                    -> false
```

Line 3 shows `==` breaks the usual rule "if A equals B and B equals C, then A equals C": `0 == '0'` and `0 == ''` are both true, yet `'0' == ''` is false. `[] == false`: `false` becomes `0`, `[]` becomes `''` and then `0`, so it is `0 == 0`. Objects are compared by reference, so two separate `{}` are never equal.

Use `===` always. The one accepted use of `==` is `x == null`, a short way to write "x is null or undefined".

**`typeof` and `NaN`:**

```text
typeof null                                    -> object
typeof NaN                                     -> number
typeof []                                      -> object
Array.isArray([])                              -> true
typeof (() => {})                              -> function
typeof 10n                                     -> bigint
typeof notDeclaredAnywhere                     -> undefined
NaN === NaN                                    -> false
Number.isNaN(NaN)                              -> true
isNaN('abc')                                   -> true
Number.isNaN('abc')                            -> false
Object.is(NaN, NaN)                            -> true
[NaN].includes(NaN)                            -> true
[NaN].indexOf(NaN)                             -> -1
0 === -0                                       -> true
Object.is(0, -0)                               -> false
```

- `typeof null` is `'object'`. It is a bug from the first version of the language that can never be fixed because old code depends on it. Test for null with `value === null`.
- `NaN` ("not a number") is the only value not equal to itself. The old global `isNaN` converts its argument first, so `isNaN('abc')` is `true`. Use `Number.isNaN` or `Object.is`.
- `includes` finds `NaN`, `indexOf` does not (it uses `===`).

**The `+` operator** has one rule. If either side is a string (after objects are turned into primitives), `+` joins text. Otherwise it adds numbers. Every other math operator (`-`, `*`, `/`) always turns both sides into numbers.

```text
1 + '2'                                        -> 12
'5' - 2                                        -> 3
'5' * '2'                                      -> 10
true + true                                    -> 2
JSON.stringify([] + [])                        -> ""
[] + {}                                        -> [object Object]
vm.runInNewContext('{} + []')                  -> 0
'b' + 'a' + +'a' + 'a'                         -> baNaNa
'10' > '9'                                     -> false
10 > '9'                                       -> true
null >= 0                                      -> true
```

- `[] + []` is `''` because both arrays become the empty string `''`. `[] + {}` is `'' + '[object Object]'`.
- At the start of a statement, `{}` is parsed as an empty code block, not an object. So `{} + []` there means `+[]`, which is `0`. The example uses `node:vm` to run that as a statement.
- Two strings compare as text (`'10' > '9'` is false, because `'1'` comes before `'9'`). One number makes it a number comparison.
- `null >= 0` is `true`, yet `null == 0` (above) is `false`. The comparison operators (`<`, `>=`) turn `null` into `0`, but `==` has its own rule that `null` equals only `undefined`.

**Turning text into numbers:**

```text
+'42'                                          -> 42
+''                                            -> 0
+'abc'                                         -> NaN
+null                                          -> 0
+undefined                                     -> NaN
Number('12px')                                 -> NaN
parseInt('12px')                               -> 12
['1','2','3'].map(parseInt)                    -> [ 1, NaN, NaN ]
['1','2','3'].map(Number)                      -> [ 1, 2, 3 ]
```

`Number()` is strict; `parseInt` reads as much as it can. The famous `map(parseInt)` bug happens because `map` passes `(value, index)`, and `parseInt` uses the second argument as the number base: `parseInt('2', 1)` is `NaN`.

**Numbers are 64-bit floating point**, the same type for integers and decimals:

```text
0.1 + 0.2                                      -> 0.30000000000000004
0.1 + 0.2 === 0.3                              -> false
Math.abs(0.1 + 0.2 - 0.3) < Number.EPSILON     -> true
Number.MAX_SAFE_INTEGER                        -> 9007199254740991
2 ** 53 === 2 ** 53 + 1                        -> true
2n ** 64n                                      -> 18446744073709551616n
1n + 1                                         -> TypeError: Cannot mix BigInt and other types, use explicit conversions
[10, 9, 1].sort()                              -> [ 1, 10, 9 ]
[10, 9, 1].sort((a, b) => a - b)               -> [ 1, 9, 10 ]
```

Computers store `0.1` in binary and cannot do it exactly, so compare decimals with a tolerance. Above `2 ** 53 - 1` whole numbers lose precision; use `BigInt` (the `n` suffix) for IDs and counters that large, and never mix it with normal numbers. `sort()` with no function sorts by text, which is why `10` comes before `9`.

Two more number traps that appear in rounding questions:

```text
typeof (2.5).toFixed(1)                        -> string
(1.005).toFixed(2)                             -> 1.00
```

`toFixed` returns TEXT, not a number. And `1.005` is stored as `1.00499999999999989...`, so it rounds down. For money, store whole cents as integers (`1999` for `$19.99`) and format only when you print.

**Objects become primitives** using `valueOf()` for math and `toString()` for text (or `Symbol.toPrimitive`, section 10):

```js
const money = {
  amount: 5,
  valueOf() {
    return this.amount; // used for math and +
  },
  toString() {
    return `$${this.amount}`; // used for text
  },
};
console.log(money + 1, money * 2, `${money}`);
```

```text
6 10 $5
```

**Truthy and falsy.** In an `if`, `&&`, `||` or `!`, every value counts as true or false. There are exactly eight falsy values: `false`, `0`, `-0`, `0n`, `''`, `null`, `undefined` and `NaN`. Everything else is truthy, including these surprises:

```text
falsy.some(Boolean)                            -> false
surprising.every(Boolean)                      -> true
Boolean([]) and ([] == false)                  -> [ true, true ]
```

`surprising` holds `'0'`, `'false'`, `' '`, `[]`, `{}`, an empty function, `new Boolean(false)`, `-1` and `Infinity`. An empty array is truthy, yet `[] == false` is also true: truthiness and loose equality are two separate systems.

**`&&` and `||` return one of their operands**, not `true` or `false`. `||` gives the first truthy operand (or the last one), `&&` gives the first falsy operand (or the last one). That is what makes `a || 'default'` and the guard `user && user.name` work:

```text
'' || 'fallback'                               -> fallback
0 && 'never'                                   -> 0
'a' && 'b'                                     -> b
account.profile && account.profile.bio         -> null
account.owner && account.owner.toUpperCase()   -> SARA
```

Here `account` is `{ owner: 'Sara', profile: null }`. The guard stops at the first falsy value (`account.profile` is `null`) and returns it, so `.bio` is never read. Today `?.` is the cleaner way to write that guard (section 5), but you will meet `&&` guards in old code and in interview puzzles.

> **Interview tip:** When asked about a coercion puzzle, do not guess. Name the rule: "`+` joins when one side is a string, otherwise it adds", "`==` turns booleans into numbers first". Then finish with "that is why I use `===`".

## 7. Values, references, copying and freezing

JavaScript has two kinds of values. **Primitives** (`number`, `string`, `boolean`, `null`, `undefined`, `bigint`, `symbol`) are copied by value. **Objects** (including arrays and functions) live in memory, and a variable holds a **reference**, which is like an address. Copying the variable copies the address, not the object. Example file: `examples/07-copying-values.js`.

```js
let a = 5;
let b = a;
b = 6;
console.log(a, b);

const p = { n: 1 };
const q = p; // q points at the SAME object
q.n = 2;
console.log(p.n, p === q, { n: 1 } === { n: 1 });

function mutate(obj) {
  obj.changed = true;
}
function reassign(obj) {
  obj = { replaced: true };
  return obj;
}
const target = {};
mutate(target);
reassign(target);
console.log(target);
```

```text
5 6
2 true false
{ changed: true }
```

Function arguments behave the same way, sometimes called **pass by sharing**: the function receives a copy of the reference. Changing the object through it is visible outside. Re-pointing the parameter to a new object is not.

### Shallow copy versus deep copy

A **shallow copy** makes a new top-level object, but nested objects are still shared. Spread (`{ ...obj }`, `[...arr]`), `Object.assign({}, obj)` and `arr.slice()` are all shallow. A **deep copy** copies every level.

```js
const original = { name: 'x', tags: ['a'], meta: { v: 1 } };
const copy = { ...original };
copy.name = 'changed';
copy.tags.push('b');
console.log(original.name, original.tags, copy.tags === original.tags);

const deep = structuredClone(original); // built in, global on Node 24
deep.meta.v = 99;
console.log(original.meta.v, deep.meta.v);
```

```text
x [ 'a', 'b' ] true
1 99
```

`structuredClone` is the built-in deep copy. It also handles `Date`, `Map`, `Set` and circular references. Its limits are the interview question:

```js
try {
  structuredClone({ run() {} });
} catch (err) {
  console.log(err.name + ':', err.message);
}
class Point {
  constructor(x) {
    this.x = x;
  }
  double() {
    return this.x * 2;
  }
}
const pointCopy = structuredClone(new Point(2));
console.log(pointCopy instanceof Point, typeof pointCopy.double, pointCopy);

const viaJson = JSON.parse(JSON.stringify({ when: new Date(0), gone: undefined, run() {}, bad: NaN }));
console.log(viaJson);
```

```text
DataCloneError: run() {} could not be cloned.
false undefined { x: 2 }
{ when: '1970-01-01T00:00:00.000Z', bad: null }
```

Functions cannot be cloned (it throws), and class instances come back as plain objects without their methods. The older trick `JSON.parse(JSON.stringify(x))` is worse: it silently turns a `Date` into a string, drops `undefined` and functions, and turns `NaN` into `null`.

> **Interview tip:** "How do you deep copy an object?" Answer: `structuredClone` for plain data. Then name its limits (functions throw, class instances lose their prototype) and why the JSON trick is lossy. For anything special you write a recursive copy that tracks visited objects, as in Try it yourself task 2.

### Object.freeze

`Object.freeze(obj)` stops new properties, deletions and changes to existing properties. It is **shallow**: nested objects stay changeable.

```js
const frozen = Object.freeze({ a: 1, nested: { b: 2 } });
frozen.a = 99; // silently ignored in sloppy mode
frozen.nested.b = 3; // allowed: nested is not frozen
console.log(frozen, Object.isFrozen(frozen), Object.isFrozen(frozen.nested));

(function () {
  'use strict';
  try {
    frozen.a = 5;
  } catch (err) {
    console.log(err.name + ':', err.message);
  }
})();
```

```text
{ a: 1, nested: { b: 3 } } true false
TypeError: Cannot assign to read only property 'a' of object '#<Object>'
```

In sloppy mode a write to a frozen object does nothing and says nothing. In strict mode it throws. The example file also shows that `push` on a frozen array always throws (`Cannot add property 2, object is not extensible`), and a small `deepFreeze` helper that freezes every level.

`const` and `freeze` solve different problems. `const` stops the NAME from being re-pointed. `freeze` stops the OBJECT from being changed.

### Seal, preventExtensions and property switches

`freeze` is the strictest of three locks. All three are shallow:

| | Add a property | Delete a property | Change a value |
|---|---|---|---|
| `Object.preventExtensions(obj)` | no | yes | yes |
| `Object.seal(obj)` | no | no | yes |
| `Object.freeze(obj)` | no | no | no |

Underneath, every property has three hidden switches: `writable` (can the value change?), `enumerable` (does it show in loops, `Object.keys` and JSON?) and `configurable` (can it be deleted or redefined?). `Object.defineProperty` sets them one property at a time, and `seal` and `freeze` just flip them for every property:

```js
const sealed = Object.seal({ a: 1 });
sealed.a = 2; // allowed: sealing keeps values changeable
sealed.b = 3; // ignored: cannot add
delete sealed.a; // ignored: cannot delete
console.log(sealed, Object.isSealed(sealed), Object.isFrozen(sealed));

const profile = { owner: 'Sara' };
Object.defineProperty(profile, 'id', { value: 42, writable: false, enumerable: false });
profile.id = 99; // ignored in sloppy mode
console.log(profile.id, Object.keys(profile), JSON.stringify(profile));
console.log(Object.getOwnPropertyDescriptor(profile, 'id'));
```

```text
{ a: 2 } true false
42 [ 'owner' ] {"owner":"Sara"}
{ value: 42, writable: false, enumerable: false, configurable: false }
```

A NEW property made with `defineProperty` has all three switches off unless you turn them on (the output above shows `configurable: false`, which we never set). This is why a non-enumerable property is invisible to `Object.keys` and `JSON.stringify` even though it is really there.

> **Interview tip:** "What is the difference between `const` and `Object.freeze`?" Strong answer: `const` protects the variable (it cannot point at another value); `freeze` protects the object (its properties cannot change), but only one level deep. For "make it fully constant" write a recursive `deepFreeze`, and mention `seal` as the weaker lock that still allows value changes.

## 8. Array methods and Object helpers

Example file: `examples/08-arrays-objects.js`. First, which methods change the original array and which do not. This matters because many bugs are unwanted mutation.

| Method | Returns | Changes the original? |
|---|---|---|
| `map(fn)` | new array, same length | no |
| `filter(fn)` | new array with the items that passed | no |
| `reduce(fn, start)` | one value | no |
| `find(fn)`, `findLast(fn)` | first (last) matching item or `undefined` | no |
| `findIndex(fn)` | index or `-1` | no |
| `some(fn)`, `every(fn)`, `includes(x)` | `true` or `false` | no |
| `flat(depth)`, `flatMap(fn)` | new array | no |
| `at(-1)` | item counted from the end | no |
| `sort`, `reverse`, `splice`, `push`, `pop`, `shift`, `unshift`, `fill` | various | YES |
| `toSorted`, `toReversed`, `toSpliced`, `with` | new array | no (Node 20 and newer) |

```js
const orders = [
  { id: 1, user: 'ann', total: 30, paid: true },
  { id: 2, user: 'bo', total: 80, paid: false },
  { id: 3, user: 'ann', total: 50, paid: true },
  { id: 4, user: 'cy', total: 20, paid: true },
];

console.log(orders.map((o) => o.total));
console.log(orders.filter((o) => o.paid).map((o) => o.id));
console.log(orders.reduce((sum, o) => sum + o.total, 0));
console.log(orders.reduce((acc, o) => {
  acc[o.user] = (acc[o.user] ?? 0) + o.total;
  return acc;
}, {}));
```

```text
[ 30, 80, 50, 20 ]
[ 1, 3, 4 ]
180
{ ann: 80, bo: 80, cy: 20 }
```

`reduce` walks the array carrying an **accumulator** (the running result). The second argument is its starting value. Two traps:

```js
try {
  [].reduce((a, b) => a + b);
} catch (err) {
  console.log(err.name + ':', err.message);
}
console.log([{ v: 1 }, { v: 2 }].reduce((acc, o) => acc + o.v));
```

```text
TypeError: Reduce of empty array with no initial value
[object Object]2
```

Without a starting value, `reduce` on an empty array throws, and on a non-empty array the first ITEM becomes the first accumulator (here an object, which then turns into text). Always pass a starting value.

Searching, testing and flattening:

```js
const orders = [{ id: 1, total: 30 }, { id: 2, total: 80 }, { id: 3, total: 50 }];

console.log(orders.find((o) => o.total > 40).id, orders.findLast((o) => o.total > 40).id);
console.log(orders.findIndex((o) => o.id === 99)); // -1 means not found
console.log(orders.some((o) => o.total > 70), orders.every((o) => o.total > 40));
console.log([].some(Boolean), [].every(Boolean)); // an empty array
console.log([1, 2, 3].includes(2), [1, 2, 3].at(-1)); // at(-1) is the last item
console.log([1, [2, [3, [4]]]].flat(), [1, [2, [3, [4]]]].flat(Infinity));
console.log(['hi there', 'good day'].flatMap((s) => s.split(' ')));
```

```text
2 3
-1
true false
false true
true 3
[ 1, 2, [ 3, [ 4 ] ] ] [ 1, 2, 3, 4 ]
[ 'hi', 'there', 'good', 'day' ]
```

- `every` on an empty array is `true` (nothing breaks the rule). `some` on an empty array is `false`.
- `flat()` flattens one level by default; `flat(Infinity)` flattens all. `flatMap` is `map` followed by a one-level `flat`.

Copying and changing arrays. The "copy" methods (`toSorted`, `toSpliced`, `with`, `toReversed`) leave the original alone, `slice` copies a part, and `sort` and `splice` change the array in place:

```js
const numbers = [3, 1, 2];
console.log(numbers.toSorted((a, b) => a - b), numbers); // a sorted copy; numbers is untouched
numbers.sort((a, b) => a - b);
console.log(numbers); // sort changed it in place

const letters = ['a', 'b', 'c', 'd'];
console.log(letters.toSpliced(1, 2, 'X'), letters.with(0, 'Z'), letters.toReversed());
console.log(letters.slice(1, 3), letters); // slice copies a part
console.log(letters.splice(1, 2), letters); // splice cuts the original
```

```text
[ 1, 2, 3 ] [ 3, 1, 2 ]
[ 1, 2, 3 ]
[ 'a', 'X', 'd' ] [ 'Z', 'b', 'c', 'd' ] [ 'd', 'c', 'b', 'a' ]
[ 'b', 'c' ] [ 'a', 'b', 'c', 'd' ]
[ 'b', 'c' ] [ 'a', 'd' ]
```

Sorting and building arrays, with the traps:

```js
console.log(['b', 'a', 'C'].sort(), ['b', 'a', 'C'].sort((x, y) => x.localeCompare(y)));
console.log(new Array(3).map(() => 1)); // map skips empty slots
console.log(Array.from({ length: 3 }, (_, i) => i * 2), Array(2).fill(0));
const shared = Array(2).fill([]); // fill uses ONE array for both slots
shared[0].push('x');
console.log(shared);
```

```text
[ 'C', 'a', 'b' ] [ 'a', 'b', 'C' ]
[ <3 empty items> ]
[ 0, 2, 4 ] [ 0, 0 ]
[ [ 'x' ], [ 'x' ] ]
```

- The default `sort` compares text by code unit, so capital letters come first. Pass a comparator, and use `localeCompare` for human text. Sorting is **stable** (the language guarantees it): items that compare equal keep their original order, so you can sort by one field and then by another.
- `new Array(3)` has empty slots, and `map` skips them. Use `Array.from({ length: 3 }, (_, i) => i)` or `.fill()`.
- `Array(2).fill([])` puts the SAME array in both slots.

**Object helpers.** `Object.entries` turns an object into `[key, value]` pairs and `Object.fromEntries` turns pairs back into an object. Together they let you "map" an object:

```js
const prices = { apple: 1, pear: 2 };
const doubled = Object.fromEntries(
  Object.entries(prices).map(([name, price]) => [name, price * 2]),
);
console.log(doubled);
console.log(Object.hasOwn(prices, 'apple'), Object.hasOwn(prices, 'toString'), 'toString' in prices);
console.log(Object.keys({ b: 1, 2: 1, a: 1, 1: 1 }));
```

```text
{ apple: 2, pear: 4 }
true false true
[ '1', '2', 'b', 'a' ]
```

Key order: keys that are array indexes (whole numbers written as text, from `'0'` up to `'4294967294'`) come first in ascending order, then the other keys in the order they were added.

**Which function lists which keys?** A common follow-up. The answer depends on three questions: own or inherited, enumerable or not, string or symbol.

| Way to list keys | Own only? | Skips non-enumerable? | Includes symbols? |
|---|---|---|---|
| `for...in` | no (also inherited) | yes | no |
| `Object.keys`, `Object.values`, `Object.entries` | yes | yes | no |
| `Object.getOwnPropertyNames` | yes | no | no |
| `Reflect.ownKeys` | yes | no | yes |

```js
const parent = { inherited: 1 };
const child = Object.create(parent);
child.own = 1;
Object.defineProperty(child, 'hidden', { value: 2, enumerable: false });
child[Symbol('tag')] = 3;

const viaForIn = [];
for (const key in child) viaForIn.push(key);
console.log(viaForIn);
console.log(Object.keys(child));
console.log(Object.getOwnPropertyNames(child));
console.log(Reflect.ownKeys(child));
```

```text
[ 'own', 'inherited' ]
[ 'own' ]
[ 'own', 'hidden' ]
[ 'own', 'hidden', Symbol(tag) ]
```

**Grouping** (available on Node 24):

```js
const orders = [
  { id: 1, user: 'ann' },
  { id: 2, user: 'bo' },
  { id: 3, user: 'ann' },
];
const byUser = Object.groupBy(orders, (o) => o.user);
console.log(Object.keys(byUser), byUser.ann.map((o) => o.id), Object.getPrototypeOf(byUser));
const bySize = Map.groupBy(orders, (o) => (o.id >= 2 ? 'big' : 'small'));
console.log([...bySize.keys()]);
```

```text
[ 'ann', 'bo' ] [ 1, 3 ] null
[ 'small', 'big' ]
```

`Object.groupBy` returns an object with no prototype (so a key such as `toString` is safe). `Map.groupBy` returns a `Map`, and its keys can be any value.

> **Common mistake:** `forEach` ignores the return value, cannot be stopped with `break`, and does NOT wait for async callbacks. Use `for...of` when you need `break`, `continue` or `await` inside a loop. [Lesson 07](../07-async-javascript/README.md) shows why.

> **Interview tip:** Expect "which of these change the original array?" (answer with the table above) and small coding tasks: remove duplicates (`[...new Set(list)]`), count or group items (`reduce` into an object, or `Object.groupBy`), flatten a nested array (`flat(Infinity)`), and sort by a field (a comparator, never the default `sort`). Say out loud whether your solution mutates its input; interviewers listen for that.

## 9. Map, Set, WeakMap, WeakSet and WeakRef

Example file: `examples/09-collections-weak.js`. Run it with `--expose-gc` to see the last part work:

```bash
node --expose-gc lessons/02-javascript-essentials/examples/09-collections-weak.js
```

A **Map** stores key-value pairs. A **Set** stores unique values. Both remember insertion order.

| | `Map` | Plain object `{}` |
|---|---|---|
| Key types | any value (objects, numbers, `NaN`) | strings and symbols only |
| Order | insertion order | integer-like keys first, then insertion |
| Size | `map.size` | `Object.keys(obj).length` |
| Extra keys from the prototype | none | `toString`, `constructor`, ... |
| `JSON.stringify` | gives `{}` | works |

```js
const keyObj = { id: 1 };
const map = new Map();
map.set('a', 1).set(2, 'two').set(keyObj, 'object key');
console.log(map.get(keyObj), map.get({ id: 1 }), map.size);

const obj = {};
obj[1] = 'number';
obj['1'] = 'string';
console.log(obj, new Map().set(1, 'number').set('1', 'string').size);

const pairs = new Map([['x', 1], ['y', 2]]);
console.log(JSON.stringify(pairs), JSON.stringify(Object.fromEntries(pairs)));

console.log([...new Set([1, 2, 2, 3, 3, 3])], new Set([NaN, NaN]).size, new Set([{}, {}]).size);
```

```text
object key undefined 3
{ '1': 'string' } 2
{} {"x":1,"y":2}
[ 1, 2, 3 ] 1 2
```

Reading from the output:

- `map.get({ id: 1 })` is `undefined`: object keys match by reference, and that is a new object.
- An object turns every key into a string, so `1` and `'1'` collide. A `Map` keeps them apart.
- A `Map` does not survive `JSON.stringify`. Convert it with `Object.fromEntries` first.
- `[...new Set(array)]` is the standard "remove duplicates". A `Set` treats `NaN` as equal to itself, but two separate `{}` are different.

Looping over a `Map` gives `[key, value]` pairs, and a `Map` can be built straight from an object's entries:

```js
const scores = new Map(Object.entries({ ann: 3, bo: 5 }));
for (const [who, score] of scores) console.log(who, score);
console.log(scores.delete('ann'), scores.delete('nobody'), [...scores]);
```

```text
ann 3
bo 5
true false [ [ 'bo', 5 ] ]
```

The Set math methods (available on Node 24) return a new `Set`:

```js
const s1 = new Set([1, 2, 3]);
const s2 = new Set([2, 3, 4]);
console.log([...s1.union(s2)], [...s1.intersection(s2)], [...s1.difference(s2)]);
console.log(s1.isSubsetOf(new Set([1, 2, 3, 4])));
```

```text
[ 1, 2, 3, 4 ] [ 2, 3 ] [ 1 ]
true
```

### A classic task: an LRU cache

An **LRU cache** (least recently used) keeps at most N entries and throws away the one that was used longest ago. A `Map` remembers insertion order, so its first key is always the oldest. Deleting a key and inserting it again moves it to the end, which marks it as the newest. That is the whole trick:

```js
class LRUCache {
  #max;
  #map = new Map();

  constructor(max) {
    this.#max = max;
  }

  get(key) {
    if (!this.#map.has(key)) return undefined;
    const value = this.#map.get(key);
    this.#map.delete(key); // move to the end: now the most recently used
    this.#map.set(key, value);
    return value;
  }

  set(key, value) {
    this.#map.delete(key);
    this.#map.set(key, value);
    if (this.#map.size > this.#max) this.#map.delete(this.#map.keys().next().value); // drop the oldest
  }

  keys() {
    return [...this.#map.keys()];
  }
}
const lru = new LRUCache(2);
lru.set('a', 1);
lru.set('b', 2);
lru.get('a'); // 'a' is now newer than 'b'
lru.set('c', 3); // over the limit: 'b' is the oldest, so it goes
console.log(lru.keys(), lru.get('b'));
```

```text
[ 'a', 'c' ] undefined
```

Every operation takes constant time on average (O(1): it does not slow down as the cache grows). An object cannot do this job reliably because its key order is not purely insertion order (see section 8).

### Weak collections

An object stays in memory as long as it is **reachable**: some variable, property or closure still leads to it. When nothing does, the **garbage collector** (the engine's automatic memory cleaner) may free it. A **weak** reference does not count as a way to reach the object, so it does not keep the object alive.

| | What it does | Rules |
|---|---|---|
| `WeakMap` | maps object keys to values | keys must be objects (or non-registered symbols); no `size`, no iteration, no `clear` |
| `WeakSet` | remembers a set of objects | members must be objects (or non-registered symbols); no `size`, no iteration |
| `WeakRef` | holds one object weakly; `ref.deref()` returns it, or `undefined` if it was collected | the object may disappear at any time |

Use a `WeakMap` to attach extra data to an object you do not own (a cache or metadata keyed by object) without causing a memory leak: when the object dies, the entry dies with it. A normal `Map` would keep the object alive forever. A `WeakSet` is a clean way to answer "have I already seen this object?".

```js
const visits = new WeakMap();
const page = { url: '/home' };
visits.set(page, { count: 1 });
visits.get(page).count += 1;
console.log(visits.get(page), visits.has({ url: '/home' }));
console.log(typeof visits.size, typeof visits[Symbol.iterator]);
try {
  visits.set('not an object', 1);
} catch (err) {
  console.log(err.name + ':', err.message);
}

const seen = new WeakSet();
function visit(node) {
  if (seen.has(node)) return 'skipped';
  seen.add(node);
  return 'first visit';
}
const node = {};
console.log(visit(node), visit(node));
```

```text
{ count: 2 } false
undefined undefined
TypeError: Invalid value used as weak map key
first visit skipped
```

There is no `size` and no iterator, because the contents can change whenever the garbage collector runs.

The example ends with a `WeakRef` cache. A `WeakRef` wraps an object; `deref()` gives the object back, or `undefined` if it was collected:

```js
const cache = new Map();
let builds = 0;
function getReport(id) {
  const hit = cache.get(id)?.deref(); // the report, or undefined if it was collected
  if (hit) return hit;
  builds += 1;
  const report = { id, rows: new Array(1000).fill(id) };
  cache.set(id, new WeakRef(report));
  return report;
}
```

The example calls `getReport(1)` twice, then forces a garbage collection with `global.gc()` (only available with `--expose-gc`) and calls it a third time:

```text
6a. builds before gc: 1
6b. builds after gc : 2
```

After the collection the report is gone, so asking for it builds it a second time. Garbage collection timing is never guaranteed; the forced `gc()` makes the result repeatable here, but never write real code that relies on when an object disappears. A `WeakRef` target is also kept alive until the current job (the synchronous run) finishes, which is why the example waits one timer turn before collecting. Without the flag, the example prints a message telling you to rerun it with `--expose-gc`. There is also a `FinalizationRegistry`, which calls a function after an object has been collected. It is for rare cleanup jobs and, like `WeakRef`, nothing important should depend on it.

> **Interview tip:** "Map vs WeakMap?" Strong answer: `WeakMap` keys are held weakly, so it cannot leak the keys, but you pay for that with no iteration and no `size`. Mention that the real use case is per-object metadata and caches, and that most code never needs `WeakRef`. If you are asked to build an LRU cache, say that a `Map` keeps insertion order and show the delete-and-reinsert trick.

## 10. Iterators, generators and Symbol

An **iterator** is an object with a `next()` method. Each call returns `{ value, done }`. An **iterable** is an object that can produce an iterator, by having a method named `[Symbol.iterator]`. `for...of`, spread (`[...x]`), array destructuring, `Array.from`, `new Set(...)` and `Promise.all` all work on any iterable. Example file: `examples/10-iterators-generators.js`.

```js
class Range {
  constructor(from, to) {
    this.from = from;
    this.to = to;
  }
  [Symbol.iterator]() {
    let current = this.from;
    const last = this.to;
    return {
      next() {
        return current <= last ? { value: current++, done: false } : { value: undefined, done: true };
      },
    };
  }
}
const range = new Range(1, 4);
const [one, two] = range;
console.log([...range], Math.max(...range), one, two);
```

```text
[ 1, 2, 3, 4 ] 4 1 2
```

Arrays, strings, `Map`, `Set` and generators are all built-in iterables. Plain objects are not: with `const plain = { a: 1 }`, the loop `for (const x of plain)` throws `TypeError: plain is not iterable`. Strings are walked by code point, so `'a\u{1F600}'` has length 3 but only 2 items when spread.

Also remember `for...of` gives values and `for...in` gives keys (as strings), including inherited enumerable ones. Use `for...of` for arrays.

### Generators

A **generator function** (`function*`) can pause itself with `yield` and be resumed later. Calling it does not run the body; it returns a generator object, which is an iterator.

```js
function* noisy() {
  console.log('    ...producing 1');
  yield 1;
  console.log('    ...producing 2');
  yield 2;
}
const lazy = noisy();
console.log('created, nothing has run yet');
console.log(lazy.next());

function* naturals() {
  let n = 1;
  while (true) yield n++; // an infinite sequence is fine, it is lazy
}
function* take(iterable, limit) {
  if (limit <= 0) return;
  let count = 0;
  for (const item of iterable) {
    yield item;
    if (++count >= limit) return;
  }
}
console.log([...take(naturals(), 5)]);
```

```text
created, nothing has run yet
    ...producing 1
{ value: 1, done: false }
[ 1, 2, 3, 4, 5 ]
```

Generators are **lazy**: values are made only when asked for. That is why an infinite `while (true)` loop is safe, and why generators suit big or streaming data.

`yield` also receives a value: whatever you pass to `next(value)`. And `yield*` hands over to another iterable:

```js
function* chat() {
  const name = yield 'name?';
  const age = yield `hi ${name}, age?`;
  return `${name} is ${age}`;
}
const talk = chat();
console.log(talk.next().value, '|', talk.next('Ann').value, '|', talk.next(30));

function* inner() {
  yield 'b';
  yield 'c';
}
function* outer() {
  yield 'a';
  yield* inner();
  yield 'd';
}
console.log([...outer()]);
```

```text
name? | hi Ann, age? | { value: 'Ann is 30', done: true }
[ 'a', 'b', 'c', 'd' ]
```

Node 24 also has **iterator helpers**, so you can chain on any iterator without building arrays in between:

```js
function* naturals() {
  let n = 1;
  while (true) yield n++;
}
const squares = naturals()
  .filter((n) => n % 2 === 0)
  .map((n) => n * n)
  .take(3)
  .toArray();
console.log(squares);
```

```text
[ 4, 16, 36 ]
```

**Leaving a loop early.** When `for...of` stops before the end (a `break`, a `return`, or a thrown error), it calls the iterator's optional `return()` method. For a generator, that runs its `finally` block. This is the hook for cleanup such as closing a file or a connection. A hand-made iterator can provide its own `return()`. (A generator object also has `return(value)` and `throw(error)` methods, to end it or push an error into it from outside.)

```js
function* readLines() {
  try {
    yield 'line 1';
    yield 'line 2';
    yield 'line 3';
  } finally {
    console.log('cleanup ran');
  }
}
for (const line of readLines()) {
  console.log(line);
  break;
}
```

```text
line 1
cleanup ran
```

The example also ends with an **async generator** (`async function*`) read with `for await`. That is the topic of [lesson 07](../07-async-javascript/README.md); here it only shows that generators and async fit together.

### Symbol

A **Symbol** is a value that is guaranteed to be unique. It is mostly used as a property key that cannot clash with any other key.

```js
const id1 = Symbol('id');
const id2 = Symbol('id');
console.log(id1 === id2, id1.toString(), id1.description);

const user = { name: 'Sara', [id1]: 123 };
console.log(Object.keys(user), JSON.stringify(user), user[id1], Object.getOwnPropertySymbols(user));
console.log(Symbol.for('app.key') === Symbol.for('app.key'));
```

```text
false Symbol(id) id
[ 'name' ] {"name":"Sara"} 123 [ Symbol(id) ]
true
```

- The text inside `Symbol('id')` is only a label. Two symbols with the same label are different.
- Symbol keys are invisible to `Object.keys`, `for...in` and `JSON.stringify`.
- `Symbol.for('key')` uses a shared registry, so the same key gives the same symbol everywhere.
- A symbol cannot be turned into text by accident: `'' + id1` throws `TypeError: Cannot convert a Symbol value to a string`.

**Well-known symbols** let your objects plug into the language: `Symbol.iterator` (iteration), `Symbol.asyncIterator` (the async twin, used by `for await`), `Symbol.toPrimitive` (conversion), `Symbol.toStringTag` (the `[object X]` label). Node adds its own, `util.inspect.custom`, which controls how `console.log` prints an object. It is the same as `Symbol.for('nodejs.util.inspect.custom')`:

```js
const util = require('node:util');

const temperature = {
  [Symbol.toPrimitive](hint) {
    return hint === 'string' ? '20 C' : 20;
  },
  get [Symbol.toStringTag]() {
    return 'Temperature';
  },
};
console.log(`${temperature}`, +temperature, temperature + 1, Object.prototype.toString.call(temperature));

class Secret {
  constructor(token) {
    this.token = token;
  }
  [util.inspect.custom]() {
    return 'Secret<hidden>';
  }
}
console.log(new Secret('abc123'), util.inspect.custom === Symbol.for('nodejs.util.inspect.custom'));
```

```text
20 C 20 21 [object Temperature]
Secret<hidden> true
```

The first object converts to `'20 C'` when text is wanted and to `20` for math. The `Secret` class decides how `console.log` prints it: the output is `Secret<hidden>`, never the token. This is one way to keep a token out of your logs.

> **Interview tip:** "How does `for...of` work?" It calls `obj[Symbol.iterator]()` once, then calls `next()` until `done` is `true`. If you can say that and write a tiny iterable or generator, you pass this question.

## 11. Higher-order functions, currying, composition and memoization

Functions are values: you can store them in variables, pass them as arguments and return them from other functions. A **higher-order function** is one that takes a function or returns a function. `map`, `filter`, `reduce` and every callback API in Node are examples. Example file: `examples/11-functional.js`.

```js
function multiplyBy(factor) {
  return (n) => n * factor; // returns a new function that remembers factor (a closure)
}
const double = multiplyBy(2);
console.log(double(5), [1, 2, 3].map(double));
```

```text
10 [ 2, 4, 6 ]
```

**Partial application** fixes some arguments now and supplies the rest later: `add.bind(null, 10)`. **Currying** turns `f(a, b, c)` into `f(a)(b)(c)`. This version also accepts `f(a, b)(c)`:

```js
function add(a, b, c) {
  return a + b + c;
}
function curry(fn) {
  return function curried(...args) {
    if (args.length >= fn.length) return fn(...args); // fn.length = number of declared parameters
    return (...more) => curried(...args, ...more);
  };
}
const curriedAdd = curry(add);
console.log(add.bind(null, 10)(1, 2), curriedAdd(1)(2)(3), curriedAdd(1, 2)(3), curriedAdd(1)(2, 3));
```

```text
13 6 6 6
```

**Composition** builds a pipeline out of small functions. `pipe` runs left to right, `compose` runs right to left:

```js
const compose = (...fns) => (input) => fns.reduceRight((value, fn) => fn(value), input);
const pipe = (...fns) => (input) => fns.reduce((value, fn) => fn(value), input);

const trim = (s) => s.trim();
const lower = (s) => s.toLowerCase();
const slug = (s) => s.replace(/\s+/g, '-');
console.log(pipe(trim, lower, slug)('  Hello Node World  '));
console.log(compose(slug, lower, trim)('  Hello Node World  '));
```

```text
hello-node-world
hello-node-world
```

**Memoization** stores the result for each input so the same work is never done twice. It is a closure around a `Map`:

```js
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
console.log(fibNaive(20), 'in', naiveCalls, 'calls');

let memoCalls = 0;
const fibMemo = memoize((n) => {
  memoCalls += 1;
  return n < 2 ? n : fibMemo(n - 1) + fibMemo(n - 2);
});
console.log(fibMemo(20), 'in', memoCalls, 'calls');
```

```text
6765 in 21891 calls
6765 in 21 calls
```

Same answer, 21891 calls against 21. The traps: this `memoize` looks at only ONE argument; the cache grows forever (use a size limit or a `WeakMap` for object keys); and it is only safe for **pure functions** (the same input always gives the same output and nothing else changes). Never memoize a function that reads the clock or a database.

For several arguments, build the cache key from all of them. `JSON.stringify(args)` is the quick way, and it works when the arguments are numbers, strings or plain data:

```js
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
console.log(power(2, 10), power(2, 10), power(3, 2), '| real calls:', powerCalls);
```

```text
1024 1024 9 | real calls: 2
```

The last part of the example is a **debounce**, a common interview task. It waits until calls stop for N milliseconds and then runs once:

```js
function debounce(fn, wait) {
  let timer;
  return function (...args) {
    clearTimeout(timer); // cancel the previous timer
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}
const log = debounce((text) => console.log('debounced call ran once with:', text), 20);
log('first');
log('second');
log('third');
```

```text
debounced call ran once with: third
```

Three calls in a row produce one run with the last value. Each new call cancels the previous timer with `clearTimeout`.

A **throttle** is its sibling, and interviewers like to ask for the difference:

| | Debounce | Throttle |
|---|---|---|
| Runs the function | once, after the calls have stopped for N ms | at most once every N ms, while calls keep coming |
| Typical use | search box (wait until the user stops typing), save after edits | scroll or resize handlers, rate-limiting a noisy event |

> **Interview tip:** Know how to write `curry`, `compose`, `memoize`, `debounce` and `once` from memory. They all use the same idea: a function that returns a function that remembers something in a closure.

## 12. JSON gotchas

**JSON** is a text format for data. `JSON.stringify` turns a value into JSON text and `JSON.parse` turns text back into a value. Example file: `examples/12-json-date-errors.js` (it covers sections 12 to 14).

```js
const data = {
  name: 'Sara',
  age: undefined, // dropped
  run() {}, // dropped
  id: Symbol('x'), // dropped
  score: NaN, // becomes null
  big: Infinity, // becomes null
  when: new Date(0), // becomes an ISO string (Date has a toJSON method)
  tags: new Set([1]), // becomes {}
  table: new Map([[1, 2]]), // becomes {}
  nothing: null, // kept
};
console.log(JSON.stringify(data));
console.log(JSON.stringify([undefined, function () {}, Symbol('x')]));
```

```text
{"name":"Sara","score":null,"big":null,"when":"1970-01-01T00:00:00.000Z","tags":{},"table":{},"nothing":null}
[null,null,null]
```

Inside objects, values JSON cannot hold are dropped. Inside arrays they become `null`, to keep the positions.

If the whole value is something JSON cannot hold, `stringify` returns the value `undefined` (not a string), which is a classic bug source when you write it to a file or a response:

```js
console.log(JSON.stringify(undefined), JSON.stringify(() => {}), JSON.stringify(-0), JSON.stringify(new Date(NaN)));
```

```text
undefined undefined 0 null
```

**Parsing.** `JSON.parse` returns only plain data, so a date comes back as a string unless you pass a **reviver** (a function that `JSON.parse` calls for every value, so you can change it) to rebuild it. A number above `2 ** 53` loses digits, which matters for big IDs from an API; send those as strings. On Node 24 the reviver also receives a third argument with the original source text, so you can keep a big number exactly:

```js
const text = '{"when":"1970-01-01T00:00:00.000Z","n":1}';
const plain = JSON.parse(text);
const revived = JSON.parse(text, (key, value) => (key === 'when' ? new Date(value) : value));
console.log(typeof plain.when, '|', revived.when instanceof Date);

console.log(JSON.parse('12345678901234567890'));
console.log(JSON.parse('{"id":12345678901234567890}', (key, value, context) => (key === 'id' ? BigInt(context.source) : value)));
```

```text
string | true
12345678901234567000
{ id: 12345678901234567890n }
```

**Errors.** JSON is stricter than JavaScript: no single quotes, no trailing commas, no `undefined`. Bad input throws `SyntaxError`, so wrap `JSON.parse` of outside data in `try/catch`. `stringify` throws on a circular reference and on a `BigInt`.

```js
for (const bad of ["{'a': 1}", '[1, 2,]', '', undefined]) {
  try {
    JSON.parse(bad);
  } catch (err) {
    console.log(err.name + ':', err.message);
  }
}

const loop = {};
loop.self = loop;
try {
  JSON.stringify(loop);
} catch (err) {
  console.log(err.name + ':', err.message.split('\n')[0]);
}
try {
  JSON.stringify({ n: 10n });
} catch (err) {
  console.log(err.name + ':', err.message);
}
```

```text
SyntaxError: Expected property name or '}' in JSON at position 1 (line 1 column 2)
SyntaxError: Unexpected token ']', "[1, 2,]" is not valid JSON
SyntaxError: Unexpected end of JSON input
SyntaxError: "undefined" is not valid JSON
TypeError: Converting circular structure to JSON
TypeError: Do not know how to serialize a BigInt
```

The exact message text belongs to V8 and can change between versions; do not match on it.

**Controlling the output.** A `toJSON()` method on your class decides how it is stringified. The second argument of `stringify` can be a list of allowed keys, or a **replacer** function that can teach `stringify` about types it does not know, such as `Map` and `Set`. The third argument sets the indentation: `JSON.stringify(obj, null, 2)`.

```js
class Money {
  constructor(cents) {
    this.cents = cents;
  }
  toJSON() {
    return `$${(this.cents / 100).toFixed(2)}`;
  }
}
console.log(JSON.stringify({ price: new Money(1999) }));
console.log(JSON.stringify({ a: 1, secret: 'x', b: 2 }, ['a', 'b']));

const replacer = (key, value) =>
  value instanceof Map ? Object.fromEntries(value) : value instanceof Set ? [...value] : value;
console.log(JSON.stringify({ table: new Map([['x', 1]]), tags: new Set(['a', 'b']) }, replacer));
```

```text
{"price":"$19.99"}
{"a":1,"b":2}
{"table":{"x":1},"tags":["a","b"]}
```

> **Interview tip:** "What does `JSON.stringify` lose, and how do you fix each loss?" Strong answer: `undefined`, functions and symbols vanish; `NaN` and `Infinity` become `null`; `Date` becomes a string (rebuild it with a reviver); `Map` and `Set` become `{}` (use a replacer or convert first); `BigInt` and cycles throw. Then add that `JSON.parse(JSON.stringify(x))` is therefore a poor deep copy.

## 13. Date pitfalls

A `Date` stores one number: milliseconds since 1 January 1970 UTC (the world reference time, close to GMT). All the traps come from reading it back in local time.

```js
const jan15 = new Date(2024, 0, 15); // local time
console.log(jan15.getFullYear(), jan15.getMonth(), jan15.getDate(), jan15.getDay());
```

```text
2024 0 15 1
```

`new Date(2024, 0, 15)` is the 15th of **January** (months count from 0), `getDay()` is the weekday (0 is Sunday, so 1 is Monday), and `getDate()` is the day of the month.

**Parsing is the big trap.** A date-only string (`'2024-01-15'`) is read as UTC. A date-time string without a `Z` (`'2024-01-15T00:00:00'`) is read as LOCAL time. The same code gives different answers in different time zones. The example runs the same code in three time zones by starting child processes with a `TZ` setting (the environment variable that sets a process's time zone), so you do not need to change anything on your machine:

```js
const { spawnSync } = require('node:child_process');

const probe = `
  const d = new Date('2024-01-15');
  const local = new Date('2024-01-15T00:00:00');
  JSON.stringify({ dayOfMonth: d.getDate(), localMidnightInUtc: local.toISOString() })
`;
for (const tz of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
  const run = spawnSync(process.execPath, ['-p', probe], {
    env: { ...process.env, TZ: tz },
    encoding: 'utf8',
  });
  console.log(tz.padEnd(17), run.stdout.trim());
}
```

```text
UTC               {"dayOfMonth":15,"localMidnightInUtc":"2024-01-15T00:00:00.000Z"}
America/New_York  {"dayOfMonth":14,"localMidnightInUtc":"2024-01-15T05:00:00.000Z"}
Asia/Tokyo        {"dayOfMonth":15,"localMidnightInUtc":"2024-01-14T15:00:00.000Z"}
```

In New York, `new Date('2024-01-15').getDate()` is **14**: UTC midnight is still the evening of the 14th there. That is a classic "off by one day" bug.

> **Remember:** The `TZ` trick was run on Windows 11 with Node 24.16. Linux and macOS read `TZ` the same way and should print the same lines, but they were not run. The hour offsets (5 hours behind UTC for New York, 9 hours ahead for Tokyo) are the January values; in summer New York is 4 hours behind.

Invalid dates, comparing dates, and dates that change:

```js
const invalid = new Date('not a date');
console.log(String(invalid), invalid.getTime(), Number.isNaN(invalid.getTime()));
console.log(JSON.stringify({ when: invalid }));
try {
  invalid.toISOString();
} catch (err) {
  console.log(err.name + ':', err.message);
}

const dateA = new Date(Date.UTC(2024, 0, 31));
const dateB = new Date(Date.UTC(2024, 0, 31));
console.log(dateA == dateB, dateA.getTime() === dateB.getTime(), dateA < new Date(Date.UTC(2024, 1, 1)));
console.log(typeof (dateA + 1), typeof (dateA - 1));
const next = new Date(dateA);
next.setUTCMonth(1); // February has no 31st, so the date rolls over
console.log(next.toISOString().slice(0, 10));
console.log((new Date(Date.UTC(2024, 0, 2)) - new Date(Date.UTC(2024, 0, 1))) / 3600000, 'hours between');
```

```text
Invalid Date NaN true
{"when":null}
RangeError: Invalid time value
false true true
string number
2024-03-02
24 hours between
```

- An invalid date does not throw when created. It becomes "Invalid Date" with a time value of `NaN`. Check with `Number.isNaN(date.getTime())`. `toISOString()` on it throws.
- Two dates are objects, so `==` and `===` compare references (`false`). Compare with `getTime()`. The operators `<` and `>` work because they use the number.
- `date + 1` makes text (a `Date` prefers its string form with `+`), while `date - 1` is a number. Subtracting two dates gives milliseconds.
- A `Date` is mutable and rolls over: `setUTCMonth(1)` on 31 January 2024 gives 2 March because February has no 31st. In a year that is not a leap year the result is 3 March.

**Two more parsing traps in V8** (the engine inside Node). An impossible day such as 30 February is NOT an invalid date; it quietly rolls into March (V8 accepts a day from 1 to 31 in any month, so `2024-04-31` becomes 1 May). A day such as 32 or a month such as 13 is rejected. And only the ISO format (`2024-01-15`) is guaranteed to parse the same everywhere; other formats depend on the engine. V8 reads `'01/02/2024'` as January 2 (month first). Never parse non-ISO text from users with `new Date(text)`.

```js
console.log(new Date('2024-02-30').toISOString(), '|', String(new Date('2024-02-32')));
console.log(new Date('01/02/2024').getMonth(), '(0 means January)');
```

```text
2024-03-01T00:00:00.000Z | Invalid Date
0 (0 means January)
```

**Showing one moment in different time zones.** Do not shift the hours by hand. Use `Intl.DateTimeFormat` with a `timeZone` option:

```js
const moment = new Date(Date.UTC(2024, 0, 15, 12, 0));
for (const timeZone of ['UTC', 'America/New_York', 'Asia/Tokyo']) {
  const shown = new Intl.DateTimeFormat('en-GB', { timeZone, dateStyle: 'short', timeStyle: 'short' }).format(moment);
  console.log(timeZone.padEnd(17), shown);
}
```

```text
UTC               15/01/2024, 12:00
America/New_York  15/01/2024, 07:00
Asia/Tokyo        15/01/2024, 21:00
```

**Measuring time.** `Date.now()` follows the system clock, which can be adjusted while your program runs. To measure how long something takes, use `performance.now()` (a clock that only moves forward).

Practical advice: store and send dates as ISO strings in UTC (`date.toISOString()` gives text like `2024-01-15T00:00:00.000Z`) or as `Date.now()` numbers. Use the `getUTC...` methods unless you really mean local time. The newer `Temporal` API fixes these problems. According to the Node 26 release notes it is a global only from Node 26; on Node 24 `Temporal` is `undefined`.

> **Interview tip:** "How do you handle dates and time zones in a backend?" Strong answer: store and transmit UTC (ISO strings or epoch milliseconds), convert to a time zone only when displaying, never parse non-ISO text, remember that months start at 0, and test with a different `TZ` value because a server on your laptop and a server in the cloud rarely share a time zone.

## 14. Errors, try/catch and the call stack

An **error** is an object that describes a failure. `throw` stops the current function and unwinds to the nearest `try/catch`. The built-in kinds you should recognise are `TypeError` (wrong type or `undefined.x`), `RangeError` (a value out of range, or too much recursion), `SyntaxError` (bad code or bad JSON) and `ReferenceError` (a name that does not exist or is in the TDZ).

```js
function parseAge(input) {
  const age = Number(input);
  if (Number.isNaN(age)) throw new TypeError(`age must be a number, got "${input}"`);
  if (age < 0) throw new RangeError('age cannot be negative');
  return age;
}
let attempts = 0;
for (const input of ['42', 'abc', '-1']) {
  try {
    console.log('ok', parseAge(input));
  } catch (err) {
    console.log(err instanceof RangeError ? 'range error:' : 'other error:', err.message);
  } finally {
    attempts += 1; // runs on success and on failure
  }
}
console.log('finally ran', attempts, 'times');
```

```text
ok 42
other error: age must be a number, got "abc"
range error: age cannot be negative
finally ran 3 times
```

`finally` runs whether or not an error happened, even after a `return`. Use it for cleanup (closing a file, releasing a lock). A `return` inside `finally` replaces the earlier return value, so avoid that:

```js
function tryReturn() {
  try {
    return 'from try';
  } finally {
    console.log('finally runs before the function returns');
  }
}
function finallyWins() {
  try {
    return 'from try';
  } finally {
    return 'from finally'; // replaces the earlier return: avoid this
  }
}
console.log(tryReturn(), '|', finallyWins());
```

```text
finally runs before the function returns
from try | from finally
```

**Always throw `Error` objects**, never strings. Only an `Error` has a `stack` (a text trace of where it happened):

```js
try {
  throw 'just a string';
} catch (err) {
  console.log(typeof err, err.stack);
}
try {
  throw new TypeError('bad input');
} catch (err) {
  console.log(err.name, '|', err.message, '|', err.stack.split('\n')[0]);
}
```

```text
string undefined
TypeError | bad input | TypeError: bad input
```

**Custom errors and `cause`.** Subclass `Error` to make errors you can recognise with `instanceof`. The `cause` option keeps the original error when you wrap it:

```js
class ConfigError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ConfigError';
  }
}
try {
  try {
    JSON.parse('{bad');
  } catch (cause) {
    throw new ConfigError('config file is invalid', { cause });
  }
} catch (err) {
  console.log(err.name, '|', err.message, '| cause:', err.cause.name, '|', err instanceof ConfigError, err instanceof Error);
}
```

```text
ConfigError | config file is invalid | cause: SyntaxError | true true
```

**Handle only the errors you expect, and rethrow the rest.** A `catch` block that swallows everything hides real bugs, such as a `TypeError` from a typo. Check the kind with `instanceof` and `throw err` again when it is not yours. If you do not need the error object, the binding can be left out (`catch { ... }`):

```js
function mightFail(kind) {
  if (kind === 'range') throw new RangeError('out of range');
  if (kind === 'type') throw new TypeError('wrong type');
  return 'fine';
}
for (const kind of ['ok', 'range', 'type']) {
  try {
    try {
      console.log('result:', mightFail(kind));
    } catch (err) {
      if (!(err instanceof RangeError)) throw err; // not ours: pass it on
      console.log('handled:', err.message);
    }
  } catch (err) {
    console.log('rethrown to the caller:', err.name);
  }
}
try {
  JSON.parse('{');
} catch {
  console.log('optional catch binding');
}
```

```text
result: fine
handled: out of range
rethrown to the caller: TypeError
optional catch binding
```

The outer `try` in this demo plays the part of the caller. [Lesson 14](../14-error-handling-and-debugging/README.md) goes much further: operational errors versus programmer bugs, what Node does with errors nobody catches, and the "log, then exit" rule.

**try/catch only catches errors thrown while its block is running.** An error thrown later by a callback is outside the `try` by then. With `async/await`, an awaited rejection is thrown back into your `try`, so it does work:

```js
async function awaitDemo() {
  try {
    await Promise.reject(new Error('rejected promise'));
  } catch (err) {
    console.log('await + try/catch caught:', err.message);
  }
}
awaitDemo();

try {
  setTimeout(() => {
    throw new Error('thrown inside a timer');
  }, 0);
} catch (err) {
  console.log('this line never runs');
}
process.once('uncaughtException', (err) => {
  console.log('try/catch missed it, Node reported:', err.message);
});
```

```text
await + try/catch caught: rejected promise
try/catch missed it, Node reported: thrown inside a timer
```

The `throw` inside `setTimeout` is placed inside a `try`, but the `catch` never ran. In a real program an uncaught error like that crashes the process (exit code 1). The demo registers `process.once('uncaughtException', ...)` only so it can finish. Real programs use that hook to log and then exit, not to carry on. [Lesson 07](../07-async-javascript/README.md) covers error handling for callbacks and promises in depth.

> **Interview tip:** "How do you handle errors in JavaScript?" Strong answer: throw `Error` objects (or subclasses with a clear `name`), catch only what you can handle and rethrow the rest, keep the original error in `cause` when you wrap it, use `finally` for cleanup, and remember that `try/catch` sees only what happens while its block runs (`await` brings promise failures back into it; plain callbacks do not).

### The call stack

The **call stack** is the list of functions that are running right now. Calling a function pushes a new entry (a **frame**) on top. Returning pops it. A stack trace is a printout of this list, newest call first.

```js
function level3() {
  return new Error('trace').stack;
}
function level2() {
  return level3();
}
function level1() {
  return level2();
}
const frames = level1()
  .split('\n')
  .slice(1, 4)
  .map((line) => line.trim().split(' ')[1]);
console.log(frames);
```

```text
[ 'level3', 'level2', 'level1' ]
```

The stack has a fixed size. When recursion goes too deep, the engine throws a `RangeError`: this is a **stack overflow**.

```js
let depth = 0;
function dive() {
  depth += 1;
  dive(); // no base case: it never stops
}
try {
  dive();
} catch (err) {
  console.log(err.name + ':', err.message, '| went deeper than 1000 calls:', depth > 1000);
}

const sumRecursive = (n) => (n === 0 ? 0 : n + sumRecursive(n - 1));
function sumLoop(n) {
  let total = 0;
  for (let i = 1; i <= n; i++) total += i;
  return total;
}
try {
  sumRecursive(1_000_000);
} catch (err) {
  console.log('recursive sum of 1,000,000 numbers ->', err.name);
}
console.log('loop sum of 1,000,000 numbers ->', sumLoop(1_000_000));
```

```text
RangeError: Maximum call stack size exceeded | went deeper than 1000 calls: true
recursive sum of 1,000,000 numbers -> RangeError
loop sum of 1,000,000 numbers -> 500000500000
```

The limit is roughly ten thousand simple calls, and less when each frame is bigger; do not hard-code a number. A recursive function without a base case overflows. A correct recursive function can also overflow on big input, and V8 (the engine inside Node) does not optimise tail calls (a call in the last position is not reused as a loop). Also note that a stack overflow is an ordinary catchable `RangeError`, unlike running out of heap memory, which kills the process.

Ways to fix a recursion that is too deep:

1. Rewrite it as a loop (`sumLoop` above). This is the simplest fix.
2. For trees and graphs, use a loop with your own array as the stack (`push` and `pop`), so the depth lives in the heap and not on the call stack.
3. Use a **trampoline**: the function returns the NEXT step as a function instead of calling it, and a small loop runs the steps one at a time. The code keeps its recursive shape but the stack stays flat:

```js
const trampoline = (fn) => (...args) => {
  let step = fn(...args);
  while (typeof step === 'function') step = step();
  return step;
};
const sumTrampoline = trampoline(function go(n, total = 0) {
  return n === 0 ? total : () => go(n - 1, total + n);
});
console.log(sumTrampoline(1_000_000));
```

```text
500000500000
```

> **Interview tip:** "What is the call stack?" Strong answer: a last-in-first-out list of active function calls; each call adds a frame with its local variables; a trace is a printout of it; too deep recursion throws `RangeError: Maximum call stack size exceeded`. It also leads straight into the [event loop lesson](../08-event-loop/README.md): async callbacks run only when the stack is empty.

## 15. Tricky output quiz

Predict the output before you open the answer. Run each snippet as a plain `.js` file (CommonJS) to check yourself.

**Q1.**

```js
var x = 1;
function f() {
  console.log(x);
  var x = 2;
}
f();
```

<details><summary>Answer</summary>

```text
undefined
```

Inside `f`, `var x` is hoisted to the top of `f` and shadows the outer `x`. At the `console.log` line the local `x` exists but has no value yet.

</details>

**Q2.**

```js
for (var i = 0; i < 3; i++) {
  setTimeout(() => console.log(i), 0);
}
```

<details><summary>Answer</summary>

```text
3
3
3
```

One shared `var i`; the callbacks run after the loop ends. Use `let` to get `0 1 2`.

</details>

**Q3.** Run as a CommonJS file.

```js
const user = {
  name: 'Sara',
  regular: function () {
    return this.name;
  },
  arrow: () => this.name,
};
const { regular } = user;
console.log(user.regular(), user.arrow(), regular());
```

<details><summary>Answer</summary>

```text
Sara undefined undefined
```

`user.regular()` has `user` left of the dot. The arrow function takes the file-level `this`, which is `module.exports` (an empty object). The detached `regular()` runs with the default `this`, which is `globalThis` in sloppy mode, and `globalThis.name` is `undefined`.

If you save this as an ES module (`.mjs`), the top-level `this` is `undefined`, so `user.arrow()` throws `TypeError: Cannot read properties of undefined (reading 'name')` instead.

</details>

**Q4.**

```js
console.log(1 + '2', '3' - 1, true + 1, [] + {}, [1, 2] + [3]);
```

<details><summary>Answer</summary>

```text
12 2 2 [object Object] 1,23
```

`+` joins when a string is involved (`'12'`); `-` always makes numbers; `true` is `1`. Arrays turn into text: `[1, 2]` becomes `'1,2'`, so the last one is `'1,2' + '3'`.

</details>

**Q5.**

```js
console.log(0.1 + 0.2 === 0.3, [1, 2, 3] == '1,2,3', NaN == NaN, null == undefined, null === undefined);
```

<details><summary>Answer</summary>

```text
false true false true false
```

Binary floating point; the array becomes the text `'1,2,3'`; `NaN` is never equal to anything; `null == undefined` is the one special loose match; `===` never converts.

</details>

**Q6.**

```js
console.log(['1', '2', '3'].map(parseInt));
console.log([10, 9, 1].sort());
```

<details><summary>Answer</summary>

```text
[ 1, NaN, NaN ]
[ 1, 10, 9 ]
```

`map` passes the index as the second argument, and `parseInt` reads it as the base. The default `sort` compares text.

</details>

**Q7.**

```js
function Dog(name) {
  this.name = name;
}
Dog.prototype.speak = function () {
  return this.name + ' barks';
};
const d = new Dog('Rex');
const speak = d.speak;
console.log(d.speak(), '|', speak(), '|', d instanceof Dog, Object.keys(d));
```

<details><summary>Answer</summary>

```text
Rex barks | undefined barks | true [ 'name' ]
```

The detached `speak()` has `this` set to `globalThis`, which has no `name`. `speak` is on the prototype, so it is not one of `d`'s own keys.

</details>

**Q8.**

```js
function* g() {
  const x = yield 1;
  console.log('got', x);
  yield x * 2;
}
const it = g();
console.log(it.next('ignored'));
console.log(it.next(21));
```

<details><summary>Answer</summary>

```text
{ value: 1, done: false }
got 21
{ value: 42, done: false }
```

The value passed to the first `next` is thrown away, because no `yield` is waiting for it yet. The second `next(21)` becomes the result of the first `yield`, so `x` is `21`.

</details>

**Q9.**

```js
let v = 'outer';
{
  console.log(v);
  let v = 'inner';
}
```

<details><summary>Answer</summary>

```text
ReferenceError: Cannot access 'v' before initialization
```

The inner `let v` exists from the start of the block, so it hides the outer `v` but is still in its TDZ at the `console.log`. It does not print `'outer'`. Because nothing catches the error, Node prints it as an uncaught error (the file name, the source line and a stack trace), and the process exits with code 1. The line above is its first message line.

</details>

**Q10.**

```js
console.log('a');
setTimeout(() => console.log('b'), 0);
Promise.resolve().then(() => console.log('c'));
console.log('d');
```

<details><summary>Answer</summary>

```text
a
d
c
b
```

Synchronous code first (`a`, `d`). Then the promise callback runs (it is a microtask, which runs right after the current code and before any timer). Then the timer callback runs. The [event loop lesson](../08-event-loop/README.md) explains why.

</details>

**Q11.**

```js
const { a = 1, b = 2, ...rest } = { a: undefined, b: null, c: 3 };
console.log(a, b, rest, null ?? 'x', 0 || 'y', 0 ?? 'z');
```

<details><summary>Answer</summary>

```text
1 null { c: 3 } x y 0
```

A destructuring default applies only to `undefined`, so `a` becomes `1` but `b` stays `null`. `rest` collects the unnamed property `c`. `null ?? 'x'` is `'x'`; `0 || 'y'` is `'y'` because `0` is falsy; `0 ?? 'z'` is `0` because `0` is not nullish.

</details>

**Q12.**

```js
console.log(JSON.stringify({ a: undefined, b: [undefined], c: new Set([1]), d: NaN }));
console.log(new Set([1, '1', 1, NaN, NaN]).size, [...new Map([[1, 'a'], [1, 'b']])]);
```

<details><summary>Answer</summary>

```text
{"b":[null],"c":{},"d":null}
3 [ [ 1, 'b' ] ]
```

In an object `undefined` is dropped, in an array it becomes `null`; a `Set` has no enumerable properties so it becomes `{}`; `NaN` becomes `null`. The `Set` keeps `1`, `'1'` and `NaN` (a `Set` treats the two `NaN` as the same value, and `1` and `'1'` are different types). A `Map` keeps one entry per key, so the second `[1, 'b']` overwrites the first.

</details>

## Summary / Key takeaways
- Use `const` by default, `let` when you must re-assign, and avoid `var`. Hoisting registers declarations first; `let` and `const` stay in the temporal dead zone until their line runs.
- A closure is a function plus the variables around where it was created. It keeps the variable, not a copy, which is why `var` in a loop shares one `i`.
- `this` depends on how a function is called: `new`, then explicit (`call`/`apply`/`bind`), then method call, then default. Arrow functions take `this` from outside and also have no `arguments`, no `prototype` and cannot be used with `new`.
- JavaScript is prototype-based. `new` makes an object linked to `Constructor.prototype`, and a `class` is syntax over that, with extras (`super`, `static`, private `#fields` and methods, must use `new`).
- Use `===`. Know the eight falsy values, `typeof null`, `NaN`, that `+` joins text when a string is involved, and that `&&` and `||` return one of their operands.
- Objects are shared by reference. Spread is shallow; `structuredClone` is deep but rejects functions and drops class prototypes; `Object.freeze` is shallow, and `seal` and `preventExtensions` are weaker locks.
- Know which array methods mutate, how `Map` and `Set` differ from objects and arrays (an LRU cache is a `Map` trick), what the weak collections are for, and that any object with `[Symbol.iterator]` works with `for...of` and spread. Generators are lazy.
- `JSON.stringify` silently drops or changes data, `Date` has UTC versus local and parsing traps, `try/catch` does not catch later callbacks (and should rethrow what it cannot handle), and deep recursion throws `RangeError`.

## Quick check

1. What is the temporal dead zone, and which error does it produce?
<details><summary>Answer</summary>

It is the period from the start of a block until a `let` or `const` declaration line runs. The name already exists but cannot be used, so reading it throws `ReferenceError: Cannot access 'x' before initialization`. A `var` is different: it is hoisted and reads as `undefined`.

</details>

2. Why does a `for (var i...)` loop with `setTimeout` print the same number each time, and what are two ways to fix it?
<details><summary>Answer</summary>

All callbacks close over ONE `var i`, and they run after the loop ended, when `i` is already at its final value. Fix 1: declare it with `let`, which gives each turn its own variable. Fix 2: wrap the body in an IIFE that receives a copy of `i`.

</details>

3. In what order does JavaScript decide the value of `this`, and how is an arrow function different?
<details><summary>Answer</summary>

`new` first, then explicit binding (`call`, `apply`, `bind`), then the method call `obj.f()`, then the default (`globalThis` in sloppy mode, `undefined` in strict mode). An arrow function has no `this` of its own: it uses the `this` of the code where it was written, and `call`/`bind` cannot change that.

</details>

4. Name three differences between a `class` and a constructor function plus `.prototype`.
<details><summary>Answer</summary>

A class cannot be called without `new` (it throws a `TypeError`). Its body is always strict and its methods are not enumerable. It is not usable before its declaration (TDZ). It also adds `extends`/`super`, `static` members and private `#fields`. Underneath, methods still live on `Class.prototype`.

</details>

5. When is `==` acceptable, and what does `[] == false` give?
<details><summary>Answer</summary>

The common accepted use is `x == null`, which is true for both `null` and `undefined`. `[] == false` is `true` because `false` becomes `0` and `[]` becomes `''` and then `0`. In all other code use `===`.

</details>

6. What does `{ ...obj }` copy, and what does it NOT copy? What does `structuredClone` add and where does it fail?
<details><summary>Answer</summary>

Spread copies the top-level own enumerable properties, so nested objects are still shared. `structuredClone` copies every level, including `Date`, `Map`, `Set` and circular references. It throws `DataCloneError` for functions, and class instances come back as plain objects without their prototype.

</details>

7. Why would you choose a `Map` over a plain object, and a `WeakMap` over a `Map`?
<details><summary>Answer</summary>

A `Map` accepts any key type, keeps insertion order, has `.size` and has no inherited keys. A `WeakMap` holds its object keys weakly, so it does not stop them being garbage collected; it is for per-object data or caches that must not cause a leak. In exchange it has no `size` and cannot be iterated.

</details>

8. Name four things `JSON.stringify` loses or changes.
<details><summary>Answer</summary>

`undefined`, functions and symbols are dropped from objects (and become `null` in arrays). `NaN` and `Infinity` become `null`. A `Date` becomes a string. `Map` and `Set` become `{}`. It also throws on circular references and on `BigInt`.

</details>

9. Why does a `try/catch` around `setTimeout(() => { throw new Error('x') })` not catch the error, and what is a stack overflow?
<details><summary>Answer</summary>

The callback runs later, after the `try` block has already finished, so no `catch` is waiting. Node reports it as an uncaught exception and exits with code 1 unless a handler exists. A stack overflow is `RangeError: Maximum call stack size exceeded`, thrown when recursion nests too deeply for the fixed-size call stack.

</details>

10. What happens when `for...of` runs over an object, and why are generators called lazy?
<details><summary>Answer</summary>

`for...of` calls `obj[Symbol.iterator]()` once, then calls `next()` until it returns `{ done: true }`. A plain object has no such method, so it throws `TypeError: ... is not iterable`. A generator does no work when you call it; its body runs only up to the next `yield` each time a value is asked for, so it can describe an infinite sequence and uses almost no memory. If the loop stops early, the iterator's `return()` is called, which runs a generator's `finally` block.

</details>

## Try it yourself

**Task 1 (easy): fix four bugs.** Save this as a scratch file and run it. Make each line print what the comment says, changing as little code as possible. Explain each bug in one sentence.

```js
const handlers = [];
for (var i = 0; i < 3; i++) {
  handlers.push(() => 'handler ' + i);
}
console.log(handlers.map((h) => h())); // want: [ 'handler 0', 'handler 1', 'handler 2' ]

class Timer {
  constructor() {
    this.ticks = 0;
  }
  tick() {
    this.ticks += 1;
    return this.ticks;
  }
}
const timer = new Timer();
const tick = timer.tick;
try {
  console.log(tick()); // want: 1
} catch (err) {
  console.log('crash:', err.message);
}

function average(numbers) {
  return numbers.reduce((sum, n) => sum + n) / numbers.length;
}
try {
  console.log(average([2, 4]), average([])); // want: 3 0
} catch (err) {
  console.log('crash:', err.message);
}

const prices = ['10', '9', '100'];
console.log(prices.sort()); // want: [ '9', '10', '100' ]
```

<details><summary>Hint</summary>

Bug 1 is about `var` in a loop. Bug 2 is about `this` after taking a method out of its object. Bug 3 is two problems: `reduce` without a start value, and dividing by zero. Bug 4 is about the default `sort`.

</details>

<details><summary>Solution</summary>

```js
// Bug 1: var shares one i. Use let so every turn gets its own i.
const handlers = [];
for (let i = 0; i < 3; i++) {
  handlers.push(() => 'handler ' + i);
}
console.log(handlers.map((h) => h()));

// Bug 2: the method lost its this. Bind it (or call timer.tick() directly).
class Timer {
  constructor() {
    this.ticks = 0;
  }
  tick() {
    this.ticks += 1;
    return this.ticks;
  }
}
const timer = new Timer();
const tick = timer.tick.bind(timer);
console.log(tick());

// Bug 3: reduce with no starting value throws on an empty array, and 0 / 0 is NaN.
function average(numbers) {
  if (numbers.length === 0) return 0;
  return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
}
console.log(average([2, 4]), average([]));

// Bug 4: the default sort compares text, and it also changes the original array.
// Compare as numbers. toSorted leaves the original alone.
const prices = ['10', '9', '100'];
console.log(prices.toSorted((a, b) => a - b));
```

```text
[ 'handler 0', 'handler 1', 'handler 2' ]
1
3 0
[ '9', '10', '100' ]
```

</details>

**Task 2 (medium): write `deepClone`.** Write `deepClone(value)` WITHOUT using `structuredClone` or JSON. It must copy nested objects and arrays, `Date`, `Map` and `Set`, keep class instances as instances of their class, and survive a circular reference (an object that contains itself).

<details><summary>Hint</summary>

Primitives and `null` can be returned as they are. For everything else, keep a `WeakMap` from "original object" to "its copy", and check it first: if you have already cloned this object, return that clone. Register the empty copy in the `WeakMap` BEFORE you copy its children; that is what stops the infinite loop. Use `Object.create(Object.getPrototypeOf(value))` to keep the class.

</details>

<details><summary>Solution</summary>

```js
function deepClone(value, seen = new WeakMap()) {
  // Primitives and functions are returned as they are.
  if (typeof value !== 'object' || value === null) return value;

  // Already cloned this object? Return the clone. This also stops circular loops.
  if (seen.has(value)) return seen.get(value);

  if (value instanceof Date) return new Date(value.getTime());

  if (value instanceof Map) {
    const copy = new Map();
    seen.set(value, copy);
    for (const [k, v] of value) copy.set(deepClone(k, seen), deepClone(v, seen));
    return copy;
  }

  if (value instanceof Set) {
    const copy = new Set();
    seen.set(value, copy);
    for (const item of value) copy.add(deepClone(item, seen));
    return copy;
  }

  // Arrays and plain objects (keep the same prototype so class instances stay instances).
  const copy = Array.isArray(value) ? [] : Object.create(Object.getPrototypeOf(value));
  seen.set(value, copy);
  for (const key of Object.keys(value)) {
    copy[key] = deepClone(value[key], seen);
  }
  return copy;
}

// Try it
class Point {
  constructor(x) {
    this.x = x;
  }
  double() {
    return this.x * 2;
  }
}
const original = {
  name: 'demo',
  list: [1, { deep: true }],
  when: new Date(0),
  tags: new Set(['a']),
  table: new Map([['k', { v: 1 }]]),
  point: new Point(21),
};
original.self = original; // a circular reference

const copy = deepClone(original);
console.log(copy !== original, copy.list !== original.list, copy.list[1] !== original.list[1]);
console.log(copy.when instanceof Date, copy.when !== original.when, copy.tags instanceof Set);
console.log(copy.table.get('k') !== original.table.get('k'), copy.point instanceof Point, copy.point.double());
console.log(copy.self === copy);
```

```text
true true true
true true true
true true 42
true
```

This ignores symbol keys, non-enumerable properties and getters. A production version (or `structuredClone`) decides what to do about those.

</details>

**Task 3 (harder): build an iterable `Queue`.** Write a class `Queue` with: a private field `#items`; `enqueue(item)` that returns `this` so calls can be chained; `dequeue()` that removes and returns the first item (or `undefined` when empty); a getter `size`; a static method `Queue.from(iterable)`; and make the queue iterable (first to last, without removing anything) so that spread, destructuring and `Math.max(...queue)` work.

<details><summary>Hint</summary>

Private fields start with `#` and must be declared in the class body. A generator method written as `*[Symbol.iterator]() { ... }` makes the instance iterable. Inside it you can write `yield* this.#items`.

</details>

<details><summary>Solution</summary>

```js
class Queue {
  #items = []; // private: code outside the class cannot touch it

  static from(iterable) {
    const queue = new Queue();
    for (const item of iterable) queue.enqueue(item);
    return queue;
  }

  enqueue(item) {
    this.#items.push(item);
    return this; // returning this allows chaining
  }

  dequeue() {
    return this.#items.shift(); // undefined when the queue is empty
  }

  get size() {
    return this.#items.length;
  }

  *[Symbol.iterator]() {
    yield* this.#items; // walks first to last and removes nothing
  }
}

const queue = Queue.from(['a', 'b']).enqueue('c');
console.log(queue.size, [...queue]);
console.log(queue.dequeue(), queue.size, [...queue]);
console.log(queue.items, JSON.stringify(queue));

// Lazy use of the iterator with the built in iterator helpers (Node 24).
const firstTwo = Iterator.from(Queue.from([1, 2, 3, 4])).take(2).toArray();
console.log(firstTwo);
console.log(new Queue().dequeue());
const [head, ...rest] = Queue.from('xyz');
console.log(head, rest, Math.max(...Queue.from([3, 9, 4])));
```

```text
3 [ 'a', 'b', 'c' ]
a 2 [ 'b', 'c' ]
undefined {}
[ 1, 2 ]
undefined
x [ 'y', 'z' ] 9
```

`shift()` has to move every remaining item, so it is slow for very large queues. A production queue keeps a head index or uses a linked list; that makes a good follow-up discussion in an interview.

</details>

## Where to go next
- Next lesson: [03. Modules: CommonJS and ES Modules](../03-modules/README.md). It explains what `module.exports` is, which you met in section 3.
- Practise this topic in the interview rounds: [Round 1 screening questions](../../rounds/round-1-screening/questions.md) and [Round 2 core questions](../../rounds/round-2-core/questions.md). The coding round ([Round 3](../../rounds/round-3-coding/questions.md)) has challenges like the ones in "Try it yourself".
- Topics that this lesson only starts: [07. Async JavaScript](../07-async-javascript/README.md) (promises and `async/await`), [08. The event loop](../08-event-loop/README.md) (why quiz question 10 prints in that order) and [14. Error handling and debugging](../14-error-handling-and-debugging/README.md) (the full story after section 14).
- Before you move on, re-run the quiz in section 15 without looking at the answers. Aim to explain each result with a rule, not a guess.
