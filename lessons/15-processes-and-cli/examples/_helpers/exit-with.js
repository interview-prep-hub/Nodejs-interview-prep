// Helper (not run by itself): ends in the way named by the first argument, so the parent can see the exit code.
// Used by 03-exit-codes.js.
// Run: node lessons/15-processes-and-cli/examples/_helpers/exit-with.js fail

const fs = require('node:fs');

const mode = process.argv[2];
const file = process.argv[3]; // only used by the "exit-cut" and "exit-code" modes

// "Pending work": a timer that saves a file 20 ms from now.
function saveLater() {
  setTimeout(() => {
    fs.writeFileSync(file, 'saved');
    console.log('timer fired, file saved');
  }, 20);
}

switch (mode) {
  case 'ok':
    console.log('all good');
    break; // the event loop is empty, so Node exits with 0
  case 'fail':
    console.error('something failed');
    process.exitCode = 1;
    break;
  case 'usage':
    console.error('usage: tool <file>');
    process.exitCode = 2;
    break;
  case 'throw':
    throw new Error('boom');
  case 'reject':
    Promise.reject(new Error('boom'));
    break;
  case 'signal-style':
    process.exit(128 + 15); // what a shell reports for a process killed by SIGTERM
    break;
  case 'exit-cut':
    saveLater();
    process.exit(0); // exits NOW: the timer never fires
    break;
  case 'exit-code':
    saveLater();
    process.exitCode = 0; // lets the timer run, then exits
    break;
  default:
    console.error(`unknown mode: ${mode}`);
    process.exitCode = 64;
}
