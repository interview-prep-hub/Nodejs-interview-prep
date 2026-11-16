// DNS in Node: dns.lookup (the operating system) versus dns.resolve (real DNS queries)
// Run: node lessons/12-http-and-networking/examples/12-dns.js
//
// No internet needed. We start our own tiny DNS server on a UDP port of localhost, so we can SEE
// which of the two functions sends DNS queries over the network and which one does not.

const dgram = require('node:dgram');
const dns = require('node:dns');
const { once } = require('node:events');

// Build the bytes of a DNS answer: "the A record for the asked name is <ip>".
function buildAnswer(query, ip) {
  let offset = 12; // the question starts after the 12-byte header
  while (query[offset] !== 0) offset += query[offset] + 1; // skip the name (length-prefixed labels)
  const question = query.subarray(12, offset + 5); // name + zero byte + QTYPE (2) + QCLASS (2)

  const header = Buffer.alloc(12);
  query.copy(header, 0, 0, 2); // same transaction id as the query
  header.writeUInt16BE(0x8180, 2); // flags: this is a response, recursion available
  header.writeUInt16BE(1, 4); // 1 question
  header.writeUInt16BE(1, 6); // 1 answer

  const answer = Buffer.alloc(16);
  answer.writeUInt16BE(0xc00c, 0); // name: "pointer to offset 12" (the name in the question)
  answer.writeUInt16BE(1, 2); // type A (an IPv4 address)
  answer.writeUInt16BE(1, 4); // class IN (internet)
  answer.writeUInt32BE(60, 6); // time to live: 60 seconds
  answer.writeUInt16BE(4, 10); // 4 bytes of data follow
  ip.split('.').forEach((part, i) => answer.writeUInt8(Number(part), 12 + i));
  return Buffer.concat([header, question, answer]);
}

async function main() {
  const udp = dgram.createSocket('udp4');
  let queriesSeen = 0;
  udp.on('message', (message, remote) => {
    queriesSeen++;
    udp.send(buildAnswer(message, '203.0.113.7'), remote.port, remote.address); // 203.0.113.0/24 is reserved for examples
  });
  udp.bind(0, '127.0.0.1');
  await once(udp, 'listening');

  // A Resolver talks to the DNS servers WE choose. (dns.resolve* uses the system's DNS servers.)
  const resolver = new dns.promises.Resolver({ timeout: 2000, tries: 1 });
  resolver.setServers([`127.0.0.1:${udp.address().port}`]);

  console.log('1. dns.lookup("localhost"): asks the operating system (getaddrinfo, on the thread pool)');
  const local = await dns.promises.lookup('localhost', { family: 4 });
  console.log('   result:', local);
  console.log('   DNS queries our fake server received:', queriesSeen, '(lookup never touched it)');

  // The same name, asked the other way. resolve4 ignores the hosts file, so it does not answer 127.0.0.1.
  // (Our fake server answers every name with the same address. A real DNS server would not know "localhost".)
  console.log('2. resolver.resolve4("localhost"): the SAME name, but the hosts file is ignored');
  const viaDns = await resolver.resolve4('localhost');
  console.log('   result:', viaDns, '(lookup said 127.0.0.1 a moment ago)');
  console.log('   DNS queries our fake server received:', queriesSeen);

  console.log('3. resolver.resolve4("shop.test"): a name that only DNS knows (c-ares library, no thread pool)');
  const addresses = await resolver.resolve4('shop.test');
  console.log('   result:', addresses);
  console.log('   DNS queries our fake server received:', queriesSeen);
  // dns.lookup("shop.test") would ask your REAL system resolver. It is left out on purpose: how fast it fails
  // depends on your network. On most networks it fails with ENOTFOUND, because ".test" is reserved and never exists.

  console.log('4. resolve4 gives only A records, with extra data on request');
  const withTtl = await resolver.resolve4('shop.test', { ttl: true });
  console.log('   with ttl:', withTtl);

  console.log('5. lookup with { all: true } returns every address the OS knows for the name');
  const all = await dns.promises.lookup('localhost', { all: true });
  console.log('   all of them are loopback addresses:', all.every((a) => a.address === '127.0.0.1' || a.address === '::1'));

  console.log('6. The default order of results from lookup:', dns.getDefaultResultOrder());

  udp.close();
}

main();
