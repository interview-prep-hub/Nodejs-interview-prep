// Equality, type coercion traps, truthy and falsy values
// Run: node lessons/02-javascript-essentials/examples/06-coercion.js

const vm = require('node:vm');

// Prints "expression -> result". The label and the code must say the same thing.
function t(label, value) {
  console.log(label.padEnd(46), '->', value);
}

console.log('--- 1. == converts types first, === never does');
t("0 == '0'", 0 == '0');
t("0 == ''", 0 == '');
t("'0' == ''", '0' == ''); // so == is not even transitive
t('null == undefined', null == undefined);
t('null == 0', null == 0);
t('null === undefined', null === undefined);
t('[] == false', [] == false);
t('[] == ![]', [] == ![]);
t('({}) === {}', ({}) === {}); // two different objects (compared by reference)

console.log('--- 2. typeof and its surprises');
t('typeof null', typeof null); // a famous bug from 1995 that can never be fixed
t('typeof NaN', typeof NaN);
t('typeof []', typeof []);
t('Array.isArray([])', Array.isArray([]));
t('typeof (() => {})', typeof (() => {}));
t('typeof class {}', typeof class {});
t('typeof 10n', typeof 10n);
t('typeof notDeclaredAnywhere', typeof notDeclaredAnywhere);

console.log('--- 3. NaN is the only value not equal to itself');
t('NaN === NaN', NaN === NaN);
t('Number.isNaN(NaN)', Number.isNaN(NaN));
t("isNaN('abc')", isNaN('abc')); // the old global converts first
t("Number.isNaN('abc')", Number.isNaN('abc')); // the new one does not
t('Object.is(NaN, NaN)', Object.is(NaN, NaN));
t('[NaN].includes(NaN)', [NaN].includes(NaN));
t('[NaN].indexOf(NaN)', [NaN].indexOf(NaN));
t('0 === -0', 0 === -0);
t('Object.is(0, -0)', Object.is(0, -0));

console.log('--- 4. + is either add or join. Other math operators always convert to number');
t("1 + '2'", 1 + '2');
t("'5' - 2", '5' - 2);
t("'5' * '2'", '5' * '2');
t('true + true', true + true);
t('JSON.stringify([] + [])', JSON.stringify([] + []));
t('[] + {}', [] + {});
t("vm.runInNewContext('{} + []')", vm.runInNewContext('{} + []')); // a leading {} is an empty block, not an object
t("'b' + 'a' + +'a' + 'a'", 'b' + 'a' + +'a' + 'a');
t("'10' > '9'", '10' > '9'); // two strings: compared as text
t("10 > '9'", 10 > '9'); // one number: compared as numbers
t('null >= 0', null >= 0);

console.log('--- 5. Turning text into numbers');
t("+'42'", +'42');
t("+''", +'');
t("+'abc'", +'abc');
t('+null', +null);
t('+undefined', +undefined);
t('+[]', +[]);
t("Number('12px')", Number('12px'));
t("parseInt('12px')", parseInt('12px'));
t("parseInt('08')", parseInt('08'));
t("['1','2','3'].map(parseInt)", ['1', '2', '3'].map(parseInt)); // map passes (value, index): the index becomes the radix
t("['1','2','3'].map(Number)", ['1', '2', '3'].map(Number));

console.log('--- 6. Numbers are 64-bit floats');
t('0.1 + 0.2', 0.1 + 0.2);
t('0.1 + 0.2 === 0.3', 0.1 + 0.2 === 0.3);
t('Math.abs(0.1 + 0.2 - 0.3) < Number.EPSILON', Math.abs(0.1 + 0.2 - 0.3) < Number.EPSILON);
t('Number.MAX_SAFE_INTEGER', Number.MAX_SAFE_INTEGER);
t('2 ** 53 === 2 ** 53 + 1', 2 ** 53 === 2 ** 53 + 1);
t('2n ** 64n', 2n ** 64n);
try {
  t('1n + 1', 1n + 1);
} catch (err) {
  t('1n + 1', err.name + ': ' + err.message);
}
t('[10, 9, 1].sort()', [10, 9, 1].sort()); // default sort compares text
t('[10, 9, 1].sort((a, b) => a - b)', [10, 9, 1].sort((a, b) => a - b));

console.log('--- 7. How an object becomes a primitive');
const money = {
  amount: 5,
  valueOf() {
    return this.amount; // used for math and +
  },
  toString() {
    return `$${this.amount}`; // used for text
  },
};
t('money + 1', money + 1);
t('money * 2', money * 2);
t('`${money}`', `${money}`);

console.log('--- 8. Falsy values (there are exactly eight) and some truthy surprises');
const falsy = [false, 0, -0, 0n, '', null, undefined, NaN];
t('falsy.some(Boolean)', falsy.some(Boolean));
const surprising = ['0', 'false', ' ', [], {}, function () {}, new Boolean(false), -1, Infinity];
t('surprising.every(Boolean)', surprising.every(Boolean));
t('Boolean([]) and ([] == false)', [Boolean([]), [] == false]); // truthy, yet loosely equal to false

console.log('--- 9. && and || return one of their operands, not true or false');
t("'' || 'fallback'", '' || 'fallback'); // first truthy value, or the last one
t("0 && 'never'", 0 && 'never'); // first falsy value, or the last one
t("'a' && 'b'", 'a' && 'b');
const account = { owner: 'Sara', profile: null };
t('account.profile && account.profile.bio', account.profile && account.profile.bio); // a guard: stops at null
t('account.owner && account.owner.toUpperCase()', account.owner && account.owner.toUpperCase());

console.log('--- 10. toFixed returns text, and rounding follows the binary value');
t('typeof (2.5).toFixed(1)', typeof (2.5).toFixed(1));
t('(1.005).toFixed(2)', (1.005).toFixed(2)); // 1.005 is really 1.00499999999999989...
