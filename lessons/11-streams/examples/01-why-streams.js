// Why streams: readFile holds the whole file in memory, a stream handles it piece by piece
// Run: node --expose-gc lessons/11-streams/examples/01-why-streams.js
// @flags --expose-gc

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const MiB = 1024 * 1024;
const FILE_MIB = 64;
const toMiB = (bytes) => (bytes / MiB).toFixed(1);
const msSince = (start) => (Number(process.hrtime.bigint() - start) / 1e6).toFixed(1);

// Memory that is still in use: force a garbage collection first (needs --expose-gc),
// so garbage that is not collected yet is not counted.
function liveBuffers() {
  if (global.gc) global.gc();
  return process.memoryUsage().arrayBuffers;
}

function countNewlines(buffer) {
  let count = 0;
  let index = -1;
  while ((index = buffer.indexOf(10, index + 1)) !== -1) count++;
  return count;
}

// Build a big text file with synchronous writes (a one-off setup step).
function makeBigFile(file, mib) {
  const line = 'The quick brown fox jumps over the lazy dog 0123456789\n';
  const block = Buffer.from(line.repeat(Math.floor(MiB / line.length)));
  const fd = fs.openSync(file, 'w');
  let size = 0;
  for (let i = 0; i < mib; i++) size += fs.writeSync(fd, block);
  fs.closeSync(fd);
  return size;
}

async function readWholeFile(file) {
  const before = liveBuffers();
  const start = process.hrtime.bigint();
  const data = await fsp.readFile(file); // nothing is available until ALL bytes are read
  const waited = msSince(start);
  const held = liveBuffers() - before;
  const lines = countNewlines(data);
  console.log('time until the data is available :', waited, 'ms');
  console.log('memory held while we work        :', toMiB(held), 'MiB');
  console.log('lines counted                    :', lines);
}

async function readInPieces(file) {
  const before = liveBuffers();
  const start = process.hrtime.bigint();
  let firstChunkAfter = null;
  let chunks = 0;
  let lines = 0;
  let mostHeld = 0;

  for await (const chunk of fs.createReadStream(file)) {
    if (firstChunkAfter === null) firstChunkAfter = msSince(start);
    chunks++;
    lines += countNewlines(chunk);
    if (chunks % 50 === 0) mostHeld = Math.max(mostHeld, liveBuffers() - before);
  }

  console.log('time until the first piece       :', firstChunkAfter, 'ms');
  console.log('number of pieces                 :', chunks, '(about 64 KiB each)');
  console.log('most memory held at one moment   :', toMiB(mostHeld), 'MiB');
  console.log('lines counted                    :', lines);
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'streams-01-'));
  const file = path.join(dir, 'big.txt');
  try {
    const size = makeBigFile(file, FILE_MIB);
    console.log(`test file: ${toMiB(size)} MiB`);

    console.log('\n--- A. fs.promises.readFile: the whole file at once ---');
    await readWholeFile(file);

    console.log('\n--- B. fs.createReadStream: piece by piece ---');
    await readInPieces(file);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true }); // always clean up the temp folder
  }
}

main();
