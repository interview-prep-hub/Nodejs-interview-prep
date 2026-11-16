// Making code testable: the same report function written twice (hard, then easy to test)
// Run: node --test lessons/16-testing/examples/06-testable-code.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const hard = require('./_lib/report-hard.js');
const easy = require('./_lib/report.js');

const orders = [{ cents: 500 }, { cents: 250 }];

describe('hard version: global clock, global random, global console', () => {
  it('can only be tested by faking three globals', (t) => {
    // Without these three lines the result changes on every run.
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2030-03-04T12:00:00Z') });
    t.mock.method(Math, 'random', () => 0.123456789);
    const log = t.mock.method(console, 'log', () => {});

    const report = hard.dailyReport(orders);

    assert.deepEqual(report, { id: '4fzzzx', date: '2030-03-04', count: 2, total: 750 });
    assert.equal(log.mock.callCount(), 1);
  });
});

describe('easy version, part 1: the pure function', () => {
  // No mocks, no setup, no cleanup. Just input and output.
  it('adds up the orders', () => {
    assert.deepEqual(easy.summarize(orders), { count: 2, total: 750 });
  });

  it('handles an empty list', () => {
    assert.deepEqual(easy.summarize([]), { count: 0, total: 0 });
  });

  it('does not change its input', () => {
    const input = [{ cents: 100 }];
    easy.summarize(input);
    assert.deepEqual(input, [{ cents: 100 }]);
  });
});

describe('easy version, part 2: injected edges', () => {
  it('uses the clock, id generator and logger it is given', (t) => {
    const log = t.mock.fn();

    const report = easy.dailyReport(orders, {
      now: () => new Date('2030-03-04T12:00:00Z'),
      makeId: () => 'abc123',
      log,
    });

    assert.deepEqual(report, { id: 'abc123', date: '2030-03-04', count: 2, total: 750 });
    assert.deepEqual(log.mock.calls[0].arguments, ['report abc123 for 2030-03-04: 750 cents']);
  });

  it('still works with the real defaults (check the shape, not the values)', (t) => {
    t.mock.method(console, 'log', () => {}); // keep the test output clean

    const report = easy.dailyReport(orders);

    assert.match(report.id, /^[a-z0-9]{1,6}$/);
    assert.match(report.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(report.total, 750);
  });
});
