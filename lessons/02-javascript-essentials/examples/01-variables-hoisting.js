// var, let, const, hoisting and the temporal dead zone (TDZ)
// Run: node lessons/02-javascript-essentials/examples/01-variables-hoisting.js

// 1. var is hoisted: the DECLARATION moves to the top, the VALUE does not.
console.log('1a.', hoistedVar);
var hoistedVar = 'now set';
console.log('1b.', hoistedVar);

// 2. var is function scoped. An if block does not contain it.
function varLeaks() {
  if (true) {
    var inner = 'I escaped the if block';
  }
  return inner;
}
console.log('2. ', varLeaks());

// 3. let and const are block scoped.
{
  let blockLet = 1;
  const blockConst = 2;
  console.log('3a.', blockLet, blockConst);
}
console.log('3b.', typeof blockLet, typeof blockConst);

// 4. Temporal dead zone: let and const exist from the top of the block,
//    but touching them before the declaration line throws.
try {
  console.log(tdz);
  let tdz = 'too late';
} catch (err) {
  console.log('4a.', err.name + ':', err.message);
}

// typeof is NOT safe inside the TDZ (it is safe for names that never exist).
try {
  console.log('4b. typeof a name that never exists:', typeof neverDeclared);
  console.log(typeof alsoTdz);
  let alsoTdz = 1;
} catch (err) {
  console.log('4c.', err.name + ':', err.message);
}

// 5. const stops re-assignment, not mutation.
const list = [1, 2];
list.push(3);
console.log('5a.', list);
try {
  list = [];
} catch (err) {
  console.log('5b.', err.name + ':', err.message);
}

// 6. Function declarations are hoisted completely. Function expressions are not.
console.log('6a.', declared());
function declared() {
  return 'a declaration works before its line';
}

try {
  expressed();
} catch (err) {
  console.log('6b.', err.name + ':', err.message);
}
var expressed = function () {
  return 'never reached';
};

// 7. Assigning to an undeclared name. Sloppy mode creates a global. Strict mode throws.
function sloppyLeak() {
  accidentalGlobal = 'oops';
}
sloppyLeak();
console.log('7a.', globalThis.accidentalGlobal);
delete globalThis.accidentalGlobal;

function strictLeak() {
  'use strict';
  strictGlobal = 'oops';
}
try {
  strictLeak();
} catch (err) {
  console.log('7b.', err.name + ':', err.message);
}

// 8. Node detail: a top level var in a file is local to that file (the module),
//    it does NOT become a property of globalThis like it does in a browser script.
var topLevel = 'module scope';
console.log('8. ', globalThis.topLevel, '|', topLevel);
