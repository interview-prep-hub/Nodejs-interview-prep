// Exit codes: 0 and non-zero, process.exitCode vs process.exit(), crashes, and the 'beforeExit' / 'exit' events
// Run: node lessons/15-processes-and-cli/examples/03-exit-codes.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const helpers = path.join(__dirname, '_helpers');

// Runs a helper script in a NEW process and returns what a shell would see: the exit code and the output.
function runHelper(script, ...args) {
  return spawnSync(process.execPath, [path.join(helpers, script), ...args], { encoding: 'utf8' });
}

console.log('1. The exit code tells the caller what happened');
const modes = [
  ['ok', 'script ends normally'],
  ['fail', 'process.exitCode = 1'],
  ['usage', 'process.exitCode = 2 (wrong usage)'],
  ['throw', 'uncaught exception'],
  ['reject', 'unhandled promise rejection'],
  ['signal-style', 'process.exit(143) = 128 + 15, "killed by SIGTERM"'],
  ['no-such-mode', 'helper rejects the mode'],
];
const results = {};
for (const [mode, meaning] of modes) {
  const result = runHelper('exit-with.js', mode);
  results[mode] = result; // kept so that part 2 does not need to start the same program again
  console.log(`  ${mode.padEnd(13)} exit code ${String(result.status).padEnd(3)} ${meaning}`);
}

console.log('2. A crash prints the error on stderr and exits with 1');
const crash = results.throw;
console.log('  stderr mentions the message:', crash.stderr.includes('Error: boom'));
console.log('  stdout is empty:', crash.stdout === '');

console.log('3. process.exit() stops at once, process.exitCode lets pending work finish');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exit-demo-'));
for (const mode of ['exit-cut', 'exit-code']) {
  const file = path.join(dir, `${mode}.txt`);
  const result = runHelper('exit-with.js', mode, file);
  const saved = fs.existsSync(file);
  console.log(`  ${mode.padEnd(9)} exit code ${result.status} | timer fired: ${result.stdout.includes('timer fired')} | file saved: ${saved}`);
}
fs.rmSync(dir, { recursive: true, force: true });

console.log('4. The beforeExit and exit events');
console.log('  --- natural end (the event loop becomes empty) ---');
console.log(runHelper('lifecycle.js').stdout.trimEnd().replace(/^/gm, '  | '));
console.log('  --- explicit process.exit(0) ---');
console.log(runHelper('lifecycle.js', 'explicit').stdout.trimEnd().replace(/^/gm, '  | '));

console.log('5. Setting process.exitCode inside this very script');
process.on('exit', (code) => {
  // Runs just before this process ends. Only synchronous work works here.
  console.log(`  [exit event] code is ${code}`);
});
process.exitCode = 0; // 0 is already the default; change it to 3 and check "echo $?" (bash) or "$LASTEXITCODE" (PowerShell)
console.log('  last line of the script');
