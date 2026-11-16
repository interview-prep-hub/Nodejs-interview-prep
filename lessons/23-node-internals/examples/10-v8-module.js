// The v8 module: heap numbers, serialize/deserialize, isolates versus contexts, and a startup snapshot
// Shows: what you can ask V8 from JavaScript, and the difference between one isolate with many contexts and many isolates.
// Run: node lessons/23-node-internals/examples/10-v8-module.js

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const v8 = require('node:v8');
const vm = require('node:vm');
const { Worker } = require('node:worker_threads');

const MiB = 1024 * 1024;

// ---- Part 1: heap statistics --------------------------------------------------------------
function part1() {
  const before = v8.getHeapStatistics();
  const keep = Array.from({ length: 500000 }, (_, i) => ({ i, text: 'item ' + i }));
  const after = v8.getHeapStatistics();
  console.log('Part 1: v8.getHeapStatistics()');
  console.log('  fields returned                     :', Object.keys(before).length);
  console.log('  used_heap_size <= total_heap_size   :', before.used_heap_size <= before.total_heap_size);
  console.log('  total_heap_size < heap_size_limit   :', before.total_heap_size < before.heap_size_limit);
  console.log(`  500000 small objects grew the heap by more than 20 MiB: ${after.used_heap_size - before.used_heap_size > 20 * MiB} (kept alive: ${keep.length})`);
  console.log('  heap spaces:', v8.getHeapSpaceStatistics().map((s) => s.space_name).filter((n) => !n.includes('shared') && !n.includes('trusted')).join(', '));
}

// ---- Part 2: serialize and deserialize ---------------------------------------------------------
// The structured clone algorithm: what JSON cannot carry, v8.serialize can.
function part2() {
  const loop = { name: 'loop' };
  loop.self = loop;
  const original = { map: new Map([['a', 1]]), set: new Set([1, 2]), date: new Date(0), big: 10n, bytes: new Uint8Array([1, 2, 3]), loop };
  const copy = v8.deserialize(v8.serialize(original));
  console.log('\nPart 2: v8.serialize / v8.deserialize');
  console.log('  Map, Set, Date, BigInt, typed array survive:', copy.map instanceof Map, copy.set instanceof Set, copy.date instanceof Date, typeof copy.big, copy.bytes instanceof Uint8Array);
  console.log('  a circular reference survives              :', copy.loop.self === copy.loop);
  console.log('  JSON of a Map and a Date                   :', JSON.stringify({ map: original.map, date: original.date }));
  try {
    v8.serialize({ run() {} });
  } catch (err) {
    console.log('  a function cannot be serialized            :', err.message);
  }
  class Point {
    constructor() {
      this.x = 1;
    }
  }
  console.log('  a class instance comes back as             :', v8.deserialize(v8.serialize(new Point())).constructor.name);
}

// ---- Part 3: isolate versus context ------------------------------------------------------------
async function part3() {
  console.log('\nPart 3: isolates and contexts');
  const contextsBefore = v8.getHeapStatistics().number_of_native_contexts;
  const contexts = [vm.createContext({}), vm.createContext({}), vm.createContext({})];
  const contextsAfter = v8.getHeapStatistics().number_of_native_contexts;
  console.log(`  3 x vm.createContext() added ${contextsAfter - contextsBefore} native contexts to THIS isolate (kept: ${contexts.length})`);

  globalThis.onlyInMain = 'main';
  const worker = new Worker(
    `
    const { parentPort } = require('node:worker_threads');
    const v8 = require('node:v8');
    parentPort.postMessage({
      sawMainGlobal: typeof globalThis.onlyInMain,
      heapLimitMiB: v8.getHeapStatistics().heap_size_limit / ${MiB},
    });
  `,
    { eval: true, resourceLimits: { maxOldGenerationSizeMb: 64 } },
  );
  const report = await new Promise((resolve) => worker.once('message', resolve));
  const mainLimitMiB = v8.getHeapStatistics().heap_size_limit / MiB;
  await worker.terminate();
  console.log('  a Worker has its own isolate:');
  console.log('    typeof the main thread global, inside the worker:', report.sawMainGlobal);
  console.log('    worker heap limit smaller than main heap limit:', report.heapLimitMiB < mainLimitMiB);
}

// ---- Part 4: a startup snapshot ----------------------------------------------------------------------
// Node starts from a snapshot of an already-initialized heap. v8.startupSnapshot lets YOU do the same.
function part4() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-'));
  const entry = path.join(dir, 'entry.js');
  const blob = path.join(dir, 'app.blob');
  fs.writeFileSync(
    entry,
    `
    const v8 = require('node:v8');
    const builtAt = Date.now();                                  // runs once, at BUILD time
    const squares = Array.from({ length: 5 }, (_, i) => i * i);  // so does this
    v8.startupSnapshot.setDeserializeMainFunction(() => {
      console.log('    restored table:', squares.join(','));
      console.log('    started later than the build:', Date.now() >= builtAt);
    });
  `,
  );
  console.log('\nPart 4: a user-land startup snapshot (two child processes)');
  execFileSync(process.execPath, ['--snapshot-blob', blob, '--build-snapshot', entry], { cwd: dir });
  console.log(`  1. build: node --snapshot-blob app.blob --build-snapshot entry.js  (blob over 1 MiB: ${fs.statSync(blob).size > MiB})`);
  const output = execFileSync(process.execPath, ['--snapshot-blob', blob], { cwd: dir, encoding: 'utf8' });
  console.log('  2. run  : node --snapshot-blob app.blob');
  process.stdout.write(output);
  fs.rmSync(dir, { recursive: true, force: true });
}

(async () => {
  part1();
  part2();
  await part3();
  part4();
})();
