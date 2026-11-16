// Trap: c.js replaces module.exports AFTER it has required d.js.
const d = require('./d.js');

module.exports = {
  name: 'c',
  fromD: d.name,
};
