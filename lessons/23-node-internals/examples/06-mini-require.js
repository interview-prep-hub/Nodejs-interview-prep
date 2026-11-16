// How require() works: a tiny re-implementation (resolve, cache, wrapper, compile) checked against the real one
// Shows: relative files, directories, node_modules, JSON, the cache, circular imports and the exports trap.
// Run: node lessons/23-node-internals/examples/06-mini-require.js

const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

// =============================== the mini require ===============================
function isFile(p) {
  return fs.existsSync(p) && fs.statSync(p).isFile();
}

// Step 1, resolve: turn the text in require('...') into one absolute file name.
function tryFile(p) {
  if (isFile(p)) return p;
  for (const ext of ['.js', '.json']) if (isFile(p + ext)) return p + ext;
  return null;
}
function tryDirectory(p) {
  const pkgFile = path.join(p, 'package.json');
  if (isFile(pkgFile)) {
    const main = JSON.parse(fs.readFileSync(pkgFile, 'utf8')).main;
    if (main) return tryFile(path.join(p, main)) || tryDirectory(path.join(p, main));
  }
  return tryFile(path.join(p, 'index'));
}
function resolve(request, fromDir) {
  if (/^(\.{1,2}\/|\/)/.test(request)) {
    const found = tryFile(path.resolve(fromDir, request)) || tryDirectory(path.resolve(fromDir, request));
    if (found) return found;
  } else {
    // A bare name like "greeter": look in ./node_modules, then ../node_modules, and so on up to the root.
    for (const dir of Module._nodeModulePaths(fromDir)) {
      const found = tryFile(path.join(dir, request)) || tryDirectory(path.join(dir, request));
      if (found) return found;
    }
  }
  const err = new Error(`Cannot find module '${request}'`);
  err.code = 'MODULE_NOT_FOUND';
  throw err;
}

function createMiniRequire(entryDir) {
  const cache = new Map(); // absolute file name -> module object

  function load(request, parentDir) {
    if (request.startsWith('node:') || Module.isBuiltin(request)) return require(request); // core modules
    const filename = resolve(request, parentDir); // step 1
    if (cache.has(filename)) return cache.get(filename).exports; // step 2: the cache

    const mod = { id: filename, filename, exports: {}, loaded: false };
    cache.set(filename, mod); // put it in the cache BEFORE running it: this is what makes cycles work
    try {
      compileAndRun(mod); // steps 3 and 4
    } catch (err) {
      cache.delete(filename); // a module that threw is not cached
      throw err;
    }
    mod.loaded = true;
    return mod.exports;
  }

  function compileAndRun(mod) {
    const source = fs.readFileSync(mod.filename, 'utf8');
    if (mod.filename.endsWith('.json')) {
      mod.exports = JSON.parse(source);
      return;
    }
    // Step 3, wrap and compile: the file becomes the body of a function. This is why top-level
    // variables are private to the file, and where exports, require, module, __filename, __dirname come from.
    const fn = vm.compileFunction(source, ['exports', 'require', 'module', '__filename', '__dirname'], { filename: mod.filename });
    const dir = path.dirname(mod.filename);
    const localRequire = (id) => load(id, dir);
    // Step 4, run: "this" at the top of a module is module.exports.
    fn.call(mod.exports, mod.exports, localRequire, mod, mod.filename, dir);
  }

  const miniRequire = (id) => load(id, entryDir);
  miniRequire.cache = cache;
  return miniRequire;
}

// =============================== test fixtures ===============================
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-require-'));
function write(name, text) {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
const T = "const trace = (m) => globalThis.__trace.push(m);\n";
write('entry.js', T + `
trace('entry starts');
const counter = require('./lib/counter');
const again = require('./lib/counter'); // second require: must come from the cache
const a = require('./lib/a');
const trap = require('./lib/exports-trap');
module.exports = {
  sameInstance: counter === again,
  counterCalls: [counter.next(), again.next()],
  circular: require('./lib/b').sawA,
  aDone: a.done,
  json: require('./data.json'),
  directory: require('./lib/util').name,
  nodeModules: require('greeter')('world'),
  core: typeof require('node:path').join,
  trap: JSON.stringify(trap),
  thisIsExports: this === module.exports,
};
trace('entry ends');
`);
write('lib/counter.js', T + "trace('counter.js evaluated'); let n = 0; module.exports = { next: () => ++n };\n");
write('lib/a.js', T + "trace('a starts'); exports.early = 'a-early'; const b = require('./b'); trace('a sees b.sawA=' + b.sawA); exports.done = true;\n");
write('lib/b.js', T + "trace('b starts'); const a = require('./a'); exports.sawA = 'keys of a so far: ' + Object.keys(a).join(); trace('b ends');\n");
write('lib/util/index.js', "exports.name = 'util/index.js';\n");
write('lib/exports-trap.js', "exports = { lost: true }; // only changes the local variable\n");
write('data.json', '{"answer":42}');
write('node_modules/greeter/package.json', '{"name":"greeter","main":"src/main.js"}');
write('node_modules/greeter/src/main.js', "module.exports = (who) => 'hello ' + who;\n");

// =============================== run both and compare ===============================
console.log('The classic wrapper that Node used to put around every file (Module.wrap):');
console.log(Module.wrap('BODY'));

globalThis.__trace = [];
const mini = createMiniRequire(dir);
const miniResult = mini('./entry.js');
const miniTrace = globalThis.__trace.slice();

globalThis.__trace = [];
const realResult = require(path.join(dir, 'entry.js'));
const realTrace = globalThis.__trace.slice();

console.log('\nOrder in which the files ran (mini require):');
miniTrace.forEach((line, i) => console.log(`  ${i + 1}. ${line}`));

console.log('\nWhat entry.js exported (mini require):');
console.log(miniResult);

let missing;
try {
  mini('./nope');
} catch (err) {
  missing = err.code;
}
console.log('\nrequire of a missing file fails with code:', missing);
console.log('Modules in the mini cache:', mini.cache.size, '(keys are absolute file names)');
console.log('Same trace as the real require :', JSON.stringify(miniTrace) === JSON.stringify(realTrace));
console.log('Same exports as the real require:', JSON.stringify(miniResult) === JSON.stringify(realResult));

fs.rmSync(dir, { recursive: true, force: true });
