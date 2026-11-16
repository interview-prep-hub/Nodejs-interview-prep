// Deprecations: which old APIs print a warning on Node 24, and how to find, silence or escalate them.
// Shows: each old API tried in a child process (so the warnings stay out of this output), then the flags that control warnings.
// Run: node lessons/22-modern-node-features/examples/12-deprecations.js

const { spawnSync } = require('node:child_process');

// Run a snippet of code in a fresh node process. A 'warning' listener inside it prints the warning's code.
// process.execPath is the running node binary; "-e" means "run this code".
function runSnippet(code, flags = []) {
  const listener = "process.on('warning', (w) => console.log(w.name + ' ' + w.code));";
  return spawnSync(process.execPath, [...flags, '-e', `${listener} ${code}`], { encoding: 'utf8' });
}

const cases = [
  ['new Buffer(5)', 'new Buffer(5)'],
  ['url.parse(...)', "require('node:url').parse('http://a.com/x?y=1')"],
  ['util._extend(...)', "require('node:util')._extend({}, {})"],
  ['util.isArray(...)', "require('node:util').isArray([])"],
  ["require('punycode')", "require('punycode')"],
  ['fs.F_OK', "require('node:fs').F_OK"],
  ['crypto.Hash(...) without new', "require('node:crypto').Hash('sha1')"],
  ['spawn(cmd, args, { shell: true })', "require('node:child_process').spawn('echo', ['a'], { shell: true }).on('error', () => {})"],
  ['new SlowBuffer(5)', "new (require('node:buffer').SlowBuffer)(5)"],
  ['fs.exists(...)', "require('node:fs').exists('x', () => {})"],
  ["require('node:domain')", "require('node:domain')"],
  ["process.binding('util')", "process.binding('util')"],
];

console.log('1. What Node 24 prints at runtime (a code means a real warning; "none" means docs-only deprecation)');
// One child process tries every case in turn. A warning is emitted on the next tick,
// so the child waits one turn of the event loop (setImmediate) after each case before it reads the code.
const childCode = `
  const cases = ${JSON.stringify(cases)};
  const codes = [];
  process.on('warning', (w) => codes.push(w.code));
  (async () => {
    for (const [label, code] of cases) {
      codes.length = 0;
      eval(code);
      await new Promise((resolve) => setImmediate(resolve));
      console.log(label.padEnd(36), codes[0] || 'none');
    }
  })();
`;
const table = spawnSync(process.execPath, ['-e', childCode], { encoding: 'utf8' });
for (const line of table.stdout.split(/\r?\n/).filter(Boolean)) console.log(`  ${line}`);

console.log('2. What a warning looks like on stderr (the process id differs on every run)');
const raw = spawnSync(process.execPath, ['-e', 'new Buffer(1)'], { encoding: 'utf8' });
for (const line of raw.stderr.split(/\r?\n/).filter(Boolean)) console.log(`  ${line.replace(/^\(node:\d+\) /, '')}`);

console.log('3. Flags that control warnings');
const noisy = 'new Buffer(1); console.log("script finished")';
const normal = runSnippet(noisy);
console.log('  default: exit', normal.status, '| stderr has a warning:', normal.stderr.includes('DEP0005'));

const silent = runSnippet(noisy, ['--no-deprecation']);
console.log('  --no-deprecation: exit', silent.status, '| stderr has a warning:', silent.stderr.includes('DEP0005'));

const strict = runSnippet(noisy, ['--throw-deprecation']);
console.log('  --throw-deprecation: exit', strict.status, '| the warning became an uncaught error:', strict.stderr.includes('DeprecationWarning'));

const trace = runSnippet(noisy, ['--trace-deprecation']);
console.log('  --trace-deprecation: stderr shows the call stack ("at ..."):', /\n\s+at /.test(trace.stderr));

const pending = runSnippet("process.binding('util')", ['--pending-deprecation']);
console.log('  --pending-deprecation: also reports docs-only APIs:', pending.stderr.includes('DEP0111'));
