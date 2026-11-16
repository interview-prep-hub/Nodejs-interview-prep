// Creating Buffers: from, alloc, allocUnsafe, length, the Uint8Array link, and where real Buffers come from
// Run: node lessons/10-buffers/examples/01-create-basics.js

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

// 1. Buffer.from(string): the string is turned into bytes (utf8 by default)
const fromString = Buffer.from('Hi!');
console.log('from string   :', fromString);

// 2. Buffer.from(array): every item becomes one byte (value modulo 256)
const fromArray = Buffer.from([72, 105, 33, 256, 257, -1]);
console.log('from array    :', fromArray);

// 3. Buffer.from(buffer): a COPY of the bytes
const original = Buffer.from([1, 2, 3]);
const copy = Buffer.from(original);
copy[0] = 99;
console.log('original      :', original, '(the copy was changed, this was not)');

// 4. Buffer.alloc(size): zero filled and safe
console.log('alloc(4)      :', Buffer.alloc(4));
console.log('alloc fill 7  :', Buffer.alloc(4, 7));
console.log('alloc fill str:', Buffer.alloc(5, 'ab'));

// 5. Buffer.allocUnsafe(size): NOT cleared. Fast, but you must fill every byte yourself.
const fast = Buffer.allocUnsafe(4);
fast.fill(0); // we overwrite all of it before we use it
console.log('allocUnsafe   :', fast, '(after fill(0))');

// 6. length is the number of BYTES. byteLength(string) tells you the size before you encode.
const text = 'Hi!';
console.log('length        :', fromString.length, '| byteLength(text):', Buffer.byteLength(text));

// 7. A Buffer is a Uint8Array
console.log('is Uint8Array :', fromString instanceof Uint8Array);
console.log('is Buffer     :', Buffer.isBuffer(fromString), Buffer.isBuffer(new Uint8Array(3)));
console.log('class chain   :', Object.getPrototypeOf(Buffer).name, '<- Buffer extends this');

// 8. Items are numbers from 0 to 255 and the size is fixed
const b = Buffer.from([1, 2, 3, 4]);
b[0] = 256 + 5; // wraps around: 261 % 256 = 5
b[1] = -1; // wraps around: 255
b[10] = 9; // outside the buffer: silently ignored
b.length = 2; // cannot resize: ignored here (in strict mode or an ES module this throws a TypeError)
console.log('wrap & fixed  :', b, '| b[10] =', b[10], '| length =', b.length);

// 9. Iterate like any typed array
let sum = 0;
for (const byte of Buffer.from('abc')) sum += byte;
console.log('sum of bytes  :', sum, '(97 + 98 + 99)');

// 10. Where real Buffers come from: files, hashes, random bytes, compression
console.log('\n--- where real Buffers come from ---');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buffers-lesson-'));
try {
  const file = path.join(dir, 'note.txt');
  fs.writeFileSync(file, 'caf\u00e9'); // 4 characters, 5 bytes on disk
  console.log('readFileSync(file)         :', fs.readFileSync(file), '<- no encoding given: a Buffer');
  console.log("readFileSync(file, 'utf8') :", fs.readFileSync(file, 'utf8'), '<- encoding given: a string');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

const digest = crypto.createHash('sha256').update('hello').digest(); // no encoding given: a Buffer
console.log('sha256 digest              :', digest.length, 'bytes, hex starts', digest.toString('hex').slice(0, 8));

const token = crypto.randomBytes(16); // random, so only the size is predictable
console.log('randomBytes(16)            :', token.length, 'bytes =', token.toString('hex').length, 'hex characters');

const repeated = 'hello '.repeat(20);
const packed = zlib.gzipSync(repeated);
console.log('gzipSync(text)             :', Buffer.isBuffer(packed), '| starts with 1f 8b:', packed.subarray(0, 2).toString('hex') === '1f8b', '| smaller:', packed.length < repeated.length);
console.log('gunzipSync(packed) matches :', zlib.gunzipSync(packed).toString() === repeated);
