// Reading a package.json in 30 seconds: who is it, how do I run it, what does it need?
// Run: node lessons/04-npm-and-package-json/examples/01-read-package-json.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const file = path.join(__dirname, '_fixtures', 'sample-package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));

// 1. Identity: the name + version pair is what the registry stores.
console.log(`Package : ${pkg.name}@${pkg.version}${pkg.private ? '  (private: npm refuses to publish it)' : ''}`);

// 2. How is it loaded? "type" decides what a .js file means. "exports" beats "main".
console.log(`Module  : .js files are ${pkg.type === 'module' ? 'ES modules' : 'CommonJS'}`);
console.log(`Entry   : ${pkg.exports ? 'exports map (main is only a fallback for old tools)' : 'main = ' + (pkg.main || 'index.js')}`);
if (pkg.bin) console.log(`Commands: ${Object.keys(pkg.bin).join(', ')} (installed into node_modules/.bin)`);

// 3. How do I run it? Scripts are the project's own "buttons".
console.log('\nScripts:');
for (const [name, command] of Object.entries(pkg.scripts || {})) {
  console.log(`  npm run ${name.padEnd(8)} -> ${command}`);
}

// 4. What does it need? Four different kinds of dependency.
const kinds = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
console.log('\nDependencies:');
for (const kind of kinds) {
  const entries = Object.entries(pkg[kind] || {});
  const list = entries.map(([n, range]) => `${n}@${range}`).join(', ');
  console.log(`  ${kind.padEnd(20)} (${entries.length}) ${list}`);
}

// 5. Which kind of range is each one? The first character tells you.
console.log('\nRange style of "dependencies":');
for (const [name, range] of Object.entries(pkg.dependencies)) {
  const style = range.startsWith('^') ? 'caret (minor + patch updates allowed)'
    : range.startsWith('~') ? 'tilde (patch updates only)'
      : 'exact (pinned, never moves)';
  console.log(`  ${name.padEnd(8)} ${range.padEnd(8)} ${style}`);
}

// 6. Where can it run? "engines" is advisory unless engine-strict is on.
const required = pkg.engines && pkg.engines.node;
console.log(`\nNeeds Node ${required}. You are running ${process.version}.`);

// 7. Is it a monorepo root, and is something forced on the tree?
if (pkg.workspaces) console.log(`Workspaces: ${pkg.workspaces.join(', ')}`);
if (pkg.overrides) console.log(`Overrides : ${JSON.stringify(pkg.overrides)} (forces versions inside the tree)`);
if (pkg.files) console.log(`Published files: ${pkg.files.join(', ')} (+ package.json, README, LICENSE)`);
