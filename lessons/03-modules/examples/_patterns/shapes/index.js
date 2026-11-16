// A "barrel": one file that gathers the exports of its folder.
// require('./shapes') finds this file because a folder resolves to its index.js.
module.exports = {
  ...require('./circle.js'),
  ...require('./square.js'),
};
