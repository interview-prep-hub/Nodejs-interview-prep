// http.request (the low-level client), timeouts on it, and http.Agent (keep-alive and pooling)
// Run: node lessons/12-http-and-networking/examples/08-request-and-agent.js
//
// fetch is built on the same ideas. http.request gives you the raw pieces: request and response are streams.

const http = require('node:http');
const util = require('node:util');
const { once } = require('node:events');

let connections = 0; // TCP connections the server has accepted
let inFlight = 0; // requests being worked on right now
let maxInFlight = 0;

const server = http.createServer(async (req, res) => {
  inFlight++;
  maxInFlight = Math.max(maxInFlight, inFlight);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');

  if (req.url === '/slow') {
    await new Promise((resolve) => setTimeout(resolve, 300));
  } else {
    await new Promise((resolve) => setTimeout(resolve, 30)); // pretend to work
  }
  inFlight--;
  if (res.destroyed) return;
  res.setHeader('Content-Type', 'text/plain');
  res.end(`${req.method} ${req.url} body=${JSON.stringify(body)}`);
});
server.on('connection', () => connections++);

// http.request with callbacks, wrapped in a promise.
function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      // res is a Readable stream of the response body
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject); // network errors arrive here, not in the callback
    if (body !== undefined) req.write(body); // req is a Writable stream of the request body
    req.end(); // you MUST call end(), or the request is never sent completely
  });
}

async function main() {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  const target = { host: '127.0.0.1', port };

  console.log('1. GET and POST with http.request');
  console.log('  ', await request({ ...target, path: '/hello', method: 'GET' }));
  console.log(
    '  ',
    await request({ ...target, path: '/save', method: 'POST', headers: { 'Content-Type': 'text/plain' } }, 'some data'),
  );

  console.log('2. Timeouts: the "timeout" event only TELLS you, you must destroy the request');
  await new Promise((resolve) => {
    const req = http.request({ ...target, path: '/slow', timeout: 100 }, () => {});
    req.on('timeout', () => {
      console.log('   timeout event fired (the request is still alive: destroyed =', req.destroyed + ')');
      req.destroy(new Error('gave up after 100 ms'));
    });
    req.on('error', (err) => {
      console.log('   error event:', err.message);
      resolve();
    });
    req.end();
  });

  console.log('3. AbortSignal also works');
  try {
    await request({ ...target, path: '/slow', signal: AbortSignal.timeout(100) });
  } catch (err) {
    console.log('  ', err.name, '|', err.message);
  }

  console.log('4. Agent defaults on this Node version');
  const pick = (a) => util.inspect({
    keepAlive: a.keepAlive,
    maxSockets: a.maxSockets,
    maxFreeSockets: a.maxFreeSockets,
    keepAliveMsecs: a.keepAliveMsecs,
    scheduling: a.scheduling,
  }, { breakLength: Infinity });
  console.log('   http.globalAgent :', pick(http.globalAgent));
  console.log('   new http.Agent() :', pick(new http.Agent()));

  console.log('5. Keep-alive: how many TCP connections do 5 requests in a row use?');
  async function countConnections(label, agent) {
    connections = 0;
    for (let i = 0; i < 5; i++) await request({ ...target, path: `/n${i}`, agent });
    console.log(`   ${label.padEnd(30)} -> ${connections} connection(s)`);
    agent.destroy(); // close the idle sockets the agent keeps for reuse
  }
  await countConnections('Agent({ keepAlive: true })', new http.Agent({ keepAlive: true }));
  await countConnections('Agent({ keepAlive: false })', new http.Agent({ keepAlive: false }));
  // The global agent is used when you pass no agent at all. Since Node 19 it keeps connections alive.
  connections = 0;
  for (let i = 0; i < 5; i++) await request({ ...target, path: `/g${i}` });
  console.log(`   ${'no agent option (global agent)'.padEnd(30)} -> ${connections} connection(s)`);

  console.log('6. maxSockets: a limit on parallel connections to one host');
  async function parallel(label, agent) {
    maxInFlight = 0;
    await Promise.all([1, 2, 3, 4].map((i) => request({ ...target, path: `/p${i}`, agent })));
    console.log(`   ${label.padEnd(26)} -> server saw at most ${maxInFlight} request(s) at the same time`);
    agent.destroy();
  }
  await parallel('maxSockets: Infinity', new http.Agent({ keepAlive: true }));
  await parallel('maxSockets: 2', new http.Agent({ keepAlive: true, maxSockets: 2 }));
  await parallel('maxSockets: 1', new http.Agent({ keepAlive: true, maxSockets: 1 }));

  http.globalAgent.destroy();
  server.close();
  server.closeAllConnections();
}

main();
