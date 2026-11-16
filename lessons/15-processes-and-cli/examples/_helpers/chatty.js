// Helper (not run by itself): prints far more lines than a pipe can hold, to show what happens when the reader leaves early.
// With --quiet it exits quietly when the reader is gone (EPIPE); without it the EPIPE error crashes the program.
// Used by 06-spawn-stdio.js.
// Run: node lessons/15-processes-and-cli/examples/_helpers/chatty.js --quiet   (pipe it into "head -n 2" in a shell that has head)

if (process.argv.includes('--quiet')) {
  process.stdout.on('error', (err) => {
    if (err.code === 'EPIPE') process.exit(0); // the reader is gone, so there is nobody to print for: not a failure
    throw err;
  });
}

let line = 0;
function writeSome() {
  while (line < 100000) {
    line++;
    if (!process.stdout.write(`line ${line}\n`)) {
      process.stdout.once('drain', writeSome); // backpressure: wait until the pipe has room again
      return;
    }
  }
}
writeSome();
