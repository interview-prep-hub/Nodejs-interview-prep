// spawnSync, execFileSync, execSync, and fork() with messages between parent and child (IPC)
// Run: node lessons/15-processes-and-cli/examples/07-sync-and-fork.js

const path = require('node:path');
const { spawnSync, execFileSync, execSync, fork } = require('node:child_process');
const { once } = require('node:events');
const { inspect } = require('node:util');

const show = (value) => inspect(value, { breakLength: Infinity });

const node = process.execPath;
const helper = (name) => path.join(__dirname, '_helpers', name);

console.log('1. spawnSync blocks until the child ends and NEVER throws for a failing child');
let result = spawnSync(node, ['-e', 'console.log("hi"); console.error("oops"); process.exit(4)'], { encoding: 'utf8' });
console.log('  status:', result.status, '| signal:', result.signal, '| error:', result.error);
console.log('  stdout:', JSON.stringify(result.stdout), '| stderr:', JSON.stringify(result.stderr));
console.log('  keys:', Object.keys(result).join(', '));

console.log('2. spawnSync reports a program that cannot start in result.error');
result = spawnSync('this-program-does-not-exist', [], { encoding: 'utf8' });
console.log('  status:', result.status, '| error.code:', result.error.code);

console.log('3. spawnSync with a timeout');
result = spawnSync(node, [helper('sleepy.js'), '5000'], { timeout: 200, encoding: 'utf8' });
console.log('  status:', result.status, '| signal:', result.signal, '| error.code:', result.error.code);

console.log('4. spawnSync can send input to the child\'s stdin');
result = spawnSync(node, [helper('upper.js')], { input: 'text from the parent\n', encoding: 'utf8' });
console.log('  stdout:', JSON.stringify(result.stdout));

console.log('5. execFileSync returns the output, and THROWS if the child fails');
const out = execFileSync(node, ['-p', '40 + 2'], { encoding: 'utf8' });
console.log('  returned:', JSON.stringify(out));
const noEncoding = execFileSync(node, ['-p', '40 + 2']);
console.log('  without an encoding you get a Buffer:', Buffer.isBuffer(noEncoding));
try {
  execFileSync(node, [helper('exit-with.js'), 'usage'], { stdio: 'pipe' }); // "pipe" keeps the child's stderr quiet
} catch (err) {
  console.log('  it threw, err.status:', err.status, '| err.stderr has the text:', err.stderr.toString().includes('usage'));
}

console.log('6. execSync is the same with a shell string');
console.log('  returned:', JSON.stringify(execSync(`"${node}" -p "6 * 7"`, { encoding: 'utf8' })));

async function main() {
  console.log('7. fork() starts another Node script and opens a message channel');
  const child = fork(helper('worker.js'));
  console.log('  stdio has 4 entries (the 4th is the channel):', child.stdio.length);

  const [ready] = await once(child, 'message');
  console.log('  child says:', ready);

  child.send({ type: 'add', a: 2, b: 3 });
  const [answer] = await once(child, 'message');
  console.log('  child answered:', answer);

  console.log('8. What survives the trip? The default serializer is JSON');
  child.send({ type: 'inspect', map: new Map([['a', 1]]), date: new Date(0) });
  const [jsonView] = await once(child, 'message');
  console.log(' ', show(jsonView));

  child.send({ type: 'bye' });
  await once(child, 'close');
  console.log('  child exited by itself after process.disconnect(), exitCode:', child.exitCode);

  console.log('9. serialization: "advanced" keeps Map, Date and BigInt');
  const advanced = fork(helper('worker.js'), [], { serialization: 'advanced' });
  await once(advanced, 'message'); // ready
  advanced.send({ type: 'inspect', map: new Map([['a', 1]]), date: new Date(0), big: 5n });
  const [advancedView] = await once(advanced, 'message');
  console.log(' ', show(advancedView));
  advanced.send({ type: 'bye' });
  await once(advanced, 'close');

  console.log('10. A BigInt cannot be sent with the default JSON serializer');
  const third = fork(helper('worker.js'));
  await once(third, 'message');
  try {
    third.send({ type: 'inspect', big: 5n });
  } catch (err) {
    console.log('  send() threw:', err.name + ':', err.message);
  }
  third.send({ type: 'bye' });
  await once(third, 'close');
}

main();
