// package.json and modules: "type", file extensions, syntax detection, "exports", "imports", conditions
// Run: node lessons/03-modules/examples/10-package-json.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const { writeTree } = require('./_lib/tree.js');

// Every demo file prints which system loaded it. `require` only exists in CommonJS.
const WHO = "console.log(typeof require === 'function' ? 'CommonJS' : 'ES module');";
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'package-json-'));
// Clean up even if something below throws. (Part 1 assumes no package.json exists above os.tmpdir().)
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));

writeTree(root, {
  // Part 1: how does Node pick CommonJS or ES module for a file?
  'decide/ext/file.mjs': WHO,
  'decide/ext/file.cjs': WHO,
  'decide/type-module/package.json': '{ "type": "module" }',
  'decide/type-module/file.js': WHO,
  'decide/type-commonjs/package.json': '{ "type": "commonjs" }',
  'decide/type-commonjs/file.js': WHO,
  'decide/type-commonjs/esm-syntax.js': `export {}; ${WHO}`,
  'decide/no-package-json/file.js': WHO,
  'decide/no-package-json/esm-syntax.js': `export {}; ${WHO}`,
  'decide/typeless-package/package.json': '{ "name": "typeless" }',
  'decide/typeless-package/esm-syntax.js': `export {}; ${WHO}`,

  // Part 2: an app with "imports", and three packages inside its node_modules.
  'app/package.json': JSON.stringify({
    name: 'app',
    imports: { '#config': './src/config.js', '#utils/*': './src/utils/*.js' },
  }),
  'app/src/config.js': "module.exports = { mode: 'test' };",
  'app/src/utils/shout.js': 'module.exports = (text) => text.toUpperCase();',
  'app/probe.mjs': `
    import * as dual from 'dual';
    import * as syncDual from 'sync-dual';
    export { dual, syncDual };
  `,

  // "dual" has an ES build and a CommonJS build, chosen by condition.
  'app/node_modules/dual/package.json': JSON.stringify({
    name: 'dual',
    exports: {
      '.': { import: './esm/index.mjs', require: './cjs/index.cjs', default: './cjs/index.cjs' },
      './feature': './lib/feature.js',
      './package.json': './package.json',
    },
  }),
  'app/node_modules/dual/esm/index.mjs': "let n = 0; export const kind = 'ES build'; export const next = () => ++n;",
  'app/node_modules/dual/cjs/index.cjs': "let n = 0; exports.kind = 'CommonJS build'; exports.next = () => ++n;",
  'app/node_modules/dual/lib/feature.js': "module.exports = 'public feature';",
  'app/node_modules/dual/lib/internal.js': "module.exports = 'private file';",

  // "sync-dual" ships only one ES build and lets require() use it too ("module-sync").
  'app/node_modules/sync-dual/package.json': JSON.stringify({
    name: 'sync-dual',
    exports: { 'module-sync': './index.mjs', default: './index.cjs' },
  }),
  'app/node_modules/sync-dual/index.mjs': "let n = 0; export const kind = 'ES build'; export const next = () => ++n;",
  'app/node_modules/sync-dual/index.cjs': "exports.kind = 'CommonJS fallback';",

  // "legacy" has no "exports" field: "main" is the entry and every file is reachable.
  'app/node_modules/legacy/package.json': '{ "name": "legacy", "main": "main.js" }',
  'app/node_modules/legacy/main.js': "module.exports = 'legacy main';",
  'app/node_modules/legacy/secret.js': "module.exports = 'legacy secret';",
});

console.log('--- 1. which system loads each file? (each file is run with a fresh node process)');
function decide(label, relativeFile) {
  const result = spawnSync(process.execPath, [path.join(root, 'decide', relativeFile)], { encoding: 'utf8' });
  const syntaxError = /SyntaxError: [^\r\n]*/.exec(result.stderr);
  const outcome = result.status === 0 ? result.stdout.trim() : syntaxError ? syntaxError[0] : `exit ${result.status}`;
  const warned = result.stderr.includes('MODULE_TYPELESS_PACKAGE_JSON') ? ' (+ warning: set "type" in package.json)' : '';
  console.log(label.padEnd(52), '->', outcome + warned);
}
decide('file.mjs', 'ext/file.mjs');
decide('file.cjs', 'ext/file.cjs');
decide('file.js, package.json type "module"', 'type-module/file.js');
decide('file.js, package.json type "commonjs"', 'type-commonjs/file.js');
decide('file.js, no package.json at all', 'no-package-json/file.js');
decide('import/export syntax, no package.json', 'no-package-json/esm-syntax.js');
decide('import/export syntax, package.json without type', 'typeless-package/esm-syntax.js');
decide('import/export syntax, type "commonjs"', 'type-commonjs/esm-syntax.js');

console.log('--- 2. "exports": conditions and encapsulation');
const requireFromApp = createRequire(path.join(root, 'app', 'index.js'));
const asCommonJs = requireFromApp('dual');
console.log('require("dual") ->', asCommonJs.kind);
console.log('require("dual/feature") ->', requireFromApp('dual/feature'));
console.log('require("dual/package.json").name ->', requireFromApp('dual/package.json').name);
try {
  requireFromApp('dual/lib/internal.js');
} catch (error) {
  console.log('require("dual/lib/internal.js") ->', error.code);
}
console.log('no "exports" field, deep file allowed ->', requireFromApp('legacy/secret.js'));

console.log('--- 3. "imports": private aliases that start with #');
console.log('require("#config") ->', requireFromApp('#config'));
console.log('require("#utils/shout")("hi") ->', requireFromApp('#utils/shout')('hi'));

(async () => {
  console.log('--- 4. the dual package hazard');
  const probe = await import(pathToFileURL(path.join(root, 'app', 'probe.mjs')).href);
  console.log('import "dual"  ->', probe.dual.kind);
  console.log('require "dual" ->', asCommonJs.kind);
  console.log('next() through import:', probe.dual.next(), '| next() through require:', asCommonJs.next(), '(two separate counters)');

  console.log('--- 5. "module-sync": one ES build for both');
  const viaRequire = requireFromApp('sync-dual');
  console.log('require("sync-dual") ->', viaRequire.kind);
  console.log('same module for import and require?', viaRequire === probe.syncDual);
  console.log('next() through import:', probe.syncDual.next(), '| next() through require:', viaRequire.next(), '(one shared counter)');

  fs.rmSync(root, { recursive: true, force: true });
})();
