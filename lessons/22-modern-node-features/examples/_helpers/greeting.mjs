// Helper for 09-require-esm.js: a small ES module with a default export and named exports.
export const language = 'ES module';
export function add(a, b) {
  return a + b;
}
export default function hello(name) {
  return `hello ${name}`;
}
