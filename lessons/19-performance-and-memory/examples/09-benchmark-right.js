// Benchmarking correctly: warm-up, many rounds, the median, timerify, and the dead-code trap
// Run: node lessons/19-performance-and-memory/examples/09-benchmark-right.js
const { performance, PerformanceObserver } = require('node:perf_hooks');

// ---- Part 1: the first run is slower (JIT warm-up) -----------------------------------------------
function sumOfSquares(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += i * i;
  return sum;
}
console.log('--- 1. the same work, 10 rounds in a row (ms per round)');
const rounds = [];
for (let r = 0; r < 10; r++) {
  const start = performance.now();
  for (let k = 0; k < 2000; k++) sumOfSquares(1000);
  rounds.push(performance.now() - start);
}
console.log('  ' + rounds.map((t) => t.toFixed(1)).join('  '));
const slowest = Math.max(...rounds);
console.log(rounds[0] === slowest
  ? '  round 1 is the slowest: V8 first runs the code in a slow interpreter and optimizes it later.'
  : '  round 1 was not the slowest this time (another program or the GC disturbed a later round): noise is real, repeat your measurements.');

// ---- Part 2: a small honest benchmark helper -------------------------------------------------------
// - warm-up runs that are thrown away
// - several rounds, because one number is just luck
// - report the median (middle value) and the spread, not the average
function bench(name, fn, { rounds = 15, iterations = 20_000 } = {}) {
  for (let i = 0; i < iterations; i++) fn(i); // warm-up
  const perOp = [];
  for (let r = 0; r < rounds; r++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn(i);
    perOp.push(((performance.now() - start) * 1e6) / iterations); // nanoseconds per call
  }
  perOp.sort((a, b) => a - b);
  const median = perOp[Math.floor(rounds / 2)];
  console.log(`  ${name.padEnd(26)} median ${median.toFixed(0).padStart(6)} ns/op   (fastest ${perOp[0].toFixed(0)}, slowest ${perOp[rounds - 1].toFixed(0)})`);
  return median;
}

console.log('\n--- 2. is "is this id in the list?" faster with an Array or a Set? (1000 ids)');
const idsArray = Array.from({ length: 1000 }, (_, i) => i * 3);
const idsSet = new Set(idsArray);
let hits = 0; // we USE the result, see part 3
const arrayTime = bench('Array.includes', (i) => { if (idsArray.includes(i)) hits++; });
const setTime = bench('Set.has', (i) => { if (idsSet.has(i)) hits++; });
console.log(`  Set.has is about ${(arrayTime / setTime).toFixed(0)}x faster here (found ${hits} ids so the loops were not skipped)`);

// ---- Part 3: the dead-code trap ------------------------------------------------------------------------
// If the result of a call is never used, the optimizer may remove the call. Then you measure nothing.
console.log('\n--- 3. the dead-code trap (3 million calls of Math.sqrt)');
function unusedResult() {
  const start = performance.now();
  for (let i = 0; i < 3e6; i++) Math.sqrt(i); // result thrown away
  return performance.now() - start;
}
function usedResult() {
  let total = 0;
  const start = performance.now();
  for (let i = 0; i < 3e6; i++) total += Math.sqrt(i); // result used
  const took = performance.now() - start;
  if (total < 0) console.log('never printed'); // makes sure `total` is really needed
  return took;
}
unusedResult();
usedResult(); // warm-up
console.log(`  result unused: ${unusedResult().toFixed(1)} ms | result used: ${usedResult().toFixed(1)} ms`);
console.log('  the first number is not "fast code", it is "no code".');

// ---- Part 4: performance.timerify and performance.mark / measure -----------------------------------------
console.log('\n--- 4. built-in timing tools');
const timedSum = performance.timerify(sumOfSquares); // same function, but every call is recorded
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) {
    console.log(`  timerify: ${entry.name}(${entry.detail.join(', ')}) took ${entry.duration.toFixed(2)} ms`);
  }
  observer.disconnect();
});
observer.observe({ entryTypes: ['function'] });
// The same work three times. The first call is slower: so far the sums were small integers, now they
// are too big for V8's small-integer type, so V8 throws its optimized code away (a "deoptimization",
// visible with node --trace-deopt) and builds it again. Single measurements mislead.
timedSum(1_000_000);
timedSum(1_000_000);
timedSum(1_000_000);

// Observers are told about new entries a moment later, so wait before printing the next lines.
setTimeout(() => {
  performance.mark('before');
  sumOfSquares(5_000_000);
  performance.mark('after');
  const measure = performance.measure('sumOfSquares(5 million)', 'before', 'after');
  console.log(`  mark/measure: "${measure.name}" took ${measure.duration.toFixed(2)} ms`);
}, 20);
