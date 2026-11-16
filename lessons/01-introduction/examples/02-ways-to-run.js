// Ways to run Node: node file.js, node -p, node -e and the REPL (shown from inside a script)
// Run: node lessons/01-introduction/examples/02-ways-to-run.js

const { spawnSync } = require('node:child_process');

// process.execPath is the full path of the node program running this file.
// We start a second node process with different arguments and show what it prints.
function runNode(args, input) {
  return spawnSync(process.execPath, args, { input, encoding: 'utf8' });
}

// 1. node -p "code": evaluate the code and PRINT the value of the last expression.
const p = runNode(['-p', '6 * 7']);
console.log('node -p "6 * 7"            prints:', p.stdout.trim());

// 2. node -e "code": evaluate the code. It prints only what the code prints itself.
const e1 = runNode(['-e', '6 * 7']);
console.log('node -e "6 * 7"            prints:', JSON.stringify(e1.stdout));
const e2 = runNode(['-e', 'console.log(6 * 7)']);
console.log('node -e "console.log(6*7)" prints:', JSON.stringify(e2.stdout.trim()));

// 3. The exit code tells the shell if the program worked. 0 means success.
const failing = runNode(['-e', 'process.exitCode = 3']);
console.log('exit code after process.exitCode = 3:', failing.status);

// 4. The REPL (Read, Eval, Print, Loop). "-i" forces interactive mode even though
//    we feed the lines from a pipe instead of a keyboard.
const lines = [
  '1 + 1',
  '_ * 10', //          _ holds the result of the previous line
  'typeof fs', //       core modules like fs are already loaded in the REPL
  'node app.js', //     a classic beginner mistake: typing the shell command inside the REPL
  '.exit',
];
const repl = runNode(['-i'], lines.join('\n') + '\n');

// Drop the two welcome lines because they contain the version number.
const replOutput = repl.stdout.split('\n').slice(2).join('\n').trim();
console.log('\nREPL session output:');
console.log(replOutput);
