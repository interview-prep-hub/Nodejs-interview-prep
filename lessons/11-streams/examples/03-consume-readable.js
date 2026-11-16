// Four ways to consume a Readable: events, flowing/paused modes, the 'readable' event, for await
// Run: node lessons/11-streams/examples/03-consume-readable.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'streams-03-'));
const file = path.join(dir, 'letters.txt');
fs.writeFileSync(file, 'abcdefghijklmnopqrstuvwxyz'); // 26 bytes

// highWaterMark 10 means "read the file 10 bytes at a time", so we get several chunks.
const open = () => fs.createReadStream(file, { highWaterMark: 10 });

// 1. Events: data, end, close (and error)
async function useEvents() {
  console.log('--- 1. events: data, end, close ---');
  const stream = open();
  console.log('readableFlowing at the start :', stream.readableFlowing);

  stream.on('data', (chunk) => console.log('data  :', chunk)); // a Buffer
  console.log('readableFlowing after on(data):', stream.readableFlowing);
  stream.on('end', () => console.log('end   : no more data will come'));
  stream.on('close', () => console.log('close : the file is closed, all done'));
  stream.on('error', (err) => console.log('error :', err.message));
  await once(stream, 'close');
}

// 2. Flowing and paused mode. pause() stops the 'data' events, resume() starts them again.
async function usePauseResume() {
  console.log('\n--- 2. paused and flowing ---');
  const stream = open();
  stream.setEncoding('utf8'); // chunks are now strings, and never cut a character in half
  let count = 0;
  stream.on('data', (text) => {
    count++;
    console.log(`data ${count}  : ${text}   flowing=${stream.readableFlowing}`);
    if (count === 1) {
      stream.pause();
      console.log('paused  : flowing =', stream.readableFlowing, '(no data for 30 ms)');
      setTimeout(() => {
        stream.resume();
        console.log('resumed : flowing =', stream.readableFlowing);
      }, 30);
    }
  });
  await once(stream, 'close');
}

// 3. The 'readable' event: YOU pull data with read() when you are ready
async function useReadableEvent() {
  console.log('\n--- 3. the readable event and read() ---');
  const stream = open();
  stream.on('readable', () => {
    let chunk;
    // read() returns null when the internal buffer is empty. Keep calling it until then.
    while ((chunk = stream.read()) !== null) {
      console.log('read()  :', chunk.toString());
    }
  });
  stream.on('end', () => console.log('end'));
  await once(stream, 'close');
}

// 4. Async iteration: the modern way. Every loop turn gives one chunk.
async function useAsyncIteration() {
  console.log('\n--- 4. for await (preferred) ---');
  const stream = open();
  let total = '';
  for await (const chunk of stream) {
    console.log('chunk   :', chunk.length, 'bytes');
    total += chunk.toString();
  }
  console.log('total   :', total);
  console.log('destroyed after the loop:', stream.destroyed);

  // Leaving the loop early (break, return or throw) destroys the stream for you.
  const early = open();
  for await (const chunk of early) {
    console.log('first chunk only:', chunk.toString());
    break;
  }
  console.log('destroyed after break   :', early.destroyed);
}

// 5. Read only a slice of a file. start and end are byte positions and BOTH are included.
async function useSlice() {
  console.log('\n--- 5. read only a slice: start and end ---');
  let text = '';
  for await (const chunk of fs.createReadStream(file, { start: 2, end: 5, encoding: 'utf8' })) {
    text += chunk;
  }
  console.log('bytes 2 to 5 :', JSON.stringify(text), '(start and end are both included)');
}

async function main() {
  try {
    await useEvents();
    await usePauseResume();
    await useReadableEvent();
    await useAsyncIteration();
    await useSlice();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main();
