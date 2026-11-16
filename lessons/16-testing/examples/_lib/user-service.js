// Code under test for lesson 16: a user service written for easy testing.
// Everything it needs from the outside world (database, mailer, clock, id generator, logger)
// is passed in as an argument. That is "dependency injection".

const crypto = require('node:crypto');

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

function createUserService({
  db,
  mailer,
  now = () => new Date(),
  makeId = () => crypto.randomUUID(),
  logger = console,
}) {
  return {
    async register(email) {
      if (typeof email !== 'string' || !email.includes('@')) {
        throw new ValidationError('invalid email');
      }
      if (await db.findByEmail(email)) {
        throw new ValidationError('email already registered');
      }

      const user = { id: makeId(), email, createdAt: now().toISOString() };
      await db.insert(user);

      try {
        await mailer.send(email, 'Welcome!');
      } catch (error) {
        // A failed welcome email must not undo a successful registration.
        logger.warn(`welcome email failed for ${email}: ${error.message}`);
      }
      return user;
    },
  };
}

module.exports = { createUserService, ValidationError };
