// Multi-byte characters split across chunks: the bug, and three fixes (also: Buffers in streams)
// Run: node lessons/10-buffers/examples/10-string-decoder.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');
const { inspect } = require('node:util');

async function main() {
  const whole = Buffer.from('\u20ac\u20ac'); // two euro signs, 3 bytes each: e2 82 ac e2 82 ac
  const chunk1 = whole.subarray(0, 4); // e2 82 ac e2  <- cuts the second character in half
  const chunk2 = whole.subarray(4); //    82 ac
  console.log('bytes :', whole.toString('hex'));
  console.log('chunk1:', chunk1.toString('hex'), '| chunk2:', chunk2.toString('hex'));

  console.log('\n--- the bug: toString() on each chunk ---');
  const buggy = chunk1.toString() + chunk2.toString();
  console.log('result:', inspect(buggy), '<- the second euro sign is destroyed');

  console.log('\n--- fix 1: collect the Buffers, decode once at the end ---');
  console.log('result:', inspect(Buffer.concat([chunk1, chunk2]).toString()));

  console.log('\n--- fix 2: StringDecoder remembers the half character ---');
  const decoder = new StringDecoder('utf8');
  const out1 = decoder.write(chunk1);
  const out2 = decoder.write(chunk2);
  console.log('after chunk1:', inspect(out1), '(the e2 byte is held back)');
  console.log('after chunk2:', inspect(out2));
  console.log('end()       :', inspect(decoder.end()), '(nothing left over)');

  console.log('\n--- fix 3: TextDecoder with { stream: true } (a web standard) ---');
  const td = new TextDecoder('utf-8');
  const t1 = td.decode(chunk1, { stream: true });
  const t2 = td.decode(chunk2, { stream: true });
  console.log('results:', inspect(t1), inspect(t2), inspect(td.decode()));

  console.log('\n--- a 4 byte emoji fed one byte at a time ---');
  const emoji = new StringDecoder('utf8');
  const pieces = [...Buffer.from('\ud83d\ude00')].map((byte) => emoji.write(Buffer.from([byte])));
  console.log('pieces:', inspect(pieces));

  console.log('\n--- if the data stops in the middle of a character ---');
  const cut = new StringDecoder('utf8');
  cut.write(Buffer.from([0xe2, 0x82])); // 2 of the 3 bytes
  console.log('end() gives the replacement character:', inspect(cut.end()));
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from([0xff]));
  } catch (err) {
    console.log('TextDecoder fatal:true throws        :', err.code);
  }

  console.log('\n--- the same bug inside a real stream ---');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buffers-lesson-'));
  try {
    const file = path.join(dir, 'euros.txt');
    fs.writeFileSync(file, '\u20ac\u20ac\u20ac'); // 9 bytes

    const chunks = [];
    for await (const chunk of fs.createReadStream(file, { highWaterMark: 4 })) chunks.push(chunk);
    console.log('chunks are Buffers  :', chunks.map((c) => c.toString('hex')).join(' | '));

    let naive = '';
    for (const chunk of chunks) naive += chunk.toString(); // BUG
    console.log('naive string +=     :', inspect(naive));
    console.log('Buffer.concat first :', inspect(Buffer.concat(chunks).toString()));

    let proper = '';
    const decoded = fs.createReadStream(file, { highWaterMark: 4, encoding: 'utf8' }); // uses a StringDecoder inside
    for await (const text of decoded) proper += text;
    console.log("{ encoding: 'utf8' }:", inspect(proper));

    // The shortcut: node:stream/consumers reads a whole stream into one value.
    const consumers = require('node:stream/consumers');
    const all = await consumers.buffer(fs.createReadStream(file, { highWaterMark: 4 }));
    const asText = await consumers.text(fs.createReadStream(file, { highWaterMark: 4 }));
    console.log('consumers.buffer()  :', all.toString('hex'));
    console.log('consumers.text()    :', inspect(asText));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main();
