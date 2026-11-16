// Hooks (before, after, beforeEach, afterEach), skip, todo, per-test options, t.after, t.plan
// Run: node --test lessons/16-testing/examples/02-hooks-and-modes.test.js

const { describe, it, test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

// Part 1: hooks. We record the order in an array, then print it in the last hook.
describe('hooks', () => {
  const order = [];
  let cart;

  before(() => order.push('before'));
  after(() => {
    order.push('after');
    console.log('hook order:', order.join(' > '));
  });
  beforeEach(() => {
    cart = []; // a fresh cart for EVERY test, so tests cannot affect each other
    order.push('beforeEach');
  });
  afterEach(() => order.push('afterEach'));

  it('test A starts with an empty cart', () => {
    order.push('test A');
    cart.push('pen');
    assert.equal(cart.length, 1);
  });

  it('test B also starts with an empty cart', () => {
    order.push('test B');
    assert.equal(cart.length, 0);
  });
});

// Part 2: nested describe blocks. The outer beforeEach runs first, then the inner one.
describe('nested hooks', () => {
  const calls = [];
  beforeEach(() => calls.push('outer'));

  describe('inner group', () => {
    beforeEach(() => calls.push('inner'));

    it('runs outer before inner', () => {
      assert.deepEqual(calls, ['outer', 'inner']);
    });
  });
});

// Part 3: skip, todo and friends.
describe('skip and todo', () => {
  it('runs normally', () => {
    assert.ok(true);
  });

  it('is skipped, with a reason', { skip: 'needs a real database' }, () => {
    throw new Error('never runs');
  });

  it('is skipped only on some platforms', { skip: process.platform === 'nonexistent-os' }, () => {
    assert.ok(true); // the condition above is false, so this one runs
  });

  it('is a todo: it runs, but a failure does not fail the run', { todo: 'bug 123' }, () => {
    assert.equal(1 + 1, 3);
  });

  it.todo('write a test for refunds'); // no function: just a reminder in the report

  it('can skip itself from inside', (t) => {
    if (process.platform === 'nonexistent-os') {
      t.skip('not supported here');
      return; // t.skip() does NOT stop your code, so return yourself
    }
    assert.ok(true);
  });
});

// Part 4: per-test options and context helpers.
describe('options and context', () => {
  it('has its own timeout in milliseconds', { timeout: 1000 }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
  });

  it('t.plan(n) fails the test unless exactly n assertions run', (t) => {
    t.plan(2);
    t.assert.equal(1 + 1, 2); // use t.assert (not the imported assert) so that plan can count
    t.assert.ok(true);
  });

  it('t.after() cleans up what THIS test created', (t) => {
    const resource = { open: true };
    t.after(() => {
      resource.open = false;
      console.log('t.after ran: resource closed');
    });
    assert.equal(resource.open, true);
  });

  it('t.diagnostic() adds a note to the report', (t) => {
    t.diagnostic('this note appears in the output');
    assert.ok(true);
  });
});

// Part 5: test() with a callback instead of a promise. Rarely needed, but you will see it in old code.
test('callback style: call done() when finished', (t, done) => {
  setImmediate(() => {
    assert.ok(true);
    done();
  });
});
