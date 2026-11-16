// Code under test for lesson 16, version 1: HARD to test.
// It reads the clock, rolls a random number and prints to the console, all inside one function.
// The result is different on every call, so a test cannot simply compare it with a fixed value.

function dailyReport(orders) {
  const date = new Date().toISOString().slice(0, 10);
  const id = Math.random().toString(36).slice(2, 8);

  let total = 0;
  for (const order of orders) total += order.cents;

  console.log(`report ${id} for ${date}: ${total} cents`);
  return { id, date, count: orders.length, total };
}

module.exports = { dailyReport };
