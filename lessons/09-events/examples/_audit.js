// Helper for 11-patterns.js (not run on its own): a module that listens on the bus.
// It knows the event names, but it does not know (or care) who emits them.
const bus = require('./_bus.js');

const seen = [];

bus.on('user:created', (user) => {
  seen.push(`audit: user ${user.name} was created`);
});

module.exports = { seen };
