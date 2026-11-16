// Your first HTTP server in about 10 lines. It calls itself once, then shuts down.
// Run: node lessons/01-introduction/examples/12-first-server.js

const http = require('node:http');

const server = http.createServer((req, res) => {
  console.log('server saw a request:', req.method, req.url);
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello from Node!');
});

server.listen(0, '127.0.0.1', main); // 0 means: "OS, please pick any free port for me"

// ---- Everything below only exists so that this example runs and stops by itself ----
async function main() {
  const { port } = server.address();
  console.log('listening on 127.0.0.1, port is above 0:', port > 0);

  // Part 1: be the client. fetch is a global function, no import needed.
  const response = await fetch(`http://127.0.0.1:${port}/hello`);
  console.log('client got status :', response.status);
  console.log('client got header :', response.headers.get('content-type'));
  console.log('client got body   :', await response.text());

  // Part 2: the classic mistake. Start a second server on the SAME port.
  const second = http.createServer();
  second.once('error', (err) => {
    console.log('\nsecond server failed with:', err.code);
    server.close(() => console.log('first server closed, so the process can exit'));
  });
  second.listen(port, '127.0.0.1');
}
