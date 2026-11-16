// Helper (not run by itself): reads stdin line by line with readline and reports what it saw.
// Used by 08-stdin-readline.js.
// Run: node lessons/15-processes-and-cli/examples/_helpers/stdin-lines.js   (type lines, finish with Ctrl+Z then Enter on Windows or Ctrl+D elsewhere)

const readline = require('node:readline');

async function main() {
  // crlfDelay: Infinity treats "\r\n" as ONE line break, even if the two characters arrive in different chunks.
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  let count = 0;
  for await (const line of rl) {
    count++;
    console.log(`line ${count}: ${JSON.stringify(line)}`);
  }
  console.log(`total lines: ${count}, stdin is a terminal: ${Boolean(process.stdin.isTTY)}`);
}

main();
