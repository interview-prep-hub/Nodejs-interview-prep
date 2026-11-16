// Interactive prompts with readline/promises, and how to test them by playing the user
// Run: node lessons/15-processes-and-cli/examples/11-prompts.js

const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');

const askScript = path.join(__dirname, '_helpers', 'ask.js'); // read it: it is a normal prompt script

// Starts ask.js and answers each question only AFTER the question has appeared, like a person would.
async function playUser(answers) {
  const child = spawn(process.execPath, [askScript], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  const pending = [...answers];
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    // Every question in ask.js ends with "? ", so a "?" means "the program is waiting for me".
    if (chunk.includes('?') && pending.length > 0) {
      child.stdin.write(`${pending.shift()}\n`);
    }
  });
  child.stderr.resume(); // we do not need stderr here, but an unread pipe could fill up
  const [code] = await once(child, 'close');
  return { code, stdout };
}

async function main() {
  console.log('1. A person answers one question at a time (we play the person)');
  let result = await playUser(['Ada', 'y']);
  console.log('  exit code:', result.code);
  console.log('  what the program printed:', JSON.stringify(result.stdout));

  console.log('2. The answer "n" cancels');
  result = await playUser(['Grace', 'n']);
  console.log('  what the program printed:', JSON.stringify(result.stdout));

  console.log('3. The trap: all answers arrive at the same moment (a pipe, not a person)');
  // Both lines are delivered before the second question exists. readline emits the second line
  // while nobody is waiting for it, so that answer is lost.
  let run = spawnSync(process.execPath, [askScript], { input: 'Ada\ny\n', encoding: 'utf8' });
  console.log('  exit code:', run.status);
  console.log('  stderr:', JSON.stringify(run.stderr.trim()));

  console.log('4. The input ends before the questions are answered (like pressing Ctrl+D)');
  run = spawnSync(process.execPath, [askScript], { input: 'Ada\n', encoding: 'utf8' });
  console.log('  exit code:', run.status);
  console.log('  stderr:', JSON.stringify(run.stderr.trim()));

  console.log('5. Without the guard in ask.js the same situation is silent');
  const unguarded = `
    const readline = require('node:readline/promises');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Name? ').then((name) => console.log('hello ' + name));
  `;
  run = spawnSync(process.execPath, ['-e', unguarded], { input: '', encoding: 'utf8' });
  console.log('  exit code:', run.status, '(success, although nobody answered)');
  console.log('  stdout:', JSON.stringify(run.stdout), '(the promise never settled, so "hello" never printed)');
}

main();
