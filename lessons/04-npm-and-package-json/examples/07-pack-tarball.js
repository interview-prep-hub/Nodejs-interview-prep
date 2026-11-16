// What ends up in the tarball? "npm pack --dry-run" with four different setups
// Run: node lessons/04-npm-and-package-json/examples/07-pack-tarball.js
// Uses the npm that ships next to node, offline, in a throwaway folder. Nothing is published.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createNpm, guard, removeTemp } = require('./_npm.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-pack-'));

// Every scenario starts from the same project folder. Only the "what to publish" rules differ.
function makeProject(name, { files, npmignore, gitignore }) {
  const root = path.join(tmp, name);
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  write('package.json', JSON.stringify({ name: 'pack-demo', version: '1.0.0', main: 'src/index.js', ...(files && { files }) }, null, 2));
  write('src/index.js', 'module.exports = 1;\n');
  write('src/internal/debug.js', 'module.exports = 2;\n');
  write('test/index.test.js', '// tests\n');
  write('README.md', '# pack-demo\n');
  write('LICENSE', 'MIT\n');
  write('CHANGELOG.md', '# changes\n');
  write('notes.txt', 'private notes\n');
  write('.env', 'SECRET=do-not-publish\n');
  write('package-lock.json', '{}\n');
  write('node_modules/dep/index.js', 'module.exports = 3;\n');
  if (npmignore) write('.npmignore', npmignore);
  if (gitignore) write('.gitignore', gitignore);
  return root;
}

async function main() {
  const npm = createNpm(path.join(tmp, 'sandbox'));
  if (!npm) return console.log('Could not find the npm that ships with this node. Skipping.');

  const scenarios = [
    { title: 'A. "files": ["src"] in package.json (a whitelist)', setup: { files: ['src'] } },
    { title: 'B. no "files", but a .npmignore (a blacklist)', setup: { npmignore: 'test/\nnotes.txt\n.env\nsrc/internal/\n' } },
    { title: 'C. no "files", no .npmignore, only a .gitignore', setup: { gitignore: 'notes.txt\n.env\nnode_modules/\n' } },
    { title: 'D. nothing at all (the dangerous default)', setup: {} },
  ];
  const roots = scenarios.map((s, i) => makeProject(`project-${i}`, s.setup));
  const results = await Promise.all(roots.map((root) => npm(['pack', '--dry-run', '--json'], root)));

  results.forEach((r, i) => {
    const [info] = JSON.parse(r.stdout);
    console.log(`\n${scenarios[i].title}`);
    console.log(`  ${info.entryCount} files: ${info.files.map((f) => f.path).sort().join('  ')}`);
    const warning = r.stderr.split(/\r?\n/).find((line) => line.includes('gitignore'));
    if (warning) console.log('  ' + warning);
    const leaked = info.files.filter((f) => f.path === '.env' || f.path === 'notes.txt');
    if (leaked.length) console.log(`  DANGER: private files would be published: ${leaked.map((f) => f.path).join(', ')}`);
  });

  console.log('\nAlways in the tarball: package.json, README, LICENSE, the "main" file and "bin" files.');
  console.log('Never in the tarball: node_modules, package-lock.json, .git and .npmrc.');
}

guard(main).finally(() => removeTemp(tmp));
