// Semantic versioning by hand: parse, compare, sort and bump versions (no libraries)
// Run: node lessons/04-npm-and-package-json/examples/02-semver-versions.js
'use strict';

// MAJOR.MINOR.PATCH, then an optional -prerelease tag, then an optional +build tag.
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(text) {
  const m = VERSION.exec(text);
  if (!m) throw new Error(`Not a valid version: "${text}"`);
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : [], // "beta.2" -> ["beta", "2"]
  };
}

// Returns -1 if a < b, 0 if equal, 1 if a > b.
function compare(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (const part of ['major', 'minor', 'patch']) {
    if (x[part] !== y[part]) return x[part] < y[part] ? -1 : 1; // compare as NUMBERS
  }
  return comparePrerelease(x.prerelease, y.prerelease);
}

function comparePrerelease(a, b) {
  // A version WITHOUT a tag is higher than the same version WITH one: 1.0.0 > 1.0.0-rc.1
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1; // fewer fields is lower: alpha < alpha.1
    if (b[i] === undefined) return 1;
    const aNum = /^\d+$/.test(a[i]);
    const bNum = /^\d+$/.test(b[i]);
    if (aNum && bNum) {
      if (Number(a[i]) !== Number(b[i])) return Number(a[i]) < Number(b[i]) ? -1 : 1;
    } else if (aNum !== bNum) {
      return aNum ? -1 : 1; // numbers are lower than words
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1; // words compare alphabetically
    }
  }
  return 0;
}

// What "npm version major|minor|patch" does to a stable version.
function bump(version, kind) {
  const v = parse(version);
  if (kind === 'major') return `${v.major + 1}.0.0`;
  if (kind === 'minor') return `${v.major}.${v.minor + 1}.0`;
  if (kind === 'patch') return `${v.major}.${v.minor}.${v.patch + 1}`;
  throw new Error(`Unknown bump kind: ${kind}`);
}

module.exports = { parse, compare, bump };

if (require.main === module) {
  console.log('parse("2.14.3-beta.2+build.7") =', parse('2.14.3-beta.2+build.7'));

  const versions = ['1.10.0', '1.2.0', '1.9.0', '2.0.0', '1.0.0'];
  console.log('\nsorted as text   :', [...versions].sort().join('  '));
  console.log('sorted as semver :', [...versions].sort(compare).join('  '));

  const tagged = ['1.0.0', '1.0.0-rc.1', '1.0.0-beta.11', '1.0.0-beta.2', '1.0.0-beta', '1.0.0-alpha.1', '1.0.0-alpha'];
  console.log('\nprerelease order :', tagged.sort(compare).join(' < '));

  console.log('\nbump("1.4.2", "patch") =', bump('1.4.2', 'patch'), '  (bug fix, nothing breaks)');
  console.log('bump("1.4.2", "minor") =', bump('1.4.2', 'minor'), '  (new feature, still compatible)');
  console.log('bump("1.4.2", "major") =', bump('1.4.2', 'major'), '  (breaking change)');

  try {
    parse('1.2');
  } catch (err) {
    console.log('\nparse("1.2") fails:', err.message);
  }
}
