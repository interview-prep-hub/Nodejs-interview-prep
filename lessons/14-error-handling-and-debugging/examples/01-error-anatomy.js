// Anatomy of an Error: name, message, stack, cause, code, built-in types, system errors, throwing non-errors
// Run: node lessons/14-error-handling-and-debugging/examples/01-error-anatomy.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const util = require('node:util');

console.log('1. The parts of an Error');
const err = new Error('Could not load profile', { cause: new Error('disk is full') });
err.code = 'E_PROFILE'; // custom extra property
console.log('  name    :', err.name);
console.log('  message :', err.message);
console.log('  code    :', err.code);
console.log('  cause   :', err.cause.message);
console.log('  stack[0]:', err.stack.split('\n')[0]);
console.log('  stack[1] starts with "at":', err.stack.split('\n')[1].trim().startsWith('at '));
console.log('  toString():', String(err));
console.log('  Object.keys:', Object.keys(err));
console.log('  JSON.stringify:', JSON.stringify(err));
console.log('  instanceof Error:', err instanceof Error, '| Error.isError:', Error.isError(err));

console.log('2. Built-in error types (each one triggered for real)');
const triggers = {
  TypeError: () => {
    const user = undefined;
    return user.name;
  },
  RangeError: () => new Array(-1),
  SyntaxError: () => JSON.parse('{bad json}'),
  ReferenceError: () => notDefinedAnywhere + 1, // eslint-disable-line no-undef
  URIError: () => decodeURIComponent('%'),
};
for (const [label, run] of Object.entries(triggers)) {
  try {
    run();
  } catch (e) {
    console.log(`  ${label.padEnd(14)} name=${e.name} | ${e.message}`);
  }
}
const group = new AggregateError([new Error('first'), new TypeError('second')], 'Several things failed');
console.log('  AggregateError name=%s | %s | errors=%d', group.name, group.message, group.errors.length);
console.log('  inner errors:', group.errors.map((e) => `${e.name}: ${e.message}`));

console.log('3. System errors carry code, errno and syscall');
try {
  fs.readFileSync(path.join(os.tmpdir(), 'no-such-folder-14', 'missing.txt'));
} catch (e) {
  console.log('  code   :', e.code);
  console.log('  syscall:', e.syscall);
  console.log('  errno is a negative number:', e.errno < 0, '| name by number:', util.getSystemErrorName(e.errno));
  console.log('  has path:', typeof e.path === 'string');
  console.log('  message starts with:', e.message.split(',')[0]);
}

console.log('4. Errors made by Node itself have a code starting with ERR_');
try {
  fs.readFileSync({ not: 'a path' });
} catch (e) {
  console.log('  name   :', e.name);
  console.log('  code   :', e.code);
  console.log('  stack[0]:', e.stack.split('\n')[0].slice(0, 60) + '...');
}

console.log('5. JavaScript lets you throw anything, so always throw an Error');
for (const thrown of ['oops', 42, { code: 7 }, null]) {
  try {
    throw thrown;
  } catch (e) {
    console.log(`  threw ${JSON.stringify(thrown)}: typeof=${typeof e}, has stack=${Boolean(e && e.stack)}`);
  }
}
// A small helper many codebases use: turn anything into a real Error.
function toError(value) {
  if (Error.isError(value)) return value;
  return new Error(typeof value === 'string' ? value : `Non-error thrown: ${util.inspect(value)}`);
}
console.log('  toError({ code: 7 }).message =', toError({ code: 7 }).message);

console.log('6. The stack is captured when the Error is CREATED, not when it is thrown');
function makeIt() {
  return new Error('made here');
}
function throwIt(e) {
  throw e;
}
try {
  throwIt(makeIt());
} catch (e) {
  const frames = e.stack.split('\n').slice(1, 3).map((line) => line.trim().split(' ')[1]);
  console.log('  top frames:', frames);
}
console.log('  creating an Error and not throwing it does nothing:', new Error('ignored') instanceof Error);

console.log('7. Three more kinds you will meet: stack overflow, AssertionError, DOMException');
function endless() {
  return endless() + 1;
}
try {
  endless();
} catch (e) {
  console.log(`  stack overflow: ${e.name}: ${e.message} (a normal error, you can catch it)`);
}
try {
  assert.equal(1, 2);
} catch (e) {
  console.log(`  assert        : ${e.name} | code ${e.code} | instanceof Error: ${e instanceof Error}`);
}
const controller = new AbortController();
controller.abort(); // cancel on purpose
const reason = controller.signal.reason;
console.log(`  abort         : ${reason.name} | code ${reason.code} | DOMException: ${reason instanceof DOMException} | Error: ${reason instanceof Error}`);
