// Big files: do not readFile them. Use a stream, or read line by line with readline.
// Run: node lessons/06-file-system/examples/09-big-files.js
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { pipeline } = require('node:stream/promises');

async function main() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'fs-big-'));
  const bigFile = path.join(dir, 'big.log');

  try {
    // Build a file with 50,000 lines (about 1.2 MB). We write it with a stream too.
    const out = fs.createWriteStream(bigFile);
    for (let i = 1; i <= 50000; i++) {
      // write() returns false when the buffer is full: wait for 'drain' (backpressure)
      if (!out.write(`line ${i}: some log text\n`)) {
        await new Promise((resolve) => out.once('drain', resolve));
      }
    }
    out.end();
    await new Promise((resolve) => out.on('finish', resolve));
    console.log('file size (bytes):', (await fsp.stat(bigFile)).size);

    // --- 1. Chunks: a read stream gives the file in pieces ----------------------
    let chunks = 0;
    let bytes = 0;
    for await (const chunk of fs.createReadStream(bigFile)) {
      chunks++;
      bytes += chunk.length; // chunk is a Buffer, 64 KiB at most by default
    }
    console.log(`read stream: ${chunks} chunks, ${bytes} bytes in total`);

    // --- 2. Lines: readline on top of a stream ------------------------------------
    const rl = readline.createInterface({
      input: fs.createReadStream(bigFile),
      crlfDelay: Infinity, // treat \r\n as ONE line break
    });
    let lines = 0;
    let last = '';
    for await (const line of rl) {
      lines++;
      last = line;
    }
    console.log('readline: lines =', lines, '| last line =', last);

    // --- 3. Only a part of the file: start and end are byte positions (inclusive)
    let part = '';
    for await (const chunk of fs.createReadStream(bigFile, { start: 0, end: 19, encoding: 'utf8' })) {
      part += chunk;
    }
    console.log('first 20 bytes:', JSON.stringify(part));

    // --- 4. Copy a big file without loading it: pipeline handles errors and cleanup
    const copyPath = path.join(dir, 'copy.log');
    await pipeline(fs.createReadStream(bigFile), fs.createWriteStream(copyPath));
    console.log('copy has the same size:', (await fsp.stat(copyPath)).size === (await fsp.stat(bigFile)).size);

    // --- 5. Compare with readFile, which holds the whole file in memory ---------
    const whole = await fsp.readFile(bigFile, 'utf8');
    console.log('readFile also finds', whole.split('\n').length - 1, 'lines, but needed the entire file in memory');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

main();
