// Small built-in helpers that replace yargs/commander basics, chalk and dotenv.
// Shows: util.parseArgs, util.styleText, util.parseEnv and process.loadEnvFile.
// Run: node lessons/22-modern-node-features/examples/05-cli-helpers.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseArgs, styleText, parseEnv } = require('node:util');

console.log('1. util.parseArgs (Node 18.3+, stable since 20)');
// We pass a fixed list so the output never changes. Normally you leave out `args` and it reads process.argv.
const parsed = parseArgs({
  args: ['--port', '8080', '--no-color', '-v', '-v', 'input.txt'],
  options: {
    port: { type: 'string', short: 'p', default: '3000' },
    color: { type: 'boolean', default: true },
    verbose: { type: 'boolean', short: 'v', multiple: true },
  },
  allowPositionals: true,
  allowNegative: true, // lets --no-color switch the boolean option "color" off
});
console.log('  values:', { ...parsed.values });
console.log('  positionals:', parsed.positionals);
try {
  parseArgs({ args: ['--prot', '1'], options: { port: { type: 'string' } } });
} catch (err) {
  console.log('  a typo throws:', err.code);
}

console.log('2. util.styleText (a small chalk)');
// validateStream: false forces the escape codes, so we can look at them.
const forced = styleText(['bold', 'green'], 'ok', { validateStream: false });
console.log('  forced codes:', JSON.stringify(forced));
// By default styleText checks the stream and drops the codes when it is not a terminal (a pipe or a file).
const normal = styleText('red', 'hello');
console.log('  default output here:', process.stdout.isTTY ? 'has colour codes (you run in a terminal)' : `plain ${JSON.stringify(normal)} (output is not a terminal)`);
try {
  styleText('purple', 'x');
} catch (err) {
  console.log('  a bad format name throws:', err.code);
}

console.log('3. util.parseEnv turns .env text into an object');
const text = ['# a comment', 'HOST=localhost', 'GREETING="hello # not a comment"', "NAME='single quotes'", 'export TOKEN=abc123', 'EMPTY=', 'INLINE=value # a comment'].join('\n');
for (const [key, value] of Object.entries(parseEnv(text)).sort()) console.log(`  ${key} = ${JSON.stringify(value)}`);

console.log('4. process.loadEnvFile puts the values into process.env');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-env-'));
try {
  const file = path.join(dir, '.env');
  fs.writeFileSync(file, 'MODERN_A=from-file\nMODERN_B=from-file\n');
  process.env.MODERN_B = 'from-shell'; // already set before loading
  process.loadEnvFile(file);
  console.log('  MODERN_A (new):', process.env.MODERN_A);
  console.log('  MODERN_B (already set, NOT overridden):', process.env.MODERN_B);
  try {
    process.loadEnvFile(path.join(dir, 'missing.env'));
  } catch (err) {
    console.log('  a missing file throws:', err.code);
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
