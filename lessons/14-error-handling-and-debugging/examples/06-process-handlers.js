// Process-level failures: what Node does by default, and what uncaughtException / unhandledRejection handlers change
// Shows: a table of scenarios, each run in its own child process, with the real exit code.
// Run: node lessons/14-error-handling-and-debugging/examples/06-process-handlers.js

const { spawn } = require('node:child_process');
const path = require('node:path');

const child = path.join(__dirname, '_process-child.js');

// [scenario name, extra node flags, short description]
const scenarios = [
  ['throw', [], 'uncaught throw, no handler'],
  ['reject', [], 'unhandled rejection, no handler'],
  ['reject-string', [], 'rejection with a non-Error value'],
  ['emitter-error', [], "emit('error') with no listener"],
  ['reject-handler', [], 'unhandledRejection handler registered'],
  ['reject-late', [], 'catch attached late'],
  ['timer-throw-handler', [], 'uncaughtException handler registered'],
  ['reject-via-uncaught', [], 'rejection, only uncaughtException handler'],
  ['monitor', [], 'uncaughtExceptionMonitor only'],
  ['log-then-exit', [], 'handler logs, then process.exit(1)'],
  ['reject', ['--unhandled-rejections=warn'], 'same as "reject" but with --unhandled-rejections=warn'],
  ['exit-code', [], 'process.exitCode = 3'],
];

// Runs one scenario in a child process and collects its output and exit code.
function runScenario(name, flags) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [...flags, child, name]);
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => (stdout += chunk));
    proc.stderr.on('data', (chunk) => (stderr += chunk));
    proc.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

// The first line of stderr that looks like an error message (stack traces and file paths are skipped).
function errorLine(stderr) {
  const line = stderr
    .split(/\r?\n/)
    .map((l) => l.replace(/^\(node:\d+\) /, '')) // the process id changes on every run
    .find((l) => /^(\w*Error|UnhandledPromiseRejection)\b/.test(l) || l.startsWith('UnhandledPromiseRejectionWarning: '));
  if (!line) return '';
  return line.length > 72 ? `${line.slice(0, 72)}...` : line;
}

async function main() {
  // Start all children at once (faster), then print the results in the original order.
  const results = await Promise.all(scenarios.map(([name, flags]) => runScenario(name, flags)));

  console.log('exit  scenario');
  console.log('----  --------');
  scenarios.forEach(([, , description], i) => {
    const run = results[i];
    const survived = run.stdout.includes('timer ran') ? 'survived' : 'stopped';
    console.log(`${String(run.status).padEnd(4)}  ${description} (${survived})`);
    for (const line of run.stdout.split(/\r?\n/).filter((l) => l && l !== 'timer ran' && !l.startsWith('exit event'))) {
      console.log(`        stdout: ${line}`);
    }
    const err = errorLine(run.stderr);
    if (err) console.log(`        stderr: ${err}`);
  });
}

main();
