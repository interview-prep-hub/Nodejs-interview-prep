// Environment variables: everything is a string, defaults, converting types, .env files (--env-file, loadEnvFile)
// Run: node lessons/15-processes-and-cli/examples/02-env-and-env-files.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const util = require('node:util');
const { spawnSync } = require('node:child_process');

const printEnv = path.join(__dirname, '_helpers', 'print-env.js');

console.log('1. Everything in process.env is a string');
process.env.APP_PORT = 3000; // we assign a number...
console.log('  typeof APP_PORT:', typeof process.env.APP_PORT, '| value:', JSON.stringify(process.env.APP_PORT));
process.env.APP_DEBUG = false;
console.log('  APP_DEBUG:', JSON.stringify(process.env.APP_DEBUG), '| truthy:', Boolean(process.env.APP_DEBUG));
process.env.APP_EMPTY = undefined;
console.log('  assigning undefined stores the text:', JSON.stringify(process.env.APP_EMPTY));
console.log('  a variable that is not set is undefined:', process.env.APP_MISSING);
console.log('  "in" tells set from unset:', 'APP_MISSING' in process.env, 'APP_PORT' in process.env);
delete process.env.APP_EMPTY;
console.log('  after delete:', process.env.APP_EMPTY);

console.log('2. Defaults and conversion helpers');
// A variable can be unset (undefined) or set to nothing (an empty string). The two operators treat them differently.
process.env.APP_BLANK = '';
console.log('  BLANK || "fallback" gives:', JSON.stringify(process.env.APP_BLANK || 'fallback'), '(|| replaces every falsy value, including "")');
console.log('  BLANK ?? "fallback" gives:', JSON.stringify(process.env.APP_BLANK ?? 'fallback'), '(?? replaces only undefined and null)');

function envString(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return value;
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw.toLowerCase())) return true;
  if (['0', 'false', 'no', 'off'].includes(raw.toLowerCase())) return false;
  throw new Error(`${name} must be true or false, got "${raw}"`);
}

process.env.APP_PORT = '8080';
process.env.APP_DEBUG = 'false';
console.log('  envInt("APP_PORT", 3000):', envInt('APP_PORT', 3000));
console.log('  envInt("APP_MISSING", 3000):', envInt('APP_MISSING', 3000));
console.log('  envBool("APP_DEBUG", true):', envBool('APP_DEBUG', true));
console.log('  envString("APP_BLANK", "fallback"):', envString('APP_BLANK', 'fallback'));
process.env.APP_PORT = '80abc';
try {
  envInt('APP_PORT', 3000);
} catch (err) {
  console.log('  bad value is rejected early:', err.message);
}
console.log('  the traps:', 'Number("")=' + Number(''), 'Number("abc")=' + Number('abc'), 'Boolean("false")=' + Boolean('false'), 'parseInt("80abc")=' + parseInt('80abc', 10));

console.log('3. Env var names on Windows are case-insensitive');
process.env.Mixed_Case = 'x';
console.log('  platform:', process.platform, '| MIXED_CASE finds Mixed_Case:', process.env.MIXED_CASE === 'x', '(true on Windows, false on Linux and macOS)');

console.log('4. .env files');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-demo-'));
const envFile = path.join(dir, '.env');
const text = [
  '# comments start with a hash',
  'APP_NAME=demo',
  'PORT=3000',
  'GREETING="hello world"',
  "NOTE='keeps # inside quotes'",
  'EMPTY=',
  '',
].join('\n');
fs.writeFileSync(envFile, text);

console.log('  util.parseEnv(text) only parses, it does not touch process.env:');
console.log('   ', JSON.stringify(util.parseEnv(text)));

console.log('  node --env-file=.env script.js:');
let result = spawnSync(process.execPath, [`--env-file=${envFile}`, printEnv, 'APP_NAME', 'PORT', 'GREETING', 'NOTE', 'NOT_IN_FILE'], { encoding: 'utf8' });
console.log('   ', result.stdout.trim());

console.log('  a variable already set in the shell WINS over the file:');
result = spawnSync(process.execPath, [`--env-file=${envFile}`, printEnv, 'PORT', 'GREETING'], {
  encoding: 'utf8',
  env: { ...process.env, PORT: '9999' },
});
console.log('   ', result.stdout.trim());

console.log('  two files: the LATER --env-file overrides the earlier one:');
const overrideFile = path.join(dir, '.env.local');
fs.writeFileSync(overrideFile, 'PORT=4000\nEXTRA=only in local file\n');
result = spawnSync(process.execPath, [`--env-file=${envFile}`, `--env-file=${overrideFile}`, printEnv, 'PORT', 'EXTRA'], { encoding: 'utf8' });
console.log('   ', result.stdout.trim());

console.log('  a missing file is an error (exit code 9), unless you use --env-file-if-exists:');
const missing = path.join(dir, 'nope.env');
result = spawnSync(process.execPath, [`--env-file=${missing}`, printEnv, 'PORT'], { encoding: 'utf8' });
console.log('    --env-file           exit code:', result.status, '| stdout:', JSON.stringify(result.stdout));
result = spawnSync(process.execPath, [`--env-file-if-exists=${missing}`, printEnv, 'PORT'], { encoding: 'utf8' });
console.log('    --env-file-if-exists exit code:', result.status, '| stdout:', result.stdout.trim());

console.log('5. process.loadEnvFile(path) loads a file from inside your code');
process.env.PORT = '1111'; // already set, so loadEnvFile will NOT replace it
process.loadEnvFile(envFile);
console.log('  PORT stays:', process.env.PORT, '| APP_NAME was added:', process.env.APP_NAME);
try {
  process.loadEnvFile(missing);
} catch (err) {
  console.log('  missing file throws:', err.code);
}

fs.rmSync(dir, { recursive: true, force: true });
