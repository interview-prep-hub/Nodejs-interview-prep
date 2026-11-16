// Serverless and edge at a glance: a Lambda-shaped handler, a Workers-shaped fetch handler, and a Request/Response router
// Run: node lessons/26-frameworks-and-middleware/examples/12-serverless-and-edge.js
//
// Nothing here talks to a cloud. We call the handlers directly, the way the platform would,
// to show the SHAPE of each one. The event fields are a small subset of the real ones.

const { Readable } = require('node:stream');
const { compile } = require('./_mini-express/02-routing');
const { start } = require('./_mini-express/testing');

// =====================================================================================
// Part 1: an AWS Lambda handler (Node.js runtime) behind an HTTP API (payload format 2.0).
// There is no server and no req/res: the platform calls handler(event, context) and uses what you return.
// =====================================================================================
let environmentsCreated = 0;

// Everything outside the handler runs ONCE per execution environment: that is the cold start.
// While the environment stays warm, later invocations reuse that state (a database client, a cache ...).
function loadLambdaModule() {
  const environment = ++environmentsCreated; // "init" code
  const cache = new Map(); //                    survives between invocations of THIS environment
  let invocations = 0;

  async function handler(event, context) {
    invocations++;
    const { method } = event.requestContext.http;
    const route = `${method} ${event.rawPath}`;
    const respond = (statusCode, data, extra = {}) => ({
      statusCode,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(data), // the body MUST be a string
      ...extra,
    });

    if (route === 'GET /hello') {
      const name = event.queryStringParameters?.name ?? 'world';
      const cached = cache.has(name);
      cache.set(name, true);
      return respond(200, { message: `hello ${name}`, environment, invocation: invocations, cacheHit: cached });
    }
    if (route === 'POST /echo') {
      // API Gateway may base64-encode the body, so check the flag
      const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
      try {
        return respond(200, { youSent: JSON.parse(raw) });
      } catch {
        return respond(400, { error: 'body is not JSON' }); // you map errors to status codes yourself
      }
    }
    return respond(404, { error: `no route for ${route}`, requestId: context.awsRequestId });
  }

  return { handler };
}

const makeEvent = ({ method = 'GET', path, query = {}, body, base64 = false }) => ({
  version: '2.0',
  rawPath: path,
  rawQueryString: new URLSearchParams(query).toString(),
  headers: { 'content-type': 'application/json' },
  queryStringParameters: Object.keys(query).length > 0 ? query : undefined,
  requestContext: { http: { method, path } },
  body: base64 && body ? Buffer.from(body).toString('base64') : body,
  isBase64Encoded: base64,
});
const fakeContext = { awsRequestId: 'req-0001', getRemainingTimeInMillis: () => 3000 };

async function partLambda() {
  console.log('=== Part 1: a Lambda handler');
  const show = (label, result) => console.log(`${label.padEnd(34)} ${result.statusCode} ${result.body}`);

  const first = loadLambdaModule(); //  cold start: the init code runs
  show('env 1, call 1 (cold)', await first.handler(makeEvent({ path: '/hello', query: { name: 'Ada' } }), fakeContext));
  show('env 1, call 2 (warm, same name)', await first.handler(makeEvent({ path: '/hello', query: { name: 'Ada' } }), fakeContext));
  show('POST /echo, plain body', await first.handler(makeEvent({ method: 'POST', path: '/echo', body: '{"n":1}' }), fakeContext));
  show('POST /echo, base64 body', await first.handler(makeEvent({ method: 'POST', path: '/echo', body: '{"n":2}', base64: true }), fakeContext));
  show('POST /echo, not JSON', await first.handler(makeEvent({ method: 'POST', path: '/echo', body: 'oops' }), fakeContext));
  show('unknown route', await first.handler(makeEvent({ path: '/nothing' }), fakeContext));

  const second = loadLambdaModule(); // the platform scaled out: a NEW environment, a new cold start
  show('env 2, call 1 (cold again)', await second.handler(makeEvent({ path: '/hello', query: { name: 'Ada' } }), fakeContext));
}

