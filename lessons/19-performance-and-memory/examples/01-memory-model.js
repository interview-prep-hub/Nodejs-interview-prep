// Memory model: what process.memoryUsage() and v8.getHeapStatistics() really show
// Run: node lessons/19-performance-and-memory/examples/01-memory-model.js
const v8 = require('node:v8');
const { spawnSync } = require('node:child_process');

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1).padStart(6) + ' MB';

function show(title, m = process.memoryUsage()) {
  console.log(title);
  for (const key of ['rss', 'heapTotal', 'heapUsed', 'external', 'arrayBuffers']) {
    console.log('  ' + key.padEnd(13) + mb(m[key]));
  }
}

// ---- Part 1: the five numbers of process.memoryUsage() -----------------------------
const start = process.memoryUsage();
show('1. at start:', start);

// ---- Part 2: objects go to the V8 heap, Buffers go outside of it --------------------
const objects = [];
for (let i = 0; i < 300_000; i++) objects.push({ id: i, name: 'user-' + i });
const afterObjects = process.memoryUsage();

const buffer = Buffer.alloc(50 * 1024 * 1024); // 50 MB
const afterBuffer = process.memoryUsage();

console.log('\n2. what changed?');
console.log('  after 300000 small objects: heapUsed', mb(afterObjects.heapUsed - start.heapUsed), '| external', mb(afterObjects.external - start.external));
console.log('  after a 50 MB Buffer:       heapUsed', mb(afterBuffer.heapUsed - afterObjects.heapUsed), '| external', mb(afterBuffer.external - afterObjects.external), '| arrayBuffers', mb(afterBuffer.arrayBuffers - afterObjects.arrayBuffers));

// rss counts memory pages the process really touched. A fresh zero-filled buffer is
// mapped lazily by the operating system, so rss grows when we write to it.
const rssBefore = process.memoryUsage.rss();
buffer.fill(1);
console.log('  rss grew by', mb(afterBuffer.rss - afterObjects.rss), 'when the buffer was allocated, and by', mb(process.memoryUsage.rss() - rssBefore), 'after writing to every byte of it');

// ---- Part 3: the heap spaces ---------------------------------------------------------
// Many small objects live in new_space first and move to old_space if they survive.
// Very large objects (here: one array with 400000 elements) get their own space.
const bigArray = Array.from({ length: 400_000 }, (_, i) => i * 2);
console.log('\n3. heap spaces (exact numbers change from run to run):');
for (const s of v8.getHeapSpaceStatistics()) {
  if (['new_space', 'old_space', 'large_object_space', 'new_large_object_space', 'code_space'].includes(s.space_name)) {
    console.log('  ' + s.space_name.padEnd(24) + 'used' + mb(s.space_used_size) + '  reserved' + mb(s.space_size));
  }
}
console.log('  (bigArray has', bigArray.length, 'elements and is kept alive on purpose)');

// ---- Part 4: v8.getHeapStatistics(): the numbers that matter --------------------------
// (v8.getHeapStatistics() describes the JavaScript heap; process.memoryUsage() describes the process.)
const stats = v8.getHeapStatistics();
console.log('\n4. v8.getHeapStatistics() (the fields to know):');
for (const key of ['total_heap_size', 'used_heap_size', 'total_available_size', 'heap_size_limit', 'malloced_memory', 'external_memory']) {
  console.log('  ' + key.padEnd(22) + mb(stats[key]));
}
console.log('  number_of_native_contexts:   ', stats.number_of_native_contexts, '| number_of_detached_contexts:', stats.number_of_detached_contexts);

// ---- Part 5: the heap limit ----------------------------------------------------------
const limit = stats.heap_size_limit;
console.log('\n5. heap_size_limit of this process:', mb(limit), '(depends on your machine, do not hard-code it)');
for (const flag of ['--max-old-space-size=64', '--max-old-space-size=256']) {
  const child = spawnSync(process.execPath, [flag, '-p', "require('node:v8').getHeapStatistics().heap_size_limit"], { encoding: 'utf8' });
  console.log('   with ' + flag + ' the limit is', mb(Number(child.stdout)), '(more than the flag: it also counts the young generation)');
}
console.log('   process.constrainedMemory():', process.constrainedMemory(), '(0 means: no limit known to Node, as on a normal PC)');

// ---- Part 6: what an out-of-memory crash looks like (in a child process) ------------
const crash = spawnSync(
  process.execPath,
  ['--max-old-space-size=32', '-e', 'const keep = []; for (;;) keep.push(new Array(1000).fill(keep.length));'],
  { encoding: 'utf8' },
);
const fatal = crash.stderr.split('\n').find((line) => line.includes('FATAL ERROR'));
console.log('\n6. child with a 32 MB limit and a leak: exit code', crash.status);
console.log('   ' + fatal);

// keep the objects alive until the end so the numbers above are honest
console.log('\n(still holding', objects.length, 'objects and a', buffer.length / 1024 / 1024, 'MB buffer)');
