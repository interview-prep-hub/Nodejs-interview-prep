// ArrayBuffer, TypedArray, DataView and Buffer: many windows onto one block of memory
// Run: node lessons/10-buffers/examples/08-arraybuffer-dataview.js

console.log('--- one ArrayBuffer, four views ---');
const memory = new ArrayBuffer(8); // 8 raw bytes, all zero. You cannot read it directly.
const bytes = new Uint8Array(memory); // 8 items of 1 byte
const words = new Uint16Array(memory); // 4 items of 2 bytes
const dv = new DataView(memory); // read/write any type at any offset, you pick the byte order
const buf = Buffer.from(memory); // Buffer.from(arrayBuffer) shares the memory, it does not copy

words[0] = 0x0102; // typed arrays use the CPU byte order (little endian on x86 and ARM)
console.log('Uint8Array :', bytes.join(' '));
dv.setUint16(2, 0x0304); // DataView: big endian unless you pass true
console.log('after DataView.setUint16(2):', bytes.join(' '));
buf[7] = 9;
console.log('after buf[7] = 9           :', bytes.join(' '));
console.log('byteLength of each view    :', memory.byteLength, bytes.byteLength, words.byteLength, buf.byteLength);
console.log('items in each view         :', bytes.length, words.length);
console.log('same memory?', buf.buffer === memory, bytes.buffer === memory);

console.log('\n--- Buffer.from(typedArray) COPIES the items; Buffer.from(arrayBuffer) shares ---');
const nums = new Uint16Array([1, 2, 300]);
const copied = Buffer.from(nums); // 3 items, each cut to one byte (300 % 256 = 44)
const viewed = Buffer.from(nums.buffer); // the raw 6 bytes
console.log('from typedArray   :', copied, '(values truncated to bytes)');
console.log('from its .buffer  :', viewed, '(the real bytes)');
console.log('copyBytesFrom     :', Buffer.copyBytesFrom(nums), '(copies the real bytes, new in Node 18.16 / 19.8)');

console.log('\n--- the byteOffset trap ---');
// A small Buffer usually lives inside a shared 8 KiB pool, so buf.buffer is the WHOLE pool.
Buffer.from('padding'); // takes a few bytes of the pool, so the next small Buffer does not start at 0
const small = Buffer.from('abcd');
console.log('small.length        :', small.length);
console.log('small.buffer size   :', small.buffer.byteLength, '<- the whole pool, not just 4 bytes');
console.log('small.byteOffset > 0:', small.byteOffset > 0, '<- where our 4 bytes start inside the pool');

const wrong = new Uint16Array(small.buffer); // BUG: ignores byteOffset and length
const right = new Uint16Array(small.buffer, small.byteOffset, small.length / 2);
console.log('wrong view items    :', wrong.length, '(the whole pool)');
console.log('right view          :', right, '(2 items: "ab" and "cd" read little endian)');

console.log('\n--- alignment: a Uint16Array must start at an even byte ---');
const odd = Buffer.from(memory, 1, 4); // starts at byte 1 of the ArrayBuffer
try {
  new Uint16Array(odd.buffer, odd.byteOffset, 2);
} catch (err) {
  console.log(err.name + ':', err.message);
}
const copyForView = new Uint16Array(Uint8Array.from(odd).buffer); // fix: copy to a fresh aligned buffer
console.log('after copying to a fresh buffer:', copyForView.length, 'items');

console.log('\n--- going the other way: TextEncoder gives Uint8Array, not Buffer ---');
const encoded = new TextEncoder().encode('\u00e9');
console.log('is Buffer?', Buffer.isBuffer(encoded), '| is Uint8Array?', encoded instanceof Uint8Array, '| bytes:', encoded.join(' '));
const asBuffer = Buffer.from(encoded.buffer, encoded.byteOffset, encoded.byteLength); // zero copy
console.log('as Buffer :', asBuffer, '| hex:', asBuffer.toString('hex'));
