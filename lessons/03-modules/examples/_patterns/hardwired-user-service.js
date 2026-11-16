// Hard-wired dependency: the module requires its own database, so a test cannot replace it
// (short of tricks with require.cache).
const db = require('./real-db.js');

module.exports = {
  async getName(id) {
    const user = await db.findUser(id);
    return user ? user.name : 'unknown';
  },
};
