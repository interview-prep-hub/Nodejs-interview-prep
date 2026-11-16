// Top-level await and dynamic import(): loading modules later, on demand, and the URL cache key
// Run: node lessons/03-modules/examples/08-await-and-dynamic-import.mjs

// slow-config.mjs uses top-level await (it waits 50 ms). A static import waits for it,
// so its two log lines appear BEFORE the first line of this file.
import { config } from './_lib/slow-config.mjs';

console.log('1. main: start, config =', config);

// Top-level await also works in this file: no async function needed.
const answer = await Promise.resolve(42);
console.log('2. main: awaited at the top level ->', answer);

// Dynamic import() is a function-like expression that returns a promise.
// The module code does not run until you call it, so it can be lazy or conditional.
console.log('3. main: about to import shapes.mjs lazily');
const shapes = await import('./_lib/shapes.mjs');
console.log('4. main: area of square 3 =', shapes.squareArea(3), '| default export:', shapes.default('square'));

// The specifier itself can be computed at run time (a static import cannot do this).
// This is how you pick a plugin, a language file or a command by name.
const which = ['circle', 'square'][1];
const picked = await import(`./_patterns/shapes/${which}.mjs`);
console.log('5. computed specifier ->', `${which}Area(2) =`, picked[`${which}Area`](2));

// A second import() of the same module is cached: same namespace object, no second run.
const again = await import('./_lib/shapes.mjs');
console.log('6. same namespace object the second time:', again === shapes);

// import() also loads CommonJS. The namespace has `default` (= module.exports) and detected names.
const legacy = await import('./_lib/literal-exports.js');
console.log('7. CommonJS through import():', legacy.default);

// JSON through import() needs the attribute in the second argument.
const json = await import('./_lib/data.json', { with: { type: 'json' } });
console.log('8. JSON through import():', json.default.name);

// Errors are normal rejected promises, so try/catch works.
try {
  await import('./_lib/does-not-exist.mjs');
} catch (error) {
  console.log('9. missing file ->', error.code);
}
try {
  await import('./_lib/shapes'); // ES modules need the file extension
} catch (error) {
  console.log('10. no extension ->', error.code);
}

// The cache key is the full URL, so a different query string gives a second, separate copy.
// This is the usual trick for "reloading" an ES module. Node cannot unload an ES module, so every old copy stays in memory.
const first = await import('./_lib/esm-counter.mjs');
first.increment();
const copy = await import('./_lib/esm-counter.mjs?copy=2');
console.log('11. query string makes a new copy ->', copy !== first, '| counts:', first.count, copy.count);

// A folder is not resolved to its index file. (CommonJS require does that, ES modules do not.)
try {
  await import('./_patterns/shapes');
} catch (error) {
  console.log('12. folder import ->', error.code);
}
