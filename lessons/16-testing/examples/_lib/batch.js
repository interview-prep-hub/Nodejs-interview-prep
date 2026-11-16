// Code under test for lesson 16: an EventEmitter that processes a list of items one by one.
// Events: 'item' (item, result), 'failed' (item, error), 'done' (summary), 'error' (error).

const { EventEmitter } = require('node:events');

class BatchProcessor extends EventEmitter {
  constructor(handler) {
    super();
    this.handler = handler;
  }

  async run(items) {
    if (!Array.isArray(items)) {
      // Emitting 'error' with no listener throws the error, which makes run() reject.
      this.emit('error', new TypeError('items must be an array'));
      return 0;
    }

    let ok = 0;
    for (const item of items) {
      try {
        const result = await this.handler(item);
        ok++;
        this.emit('item', item, result);
      } catch (error) {
        this.emit('failed', item, error);
      }
    }
    this.emit('done', { ok, failed: items.length - ok });
    return ok;
  }
}

module.exports = { BatchProcessor };
