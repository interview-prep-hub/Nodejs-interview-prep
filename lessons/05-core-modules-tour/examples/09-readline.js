// readline: ask questions (with a pretend keyboard) and read a file line by line
// Run: node lessons/05-core-modules-tour/examples/09-readline.js
// For a real keyboard, see 10-readline-prompt.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline/promises');
const { PassThrough, Writable } = require('node:stream');

async function askQuestions() {
  console.log('--- 1. prompting (the keyboard and screen are pretend) ---');
  const keyboard = new PassThrough(); // anything written here looks like typing
  const screen = new Writable({
    write(chunk, encoding, done) {
      console.log(`[screen shows] ${JSON.stringify(chunk.toString())}`);
      done();
    },
  });
  const rl = readline.createInterface({ input: keyboard, output: screen });

  const pendingName = rl.question('Your name? ');
  keyboard.write('Ada\n'); // the "user" types Ada and presses Enter
  const name = await pendingName;

  const pendingAge = rl.question('Your age? ');
  keyboard.write('36\n');
  const age = Number(await pendingAge); // answers are always strings

  rl.close();
  console.log(`Hello ${name}, next year you will be ${age + 1}.`);
}

async function giveUp() {
  console.log('--- 1b. a question that gives up (AbortController) ---');
  const silentScreen = new Writable({ write: (chunk, encoding, done) => done() });
  const rl = readline.createInterface({ input: new PassThrough(), output: silentScreen });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 20); // nobody types anything, so cancel after 20 ms
  try {
    await rl.question('Still there? ', { signal: controller.signal });
  } catch (err) {
    console.log('no answer ->', err.name);
  }
  rl.close();
}

async function readLines(file) {
  console.log('--- 2. reading a file line by line ---');
  const rl = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity, // treat \r\n as ONE line break
  });

  let number = 0;
  for await (const line of rl) {
    number++;
    if (line.trim() === '') continue; // skip blank lines
    console.log(`${number}: ${line}`);
  }
  console.log('total lines read:', number);
}

async function main() {
  await askQuestions();
  await giveUp();

  // A small file with Windows line endings and no newline at the very end.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readline-demo-'));
  const file = path.join(dir, 'notes.txt');
  fs.writeFileSync(file, 'first line\r\nsecond line\r\n\r\nlast line without newline');
  try {
    await readLines(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true }); // clean up
  }
}

main();
