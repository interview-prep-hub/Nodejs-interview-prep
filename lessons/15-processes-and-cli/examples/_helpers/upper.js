// Helper (not run by itself): a tiny filter. Reads text from stdin and writes it to stdout in capital letters.
// Used by 06-spawn-stdio.js as the second program of a pipeline (like "a | upper").
// Run: node lessons/15-processes-and-cli/examples/_helpers/upper.js   (then type text, finish with Ctrl+Z on Windows or Ctrl+D elsewhere)

const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const toUpper = new Transform({
  transform(chunk, encoding, callback) {
    callback(null, chunk.toString().toUpperCase());
  },
});

pipeline(process.stdin, toUpper, process.stdout).catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
