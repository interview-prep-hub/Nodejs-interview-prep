// Why "npm install" can run code on your machine, how --ignore-scripts stops it, plus npm audit and npm outdated
// Run: node lessons/04-npm-and-package-json/examples/10-install-scripts-and-audit.js
// Real npm against a pretend registry on localhost (no internet). Takes several seconds.
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createNpm, guard, removeTemp } = require('./_npm.js');
const { startRegistry } = require('./_local-registry.js');
const { registry, extras, advisories } = require('./_demo-packages.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'npm-scripts-audit-'));

function makeProject(name) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  const dependencies = { 'demo-native': '^1.0.0', 'demo-old': '^1.0.0' };
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', private: true, dependencies }, null, 2));
  return dir;
}

const marker = (dir) => path.join(dir, 'node_modules', 'demo-native', 'postinstall-was-here.txt');

async function main() {
  const reg = await startRegistry({ ...registry, ...extras }, advisories);
  try {
    const npm = createNpm(path.join(tmp, 'sandbox'), reg.url);
    if (!npm) return console.log('Could not find the npm that ships with this node. Skipping.');

    // A pretend secret in the environment, the way a CI machine has real ones.
    const env = { DEMO_SECRET_TOKEN: 'not-a-real-secret' };
    const plain = makeProject('plain-install');
    const safe = makeProject('ignore-scripts');
    const loud = makeProject('foreground-scripts');
    const [a, b, c] = await Promise.all([
      npm(['install'], plain, env),
      npm(['install', '--ignore-scripts'], safe, env),
      npm(['install', '--foreground-scripts'], loud, env),
    ]);

    console.log('1. npm install (default). npm prints', JSON.stringify(a.stdout.replace(/ in \d+m?s\b/, '')), 'and nothing about scripts.');
    console.log('   But the postinstall script ran, and left this file behind:');
    console.log('   ', fs.existsSync(marker(plain)) ? fs.readFileSync(marker(plain), 'utf8') : '(no file)');

    console.log('\n2. npm install --ignore-scripts. Was the postinstall script run?', fs.existsSync(marker(safe)));

    console.log('\n3. npm install --foreground-scripts shows what the script prints:');
    c.stdout.split(/\r?\n/).filter((line) => line.includes('demo-native')).forEach((line) => console.log('   ' + line));

    const lock = JSON.parse(fs.readFileSync(path.join(plain, 'package-lock.json'), 'utf8'));
    const flagged = Object.entries(lock.packages).filter(([, p]) => p.hasInstallScript).map(([where]) => where);
    console.log('\n4. The lockfile marks packages that have install scripts: hasInstallScript on', flagged.join(', '));

    // npm audit asks the registry about every version in your lockfile. npm outdated compares with "latest".
    const [audit, outdated] = await Promise.all([npm(['audit', '--audit=true'], plain), npm(['outdated'], plain)]);
    console.log(`\n5. npm audit (exit code ${audit.status}: non-zero when it finds something)`);
    console.log(audit.stdout.split(/\r?\n/).map((line) => '   ' + line).join('\n'));
    console.log(`\n6. npm outdated (exit code ${outdated.status}: 1 means something is behind "latest")`);
    console.log(outdated.stdout.split(/\r?\n/).map((line) => '   ' + line).join('\n'));
  } finally {
    await reg.close();
  }
}

guard(main).finally(() => removeTemp(tmp));
