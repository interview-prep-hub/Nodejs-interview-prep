// A tour of the node --test command line: file discovery, name patterns, only, timeouts,
// reporters, failure output, coverage, and two classic mistakes. Plain script (not a test file).
// Run: node lessons/16-testing/examples/03-run-flags.js
//
// It starts `node --test ...` as a child process for each step, all at the same time (so the
// whole tour takes a few seconds), then prints the steps in order.
// To keep the output stable, durations are shown as "Nms" and stack trace lines are dropped.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');
const fixtures = 'lessons/16-testing/examples/_fixtures';

function clean(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\\/g, '/')
    .replace(/\((\d+(?:\.\d+)?)ms\)/g, '(Nms)')
    .replace(/(duration_ms:?) \d+(?:\.\d+)?/g, '$1 N')
    .replace(/^\s+at .*\n/gm, '')
    .trimEnd();
}

// Start node with these arguments. Never rejects: a failing test run is a normal result here.
function runNode(args, cwd = repoRoot) {
  return new Promise((resolve) => {
    execFile(process.execPath, args, { cwd, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({ output: clean(`${stdout}${stderr}`), status: error ? error.code : 0 });
    });
  });
}

// How you would type an argument in a shell: quote the value if it has special characters.
function show(arg) {
  if (!/[\s|^*]/.test(arg)) return arg;
  const equals = arg.indexOf('=');
  return arg.startsWith('--') && equals > 0 ? `${arg.slice(0, equals + 1)}"${arg.slice(equals + 1)}"` : `"${arg}"`;
}
const withoutSummary = (line) => !/^ℹ (suites|cancelled|skipped|todo|duration_ms)/.test(line);

const sample = `${fixtures}/sample-suite.js`;
const onlySuite = `${fixtures}/only-suite.js`;
const failing = `${fixtures}/failing-suite.js`;
const gradeSuite = `${fixtures}/grade-suite.js`;
const dependent = `${fixtures}/order-dependent-suite.js`;
const twoTests = ['--test-name-pattern=adds', sample];
const coverage = ['--test', '--experimental-test-coverage'];

const steps = [
  { title: '2a. Only tests whose name matches "adds"', args: ['--test', '--test-name-pattern=adds', sample], keep: withoutSummary },
  { title: '2b. Skip tests whose name matches "slow|strings"', args: ['--test', '--test-skip-pattern=slow|strings', sample], keep: withoutSummary },
  { title: '3a. A test marked only, WITHOUT --test-only (everything runs)', args: ['--test', onlySuite], keep: withoutSummary },
  { title: '3b. The same file WITH --test-only', args: ['--test', '--test-only', onlySuite], keep: withoutSummary },
  {
    title: '4. --test-timeout=100 against a 300 ms test',
    args: ['--test', '--test-timeout=100', sample],
    keep: (line) => !/^ℹ (suites|skipped|todo|duration_ms)/.test(line),
  },
  { title: '5a. --test-reporter=spec (the default)', args: ['--test', '--test-reporter=spec', ...twoTests] },
  { title: '5b. --test-reporter=dot (one character per test, X is a failure; first line only)', args: ['--test', '--test-reporter=dot', failing], head: 1 },
  { title: '5c. --test-reporter=tap', args: ['--test', '--test-reporter=tap', ...twoTests] },
  {
    title: '6. A failing suite',
    args: ['--test', failing],
    keep: (line) => !/generatedMessage|code: 'ERR_ASSERTION'|operator:|diff: 'simple'|^\s+(actual|expected):|^ {2}\}$/.test(line),
  },
  {
    title: '7a. Coverage report',
    args: [...coverage, gradeSuite],
    keep: (line) => !/^ℹ (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)/.test(line) && !/^✔/.test(line),
  },
  {
    title: '7b. Coverage with thresholds that are too high',
    args: [...coverage, '--test-coverage-lines=90', '--test-coverage-functions=100', gradeSuite],
    keep: (line) => /threshold/.test(line),
  },
  {
    title: '8a. Forgot to await an assertion',
    args: ['--test', `${fixtures}/forgot-await-suite.js`],
    keep: (line) => !/^ℹ (suites|cancelled|skipped|todo|duration_ms)/.test(line),
  },
  { title: '8b. Tests that depend on each other: run together', args: ['--test', dependent], keep: withoutSummary },
  {
    title: '8c. ...and test B run alone',
    args: ['--test', '--test-name-pattern=^B', dependent],
    keep: (line) => /^[✔✖﹣]|^ℹ (tests|pass|fail)|!==/.test(line),
  },
  {
    title: '8d. --test-randomize with a fixed seed (Node 24.16+, early development) finds the hidden dependency',
    args: ['--test', '--test-randomize', '--test-random-seed=1', dependent],
    keep: (line) => /^[✔✖﹣]|^ℹ (Randomized|tests|pass|fail)/.test(line),
  },
];

// Step 1 builds a temp folder full of differently named files and runs `node --test` inside it.
async function discoveryStep() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-'));
  const names = [
    'a.test.js', 'b.spec.js', 'test-c.js', 'd-test.js', 'e_test.js', 'g.js', 'test.js',
    'test/f.js', 'node_modules/pkg/h.test.js', 'deep/er/i.test.mjs', 'deep/er/j.test.cjs', 'k.test.ts',
  ];
  try {
    for (const name of names) {
      const file = path.join(tmp, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const body = name.endsWith('.mjs') || name.endsWith('.ts')
        ? `import { test } from 'node:test';\ntest('${name}', () => {});\n`
        : `require('node:test').test('${name}', () => {});\n`;
      fs.writeFileSync(file, body);
    }
    const { output } = await runNode(['--test'], tmp);
    const ran = output
      .split('\n')
      .filter((line) => line.startsWith('✔'))
      .map((line) => line.replace(/^✔ | \(Nms\)$/g, ''))
      .sort();
    const notRan = names.filter((name) => !ran.includes(name));
    return [
      '=== 1. File discovery (a temp folder with many file names) ===',
      '$ node --test        (run inside the temp folder)',
      `  ran:         ${ran.join('  ')}`,
      `  NOT ran:     ${notRan.join('  ')}`,
    ].join('\n');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function runStep({ title, args, keep, head }) {
  const { output, status } = await runNode(args);
  let lines = output.split('\n');
  if (keep) lines = lines.filter(keep);
  if (head) lines = lines.slice(0, head);
  return [
    `\n=== ${title} ===`,
    `$ node ${args.map(show).join(' ')}`,
    lines.map((line) => `  ${line}`).join('\n'),
    `  (exit code ${status})`,
  ].join('\n');
}

async function main() {
  const results = await Promise.all([discoveryStep(), ...steps.map(runStep)]);
  console.log(results.join('\n'));
}

main();
