// Testing a CLI from the outside with spawnSync: exit codes, stdout vs stderr, stdin input, colors, JSON
// Run: node lessons/15-processes-and-cli/examples/10-test-the-cli.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cli = path.join(__dirname, '09-mini-cli.js');
const ESC = '\u001b['; // every color code starts with these two characters

// Start from a clean environment so a FORCE_COLOR or NO_COLOR set on your machine cannot change the results.
const cleanEnv = { ...process.env };
for (const name of ['FORCE_COLOR', 'NO_COLOR', 'NODE_DISABLE_COLORS']) delete cleanEnv[name];

// Run the CLI as a real program. spawnSync never throws for a failing child, it just reports status.
function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', env: cleanEnv, ...options });
}

let passed = 0;
let failed = 0;
function check(name, body) {
  try {
    body();
    passed++;
    console.log(`  ok    ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(String(err.message).replace(/^/gm, '        '));
  }
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-'));
const file = path.join(dir, 'notes.txt');
fs.writeFileSync(file, 'hello world\nsecond line here\n'); // 2 lines, 5 words, 29 characters

try {
  console.log('Help and version');
  check('--help prints usage and exits 0', () => {
    const r = run(['--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^wcl 1\.2\.0/);
    assert.match(r.stdout, /Usage:/);
    assert.equal(r.stderr, '');
  });
  check('-v prints only the version', () => {
    const r = run(['-v']);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '1.2.0\n');
  });

  console.log('Counting');
  const base = run([file]); // one process, checked by several tests below
  check('counts a file', () => {
    assert.equal(base.status, 0);
    assert.equal(base.stdout, `lines=2 words=5 chars=29  ${file}\n`);
  });
  check('-lw (grouped short flags) shows only lines and words', () => {
    const r = run(['-lw', file]);
    assert.equal(r.stdout, `lines=2 words=5  ${file}\n`);
  });
  check('reads standard input when there is no file', () => {
    const r = run([], { input: 'a b c' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, 'lines=1 words=3 chars=5  stdin\n');
  });
  check('--json prints parseable JSON', () => {
    const r = run(['--json', '-c', file]);
    assert.deepEqual(JSON.parse(r.stdout), [{ name: file, chars: 29 }]);
  });

  console.log('Errors and exit codes');
  check('unknown option: exit 2, message on stderr, nothing on stdout', () => {
    const r = run(['--bogus']);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /Unknown option '--bogus'/);
  });
  check('missing file: exit 1, but the good file is still counted', () => {
    const r = run([file, path.join(dir, 'missing.txt')]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /ENOENT/);
    assert.match(r.stdout, /lines=2/);
  });

  console.log('Output streams and colors');
  check('--verbose writes progress to stderr only', () => {
    const verbose = run(['--verbose', file]);
    assert.equal(verbose.stdout, base.stdout);
    assert.match(verbose.stderr, /\[1\/1\] reading/);
  });
  check('no colors when stdout is a pipe', () => {
    assert.ok(!base.stdout.includes(ESC));
  });
  check('--color forces colors', () => {
    assert.ok(run(['--color', file]).stdout.includes(ESC));
  });
  check('FORCE_COLOR=1 turns colors on, --no-color wins over it', () => {
    const forced = { ...cleanEnv, FORCE_COLOR: '1' };
    assert.ok(run([file], { env: forced }).stdout.includes(ESC));
    assert.ok(!run(['--no-color', file], { env: forced }).stdout.includes(ESC));
  });

  console.log('Unit test without starting a process (the file exports its functions)');
  check('count() handles empty text and a missing final newline', () => {
    const { count } = require('./09-mini-cli.js');
    assert.deepEqual(count(''), { lines: 0, words: 0, chars: 0 });
    assert.deepEqual(count('a\nb'), { lines: 2, words: 2, chars: 3 });
  });
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1; // the test script itself follows the exit code rule
