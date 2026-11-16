// Code under test for lesson 16: functions that produce bigger outputs (a text receipt and an API object).
// Writing every expected line by hand would be tedious, which is where snapshot tests help.

const { lineTotal, cartTotal, formatMoney } = require('./cart.js');

function renderReceipt(order) {
  const rule = '-'.repeat(24);
  const lines = [`Receipt #${order.id}`, rule];
  for (const item of order.items) {
    lines.push(`${item.name} x${item.qty}`.padEnd(16) + formatMoney(lineTotal(item)).padStart(8));
  }
  lines.push(rule);
  lines.push('Total'.padEnd(16) + formatMoney(cartTotal(order.items)).padStart(8));
  return lines.join('\n');
}

function toApiShape(order) {
  return {
    id: order.id,
    itemCount: order.items.length,
    totalCents: cartTotal(order.items),
    items: order.items.map((item) => ({ name: item.name, qty: item.qty, lineCents: lineTotal(item) })),
  };
}

module.exports = { renderReceipt, toApiShape };
