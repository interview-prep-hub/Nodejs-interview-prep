// util extras: TextEncoder/TextDecoder, parseArgs, styleText, deprecate
// Run: node lessons/05-core-modules-tour/examples/06-util-extras.js
const util = require('node:util');

console.log('--- TextEncoder and TextDecoder: text <-> bytes (both are globals) ---');
const text = 'héllo €';
const bytes = new TextEncoder().encode(text); // always UTF-8
console.log('characters:', text.length, '| bytes:', bytes.length);
console.log('bytes:', bytes.constructor.name, [...bytes].join(' ')); // a Uint8Array of numbers 0-255
console.log('decoded:', new TextDecoder().decode(bytes));
const broken = new Uint8Array([104, 105, 0xff]); // 0xff is never valid in UTF-8
console.log('lenient decode:', JSON.stringify(new TextDecoder().decode(broken)));
try {
  new TextDecoder('utf-8', { fatal: true }).decode(broken);
} catch (err) {
  console.log('fatal decode throws:', err.code);
}

console.log('--- parseArgs: read command line flags without a library ---');
const { values, positionals } = util.parseArgs({
  args: ['--name', 'Ada', '-v', '--count=3', 'input.txt'], // normally leave this out: it defaults to process.argv.slice(2)
  options: {
    name: { type: 'string', short: 'n' },
    verbose: { type: 'boolean', short: 'v' },
    count: { type: 'string', default: '1' },
    color: { type: 'string', default: 'blue' },
  },
  allowPositionals: true,
});
console.log('values:', { ...values });
console.log('positionals:', positionals);
console.log('count as a number:', Number(values.count)); // option values are strings or booleans
try {
  util.parseArgs({ args: ['--oops'], options: {} });
} catch (err) {
  console.log('unknown flag ->', err.code);
}

console.log('--- styleText: colors without a library ---');
console.log(util.styleText('green', 'This is green in a terminal'));
console.log(util.styleText(['bold', 'red'], 'Bold and red'));
// When output is piped to a file, the color codes are dropped on purpose.
// validateStream: false forces them, so we can look at the raw text.
console.log(JSON.stringify(util.styleText('red', 'hi', { validateStream: false })));

console.log('--- deprecate: warn once when someone uses an old function ---');
process.on('warning', (warning) => {
  console.log(`warning event -> ${warning.name} [${warning.code}]: ${warning.message}`);
});
const oldHelper = util.deprecate(() => 'result', 'oldHelper() is deprecated, use newHelper() instead', 'APP001');
console.log(oldHelper());
console.log(oldHelper()); // the warning is NOT repeated
