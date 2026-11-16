// exports vs module.exports, and the classic "exports = {...}" bug
// Run: node lessons/03-modules/examples/02-exports-bug.js

const addProperties = require('./_exports/add-properties.js');
const replaceObject = require('./_exports/replace-object.js');
const replaceFunction = require('./_exports/replace-function.js');
const bugReassign = require('./_exports/bug-reassign.js');
const bugMixed = require('./_exports/bug-mixed.js');

console.log('1. exports.x = ...        ->', addProperties.greet('Ada'), '| version', addProperties.version);
console.log('2. module.exports = {...} ->', replaceObject.greet('Ada'), '| version', replaceObject.version);
console.log('3. module.exports = fn    ->', replaceFunction('Ada'));

// The bug: the module "worked" (no error), but it exported an empty object.
console.log('4. exports = {...} (bug)  ->', bugReassign, '| greet is', typeof bugReassign.greet);

// Mixed styles: only what is on the final module.exports object is visible.
console.log('5. mixed styles           ->', bugMixed);

// Why it happens, in plain JavaScript (no modules involved):
//   Node does:   const module = { exports: {} };  let exports = module.exports;
//   Your code:   exports = { a: 1 };   // rebinds the local name only
//   Node does:   return module.exports;             // still the old {}
const fakeModule = { exports: {} };
let fakeExports = fakeModule.exports;
fakeExports = { a: 1 };
console.log('6. the same bug by hand   ->', fakeModule.exports, '(the new object is lost)');
