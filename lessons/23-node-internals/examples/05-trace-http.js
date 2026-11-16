// One HTTP request traced through the layers: socket handles, the llhttp parser, your handler
// Shows: the resources Node creates for a single request/response on localhost, and what sits under a net.Socket.
// Run: node lessons/23-node-internals/examples/05-trace-http.js

const asyncHooks = require('node:async_hooks');
const http = require('node:http');

// What each resource type means. The names come from async_hooks (they are the C++ class names in upper case).
const MEANING = {
  TCPWRAP: ['libuv', 'a TCP socket handle (a libuv uv_tcp_t sits inside)'],
  TCPCONNECTWRAP: ['libuv', 'a connect request (libuv uv_connect_t)'],
  HTTPCLIENTREQUEST: ['llhttp', 'the HTTP parser of the client side (it will parse the response)'],
  HTTPINCOMINGMESSAGE: ['llhttp', 'the HTTP parser of the server side (it parses the request)'],
  Timeout: ['timer', 'a JS timer that the http code created during the exchange'],
  SHUTDOWNWRAP: ['libuv', 'a shutdown request (libuv uv_shutdown_t): "I will send no more data"'],
};
const USES_THREAD_POOL = ['FSREQCALLBACK', 'FSREQPROMISE', 'GETADDRINFOREQWRAP', 'GETNAMEINFOREQWRAP'];

const timeline = []; // { layer, text }
let recording = false;
const typesSeen = new Set();
const hook = asyncHooks.createHook({
  init(id, type) {
    // TickObject is process.nextTick bookkeeping. PIPEWRAP and TTYWRAP are your stdout/stderr, which Node
    // creates lazily and which depend on how you run the file. None of them is part of the request.
    if (!recording || ['TickObject', 'PIPEWRAP', 'TTYWRAP'].includes(type)) return;
    typesSeen.add(type);
    const [layer, meaning] = MEANING[type] || ['?', ''];
    timeline.push({ layer, text: `${type.padEnd(20)} ${meaning}` });
  },
}).enable();

let parsedInfo = '';
let consumed;
let socketInfo = '';

const server = http.createServer((req, res) => {
  const socket = req.socket;
  socketInfo = `req.socket is a ${socket.constructor.name}; its _handle is a ${socket._handle.constructor.name} (a C++ object from the tcp_wrap binding)`;
  consumed = socket._handle._consumed; // internal flag: did the C++ parser take over reading from the socket?
  const headerNames = req.rawHeaders.filter((_, i) => i % 2 === 0).join(', ');
  parsedInfo = `method ${req.method}, url ${req.url}, httpVersion ${req.httpVersion}, header names: ${headerNames}`;
  timeline.push({ layer: 'JS', text: `your handler runs: ${req.method} ${req.url}` });
  res.end('hello');
});

server.listen(0, '127.0.0.1', () => {
  recording = true;
  timeline.push({ layer: 'JS', text: 'http.get() is called (the server is already listening)' });
  http.get({ host: '127.0.0.1', port: server.address().port, path: '/hello', agent: false }, (res) => {
    timeline.push({ layer: 'JS', text: `client callback runs: status ${res.statusCode}` });
    res.resume();
    res.on('end', () => {
      server.close();
      // Give the socket shutdown a moment to be recorded, then print everything.
      setTimeout(() => {
        recording = false;
        hook.disable();
        report();
      }, 20);
    });
  });
});

function report() {
  console.log('Part 1: resources created for one request, in order (layer, type, meaning)');
  timeline.forEach((e, i) => console.log(`  ${String(i + 1).padStart(2)}. [${e.layer.padEnd(6)}] ${e.text}`));

  console.log('\nPart 2: what sits under the socket');
  console.log(`  ${socketInfo}`);

  console.log('\nPart 3: what llhttp handed to JavaScript (the request head was parsed in C)');
  console.log(`  ${parsedInfo}`);
  console.log(`  the parser read straight from the socket handle, with no JS 'data' event: ${consumed === true}`);

  const poolUsers = [...typesSeen].filter((t) => USES_THREAD_POOL.includes(t.toUpperCase()));
  console.log('\nPart 4: did the thread pool help?');
  console.log(`  thread pool request types seen: ${poolUsers.length === 0 ? 'none' : poolUsers.join(', ')}`);
  console.log('  (sockets are waited on by the operating system: epoll, kqueue or IOCP, not by pool threads)');
}
