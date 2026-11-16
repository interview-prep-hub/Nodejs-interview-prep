// The logging side of debugging: console tricks, errors as log data, util.debuglog / NODE_DEBUG, DEBUG-style logs, --inspect
// Shows: tools that need no debugger. Parts 6, 7 and 8 start a child process so they can set environment variables and flags.
// Run: node lessons/14-error-handling-and-debugging/examples/10-console-and-debuglog.js

const { spawnSync } = require('node:child_process');
const { Console } = require('node:console');
const { Writable } = require('node:stream');
const util = require('node:util');

// ---------------------------------------------------------------------------
// When this file runs as the child of part 6, 7 or 8, it only does the small job below and stops.
if (process.argv[2] === 'debuglog-child') {
  const debug = util.debuglog('myapp'); // section names are case-insensitive
  const debugDb = util.debuglog('myapp-db');
  console.log(`enabled: myapp=${debug.enabled} myapp-db=${debugDb.enabled}`);
  debug('connected to %s on port %d', 'localhost', 5432);
  debugDb('query took %d ms', 12);
  process.exit(0);
}

if (process.argv[2] === 'dotdebug-child') {
  // A tiny version of the popular "debug" package: DEBUG=app:* turns on matching namespaces.
  const patterns = (process.env.DEBUG ?? '')
    .split(',')
    .filter(Boolean)
    .map((p) => new RegExp(`^${p.replaceAll('*', '.*')}$`));
  const createDebug = (namespace) => {
    const on = patterns.some((re) => re.test(namespace));
    return (...args) => on && console.error(namespace, util.format(...args));
  };
  createDebug('app:http')('GET /health took %d ms', 3);
  createDebug('app:db')('SELECT 1');
  createDebug('other:thing')('this is never printed');
  process.exit(0);
}

if (process.argv[2] === 'inspect-child') {
  console.log('inspector url:', require('node:inspector').url());
  process.exit(0);
}

// ---------------------------------------------------------------------------
console.log('1. console.log format specifiers and console.table');
console.log('  %s is %d years old, config: %j, object: %o', 'Ada', 36, { debug: true }, { a: 1 });
console.table([
  { id: 1, name: 'Ada', role: 'admin' },
  { id: 2, name: 'Linus', role: 'user' },
]);
console.table([{ id: 1, name: 'Ada', role: 'admin' }], ['name']); // only some columns

console.log('2. console.dir and util.inspect: see deep objects');
const deep = { a: { b: { c: { d: { e: 'deep' } } } } };
console.log('  console.log stops at depth 2:', deep);
console.log('  util.inspect with depth null:', util.inspect(deep, { depth: null, compact: true, breakLength: Infinity }));
console.log('  console.dir with depth null :');
console.dir(deep, { depth: null });

console.log('3. Group, count, assert and trace (stderr output is captured here so it prints in order)');
const lines = [];
const sink = new Writable({
  write(chunk, enc, cb) {
    lines.push(chunk.toString().trimEnd());
    cb();
  },
});
const capture = new Console({ stdout: sink, stderr: sink });
capture.group('request 17');
capture.log('step one');
capture.count('retries');
capture.count('retries');
capture.groupEnd();
capture.assert(1 + 1 === 3, 'math is broken'); // does NOT throw, only prints
function inner() {
  capture.trace('who called me?'); // prints the stack to stderr, the program keeps going
}
function outer() {
  inner();
}
outer();
for (const text of lines) {
  const [first, ...frames] = text.split('\n');
  // A trace has one "at function (file:line:col)" line per frame. We print only the function names.
  const names = frames.map((f) => f.trim().match(/^at (\S+)/)?.[1]).filter(Boolean);
  console.log(`  | ${first}${names.length ? ` (frames: ${names.slice(0, 2).join(' <- ')})` : ''}`);
}

console.log('4. console.time measures a block (the number changes on every run)');
console.time('sum');
let total = 0;
for (let i = 0; i < 1e6; i++) total += i;
console.timeEnd('sum'); // prints "sum: 0.7ms" or similar

// ---------------------------------------------------------------------------
console.log('5. Log errors as DATA: JSON.stringify(err) is "{}", so serialize the parts you need');
function serializeError(err, { stack = true } = {}) {
  if (!(err instanceof Error)) return { value: util.inspect(err) };
  return {
    name: err.name,
    message: err.message,
    code: err.code,
    stack: stack ? err.stack : undefined,
    cause: err.cause === undefined ? undefined : serializeError(err.cause, { stack }),
  };
}
const failure = new Error('Could not save order', { cause: Object.assign(new Error('reset by peer'), { code: 'ECONNRESET' }) });
console.log('  JSON.stringify(err)        :', JSON.stringify(failure));
const record = serializeError(failure, { stack: false }); // stack left out only to keep the printed line short
console.log('  serialized cause.code      :', record.cause.code);
console.log('  one JSON line per event    :', JSON.stringify({ level: 'error', msg: 'save failed', err: record }));
console.log('  by default the record also has a stack string:', typeof serializeError(failure).stack);

// ---------------------------------------------------------------------------
console.log('6. util.debuglog and NODE_DEBUG: debug lines that cost nothing until you switch them on');
function child(mode, env, flags = []) {
  const run = spawnSync(process.execPath, [...flags, __filename, mode], { encoding: 'utf8', env: { ...process.env, NODE_DEBUG: '', DEBUG: '', ...env } });
  const clean = (text) => text.replace(/(\w+) \d+:/g, '$1 <pid>:').trimEnd();
  return { out: clean(run.stdout), err: clean(run.stderr) };
}
for (const value of ['', 'myapp', 'myapp*']) {
  const { out, err } = child('debuglog-child', { NODE_DEBUG: value });
  console.log(`  NODE_DEBUG=${JSON.stringify(value)}`);
  console.log(`    stdout: ${out}`);
  console.log(`    stderr: ${err.replace(/\r?\n/g, '\n            ') || '(nothing)'}`);
}

console.log('7. The same idea in the style of the "debug" package: DEBUG=app:*');
const dbg = child('dotdebug-child', { DEBUG: 'app:*' });
console.log(`  DEBUG=app:*  stderr: ${dbg.err.replace(/\r?\n/g, '\n               ')}`);

console.log('8. The debugger statement and --inspect');
debugger; // eslint-disable-line no-debugger
console.log('  "debugger;" did nothing: no debugger is attached, so Node ignores it');
console.log('  inspector.url() here        :', require('node:inspector').url());
const inspected = spawnSync(process.execPath, ['--inspect=0', __filename, 'inspect-child'], { encoding: 'utf8' });
const wsUrl = /ws:\/\/127\.0\.0\.1:\d+\/[0-9a-f-]+/;
console.log('  with --inspect=0, stderr says:', (inspected.stderr.match(/Debugger listening on .*/) ?? [''])[0].replace(wsUrl, 'ws://127.0.0.1:<port>/<id>'));
console.log('  and inspector.url() returns   :', inspected.stdout.trim().replace('inspector url: ', '').replace(wsUrl, 'ws://127.0.0.1:<port>/<id>'));
