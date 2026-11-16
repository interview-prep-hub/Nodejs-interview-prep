// Custom error classes: name, code, statusCode, cause chains, captureStackTrace, and instanceof across realms
// Run: node lessons/14-error-handling-and-debugging/examples/04-custom-errors.js

const util = require('node:util');
const vm = require('node:vm');

// ---------------------------------------------------------------------------
// A small hierarchy. Every app error has a stable machine-readable code and an HTTP status.
class AppError extends Error {
  constructor(message, { code = 'E_APP', statusCode = 500, details, cause, isOperational = true } = {}) {
    super(message, cause === undefined ? undefined : { cause }); // the 2nd argument stores err.cause
    this.name = new.target.name; // "NotFoundError", not just "Error"
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.isOperational = isOperational;
    // Common in real code. It makes the stack start at the code that did 'new', not inside this constructor.
    // V8 already does this for classes that extend Error, so on Node 24 it is optional but harmless.
    Error.captureStackTrace(this, new.target);
  }

  // JSON.stringify(err) normally drops message and stack. This makes the error safe to send to a client.
  toJSON() {
    return { name: this.name, code: this.code, message: this.message, details: this.details };
  }
}

class NotFoundError extends AppError {
  constructor(what, options) {
    super(`${what} was not found`, { code: 'E_NOT_FOUND', statusCode: 404, ...options });
  }
}

class ValidationError extends AppError {
  constructor(message, details, options) {
    super(message, { code: 'E_VALIDATION', statusCode: 400, details, ...options });
  }
}

class DatabaseError extends AppError {
  constructor(message, options) {
    super(message, { code: 'E_DB', statusCode: 500, ...options });
  }
}

console.log('1. Creating and inspecting a custom error');
const nf = new NotFoundError('User 42');
console.log('  name      :', nf.name);
console.log('  message   :', nf.message);
console.log('  code      :', nf.code, '| statusCode:', nf.statusCode);
console.log('  stack[0]  :', nf.stack.split('\n')[0]);
console.log('  toString():', String(nf));
console.log('  JSON      :', JSON.stringify(nf));

console.log('2. instanceof walks the class chain (nf is the NotFoundError from part 1)');
console.log('  nf instanceof NotFoundError    :', nf instanceof NotFoundError);
console.log('  nf instanceof AppError         :', nf instanceof AppError);
console.log('  nf instanceof Error            :', nf instanceof Error);
console.log('  nf instanceof ValidationError  :', nf instanceof ValidationError);

console.log('3. Set the name, or your logs only say "Error"');
class Forgetful extends Error {} // no this.name
class Named extends Error {
  constructor(message) {
    super(message);
    this.name = 'Named'; // named, and no captureStackTrace call
  }
}
function createIt() {
  return new Named('x');
}
const firstLine = (e) => e.stack.split('\n')[0];
const topFrame = (e) => e.stack.split('\n')[1].trim().split(' ')[1];
console.log('  forgot the name      :', firstLine(new Forgetful('x')));
console.log('  set the name         :', firstLine(createIt()));
console.log('  top frame, no capture:', topFrame(createIt()), '(V8 already hides the constructor frame)');

console.log('4. Wrapping a low-level error with cause keeps the full story');
function saveOrder() {
  try {
    const low = new Error('connection reset by peer');
    low.code = 'ECONNRESET';
    throw low;
  } catch (cause) {
    throw new DatabaseError('Could not save the order', { cause });
  }
}
try {
  saveOrder();
} catch (err) {
  let level = 0;
  for (let e = err; e; e = e.cause) {
    console.log(`  ${'  '.repeat(level)}${e.name}${e.code ? ` [${e.code}]` : ''}: ${e.message}`);
    level++;
  }
  console.log('  util.inspect shows it too:', util.inspect(err).includes('[cause]'));
}

console.log('5. Error.captureStackTrace(obj, fn) hides helper frames');
function assertPositive(n) {
  if (n > 0) return;
  const err = new RangeError(`expected a positive number, got ${n}`);
  Error.captureStackTrace(err, assertPositive); // frames from assertPositive upward are cut off
  throw err;
}
function checkout(total) {
  assertPositive(total);
}
try {
  checkout(-5);
} catch (e) {
  const top = e.stack.split('\n')[1].trim().split(' ')[1];
  console.log('  top frame points at the CALLER of the helper:', top);
}

console.log('6. instanceof can fail across realms and duplicate packages');
const foreign = vm.runInNewContext('new Error("made in another realm")');
console.log('  foreign instanceof Error     :', foreign instanceof Error);
console.log('  Error.isError(foreign)       :', Error.isError(foreign));
console.log('  util.types.isNativeError     :', util.types.isNativeError(foreign));
console.log('  Object.prototype.toString    :', Object.prototype.toString.call(foreign));

// Two copies of "the same" class (for example two installed versions of one package) are different classes.
const makeClass = () => class ApiError extends Error {};
const CopyA = makeClass();
const CopyB = makeClass();
console.log('  new CopyA() instanceof CopyB :', new CopyA('x') instanceof CopyB);
// Safer checks across boundaries: compare the stable code or name, not the class.
const looksLikeNotFound = (e) => Boolean(e) && e.code === 'E_NOT_FOUND';
console.log('  check by code works anywhere :', looksLikeNotFound(nf));
