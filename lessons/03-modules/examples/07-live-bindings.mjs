// Live bindings (ESM) versus copies (CommonJS), and what an ES module sees when it imports CommonJS
// Run: node lessons/03-modules/examples/07-live-bindings.mjs

import { count, increment } from './_lib/esm-counter.mjs';
import * as counterNamespace from './_lib/esm-counter.mjs';
import cjsCounter, { count as cjsCount, increment as cjsIncrement } from './_lib/cjs-counter.js';
import * as literal from './_lib/literal-exports.js';
import literalDefault from './_lib/literal-exports.js';
import compiled from './_lib/transpiled-style.cjs';

console.log('--- 1. ES module: the import is a live view of the exporter variable');
console.log('before increment():', count);
increment();
console.log('after increment(): ', count, '| via namespace:', counterNamespace.count);

console.log('--- 2. the importer cannot assign to an import');
try {
  count = 99;
} catch (error) {
  console.log('count = 99          ->', error.name + ':', error.message);
}
try {
  counterNamespace.count = 99;
} catch (error) {
  console.log('namespace.count = 99 ->', error.name);
}

console.log('--- 3. CommonJS: the number was copied into the exports object');
cjsIncrement();
console.log('named import cjsCount:   ', cjsCount, '(stale copy)');
console.log('cjsCounter.count:        ', cjsCounter.count, '(stale copy)');
console.log('cjsCounter.getCount():   ', cjsCounter.getCount(), '(asks the module, always fresh)');

console.log('--- 4. importing CommonJS: the default import is always module.exports');
console.log('default import:', literalDefault);

console.log('--- 5. named imports from CommonJS only work when Node can detect the names');
console.log('names found in cjs-counter.js:   ', Object.keys(await import('./_lib/cjs-counter.js')));
console.log('names found in literal-exports.js:', Object.keys(literal));
try {
  await import('./_lib/named-import-fail.mjs');
} catch (error) {
  console.log('import { alpha } ->', error.name + ':', error.message.split('\n')[0]);
}

console.log('--- 6. compiled CommonJS with __esModule: Node ignores the marker');
// The default import is module.exports itself, not its "default" property.
console.log('typeof default import:', typeof compiled, '| typeof compiled.default:', typeof compiled.default);
console.log('call it:', compiled.default());
