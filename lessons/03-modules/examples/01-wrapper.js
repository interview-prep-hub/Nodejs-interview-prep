// The CommonJS module wrapper: what require, module, exports, __filename and __dirname really are
// Run: node lessons/03-modules/examples/01-wrapper.js

const path = require('node:path');
const Module = require('node:module');

// 1. Five names exist in every CommonJS file, but they are NOT globals.
console.log('arguments.length:', arguments.length);
console.log('types:', typeof exports, typeof require, typeof module, typeof __filename, typeof __dirname);
console.log('are they globals?', 'require' in globalThis, 'module' in globalThis, '__dirname' in globalThis);

// 2. They are the five parameters of a function. Node wraps your whole file in it.
console.log(Module.wrap('/* your code */'));

// 3. __filename is the absolute path of this file, __dirname is its folder.
console.log('basename(__filename):', path.basename(__filename));
console.log('basename(__dirname): ', path.basename(__dirname));

// 4. exports and module.exports start as the SAME object, and so does `this`.
console.log('exports === module.exports:', exports === module.exports);
console.log('this === module.exports:   ', this === module.exports);

// 5. Who started the program? require.main is the entry module.
console.log('require.main === module:', require.main === module);
console.log('module.id:', module.id);
console.log('module.loaded now:', module.loaded);
setImmediate(() => console.log('module.loaded later:', module.loaded));

// 6. CommonJS runs in sloppy mode: a plain function gets `this === globalThis`.
function plain() {
  return this === globalThis;
}
console.log('sloppy mode (this is globalThis in a plain function):', plain());

// 7. Proof that the file is a function body: a top-level return is legal here.
if (arguments.length === 5) {
  console.log('returning from the top level of a file');
  return;
}
console.log('this line is never printed');
