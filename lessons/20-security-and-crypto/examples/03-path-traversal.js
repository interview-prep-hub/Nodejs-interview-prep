// Path traversal: the ../ attack on a "public files" folder, a wrong fix, and the right fix
// Run: node lessons/20-security-and-crypto/examples/03-path-traversal.js
//
// Everything happens inside a temporary folder that is deleted at the end.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Build this layout in a temp folder:
//   <tmp>/public/hello.txt          <- the only folder we mean to serve
//   <tmp>/public-private/leak.txt   <- a SIBLING whose name starts with "public"
//   <tmp>/secret.txt                <- must never be served
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'traversal-'));
const publicDir = path.join(tmp, 'public');
fs.mkdirSync(publicDir);
fs.mkdirSync(path.join(tmp, 'public-private'));
fs.writeFileSync(path.join(publicDir, 'hello.txt'), 'hello, anyone may read this');
fs.writeFileSync(path.join(tmp, 'secret.txt'), 'TOP SECRET: database password');
fs.writeFileSync(path.join(tmp, 'public-private', 'leak.txt'), 'TOP SECRET: sibling folder');

// ---------- Version 1: join and read (vulnerable) ----------
function readV1(userPath) {
  return fs.readFileSync(path.join(publicDir, userPath), 'utf8');
}

// ---------- Version 2: startsWith without a separator (a common wrong fix) ----------
function readV2(userPath) {
  const full = path.resolve(publicDir, userPath);
  if (!full.startsWith(publicDir)) throw new Error('blocked');
  return fs.readFileSync(full, 'utf8');
}

// ---------- Version 3: resolve, then check with path.relative (correct) ----------
function resolveInside(baseDir, userPath) {
  if (typeof userPath !== 'string' || userPath.includes('\0')) throw new Error('bad path');
  const base = path.resolve(baseDir);
  const full = path.resolve(base, userPath); // "resolve" removes every ".." and "." for us
  const rel = path.relative(base, full); // how do we get from the base to the target?
  const outside = rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel);
  if (outside || rel === '') throw new Error('blocked: path escapes the base folder');
  return full;
}
function readV3(userPath) {
  return fs.readFileSync(resolveInside(publicDir, userPath), 'utf8');
}

function attempt(label, fn, name, input) {
  let result;
  try {
    result = JSON.stringify(fn(input)).slice(0, 36);
  } catch (e) {
    result = `error ${e.code || e.message}`;
  }
  console.log(label, name.padEnd(28), '->', result);
}

const absoluteSecret = path.join(tmp, 'secret.txt'); // an attacker may also send a full path
const NUL = String.fromCharCode(0); // the "null byte" character
const inputs = [
  ['normal file', 'hello.txt'],
  ['classic ../', '../secret.txt'],
  ['hidden in the middle', 'sub/../../secret.txt'],
  ['%2e%2e%2f after decoding', decodeURIComponent('%2e%2e%2fsecret.txt')],
  ['sibling folder', '../public-private/leak.txt'],
  ['absolute path', absoluteSecret],
  ['null byte', 'hello.txt' + NUL + '.png'],
];

console.log('legend: v1 = join, v2 = startsWith(base), v3 = resolve + relative');
for (const [label, fn] of [['v1', readV1], ['v2', readV2], ['v3', readV3]]) {
  console.log('\n--- ' + label + ' ---');
  for (const [name, input] of inputs) attempt(label, fn, name, input);
}

// path.join vs path.resolve with an absolute second argument
console.log('\n--- join vs resolve ---');
console.log('path.join("/srv/public", "/etc/passwd")   =', path.posix.join('/srv/public', '/etc/passwd'));
console.log('path.resolve("/srv/public", "/etc/passwd") =', path.posix.resolve('/srv/public', '/etc/passwd'));

fs.rmSync(tmp, { recursive: true, force: true });
