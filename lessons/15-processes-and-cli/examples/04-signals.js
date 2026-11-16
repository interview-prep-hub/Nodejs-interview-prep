// Signals: numbers, kill() on a child, why a signal handler may not run on Windows, and a graceful shutdown by message
// Run: node lessons/15-processes-and-cli/examples/04-signals.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const { inspect } = require('node:util');

const server = path.join(__dirname, '_helpers', 'graceful-server.js');

console.log('1. Signals are small numbers sent to a process');
const { signals } = os.constants;
console.log('  SIGHUP', signals.SIGHUP, '| SIGINT', signals.SIGINT, '| SIGKILL', signals.SIGKILL, '| SIGTERM', signals.SIGTERM);
console.log('  a shell reports "killed by SIGINT" as exit code 128 + 2 =', 128 + signals.SIGINT);
console.log('  a shell reports "killed by SIGTERM" as exit code 128 + 15 =', 128 + signals.SIGTERM);

console.log('2. process.kill(pid, 0) sends nothing, it only asks "does this process exist?"');
function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // it exists but belongs to someone else
  }
}
console.log('  this process:', isRunning(process.pid));

// Starts the server helper, waits until it is ready, stops it in the given way, and reports what happened.
async function stopServer(how) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-demo-'));
  const marker = path.join(dir, 'cleanup.txt');
  const child = fork(server, [marker], { silent: true }); // silent: true gives us child.stdout instead of sharing ours
  let output = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => (output += chunk));

  await once(child, 'message'); // the helper sends "ready" when its server listens
  const running = isRunning(child.pid);
  if (how === 'SIGTERM') child.kill('SIGTERM');
  else child.send('shutdown');
  // 'close' comes after 'exit' and after all of the child's output has been read.
  const [code, signal] = await once(child, 'close');

  const report = {
    stoppedWith: how,
    wasRunning: running,
    exitCode: code,
    exitSignal: signal,
    handlerRan: output.includes('shutdown requested'),
    cleanupRan: fs.existsSync(marker),
    stillRunning: isRunning(child.pid),
  };
  fs.rmSync(dir, { recursive: true, force: true });
  return report;
}

async function main() {
  console.log('3. Stop a child with child.kill("SIGTERM")');
  console.log('  platform:', process.platform);
  console.log(' ', inspect(await stopServer('SIGTERM'), { breakLength: Infinity }));
  console.log('  Windows: the child is terminated at once. No handler runs, exitSignal is SIGTERM, exitCode is null.');
  console.log('  Linux and macOS (documented): the SIGTERM handler runs, so handlerRan and cleanupRan are true and exitCode is 0.');

  console.log('4. Stop a child by sending it a message (works on every platform)');
  console.log(' ', inspect(await stopServer('message'), { breakLength: Infinity }));
}

main();
