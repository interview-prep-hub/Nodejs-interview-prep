// node:vm: separate global objects (contexts) inside one isolate, and why that is NOT a security sandbox
// Shows: what a new context has and lacks, cross-context gotchas, the timeout option, and a harmless escape.
// Run: node lessons/23-node-internals/examples/09-vm-not-a-sandbox.js

const vm = require('node:vm');

// ---- Part 1: a context is a fresh global object ------------------------------------------------
const sandbox = { price: 10, quantity: 3 };
vm.createContext(sandbox); // "contextify" the object: it becomes the global object of a new context
vm.runInContext('total = price * quantity; var note = "set inside"', sandbox);

console.log('Part 1: a new context');
console.log('  values written by the script appear on the sandbox object:', sandbox.total, '|', sandbox.note);
console.log('  inside the context, typeof process / require / console / setTimeout / URL:');
console.log('   ', vm.runInContext('[typeof process, typeof require, typeof console, typeof setTimeout, typeof URL].join(" / ")', sandbox));
vm.runInContext('console.log("this line is lost")', sandbox);
console.log('  console.log inside the context printed nothing: that console is V8\'s own, not Node\'s');
console.log('  but the JavaScript language itself is there (JSON, Math, Array, Promise):');
console.log('   ', vm.runInContext('[typeof JSON, typeof Math, typeof Array, typeof Promise].join(" / ")', sandbox));

// ---- Part 2: each context has its own built-ins ----------------------------------------------------
const foreignArray = vm.runInNewContext('[1, 2, 3]');
const foreignError = vm.runInNewContext('new Error("made in another context")');
console.log('\nPart 2: objects from another context');
console.log('  foreignArray instanceof Array :', foreignArray instanceof Array, '(different Array constructor)');
console.log('  Array.isArray(foreignArray)   :', Array.isArray(foreignArray), '(works across contexts)');
console.log('  foreignError instanceof Error :', foreignError instanceof Error);

// ---- Part 3: compile once, run many times; the timeout option -----------------------------------
const script = new vm.Script('count = (typeof count === "number" ? count : 0) + 1');
const counterContext = vm.createContext({});
script.runInContext(counterContext);
script.runInContext(counterContext);
script.runInContext(counterContext);

console.log('\nPart 3: vm.Script and timeout');
console.log('  one compiled script run 3 times in one context, count =', counterContext.count);
try {
  vm.runInNewContext('while (true) {}', {}, { timeout: 50 });
} catch (err) {
  console.log('  an endless loop was stopped by timeout:', err.code);
}

// ---- Part 4: why it is not a sandbox ----------------------------------------------------------------
// The "sandbox" object was created by the host. Every host object has a constructor, and that
// constructor is the HOST's Function. Calling it builds code in the host realm, with the host's globals.
console.log('\nPart 4: escaping (we only read process.version, nothing harmful)');
const escaped = vm.runInNewContext('this.constructor.constructor("return process")()', {});
console.log('  untrusted code reached the host process object:', escaped === process);
console.log('  it can read host data, for example process.version =', escaped.version);

// Passing in ANY host function has the same problem:
const viaFunction = vm.runInNewContext('log.constructor("return process")()', { log: console.log });
console.log('  same trick through a function we handed in    :', viaFunction === process);

console.log('\nConclusion: vm separates globals. It does not separate memory, CPU, or access to host objects.');
