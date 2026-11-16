// path.posix vs path.win32: the same functions with two different rule books
// Run: node lessons/05-core-modules-tour/examples/03-path-posix-win32.js
// We ask for each rule book by name, so the output is the same on every OS.
// The only lines that depend on your OS are the first two.
const path = require('node:path');

// The plain "path" module is one of the two, chosen by the OS you run on.
console.log('plain path is win32?', path === path.win32);
console.log('plain path is posix?', path === path.posix);

console.log('--- join ---');
console.log('posix:', path.posix.join('a', 'b', 'c.txt'));
console.log('win32:', path.win32.join('a', 'b', 'c.txt'));

console.log('--- a Windows path read with each rule book ---');
const winPath = 'C:\\Users\\ada\\notes.txt';
console.log('win32 basename:', path.win32.basename(winPath));
console.log('posix basename:', path.posix.basename(winPath)); // posix sees ONE odd file name
console.log('win32 root:', path.win32.parse(winPath).root);
console.log('posix root:', JSON.stringify(path.posix.parse(winPath).root));

console.log('--- absolute or not? ---');
console.log('win32 says C:\\Users\\ada\\notes.txt is absolute:', path.win32.isAbsolute(winPath));
console.log('posix says C:\\Users\\ada\\notes.txt is absolute:', path.posix.isAbsolute(winPath));
console.log('win32 says /x is absolute:', path.win32.isAbsolute('/x'));

console.log('--- resolve: the last absolute path wins ---');
console.log(path.posix.resolve('/app', '/data', 'x'));
console.log(path.win32.resolve('C:\\app', 'D:\\data', 'x')); // a new drive restarts the path

console.log('--- the Windows reader accepts both slashes ---');
console.log(path.win32.normalize('C:/Users/ada//docs/../notes.txt'));
console.log(path.posix.normalize('/Users/ada//docs/../notes.txt'));

console.log('--- URLs and archive entries must always use forward slashes ---');
console.log('wrong on Windows:', path.win32.join('/api', 'users', '42'));
console.log('right everywhere:', path.posix.join('/api', 'users', '42'));

console.log('--- turn a native path into a slash path ---');
const toSlashes = (p) => p.split(path.sep).join('/'); // prints the same text on every OS
console.log(toSlashes(path.join('src', 'lib', 'index.js')));
