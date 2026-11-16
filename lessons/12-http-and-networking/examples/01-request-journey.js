// The journey of one web request: DNS, TCP, TLS, HTTP request, HTTP response, close
// Run: node lessons/12-http-and-networking/examples/01-request-journey.js
//
// Normally you let a library do all of this. Here we do every step by hand, on
// localhost, so you can see that "HTTP" is only text sent over a TCP socket.

const dns = require('node:dns/promises');
const http = require('node:http');
const net = require('node:net');
const { once } = require('node:events');

async function main() {
  // A normal HTTP server, so we have someone to talk to.
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/plain');
    res.end('hello from the server');
  });
  server.listen(0, '127.0.0.1'); // port 0 = "OS, pick any free port"
  await once(server, 'listening');
  const { port } = server.address();

  // Step 1: DNS. Turn a name into an IP address.
  const { address } = await dns.lookup('localhost', { family: 4 });
  console.log('1. DNS      "localhost" -> ' + address);

  // Step 2: TCP. Open a connection (SYN, SYN-ACK, ACK happen inside the OS).
  const socket = net.connect({ host: address, port });
  await once(socket, 'connect');
  console.log('2. TCP      connected, the three-way handshake is done');

  // Step 3: TLS. Only for https:// URLs. This is plain http, so nothing happens.
  console.log('3. TLS      skipped (plain http). See 11-https-and-http2.js');

  // Step 4: HTTP request. It is just lines of text that end with \r\n.
  const requestLines = ['GET /hello HTTP/1.1', 'Host: localhost:PORT', 'Connection: close', '', ''];
  socket.write(requestLines.join('\r\n').replace('PORT', port));
  console.log('4. REQUEST  we sent this text:');
  for (const line of requestLines.slice(0, 3)) console.log('              ' + line.replace('PORT', '<port>'));
  console.log('              (empty line = end of headers)');

  // Step 5: HTTP response. Also just text: status line, headers, empty line, body.
  socket.setEncoding('utf8');
  let raw = '';
  socket.on('data', (chunk) => (raw += chunk));
  let serverEnded = false;
  socket.on('end', () => (serverEnded = true)); // the server said "I am done sending" (TCP FIN)
  await once(socket, 'close');

  const [head, body] = raw.split('\r\n\r\n');
  console.log('5. RESPONSE we got this text:');
  for (const line of head.split('\r\n')) {
    if (line.startsWith('Date:')) continue; // changes on every run
    console.log('              ' + line);
  }
  console.log('              (empty line = end of headers)');
  console.log('              ' + body);

  // Step 6: close. We sent "Connection: close", so the server hangs up after the response.
  console.log('6. CLOSE    server ended the stream:', serverEnded + ', socket destroyed: ' + socket.destroyed);
  server.close();
}

main();
