// The process object: arguments, environment variables, platform, memory and exit codes
// Run: node lessons/01-introduction/examples/07-process-basics.js alpha beta
// @args alpha beta

const path = require('node:path');

// --- Arguments: process.argv is an array of strings ---
console.log('argv[0] is the node program   :', process.argv[0] === process.execPath);
console.log('argv[1] is this script        :', path.basename(process.argv[1]));
console.log('your own arguments (slice(2)) :', process.argv.slice(2));

// --- Environment variables: process.env holds strings only ---
const who = process.env.GREETING_NAME ?? 'friend'; // ?? gives a default when the value is undefined
console.log(`Hello, ${who}! (set GREETING_NAME to change this)`);

process.env.PORT = 3000; // you can assign a number...
console.log('\nprocess.env.PORT is now       :', JSON.stringify(process.env.PORT), typeof process.env.PORT);
process.env.DEBUG = false; // ...but it is turned into the TEXT "false"
console.log('process.env.DEBUG is now      :', JSON.stringify(process.env.DEBUG), '-> truthy?', Boolean(process.env.DEBUG));
console.log('a variable nobody set         :', process.env.SURELY_NOT_SET_12345);

// --- Where am I and what machine is this? ---
// platform is 'win32' (Windows, even 64-bit), 'darwin' (macOS) or 'linux'
console.log('\nplatform                      :', process.platform);
console.log('cwd is an absolute path       :', path.isAbsolute(process.cwd()));
console.log('pid is a whole number         :', Number.isInteger(process.pid));
console.log('uptime is small (seconds)     :', process.uptime() < 5);
console.log('memoryUsage() fields          :', Object.keys(process.memoryUsage()).join(', '));

// --- Output: console.log is process.stdout.write plus a line break ---
process.stdout.write('written with stdout.write, ');
process.stdout.write('no line break yet...\n');

// --- Exit: the "exit" event fires last, and shows the exit code ---
console.log('\nexitCode before we set it     :', process.exitCode);
process.on('exit', (code) => {
  // Only synchronous code works here. The event loop is already finished.
  console.log('exit event, final code        :', code);
});
