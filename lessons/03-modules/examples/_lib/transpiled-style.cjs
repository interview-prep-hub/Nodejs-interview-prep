// What CommonJS output from a compiler (TypeScript, Babel) often looks like:
// an __esModule marker plus a property literally called "default".
Object.defineProperty(exports, '__esModule', { value: true });
exports.default = function hello() {
  return 'hello from compiled code';
};
exports.extra = 1;
