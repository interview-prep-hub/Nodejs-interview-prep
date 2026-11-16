// d.js needs c.js, but c.js is still waiting for d.js to finish.
const c = require('./c.js'); // the partial exports of c: still the original empty object

// Node warns on stderr when you read a missing property of a partial module in a cycle.
console.log('  d.js: typeof c.name =', typeof c.name, '| own keys of c =', Object.keys(c).length);

module.exports = { name: 'd' };
