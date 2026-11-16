// Real npm against a pretend registry on localhost: install, lockfile, ls, explain, ci (and what ci refuses)
// Run: node lessons/04-npm-and-package-json/examples/08-install-lockfile-ci.js
// Needs no internet: the registry is a tiny http server inside this script. Takes several seconds.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createNpm, guard, removeTemp } = require('./_npm.js');
const { startRegistry } = require('./_local-registry.js');
const { registry, app } = require('./_demo-packages.js');
const { install, toPaths } = require('./04-resolve-and-hoist.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-install-'));
const project = path.join(tmp, 'demo-app');

// Hide machine-specific bits so the output is the same everywhere.
const clean = (text, reg) => text
  .split(reg.url.slice(0, -1)).join('<registry>')
  .split(project).join('<project>')
  .split(fs.realpathSync(project)).join('<project>') // macOS shows /private/var/... for /var/...
  .replace(/ in \d+m?s\b/g, '')
  .replace(/\r?\n[^\n]*complete log of this run[^\n]*/g, '');

const section = (title, text) => console.log(`\n$ ${title}\n${text}`);

async function main() {
  const reg = await startRegistry(registry);
  try {
    const npm = createNpm(path.join(tmp, 'sandbox'), reg.url);
    if (!npm) return console.log('Could not find the npm that ships with this node. Skipping.');

    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify(app, null, 2));

    // 1. npm install: read package.json, ask the registry, download, build node_modules, write the lockfile.
    const installed = await npm(['install'], project);
    section('npm install', clean(installed.stdout, reg));

    // 2. The lockfile records every exact version, the download URL and a hash of the tarball.
    const lock = JSON.parse(fs.readFileSync(path.join(project, 'package-lock.json'), 'utf8'));
    console.log(`\npackage-lock.json (lockfileVersion ${lock.lockfileVersion}) has these package entries:`);
    for (const [where, info] of Object.entries(lock.packages)) {
      if (where === '') continue;
      console.log(`  ${where.padEnd(46)} ${info.version.padEnd(6)} ${info.dev ? 'dev  ' : 'prod '} ${info.integrity.slice(0, 7)}...`);
    }
    // The hash depends on the exact tarball bytes, so we do not print it in full here.
    const sample = lock.packages['node_modules/demo-utils'];
    const shown = { ...sample, resolved: clean(sample.resolved, reg), integrity: `${sample.integrity.slice(0, 7)}<hash of the tarball>` };
    console.log('\nOne entry in full:', JSON.stringify(shown, null, 2));

    // 3. Does the real npm agree with the hand-made simulation from example 04?
    const real = Object.fromEntries(Object.entries(lock.packages).filter(([k]) => k).map(([k, v]) => [k, v.version]));
    const simulated = toPaths(install(app).top);
    const sorted = (o) => JSON.stringify(Object.entries(o).sort());
    console.log('\nSame layout as the simulation in example 04?', sorted(real) === sorted(simulated));

    // 4. Inspect, and test "npm ci" on copies that have only package.json, the lockfile and some junk.
    const copy = (name, editPackage) => {
      const dir = path.join(tmp, name);
      fs.mkdirSync(dir);
      const pkg = JSON.parse(fs.readFileSync(path.join(project, 'package.json'), 'utf8'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(editPackage ? editPackage(pkg) : pkg, null, 2));
      fs.copyFileSync(path.join(project, 'package-lock.json'), path.join(dir, 'package-lock.json'));
      fs.mkdirSync(path.join(dir, 'node_modules', 'stale-leftover'), { recursive: true }); // old junk that ci must remove
      return dir;
    };
    const inSync = copy('ci-in-sync');
    const drifted = copy('ci-out-of-sync', (pkg) => ({ ...pkg, dependencies: { ...pkg.dependencies, 'demo-log': '^2.1.0' } }));
    const [ls, explain, ciGood, ciBad] = await Promise.all([
      npm(['ls', '--all'], project),
      npm(['explain', 'demo-utils'], project),
      npm(['ci'], inSync),
      npm(['ci'], drifted),
    ]);
    section('npm ls --all', clean(ls.stdout, reg));
    section('npm explain demo-utils', clean(explain.stdout, reg));
    section('npm ci   (project and lockfile agree)', clean(ciGood.stdout, reg));
    const errors = clean(ciBad.stderr, reg).split(/\r?\n/).filter((line) => line.startsWith('npm error')).slice(0, 5);
    section(`npm ci   (package.json now says demo-log ^2.1.0 but the lockfile has 2.0.1; exit code ${ciBad.status})`, errors.join('\n'));
    console.log('\nBefore npm ci, ci-in-sync/node_modules held a stale-leftover folder. Afterwards it holds:');
    console.log('  ' + fs.readdirSync(path.join(inSync, 'node_modules')).filter((n) => !n.startsWith('.')).join(', '));

    const touchedRealRegistry = Object.values(lock.packages).some((p) => p.resolved && !p.resolved.startsWith(reg.url.slice(0, -1)));
    console.log('\nDid any package come from somewhere other than the local registry?', touchedRealRegistry);
  } finally {
    await reg.close();
  }
}

guard(main).finally(() => removeTemp(tmp));
