// Messages: structured clone, then copy vs zero-copy transfer
// Shows: what survives postMessage, what does not, and how a transfer list moves an ArrayBuffer without copying it.
// Run: node lessons/18-worker-threads-and-cluster/examples/03-messages-and-transfer.js

const { Worker } = require('node:worker_threads');

class User {
  constructor(name) {
    this.name = name;
  }
  hello() {
    return `hi ${this.name}`;
  }
}

// A tiny worker (given as a string with eval: true) that sends back whatever it receives.
const echoCode = `
  const { parentPort } = require('node:worker_threads');
  parentPort.on('message', (value) => parentPort.postMessage(value));
`;

// A second tiny worker that only reports the size of the buffer it receives.
const sizeCode = `
  const { parentPort } = require('node:worker_threads');
  parentPort.on('message', (buf) => {
    parentPort.postMessage({ byteLength: buf.byteLength, firstByte: new Uint8Array(buf)[0] });
  });
`;

function nextMessage(worker) {
  return new Promise((resolve) => worker.once('message', resolve));
}

async function main() {
  const echo = new Worker(echoCode, { eval: true });

  console.log('--- Part 1: what the structured clone algorithm keeps ---');

  const original = {
    date: new Date(0),
    set: new Set(['a', 'b']),
    map: new Map([['k', 1]]),
    typed: new Uint8Array([1, 2, 3]),
    nested: { list: [1, [2, 3]] },
  };
  original.self = original; // a circular reference is fine for structured clone

  echo.postMessage(original);
  const copy = await nextMessage(echo);
  console.log('Date stays a Date      :', copy.date instanceof Date, copy.date.toISOString());
  console.log('Set and Map survive    :', copy.set instanceof Set, copy.map instanceof Map, copy.map.get('k'));
  console.log('circular reference     :', copy.self === copy);
  console.log('it is a copy, not same :', copy !== original && copy.nested !== original.nested);

  echo.postMessage(new User('Ada'));
  const user = await nextMessage(echo);
  console.log('class instance         :', user, 'instanceof User:', user instanceof User, ', has hello():', typeof user.hello);

  echo.postMessage(Buffer.from('hey'));
  const bytes = await nextMessage(echo);
  console.log('Buffer comes back as   :', bytes.constructor.name, ', isBuffer:', Buffer.isBuffer(bytes));

  echo.postMessage(new RangeError('too far'));
  const err = await nextMessage(echo);
  console.log('Error comes back as    :', err.constructor.name, err.message);

  // Things that cannot be cloned throw right away, in the sender, as DataCloneError.
  for (const [label, value] of [['a function', () => 1], ['a Symbol', Symbol('s')], ['an object with a method', { run() {} }]]) {
    try {
      echo.postMessage(value);
    } catch (e) {
      console.log(`${label.padEnd(23)}:`, e.name, `(code ${e.code})`);
    }
  }
  await echo.terminate();

  console.log('\n--- Part 2: copy versus transfer (64 MiB ArrayBuffer) ---');
  const sizer = new Worker(sizeCode, { eval: true });
  const SIZE = 64 * 1024 * 1024;

  const forCopy = new ArrayBuffer(SIZE);
  new Uint8Array(forCopy).fill(7);
  let started = performance.now();
  sizer.postMessage(forCopy); // no transfer list: the bytes are copied
  const copyMs = performance.now() - started;
  console.log('after copy    : sender byteLength =', forCopy.byteLength, ', detached =', forCopy.detached);
  console.log('worker saw    :', await nextMessage(sizer));

  const forMove = new ArrayBuffer(SIZE);
  new Uint8Array(forMove).fill(9);
  started = performance.now();
  sizer.postMessage(forMove, [forMove]); // transfer list: ownership moves, nothing is copied
  const moveMs = performance.now() - started;
  console.log('after transfer: sender byteLength =', forMove.byteLength, ', detached =', forMove.detached);
  console.log('worker saw    :', await nextMessage(sizer));

  console.log(`postMessage took about ${Math.round(copyMs)} ms to copy and ${moveMs < 1 ? 'under 1' : Math.round(moveMs)} ms to transfer (numbers vary)`);

  console.log('\n--- Part 3: a gotcha with small Buffers ---');
  const small = Buffer.from('abc'); // small Buffers live inside a shared 8 KiB pool
  console.log('small.buffer.byteLength =', small.buffer.byteLength, '(the whole pool, not 3)');
  try {
    sizer.postMessage(small, [small.buffer]);
  } catch (e) {
    console.log('transfer of a pooled Buffer fails:', e.name, '-', e.message);
  }

  await sizer.terminate();
}

main();
