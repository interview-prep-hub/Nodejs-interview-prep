// Puzzle 04 (medium): emitting an event from a constructor
// Predict the output first, then run it. The explanation is in the lesson README.
// Run: node lessons/08-event-loop/examples/puzzles/04-emit-in-constructor.js

const { EventEmitter } = require('node:events');

class Job extends EventEmitter {
  constructor() {
    super();
    this.emit('ready');
  }
}

class SafeJob extends EventEmitter {
  constructor() {
    super();
    process.nextTick(() => this.emit('ready'));
  }
}

new Job().on('ready', () => console.log('Job: ready'));
new SafeJob().on('ready', () => console.log('SafeJob: ready'));
console.log('end of script');
