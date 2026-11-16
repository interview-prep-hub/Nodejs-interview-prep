// Writing your own Readable, Writable and Transform (class form and simplified constructor form), plus object mode
// Run: node lessons/11-streams/examples/06-custom-streams.js

const { Readable, Writable, Duplex, Transform } = require('node:stream');
const { pipeline: pipelineAsync } = require('node:stream/promises');

// ---------- Readable ----------
// You implement _read(). Node calls it when the consumer wants more data.
// Inside, call this.push(chunk) to hand data over, and this.push(null) to say "the end".
class Countdown extends Readable {
  constructor(start) {
    super(); // default options: byte stream, chunks are Buffers
    this.current = start;
  }

  _read() {
    if (this.current === 0) {
      this.push(null); // end of data
    } else {
      this.push(`${this.current}\n`); // strings are turned into Buffers
      this.current--;
    }
  }
}

// The same idea with the simplified constructor form: pass read() as an option.
function makeLetters(text) {
  let index = 0;
  return new Readable({
    read() {
      if (index >= text.length) this.push(null);
      else this.push(text[index++]);
    },
  });
}

async function readableDemo() {
  console.log('--- Readable: class form ---');
  // Small pushes may reach the consumer glued together or one by one. The number of chunks is
  // not guaranteed, so we join them before printing.
  let countdown = '';
  for await (const chunk of new Countdown(3)) countdown += chunk.toString();
  console.log('countdown :', countdown.trim().split('\n'));

  console.log('\n--- Readable: simplified form ---');
  let letters = '';
  for await (const chunk of makeLetters('abc')) letters += chunk.toString();
  console.log('letters   :', letters);
}

// ---------- Writable ----------
// You implement _write(chunk, encoding, callback). Call callback() when you are done with the chunk.
// Call callback(err) to report a failure. Optional: _final(callback) runs before 'finish'.
class Collector extends Writable {
  constructor() {
    super();
    this.lines = [];
  }

  _write(chunk, encoding, callback) {
    // chunk is a Buffer, even when the caller wrote a string (decodeStrings is true by default)
    this.lines.push(chunk.toString());
    callback();
  }

  _final(callback) {
    console.log('  _final: all writes are done, last chance to flush');
    callback();
  }

  _destroy(err, callback) {
    console.log('  _destroy: release resources here');
    callback(err);
  }
}

async function writableDemo() {
  console.log('\n--- Writable: class form, with the lifecycle ---');
  const collector = new Collector();
  collector.on('finish', () => console.log('  event finish'));
  collector.on('close', () => console.log('  event close'));
  collector.write('first');
  collector.write('second');
  collector.end('third'); // end(chunk) = write(chunk) + end()
  await new Promise((resolve) => collector.on('close', resolve));
  console.log('collected :', collector.lines);

  console.log('\n--- Writable: simplified form ---');
  const seen = [];
  const writer = new Writable({
    write(chunk, encoding, callback) {
      seen.push(chunk.toString().toUpperCase());
      callback();
    },
  });
  writer.end('hello');
  await new Promise((resolve) => writer.on('close', resolve));
  console.log('seen      :', seen);
}

// ---------- Duplex ----------
// A Duplex is two streams in one object: a Readable side and a Writable side. They are
// independent. What you write in is NOT what you read out (a socket works like this).
async function duplexDemo() {
  console.log('\n--- Duplex: two separate sides ---');
  let sent = false;
  const duplex = new Duplex({
    read() {
      // the readable side
      if (!sent) {
        sent = true;
        this.push('from the readable side');
      } else {
        this.push(null);
      }
    },
    write(chunk, encoding, callback) {
      // the writable side
      console.log('writable side received:', chunk.toString());
      callback();
    },
  });
  duplex.end('hello');
  for await (const chunk of duplex) console.log('readable side gave   :', chunk.toString());
}

// ---------- Transform ----------
// You implement _transform(chunk, encoding, callback). callback(err, output) sends output on.
// Optional: _flush(callback) runs at the very end, and may push one last piece.
class UpperCase extends Transform {
  _transform(chunk, encoding, callback) {
    callback(null, chunk.toString().toUpperCase());
  }

  _flush(callback) {
    this.push('\n(end of data)');
    callback();
  }
}

// Simplified form. This one skips every chunk that has no letters in it.
const keepWithLetters = new Transform({
  transform(chunk, encoding, callback) {
    if (/[a-z]/i.test(chunk.toString())) this.push(chunk); // push zero, one or many times
    callback(); // always call it, even when you pushed nothing
  },
});

async function transformDemo() {
  console.log('\n--- Transform: class form ---');
  const output = [];
  await pipelineAsync(
    Readable.from(['quiet ', 'words ', 'here']),
    new UpperCase(),
    new Writable({
      write(chunk, encoding, callback) {
        output.push(chunk.toString());
        callback();
      },
    }),
  );
  console.log('output    :', JSON.stringify(output.join('')));

  console.log('\n--- Transform: simplified form (drops chunks) ---');
  const kept = [];
  await pipelineAsync(
    Readable.from(['abc', '123', 'def', '456']),
    keepWithLetters,
    new Writable({
      write(chunk, encoding, callback) {
        kept.push(chunk.toString());
        callback();
      },
    }),
  );
  console.log('kept      :', kept);
}

// ---------- Object mode ----------
// By default a stream moves bytes (Buffers or strings). In object mode every chunk is ONE
// JavaScript value of any kind (an object, a number, an array). null is still the end marker.
async function objectModeDemo() {
  console.log('\n--- object mode ---');
  const readerObj = new Readable({ objectMode: true, read() {} });
  const writerObj = new Writable({ objectMode: true, write(chunk, encoding, callback) { setImmediate(callback); } });
  console.log('Readable highWaterMark (objects):', readerObj.readableHighWaterMark);
  console.log('Writable highWaterMark (objects):', writerObj.writableHighWaterMark);

  // In object mode the highWaterMark counts OBJECTS, not bytes. A 1 MB object counts as 1.
  let falseAt = 0;
  for (let i = 1; i <= 20; i++) {
    const ok = writerObj.write({ id: i });
    if (!ok && falseAt === 0) falseAt = i;
  }
  console.log('write() first returned false at object number:', falseAt);
  writerObj.end();

  // A Transform can use different modes on each side: text in, objects out.
  const toObjects = new Transform({
    readableObjectMode: true, // what comes OUT is objects
    transform(chunk, encoding, callback) {
      callback(null, { length: chunk.length, text: chunk.toString() });
    },
  });
  const objects = [];
  await pipelineAsync(
    Readable.from(['hi', 'there'], { objectMode: false }),
    toObjects,
    new Writable({
      objectMode: true,
      write(chunk, encoding, callback) {
        objects.push(chunk);
        callback();
      },
    }),
  );
  console.log('objects out of the Transform:', objects);
}

async function main() {
  await readableDemo();
  await writableDemo();
  await duplexDemo();
  await transformDemo();
  await objectModeDemo();
}

main();