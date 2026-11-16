// ES module basics: default and named exports, namespace import, hoisting, import.meta, what is missing
// Run: node lessons/03-modules/examples/06-esm-basics.mjs

import path from 'node:path';
import { createRequire } from 'node:module';
import describe, { PI, circleArea as area } from './_lib/shapes.mjs';
import * as shapes from './_lib/shapes.mjs';
import data from './_lib/data.json' with { type: 'json' };

console.log('1. first line of this file. The imports above already ran shapes.mjs.');

// A default import has no braces and any name you like. Named imports use braces,
// and `as` renames them.
console.log('2.', describe('circle'), '| PI =', PI, '| area(2) =', area(2));

// A namespace import collects every export into one read-only object.
console.log('3. namespace keys:', Object.keys(shapes));
console.log('   shapes.default === describe:', shapes.default === describe);

// import must be at the top level and its path must be a plain string (static structure).
const notAtTopLevel = 'if (true) { import os from "node:os"; }';
try {
  await import('data:text/javascript,' + encodeURIComponent(notAtTopLevel));
} catch (error) {
  console.log('4. import inside a block ->', error.name);
}

// import.meta replaces several CommonJS values.
console.log('5. import.meta keys:', Object.keys(import.meta));
console.log('   basename(import.meta.filename):', path.basename(import.meta.filename));
console.log('   basename(import.meta.dirname): ', path.basename(import.meta.dirname));
console.log('   url is a file: URL:', import.meta.url.startsWith('file:///'));
console.log('   import.meta.main:', import.meta.main);

// What does not exist in an ES module.
console.log('6. typeof __filename, __dirname, require, module, exports:',
  typeof __filename, typeof __dirname, typeof require, typeof module, typeof exports);
console.log('   this at the top level:', this);
try {
  undeclared = 1; // sloppy mode would create a global; ES modules are always strict
} catch (error) {
  console.log('   strict mode ->', error.name);
}

// Need require() inside an ES module? Build one.
const cjsRequire = createRequire(import.meta.url);
console.log('7. createRequire:', cjsRequire('./_lib/literal-exports.js'));

// JSON needs the attribute `with { type: 'json' }`. The default export is the parsed value.
console.log('8. JSON import:', data);
