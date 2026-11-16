// Reading and writing numbers in a Buffer, and what endianness means
// Run: node lessons/10-buffers/examples/06-numbers-endianness.js

const os = require('node:os');

console.log('--- one number, two byte orders ---');
const n = 0x12345678; // 305419896 in decimal
const be = Buffer.alloc(4);
const le = Buffer.alloc(4);
be.writeUInt32BE(n); // big endian: biggest byte first (also called network order)
le.writeUInt32LE(n); // little endian: smallest byte first
console.log('BE bytes :', be);
console.log('LE bytes :', le);
console.log('read BE as BE:', be.readUInt32BE(), '| read BE as LE:', be.readUInt32LE(), '(wrong order, wrong number)');
console.log('this CPU is  :', os.endianness());

console.log('\n--- signed vs unsigned: same byte, different meaning ---');
const ff = Buffer.from([0xff, 0xfe]);
console.log('readUInt8(0)   :', ff.readUInt8(0), '| readInt8(0)   :', ff.readInt8(0));
console.log('readUInt16BE() :', ff.readUInt16BE(), '| readInt16BE() :', ff.readInt16BE());
console.log('readUInt16LE() :', ff.readUInt16LE(), '| readInt16LE() :', ff.readInt16LE());

console.log('\n--- odd sizes: readUIntBE(offset, byteLength) ---');
const rgb = Buffer.from([0xff, 0x80, 0x00]); // a 24-bit colour
console.log('24-bit value   :', rgb.readUIntBE(0, 3).toString(16), '(hex)');
console.log('red, green, blue:', rgb[0], rgb[1], rgb[2]);

console.log('\n--- floats ---');
const f32 = Buffer.alloc(4);
f32.writeFloatBE(0.1);
console.log('float32 bytes  :', f32, '-> reads back as', f32.readFloatBE());
const f64 = Buffer.alloc(8);
f64.writeDoubleBE(0.1);
console.log('float64 bytes  :', f64, '-> reads back as', f64.readDoubleBE());
const one = Buffer.alloc(8);
one.writeDoubleBE(1.5);
console.log('1.5 as double  :', one);

console.log('\n--- 64-bit integers need BigInt ---');
const big = Buffer.alloc(8);
big.writeBigUInt64BE(2n ** 53n + 1n); // 9007199254740993, too big for a normal Number
console.log('as BigInt      :', big.readBigUInt64BE());
console.log('as Number      :', Number(big.readBigUInt64BE()), '(precision lost)');

console.log('\n--- going out of range throws ---');
const four = Buffer.alloc(4);
const attempts = [
  ['writeUInt8(300)', () => four.writeUInt8(300, 0)],
  ['writeUInt8(1, 4)', () => four.writeUInt8(1, 4)],
  ['readUInt32BE(2)', () => four.readUInt32BE(2)],
  ['writeInt8(-129)', () => four.writeInt8(-129, 0)],
];
for (const [label, fn] of attempts) {
  try {
    fn();
  } catch (err) {
    console.log(label.padEnd(17), err.name, err.code);
  }
}

console.log('\n--- typed arrays use the CPU order, DataView lets you choose ---');
const u16 = new Uint16Array([1]);
console.log('Uint16Array([1]) bytes:', Buffer.from(u16.buffer), '(depends on the CPU, little endian here)');
const dv = new DataView(new ArrayBuffer(2));
dv.setUint16(0, 1); // DataView default is big endian
console.log('DataView default     :', Buffer.from(dv.buffer));
dv.setUint16(0, 1, true); // true = little endian
console.log('DataView littleEndian:', Buffer.from(dv.buffer));
