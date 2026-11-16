// How require() finds a file: core modules, relative paths, node_modules lookup, extensions, index.js, "main"
// Run: node lessons/03-modules/examples/04-resolution.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { writeTree } = require('./_lib/tree.js');

// Build a small project in a temp folder. The object keys ARE the folder layout.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'resolution-'));
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true })); // clean up even on errors
writeTree(root, {
  // The file that does the requiring. It lives 2 folders deep.
  'app/src/deep/start.js': `
    const here = (id) => require.resolve(id);
    module.exports = {
      'core "fs"':            () => here('fs'),
      'relative "./util"':    () => here('./util'),
      'relative "./config"':  () => here('./config'),
      'relative "./data"':    () => here('./data'),
      'folder "../tools"':    () => here('../tools'),
      'package "greeter"':    () => here('greeter'),
      'package "shared"':     () => here('shared'),
      'missing "./nope"':     () => here('./nope'),
      'missing "ghost-pkg"':  () => here('ghost-pkg'),
    };
    module.exports.lookupFolders = module.paths;
  `,
  'app/src/deep/util.js': 'module.exports = 1;',
  'app/src/deep/config.js': 'module.exports = "js wins";',
  'app/src/deep/config.json': '{ "from": "json" }',
  'app/src/deep/data.json': '{ "a": 1 }',
  'app/src/tools/index.js': 'module.exports = "tools index";',
  // A package with a "main" field (closest node_modules).
  'app/node_modules/greeter/package.json': '{ "name": "greeter", "main": "lib/main.js" }',
  'app/node_modules/greeter/lib/main.js': 'module.exports = "inner greeter";',
  // Same package name, farther away: it is never reached.
  'node_modules/greeter/index.js': 'module.exports = "outer greeter";',
  // Only exists in the outer node_modules: found by walking up.
  'node_modules/shared/index.js': 'module.exports = "shared";',
  // A package that tries to shadow a core module. The core module still wins.
  'node_modules/fs/index.js': 'module.exports = "fake fs";',
});

const show = (absolute) => path.relative(root, absolute).split(path.sep).join('/');
const attempts = require(path.join(root, 'app/src/deep/start.js'));

console.log('--- resolve results (paths are relative to the temp project)');
for (const [label, run] of Object.entries(attempts)) {
  if (typeof run !== 'function') continue;
  try {
    const found = run();
    console.log(label.padEnd(22), '->', path.isAbsolute(found) ? show(found) : found);
  } catch (error) {
    console.log(label.padEnd(22), '->', error.code);
  }
}

console.log('--- folders searched for a package name, in order');
for (const folder of attempts.lookupFolders.filter((f) => f.startsWith(root))) {
  console.log(' ', show(folder));
}

console.log('--- the node: prefix');
const { isBuiltin } = require('node:module');
console.log('isBuiltin("fs"):', isBuiltin('fs'), '| isBuiltin("node:fs"):', isBuiltin('node:fs'));
console.log('require("node:fs") === require("fs"):', require('node:fs') === require('fs'));
try {
  require('test');
} catch (error) {
  console.log('require("test"):', error.code);
}
console.log('require("node:test") is a', typeof require('node:test'));
try {
  require('node:nope');
} catch (error) {
  console.log('require("node:nope"):', error.code);
}

fs.rmSync(root, { recursive: true, force: true });
