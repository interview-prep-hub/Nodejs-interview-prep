'use strict';
// Checks every coding challenge under rounds/*/challenges/*.
//
// For each challenge folder:
//   1. The reference solution must pass its tests  (run with SOLUTION=1).
//   2. The starter / buggy code must FAIL its tests (otherwise the challenge proves nothing).
//   3. README.md, a solution/ folder and at least one *.test.js file must exist.
//
// Usage:
//   node scripts/check-challenges.js              check everything
//   node scripts/check-challenges.js debounce     check only folders whose path contains this text

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const roundsDir = path.join(root, 'rounds');
const filter = process.argv.slice(2).find((a) => !a.startsWith('--'));
const TIMEOUT_MS = 60_000;

function challengeDirs() {
  const out = [];
  if (!fs.existsSync(roundsDir)) return out;
  for (const round of fs.readdirSync(roundsDir, { withFileTypes: true })) {
    if (!round.isDirectory() || round.name.startsWith('_')) continue;
    const base = path.join(roundsDir, round.name, 'challenges');
    if (!fs.existsSync(base)) continue;
    for (const c of fs.readdirSync(base, { withFileTypes: true })) {
      if (!c.isDirectory() || c.name.startsWith('_')) continue;
      const dir = path.join(base, c.name);
      const display = path.relative(root, dir).split(path.sep).join('/');
      if (filter && !display.includes(filter)) continue;
      out.push({ dir, display });
    }
  }
  return out.sort((a, b) => a.display.localeCompare(b.display));
}

function runTests(dir, tests, useSolution) {
  const env = { ...process.env };
  if (useSolution) env.SOLUTION = '1';
  else delete env.SOLUTION;
  return spawnSync(process.execPath, ['--test', ...tests.map((t) => path.join(dir, t))], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

let bad = 0;
const dirs = challengeDirs();
for (const { dir, display } of dirs) {
  const problems = [];
  const entries = fs.readdirSync(dir);
  const tests = entries.filter((f) => /\.test\.(js|mjs|cjs)$/.test(f));
  if (!entries.includes('README.md')) problems.push('missing README.md');
  if (!entries.includes('solution')) problems.push('missing solution/ folder');
  if (tests.length === 0) problems.push('no *.test.js file');

  if (problems.length === 0) {
    const withSolution = runTests(dir, tests, true);
    if (withSolution.status !== 0) {
      problems.push('reference solution does NOT pass its tests');
      problems.push((withSolution.stdout + withSolution.stderr).trim().split('\n').slice(-12).join('\n'));
    }
    const withStarter = runTests(dir, tests, false);
    if (withStarter.status === 0) problems.push('starter code already passes all tests (it should fail until solved)');
    if (withStarter.status !== 0 && /SyntaxError|Cannot find module/.test(withStarter.stderr + withStarter.stdout)) {
      problems.push('starter code fails with a syntax/module error instead of failing tests cleanly');
    }
  }

  if (problems.length === 0) console.log(`OK    ${display}`);
  else {
    bad++;
    console.log(`BAD   ${display}`);
    for (const p of problems) console.log(`        ${p.replace(/\n/g, '\n        ')}`);
  }
}

console.log(`\n${dirs.length - bad} ok, ${bad} bad, ${dirs.length} total`);
process.exit(bad === 0 ? 0 : 1);
