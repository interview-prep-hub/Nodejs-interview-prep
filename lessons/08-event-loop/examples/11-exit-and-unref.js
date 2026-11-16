// How Node knows when to exit
// Shows: only "ref'd" handles keep the loop alive; unref(), beforeExit and getActiveResourcesInfo().
// Run: node lessons/08-event-loop/examples/11-exit-and-unref.js

const net = require('node:net');

// How stdout itself shows up in the list depends on where the output goes
// (a terminal, a pipe or a file), so we hide those entries to keep the output stable.
const HIDE = new Set(['PipeWrap', 'TTYWrap', 'FSReqCallback']);
const active = () =>
  process.getActiveResourcesInfo().filter((name) => !HIDE.has(name)).join(', ') || '(nothing)';

console.log('1. start of the script, active resources:', active());

// A normal timer is "ref'd": it keeps the loop (and the process) alive until it fires.
setTimeout(() => console.log('3. the ref\'d timer fired'), 100);

// An unref'd timer does not keep the process alive. Nothing else is waiting, so it never fires.
const patient = setTimeout(() => console.log('NEVER PRINTED: unref\'d timers cannot keep the process alive'), 5000);
patient.unref();

// A listening server is a handle that keeps the loop alive, until we unref it.
const server = net.createServer();
server.listen(0, '127.0.0.1', () => {
  console.log('2a. server is listening, active resources:', active());
  server.unref();
  console.log('2b. after server.unref(), active resources:', active());
});

// A promise that never settles is not a handle. It does not keep the process alive.
new Promise(() => {});

// 'beforeExit' fires when the loop has run out of work. Adding work here keeps the process going.
let addedMoreWork = false;
process.on('beforeExit', () => {
  if (!addedMoreWork) {
    addedMoreWork = true;
    console.log('4. beforeExit: the loop is empty, adding one more timer');
    setTimeout(() => console.log('5. the timer added in beforeExit fired'), 20);
  } else {
    console.log('6. beforeExit again: no new work, so the process can end');
  }
});

process.on('exit', (code) => {
  console.log(`7. exit event, code ${code} (only synchronous work is possible here)`);
});
