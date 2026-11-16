// Web-platform APIs that Node now ships as globals, plus two Node-only helpers.
// Shows: URLPattern, navigator, Web Crypto, Web Streams, BroadcastChannel, process.getBuiltinModule, AsyncLocalStorage.
// Run: node lessons/22-modern-node-features/examples/03-platform-globals.js

const { AsyncLocalStorage } = require('node:async_hooks');
const { Readable } = require('node:stream');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hex = (buffer) => Buffer.from(buffer).toString('hex');

async function main() {
  console.log('1. URLPattern (a global since Node 24, still marked experimental in the docs)');
  const pattern = new URLPattern({ pathname: '/users/:id' });
  console.log('  test /users/42:', pattern.test('http://example.com/users/42'));
  console.log('  test /posts/42:', pattern.test('http://example.com/posts/42'));
  console.log('  id from exec():', pattern.exec('http://example.com/users/42').pathname.groups.id);

  console.log('2. navigator (like in a browser)');
  console.log('  userAgent:', navigator.userAgent);
  console.log('  hardwareConcurrency is a number:', typeof navigator.hardwareConcurrency === 'number');
  console.log('  language and platform are strings:', typeof navigator.language, typeof navigator.platform);

  console.log('3. Web Crypto (the global crypto object)');
  console.log('  randomUUID length:', crypto.randomUUID().length);
  console.log('  getRandomValues:', crypto.getRandomValues(new Uint8Array(4)).length, 'random bytes');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('abc'));
  console.log('  SHA-256("abc"):', hex(digest));
  const { publicKey, privateKey } = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']);
  const data = new TextEncoder().encode('pay 10');
  const signature = await crypto.subtle.sign('Ed25519', privateKey, data);
  console.log('  Ed25519 signature bytes:', signature.byteLength);
  console.log('  verify original:', await crypto.subtle.verify('Ed25519', publicKey, signature, data));
  console.log('  verify changed data:', await crypto.subtle.verify('Ed25519', publicKey, signature, new TextEncoder().encode('pay 99')));

  console.log('4. Web Streams (ReadableStream, TransformStream, CompressionStream)');
  const source = new ReadableStream({
    start(controller) {
      for (const word of ['node', 'is', 'modern']) controller.enqueue(word);
      controller.close();
    },
  });
  const upper = new TransformStream({
    transform(chunk, controller) {
      controller.enqueue(chunk.toUpperCase());
    },
  });
  const words = [];
  for await (const chunk of source.pipeThrough(upper)) words.push(chunk); // a ReadableStream is async iterable
  console.log('  piped through a transform:', words);

  const text = 'abc'.repeat(1000);
  const gzipped = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const back = await new Response(new Blob([gzipped]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  console.log('  gzip:', text.length, 'chars ->', gzipped.byteLength < 100 ? 'under 100 bytes' : 'big', '| round trip equal:', back === text);

  // Node streams and Web streams convert both ways. objectMode keeps each item as one chunk.
  const web = Readable.toWeb(Readable.from(['x', 'y']));
  const items = [];
  for await (const item of Readable.fromWeb(web, { objectMode: true })) items.push(item);
  console.log('  Node stream -> Web stream is a ReadableStream:', web instanceof ReadableStream, '| and back to a Node stream:', items);

  console.log('5. BroadcastChannel (one-to-many messages; its real use is between worker threads)');
  const a = new BroadcastChannel('news');
  const b = new BroadcastChannel('news');
  const received = new Promise((resolve) => {
    b.onmessage = (event) => resolve(event.data);
  });
  a.onmessage = () => console.log('  this should not print: a sender does not hear itself');
  a.postMessage({ headline: 'hello channel' });
  console.log('  b received:', await received);
  a.close();
  b.close(); // open channels keep the process alive, so always close them

  console.log('6. process.getBuiltinModule (load a core module without require or import)');
  const fs = process.getBuiltinModule('node:fs');
  console.log('  same object as require:', fs === require('node:fs'));
  console.log('  unknown name gives undefined:', process.getBuiltinModule('left-pad'));

  console.log('7. AsyncLocalStorage (a value that follows a request through await)');
  const als = new AsyncLocalStorage();
  async function logLine(message) {
    await sleep(5);
    console.log(`  [request ${als.getStore().id}] ${message}`);
  }
  await Promise.all(
    [1, 2].map((id) =>
      als.run({ id }, async () => {
        await sleep(id === 1 ? 40 : 10); // request 1 is slower, so request 2 finishes first
        await logLine('still the same id after awaits');
      }),
    ),
  );
  console.log('  outside run(), getStore() is:', als.getStore());
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
