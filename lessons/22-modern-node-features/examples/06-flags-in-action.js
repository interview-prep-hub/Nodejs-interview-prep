// Node command-line flags that replace tools: --env-file (dotenv), --run (npm run), --watch (nodemon), --permission.
// Shows: each flag on a tiny script in a temp folder. Every command starts a new node process, so the commands run at the same time to keep this short.
// Run: node lessons/22-modern-node-features/examples/06-flags-in-action.js

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'modern-flags-'));
const file = (name) => path.join(dir, name);
const write = (name, text) => fs.writeFileSync(file(name), text);

// Run node with some flags and resolve with its output as a list of lines. process.execPath is the running node binary.
function node(args, { env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: dir,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (text) => (stdout += text));
    child.stderr.on('data', (text) => (stderr += text));
    child.on('error', reject);
    // stderr first: that is where Node prints its own messages, before the script runs.
    child.on('close', () => resolve([...stderr.split(/\r?\n/), ...stdout.split(/\r?\n/)].filter(Boolean)));
  });
}
// Hide the machine-specific parts (temp folder, node.exe location) so the output looks the same everywhere.
const clean = (line) => line.replaceAll(dir, '<temp>').replaceAll(process.execPath, 'node').replaceAll('\\', '/');
const show = (lines) => lines.forEach((line) => console.log(`    ${clean(line)}`));

// Start a watched script, edit it once it is running, and resolve when the second version has printed.
function watchDemo() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--watch', 'watched.js'], { cwd: dir, stdio: ['ignore', 'pipe', 'inherit'] });
    let output = '';
    let edited = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('watch mode did not restart in time'));
    }, 15000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (text) => {
      output += text;
      if (!edited && output.includes('version 1') && output.includes('Waiting for file changes')) {
        edited = true;
        write('watched.js', "console.log('watched script, version 2');\n"); // this edit triggers the restart
      }
      if (output.includes('version 2')) {
        clearTimeout(timer);
        child.once('close', resolve); // wait until the watcher has really stopped, so the folder can be deleted
        child.kill();
      }
    });
    child.on('error', reject);
  });
}

async function main() {
  // Create every file first, then start all the node processes at once and print the results in order.
  write('show.js', "console.log('GREETING =', process.env.GREETING, '| PORT =', process.env.PORT);\n");
  write('a.env', 'GREETING=hello from a.env\nPORT=3000\n');
  write('b.env', 'PORT=4000\n');
  write('package.json', JSON.stringify({ scripts: { prehello: 'node pre.js', hello: 'node hello.js' } }, null, 2));
  write('pre.js', "console.log('pre script ran');\n");
  write('hello.js', "console.log('hello script ran, extra args:', process.argv.slice(2));\n");
  write('watched.js', "console.log('watched script, version 1');\n");
  write('secret.txt', 'top secret');
  write(
    'perm.js',
    `const fs = require('node:fs');
console.log('process.permission is', typeof process.permission);
try {
  fs.readFileSync(__dirname + '/secret.txt');
  console.log('read: allowed');
} catch (err) {
  console.log('read:', err.code, '|', err.permission);
}
try {
  fs.writeFileSync(__dirname + '/new.txt', 'x');
  console.log('write: allowed');
} catch (err) {
  console.log('write:', err.code, '|', err.permission);
}
`,
  );

  const [plain, fromShell, twoFiles, missing, ifExists, runHello, runMissing, permOff, permOn, permRead] = await Promise.all([
    node([`--env-file=${file('a.env')}`, 'show.js']),
    node([`--env-file=${file('a.env')}`, 'show.js'], { env: { GREETING: 'hello from the shell' } }),
    node([`--env-file=${file('a.env')}`, `--env-file=${file('b.env')}`, 'show.js']),
    node([`--env-file=${file('missing.env')}`, 'show.js']),
    node([`--env-file-if-exists=${file('missing.env')}`, 'show.js']),
    node(['--run', 'hello', '--', '--loud']),
    node(['--run', 'nothing']),
    node(['perm.js']),
    node(['--permission', 'perm.js']),
    node(['--permission', `--allow-fs-read=${dir}`, 'perm.js']),
    watchDemo().then(() => null),
  ]);

  console.log('1. --env-file loads a .env file before your code starts (no dotenv needed)');
  console.log('  node --env-file=a.env show.js');
  show(plain);
  console.log('  a variable already set in the shell wins over the file:');
  show(fromShell);
  console.log('  two files: the later one wins:');
  show(twoFiles);
  console.log('  a missing file is an error, unless you use --env-file-if-exists:');
  show(missing.slice(0, 1));
  show(ifExists);

  console.log('2. node --run runs a script from package.json (no npm needed)');
  console.log('  node --run hello -- --loud');
  show(runHello);
  console.log('  node --run nothing');
  show(runMissing.slice(0, 1));

  console.log('3. --watch restarts the script when a file changes (no nodemon needed)');
  console.log('    saw version 1, then (after the edit) version 2');

  console.log('4. --permission locks the process down (needs Node 22.13+ / 24; before that the flag was --experimental-permission)');
  console.log('  node perm.js (no flag)');
  show(permOff);
  console.log('  node --permission perm.js');
  show(permOn);
  console.log('  node --permission --allow-fs-read=<temp folder> perm.js');
  show(permRead);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  // maxRetries: on Windows a folder can stay locked for a moment after a child process that used it has exited.
  .finally(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
