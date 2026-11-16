'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('../../../_shared/load');
const { MyEmitter } = load(__dirname, 'my-emitter.js');

test('listeners run synchronously in registration order', () => {
  const e = new MyEmitter();
  const log = [];
  e.on('x', () => log.push('a'));
  e.on('x', () => log.push('b'));
  log.push('before');
  e.emit('x');
  log.push('after');
  assert.deepEqual(log, ['before', 'a', 'b', 'after']);
});

test('emit passes arguments and returns true only when there were listeners', () => {
  const e = new MyEmitter();
  let got;
  e.on('x', (...args) => (got = args));
  assert.equal(e.emit('x', 1, 2), true);
  assert.deepEqual(got, [1, 2]);
  assert.equal(e.emit('nobody'), false);
});

test('this inside a normal function listener is the emitter', () => {
  const e = new MyEmitter();
  let self;
  e.on('x', function () {
    self = this;
  });
  e.emit('x');
  assert.equal(self, e);
});

test('once runs exactly once, even with a re-entrant emit', () => {
  const e = new MyEmitter();
  let n = 0;
  e.once('x', () => {
    n++;
    e.emit('x');
  });
  e.emit('x');
  e.emit('x');
  assert.equal(n, 1);
  assert.equal(e.listenerCount('x'), 0);
});

test('off removes a listener, including a once listener by its original function', () => {
  const e = new MyEmitter();
  const calls = [];
  const a = () => calls.push('a');
  const b = () => calls.push('b');
  e.on('x', a);
  e.once('x', b);
  e.off('x', a);
  e.off('x', b);
  e.emit('x');
  assert.deepEqual(calls, []);
});

test('removing a listener during emit does not skip it for that emit', () => {
  const e = new MyEmitter();
  const calls = [];
  const second = () => calls.push('second');
  e.on('x', () => {
    calls.push('first');
    e.off('x', second);
  });
  e.on('x', second);
  e.emit('x');
  e.emit('x');
  assert.deepEqual(calls, ['first', 'second', 'first']);
});

test('adding a listener during emit does not run it for that emit', () => {
  const e = new MyEmitter();
  const calls = [];
  e.on('x', () => {
    calls.push('first');
    e.on('x', () => calls.push('late'));
  });
  e.emit('x');
  assert.deepEqual(calls, ['first']);
});

test('prependListener runs first', () => {
  const e = new MyEmitter();
  const calls = [];
  e.on('x', () => calls.push('normal'));
  e.prependListener('x', () => calls.push('first'));
  e.emit('x');
  assert.deepEqual(calls, ['first', 'normal']);
});

test('listenerCount and listeners report the original functions', () => {
  const e = new MyEmitter();
  const a = () => {};
  const b = () => {};
  e.on('x', a);
  e.once('x', b);
  assert.equal(e.listenerCount('x'), 2);
  assert.deepEqual(e.listeners('x'), [a, b]);
  assert.equal(e.listenerCount('none'), 0);
});

test('removeAllListeners removes one name or everything', () => {
  const e = new MyEmitter();
  e.on('a', () => {});
  e.on('b', () => {});
  e.removeAllListeners('a');
  assert.equal(e.listenerCount('a'), 0);
  assert.equal(e.listenerCount('b'), 1);
  e.removeAllListeners();
  assert.equal(e.listenerCount('b'), 0);
});

test('emitting error with no listener throws the Error that was passed', () => {
  const e = new MyEmitter();
  const err = new Error('bad');
  assert.throws(() => e.emit('error', err), (thrown) => thrown === err);
  assert.throws(() => e.emit('error', 'text'), Error);
});

test('methods that add listeners are chainable', () => {
  const e = new MyEmitter();
  assert.equal(e.on('x', () => {}), e);
  assert.equal(e.once('x', () => {}), e);
});

test('a non-function listener throws TypeError', () => {
  assert.throws(() => new MyEmitter().on('x', 'nope'), TypeError);
});
