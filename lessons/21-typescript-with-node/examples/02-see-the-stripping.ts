// See what Node does to a TypeScript file: it blanks the types out with spaces
// Shows: module.stripTypeScriptTypes (strip mode and transform mode) and process.features.typescript
// Run: node lessons/21-typescript-with-node/examples/02-see-the-stripping.ts
// Note: stripTypeScriptTypes is experimental, so Node prints a warning on stderr. That is expected.

import { stripTypeScriptTypes } from 'node:module';

const before = [
  'interface Point { x: number; y: number }',
  'function length(p: Point): number {',
  '  return Math.hypot(p.x, p.y);',
  '}',
].join('\n');

const after = stripTypeScriptTypes(before);

console.log('1. Same length, same lines (so error positions stay correct):');
console.log('   length equal:', before.length === after.length);
console.log('   line count equal:', before.split('\n').length === after.split('\n').length);

console.log('\n2. Line by line. The ^ marks every character that was blanked:');
const afterLines = after.split('\n');
before.split('\n').forEach((line, i) => {
  const mask = [...line].map((ch, col) => (ch !== afterLines[i][col] ? '^' : ' ')).join('').trimEnd();
  console.log(`   ${line}`);
  if (mask) console.log(`   ${mask}`);
});

console.log('\n3. What is left to run:');
console.log(afterLines.map((line) => `   ${line.trimEnd() || '(blank line)'}`).join('\n'));

// Enums need real code, so the default "strip" mode refuses them.
const withEnum = 'enum Color { Red, Green }';
try {
  stripTypeScriptTypes(withEnum);
} catch (error) {
  const { code, message } = error as { code: string; message: string };
  console.log('\n4. strip mode:', code);
  console.log('  ', message);
}

// "transform" mode (the same engine as --experimental-transform-types) generates JavaScript.
console.log('\n5. transform mode output:');
console.log(stripTypeScriptTypes(withEnum, { mode: 'transform' }));
