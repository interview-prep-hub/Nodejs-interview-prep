// Everyday Buffer tools: concat, compare, equals, indexOf, includes, fill, write
// Run: node lessons/10-buffers/examples/05-compare-search-write.js

const crypto = require('node:crypto');

console.log('--- concat ---');
const parts = [Buffer.from('Hel'), Buffer.from('lo '), Buffer.from('World')];
console.log('joined      :', Buffer.concat(parts).toString());
console.log('totalLength :', Buffer.concat(parts, 5).toString(), '(cut at 5 bytes)');
console.log('padded      :', Buffer.concat([Buffer.from('ab')], 4), '(extra bytes are zeros)');
console.log('empty list  :', Buffer.concat([]));

console.log('\n--- equals and compare ---');
const a = Buffer.from('apple');
const b = Buffer.from('banana');
console.log('a.equals(copy)   :', a.equals(Buffer.from('apple')));
console.log('a === copy       :', a === Buffer.from('apple'), '(=== compares objects, not bytes)');
console.log('a.compare(b)     :', a.compare(b), '(-1: a sorts before b)');
console.log('b.compare(a)     :', b.compare(a), '(1: b sorts after a)');
console.log('a.compare(a)     :', a.compare(Buffer.from('apple')), '(0: same bytes)');
const sorted = [b, a, Buffer.from('cherry')].sort(Buffer.compare);
console.log('sorted           :', sorted.map((x) => x.toString()).join(', '));

console.log('\n--- comparing secrets: use timingSafeEqual ---');
const token = Buffer.from('s3cret-token');
console.log('same       :', crypto.timingSafeEqual(token, Buffer.from('s3cret-token')));
console.log('different  :', crypto.timingSafeEqual(token, Buffer.from('s3cret-tokeX')));
try {
  crypto.timingSafeEqual(token, Buffer.from('short')); // lengths must match
} catch (err) {
  console.log('other size :', err.code);
}

console.log('\n--- indexOf, lastIndexOf, includes ---');
const data = Buffer.from('one,two,three');
console.log("indexOf(',')      :", data.indexOf(','));
console.log("lastIndexOf(',')  :", data.lastIndexOf(','));
console.log("indexOf(0x2c)     :", data.indexOf(0x2c), '(a number searches for one byte)');
console.log("indexOf('two')    :", data.indexOf('two'));
console.log("indexOf(',', 4)   :", data.indexOf(',', 4), '(start looking at byte 4)');
console.log("indexOf('zzz')    :", data.indexOf('zzz'), '(-1 means not found)');
console.log("includes('three') :", data.includes('three'));
console.log("indexOf(Buffer)   :", data.indexOf(Buffer.from([0x74, 0x77])));

console.log('\n--- fill ---');
console.log("fill('ab')    :", Buffer.alloc(5).fill('ab').toString());
console.log('fill(0xff)    :', Buffer.alloc(3).fill(0xff));
console.log('fill range    :', Buffer.alloc(6).fill(1, 2, 4), '(only bytes 2 and 3)');
console.log("fill('')      :", Buffer.alloc(3).fill(7).fill(''), '(empty string fills with zeros)');

console.log('\n--- write ---');
const box = Buffer.alloc(8);
const n1 = box.write('Hi'); // starts at 0
const n2 = box.write('Node', 2); // starts at byte 2
console.log('wrote', n1, 'then', n2, 'bytes ->', box.toString('utf8', 0, 6));
const small = Buffer.alloc(5);
const n3 = small.write('\u20ac\u20ac'); // two euro signs need 6 bytes, only 5 fit
console.log('euro x2 into 5 bytes wrote', n3, 'bytes:', small, '(a half character is never written)');
const target = Buffer.alloc(4);
target.write('cafebabe', 'hex'); // the encoding is the 2nd argument when there is no offset
console.log('write hex   :', target);
console.log('toString(enc, start, end):', data.toString('utf8', 4, 7));
