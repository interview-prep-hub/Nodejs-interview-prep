// setTimeout(fn, 0) vs setImmediate(fn)
// Shows: from the main module the order is not guaranteed, inside an I/O callback it always is.
// Run: node lessons/08-event-loop/examples/04-timeout-vs-immediate.js

const { execFile } = require('node:child_process');
const fs = require('node:fs');

const RUNS = 12; // fresh node processes per row
const AT_A_TIME = 4; // how many child processes run together

// ---- Child mode: schedule both calls in one place and print which ran first ----
function child(where) {
  let first = null;
  const record = (name) => () => {
    if (first === null) first = name;
  };
  const schedule = () => {
    setTimeout(record('timeout'), 0);
    setImmediate(record('immediate'));
  };

  process.on('exit', () => console.log(first));

  if (where === 'main') {
    schedule();
  } else if (where === 'main-then-busy') {
    schedule();
    const end = Date.now() + 5; // 5 ms of work AFTER scheduling
    while (Date.now() < end) {
      // busy
    }
  } else if (where === 'io') {
    fs.readFile(__filename, () => schedule()); // inside an I/O callback
  } else if (where === 'timer') {
    setTimeout(() => schedule(), 5); // inside a timer callback
  }
}

// ---- Parent mode: start many fresh processes and count the winners ----
function runChild(where) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [__filename, where], (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

async function countWinners(where) {
  const wins = { immediate: 0, timeout: 0 };
  for (let done = 0; done < RUNS; done += AT_A_TIME) {
    const batch = await Promise.all(Array.from({ length: AT_A_TIME }, () => runChild(where)));
    for (const winner of batch) wins[winner]++;
  }
  return wins;
}

async function parent() {
  const rows = [
    ['main module', 'main'],
    ['main module, then 5 ms of busy work', 'main-then-busy'],
    ['inside an I/O callback (fs.readFile)', 'io'],
    ['inside a timer callback', 'timer'],
  ];
  console.log(`Each row starts ${RUNS} fresh node processes.\n`);
  console.log('where both calls are made'.padEnd(40) + 'immediate first'.padEnd(18) + 'timeout first');
  for (const [label, where] of rows) {
    const wins = await countWinners(where);
    console.log(label.padEnd(40) + String(wins.immediate).padEnd(18) + wins.timeout);
  }
}

if (process.argv[2]) child(process.argv[2]);
else parent();
