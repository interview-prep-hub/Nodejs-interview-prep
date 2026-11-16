// Backpressure: what happens when you ignore write() returning false, and the fix
// Run: node lessons/11-streams/examples/05-backpressure.js

const fs = require('node:fs');
const stream = require('node:stream');
const { Readable, Writable, Transform } = stream;
const { once } = require('node:events');
const { pipeline } = require('node:stream/promises');

const KiB = 1024;
const MiB = 1024 * KiB;
const CHUNKS = 50000; // 50,000 chunks of 1 KiB = about 49 MiB in total
const toMiB = (bytes) => (bytes / MiB).toFixed(1);

// A slow consumer: it needs a little time for each chunk (like a disk or a network).
// It also records the numbers we want to show.
class SlowWriter extends Writable {
  constructor(highWaterMark = 16 * 1024) {
    super({ highWaterMark }); // set explicitly so the numbers are the same on every OS
    this.mostBuffered = 0;
    this.falseCount = 0;
    this.chunksDone = 0;
  }

  _write(chunk, encoding, callback) {
    setImmediate(() => {
      this.chunksDone++;
      callback();
    });
  }

  // Wrap write() only to measure. The real work stays in _write.
  write(chunk, ...rest) {
    const ok = super.write(chunk, ...rest);
    this.mostBuffered = Math.max(this.mostBuffered, this.writableLength);
    if (!ok) this.falseCount++;
    return ok;
  }
}

function part0Defaults() {
  console.log('--- 0. the numbers ---');
  const reader = fs.createReadStream(__filename);
  console.log('default highWaterMark, bytes   :', stream.getDefaultHighWaterMark(false), '(16384 on Windows, 65536 on Linux and macOS)');
  console.log('default highWaterMark, objects :', stream.getDefaultHighWaterMark(true));
  console.log('fs.createReadStream highWaterMark:', reader.readableHighWaterMark);
  reader.destroy();

  const hwm = new Writable().writableHighWaterMark;
  // A sink that finishes each chunk a little later (callback in the next loop turn)
  const sink = () => new Writable({ write: (chunk, encoding, callback) => setImmediate(callback) });

  const a = sink();
  console.log(`write(${hwm - 1} bytes) returns   :`, a.write(Buffer.alloc(hwm - 1)));
  const b = sink();
  console.log(`write(${hwm} bytes) returns   :`, b.write(Buffer.alloc(hwm)), '(buffered bytes reached the limit)');
  console.log('writableNeedDrain              :', b.writableNeedDrain);
}

// The problem: the loop ignores the return value of write().
async function part1Ignore() {
  console.log('\n--- 1. the problem: ignore write() ---');
  const before = process.memoryUsage().arrayBuffers;
  const writer = new SlowWriter();

  for (let i = 0; i < CHUNKS; i++) {
    writer.write(Buffer.alloc(KiB)); // the loop never waits, so it finishes at once
  }

  console.log('chunks the consumer finished   :', writer.chunksDone, 'of', CHUNKS);
  console.log('bytes waiting in memory        :', writer.writableLength, '=', toMiB(writer.writableLength), 'MiB');
  console.log('extra Buffer memory in use     :', toMiB(process.memoryUsage().arrayBuffers - before), 'MiB');
  console.log('write() returned false         :', writer.falseCount, 'times (and we ignored it every time)');

  writer.end();
  await once(writer, 'finish');
  console.log('after finish, chunks done      :', writer.chunksDone);
}

// The fix: when write() returns false, wait for 'drain' before writing more.
async function part2Drain() {
  console.log('\n--- 2. the fix: wait for drain ---');
  const writer = new SlowWriter();
  let drains = 0;

  for (let i = 0; i < CHUNKS; i++) {
    const ok = writer.write(Buffer.alloc(KiB));
    if (!ok) {
      await once(writer, 'drain'); // pause until the buffer is empty again
      drains++;
    }
  }

  writer.end();
  await once(writer, 'finish');
  console.log('most bytes waiting in memory   :', writer.mostBuffered, '(the highWaterMark is', writer.writableHighWaterMark + ')');
  console.log('times we waited for drain      :', drains);
  console.log('chunks done                    :', writer.chunksDone);
}

// Even better: let pipeline do the waiting for you.
async function part3Pipeline() {
  console.log('\n--- 3. pipeline does it for you ---');
  const writer = new SlowWriter();
  async function* source() {
    for (let i = 0; i < CHUNKS; i++) yield Buffer.alloc(KiB);
  }

  await pipeline(Readable.from(source()), writer);
  console.log('most bytes waiting in memory   :', writer.mostBuffered);
  console.log('chunks done                    :', writer.chunksDone);
}

// A Transform sits between two streams and has TWO buffers: one on its writable side (data
// waiting to be transformed) and one on its readable side (results waiting to be taken).
// Each side has its own highWaterMark, so one stage can hold about twice that number.
async function part4TransformBuffers() {
  console.log('\n--- 4. a Transform in the middle has two buffers ---');
  const HWM = 1024;
  let mostInput = 0;
  let mostOutput = 0;

  const middle = new Transform({
    highWaterMark: HWM,
    transform(chunk, encoding, callback) {
      callback(null, chunk); // pass the chunk on unchanged
    },
  });

  // The slow sink looks at the Transform's two buffers each time it receives a chunk.
  const sink = new Writable({
    highWaterMark: HWM,
    write(chunk, encoding, callback) {
      mostInput = Math.max(mostInput, middle.writableLength);
      mostOutput = Math.max(mostOutput, middle.readableLength);
      setImmediate(callback);
    },
  });

  async function* source() {
    for (let i = 0; i < 400; i++) yield Buffer.alloc(256);
  }

  await pipeline(Readable.from(source(), { objectMode: false }), middle, sink);
  console.log('highWaterMark of the Transform :', HWM);
  console.log('most bytes in its writable side:', mostInput);
  console.log('most bytes in its readable side:', mostOutput);
}

async function main() {
  part0Defaults();
  await part1Ignore();
  await part2Drain();
  await part3Pipeline();
  await part4TransformBuffers();
}

main();
