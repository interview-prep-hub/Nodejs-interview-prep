// Helper for 09-require-esm.js: an ES module that decides by itself what require() returns.
const api = {
  add(a, b) {
    return a + b;
  },
  kind: 'plain object chosen by the module',
};

export const lostForRequire = 'named exports are lost for require() users';
export { api as 'module.exports' };
