// Helper (not run by itself): logs the 'beforeExit' and 'exit' events so the parent can show their order.
// Used by 03-exit-codes.js.
// Run: node lessons/15-processes-and-cli/examples/_helpers/lifecycle.js
//      node lessons/15-processes-and-cli/examples/_helpers/lifecycle.js explicit

const explicit = process.argv[2] === 'explicit';
let rounds = 0;

process.on('beforeExit', (code) => {
  console.log(`beforeExit (code ${code}), round ${rounds}`);
  if (rounds < 2) {
    rounds++;
    // Scheduling new work keeps the process alive, so 'beforeExit' will fire again later.
    setTimeout(() => console.log(`  extra work ${rounds}`), 10);
  }
});

process.on('exit', (code) => {
  console.log(`exit (code ${code})`);
  // Only synchronous work is possible here. This timer is thrown away.
  setTimeout(() => console.log('never printed'), 0);
});

console.log('main script done');
if (explicit) process.exit(0); // no 'beforeExit' for an explicit exit
