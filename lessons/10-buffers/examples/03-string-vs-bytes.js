// String length vs byte length, and why turning binary data into utf8 text destroys it
// Run: node lessons/10-buffers/examples/03-string-vs-bytes.js

const { isUtf8 } = require('node:buffer');
const { inspect } = require('node:util');

console.log('--- characters are not bytes ---');
console.log('length chars bytes utf8 hex       text');
for (const s of ['hello', 'héllo', '€', 'こんにちは', '😀', '👨‍👩‍👧']) {
  const length = s.length; // UTF-16 code units
  const chars = [...s].length; // code points
  const bytes = Buffer.byteLength(s); // utf8 bytes
  const hex = bytes <= 8 ? Buffer.from(s).toString('hex') : '...';
  console.log(String(length).padStart(6), String(chars).padStart(5), String(bytes).padStart(5), hex.padEnd(12), s);
}

console.log('\n--- cutting a string by BYTES can cut a character in half ---');
const word = Buffer.from('caf\u00e9'); // 5 bytes: c a f c3 a9
console.log('whole      :', word.toString());
console.log('first 4 B  :', inspect(word.subarray(0, 4).toString()), '(half of the e-acute)');

console.log('\n--- binary data is NOT utf8 text ---');
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // start of every PNG file
console.log('original bytes     :', png.toString('hex'));
console.log('valid utf8?        :', isUtf8(png));
const asText = png.toString('utf8'); // lossy: 0x89 is not valid utf8
console.log('as utf8 text       :', inspect(asText));
const back = Buffer.from(asText, 'utf8');
console.log('text back to bytes :', back.toString('hex'));
console.log('same bytes?        :', back.equals(png), `(${png.length} bytes became ${back.length})`);

console.log('\n--- safe ways to carry binary data inside a string ---');
const viaLatin1 = Buffer.from(png.toString('latin1'), 'latin1');
const viaHex = Buffer.from(png.toString('hex'), 'hex');
const viaBase64 = Buffer.from(png.toString('base64'), 'base64');
console.log('latin1 round trip  :', viaLatin1.equals(png), '(1 byte <-> 1 char, but the text looks like garbage)');
console.log('hex round trip     :', viaHex.equals(png), '(2 chars per byte)');
console.log('base64 round trip  :', viaBase64.equals(png), '(about 1.33 chars per byte)');

console.log('\n--- a hidden character: the byte order mark (BOM) ---');
// Some Windows programs write the bytes ef bb bf at the start of a utf8 file. They are valid utf8 for U+FEFF.
const withBom = Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]); // BOM followed by the text {}
const kept = withBom.toString('utf8');
console.log('toString() length      :', kept.length, '(1 invisible BOM character + 2 visible ones)');
console.log('first char code        :', kept.charCodeAt(0).toString(16), '<- U+FEFF, not part of your data');
try {
  JSON.parse(kept);
} catch (err) {
  console.log('JSON.parse             :', err.name, '<- the BOM breaks it');
}
console.log('TextDecoder removes it :', inspect(new TextDecoder().decode(withBom)));
console.log('or cut it off yourself :', inspect(kept.replace(/^\uFEFF/, '')));
