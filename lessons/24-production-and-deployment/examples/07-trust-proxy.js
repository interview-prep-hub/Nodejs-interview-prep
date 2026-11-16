// Reverse proxy and "trust proxy": how the app learns the real client address, and how X-Forwarded-For can be forged
// Run: node lessons/24-production-and-deployment/examples/07-trust-proxy.js
//
// A tiny proxy (it does what nginx does with proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for)
// sits in front of an app. Real deployments use nginx, a cloud load balancer, or both.
'use strict';
const http = require('node:http');
const { once } = require('node:events');

// ---------- the app ----------
// The addresses the app can see, closest first: the machine that opened the TCP connection, then the
// X-Forwarded-For list read from RIGHT to LEFT (every proxy appends the address it received the request from).
function addressChain(req) {
  const header = req.headers['x-forwarded-for'] ?? '';
  const listed = header.split(',').map((text) => text.trim()).filter(Boolean);
  return [req.socket.remoteAddress, ...listed.reverse()];
}

// trustedHops = how many proxies of YOURS sit between the internet and this app.
// Skip that many addresses from the near end. The next one is the client. (This is what Express "trust proxy: 1" does.)
function clientIp(req, trustedHops) {
  const chain = addressChain(req);
  return chain[Math.min(trustedHops, chain.length - 1)];
}

// The naive and dangerous version: believe the first address in the header.
function naiveClientIp(req) {
  const first = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  return first || req.socket.remoteAddress;
}

// Only believe X-Forwarded-Proto when a trusted proxy set it.
function protocol(req, trustedHops) {
  if (trustedHops > 0 && req.headers['x-forwarded-proto']) return req.headers['x-forwarded-proto'].split(',')[0].trim();
  return req.socket.encrypted ? 'https' : 'http';
}

const app = http.createServer((req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(
    JSON.stringify({
      forwardedFor: req.headers['x-forwarded-for'] ?? null,
      noTrust: clientIp(req, 0),
      trustOneProxy: clientIp(req, 1),
      naive: naiveClientIp(req),
      protocolNoTrust: protocol(req, 0),
      protocolTrusted: protocol(req, 1),
    }),
  );
});

// ---------- the proxy ----------
// All demo clients really connect from 127.0.0.1. To make the difference visible, the proxy PRETENDS that the browser
// had the documentation address 203.0.113.9. A real proxy simply uses req.socket.remoteAddress.
const PRETEND_BROWSER_ADDRESS = '203.0.113.9';

function makeProxy(appPort) {
  return http.createServer((req, res) => {
    // Append the address that connected to US. Never pass the client's header on unchanged.
    const forwardedFor = [req.headers['x-forwarded-for'], PRETEND_BROWSER_ADDRESS].filter(Boolean).join(', ');
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: appPort,
        path: req.url,
        method: req.method,
        // Pretend this proxy terminated TLS: the browser spoke https to the proxy, the proxy speaks plain http to the app.
        headers: { ...req.headers, 'x-forwarded-for': forwardedFor, 'x-forwarded-proto': 'https' },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.statusCode = 502;
      res.end('bad gateway');
    });
    req.pipe(upstream);
  });
}

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function main() {
  const appPort = await listen(app);
  const proxy = makeProxy(appPort);
  const proxyPort = await listen(proxy);

  async function ask(title, port, headers = {}) {
    const reply = await fetch(`http://127.0.0.1:${port}/`, { headers });
    const seen = await reply.json();
    console.log(title);
    console.log(`   X-Forwarded-For the app received : ${seen.forwardedFor}`);
    console.log(`   trust 0 proxies (default)        : ${seen.noTrust}`);
    console.log(`   trust 1 proxy                    : ${seen.trustOneProxy}`);
    console.log(`   naive "first entry" rule         : ${seen.naive}`);
    console.log(`   protocol, no trust / with trust  : ${seen.protocolNoTrust} / ${seen.protocolTrusted}`);
  }

  // The app only ever sees TCP connections from 127.0.0.1: from the proxy, or (cases 1 and 4) from the demo itself.
  await ask('1. Straight to the app, no proxy', appPort);
  await ask('2. Through the proxy, honest client', proxyPort);
  await ask('3. Through the proxy, client sends a forged "X-Forwarded-For: 6.6.6.6"', proxyPort, { 'x-forwarded-for': '6.6.6.6' });
  await ask('4. Straight to the app (port exposed by mistake), forged header, trust 1 is fooled', appPort, { 'x-forwarded-for': '6.6.6.6' });

  proxy.close();
  app.close();
  await Promise.all([once(proxy, 'close'), once(app, 'close')]);
}

main();
