// pipe() vs stream.pipeline(): pipe leaves the other stream open when one side fails, pipeline cleans up
// Run: node lessons/11-streams/examples/04-pipe-vs-pipeline.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, Writable, pipeline } = require('node:stream');
const { pipeline: pipelineAsync } = require('node:stream/promises');
const { setTimeout: sleep } = require('node:timers/promises');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'streams-04-'));
const inputFile = path.join(dir, 'input.txt');
fs.writeFileSync(inputFile, 'abcdefghijklmnopqrstuvwxyz');

// A source that sends one chunk and then fails.
function failingSource() {
  let sent = false;
  return new Readable({
    read() {
      if (!sent) {
        sent = true;
        this.push('hello\n');
      } else {
        this.destroy(new Error('source failed'));
      }
    },
  });
}

// A destination that always fails.
function failingDestination() {
  return new Writable({
    write(chunk, encoding, callback) {
      callback(new Error('disk full'));
    },
  });
}

// Resolves when the stream emits 'close'. (events.once would reject on an 'error' event.)
const closed = (stream) => new Promise((resolve) => stream.on('close', resolve));

// A real file stream holds an open file handle until it is destroyed.
const openOutput = (name) => fs.createWriteStream(path.join(dir, name));
const openInput = () => fs.createReadStream(inputFile, { highWaterMark: 5 });

async function pipeSourceFails() {
  console.log('--- A. pipe(): the SOURCE fails ---');
  const source = failingSource();
  const destination = openOutput('a.txt');
  // pipe() does not forward errors, so we must listen on each stream by hand.
  // Without this line the error is uncaught and the process crashes.
  source.on('error', (err) => console.log('source error        :', err.message));
  source.pipe(destination);
  await closed(source);
  await sleep(20);
  console.log('destination destroyed:', destination.destroyed, '<- still open, the file handle leaks');
  destination.destroy(); // our manual cleanup
}

async function pipelineSourceFails() {
  console.log('\n--- B. pipeline(): the SOURCE fails ---');
  const destination = openOutput('b.txt');
  try {
    await pipelineAsync(failingSource(), destination);
  } catch (err) {
    console.log('pipeline rejected   :', err.message);
  }
  console.log('destination destroyed:', destination.destroyed, '<- pipeline closed it for us');
}

async function pipeDestinationFails() {
  console.log('\n--- C. pipe(): the DESTINATION fails ---');
  const source = openInput();
  const destination = failingDestination();
  destination.on('error', (err) => console.log('destination error   :', err.message));
  source.pipe(destination);
  await closed(destination);
  await sleep(20);
  console.log('source destroyed     :', source.destroyed, '<- still open, nobody reads it, the file handle leaks');
  source.destroy(); // our manual cleanup
}

async function pipelineDestinationFails() {
  console.log('\n--- D. pipeline(): the DESTINATION fails ---');
  const source = openInput();
  try {
    await pipelineAsync(source, failingDestination());
  } catch (err) {
    console.log('pipeline rejected   :', err.message);
  }
  console.log('source destroyed     :', source.destroyed, '<- pipeline closed it for us');
}

function callbackForm() {
  console.log('\n--- E. the callback form, when everything works ---');
  return new Promise((resolve) => {
    const destination = openOutput('e.txt');
    pipeline(openInput(), destination, (err) => {
      // The callback runs once, at the end, with the first error (or nothing on success)
      console.log('callback error      :', err ? err.message : 'none, success');
      console.log('bytes written       :', destination.bytesWritten);
      resolve();
    });
  });
}

async function main() {
  try {
    await pipeSourceFails();
    await pipelineSourceFails();
    await pipeDestinationFails();
    await pipelineDestinationFails();
    await callbackForm();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main();
