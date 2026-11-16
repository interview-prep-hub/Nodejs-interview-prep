// JSDoc types in a plain .js file: get TypeScript checking without renaming a single file
// Shows: @typedef, @param, @returns, @template, @type with import(), and // @ts-check (the file-level checkJs)
// Run: node lessons/21-typescript-with-node/examples/11-jsdoc-checkjs.js

// @ts-check

import { statSync } from 'node:fs';

// 1. Describe a shape once with @typedef. Editors and tsc understand it. Node ignores it (it is a comment).
/**
 * @typedef {object} User
 * @property {number} id
 * @property {string} name
 * @property {string} [email] optional property, like "email?: string" in TypeScript
 */

/**
 * @param {User} user
 * @returns {string}
 */
function label(user) {
  return `${user.name} <${user.email ?? 'no email'}>`;
}

console.log('1.', label({ id: 1, name: 'Asha' }));
// @ts-expect-error "name" is missing, and with // @ts-check on, tsc and the editor say so
console.log('   ', label({ id: 2 }));

// 2. Generic functions use @template. Callback types use @callback or an inline function type.
/**
 * @template T
 * @param {T[]} items
 * @param {(item: T) => boolean} test
 * @returns {T | undefined}
 */
function findFirst(items, test) {
  return items.find(test);
}
const found = findFirst([3, 8, 12], (n) => n > 5); // inferred: number | undefined
console.log('2.', found);

// 3. Types from Node itself are pulled in with import('...'). No runtime import happens.
/**
 * @param {import('node:fs').Stats} stats
 * @returns {string}
 */
function kind(stats) {
  return stats.isFile() ? 'file' : 'something else';
}
console.log('3.', kind(statSync(import.meta.filename)));

// 4. Casting: a JSDoc cast needs parentheses around the value.
const fromJson = /** @type {{ port: number }} */ (JSON.parse('{"port": 3000}'));
console.log('4.', fromJson.port + 1);

// The compiler options that turn this on for a whole project are in _helpers/tsconfig.json:
//   "allowJs": true, "checkJs": true, "noEmit": true
