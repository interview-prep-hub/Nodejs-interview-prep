// Error events: EventEmitter 'error', stream errors, pipe vs pipeline, captureRejections
// Run: node lessons/14-error-handling-and-debugging/examples/05-emitter-and-stream-errors.js

const EventEmitter = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const missing = path.join(os.tmpdir(), 'no-such-file-14.txt');

async function main() {
  console.log('1. Emitting "error" with no listener throws the error');
  const plain = new EventEmitter();
  try {
    plain.emit('error', new Error('nobody was listening'));
  } catch (e) {
    console.log('  emit threw:', e.message);
  }
  plain.on('error', (e) => console.log('  with a listener it is just an event:', e.message));
  plain.emit('error', new Error('now handled'));

  console.log('2. Streams are emitters: a failing read stream emits "error"');
  await new Promise((resolve) => {
    const rs = fs.createReadStream(missing);
    rs.on('error', (e) => {
      console.log('  read stream error:', e.code, '| destroyed:', rs.destroyed);
      resolve();
    });
    rs.on('data', () => console.log('  never printed'));
  });

  // A Readable that fails on its third read, used by the next two parts.
  function flaky() {
    let n = 0;
    return new Readable({
      read() {
        n++;
        if (n === 3) this.destroy(new Error('source broke at chunk 3'));
        else this.push(n < 3 ? `chunk${n}\n` : null);
      },
    });
  }

  console.log('3. .pipe() does NOT forward errors, so the destination is left open');
  await new Promise((resolve) => {
    const dest = new Writable({ write(chunk, enc, cb) { cb(); } });
    const source = flaky();
    source.on('error', (e) => {
      // Give the stream machinery one tick, then look at the destination.
      setImmediate(() => {
        console.log(`  source error: "${e.message}"`);
        console.log('  destination destroyed?', dest.destroyed, '(still open: a leak waiting to happen)');
        dest.destroy();
        resolve();
      });
    });
    source.pipe(dest);
  });

  console.log('4. pipeline() forwards the error and destroys every stream');
  const dest2 = new Writable({ write(chunk, enc, cb) { cb(); } });
  try {
    await pipeline(flaky(), dest2);
  } catch (e) {
    console.log('  pipeline rejected with:', e.message);
    console.log('  destination destroyed?', dest2.destroyed);
  }

  console.log('5. An async listener that rejects: captureRejections routes it to "error"');
  const safe = new EventEmitter({ captureRejections: true });
  safe.on('job', async () => {
    throw new Error('async listener failed');
  });
  await new Promise((resolve) => {
    safe.on('error', (e) => {
      console.log('  routed to the error event:', e.message);
      resolve();
    });
    safe.emit('job');
  });

  console.log('6. events.once() rejects if "error" is emitted first');
  const job = new EventEmitter();
  setImmediate(() => job.emit('error', new Error('failed before ready')));
  try {
    await EventEmitter.once(job, 'ready');
  } catch (e) {
    console.log('  once() rejected with:', e.message);
  }

  console.log('7. errorMonitor lets you log every error without handling it');
  const watched = new EventEmitter();
  watched.on(EventEmitter.errorMonitor, (e) => console.log('  monitor saw:', e.message));
  try {
    watched.emit('error', new Error('still unhandled'));
  } catch (e) {
    console.log('  and it still threw:', e.message);
  }
}

main();
