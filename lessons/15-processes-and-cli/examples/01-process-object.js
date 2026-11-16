// The process object: identity, arguments, working directory, timing, memory, standard streams, warnings, nextTick
// Run: node lessons/15-processes-and-cli/examples/01-process-object.js

const path = require('node:path');
const os = require('node:os');
const { Stream } = require('node:stream');
const { parseArgs } = require('node:util');

// Values that change on every run (pid, uptime, memory numbers) are printed as types or booleans on purpose.

console.log('1. Who am I?');
console.log('  pid is a number:', typeof process.pid === 'number', '| ppid is a number:', typeof process.ppid === 'number');
console.log('  platform:', process.platform, '| arch:', process.arch);
console.log('  version:', process.version, '| same as versions.node:', process.version === `v${process.versions.node}`);
console.log('  versions has v8 and uv:', 'v8' in process.versions, 'uv' in process.versions);
console.log('  release name:', process.release.name);
console.log('  execPath is the node binary:', path.basename(process.execPath).startsWith('node'));

console.log('2. Arguments');
console.log('  argv[0] is execPath:', process.argv[0] === process.execPath);
console.log('  argv[1] is this script:', path.basename(process.argv[1]));
console.log('  script arguments (argv.slice(2)):', process.argv.slice(2));
console.log('  execArgv (flags for node itself):', process.execArgv);

console.log('2b. util.parseArgs turns an argument list into values (shown here with a fixed list)');
const demo = parseArgs({
  args: ['--port', '8080', '-v', 'a.txt', '--tag=x', '--tag=y', '--', '--not-a-flag'],
  options: {
    port: { type: 'string', short: 'p', default: '3000' },
    verbose: { type: 'boolean', short: 'v' },
    tag: { type: 'string', multiple: true },
  },
  allowPositionals: true,
});
console.log('  values:', { ...demo.values });
console.log('  positionals:', demo.positionals);
try {
  parseArgs({ args: ['--prot', '8080'], options: { port: { type: 'string' } } });
} catch (err) {
  console.log('  a typo throws:', err.code);
}

console.log('3. Working directory');
const startDir = process.cwd();
console.log('  relative paths use cwd:', path.resolve('data.txt') === path.join(process.cwd(), 'data.txt'));
process.chdir(os.tmpdir());
console.log('  after chdir, cwd changed:', process.cwd() !== startDir);
process.chdir(startDir); // put it back
console.log('  restored:', process.cwd() === startDir);
console.log('  __dirname is where this file lives (not the cwd):', path.basename(__dirname));

console.log('4. Time');
const t0 = process.hrtime.bigint(); // nanoseconds as a BigInt
const until = Date.now() + 25;
while (Date.now() < until) {} // busy wait, only for the demo
const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
console.log('  hrtime.bigint() returns a bigint:', typeof t0);
console.log('  busy wait took at least 25 ms:', elapsedMs >= 24);
console.log('  uptime() is seconds since start:', typeof process.uptime(), process.uptime() < 5);

console.log('5. Memory and CPU');
const before = process.memoryUsage();
console.log('  memoryUsage keys:', Object.keys(before).join(', '));
const big = Buffer.alloc(10 * 1024 * 1024); // 10 MiB lives outside the JS heap
const after = process.memoryUsage();
console.log('  arrayBuffers grew by about 10 MiB:', after.arrayBuffers - before.arrayBuffers >= 10 * 1024 * 1024);
console.log('  rss() is a fast number:', process.memoryUsage.rss() > 0, '| big.length:', big.length);
const cpuStart = process.cpuUsage();
const spinUntil = Date.now() + 80;
while (Date.now() < spinUntil) {}
const cpu = process.cpuUsage(cpuStart); // difference since cpuStart, in microseconds
console.log('  cpuUsage(previous) gives user/system microseconds:', Object.keys(cpu).join(', '), '| used some CPU:', cpu.user + cpu.system > 0);
const usage = process.resourceUsage();
console.log('  resourceUsage has maxRSS and context switches:', typeof usage.maxRSS, typeof usage.voluntaryContextSwitches);

console.log('6. Standard streams');
console.log('  stdin, stdout, stderr are streams:', [process.stdin, process.stdout, process.stderr].every((s) => s instanceof Stream));
console.log('  file descriptors:', process.stdin.fd, process.stdout.fd, process.stderr.fd);
const ok = process.stdout.write('  written with stdout.write (no automatic newline)\n');
console.log('  write() returned a boolean:', typeof ok === 'boolean');
console.error('  this line goes to stderr, not stdout');

console.log('7. Warnings and nextTick');
process.on('warning', (warning) => {
  console.log(`  warning event: name=${warning.name} code=${warning.code} message="${warning.message}"`);
});
process.emitWarning('disk is almost full', { type: 'DiskWarning', code: 'DISK001', detail: 'Only 2 percent left.' });
process.nextTick(() => console.log('  nextTick callback'));
Promise.resolve().then(() => console.log('  promise callback'));
console.log('  end of the script (synchronous part)');
