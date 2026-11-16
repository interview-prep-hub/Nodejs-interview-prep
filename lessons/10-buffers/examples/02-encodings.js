// Encodings: the same bytes shown as utf8, hex, base64, base64url, latin1, ascii, utf16le
// Run: node lessons/10-buffers/examples/02-encodings.js

const { inspect } = require('node:util'); // inspect() shows control characters as \x82 etc.

const text = 'Héllo €';
const buf = Buffer.from(text, 'utf8');

console.log('--- one string, many views ---');
console.log('text     :', text, `(${text.length} characters)`);
console.log('bytes    :', buf.length);
console.log('utf8     :', buf.toString('utf8'));
console.log('hex      :', buf.toString('hex'));
console.log('base64   :', buf.toString('base64'));
console.log('base64url:', buf.toString('base64url'));
console.log('latin1   :', inspect(buf.toString('latin1')), '(each byte shown as one character)');
console.log('ascii    :', inspect(buf.toString('ascii')), '(top bit of every byte dropped)');
console.log('utf16le  :', Buffer.from(text, 'utf16le').toString('hex'), '(2 bytes per character here)');

console.log('\n--- round trips (text -> bytes -> text) ---');
for (const enc of ['utf8', 'utf16le', 'latin1', 'ascii']) {
  const back = Buffer.from(text, enc).toString(enc);
  console.log(enc.padEnd(8), back === text ? 'lossless' : `LOSSY, got ${inspect(back)}`);
}

console.log('\n--- hex and base64 are for BYTES, not for text ---');
const bytes = Buffer.from([0xfb, 0xff, 0xbf, 0x00, 0x10]);
const asHex = bytes.toString('hex');
const asB64 = bytes.toString('base64');
console.log('hex      :', asHex, '| back:', Buffer.from(asHex, 'hex').equals(bytes));
console.log('base64   :', asB64, '| back:', Buffer.from(asB64, 'base64').equals(bytes));

console.log('\n--- base64 vs base64url ---');
const tricky = Buffer.from([0xfb, 0xff, 0xbf]);
console.log('base64   :', tricky.toString('base64'), '(uses + and /)');
console.log('base64url:', tricky.toString('base64url'), '(uses - and _, no = padding)');
console.log('padding  :', Buffer.from('a').toString('base64'), 'vs', Buffer.from('a').toString('base64url'));
console.log('decoding accepts both alphabets:', Buffer.from('-_-_', 'base64').equals(Buffer.from('-_-_', 'base64url')));

console.log('\n--- size cost of base64 ---');
for (const n of [1, 2, 3, 4, 30]) {
  const encoded = Buffer.alloc(n).toString('base64');
  console.log(`${String(n).padStart(2)} bytes -> ${String(encoded.length).padStart(2)} chars (formula: ${Math.ceil(n / 3) * 4})`);
}

console.log('\n--- decoding is forgiving: bad hex is cut, not rejected ---');
console.log("'4a4b'   :", Buffer.from('4a4b', 'hex'));
console.log("'4a4b5'  :", Buffer.from('4a4b5', 'hex'), '(odd last digit dropped)');
console.log("'4azz4b' :", Buffer.from('4azz4b', 'hex'), '(stops at the first bad pair)');

console.log('\n--- converting bytes from one text encoding to another ---');
const { transcode } = require('node:buffer');
const euro = Buffer.from('\u20ac'); // utf8: e2 82 ac
console.log('utf8 bytes     :', euro);
console.log('as utf16le     :', transcode(euro, 'utf8', 'utf16le'), '(U+20AC stored low byte first)');
console.log('same as        :', Buffer.from('\u20ac', 'utf16le').equals(transcode(euro, 'utf8', 'utf16le')));

console.log('\n--- which names are valid? ---');
for (const name of ['utf8', 'UTF-8', 'binary', 'ucs2', 'base64url', 'utf-16', 'utf9']) {
  console.log(name.padEnd(10), Buffer.isEncoding(name));
}
