// os and process: facts about the machine, and facts about this running program
// Run: node lessons/05-core-modules-tour/examples/04-os-and-process.js one two --flag=3
// @args one two --flag=3
// Numbers and names in the output are different on every machine. That is the point.
const os = require('node:os');
const path = require('node:path');

const toGiB = (bytes) => (bytes / 1024 ** 3).toFixed(1) + ' GiB';
// Hide the user name: show "~" instead of the home folder.
const hideHome = (p) => p.replace(os.homedir(), '~');

console.log('=== os: the machine ===');
console.log('platform:', os.platform()); // same value as process.platform
console.log('type:', os.type());
console.log('arch:', os.arch());
console.log('logical CPUs:', os.cpus().length, '| availableParallelism:', os.availableParallelism());
console.log('total memory:', toGiB(os.totalmem()));
console.log('free memory is less than total:', os.freemem() < os.totalmem());
console.log('home folder:', hideHome(os.homedir()));
console.log('temp folder:', hideHome(os.tmpdir()));
console.log('EOL:', JSON.stringify(os.EOL));
console.log('hostname is a non-empty string:', typeof os.hostname() === 'string' && os.hostname().length > 0);
console.log('uptime is a number:', typeof os.uptime() === 'number');

console.log('\n=== process: arguments ===');
console.log('argv length:', process.argv.length);
console.log('argv[0] is node:', path.parse(process.argv[0]).name);
console.log('argv[1] is this file:', path.basename(process.argv[1]));
console.log('your arguments:', process.argv.slice(2));
const hasFlag = process.argv.slice(2).some((arg) => arg.startsWith('--flag='));
console.log('--flag given?', hasFlag);

console.log('\n=== process: environment variables ===');
process.env.APP_MODE = 'demo'; // changes only THIS process, not your shell
process.env.RETRIES = 3; // works, but the value is turned into the string "3"
console.log('APP_MODE:', process.env.APP_MODE);
console.log('typeof RETRIES:', typeof process.env.RETRIES, '| value:', JSON.stringify(process.env.RETRIES));
console.log('missing variable:', process.env.NOT_SET_ANYWHERE);
const port = Number(process.env.PORT) || 3000; // the usual "env or default" pattern
console.log('port:', port);

console.log('\n=== process: where am I? ===');
console.log('cwd is the folder you started node in; __dirname is where this file lives');
console.log('cwd -> __dirname:', path.relative(process.cwd(), __dirname));
console.log('platform:', process.platform, '| arch:', process.arch);
console.log('Node major version:', process.version.split('.')[0]);

console.log('\n=== process: memory and time ===');
const mem = process.memoryUsage();
console.log('memory fields:', Object.keys(mem).join(', '));
console.log('heapUsed <= heapTotal:', mem.heapUsed <= mem.heapTotal);
console.log('rss (MB):', Math.round(mem.rss / 1024 / 1024));

const start = process.hrtime.bigint(); // nanoseconds, as a BigInt
let sum = 0;
for (let i = 0; i < 1e6; i++) sum += i;
const elapsedNs = process.hrtime.bigint() - start;
console.log('hrtime.bigint type:', typeof start);
console.log('loop took (ms):', (Number(elapsedNs) / 1e6).toFixed(2)); // BigInt -> Number -> ms
console.log('sum:', sum);

process.on('exit', (code) => console.log('\nexit event, code', code));
