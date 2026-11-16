// @manual
// A real interactive prompt with readline/promises (it waits for YOU to type)
// Run: node lessons/05-core-modules-tour/examples/10-readline-prompt.js
// Try: type a name, then numbers, then just press Enter. Press Ctrl+C to quit early (the way out that works everywhere).
// This is for a human at a keyboard. Do not pipe text into it: lines that arrive before
// rl.question() is called are lost. For piped input use "for await (const line of rl)".
const readline = require('node:readline/promises');

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('close', () => console.log('\nBye!')); // runs on rl.close(), Ctrl+C and Ctrl+D

  const name = await rl.question('What is your name? ');
  console.log(`Hello, ${name.trim() || 'stranger'}!`);

  let total = 0;
  while (true) {
    const answer = await rl.question('Add a number (or press Enter to finish): ');
    if (answer.trim() === '') break;
    const n = Number(answer);
    if (Number.isNaN(n)) {
      console.log('That is not a number, try again.');
      continue;
    }
    total += n;
    console.log('Total so far:', total);
  }

  console.log('Final total:', total);
  rl.close(); // without this the program keeps waiting for more input
}

main();
