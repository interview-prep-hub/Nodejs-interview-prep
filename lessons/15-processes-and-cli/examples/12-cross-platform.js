// Cross-platform tips: path separators, line endings, shebang lines, .cmd shims, and spawning other programs
// Run: node lessons/15-processes-and-cli/examples/12-cross-platform.js
// The output depends on the operating system on purpose. The lesson README lists which lines change on Linux and macOS.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

console.log('1. Paths');
console.log('  platform:', process.platform);
console.log('  path.sep:', JSON.stringify(path.sep), '| path.delimiter (between PATH entries):', JSON.stringify(path.delimiter));
console.log('  path.join("a", "b", "c.txt"):', path.join('a', 'b', 'c.txt'));
console.log('  path.win32.join("a", "b", "c.txt"):', path.win32.join('a', 'b', 'c.txt'));
console.log('  path.posix.join("a", "b", "c.txt"):', path.posix.join('a', 'b', 'c.txt'));
console.log('  path.win32.basename("C:\\\\logs\\\\app.log"):', path.win32.basename('C:\\logs\\app.log'));
console.log('  path.posix.basename("C:\\\\logs\\\\app.log"):', path.posix.basename('C:\\logs\\app.log'), '(a backslash is just a letter on Linux)');
console.log('  forward slashes work on Windows too:', fs.existsSync(`${__dirname.split(path.sep).join('/')}/12-cross-platform.js`));

console.log('2. Line endings');
console.log('  os.EOL:', JSON.stringify(os.EOL), '| console.log always ends a line with "\\n"');
const windowsText = 'one\r\ntwo\nthree'; // a file edited on Windows, then on Linux
console.log('  split("\\n"):    ', JSON.stringify(windowsText.split('\n')), '<- the \\r stays on "one"');
console.log('  split(/\\r?\\n/): ', JSON.stringify(windowsText.split(/\r?\n/)));

console.log('3. A shebang line is only a comment for Node, on every platform');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xplat-demo-'));
const script = path.join(dir, 'tool.js');
fs.writeFileSync(script, '#!/usr/bin/env node\nconsole.log("the shebang line was skipped");\n');
let result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
console.log('  node tool.js ->', result.stdout.trim(), '| exit code', result.status);
fs.rmSync(dir, { recursive: true, force: true });

console.log('4. Starting npm: a .cmd shim is not a program');
// On Windows, "npm" is really npm.cmd, a batch file. Only a shell can run batch files.
result = spawnSync('npm', ['--version'], { encoding: 'utf8' });
console.log('  spawnSync("npm", ["--version"]):         status', result.status, '| error', result.error && result.error.code);
result = spawnSync('npm.cmd', ['--version'], { encoding: 'utf8' });
console.log('  spawnSync("npm.cmd", ["--version"]):     status', result.status, '| error', result.error && result.error.code);
result = spawnSync('npm --version', { shell: true, encoding: 'utf8' }); // one string, no args array: allowed, but only use fixed text here
console.log('  spawnSync("npm --version", {shell:true}): status', result.status, '| output looks like a version:', /^\d+\.\d+\.\d+/.test(result.stdout.trim()));

console.log('5. The portable way to run a Node script is process.execPath');
result = spawnSync(process.execPath, ['-p', '"works everywhere: " + process.platform'], { encoding: 'utf8' });
console.log(' ', result.stdout.trim());
