// ES module extras: import.meta.dirname / filename / resolve / main, JSON import attributes, top-level await.
// Shows: how to replace __dirname and require() inside an ES module.
// Run: node lessons/22-modern-node-features/examples/10-import-meta.mjs

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import config from './_helpers/config.json' with { type: 'json' };
import { isMain } from './_helpers/show-main.mjs';

console.log('1. The CommonJS variables do not exist here');
console.log('  typeof __dirname:', typeof __dirname, '| typeof require:', typeof require);

console.log('2. import.meta (Node 20.11+ for dirname and filename)');
console.log('  file name:', path.basename(import.meta.filename));
console.log('  folder name:', path.basename(import.meta.dirname));
console.log('  dirname equals path.dirname(filename):', import.meta.dirname === path.dirname(import.meta.filename));
console.log('  url starts with file:///:', import.meta.url.startsWith('file:///'));
console.log('  resolve() gives a file URL string:', import.meta.resolve('./_helpers/config.json').endsWith('/_helpers/config.json'));

console.log('3. import.meta.main tells you if this file was started directly (Node 24.2+)');
console.log('  this file:', import.meta.main, '| a file that was only imported:', isMain);

console.log('4. Import attributes: JSON needs { type: "json" }');
console.log('  static import with attribute:', config);
try {
  await import('./_helpers/config.json');
} catch (err) {
  console.log('  without the attribute:', err.code);
}
const dynamic = await import('./_helpers/config.json', { with: { type: 'json' } });
console.log('  dynamic import with attribute:', dynamic.default.port);

console.log('5. Top-level await works in ES modules');
const text = await readFile(path.join(import.meta.dirname, '_helpers', 'config.json'), 'utf8');
console.log('  read with await at the top:', JSON.parse(text).name);
