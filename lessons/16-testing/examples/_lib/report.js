// Code under test for lesson 16, version 2: EASY to test. Same behaviour as report-hard.js.
//
// 1. The real logic (summarize) is a pure function: same input, same output, no side effects.
// 2. The "edges" (clock, id generator, logger) are arguments with sensible defaults.
//    Production code calls dailyReport(orders). Tests pass their own edges.

function summarize(orders) {
  return {
    count: orders.length,
    total: orders.reduce((sum, order) => sum + order.cents, 0),
  };
}

function dailyReport(
  orders,
  {
    now = () => new Date(),
    makeId = () => Math.random().toString(36).slice(2, 8),
    log = console.log,
  } = {},
) {
  const date = now().toISOString().slice(0, 10);
  const id = makeId();
  const summary = summarize(orders);

  log(`report ${id} for ${date}: ${summary.total} cents`);
  return { id, date, ...summary };
}

module.exports = { summarize, dailyReport };
