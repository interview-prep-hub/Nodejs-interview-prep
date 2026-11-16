// Code under test for lesson 16: the END RESULT of the test-driven development walk-through in the README.
// parseDuration('1h30m') -> 5400000 (milliseconds)

const UNIT_MS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const WHOLE_TEXT = /^(?:\d+(?:ms|s|m|h|d))+$/; // one or more "number + unit" parts and nothing else
const ONE_PART = /(\d+)(ms|s|m|h|d)/g;

function parseDuration(text) {
  if (typeof text !== 'string') throw new TypeError('duration must be a string');
  if (!WHOLE_TEXT.test(text)) throw new RangeError(`invalid duration: "${text}"`);

  let total = 0;
  for (const [, amount, unit] of text.matchAll(ONE_PART)) {
    total += Number(amount) * UNIT_MS[unit];
  }
  return total;
}

module.exports = { parseDuration };
