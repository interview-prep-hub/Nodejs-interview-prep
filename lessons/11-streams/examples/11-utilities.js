// Stream utilities: finished, state properties, addAbortSignal, pipeline with a signal, end vs destroy, cork, default highWaterMark
// Run: node lessons/11-streams/examples/11-utilities.js

const { Readable, Writable, addAbortSignal, getDefaultHighWaterMark, setDefaultHighWaterMark } = require('node:stream');
const { finished, pipeline } = require('node:stream/promises');

// A Readable that makes a chunk every 5 ms and never ends. Good for testing cancellation.
function endlessSource() {
  return new Readable({
    read() {
      setTimeout(() => this.push('tick'), 5);
    },
  });
}

const nullSink = () => new Writable({ write: (chunk, encoding, callback) => callback() });

async function finishedDemo() {
  console.log('--- finished(): wait until a stream is really done ---');

  // 1. Success: resolves when a Readable has ended (or a Writable has finished).
  const reader = Readable.from(['a', 'b']);
  reader.resume(); // start the flow, we do not care about the data here
  await finished(reader);
  console.log('Readable ended normally');

  // 2. Error: rejects with the stream's error.
  const broken = new Readable({
    read() {
      this.destroy(new Error('boom'));
    },
  });
  broken.resume();
  await finished(broken).catch((err) => console.log('Readable failed       :', err.message));

  // 3. Closed too early: rejects with ERR_STREAM_PREMATURE_CLOSE.
  const early = new Readable({ read() {} });
  setTimeout(() => early.destroy(), 10);
  await finished(early).catch((err) => console.log('Readable destroyed    :', err.code));
}

async function statePropertiesDemo() {
  console.log('\n--- state properties of a Writable over its life ---');
  const writer = new Writable({
    write(chunk, encoding, callback) {
      setImmediate(callback); // finish each chunk a little later
    },
  });
  const show = (label) =>
    console.log(
      label.padEnd(18),
      `writableEnded=${writer.writableEnded}`,
      `writableFinished=${writer.writableFinished}`,
      `destroyed=${writer.destroyed}`,
      `closed=${writer.closed}`,
    );
  show('new');
  writer.write('data');
  writer.end();
  show('after end()'); // end() was called, but the data is not written yet
  await finished(writer);
  await new Promise((resolve) => setImmediate(resolve));
  show('after finished');
}

async function abortDemo() {
  console.log('\n--- cancelling with an AbortSignal ---');

  // addAbortSignal: when the signal aborts, the stream is destroyed with an AbortError.
  const controller = new AbortController();
  const source = addAbortSignal(controller.signal, endlessSource());
  source.on('error', (err) => console.log('stream error          :', err.name, err.code));
  setTimeout(() => controller.abort(), 15);
  await finished(source).catch(() => {});

  // pipeline accepts { signal } as its last argument. It destroys EVERY stream when it aborts.
  const manual = new AbortController();
  const reader = endlessSource();
  const writer = nullSink();
  setTimeout(() => manual.abort(new Error('user clicked cancel')), 15);
  await pipeline(reader, writer, { signal: manual.signal }).catch((err) => {
    console.log('pipeline rejected     :', err.name, '| reason:', err.cause.message);
  });
  console.log('both streams destroyed:', reader.destroyed && writer.destroyed);

  // AbortSignal.timeout(ms) is a ready-made signal that aborts after a time limit.
  await pipeline(endlessSource(), nullSink(), { signal: AbortSignal.timeout(30) }).catch((err) => {
    console.log('timeout               :', err.name, '| cause:', err.cause.name);
  });
}

// end() is a polite goodbye: everything already written is still processed.
// destroy() is an emergency stop: waiting data is dropped and 'finish' never comes.
async function endVersusDestroyDemo() {
  console.log('\n--- end() versus destroy() ---');
  for (const how of ['end()', 'destroy()', 'destroy(err)']) {
    const events = [];
    const writer = new Writable({
      write(chunk, encoding, callback) {
        events.push(`write:${chunk}`);
        setImmediate(callback);
      },
      final(callback) {
        events.push('_final');
        callback();
      },
    });
    writer.on('finish', () => events.push('finish'));
    writer.on('error', (err) => events.push(`error:${err.message}`));
    writer.on('close', () => events.push('close'));

    writer.write('a');
    writer.write('b');
    writer.write('c');
    if (how === 'end()') writer.end();
    else if (how === 'destroy()') writer.destroy();
    else writer.destroy(new Error('stop'));

    await new Promise((resolve) => setTimeout(resolve, 30));
    console.log(how.padEnd(13), events.join(' > '));
  }
}

// cork() holds small writes back, uncork() hands them to _writev() as ONE batch.
async function corkDemo() {
  console.log('\n--- cork() and uncork(): one batch instead of many small writes ---');
  for (const useCork of [false, true]) {
    const calls = [];
    const writer = new Writable({
      write(chunk, encoding, callback) {
        calls.push(`write(${chunk.length} bytes)`);
        callback();
      },
      writev(chunks, callback) {
        calls.push(`writev(${chunks.length} chunks)`);
        callback();
      },
    });
    if (useCork) writer.cork();
    writer.write('aa');
    writer.write('bb');
    writer.write('cc');
    if (useCork) process.nextTick(() => writer.uncork());
    await new Promise((resolve) => setTimeout(resolve, 10));
    console.log(useCork ? 'with cork()   :' : 'without cork():', calls.join(' '));
  }
}

function highWaterMarkDemo() {
  console.log('\n--- the default highWaterMark can be changed (for NEW streams) ---');
  const original = getDefaultHighWaterMark(false);
  console.log('before                :', original);
  setDefaultHighWaterMark(false, 64 * 1024);
  console.log('after set to 64 KiB   :', getDefaultHighWaterMark(false), '| new Writable():', new Writable().writableHighWaterMark);
  setDefaultHighWaterMark(false, original); // put it back
  console.log('restored              :', getDefaultHighWaterMark(false));
}

async function main() {
  await finishedDemo();
  await statePropertiesDemo();
  await abortDemo();
  await endVersusDestroyDemo();
  await corkDemo();
  highWaterMarkDemo();
}

main();
