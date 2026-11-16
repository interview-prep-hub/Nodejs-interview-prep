// ES modules (.mjs): __dirname does not exist, use import.meta.dirname instead
// Run: node lessons/01-introduction/examples/06-esm-dirname.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// In an ES module the CommonJS helpers are not defined. typeof is safe to ask about them.
console.log('typeof __dirname :', typeof __dirname);
console.log('typeof __filename:', typeof __filename);
console.log('typeof require   :', typeof require);

// Node 20.11+ gives you the same information in two properties of import.meta.
console.log('\nimport.meta.filename, last part:', path.basename(import.meta.filename));
console.log('import.meta.dirname, last part :', path.basename(import.meta.dirname));

// The older way (works on every Node version that supports ES modules):
// import.meta.url is a file:// address, and fileURLToPath turns it into a normal path.
const oldWay = path.dirname(fileURLToPath(import.meta.url));
console.log('old way gives the same folder  :', oldWay === import.meta.dirname);

// Bonus: ES modules allow await at the top level, no async function needed.
const answer = await Promise.resolve(42);
console.log('top-level await result         :', answer);
