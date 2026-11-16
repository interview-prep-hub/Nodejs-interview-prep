// Helper for 09-require-esm.js: a .js file that uses import syntax with no "type" in any package.json.
// Node notices the import statement (syntax detection) and runs the file as an ES module.
import { language } from './greeting.mjs';
console.log('  this .js file runs as ESM; imported:', language, '| require is', typeof require);
