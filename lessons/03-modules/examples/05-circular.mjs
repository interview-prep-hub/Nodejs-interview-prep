// Circular dependencies in ES modules: live bindings, so no half-copied objects
// Run: node lessons/03-modules/examples/05-circular.mjs
// Compare with the CommonJS version: node lessons/03-modules/examples/05-circular.js

import * as a from './_circular/a.mjs';

console.log('main: start (all imports have already run)');
console.log('main: a.a =', a.a);
console.log('main: a.hoisted() =', a.hoisted());
