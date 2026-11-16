'use strict';
// Runs the tests of one coding challenge.
//
// Usage:
//   npm run challenge -- debounce              test YOUR code in the challenge folder
//   npm run challenge -- debounce --solution   test the reference solution
//
// The name can be any part of the challenge folder path, as long as it matches exactly one folder.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const roundsDir = path.join(root, 'rounds');
const args = process.argv.slice(2);
const useSolution = args.includes('--solution');
const query = args.find((a) => !a.startsWith('--'));

if (!query) {
  console.error('Usage: npm run challenge -- <part-of-challenge-name> [--solution]');
  process.exit(2);
}

const matches = [];
for (const round of fs.existsSync(roundsDir) ? fs.readdirSync(roundsDir, { withFileTypes: true }) : []) {
  if (!round.isDirectory() || round.name.startsWith('_')) continue;
  const base = path.join(roundsDir, round.name, 'challenges');
  if (!fs.existsSync(base)) continue;
  for (const c of fs.readdirSync(base, { withFileTypes: true })) {
    if (!c.isDirectory() || c.name.startsWith('_')) continue;
    const display = `${round.name}/challenges/${c.name}`;
    if (display.includes(query)) matches.push({ dir: path.join(base, c.name), display });
  }
}

if (matches.length !== 1) {
  console.error(matches.length === 0 ? `No challenge matches "${query}".` : `"${query}" matches ${matches.length} challenges, be more specific:`);
  for (const m of matches) console.error(`  ${m.display}`);
  process.exit(2);
}

const { dir, display } = matches[0];
const tests = fs.readdirSync(dir).filter((f) => /\.test\.(js|mjs|cjs)$/.test(f)).map((f) => path.join(dir, f));
console.log(`Running ${display}${useSolution ? ' (reference solution)' : ''}\n`);
const env = { ...process.env };
if (useSolution) env.SOLUTION = '1';
else delete env.SOLUTION;
const result = spawnSync(process.execPath, ['--test', ...tests], { cwd: root, env, stdio: 'inherit' });
process.exit(result.status === null ? 1 : result.status);
