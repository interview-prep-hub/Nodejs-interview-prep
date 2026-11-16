// SSRF guard: check a user-supplied URL (scheme, credentials, private IPs), follow redirects safely
// Run: node lessons/20-security-and-crypto/examples/06-ssrf-guard.js
//
// SSRF = Server-Side Request Forgery: your server fetches a URL chosen by a user, and the user
// picks an address that only your server can reach (localhost, the cloud metadata service, an internal admin tool).
// This example needs no internet. DNS answers for the example names are faked on purpose.

const net = require('node:net');
const dns = require('node:dns');
const http = require('node:http');
const { once } = require('node:events');

// ---------- 1. A block-list of addresses that are never public ----------
const blocked = new net.BlockList();
const BLOCKED_V4 = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback (localhost)
  ['169.254.0.0', 16], // link-local, includes the cloud metadata address 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // special use
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
];
for (const [address, prefix] of BLOCKED_V4) blocked.addSubnet(address, prefix, 'ipv4');
blocked.addAddress('::', 'ipv6'); // unspecified
blocked.addAddress('::1', 'ipv6'); // loopback
blocked.addSubnet('fc00::', 7, 'ipv6'); // unique local (the IPv6 "private" range)
blocked.addSubnet('fe80::', 10, 'ipv6'); // link-local
blocked.addSubnet('ff00::', 8, 'ipv6'); // multicast
// BlockList treats an IPv4-mapped IPv6 address like ::ffff:127.0.0.1 as the IPv4 address inside it.

function isBlockedIp(ip) {
  return blocked.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
}

// ---------- 2. Validate a URL before the server touches it ----------
const FAKE_DNS = {
  'cdn.example': ['93.184.216.34'], // pretends to be a normal public site
  'attacker.example': ['10.0.0.5'], // an attacker-owned name that points at an internal address
};

async function resolveHost(host) {
  if (FAKE_DNS[host]) return FAKE_DNS[host];
  const found = await dns.promises.lookup(host, { all: true });
  return found.map((entry) => entry.address);
}

async function checkUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, why: 'not a valid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, why: `scheme ${url.protocol} is not allowed` };
  if (url.username || url.password) return { ok: false, why: 'credentials in the URL are not allowed' };
  const host = url.hostname.replace(/^\[|\]$/g, ''); // IPv6 hosts come wrapped in [ ]
  let addresses;
  try {
    addresses = net.isIP(host) ? [host] : await resolveHost(host);
  } catch {
    return { ok: false, why: 'host does not resolve' };
  }
  const bad = addresses.find(isBlockedIp);
  if (bad) return { ok: false, why: `${host} points at private address ${bad}` };
  return { ok: true };
}

async function demoTable() {
  console.log('--- 1. URL checks (the URL parser already turns tricky spellings into plain IPs) ---');
  const urls = [
    'http://8.8.8.8/',
    'https://cdn.example/logo.png',
    'http://attacker.example/',
    'http://169.254.169.254/latest/meta-data/',
    'http://127.0.0.1:8080/admin',
    'http://localhost/',
    'http://[::1]/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://[::ffff:127.0.0.1]/',
    'file:///etc/passwd',
    'ftp://cdn.example/file',
    'https://user:pass@8.8.8.8/',
    'not a url',
  ];
  for (const u of urls) {
    const verdict = await checkUrl(u);
    console.log(u.padEnd(44), verdict.ok ? 'allowed' : `BLOCKED: ${verdict.why}`);
  }
}

// ---------- 3. Check at connection time too (stops DNS rebinding) ----------
// A name can answer with a public IP when you check it and a private IP a second later.
// So also validate the address that the socket is ABOUT TO USE, inside a custom lookup function.
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return callback(err);
    const list = Array.isArray(address) ? address : [{ address, family }];
    const bad = list.find((entry) => isBlockedIp(entry.address));
    if (bad) return callback(new Error(`blocked: ${hostname} resolved to ${bad.address}`));
    return callback(null, address, family);
  });
}

function demoGuardedLookup(port) {
  console.log('\n--- 2. guarded lookup at connect time ---');
  return new Promise((resolve) => {
    // "localhost" is a NAME, so Node calls our lookup function, which refuses 127.0.0.1 and ::1.
    const req = http.get({ host: 'localhost', port, path: '/', lookup: guardedLookup }, (res) => {
      res.resume();
      console.log('request went through (not expected)');
      resolve();
    });
    req.on('error', (err) => {
      console.log('request failed:', err.message);
      resolve();
    });
  });
}

// ---------- 4. Redirects: validate EVERY hop ----------
async function safeFetch(startUrl, validate, maxRedirects = 3) {
  let url = startUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const verdict = await validate(url);
    if (!verdict.ok) throw new Error(`blocked at hop ${hop}: ${verdict.why}`);
    const res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2000) }); // do NOT auto-follow
    if (res.status >= 300 && res.status < 400 && res.headers.has('location')) {
      await res.arrayBuffer();
      url = new URL(res.headers.get('location'), url).href; // Location may be relative
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}

async function demoRedirects(server) {
  console.log('\n--- 3. redirects ---');
  const base = `http://127.0.0.1:${server.address().port}`;
  // For this demo the only allowed place is /public/ on our own test server.
  const validate = async (u) => (new URL(u).origin === base && new URL(u).pathname.startsWith('/public/') ? { ok: true } : { ok: false, why: `${new URL(u).pathname} is outside /public/` });

  const plain = await fetch(`${base}/public/go`); // fetch follows the redirect without asking us
  console.log('plain fetch follows redirect :', JSON.stringify(await plain.text()));

  const fine = await safeFetch(`${base}/public/ok`, validate);
  console.log('safeFetch, no redirect       :', JSON.stringify(await fine.text()));

  try {
    await safeFetch(`${base}/public/go`, validate);
  } catch (e) {
    console.log('safeFetch, evil redirect     :', e.message);
  }
}

async function main() {
  await demoTable();

  const server = http.createServer((req, res) => {
    if (req.url === '/public/ok') return res.end('public data');
    if (req.url === '/public/go') {
      res.writeHead(302, { Location: '/internal/secret' }); // looks harmless, points at the internal area
      return res.end();
    }
    if (req.url === '/internal/secret') return res.end('TOP SECRET internal data');
    res.writeHead(404).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await demoGuardedLookup(server.address().port);
    await demoRedirects(server);
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

main();
