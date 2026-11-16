// V8 at work: which JIT tiers exist, how hot code is optimized, and why object shapes matter
// Shows: tier flags of this build, a live tier-up and deoptimization trace, hidden classes (maps), and a measured cost of many shapes.
// Run: node lessons/23-node-internals/examples/02-jit-and-shapes.js

const { spawnSync } = require('node:child_process');
const v8 = require('node:v8');

// ---- Child mode: a tiny hot function that V8 will optimize and then have to undo ----
function child() {
  function add(a, b) {
    return a + b;
  }
  let sum = 0;
  // (i % 10 keeps the sum small. A huge sum would itself stop being a small integer and cause a deopt of its own.)
  for (let i = 0; i < 300000; i++) sum = add(sum, i % 10); // always small ints: V8 learns "add takes small ints"
  add('x', 'y'); // a surprise: strings. Optimized code built on the "ints only" guess must be thrown away.
  for (let i = 0; i < 300000; i++) sum = add(sum, i % 10);
  console.log('child finished, sum =', sum);
}

// ---- Part 1: which compiler tiers are switched on in this build? ----------------
function part1() {
  const out = spawnSync(process.execPath, ['--v8-options'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).stdout;
  console.log('Part 1: default value of the tier flags in this build (from node --v8-options)');
  for (const flag of ['sparkplug', 'maglev', 'turbofan']) {
    const m = out.match(new RegExp(`--${flag} \\([^\\n]*\\)\\s+type: bool\\s+default: --(no-)?${flag}\\b`));
    console.log(`  --${flag}`.padEnd(14), m ? (m[1] ? 'off' : 'on') : 'not found');
  }
}

// ---- Part 2: watch V8 move one function up the tiers and fall back down ---------
function part2() {
  const r = spawnSync(process.execPath, ['--trace-opt', '--trace-deopt', __filename, 'child'], { encoding: 'utf8' });
  const lines = r.stdout.split('\n').filter((l) => l.includes('JSFunction add '));
  const tiers = new Set();
  const reasons = new Set();
  for (const line of lines) {
    const tier = line.match(/marking .* for optimization to (\w+)/);
    if (tier) tiers.add(tier[1]);
    const why = line.match(/bailout \(kind: [\w-]+, reason: ([^)]+)\)/);
    if (why) reasons.add(why[1]);
  }
  console.log('\nPart 2: trace of function add() in a child process (node --trace-opt --trace-deopt)');
  // Maglev always shows up in a run this short. TurboFan, the top tier, joins in some runs and not in others, so we do not print it.
  console.log('  V8 optimized add() with Maglev:', tiers.has('MAGLEV'));
  console.log('  V8 threw the optimized code away because:', [...reasons].sort().join(' | '));
}

// ---- Part 3: hidden classes (V8 calls them "maps") ---------------------------------
// %HaveSameMap is a V8 "natives" function. It is only for exploring, never for real code.
// We switch the syntax on at run time, which is exactly the kind of thing the v8 module warns about.
function part3() {
  v8.setFlagsFromString('--allow-natives-syntax');
  const sameShape = new Function('a', 'b', 'return %HaveSameMap(a, b)');
  const isFast = new Function('o', 'return %HasFastProperties(o)');
  const a = { x: 1, y: 2 };
  const b = { x: 5, y: 6 }; // same property names, same order
  const c = { y: 2, x: 1 }; // same names, other order
  const d = { x: 1, y: 2, z: 3 }; // one more property
  const e = { x: 1, y: 2 };
  delete e.x; // deleting a property usually switches the object to slow "dictionary mode"
  console.log('\nPart 3: do these objects share one hidden class?');
  console.log('  a {x,y} and b {x,y}   :', sameShape(a, b));
  console.log('  a {x,y} and c {y,x}   :', sameShape(a, c));
  console.log('  a {x,y} and d {x,y,z} :', sameShape(a, d));
  console.log('  a has fast properties :', isFast(a));
  console.log('  e after delete e.x    :', isFast(e), '(fast properties?)');
}

// ---- Part 4: what do many shapes cost? ----------------------------------------------
// We read obj.x in a hot loop. The objects in the array have 1, 2, 4 or 8 different shapes.
// A fresh function (unique source text) is used for each run so that one run cannot influence the next.
let uid = 0;
function makeReader() {
  return new Function('arr', `let s = 0; for (let i = 0; i < arr.length; i++) s += arr[i].x; return s; //${uid++}`);
}
function makeObjects(shapeCount) {
  const list = [];
  for (let i = 0; i < 1024; i++) {
    const o = { x: i };
    o['extra' + (i % shapeCount)] = 1; // a different second property name gives a different shape
    list.push(o);
  }
  return list;
}
function timeOnce(objects) {
  const read = makeReader();
  for (let i = 0; i < 3000; i++) read(objects); // warm up so V8 optimizes the function
  const start = performance.now();
  let total = 0;
  for (let i = 0; i < 10000; i++) total += read(objects);
  const ms = performance.now() - start;
  if (total < 0) console.log('never printed');
  return ms;
}
function part4() {
  console.log('\nPart 4: median time for 10000 passes over 1024 objects (lower is better, your numbers will differ)');
  for (const shapes of [1, 2, 4, 8]) {
    const runs = [];
    for (let i = 0; i < 5; i++) runs.push(timeOnce(makeObjects(shapes)));
    runs.sort((p, q) => p - q);
    console.log(`  ${String(shapes).padStart(2)} shape(s): ${runs[2].toFixed(0).padStart(4)} ms`);
  }
}

if (process.argv[2] === 'child') {
  child();
} else {
  part1();
  part2();
  part3();
  part4();
}
