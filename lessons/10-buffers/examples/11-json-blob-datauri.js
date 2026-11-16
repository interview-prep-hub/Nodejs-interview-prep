// Buffer.toJSON, Blob, base64 data URLs and the old btoa/atob helpers
// Run: node lessons/10-buffers/examples/11-json-blob-datauri.js

async function main() {
  console.log('--- Buffer.toJSON (called by JSON.stringify) ---');
  const buf = Buffer.from('hi!');
  console.log('toJSON()     :', buf.toJSON());
  const json = JSON.stringify({ id: 7, data: buf });
  console.log('stringify    :', json);
  const plain = JSON.parse(json);
  console.log('parse (plain):', plain.data, '<- just an object, not a Buffer');
  const revived = JSON.parse(json, (key, value) => (value && value.type === 'Buffer' ? Buffer.from(value) : value));
  console.log('parse reviver:', revived.data, '<- Buffer.from(object) understands the shape');
  console.log('compact form :', JSON.stringify({ data: buf.toString('base64') }), '<- much shorter for big data');

  console.log('\n--- Blob: immutable binary data with a MIME type ---');
  const blob = new Blob(['hello ', Buffer.from('w\u00f6rld')], { type: 'text/plain' });
  console.log('size, type   :', blob.size, blob.type, '(size counts BYTES)');
  console.log('text()       :', await blob.text());
  console.log('slice(0, 5)  :', await blob.slice(0, 5).text());
  const asBuffer = Buffer.from(await blob.arrayBuffer());
  console.log('arrayBuffer  :', asBuffer.toString('hex'), '-> Buffer');
  const parts = [];
  for await (const part of blob.stream()) parts.push(part); // Uint8Array pieces
  console.log('stream() total bytes:', Buffer.concat(parts).length, '(the piece sizes are an implementation detail)');
  console.log('globals      :', typeof Blob, typeof File, '(File extends Blob)');

  console.log('\n--- data URLs: "data:<type>;base64,<bytes>" ---');
  const picture = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // "GIF89a", the start of a GIF file
  const url = `data:image/gif;base64,${picture.toString('base64')}`;
  console.log('make   :', url);
  const comma = url.indexOf(','); // the header ends at the FIRST comma
  const header = url.slice(0, comma);
  const payload = url.slice(comma + 1);
  const mime = header.slice('data:'.length, header.indexOf(';'));
  console.log('parse  :', mime, Buffer.from(payload, 'base64').toString('latin1'));

  console.log('\n--- btoa and atob: old browser helpers, Latin-1 only ---');
  console.log("btoa('hello')   :", btoa('hello'));
  console.log("atob('aGVsbG8='):", atob('aGVsbG8='));
  try {
    btoa('\u20ac'); // the euro sign is outside Latin-1
  } catch (err) {
    console.log("btoa('euro')    :", err.name);
  }
  console.log('Buffer way      :', Buffer.from('\u20ac').toString('base64'), '(works for any text, utf8 first)');
}

main();
