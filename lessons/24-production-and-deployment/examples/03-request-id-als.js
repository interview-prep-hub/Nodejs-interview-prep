// Correlation ids with AsyncLocalStorage: every log line of one request carries the same id, across awaits and across services
// Run: node lessons/24-production-and-deployment/examples/03-request-id-als.js
//
// Two small services run in this one process: "gateway" calls "inventory" over HTTP.
// Each service has its OWN AsyncLocalStorage, like two real processes would.
'use strict';
const http = require('node:http');
const { AsyncLocalStorage } = require('node:async_hooks');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { createLogger } = require('./_logger');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const lines = []; // log lines of both services, parsed
const write = (line) => lines.push(JSON.parse(line));

// ---------- the reusable part: one middleware, one logger option ----------
function makeService(name) {
  const context = new AsyncLocalStorage(); // holds { requestId } for the request that is running right now
  const log = createLogger({ level: 'debug', base: { service: name }, write, context }); // the logger reads the store by itself

  // Wraps a handler: pick the id (or make one), put it in the store, send it back in the response.
  function withRequestId(handler) {
    return (req, res) => {
      const incoming = req.headers['x-request-id'];
      // Never trust a header blindly: accept only short, simple ids. Otherwise make a new one.
      const requestId = typeof incoming === 'string' && /^[\w.-]{1,64}$/.test(incoming) ? incoming : randomUUID();
      res.setHeader('x-request-id', requestId);
      context.run({ requestId }, () => {
        log.info({ method: req.method, url: req.url }, 'request received');
        handler(req, res).catch((err) => {
          log.error(err, 'unhandled error in handler');
          res.statusCode = 500;
          res.end('error');
        });
      });
    };
  }

  // Use this for every outgoing call so the id travels to the next service.
  function callService(url) {
    const { requestId } = context.getStore();
    return fetch(url, { headers: { 'x-request-id': requestId } });
  }

  return { context, log, withRequestId, callService };
}

async function main() {
  // ---------- service 2: inventory ----------
  const inventory = makeService('inventory');
  const inventoryServer = http.createServer(
    inventory.withRequestId(async (req, res) => {
      await sleep(10);
      inventory.log.info({ sku: 'sku-1', available: 5 }, 'stock checked'); // no requestId passed, still on the line
      res.end(JSON.stringify({ available: 5 }));
    }),
  );
  inventoryServer.listen(0, '127.0.0.1');
  await once(inventoryServer, 'listening');
  const inventoryUrl = `http://127.0.0.1:${inventoryServer.address().port}`;

  // ---------- service 1: gateway ----------
  const gateway = makeService('gateway');

  // "Deep" code. It has no request or response object and no id parameter. It just logs.
  async function reserveStock(sku) {
    gateway.log.debug({ sku }, 'asking inventory');
    const reply = await gateway.callService(`${inventoryUrl}/stock/${sku}`);
    const body = await reply.json();
    await sleep(5); // the store survives await and timers
    gateway.log.debug({ available: body.available }, 'inventory answered');
    return body;
  }

  const gatewayServer = http.createServer(
    gateway.withRequestId(async (req, res) => {
      const stock = await reserveStock('sku-1');
      gateway.log.info('sending response');
      res.end(JSON.stringify(stock));
    }),
  );
  gatewayServer.listen(0, '127.0.0.1');
  await once(gatewayServer, 'listening');
  const gatewayUrl = `http://127.0.0.1:${gatewayServer.address().port}`;

  gateway.log.info('gateway started'); // outside any request: no requestId

  // ---------- three concurrent requests ----------
  console.log('1. Three requests at the same time, the log lines of both services interleave');
  const requests = [
    { label: 'A (client sent x-request-id: client-abc)', headers: { 'x-request-id': 'client-abc' } },
    { label: 'B (no header, the gateway makes an id)', headers: {} },
    { label: 'C (bad header value, replaced)', headers: { 'x-request-id': 'bad id with spaces' } },
  ];
  const replies = await Promise.all(requests.map((r) => fetch(gatewayUrl + '/order', { headers: r.headers })));
  await Promise.all(replies.map((reply) => reply.text()));
  const ids = replies.map((reply) => reply.headers.get('x-request-id'));
  console.log('   total log lines:', lines.length);
  console.log('   A keeps its own id          :', ids[0] === 'client-abc');
  console.log('   B got a generated UUID      :', /^[0-9a-f-]{36}$/.test(ids[1]));
  console.log('   C got a new id, not the bad one:', ids[2] !== 'bad id with spaces' && /^[0-9a-f-]{36}$/.test(ids[2]));

  console.log('2. Filter by one id and you get the whole story, across both services');
  requests.forEach((r, i) => {
    console.log(`   request ${r.label}`);
    for (const line of lines.filter((l) => l.requestId === ids[i])) {
      const { service, level, msg, requestId, time, ...rest } = line;
      const extra = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : '';
      console.log(`     ${service.padEnd(9)} ${level.padEnd(5)} ${msg}${extra}`);
    }
  });
  const withoutId = lines.filter((l) => l.requestId === undefined);
  console.log('   lines with no id (written outside a request):', withoutId.map((l) => l.msg));

  // ---------- when context is lost, and the fix ----------
  console.log('3. A hand-made queue: callbacks that run later lose the context unless you bind them');
  const { context } = gateway;
  const queue = [];
  context.run({ requestId: 'job-42' }, () => {
    queue.push(() => context.getStore()?.requestId); // plain function
    queue.push(AsyncLocalStorage.bind(() => context.getStore()?.requestId)); // remembers the context it was created in
  });
  // A "worker" starts later, outside any request, and calls what is in the queue.
  const [plain, bound] = queue;
  console.log('   plain callback sees :', plain());
  console.log('   bound callback sees :', bound());

  gatewayServer.close();
  inventoryServer.close();
  await Promise.all([once(gatewayServer, 'close'), once(inventoryServer, 'close')]);
}

main();
