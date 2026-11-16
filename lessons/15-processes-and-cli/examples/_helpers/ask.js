// Helper (not run by itself): a script that asks two questions with readline/promises.
// Used by 11-prompts.js, which plays the user. You can also run it yourself and type the answers.
// Run: node lessons/15-processes-and-cli/examples/_helpers/ask.js

const readline = require('node:readline/promises');

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // If the input ends (Ctrl+D, or a pipe that is closed) while a question is waiting, rl.question would
  // simply never settle and Node would exit with code 0 and no message. Aborting the question on 'close'
  // turns that silent exit into a normal error that we can handle.
  const ended = new AbortController();
  rl.on('close', () => ended.abort());

  async function ask(question) {
    return rl.question(question, { signal: ended.signal });
  }

  try {
    const name = (await ask('Your name? ')).trim() || 'stranger';
    const answer = (await ask(`Deploy for ${name} (y/N)? `)).trim().toLowerCase();
    if (answer === 'y' || answer === 'yes') {
      console.log(`Deploying for ${name}...`);
    } else {
      console.log('Cancelled.');
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('\nInput ended before all questions were answered.');
      process.exitCode = 1;
    } else {
      throw err;
    }
  } finally {
    rl.close();
  }
}

main();
