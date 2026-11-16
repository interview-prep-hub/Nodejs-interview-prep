// Code under test for lesson 16: a tiny shopping cart.
// Pure functions only (no I/O, no clock). Money is kept in whole cents to avoid float errors.

function lineTotal(item) {
  return item.priceCents * item.qty;
}

function cartTotal(items) {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}

function applyDiscount(totalCents, percent) {
  if (typeof percent !== 'number' || Number.isNaN(percent) || percent < 0 || percent > 100) {
    throw new RangeError('percent must be a number from 0 to 100');
  }
  return Math.round((totalCents * (100 - percent)) / 100);
}

function formatMoney(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

module.exports = { lineTotal, cartTotal, applyDiscount, formatMoney };
