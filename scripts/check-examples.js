'use strict';
// Runs every runnable example in lessons/*/examples and reports the result.
//
// Usage:
//   node scripts/check-examples.js                 run everything
//   node scripts/check-examples.js 08-event-loop   run only paths containing this text
//   node scripts/check-examples.js --verbose       also print the output of each example
//
// Conventions, read from the first 8 lines of each example file:
//   // @manual             skip it (needs a human, runs forever, or needs the internet)
//   // @expect-fail        the example is supposed to exit with a non-zero code
//   // @flags --foo --bar  extra flags passed to node
//   // @args a b c         extra arguments passed to the script
// Files or folders whose name starts with "_" are helpers and are never run directly.
// Files named *.test.js / *.test.mjs / *.test.ts are run with "node --test".

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const lessonsDir = path.join(root, 'lessons');
const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');
const filter = argv.find((a) => !a.startsWith('--'));
const TIMEOUT_MS = 45_000;
const RUNNABLE = /\.(js|mjs|cjs|ts)$/;
const TEST_FILE = /\.test\.(js|mjs|cjs|ts)$/;

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

function directive(source, name) {
  const head = source.split(/\r?\n/).slice(0, 8);
  const re = new RegExp(`^\\s*//\\s*@${name}\\b[ \\t]*(.*)$`);
  for (const line of head) {
    const m = line.match(re);
    if (m) return m[1].trim() || true;
  }
  return null;
}

function collect() {
  const files = [];
  if (!fs.existsSync(lessonsDir)) return files;
  for (const lesson of fs.readdirSync(lessonsDir, { withFileTypes: true })) {
    if (!lesson.isDirectory()) continue;
    const examples = path.join(lessonsDir, lesson.name, 'examples');
    if (!fs.existsSync(examples)) continue;
    for (const file of walk(examples)) {
      const rel = path.relative(examples, file).split(path.sep);
      if (rel.some((part) => part.startsWith('_'))) continue;
      if (!RUNNABLE.test(file)) continue;
      const display = path.relative(root, file).split(path.sep).join('/');
      if (filter && !display.includes(filter)) continue;
      files.push({ file, display });
    }
  }
  return files.sort((a, b) => a.display.localeCompare(b.display));
}

const files = collect();
let pass = 0;
let fail = 0;
let skip = 0;
const failures = [];

for (const { file, display } of files) {
  const source = fs.readFileSync(file, 'utf8');
  if (directive(source, 'manual')) {
    skip++;
    console.log(`SKIP  ${display}`);
    continue;
  }
  const expectFail = Boolean(directive(source, 'expect-fail'));
  const flags = directive(source, 'flags');
  const extra = directive(source, 'args');
  const nodeArgs = [
    ...(typeof flags === 'string' ? flags.split(/\s+/) : []),
    ...(TEST_FILE.test(file) ? ['--test'] : []),
    file,
    ...(typeof extra === 'string' ? extra.split(/\s+/) : []),
  ];
  const started = Date.now();
  const result = spawnSync(process.execPath, nodeArgs, {
    cwd: root,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const ms = Date.now() - started;
  const timedOut = result.error && result.error.code === 'ETIMEDOUT';
  const exitedNonZero = result.status !== 0;
  const ok = !timedOut && (expectFail ? exitedNonZero : !exitedNonZero);
  if (ok) {
    pass++;
    console.log(`PASS  ${display} (${ms} ms)`);
  } else {
    fail++;
    const why = timedOut ? `timed out after ${TIMEOUT_MS} ms` : `exit code ${result.status}${expectFail ? ' (expected non-zero)' : ''}`;
    console.log(`FAIL  ${display} (${why})`);
    failures.push({ display, why, stderr: (result.stderr || '').trim().split('\n').slice(-8).join('\n') });
  }
  if (verbose && result.stdout) console.log(result.stdout.replace(/^/gm, '      | '));
}

console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped, ${files.length} total`);
for (const f of failures) {
  console.log(`\n--- ${f.display}: ${f.why}\n${f.stderr}`);
}
process.exit(fail === 0 ? 0 : 1);
