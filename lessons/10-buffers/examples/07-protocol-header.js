// Worked example: a tiny binary protocol (10 byte header + utf8 payload) and a stream parser
// Run: node lessons/10-buffers/examples/07-protocol-header.js
//
// Layout (numbers are big endian, the usual "network order"):
//   offset  size  field    meaning
//   0       2     magic    always 0xCAFE, helps us spot garbage
//   2       1     version  must be 1
//   3       1     flags    bit 0 compressed, bit 1 encrypted, bit 2 urgent
//   4       4     id       message id
//   8       2     length   payload size in BYTES
//   10      n     payload  utf8 text

const HEADER_SIZE = 10;
const MAGIC = 0xcafe;
const FLAGS = { COMPRESSED: 0b001, ENCRYPTED: 0b010, URGENT: 0b100 };

function encode({ id, flags = 0, payload }) {
  const body = Buffer.from(payload, 'utf8');
  const out = Buffer.alloc(HEADER_SIZE + body.length);
  out.writeUInt16BE(MAGIC, 0);
  out.writeUInt8(1, 2);
  out.writeUInt8(flags, 3);
  out.writeUInt32BE(id, 4);
  out.writeUInt16BE(body.length, 8);
  body.copy(out, HEADER_SIZE);
  return out;
}

// Returns { message, size } when a whole message is available, or null when we need more bytes.
function decode(buf) {
  if (buf.length < HEADER_SIZE) return null;
  const magic = buf.readUInt16BE(0);
  if (magic !== MAGIC) throw new Error(`bad magic 0x${magic.toString(16)}`);
  const version = buf.readUInt8(2);
  if (version !== 1) throw new Error(`unsupported version ${version}`);
  const flags = buf.readUInt8(3);
  const id = buf.readUInt32BE(4);
  const length = buf.readUInt16BE(8);
  const end = HEADER_SIZE + length;
  if (buf.length < end) return null; // header is here, payload is not complete yet
  const payload = buf.toString('utf8', HEADER_SIZE, end);
  return { message: { version, flags, id, payload }, size: end };
}

// TCP gives you a stream of bytes, not messages. A parser keeps the leftover bytes.
class Parser {
  constructor(onMessage) {
    this.pending = Buffer.alloc(0);
    this.onMessage = onMessage;
  }
  push(chunk) {
    this.pending = Buffer.concat([this.pending, chunk]);
    let result;
    while ((result = decode(this.pending)) !== null) {
      this.onMessage(result.message);
      this.pending = this.pending.subarray(result.size);
    }
  }
}

const flagNames = (flags) => Object.keys(FLAGS).filter((name) => flags & FLAGS[name]);

console.log('--- encode one message ---');
const one = encode({ id: 258, flags: FLAGS.URGENT | FLAGS.COMPRESSED, payload: 'hi' });
console.log('bytes   :', one.toString('hex'));
console.log('          cafe 01 05 00000102 0002 6869');
console.log('          magic, version, flags, id=258, length=2, "hi"');

console.log('\n--- decode it ---');
const { message } = decode(one);
console.log(message, flagNames(message.flags));

console.log('\n--- length counts bytes, not characters ---');
const accent = encode({ id: 1, payload: 'h\u00e9llo' });
console.log('"h\u00e9llo" is 5 characters, header says length =', accent.readUInt16BE(8));

console.log('\n--- a stream: two messages glued together, delivered in 7 byte chunks ---');
const stream = Buffer.concat([encode({ id: 1, payload: 'first' }), encode({ id: 2, payload: 'second one' })]);
console.log('total bytes on the wire:', stream.length);
const parser = new Parser((m) => console.log('  message ->', m.id, m.payload));
for (let i = 0; i < stream.length; i += 7) {
  const chunk = stream.subarray(i, i + 7);
  console.log(`chunk at ${String(i).padStart(2)}: ${chunk.length} bytes`);
  parser.push(chunk);
}
console.log('bytes left over:', parser.pending.length);

console.log('\n--- bad data is rejected ---');
try {
  decode(Buffer.from('this is not our protocol'));
} catch (err) {
  console.log('error:', err.message);
}
