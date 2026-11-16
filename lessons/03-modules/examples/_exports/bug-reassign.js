// THE CLASSIC BUG: this only changes the local variable `exports`.
// `require()` returns module.exports, which is still the original empty object.
exports = {
  greet: (name) => `Hello, ${name}`,
  version: 1,
};
