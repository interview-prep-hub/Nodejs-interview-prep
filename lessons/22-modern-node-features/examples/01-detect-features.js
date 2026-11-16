// Which Node is this, and which modern features does it have?
// Shows: process.version / process.release, and feature detection with typeof (no version parsing).
// Run: node lessons/22-modern-node-features/examples/01-detect-features.js

// 1. Which runtime am I on?
const major = Number(process.versions.node.split('.')[0]);
console.log('1. Runtime');
console.log('  version:', process.version);
console.log('  major is a number:', Number.isInteger(major));
// process.release.lts is the codename on an LTS line, and undefined on a Current/odd line.
console.log('  on an LTS line:', typeof process.release.lts === 'string');
console.log('  LTS codename:', process.release.lts);
console.log('  V8 engine version has dots:', process.versions.v8.includes('.'));
console.log('  engine for fetch (undici) is bundled:', typeof process.versions.undici === 'string');

// 2. Feature detection: ask "does it exist?", not "which version is it?".
// Each check returns true or false. A check must never throw.
const features = [
  ['fetch, FormData, Headers, Request, Response', () => [fetch, FormData, Headers, Request, Response].every((f) => typeof f === 'function')],
  ['AbortSignal.timeout and AbortSignal.any', () => typeof AbortSignal.timeout === 'function' && typeof AbortSignal.any === 'function'],
  ['structuredClone', () => typeof structuredClone === 'function'],
  ['global WebSocket client', () => typeof WebSocket === 'function'],
  ['URLPattern', () => typeof URLPattern === 'function'],
  ['navigator', () => typeof navigator === 'object'],
  ['node:test', () => typeof require('node:test').test === 'function'],
  ['node:sqlite', () => typeof require('node:sqlite').DatabaseSync === 'function'],
  ['fs.glob', () => typeof require('node:fs').globSync === 'function'],
  ['util.parseArgs, util.styleText', () => typeof require('node:util').parseArgs === 'function' && typeof require('node:util').styleText === 'function'],
  ['process.loadEnvFile', () => typeof process.loadEnvFile === 'function'],
  ['process.getBuiltinModule', () => typeof process.getBuiltinModule === 'function'],
  ['require(esm) is on', () => process.features.require_module === true],
  ['type stripping for .ts files', () => process.features.typescript === 'strip'],
  ['Promise.withResolvers, Promise.try', () => typeof Promise.withResolvers === 'function' && typeof Promise.try === 'function'],
  ['Object.groupBy, Map.groupBy', () => typeof Object.groupBy === 'function' && typeof Map.groupBy === 'function'],
  ['Set.prototype.union', () => typeof Set.prototype.union === 'function'],
  ['Array.fromAsync', () => typeof Array.fromAsync === 'function'],
  ['toSorted, toReversed, toSpliced, with', () => ['toSorted', 'toReversed', 'toSpliced', 'with'].every((m) => typeof [].constructor.prototype[m] === 'function')],
  ['iterator helpers (Iterator global)', () => typeof Iterator === 'function' && typeof Iterator.prototype.map === 'function'],
  ['RegExp.escape, Error.isError', () => typeof RegExp.escape === 'function' && typeof Error.isError === 'function'],
];

// Features that are NOT on Node 24. A check like this tells you when you can drop a polyfill.
const newerFeatures = [
  ['Temporal (Node 26+)', () => typeof Temporal !== 'undefined'],
  ['Iterator.concat (Node 26+)', () => typeof Iterator.concat === 'function'],
  ['Uint8Array.fromBase64 (Node 25+)', () => typeof Uint8Array.fromBase64 === 'function'],
  ['localStorage without a flag (Node 25+)', () => typeof localStorage !== 'undefined'],
];

function report(title, list, missingWord) {
  console.log(title);
  for (const [name, check] of list) {
    let ok = false;
    try {
      ok = Boolean(check());
    } catch {
      ok = false;
    }
    console.log(`    ${(ok ? 'yes' : missingWord).padEnd(7)}  ${name}`);
  }
}

console.log('2. Feature detection');
report('  Features this lesson uses (MISSING would mean: upgrade Node):', features, 'MISSING');
report('  Features that need a newer Node (no is the expected answer here):', newerFeatures, 'no');

// 3. Is this process a single executable application? (A normal `node file.js` run is not.)
console.log('3. Single executable application');
try {
  // node:sea exists since Node 20.12. A normal `node file.js` run is not a single executable application.
  console.log('  sea.isSea():', require('node:sea').isSea());
} catch {
  console.log('  node:sea is not available on this Node');
}
