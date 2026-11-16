// require(esm) and syntax detection: two changes that make CommonJS and ES modules live together.
// Shows: require() of an .mjs file, the "module.exports" export name, the top-level await limit,
// and a typeless .js file that uses import.
// Run: node lessons/22-modern-node-features/examples/09-require-esm.js

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const helpers = path.join(__dirname, '_helpers');

console.log('1. require() can load an ES module (Node 22.12+, 20.19+, 24; no flag, no warning)');
const greeting = require('./_helpers/greeting.mjs');
console.log('  you get the module namespace object. Keys:', Object.keys(greeting).sort().join(', '));
console.log('  named export works:', greeting.add(2, 3), '| language:', greeting.language);
console.log('  the default export is on .default:', greeting.default('Sam'));
console.log('  process.features.require_module:', process.features.require_module);

console.log('2. An ES module can choose what require() returns, with the export name "module.exports"');
const custom = require('./_helpers/custom-exports.mjs');
console.log('  require() returned:', custom.kind, '| add(2, 3) =', custom.add(2, 3));
console.log('  the named export is not on it:', custom.lostForRequire);

console.log('3. The one limit: top-level await');
try {
  require('./_helpers/uses-await.mjs');
} catch (err) {
  console.log('  require() throws', err.code);
}
// import() works for any ES module, because it returns a promise.
import('./_helpers/uses-await.mjs').then((ns) => {
  console.log('  import() of the same file works, ready =', ns.ready);
  later();
});

// Run a small node program and return its output lines (stdout and stderr together).
function node(args, cwd) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  return `${result.stderr}${result.stdout}`.split(/\r?\n/).filter(Boolean);
}

function later() {
  console.log('4. The old behaviour is still available as a switch');
  const old = node(['--no-experimental-require-module', '-e', "try { require('./greeting.mjs') } catch (e) { console.log(e.code) }"], helpers);
  console.log('  with --no-experimental-require-module, require() throws', old[0]);

  console.log('5. Syntax detection: a .js file with import and no "type" runs as an ES module');
  // Copy the two files to two temp folders. The first has no package.json (this assumes that no package.json
  // exists in a parent folder of your OS temp folder). The second has a package.json without a "type" field.
  const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-detect-'));
  const typeless = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-typeless-'));
  try {
    for (const folder of [clean, typeless]) {
      for (const name of ['greeting.mjs', 'detected.js']) fs.copyFileSync(path.join(helpers, name), path.join(folder, name));
    }
    fs.writeFileSync(path.join(typeless, 'package.json'), JSON.stringify({ name: 'typeless-demo' }));

    console.log('  in a folder with no package.json:');
    for (const line of node(['detected.js'], clean)) console.log(`    ${line.trim()}`);

    console.log('  in a folder with a package.json that has no "type" field:');
    for (const line of node(['detected.js'], typeless)) {
      if (line.includes('MODULE_TYPELESS_PACKAGE_JSON')) console.log('    warning code: MODULE_TYPELESS_PACKAGE_JSON (Node says: add "type" to package.json)');
      else if (line.startsWith('  this')) console.log(`    ${line.trim()}`);
    }

    console.log('  with detection switched off:');
    const off = node(['--no-experimental-detect-module', 'detected.js'], clean);
    console.log('   ', off.find((line) => line.includes('SyntaxError')));
  } finally {
    fs.rmSync(clean, { recursive: true, force: true });
    fs.rmSync(typeless, { recursive: true, force: true });
  }
}
