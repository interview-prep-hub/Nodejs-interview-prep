// Reading stdin: is it a terminal or a pipe, line by line with readline, all at once, and piping a file into a program
// Run: node lessons/15-processes-and-cli/examples/08-stdin-readline.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { spawn, spawnSync } = require('node:child_process');
const { once } = require('node:events');

const node = process.execPath;
const helper = (name) => path.join(__dirname, '_helpers', name);

async function main() {
  console.log('1. Is stdin a terminal (a person typing) or a pipe/file?');
  // process.stdin.isTTY is true for a terminal and undefined otherwise. Here the child is started with pipes.
  let result = spawnSync(node, ['-p', 'String(process.stdin.isTTY)'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });
  console.log('  stdin.isTTY in a child that has piped stdio:', result.stdout.trim());
  result = spawnSync(node, ['-p', 'String(process.stdout.isTTY)'], { encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });
  console.log('  stdout.isTTY in a child that has piped stdio:', result.stdout.trim());

  console.log('2. Line by line with readline (for await over the interface)');
  // Mixed line endings and no newline at the end: readline copes with all of it.
  result = spawnSync(node, [helper('stdin-lines.js')], { input: 'one\r\ntwo\n\nlast line without newline', encoding: 'utf8' });
  console.log(result.stdout.trimEnd().replace(/^/gm, '  | '));

  console.log('3. All at once: collect the chunks, then decode');
  result = spawnSync(node, [helper('stdin-all.js')], { input: 'the quick brown fox\njumps over\n', encoding: 'utf8' });
  console.log('  ', result.stdout.trim());

  console.log('4. Pipe a file into a program, like "cat words.txt | node stdin-lines.js"');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stdin-demo-'));
  const file = path.join(dir, 'words.txt');
  fs.writeFileSync(file, 'alpha\nbeta\ngamma\n');
  const child = spawn(node, [helper('stdin-lines.js')]);
  fs.createReadStream(file).pipe(child.stdin); // when the file ends, pipe() closes the child's stdin
  let text = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => (text += chunk));
  await once(child, 'close');
  console.log(text.trimEnd().replace(/^/gm, '  | '));

  console.log('5. readline also reads a FILE line by line without loading it all into memory');
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  const upper = [];
  for await (const line of rl) upper.push(line.toUpperCase());
  console.log('  ', upper);

  console.log('6. The same with events: "line" for each line, "close" at the end');
  await new Promise((resolve) => {
    const events = readline.createInterface({ input: fs.createReadStream(file) });
    let count = 0;
    events.on('line', () => count++);
    events.on('close', () => {
      console.log('  lines counted:', count);
      resolve();
    });
  });

  fs.rmSync(dir, { recursive: true, force: true });
}

main();
