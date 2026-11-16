// Core modules: how to load them, how to tell them apart from npm packages
// Run: node lessons/05-core-modules-tour/examples/01-core-modules.js
const { builtinModules, isBuiltin } = require('node:module');

// 1. Load a core module. The "node:" prefix says "this one ships with Node".
const path = require('node:path');
console.log('path.join exists:', typeof path.join);

// 2. With or without the prefix you get the same object.
console.log('same object:', require('fs') === require('node:fs'));

// 3. Ask Node whether a name is a core module.
for (const name of ['fs', 'node:fs', 'test', 'node:test', 'express']) {
  console.log(`isBuiltin(${JSON.stringify(name)}) =`, isBuiltin(name));
}

// 4. Some core modules only exist WITH the prefix.
//    Note: builtinModules lists these prefix-only names since Node 23.5.0 (it is in Node 24).
//    On an older Node the line below may print nothing, but the script still works.
const prefixOnly = builtinModules.filter((name) => name.startsWith('node:'));
console.log('prefix-only modules:', prefixOnly.join(', '));
try {
  require('test');
} catch (err) {
  console.log('require("test") fails with', err.code);
}

// 5. A typo in a node: name gives a different, clearer error.
try {
  require('node:nope');
} catch (err) {
  console.log('require("node:nope") fails with', err.code);
}

// 6. A core module always wins over a package with the same name in node_modules.
//    The "node:" prefix makes that obvious to the reader, so prefer it.

// 7. Globals need no require at all.
console.log(
  'globals:',
  [typeof process, typeof console, typeof setTimeout, typeof URL, typeof TextEncoder, typeof fetch].join(' ')
);

// 8. process.getBuiltinModule() loads a core module without require (handy in ES modules).
const sameAgain = process.getBuiltinModule('node:path');
console.log('getBuiltinModule gives the same object:', sameAgain === path);

// 9. How many are there? The exact number changes between Node versions.
const bare = builtinModules.filter((name) => !name.startsWith('_') && !name.startsWith('node:') && !name.includes('/'));
console.log('public modules without the prefix:', bare.length > 30);
