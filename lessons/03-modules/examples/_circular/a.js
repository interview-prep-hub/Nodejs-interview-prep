console.log('  a.js: start');
exports.done = false;
const b = require('./b.js'); // b.js starts running right now, before a.js continues
console.log('  a.js: back in a.js, b.done =', b.done);
exports.done = true;
console.log('  a.js: end');
