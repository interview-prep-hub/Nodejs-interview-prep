// spawn: streaming output, 'exit' vs 'close', the 'error' event, stdio options, writing to stdin, piping, kill, abort,
// the cwd and env options, and what happens when the reader of a pipe goes away early (EPIPE)
// Run: node lessons/15-processes-and-cli/examples/06-spawn-stdio.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

const node = process.execPath;
const helper = (name) => path.join(__dirname, '_helpers', name);

async function main() {
  console.log('1. spawn returns at once, and the output arrives in pieces');
  let child = spawn(node, [helper('count-up.js'), '3', '40']);
  console.log('  child.pid is a number:', typeof child.pid === 'number');
  child.stdout.setEncoding('utf8'); // turn Buffers into strings
  child.stdout.on('data', (chunk) => console.log('  data:', JSON.stringify(chunk)));
  child.on('exit', (code, signal) => console.log(`  exit event: code=${code} signal=${signal}`));
  child.on('close', (code, signal) => console.log(`  close event: code=${code} signal=${signal} (after all stdio is closed)`));
  await once(child, 'close');

  console.log('2. A program that cannot start emits "error" (and no "exit")');
  child = spawn('this-program-does-not-exist', ['a']);
  console.log('  child.pid:', child.pid);
  child.on('exit', () => console.log('  exit event (not expected)'));
  const [err] = await once(child, 'error');
  console.log('  error event:', err.code);

  console.log('3. stdio: "pipe" (default), "inherit" and "ignore"');
  child = spawn(node, ['-p', '"printed by the child"'], { stdio: 'inherit' });
  console.log('  with "inherit" child.stdout is', child.stdout, '(the child writes straight to our terminal)');
  await once(child, 'close');
  child = spawn(node, ['-p', '"you never see this"'], { stdio: 'ignore' });
  await once(child, 'close');
  console.log('  with "ignore" the output was thrown away');
  child = spawn(node, ['-e', 'console.log("out"); console.error("err")'], { stdio: ['ignore', 'pipe', 'ignore'] });
  console.log('  [stdin, stdout, stderr] = ["ignore", "pipe", "ignore"] gives:', child.stdin, typeof child.stdout.pipe, child.stderr);
  child.stdout.resume(); // read and discard so the child can finish
  await once(child, 'close');

  console.log('4. Writing to the child\'s stdin and reading all its output');
  child = spawn(node, [helper('upper.js')]);
  child.stdin.write('hello ');
  child.stdin.end('world\n'); // end() closes stdin, so the child sees "end of input"
  let text = '';
  for await (const chunk of child.stdout) text += chunk; // streams are async iterables
  console.log('  child answered:', JSON.stringify(text));
  await once(child, 'close');

  console.log('5. A pipeline like "a | b": connect one child\'s stdout to another child\'s stdin');
  const producer = spawn(node, ['-e', 'console.log("first line"); console.log("second line")']);
  const filter = spawn(node, [helper('upper.js')]);
  producer.stdout.pipe(filter.stdin);
  let piped = '';
  filter.stdout.setEncoding('utf8');
  filter.stdout.on('data', (chunk) => (piped += chunk));
  await once(filter, 'close');
  console.log('  result:', JSON.stringify(piped));

  console.log('6. child.stdout.pipe(process.stdout) shows the child\'s output as if it were ours');
  child = spawn(node, ['-e', 'console.log("hello from a child, piped to our stdout")']);
  child.stdout.pipe(process.stdout);
  await once(child, 'close');

  console.log('7. kill() asks a child to stop');
  child = spawn(node, [helper('sleepy.js'), '10000']);
  console.log('  kill() returned:', child.kill()); // sends SIGTERM by default
  const [code, signal] = await once(child, 'close');
  console.log(`  close event: code=${code} signal=${signal} | child.killed=${child.killed}`);

  console.log('8. An AbortSignal can stop a child too (handy for timeouts)');
  const controller = new AbortController();
  child = spawn(node, [helper('sleepy.js'), '10000'], { signal: controller.signal });
  child.on('error', (error) => console.log('  error event:', error.name)); // abort() makes the child emit 'error'
  const closed = new Promise((resolve) => child.on('close', resolve)); // events.once would reject on that 'error'
  setTimeout(() => controller.abort(), 100);
  await closed;
  console.log('  child was stopped, signalCode:', child.signalCode);

  console.log('9. spawn has built-in timeout and killSignal options');
  child = spawn(node, [helper('sleepy.js'), '10000'], { timeout: 150, killSignal: 'SIGTERM' });
  const [timedCode, timedSignal] = await once(child, 'close');
  console.log(`  close event: code=${timedCode} signal=${timedSignal}`);

  console.log('10. cwd and env decide where the child runs and what it can see');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spawn-demo-'));
  child = spawn(node, ['-p', 'JSON.stringify([process.cwd(), process.env.GREETING])'], {
    cwd: dir, // the child starts in this folder
    env: { ...process.env, GREETING: 'hi from the parent' }, // copy our variables, then add one
  });
  let json = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => (json += chunk));
  await once(child, 'close');
  const [childCwd, greeting] = JSON.parse(json);
  console.log('  child ran in the folder we gave it:', fs.realpathSync(childCwd) === fs.realpathSync(dir));
  console.log('  child saw the variable we added:', JSON.stringify(greeting));
  fs.rmSync(dir, { recursive: true, force: true });

  console.log('11. The reader goes away early (like "program | head -n 1"): EPIPE');
  // chatty.js prints 100000 lines. We read the first chunk and then close our end of the pipe.
  async function readerLeaves(args) {
    const chatty = spawn(node, [helper('chatty.js'), ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    chatty.stderr.setEncoding('utf8');
    chatty.stderr.on('data', (chunk) => (stderr += chunk));
    await once(chatty.stdout, 'data'); // the first chunk
    chatty.stdout.destroy(); // we stop reading: the next write in the child fails with EPIPE
    const [exitCode] = await once(chatty, 'close');
    return { exitCode, mentionsEpipe: stderr.includes('EPIPE') };
  }
  const [crashed, quiet] = await Promise.all([readerLeaves([]), readerLeaves(['--quiet'])]);
  console.log('  without a handler:       exit code', crashed.exitCode, '| stderr mentions EPIPE:', crashed.mentionsEpipe);
  console.log('  with an "error" handler: exit code', quiet.exitCode, '| stderr mentions EPIPE:', quiet.mentionsEpipe);
}

main();
