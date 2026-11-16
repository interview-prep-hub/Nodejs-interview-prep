// Loads the compiled addon from _native/addon.node or _native/build/Release/addon.node and calls it.
// Run: node lessons/23-node-internals/examples/_native/try-addon.js   (after building, see the README)
// Helper file: the name starts with "_", so scripts/check-examples.js does not run it.

const fs = require('node:fs');
const path = require('node:path');

const candidates = [path.join(__dirname, 'build', 'Release', 'addon.node'), path.join(__dirname, 'addon.node')];
const file = candidates.find((f) => fs.existsSync(f));
if (!file) {
  console.log('No compiled addon found. Build addon.c first (see section 14 of the lesson). Looked in:');
  for (const f of candidates) console.log('  ' + f.split(path.sep).join('/'));
  process.exit(0);
}

const addon = require(file); // for a .node file, require() calls process.dlopen under the hood
console.log('loaded         :', path.basename(file));
console.log('exports        :', Object.keys(addon));
console.log('add(2, 3)      :', addon.add(2, 3));
console.log('this Node runs Node-API version', process.versions.napi, 'and NODE_MODULE_VERSION', process.versions.modules);
