// subarray SHARES memory, copying does not. The classic Buffer gotcha.
// Run: node lessons/10-buffers/examples/04-share-vs-copy.js

console.log('--- subarray: a window onto the same bytes ---');
const parent = Buffer.from('hello world');
const view = parent.subarray(0, 5); // no bytes are copied
view[0] = 0x4a; // 'J'
console.log('view   :', view.toString());
console.log('parent :', parent.toString(), '<- the parent changed too');
console.log('same memory?', view.buffer === parent.buffer);

console.log('\n--- slice on a Buffer also shares (the name is misleading) ---');
const s = parent.slice(6); // Buffer.slice behaves like subarray (and is deprecated in the docs)
s[0] = 0x57; // 'W'
console.log('parent :', parent.toString());

console.log('\n--- but slice on a plain Uint8Array COPIES ---');
const u8 = new Uint8Array([1, 2, 3, 4]);
const u8slice = u8.slice(1, 3);
u8slice[0] = 99;
console.log('u8     :', u8.join(','), '<- unchanged');

console.log('\n--- three ways to get a real copy ---');
const src = Buffer.from('abcdef');

const copy1 = Buffer.from(src.subarray(0, 3)); // Buffer.from(buffer) copies
copy1[0] = 0x58;

const copy2 = Buffer.alloc(3); // allocate, then copy into it
const written = src.copy(copy2, 0, 0, 3); // copy(target, targetStart, sourceStart, sourceEnd)
copy2[1] = 0x59;

const copy3 = Buffer.concat([src.subarray(0, 3)]); // concat always allocates a new buffer
copy3[2] = 0x5a;

console.log('src    :', src.toString(), '<- never changed');
console.log('copy1  :', copy1.toString());
console.log('copy2  :', copy2.toString(), `(copy() returned ${written})`);
console.log('copy3  :', copy3.toString());

console.log('\n--- copy() can move bytes inside the same buffer ---');
const moving = Buffer.from('12345');
moving.copy(moving, 1, 0, 4); // overlap is handled correctly
console.log('moving :', moving.toString());

console.log('\n--- a tiny view keeps the whole parent alive ---');
const big = Buffer.alloc(1024 * 1024); // 1 MiB
const tiny = big.subarray(0, 4);
console.log('tiny.length            :', tiny.length);
console.log('tiny keeps this alive  :', tiny.buffer.byteLength, 'bytes');
const exact = Buffer.alloc(4); // exact-size copy, then the big one can be freed
tiny.copy(exact);
console.log('exact copy owns        :', exact.buffer.byteLength, 'bytes');
