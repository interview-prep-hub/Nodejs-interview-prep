// Sync vs async, blocking vs non-blocking
// Shows that a blocking call freezes everything, while a non-blocking call lets other work go on.
// Run: node lessons/07-async-javascript/examples/01-sync-vs-async.js

const fs = require('node:fs');

// A deliberately bad function: it keeps the one JavaScript thread busy for `ms` milliseconds.
function busyWait(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // spin: nothing else can run while we are here
  }
}

// Part A: synchronous code runs top to bottom, one line at a time.
function partA(next) {
  console.log('A1. start');
  busyWait(50);
  console.log('A2. we waited 50 ms and nothing else could run');
  next();
}

// Part B: a timer is asynchronous. We schedule the work and keep going.
function partB(next) {
  console.log('B1. about to schedule a timer');
  setTimeout(() => {
    console.log('B3. timer callback (ran later)');
    next();
  }, 20);
  console.log('B2. timer scheduled, we did not wait for it');
}

// Part C: a blocking read against a non-blocking read of the same file.
function partC(next) {
  const text = fs.readFileSync(__filename, 'utf8'); // blocks until the file is read
  console.log('C1. readFileSync finished, got text:', text.length > 0);

  fs.readFile(__filename, 'utf8', (err, data) => {
    if (err) throw err;
    console.log('C3. readFile finished later, got text:', data.length > 0);
    next();
  });
  console.log('C2. readFile started, we did not wait for it');
}

// Part D: a blocked thread also delays every timer.
function partD(next) {
  const startedAt = Date.now();
  console.log('D1. a 10 ms timer is scheduled, then we block for 100 ms');
  setTimeout(() => {
    const waited = Date.now() - startedAt;
    console.log('D3. the 10 ms timer fired late, after at least 100 ms:', waited >= 100);
    next();
  }, 10);
  busyWait(100);
  console.log('D2. blocking is over, the main code is finished');
}

// Run the parts one after another.
const parts = [partA, partB, partC, partD];
function runNext() {
  const part = parts.shift();
  if (part) part(runNext);
}
runNext();
