// dependencies vs devDependencies vs peerDependencies vs optionalDependencies, plus engines and overrides
// Run: node lessons/04-npm-and-package-json/examples/09-dependency-kinds.js
// Real npm against a pretend registry on localhost (no internet). Takes several seconds.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createNpm, guard, removeTemp } = require('./_npm.js');
const { startRegistry } = require('./_local-registry.js');
const { registry, app, extras } = require('./_demo-packages.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-kinds-'));

function makeProject(name, fields) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', private: true, ...fields }, null, 2));
  return dir;
}

// Folders npm created in node_modules (top level only).
const installed = (dir) => {
  const modules = path.join(dir, 'node_modules');
  if (!fs.existsSync(modules)) return '(no node_modules folder)';
  return fs.readdirSync(modules).filter((n) => !n.startsWith('.')).join(', ') || '(empty)';
};

async function main() {
  const reg = await startRegistry({ ...registry, ...extras });
  try {
    const npm = createNpm(path.join(tmp, 'sandbox'), reg.url);
    if (!npm) return console.log('Could not find the npm that ships with this node. Skipping.');

    // "show" picks the npm messages worth reading out of the noise.
    const cases = [
      { title: 'devDependencies are skipped with --omit=dev (what you want on a production server)',
        dir: makeProject('omit-dev', { dependencies: app.dependencies, devDependencies: app.devDependencies }), args: ['install', '--omit=dev'] },
      { title: 'peerDependencies: demo-plugin needs demo-ui 2.x but the project uses 1.x',
        dir: makeProject('peer-conflict', { dependencies: { 'demo-ui': '^1.2.0', 'demo-plugin': '^1.0.0' } }), args: ['install'],
        show: /ERESOLVE unable|Found:|Could not resolve|^npm error peer |Fix the upstream/i },
      { title: 'peerDependencies: only the plugin is listed, and npm 7+ installs the host for you',
        dir: makeProject('peer-auto', { dependencies: { 'demo-plugin': '^1.0.0' } }), args: ['install'] },
      { title: 'optionalDependencies: demo-fancy fails to install, and npm carries on without it',
        dir: makeProject('optional-fail', { optionalDependencies: { 'demo-fancy': '^1.0.0' } }), args: ['install'] },
      { title: 'engines: demo-future wants Node >=99. By default that is only a warning',
        dir: makeProject('engines-warn', { dependencies: { 'demo-future': '^1.0.0' } }), args: ['install'],
        show: /package:|required:/ },
      { title: '...with --engine-strict the install is refused',
        dir: makeProject('engines-strict', { dependencies: { 'demo-future': '^1.0.0' } }), args: ['install', '--engine-strict'],
        show: /^npm error code|Not compatible|Required:/ },
      { title: 'overrides: force demo-utils 2.0.0 everywhere, even where demo-ui asks for ^1.0.0',
        dir: makeProject('overrides', { dependencies: app.dependencies, overrides: { 'demo-utils': '2.0.0' } }), args: ['install'] },
    ];

    const results = await Promise.all(cases.map((c) => npm(c.args, c.dir)));

    results.forEach((r, i) => {
      const c = cases[i];
      console.log(`\n${c.title}`);
      console.log(`  $ npm ${c.args.join(' ')}   (exit code ${r.status})`);
      const messages = r.stderr.split(/\r?\n/).filter((line) => c.show && c.show.test(line));
      messages.forEach((line) => console.log('  ' + line.trim()));
      console.log(`  node_modules now holds: ${installed(c.dir)}`);
    });

    const lock = JSON.parse(fs.readFileSync(path.join(tmp, 'overrides', 'package-lock.json'), 'utf8'));
    console.log('\nLockfile paths in the "overrides" project (one demo-utils, no nested copy):');
    Object.entries(lock.packages).filter(([k]) => k).forEach(([k, v]) => console.log(`  ${k} ${v.version}`));
    console.log('\nThe optional install failed silently. In the lockfile it is still recorded:');
    const optionalLock = JSON.parse(fs.readFileSync(path.join(tmp, 'optional-fail', 'package-lock.json'), 'utf8'));
    const entry = optionalLock.packages['node_modules/demo-fancy'];
    console.log(`  demo-fancy optional: ${entry.optional}, hasInstallScript: ${entry.hasInstallScript}`);
  } finally {
    await reg.close();
  }
}

guard(main).finally(() => removeTemp(tmp));
