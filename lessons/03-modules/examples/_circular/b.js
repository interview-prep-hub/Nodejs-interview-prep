console.log('  b.js: start');
exports.done = false;
const a = require('./a.js'); // a.js is still running, so we get its PARTIAL exports
console.log('  b.js: a is unfinished, a.done =', a.done);
exports.done = true;
console.log('  b.js: end');
