// A hex dump helper: offset, hex bytes and printable text, like the `xxd` / `hexdump -C` tools
// Run: node lessons/10-buffers/examples/12-hexdump.js

// Returns a string with one line per 16 bytes:
//   00000000  48 65 6c 6c 6f 2c 20 42  75 66 66 65 72 73 21 0a  |Hello, Buffers!.|
function hexdump(input, bytesPerLine = 16) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const lines = [];
  for (let offset = 0; offset < buf.length; offset += bytesPerLine) {
    const row = buf.subarray(offset, offset + bytesPerLine);
    let hex = '';
    let text = '';
    for (let i = 0; i < bytesPerLine; i++) {
      if (i === bytesPerLine / 2) hex += ' '; // extra gap in the middle
      if (i < row.length) {
        hex += row[i].toString(16).padStart(2, '0') + ' ';
        // printable ASCII is 0x20 (space) to 0x7e (~). Everything else shows as a dot.
        text += row[i] >= 0x20 && row[i] <= 0x7e ? String.fromCharCode(row[i]) : '.';
      } else {
        hex += '   '; // keep the columns aligned on the last, short line
      }
    }
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex} |${text}|`);
  }
  return lines.join('\n');
}

module.exports = { hexdump };

if (require.main === module) {
  console.log('--- text ---');
  console.log(hexdump('Hello, Buffers!\n'));

  console.log('\n--- non-ASCII text: the accent and the emoji become several bytes ---');
  console.log(hexdump('caf\u00e9 \u20ac \ud83d\ude00'));

  console.log('\n--- the first bytes of a PNG file ---');
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
  console.log(hexdump(png));

  console.log('\n--- 40 bytes: the last line is short ---');
  console.log(hexdump(Buffer.from(Array.from({ length: 40 }, (_, i) => i * 6))));
}
