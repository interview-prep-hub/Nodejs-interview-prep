// exec vs execFile: buffered output, the shell, command injection, exit codes, maxBuffer, timeout, promisified
// Run: node lessons/15-processes-and-cli/examples/05-exec-execfile.js

const path = require('node:path');
const util = require('node:util');
const childProcess = require('node:child_process');

// promisify makes both functions return a promise of { stdout, stderr }.
const exec = util.promisify(childProcess.exec);
const execFile = util.promisify(childProcess.execFile);

const node = process.execPath;
const helper = (name) => path.join(__dirname, '_helpers', name);
// Inside a command STRING we must add the quotes ourselves, because the path may contain spaces.
const q = (text) => `"${text}"`;
const lines = (text) => text.trim().split(/\r?\n/);
// "echo INJECTED" prints INJECTED on a line of its own. A greeting that merely contains the word does not count.
const ranSecondCommand = (stdout) => lines(stdout).includes('INJECTED');

async function main() {
  console.log('1. exec runs a command STRING through a shell and gives you all the output at the end');
  let result = await exec(`${q(node)} ${q(helper('greet.js'))} Ada`);
  console.log('  stdout:', JSON.stringify(result.stdout.trim()), '| stderr:', JSON.stringify(result.stderr));

  console.log('2. execFile runs a program with an ARRAY of arguments and no shell');
  result = await execFile(node, [helper('greet.js'), 'Grace']);
  console.log('  stdout:', JSON.stringify(result.stdout.trim()));

  console.log('3. Command injection: what the shell does with user input');
  const userInput = 'bob & echo INJECTED'; // imagine this came from a web form
  result = await exec(`${q(node)} ${q(helper('greet.js'))} ${userInput}`);
  console.log('  exec (shell):        ', JSON.stringify(lines(result.stdout)));
  console.log('  second command ran:', ranSecondCommand(result.stdout));
  result = await execFile(node, [helper('greet.js'), userInput]);
  console.log('  execFile (no shell): ', JSON.stringify(lines(result.stdout)));
  console.log('  second command ran:', ranSecondCommand(result.stdout));

  console.log('4. A non-zero exit code makes the promise reject (the callback gets an error)');
  try {
    await execFile(node, [helper('exit-with.js'), 'usage']);
  } catch (err) {
    console.log('  err.code (the exit code):', err.code);
    console.log('  err.killed:', err.killed, '| err.signal:', err.signal);
    console.log('  err.stderr:', JSON.stringify(err.stderr.trim()));
    console.log('  err.message starts with "Command failed":', err.message.startsWith('Command failed'));
  }

  console.log('5. A program that cannot be started rejects too (a string code this time)');
  try {
    await execFile('this-program-does-not-exist', []);
  } catch (err) {
    console.log('  err.code:', err.code, '| err.path:', err.path);
  }

  console.log('6. maxBuffer: output bigger than the limit stops the child and rejects');
  try {
    await execFile(node, [helper('noisy.js'), '5000'], { maxBuffer: 1000 });
  } catch (err) {
    console.log('  err.code:', err.code);
    console.log('  we still got the first part, stdout length:', err.stdout.length);
  }
  result = await execFile(node, [helper('noisy.js'), '5000'], { maxBuffer: 10_000 });
  console.log('  with a bigger maxBuffer the same program works, length:', result.stdout.length);

  console.log('7. timeout: the child is killed when it takes too long');
  const started = Date.now();
  try {
    await execFile(node, [helper('sleepy.js'), '5000'], { timeout: 300 });
  } catch (err) {
    const took = Date.now() - started;
    console.log('  err.killed:', err.killed, '| err.signal:', err.signal, '| err.code:', err.code);
    console.log('  gave up long before 5 seconds:', took < 3000);
  }
}

main();
