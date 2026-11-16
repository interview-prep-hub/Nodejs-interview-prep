// Dependency injection through a factory: the caller passes in what the service needs.
module.exports = function makeUserService({ db, logger }) {
  return {
    async getName(id) {
      const user = await db.findUser(id);
      logger.log(`looked up user ${id}`);
      return user ? user.name : 'unknown';
    },
  };
};
