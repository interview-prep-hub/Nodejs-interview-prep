// Module caching: a module runs once, every require() gets the same object
// Run: node lessons/03-modules/examples/03-cache.js

const path = require('node:path');

console.log('--- 1. require the same file twice');
const first = require('./_lib/loud-counter.js');
const second = require('./_lib/loud-counter.js');
console.log('same object?', first === second);

console.log('--- 2. another module requires it too: shared state');
const bumpTwice = require('./_lib/uses-loud-counter.js');
console.log('bumpTwice() returned', bumpTwice());
console.log('first.get() sees', first.get());

console.log('--- 3. look inside require.cache');
const names = Object.keys(require.cache).map((file) => path.basename(file));
console.log('cached files:', names);
const key = require.resolve('./_lib/loud-counter.js');
console.log('key is an absolute path?', path.isAbsolute(key));
console.log('cache entry holds the same exports?', require.cache[key].exports === first);
console.log('cache entry loaded flag:', require.cache[key].loaded);

console.log('--- 4. delete the cache entry, then require again');
delete require.cache[key];
const fresh = require('./_lib/loud-counter.js');
console.log('same object as before?', fresh === first);
console.log('fresh.get() starts again at', fresh.get(), 'but the old one still says', first.get());
