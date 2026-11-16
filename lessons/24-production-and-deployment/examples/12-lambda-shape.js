// Serverless Node: the handler shape, cold start vs warm start, and why every container opens its own connections
// Run: node lessons/24-production-and-deployment/examples/12-lambda-shape.js
//
// There is no cloud here. This file pretends to be the Lambda runtime: it loads a handler module (_lambda-handler.js),
// calls handler(event, context) for each request, and enforces a timeout.
'use strict';
const { randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');

const handlerPath = require.resolve('./_lambda-handler.js');

// "Start a container" = load the module again from scratch. Its top-level code (the INIT phase) runs now.
function startContainer() {
  delete require.cache[handlerPath]; // forget the previous copy, so the module's variables start fresh
  const started = performance.now();
  const mod = require(handlerPath);
  return { handler: mod.handler, stats: mod.stats, initMs: performance.now() - started };
}

// What the runtime does for one request.
async function invoke(container, event, { timeoutMs = 3000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  const context = {
    awsRequestId: randomUUID(),
    functionName: 'orders-function',
    getRemainingTimeInMillis: () => Math.max(0, deadline - Date.now()),
  };
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Task timed out after ${(timeoutMs / 1000).toFixed(2)} seconds`)), timeoutMs);
  });
  try {
    return await Promise.race([container.handler(event, context), timeout]);
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ errorMessage: err.message }) }; // the platform reports handler errors as 500
  } finally {
    clearTimeout(timer);
  }
}

const get = (rawPath) => ({ version: '2.0', rawPath, requestContext: { http: { method: 'GET', path: rawPath } }, headers: {}, isBase64Encoded: false });
const post = (rawPath, text, base64 = false) => ({
  version: '2.0',
  rawPath,
  requestContext: { http: { method: 'POST', path: rawPath } },
  headers: { 'content-type': 'application/json' },
  body: base64 ? Buffer.from(text).toString('base64') : text,
  isBase64Encoded: base64,
});

async function main() {
  console.log('1. Cold start: the first request pays for the INIT phase, the next ones do not');
  const first = startContainer();
  console.log('   container A started, connections created so far:', first.stats().connectionsCreated);
  for (let i = 1; i <= 3; i++) {
    const reply = await invoke(first, get('/orders'));
    console.log(`   request ${i} ->`, reply.statusCode, reply.body);
  }
  console.log('   container A stats:', first.stats());

  console.log('2. Scaling out: a second container starts from zero and opens its OWN connection');
  const second = startContainer();
  const reply = await invoke(second, get('/orders'));
  console.log('   container B first request ->', reply.body);
  console.log('   container B stats:', second.stats());
  console.log('   50 containers at once = 50 database connections. Use a connection proxy or a small pool per container.');

  console.log('3. Event and response shapes');
  const created = await invoke(first, post('/orders', JSON.stringify({ item: 'book' })));
  console.log('   JSON body        ->', created.statusCode, created.body);
  const encoded = await invoke(first, post('/orders', JSON.stringify({ item: 'pen' }), true));
  console.log('   base64 body      ->', encoded.statusCode, encoded.body);
  const broken = await invoke(first, post('/orders', '{not json'));
  console.log('   broken JSON body ->', broken.statusCode, JSON.parse(broken.body).errorMessage);

  console.log('4. The timeout is a hard stop');
  const slow = await invoke(first, get('/slow'), { timeoutMs: 100 });
  console.log('   /slow with a 100 ms limit ->', slow.statusCode, JSON.parse(slow.body).errorMessage);
}

main();
