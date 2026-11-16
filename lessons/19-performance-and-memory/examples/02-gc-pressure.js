// Garbage collection: count GC runs, read --trace-gc lines, and see what allocation rate costs
// Run: node lessons/19-performance-and-memory/examples/02-gc-pressure.js
const { PerformanceObserver, constants, performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');
const { setTimeout: sleep } = require('node:timers/promises');

// ---- Part 1: watch the garbage collector with a PerformanceObserver ------------------
const KIND = {
  [constants.NODE_PERFORMANCE_GC_MINOR]: 'minor (scavenge)',
  [constants.NODE_PERFORMANCE_GC_MAJOR]: 'major (mark-sweep-compact)',
  [constants.NODE_PERFORMANCE_GC_INCREMENTAL]: 'incremental marking',
  [constants.NODE_PERFORMANCE_GC_WEAKCB]: 'weak callbacks',
};
let gcRuns = {};
let gcMs = 0;
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    const name = KIND[entry.detail.kind];
    gcRuns[name] = (gcRuns[name] || 0) + 1;
    gcMs += entry.duration;
  }
});
observer.observe({ entryTypes: ['gc'] });

// Every call creates a new object, a new array and a new string: about 150 bytes of garbage.
function handleWithGarbage(i) {
  const record = { id: i, tags: [i, i + 1], label: 'item-' + i };
  return record.tags[1] + record.label.length;
}

// Same result, but it reuses one scratch array and builds no object and no string.
const scratch = [0, 0];
function digits(n) {
  let d = 1;
  while (n >= 10) {
    n = (n / 10) | 0;
    d++;
  }
  return d;
}
function handleWithoutGarbage(i) {
  scratch[0] = i;
  scratch[1] = i + 1;
  return scratch[1] + digits(i) + 5;
}

// Like the first one, but 1 record in 50 is kept alive (think: a cache that grows).
const kept = [];
function handleWithSurvivors(i) {
  const record = { id: i, tags: [i, i + 1], label: 'item-' + i };
  if (i % 50 === 0) kept.push(record);
  return record.tags[1] + record.label.length;
}

async function measure(label, fn) {
  gcRuns = {};
  gcMs = 0;
  const start = performance.now();
  let sum = 0;
  for (let i = 0; i < 5_000_000; i++) sum += fn(i);
  const took = performance.now() - start;
  await sleep(50); // GC entries are delivered to the observer a moment later
  console.log(`${label.padEnd(34)} ${took.toFixed(0).padStart(4)} ms   (result ${sum})`);
  console.log('   GC runs:', JSON.stringify(gcRuns), '| total GC pause about', gcMs.toFixed(0), 'ms');
}

// ---- Part 2: read the lines that --trace-gc prints (in a child process) -------------
function traceGcDemo() {
  const code = `
    const keep = [];
    for (let i = 0; i < 400000; i++) {
      const o = { a: i, b: [i], c: 'x' + i };
      if (i % 4 === 0) keep.push(o); // one object in four stays alive
    }
  `;
  const child = spawnSync(process.execPath, ['--trace-gc', '-e', code], { encoding: 'utf8' });
  // each line starts with "[process id:isolate address]": remove it to keep the output short
  const lines = child.stdout.split('\n').filter(Boolean).map((l) => l.replace(/^\[[^\]]*\]\s+/, ''));
  const scavenges = lines.filter((l) => l.includes('Scavenge'));
  const majors = lines.filter((l) => l.includes('Mark-Compact'));
  console.log('\n--trace-gc: ' + scavenges.length + ' scavenges (young generation), ' + majors.length + ' mark-compact (old generation)');
  console.log('first scavenge line:');
  console.log('  ' + scavenges[0]);
  if (majors[0]) {
    console.log('first mark-compact line:');
    console.log('  ' + majors[0]);
  }
}

(async () => {
  await measure('1. 5 million short-lived records', handleWithGarbage);
  await measure('2. reuse one scratch array', handleWithoutGarbage);
  await measure('3. like 1, but keep 1 record in 50', handleWithSurvivors);
  console.log('   records kept alive:', kept.length);
  observer.disconnect();
  traceGcDemo();
})();
