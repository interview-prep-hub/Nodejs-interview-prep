// Helper for 11-patterns.js (not run on its own): one shared event bus.
// Node caches every module after the first require(), so every file that
// requires this one gets the very same emitter object.
const EventEmitter = require('node:events');

module.exports = new EventEmitter();
