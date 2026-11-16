// EventEmitter inside Node core: streams, http server, process, child_process (and who uses EventTarget)
// Run: node lessons/09-events/examples/12-core-modules.js

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const stream = require('node:stream');
const childProcess = require('node:child_process');
const { Worker, MessageChannel } = require('node:worker_threads');
const EventEmitter = require('node:events');
const { once } = EventEmitter;

// Printed last, when the process is about to end.
process.on('exit', (code) => console.log('6. process "exit" event, code:', code));

async function main() {
  console.log('1. which core classes are EventEmitters?');
  const checks = {
    process: process instanceof EventEmitter,
    'stream.Readable': stream.Readable.prototype instanceof EventEmitter,
    'net.Socket': net.Socket.prototype instanceof EventEmitter,
    'http.Server': http.Server.prototype instanceof EventEmitter,
    'child process': childProcess.ChildProcess.prototype instanceof EventEmitter,
    'worker_threads Worker': Worker.prototype instanceof EventEmitter,
  };
  for (const [name, yes] of Object.entries(checks)) console.log(`  ${name}: ${yes}`);

  console.log('2. streams: events in a fixed order');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'events-lesson-'));
  const file = path.join(dir, 'hello.txt');
  fs.writeFileSync(file, 'hello world');
  const reader = fs.createReadStream(file);
  const seen = [];
  for (const name of ['open', 'ready', 'data', 'end', 'close']) reader.on(name, () => seen.push(name));
  await once(reader, 'close');
  console.log('  read stream:', seen.join(' > '));
  const writer = fs.createWriteStream(file);
  const wrote = [];
  for (const name of ['open', 'ready', 'finish', 'close']) writer.on(name, () => wrote.push(name));
  writer.end('bye');
  await once(writer, 'close');
  console.log('  write stream:', wrote.join(' > '));
  fs.rmSync(dir, { recursive: true, force: true });

  console.log('3. http server: createServer(handler) just adds a "request" listener');
  const server = http.createServer((req, res) => res.end('ok'));
  console.log('  request listeners:', server.listenerCount('request'));
  const order = [];
  server.on('listening', () => order.push('listening'));
  server.on('connection', () => order.push('connection'));
  server.on('request', () => order.push('request'));
  server.on('close', () => order.push('close'));
  server.listen(0);
  await once(server, 'listening');
  await new Promise((resolve, reject) => {
    const req = http.get({ port: server.address().port, agent: false }, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', reject); // always listen for "error" on request objects
  });
  server.close();
  await once(server, 'close');
  console.log('  server events:', order.join(' > '));

  console.log('4. child process: spawn, exit, close');
  const child = childProcess.spawn(process.execPath, ['-e', 'console.log("hello from the child")']);
  const lifecycle = [];
  let output = '';
  child.on('spawn', () => lifecycle.push('spawn'));
  child.stdout.on('data', (chunk) => (output += chunk)); // stdout is a stream, so it is an emitter too
  child.on('exit', (code) => lifecycle.push(`exit(${code})`));
  child.on('close', () => lifecycle.push('close'));
  await once(child, 'close');
  console.log('  lifecycle:', lifecycle.join(' > '));
  console.log('  child printed:', output.trim());

  console.log('5. web-style EventTarget in core: AbortSignal and MessagePort');
  const { port1, port2 } = new MessageChannel();
  console.log('  AbortSignal is an EventTarget:', new AbortController().signal instanceof EventTarget);
  console.log('  MessagePort is an EventTarget:', port1 instanceof EventTarget);
  port1.close();
  port2.close();
}

main();
