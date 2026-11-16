// The shared pool, allocUnsafe vs alloc, where Buffer memory lives (outside the JS heap), and moving Buffers between threads
// Run: node --expose-gc lessons/10-buffers/examples/09-pool-unsafe-memory.js
// @flags --expose-gc

const MiB = 1024 * 1024;

console.log('--- the pool ---');
console.log('Buffer.poolSize          :', Buffer.poolSize, 'bytes'); // 8192 on Node 24.16, larger on newer releases
const a = Buffer.allocUnsafe(10);
const b = Buffer.from('hi');
const half = Buffer.poolSize >>> 1; // poolSize / 2 (4096 when poolSize is 8192)
const c = Buffer.allocUnsafe(half - 1); // below poolSize / 2: pooled
const d = Buffer.allocUnsafe(half); // poolSize / 2 or more: gets its own memory
const e = Buffer.allocUnsafeSlow(10); // never pooled, on purpose
const f = Buffer.alloc(10); // alloc never uses the pool
console.log('a, b, c share one pool   :', a.buffer === b.buffer && b.buffer === c.buffer);
console.log('pool size (a.buffer)     :', a.buffer.byteLength);
console.log('d own memory (poolSize/2):', d.buffer.byteLength);
console.log('e own memory (slow)      :', e.buffer.byteLength);
console.log('f own memory (alloc)     :', f.buffer.byteLength);

console.log('\n--- why allocUnsafe is risky ---');
// allocUnsafe hands you memory that was NOT cleared. To show it safely we first
// write "old data" ('X') over the whole shared pool, then allocate again.
const pool = new Uint8Array(a.buffer);
pool.fill(0x58);
const unsafe = Buffer.allocUnsafe(8); // comes from the same pool, so it still holds our 'X' bytes
const safe = Buffer.alloc(8);
console.log('same pool as before?     :', unsafe.buffer === a.buffer, '(the demo needs this to be true)');
console.log('allocUnsafe(8) contains  :', JSON.stringify(unsafe.toString()), '<- old data leaks through');
console.log('alloc(8) contains        :', safe.toString('hex'), '<- always zeros');

// A typical bug: reply with a buffer you only partly filled.
function badReply(text) {
  const out = Buffer.allocUnsafe(16);
  out.write(text); // the other bytes are never set
  return out;
}
function goodReply(text) {
  const out = Buffer.alloc(16);
  out.write(text);
  return out;
}
pool.fill(0x58); // pretend old secrets are still in memory
console.log('badReply("ok")           :', JSON.stringify(badReply('ok').toString()));
console.log('goodReply("ok") as hex   :', goodReply('ok').toString('hex'));

// A string cannot be wiped, but a Buffer can: overwrite key material as soon as you are done with it.
const key = require('node:crypto').randomBytes(8); // random bytes, e.g. a session key
key.fill(0);
console.log('key after fill(0)        :', key.toString('hex'));

console.log('\n--- Buffer memory is outside the JS heap ---');
const before = process.memoryUsage();
let big = Buffer.alloc(100 * MiB);
const during = process.memoryUsage();
console.log('arrayBuffers grew by 100 MiB or more :', during.arrayBuffers - before.arrayBuffers >= 100 * MiB);
console.log('external grew by 100 MiB or more     :', during.external - before.external >= 100 * MiB);
console.log('heapUsed changed by less than 1 MiB  :', Math.abs(during.heapUsed - before.heapUsed) < MiB);

console.log('\n--- memory comes back when the Buffer is garbage collected ---');
big = null; // drop the only reference
if (typeof global.gc === 'function') {
  global.gc();
  const after = process.memoryUsage();
  console.log('arrayBuffers shrank by 90 MiB or more:', during.arrayBuffers - after.arrayBuffers >= 90 * MiB);
} else {
  console.log('(run with --expose-gc to see this part)');
}

console.log('\n--- limits ---');
const { constants } = require('node:buffer');
console.log('max Buffer length (bytes):', constants.MAX_LENGTH);
console.log('max string length (chars):', constants.MAX_STRING_LENGTH);

console.log('\n--- sending a Buffer to another thread: copy, move or share ---');
// A MessageChannel is the same kind of channel a worker thread uses, but both ends live in one
// thread here, so the example stays small and the output is predictable.
const { MessageChannel, receiveMessageOnPort } = require('node:worker_threads');
const channel = new MessageChannel();
const receive = () => receiveMessageOnPort(channel.port2).message;

const original = Buffer.alloc(4, 7);
channel.port1.postMessage(original); // default: the bytes are COPIED
const copied = receive();
copied[0] = 1;
console.log('postMessage copies       : sender still has', original[0], '| receiver got a', copied.constructor.name);

const movable = Buffer.alloc(8); // alloc gives a Buffer its own ArrayBuffer
channel.port1.postMessage(movable, [movable.buffer]); // transfer list: MOVE the memory, no copy
receive();
console.log('transfer alloc(8)        : sender length is now', movable.length, '(the memory moved)');

try {
  const pooled = Buffer.from('small'); // lives inside the shared pool
  channel.port1.postMessage(pooled, [pooled.buffer]);
} catch (err) {
  console.log('transfer a pooled Buffer :', err.name, '(the pool is shared, so it cannot be moved)');
}

const shared = new SharedArrayBuffer(4); // memory that both sides can see
channel.port1.postMessage(new Uint8Array(shared));
receive()[0] = 42;
console.log('SharedArrayBuffer        : sender sees', Buffer.from(shared)[0], '(same memory on both sides)');
channel.port1.close();
channel.port2.close();
