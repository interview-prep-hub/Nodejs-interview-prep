// How Node finds a package: the node_modules walk, phantom dependencies, and main vs exports vs type
// Run: node lessons/04-npm-and-package-json/examples/05-how-node-finds-packages.js
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-find-'));
const rel = (p) => path.relative(tmp, p).split(path.sep).join('/');

// write('app/node_modules/x/package.json', {...}) creates folders as needed.
function write(file, content) {
  const full = path.join(tmp, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
}

// A tiny package whose code reports its own name and version.
function writePackage(dir, name, version, dependencies = {}) {
  write(`${dir}/${name}/package.json`, { name, version, main: 'index.js', dependencies });
  write(`${dir}/${name}/index.js`, `exports.name = '${name}'; exports.version = '${version}';`);
  return `${dir}/${name}`;
}

// A require() function that behaves as if it lived in the given folder.
const requireFrom = (dir) => createRequire(path.join(tmp, dir, 'index.js'));
const version = (dir, name) => `${name}@${requireFrom(dir)(name).version}`;

// Run a script with a fresh node process and return its output lines.
function run(file, cwd) {
  const r = spawnSync(process.execPath, [file], { cwd: path.join(tmp, cwd), encoding: 'utf8' });
  return (r.stdout + r.stderr).split(/\r?\n/).filter(Boolean);
}

try {
  // The layout npm made in example 04 (a conflict: utils 1.x and utils 2.x).
  write('app/package.json', { name: 'demo-app', dependencies: { 'demo-ui': '^1.2.0', 'demo-log': '~2.0.0' } });
  const ui = writePackage('app/node_modules', 'demo-ui', '1.3.0', { 'demo-utils': '^1.0.0' });
  const log = writePackage('app/node_modules', 'demo-log', '2.0.1', { 'demo-utils': '^2.0.0' });
  writePackage('app/node_modules', 'demo-utils', '2.1.0'); // hoisted: the copy demo-log needs
  writePackage(`${ui}/node_modules`, 'demo-utils', '1.4.0'); // nested: the copy demo-ui needs

  console.log('1. Where does require("demo-ui") look when called from app/ ? (only folders inside our temp dir)');
  requireFrom('app').resolve.paths('demo-ui').filter((p) => p.startsWith(tmp))
    .forEach((p, i) => console.log(`   ${i + 1}. <temp dir>/${rel(p)}`));
  console.log('   ...then the node_modules of every parent folder, up to the drive root.');

  console.log('\n2. The nearest node_modules wins:');
  console.log('   from app/                      ->', version('app', 'demo-utils'));
  console.log('   from app/node_modules/demo-ui  ->', version(ui, 'demo-utils'), '(its own nested copy)');
  console.log('   from app/node_modules/demo-log ->', version(log, 'demo-utils'), '(the hoisted copy)');

  console.log('\n3. Phantom dependency: app never listed demo-utils, yet this works:');
  console.log('   require("demo-utils") in app/ ->', version('app', 'demo-utils'));

  console.log('\n4. Why it is dangerous: after an upgrade npm may lay the tree out differently.');
  const newLog = writePackage('after/node_modules', 'demo-log', '2.2.0', { 'demo-utils': '^2.2.0' });
  writePackage(`${newLog}/node_modules`, 'demo-utils', '2.2.0'); // now private to demo-log
  try {
    requireFrom('after')('demo-utils');
  } catch (err) {
    console.log('   require("demo-utils") in the upgraded app ->', err.code);
    console.log('   Your code only worked by accident. The fix: list demo-utils in your own dependencies.');
  }

  // Once the folder is found, package.json decides which FILE you get.
  const modern = 'entry/node_modules/demo-modern';
  write(`${modern}/package.json`, {
    name: 'demo-modern',
    version: '1.0.0',
    main: './legacy.js', // only used by old tools that do not understand "exports"
    exports: {
      '.': { import: './esm/index.mjs', require: './cjs/index.cjs' },
      './feature': './lib/feature.js',
    },
  });
  write(`${modern}/legacy.js`, "exports.kind = 'legacy main';");
  write(`${modern}/esm/index.mjs`, "export const kind = 'ESM build';");
  write(`${modern}/cjs/index.cjs`, "exports.kind = 'CommonJS build';");
  write(`${modern}/lib/feature.js`, "exports.kind = 'feature';");
  write(`${modern}/lib/secret.js`, "exports.kind = 'internal file';");
  const old = 'entry/node_modules/demo-old';
  write(`${old}/package.json`, { name: 'demo-old', version: '1.0.0', main: 'lib/main.js' });
  write(`${old}/lib/main.js`, "exports.kind = 'main file';");
  write(`${old}/lib/other.js`, "exports.kind = 'other file';");
  write('entry/check.cjs', `
const tryRequire = (id) => { try { return require(id).kind; } catch (e) { return e.code; } };
console.log('require("demo-modern")                ->', tryRequire('demo-modern'));
console.log('require("demo-modern/feature")        ->', tryRequire('demo-modern/feature'));
console.log('require("demo-modern/lib/secret.js")  ->', tryRequire('demo-modern/lib/secret.js'));
console.log('require("demo-old")                   ->', tryRequire('demo-old'));
console.log('require("demo-old/lib/other.js")      ->', tryRequire('demo-old/lib/other.js'));
`);
  write('entry/check.mjs', `
import { kind } from 'demo-modern';
console.log('import { kind } from "demo-modern"    ->', kind);
`);

  console.log('\n5. "exports" (new) versus "main" (old), seen from a CommonJS file:');
  run('check.cjs', 'entry').forEach((line) => console.log('   ' + line));
  console.log('   ...and from an ES module file:');
  run('check.mjs', 'entry').forEach((line) => console.log('   ' + line));

  // "type" decides how a plain .js file is read.
  write('as-module/package.json', { type: 'module' });
  write('as-module/index.js', 'console.log(typeof require);');
  write('as-commonjs/package.json', { type: 'commonjs' });
  write('as-commonjs/index.js', 'console.log(typeof require);');
  console.log('\n6. "type" in package.json. What is typeof require inside a .js file?');
  console.log('   "type": "commonjs" ->', run('index.js', 'as-commonjs')[0]);
  console.log('   "type": "module"   ->', run('index.js', 'as-module')[0]);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
