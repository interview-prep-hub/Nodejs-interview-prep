// ReDoS: one regular expression that freezes Node, and four ways to stay safe
// Run: node lessons/20-security-and-crypto/examples/05-redos.js
//
// The attack input is tiny (at most 25 characters) so this finishes in about a second.
// Real attacks need only a few dozen characters, which is exactly the problem.

const { Worker } = require('node:worker_threads');
const { spawnSync } = require('node:child_process');

const EVIL_REGEX = /^(a+)+$/; // "one or more groups of one or more a" : the same letters can be split in MANY ways

function timeIt(fn) {
  const start = process.hrtime.bigint();
  const result = fn();
  return { result, ms: Number(process.hrtime.bigint() - start) / 1e6 };
}

// ---------- 1. The problem: every extra character doubles the work ----------
console.log('--- 1. /^(a+)+$/ on "aaa...a!" ---');
console.log('(timings differ on every machine, the doubling pattern does not)');
for (const n of [14, 16, 18, 20, 22, 24]) {
  const input = 'a'.repeat(n) + '!'; // the final "!" makes the match fail, so the engine tries every split
  const { result, ms } = timeIt(() => EVIL_REGEX.test(input));
  console.log(`n = ${String(n).padStart(2)}  match = ${result}  ${ms.toFixed(1).padStart(7)} ms`);
}

// ---------- 2. Fix A: write a regex with only ONE way to match ----------
console.log('\n--- 2. fix A: /^a+$/ (no nested quantifier) ---');
const fixed = timeIt(() => /^a+$/.test('a'.repeat(100000) + '!'));
console.log(`100000 characters: match = ${fixed.result}, under 50 ms: ${fixed.ms < 50}`);

// ---------- 3. Fix B: limit the input length BEFORE running a regex ----------
console.log('\n--- 3. fix B: length limit ---');
function safeTest(regex, text, maxLength = 100) {
  if (typeof text !== 'string' || text.length > maxLength) return false; // reject long input, do not even try
  return regex.test(text);
}
console.log('short input:', safeTest(EVIL_REGEX, 'aaaa'));
console.log('long input :', safeTest(EVIL_REGEX, 'a'.repeat(5000) + '!'), '(rejected at once)');

// ---------- 4. Fix C: run risky matching in a worker and kill it on a timeout ----------
async function matchWithTimeout(patternSource, text, timeoutMs) {
  const code = `
    const { parentPort, workerData } = require('node:worker_threads');
    parentPort.postMessage(new RegExp(workerData.pattern).test(workerData.text));
  `;
  const worker = new Worker(code, { eval: true, workerData: { pattern: patternSource, text } });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.terminate(); // stops the worker thread even while its regex is still backtracking
      reject(new Error(`regex timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    worker.once('message', (value) => {
      clearTimeout(timer);
      worker.terminate();
      resolve(value);
    });
    worker.once('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ---------- 5. Fix D: let V8 switch to a linear-time engine (experimental flag) ----------
function demoV8Fallback() {
  console.log('\n--- 5. fix D: V8 fallback engine ---');
  const script = `
    const start = Date.now();
    const result = /^(a+)+$/.test('a'.repeat(34) + '!');
    console.log('34 characters: match =', result, '| fast:', Date.now() - start < 1000);
  `;
  // Without the flag 34 characters would take many minutes, so we only run it WITH the flag.
  const run = spawnSync(process.execPath, ['--enable-experimental-regexp-engine-on-excessive-backtracks', '-e', script], { encoding: 'utf8' });
  console.log(run.stdout.trim());
}

async function main() {
  console.log('\n--- 4. fix C: worker + timeout ---');
  const ticks = [];
  const heartbeat = setInterval(() => ticks.push(Date.now()), 20); // proves the main thread is NOT blocked
  const started = Date.now();
  try {
    await matchWithTimeout('^(a+)+$', 'a'.repeat(60) + '!', 200);
  } catch (e) {
    console.log('result:', e.message);
  }
  clearInterval(heartbeat);
  console.log(`main thread kept running: ${ticks.length >= 5} (at least 5 heartbeat ticks happened while the regex ran)`);
  console.log('total wait close to the timeout:', Date.now() - started < 1000);

  demoV8Fallback();
}

main();