// =====================================================================================
// Part 2: a Request/Response router. This is the idea behind Hono and the Cloudflare Workers API:
// the handler is a plain function: Request in, Response out. Only web-standard objects, no Node.
// =====================================================================================
function tinyApp() {
  const routes = [];
  const add = (method) => (pattern, handler) => {
    routes.push({ method, ...compile(pattern), handler });
  };
  return {
    get: add('GET'),
    post: add('POST'),
    // The one function every runtime needs: (Request, env, ctx) -> Response
    async fetch(request, env = {}, ctx = { waitUntil() {} }) {
      const { pathname } = new URL(request.url);
      for (const route of routes) {
        const match = request.method === route.method && route.regex.exec(pathname);
        if (!match) continue;
        const params = Object.fromEntries(route.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]));
        return route.handler({ req: request, params, env, ctx, json: (data, status = 200) => Response.json(data, { status }) });
      }
      return Response.json({ error: 'Not Found' }, { status: 404 });
    },
  };
}

function buildEdgeApp() {
  const app = tinyApp();
  app.get('/users/:id', (c) => c.json({ id: c.params.id, region: c.env.REGION ?? 'local' }));
  app.post('/echo', async (c) => c.json({ youSent: await c.req.json() }, 201));
  return app;
}

async function partEdge() {
  console.log('=== Part 2: a Workers-style fetch handler, called directly');
  const app = buildEdgeApp();
  // On Cloudflare Workers the file would end with:  export default { fetch: app.fetch };
  const res = await app.fetch(new Request('https://example.com/users/42'), { REGION: 'edge-demo' });
  console.log('GET /users/42        ->', res.status, await res.text());
  const miss = await app.fetch(new Request('https://example.com/missing'));
  console.log('GET /missing         ->', miss.status, await miss.text());

  // ctx.waitUntil lets you keep working AFTER the response was returned (logging, cache fill ...)
  const later = [];
  const worker = {
    async fetch(request, env, ctx) {
      ctx.waitUntil(Promise.resolve().then(() => later.push(`analytics for ${new URL(request.url).pathname}`)));
      return new Response('ok');
    },
  };
  const waiting = [];
  await worker.fetch(new Request('https://example.com/page'), {}, { waitUntil: (p) => waiting.push(p) });
  await Promise.all(waiting);
  console.log('waitUntil work       ->', JSON.stringify(later));
}

// =====================================================================================
// Part 3: the same fetch handler on a normal Node server, through an adapter.
// This is what packages such as @hono/node-server do: Node request -> Request, Response -> Node response.
// =====================================================================================
function toNodeListener(fetchHandler) {
  return async (req, res) => {
    try {
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      const request = new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: hasBody ? Readable.toWeb(req) : undefined,
        duplex: 'half',
      });
      const response = await fetchHandler(request, { REGION: 'node' });
      res.writeHead(response.status, Object.fromEntries(response.headers)); // note: several Set-Cookie headers need response.headers.getSetCookie()
      res.end(Buffer.from(await response.arrayBuffer())); // simple version, a real adapter streams the body
    } catch {
      res.writeHead(500).end('adapter error');
    }
  };
}

async function partNode() {
  console.log('=== Part 3: the same app on a Node server, through an adapter');
  const app = buildEdgeApp();
  const server = await start(toNodeListener(app.fetch));
  let res = await server.get('/users/7');
  console.log('GET /users/7         ->', res.status, res.text);
  res = await server.post('/echo', { json: { hello: 'from node' } });
  console.log('POST /echo           ->', res.status, res.text);
  res = await server.get('/missing');
  console.log('GET /missing         ->', res.status, res.text);
  await server.close();
}

async function main() {
  await partLambda();
  await partEdge();
  await partNode();
}

main();
