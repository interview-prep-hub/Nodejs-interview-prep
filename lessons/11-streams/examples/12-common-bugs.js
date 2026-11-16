// Six classic stream bugs, each shown safely next to its fix
// Run: node lessons/11-streams/examples/12-common-bugs.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { Readable, Writable, Transform } = require('node:stream');
const { finished } = require('node:stream/promises');
const { setTimeout: sleep } = require('node:timers/promises');

// A Writable that needs 10 ms per chunk and remembers what it wrote.
function slowWriter(written, options = {}) {
  return new Writable({
    ...options,
    write(chunk, encoding, callback) {
      setTimeout(() => {
        written.push(chunk.toString());
        callback();
      }, 10);
    },
  });
}

// Bug 1: no 'error' listener. An 'error' event with no listener is thrown, and a thrown
// error that nobody catches ends the process (exit code 1).
async function bug1NoErrorHandler() {
  console.log('--- Bug 1: no error handler ---');
  // We install a safety net ONLY so that this demo can show the crash without dying.
  const crashed = new Promise((resolve) => {
    process.once('uncaughtException', (err) => {
      console.log('BUG : uncaught exception, the process would have crashed:', err.message);
      resolve();
    });
  });
  new Readable({
    read() {
      this.destroy(new Error('disk exploded'));
    },
  }).resume();
  await crashed;

  const safe = new Readable({
    read() {
      this.destroy(new Error('disk exploded'));
    },
  });
  safe.on('error', (err) => console.log('FIX : error handled:', err.message));
  safe.resume();
  await sleep(10);
}

// Bug 2: using the result before the stream is finished.
async function bug2NotAwaitingFinish() {
  console.log('\n--- Bug 2: not waiting for the stream to finish ---');
  const written = [];
  const writer = slowWriter(written);
  writer.write('a');
  writer.write('b');
  writer.end('c');
  console.log('BUG : right after end(), chunks written:', written.length);
  await finished(writer);
  console.log('FIX : after await finished(), chunks written:', written.length);
}

// Bug 3: not waiting for 'drain'. The full demo is in example 05. This is the correct loop.
async function bug3Drain() {
  console.log('\n--- Bug 3: writing in a loop without drain (the right way) ---');
  const written = [];
  const writer = slowWriter(written, { highWaterMark: 20 }); // a small limit so we reach it quickly
  const chunks = Array.from({ length: 30 }, (_, i) => `chunk${i}`);
  let drains = 0;
  let mostBuffered = 0;
  for (const chunk of chunks) {
    const ok = writer.write(chunk);
    mostBuffered = Math.max(mostBuffered, writer.writableLength);
    if (!ok) {
      await once(writer, 'drain'); // pause until the buffer is empty
      drains++;
    }
  }
  writer.end();
  await finished(writer);
  console.log('FIX : wrote', written.length, 'chunks, waited for drain', drains, 'times');
  console.log('FIX : most bytes buffered at once:', mostBuffered, '(limit 20, plus the chunk that crossed it)');
}

// Bug 4: forgetting the callback in _transform (or _write). The stream waits forever.
async function bug4ForgotCallback() {
  console.log('\n--- Bug 4: forgetting to call the callback ---');
  async function run(label, transform) {
    let passed = 0;
    let ended = false;
    await new Promise((resolve) => {
      Readable.from(['a', 'b', 'c'])
        .pipe(transform)
        .on('data', () => passed++)
        .on('end', () => {
          ended = true;
        });
      setTimeout(resolve, 60); // give it plenty of time
    });
    console.log(`${label} chunks passed: ${passed}, ended: ${ended}`);
  }

  await run('BUG :', new Transform({
    transform(chunk, encoding, callback) {
      this.push(chunk); // forgot callback(): chunk 'b' is never even offered to us
    },
  }));
  await run('FIX :', new Transform({
    transform(chunk, encoding, callback) {
      callback(null, chunk);
    },
  }));

  // Calling it twice is a bug too, but this one is loud.
  const twice = new Transform({
    transform(chunk, encoding, callback) {
      callback();
      callback();
    },
  });
  twice.on('error', (err) => console.log('BUG : calling it twice  ->', err.code));
  twice.resume();
  twice.write('x');
  await sleep(20);
}

// Bug 5: reading the same stream with a 'data' listener AND with for await.
async function bug5MixingStyles() {
  console.log('\n--- Bug 5: mixing the data event and for await ---');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'streams-12-'));
  const file = path.join(dir, 'letters.txt');
  fs.writeFileSync(file, 'abcdefghijklmnopqrstuvwxyz');
  try {
    const stream = fs.createReadStream(file, { highWaterMark: 10 });
    const viaEvent = [];
    const viaLoop = [];
    stream.on('data', (chunk) => viaEvent.push(chunk.toString()));
    for await (const chunk of stream) viaLoop.push(chunk.toString());
    console.log('BUG : data listener saw :', viaEvent);
    console.log('BUG : for await saw     :', viaLoop, '(every chunk handled twice)');
    console.log('FIX : pick ONE way to consume a stream');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Bug 6: an async function as a 'data' listener. The stream does not wait for it.
async function bug6AsyncDataHandler() {
  console.log('\n--- Bug 6: async work inside a data listener ---');
  let running = 0;
  let mostAtOnce = 0;
  async function handle() {
    running++;
    mostAtOnce = Math.max(mostAtOnce, running);
    await sleep(10); // pretend this is a database call
    running--;
  }

  const stream = Readable.from([1, 2, 3, 4, 5]);
  stream.on('data', handle);
  await finished(stream);
  await sleep(30); // let the slow handlers finish
  console.log('BUG : handlers running at the same moment:', mostAtOnce);

  running = 0;
  mostAtOnce = 0;
  for await (const item of Readable.from([1, 2, 3, 4, 5])) await handle(item);
  console.log('FIX : with for await, at the same moment :', mostAtOnce);
}

async function main() {
  await bug1NoErrorHandler();
  await bug2NotAwaitingFinish();
  await bug3Drain();
  await bug4ForgotCallback();
  await bug5MixingStyles();
  await bug6AsyncDataHandler();
}

main();
