// Supply-chain basics in plain Node: integrity hashes, look-alike names, lockfile review, ranges vs pins
// Run: node lessons/04-npm-and-package-json/examples/11-supply-chain-checks.js
'use strict';

const { makeTarball, integrityOf } = require('./_tarball.js');
const { maxSatisfying } = require('./03-semver-ranges.js');

// ---------------------------------------------------------------------------------------------
// 1. Integrity: the lockfile stores a hash of the tarball. npm re-computes it after download.
// ---------------------------------------------------------------------------------------------
console.log('1. Integrity check (what npm does after every download)');
const honest = makeTarball({
  'package.json': JSON.stringify({ name: 'demo-utils', version: '2.1.0' }),
  'index.js': 'module.exports = (a, b) => a + b;\n',
});
const lockfileSays = integrityOf(honest); // written into package-lock.json at install time
console.log(`   lockfile integrity : ${lockfileSays.slice(0, 7)}<${lockfileSays.length - 7} base64 characters> (the exact value depends on the bytes)`);

function verify(download) {
  return integrityOf(download) === lockfileSays ? 'OK, same bytes as before' : 'EINTEGRITY, refuse to install';
}
console.log('   same tarball again :', verify(honest));

const tampered = makeTarball({
  'package.json': JSON.stringify({ name: 'demo-utils', version: '2.1.0' }),
  'index.js': 'module.exports = (a, b) => a + b; require("child_process"); // one extra line\n',
});
console.log('   tampered tarball   :', verify(tampered), '(one changed file, a completely different hash)');

// ---------------------------------------------------------------------------------------------
// 2. Typosquatting: a malicious package named almost like a popular one.
// ---------------------------------------------------------------------------------------------
console.log('\n2. Look-alike names (typosquatting)');
const popular = ['express', 'lodash', 'react', 'axios', 'cross-env', 'chalk', 'commander', 'mongoose'];

// Number of single-character edits (insert, delete, change) needed to turn a into b.
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

function lookAlike(name) {
  const plain = name.replace(/^@[^/]+\//, ''); // ignore a scope like @acme/
  for (const real of popular) {
    if (plain === real) return name === real ? null : `${name} borrows the name of ${real} under another scope`;
    if (plain.replace(/[-_.]/g, '') === real.replace(/[-_.]/g, '')) return `${name} is ${real} with different separators`;
    if (distance(plain, real) <= 2) return `${name} is ${distance(plain, real)} edit(s) away from ${real}`;
  }
  return null;
}
for (const name of ['expresss', 'lodahs', 'crossenv', 'cross_env', '@evil/react', 'express', 'left-pad', 'chalk']) {
  console.log(`   ${name.padEnd(12)} ${lookAlike(name) || 'looks fine'}`);
}

// ---------------------------------------------------------------------------------------------
// 3. Reviewing a lockfile change in a pull request.
// ---------------------------------------------------------------------------------------------
console.log('\n3. Lockfile review');
const trustedHost = 'https://registry.npmjs.org/';
const lock = {
  packages: {
    '': { name: 'my-app' },
    'node_modules/demo-utils': { version: '2.1.0', resolved: trustedHost + 'demo-utils/-/demo-utils-2.1.0.tgz', integrity: 'sha512-AAAA' },
    'node_modules/demo-native': { version: '1.0.0', resolved: trustedHost + 'demo-native/-/demo-native-1.0.0.tgz', integrity: 'sha512-BBBB', hasInstallScript: true },
    'node_modules/cool-helper': { version: '0.1.0', resolved: 'git+ssh://git@example.test/someone/cool-helper.git#abc123' },
    'node_modules/mirror-lib': { version: '3.0.0', resolved: 'https://packages.example.test/mirror-lib-3.0.0.tgz', integrity: 'sha512-CCCC' },
  },
};

function review(lockfile) {
  const findings = [];
  for (const [where, info] of Object.entries(lockfile.packages)) {
    if (!where) continue;
    const name = where.replace(/^.*node_modules\//, '');
    if (info.hasInstallScript) findings.push(`${name}: runs an install script (check what it does)`);
    if (info.resolved && !info.resolved.startsWith(trustedHost)) findings.push(`${name}: comes from ${new URL(info.resolved.replace(/^git\+/, '')).host}, not the usual registry`);
    if (info.resolved && !info.integrity) findings.push(`${name}: no integrity hash, nothing proves the bytes are the expected ones`);
  }
  return findings;
}
review(lock).forEach((finding) => console.log('   - ' + finding));

// ---------------------------------------------------------------------------------------------
// 4. Why pinning, lockfiles and a "cool-down" help when a bad version is published.
// ---------------------------------------------------------------------------------------------
console.log('\n4. A bad version appears');
const day = 24 * 60 * 60 * 1000;
const now = Date.now();
const published = [
  { version: '2.0.0', at: now - 90 * day },
  { version: '2.1.0', at: now - 30 * day },
  { version: '2.1.1', at: now - 2 * 60 * 60 * 1000 }, // two hours ago: this is the hijacked one
];
const all = published.map((p) => p.version);
const line = (label, result, note = '') => console.log(`   ${label.padEnd(50)} ${result}${note ? ' ' + note : ''}`);
line('range "^2.0.0", fresh install, no lockfile:', maxSatisfying(all, '^2.0.0'), '<- the bad one');
line('exact pin "2.1.0":', maxSatisfying(all, '2.1.0'));
line('lockfile entry 2.1.0, then npm ci:', '2.1.0', '(a newer version is taken only after npm update)');
const coolDownDays = 3;
const settled = published.filter((p) => now - p.at > coolDownDays * day).map((p) => p.version);
line(`range "^2.0.0" with a ${coolDownDays}-day cool-down:`, maxSatisfying(settled, '^2.0.0'), '(the idea behind npm min-release-age)');
