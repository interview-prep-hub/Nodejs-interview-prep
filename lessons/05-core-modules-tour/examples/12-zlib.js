// zlib: gzip and gunzip a string, async versions, errors, and a file pipeline
// Run: node lessons/05-core-modules-tour/examples/12-zlib.js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const util = require('node:util');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises');

async function main() {
  console.log('--- gzip and gunzip a string (sync) ---');
  const text = 'Node.js makes servers simple. '.repeat(100);
  const zipped = zlib.gzipSync(text); // returns a Buffer
  console.log('original bytes:', Buffer.byteLength(text));
  console.log('gzip is smaller:', zipped.length < Buffer.byteLength(text));
  console.log('gzip bytes (can differ between zlib versions):', zipped.length);
  console.log('first two bytes (gzip magic number):', zipped.subarray(0, 2).toString('hex'));
  const restored = zlib.gunzipSync(zipped).toString('utf8');
  console.log('round trip equals the original:', restored === text);

  console.log('--- other formats ---');
  const small = Buffer.from(text);
  console.log('deflate/inflate round trip:', zlib.inflateSync(zlib.deflateSync(small)).equals(small));
  console.log('brotli round trip:', zlib.brotliDecompressSync(zlib.brotliCompressSync(small)).equals(small));
  console.log('gzip level 9 is not bigger than level 1:', zlib.gzipSync(text, { level: 9 }).length <= zlib.gzipSync(text, { level: 1 }).length);

  console.log('--- async version (does not block the event loop) ---');
  const gzip = util.promisify(zlib.gzip);
  const gunzip = util.promisify(zlib.gunzip);
  const again = await gunzip(await gzip('hello hello hello hello'));
  console.log('async result:', again.toString());

  console.log('--- errors ---');
  try {
    zlib.gunzipSync(Buffer.from('this is not gzip data'));
  } catch (err) {
    console.log('bad input ->', err.code, '|', err.message);
  }

  console.log('--- limit the output when the input is untrusted ---');
  const bomb = zlib.gzipSync(Buffer.alloc(1_000_000)); // 1 MB of zeros squeezes to a few KB
  console.log('compressed is tiny:', bomb.length < 10_000);
  try {
    zlib.gunzipSync(bomb, { maxOutputLength: 1000 });
  } catch (err) {
    console.log('refused to expand ->', err.code);
  }

  console.log('--- a file through a stream pipeline (gzip, then gunzip) ---');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zlib-demo-'));
  try {
    const plain = path.join(dir, 'log.txt');
    const packed = path.join(dir, 'log.txt.gz');
    const unpacked = path.join(dir, 'log-copy.txt');
    fs.writeFileSync(plain, 'line of a log file\n'.repeat(500));

    await pipeline(fs.createReadStream(plain), zlib.createGzip(), fs.createWriteStream(packed));
    await pipeline(fs.createReadStream(packed), zlib.createGunzip(), fs.createWriteStream(unpacked));

    console.log('packed file is smaller:', fs.statSync(packed).size < fs.statSync(plain).size);
    console.log('copy is identical:', fs.readFileSync(unpacked, 'utf8') === fs.readFileSync(plain, 'utf8'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main();
