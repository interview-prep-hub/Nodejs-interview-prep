// Circular dependencies in CommonJS: you get the PARTIAL exports of the unfinished module
// Run: node lessons/03-modules/examples/05-circular.js
// Compare with the ES module version: node lessons/03-modules/examples/05-circular.mjs

console.log('main: start');
const a = require('./_circular/a.js');
const b = require('./_circular/b.js'); // already cached, no second run
console.log('main: a.done =', a.done, '| b.done =', b.done);

console.log('\n--- the module.exports trap');
const c = require('./_circular/c.js');
console.log('main: c =', c);
// d.js printed that c looked empty. It saw the OLD exports object, and c.js
// replaced module.exports only after d.js had finished.
