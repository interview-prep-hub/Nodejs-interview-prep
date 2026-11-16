// HTTPS with a self-signed certificate (trusted or not), and HTTP/2 multiplexing
// Run: node lessons/12-http-and-networking/examples/11-https-and-http2.js
//
// The key and certificate come from _localhost-cert.js. They are a published TEST pair for localhost only.

const http2 = require('node:http2');
const https = require('node:https');
const crypto = require('node:crypto');
const tls = require('node:tls');
const { once } = require('node:events');
const { key, cert } = require('./_localhost-cert');

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

// Small promise wrapper around https.get. "options" can carry TLS settings such as ca.
function httpsGet(options) {
  return new Promise((resolve, reject) => {
    https
      .get(options, (res) => {
        const socket = res.socket; // the TLS socket (it is released when the response ends)
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (text += chunk));
        res.on('end', () => resolve({ text, socket, status: res.statusCode }));
      })
      .on('error', reject);
  });
}

async function httpsDemo() {
  console.log('1. TLS defaults on this Node version');
  console.log('   lowest version  :', tls.DEFAULT_MIN_VERSION);
  console.log('   highest version :', tls.DEFAULT_MAX_VERSION);

  console.log('2. An HTTPS server: the same handler as http, plus { key, cert }');
  const server = https.createServer({ key, cert }, (req, res) => {
    // req.socket.encrypted is true only on a TLS connection
    res.end(`hello over TLS, encrypted=${req.socket.encrypted}`);
  });
  const port = await listen(server);

  console.log('3. A client that does NOT trust our certificate');
  try {
    await fetch(`https://localhost:${port}/`);
  } catch (err) {
    console.log('   fetch rejected:', err.message, '| reason:', err.cause.code);
  }
  try {
    await httpsGet({ host: 'localhost', port, path: '/' });
  } catch (err) {
    console.log('   https.get rejected, code:', err.code);
  }

  console.log('4. A client that trusts exactly this certificate (the ca option)');
  const { text, socket, status } = await httpsGet({ host: 'localhost', port, path: '/', ca: cert });
  console.log('   response:', status, text);
  console.log('   protocol:', socket.getProtocol(), '| certificate accepted:', socket.authorized);
  const peer = socket.getPeerCertificate();
  console.log('   certificate subject CN:', peer.subject.CN, '| issuer CN:', peer.issuer.CN, '(same = self-signed)');
  console.log('   names it is valid for:', peer.subjectaltname);

  console.log('5. Right certificate, wrong name');
  try {
    await httpsGet({ host: '127.0.0.1', port, path: '/', ca: cert, servername: 'example.com' });
  } catch (err) {
    console.log('   rejected, code:', err.code);
  }

  const x509 = new crypto.X509Certificate(cert);
  console.log('6. Reading the certificate itself: it was issued by itself:', x509.checkIssued(x509));

  server.close();
  server.closeAllConnections();
  await once(server, 'close');
}

async function http2Demo() {
  console.log('7. HTTP/2: many requests, ONE connection');
  let sessions = 0;
  let streams = 0;
  const server = http2.createSecureServer({ key, cert }, (req, res) => {
    // the "compatibility API": req and res look like the http module ones
    res.setHeader('content-type', 'text/plain');
    res.end(`${req.method} ${req.url} over HTTP/${req.httpVersion}`);
  });
  server.on('session', () => sessions++);
  server.on('stream', () => streams++);
  const port = await listen(server);

  const client = http2.connect(`https://localhost:${port}`, { ca: cert });
  await once(client, 'connect');
  console.log('   protocol chosen by ALPN during the TLS handshake:', client.alpnProtocol);

  function get(path) {
    return new Promise((resolve) => {
      const stream = client.request({ ':method': 'GET', ':path': path }); // HTTP/2 uses "pseudo headers"
      let text = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => (text += chunk));
      stream.on('end', () => resolve(text));
      stream.end();
    });
  }
  const answers = await Promise.all([get('/a'), get('/b'), get('/c')]); // three requests at the same time
  console.log('   answers:', answers.join(' | '));
  console.log(`   the server saw ${streams} streams on ${sessions} connection`);

  client.close();
  server.close();
  await once(server, 'close');

  console.log('8. Cleartext HTTP/2 ("h2c") also works in Node, but browsers only use HTTP/2 over TLS');
  const plain = http2.createServer((req, res) => res.end('h2c works'));
  const plainPort = await listen(plain);
  const plainClient = http2.connect(`http://127.0.0.1:${plainPort}`);
  await once(plainClient, 'connect');
  console.log('   alpnProtocol:', plainClient.alpnProtocol, '| encrypted:', plainClient.encrypted);
  plainClient.close();
  plain.close();
  await once(plain, 'close');
}

async function main() {
  await httpsDemo();
  await http2Demo();
}

main();
