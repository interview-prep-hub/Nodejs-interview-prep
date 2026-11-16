// Web Streams (ReadableStream, TransformStream, WritableStream) and converting to and from Node streams
// Run: node lessons/11-streams/examples/10-web-streams.js

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { Readable, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { setTimeout: sleep } = require('node:timers/promises');

// ReadableStream, WritableStream, TransformStream, TextDecoderStream and CompressionStream
// are globals in Node 24 (the same classes browsers have).

async function readableStreams() {
  console.log('--- 1. ReadableStream: start() pushes data, a reader pulls it ---');
  const simple = new ReadableStream({
    start(controller) {
      controller.enqueue('a');
      controller.enqueue('b');
      controller.close();
    },
  });
  const reader = simple.getReader(); // while a reader exists, the stream is "locked"
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    console.log('read      :', value);
  }

  console.log('\n--- 2. pull() is called only when the queue has room (this is backpressure) ---');
  let pulls = 0;
  const endless = new ReadableStream({
    pull(controller) {
      pulls++;
      controller.enqueue(pulls); // this stream never ends, it makes numbers on demand
    },
  });
  await sleep(20);
  console.log('pull() calls before anyone reads  :', pulls, '(it filled its queue, then stopped)');
  const endlessReader = endless.getReader();
  await endlessReader.read();
  await endlessReader.read();
  await sleep(20);
  console.log('pull() calls after reading 2 items:', pulls, '(always one item ahead)');
  await endlessReader.cancel(); // tell the source we are done

  console.log('\n--- async iteration works on a ReadableStream too ---');
  for await (const value of ReadableStream.from([10, 20])) console.log('got       :', value);

  console.log('\n--- 3. ReadableStream.from, pipeThrough, pipeTo ---');
  const upperCase = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk.toUpperCase());
    },
  });
  const seen = [];
  const sink = new WritableStream({
    write(chunk) {
      seen.push(chunk);
    },
  });
  await ReadableStream.from(['web', 'streams']).pipeThrough(upperCase).pipeTo(sink);
  console.log('sink got  :', seen);
}

async function convert() {
  console.log('\n--- 4. Node Readable -> web ReadableStream: Readable.toWeb ---');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'streams-10-'));
  const file = path.join(dir, 'hello.txt');
  fs.writeFileSync(file, 'hello from a file');
  try {
    const web = Readable.toWeb(fs.createReadStream(file));
    let bytes = 0;
    for await (const chunk of web) bytes += chunk.length; // chunks are Uint8Array
    console.log('web stream delivered', bytes, 'bytes');

    console.log('\n--- 5. web ReadableStream -> Node Readable: Readable.fromWeb ---');
    const webSource = ReadableStream.from(['one ', 'two ', 'three']);
    const nodeReadable = Readable.fromWeb(webSource);
    let text = '';
    await pipeline(
      nodeReadable,
      new Writable({
        write(chunk, encoding, callback) {
          text += chunk.toString();
          callback();
        },
      }),
    );
    console.log('Node side got:', JSON.stringify(text));
    console.log('has pipe()?  :', typeof nodeReadable.pipe, '(a Node stream now)');
    console.log('has getReader()? on the web stream:', typeof webSource.getReader);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function fetchBody() {
  console.log('\n--- 6. fetch() gives a web stream as response.body ---');
  const server = http.createServer((req, res) => {
    res.write('part 1\n');
    setTimeout(() => res.write('part 2\n'), 20);
    setTimeout(() => res.end('part 3\n'), 40);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    console.log('body is a ReadableStream:', response.body instanceof ReadableStream);
    // TextDecoderStream is a TransformStream: bytes in, text out (it handles split characters)
    let text = '';
    for await (const piece of response.body.pipeThrough(new TextDecoderStream())) text += piece;
    console.log('received text:', JSON.stringify(text));
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

async function compression() {
  console.log('\n--- 7. CompressionStream and DecompressionStream (web) ---');
  const original = 'streams '.repeat(1000);
  const gzipped = await new Response(
    new Blob([original]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer();
  console.log('original bytes   :', original.length);
  console.log('gzipped bytes    :', gzipped.byteLength);
  console.log('zlib can read it :', zlib.gunzipSync(Buffer.from(gzipped)).toString() === original);

  const restored = await new Response(
    new Blob([gzipped]).stream().pipeThrough(new DecompressionStream('gzip')),
  ).text();
  console.log('round trip equal :', restored === original);
}

async function main() {
  await readableStreams();
  await convert();
  await fetchBody();
  await compression();
}

main();
