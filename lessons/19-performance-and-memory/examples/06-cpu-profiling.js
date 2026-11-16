// CPU profiling: run a program with --cpu-prof and with --prof, then read what the profilers wrote
// Run: node lessons/19-performance-and-memory/examples/06-cpu-profiling.js
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { printTop } = require('./_profile-utils');

const workload = path.join(__dirname, '_cpu-workload.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpu-profiling-'));

// ---- Part 1: --cpu-prof writes a .cpuprofile file when the program exits -----------------
// Equivalent shell command:  node --cpu-prof --cpu-prof-dir=some/folder _cpu-workload.js
const run1 = spawnSync(process.execPath, ['--cpu-prof', '--cpu-prof-dir=' + dir, workload], { encoding: 'utf8' });
console.log('--- 1. node --cpu-prof (program output follows)');
console.log(run1.stdout.trim().replace(/^/gm, '   | '));

const profileFile = fs.readdirSync(dir).find((name) => name.endsWith('.cpuprofile'));
console.log('\nfile written:', profileFile.replace(/^CPU\.\d+\.\d+\.\d+/, 'CPU.<date>.<time>.<pid>'));
const profile = JSON.parse(fs.readFileSync(path.join(dir, profileFile), 'utf8'));
console.log('keys in the file:', Object.keys(profile).join(', '));
console.log('call tree nodes:', profile.nodes.length, '| samples taken:', profile.samples.length);
console.log('\nfunctions with the most SELF time (time with that function on top of the stack):');
printTop(profile, 5);
console.log('(open the file in Chrome DevTools or VS Code to see the same data as a flame graph)');

// ---- Part 2: --prof writes a V8 tick log; --prof-process turns it into text ----------------
// The log file is written into the current directory, so we run the child inside our temp folder.
const run2 = spawnSync(process.execPath, ['--prof', workload], { cwd: dir, encoding: 'utf8' });
const logFile = fs.readdirSync(dir).find((name) => /^isolate.*\.log$/.test(name));
console.log('\n--- 2. node --prof');
console.log('log written:', logFile ? 'isolate-<address>-<pid>-v8.log' : 'none', '| program exit code:', run2.status);

const text = spawnSync(process.execPath, ['--prof-process', path.join(dir, logFile)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout;
const lines = text.split('\n');
// Print one table of the report: from its title line up to the first empty line.
function section(title) {
  const start = lines.findIndex((l) => l.trim() === title);
  const out = [];
  for (let i = start; i < lines.length && lines[i].trim() !== ''; i++) out.push(lines[i]);
  return out;
}
for (const title of ['[JavaScript]:', '[Summary]:']) {
  // shorten long file paths so the table stays readable
  console.log(section(title).map((l) => l.replace(/[A-Za-z]:\\[^ ]*[\\/]/g, '')).join('\n') + '\n');
}

fs.rmSync(dir, { recursive: true, force: true });
