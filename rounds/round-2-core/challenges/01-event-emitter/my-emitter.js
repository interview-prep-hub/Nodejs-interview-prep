'use strict';
// Your task: implement MyEmitter. See README.md.

class MyEmitter {
  on(name, fn) {
    throw new Error('TODO: implement on');
  }
  addListener(name, fn) {
    throw new Error('TODO: implement addListener');
  }
  prependListener(name, fn) {
    throw new Error('TODO: implement prependListener');
  }
  once(name, fn) {
    throw new Error('TODO: implement once');
  }
  off(name, fn) {
    throw new Error('TODO: implement off');
  }
  removeListener(name, fn) {
    throw new Error('TODO: implement removeListener');
  }
  removeAllListeners(name) {
    throw new Error('TODO: implement removeAllListeners');
  }
  emit(name, ...args) {
    throw new Error('TODO: implement emit');
  }
  listenerCount(name) {
    throw new Error('TODO: implement listenerCount');
  }
  listeners(name) {
    throw new Error('TODO: implement listeners');
  }
}

module.exports = { MyEmitter };
