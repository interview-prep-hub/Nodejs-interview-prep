// What Node's type stripping refuses to run, and the exact error for each case
// Shows: enum, parameter property, namespace, missing .ts extension, type imported as a value, and the transform-types escape hatch
// Run: node lessons/21-typescript-with-node/examples/03-what-fails.ts

import { spawnSync } from 'node:child_process';
import path from 'node:path';

const helpers = path.join(import.meta.dirname, '_helpers');

function runNode(args: string[]) {
  return spawnSync(process.execPath, args, { encoding: 'utf8' });
}

// Pick the one line of stderr that names the error, and hide machine-specific paths.
function errorLine(stderr: string): string {
  const line = stderr.split(/\r?\n/).find((l) => /^\w*Error/.test(l)) ?? '(no error line found)';
  return line
    .replace(/ imported from .*$/, '')
    .replace(/'[^']*[\\/]([^\\/']+)'/, "'.../$1'")
    .replace(/ for .*$/, '')
    .trim();
}

const cases = [
  ['bad-enum.ts', 'enum'],
  ['bad-param-prop.ts', 'constructor(private owner: string)'],
  ['bad-namespace.ts', 'namespace with a value inside'],
  ['bad-no-extension.ts', "import from './greeting' (no .ts)"],
  ['bad-type-import.ts', 'import { Shape } where Shape is an interface'],
] as const;

for (const [file, what] of cases) {
  const result = runNode([path.join(helpers, file)]);
  console.log(`${what}`);
  console.log(`  exit code: ${result.status}`);
  console.log(`  ${errorLine(result.stderr)}`);
}

// The escape hatch for enum, namespace and parameter properties (Node 22.7 up to 24, removed in Node 26).
const flagged = runNode(['--experimental-transform-types', path.join(helpers, 'bad-enum.ts')]);
console.log('\nsame enum file with --experimental-transform-types');
console.log(`  exit code: ${flagged.status}, printed: ${flagged.stdout.trim()}`);
console.log(`  ${flagged.stderr.split(/\r?\n/)[0].replace(/^\(node:\d+\) /, '')}`);

// With stripping switched off, Node does not know what a .ts file is.
const off = runNode(['--no-strip-types', path.join(helpers, 'greeting.ts')]);
console.log('\nany .ts file, with --no-strip-types');
console.log(`  ${errorLine(off.stderr)}`);
